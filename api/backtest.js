// Backtest API — Replays historical signals against price data to test parameter changes
// GET: Returns backtest results using closed trades from Redis
// POST: Run backtest with custom parameters against historical signal data

import { Redis } from '@upstash/redis';

let redis = null;

function getRedis() {
  if (!redis && process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    redis = new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN
    });
  }
  return redis;
}

// Simulate partial TP on a trade
function simulatePartialTP(trade, params) {
  const tp1Pct = params.tp1Percent || 0.50;
  const tp2Pct = params.tp2Percent || 0.75;
  const tp1Ratio = params.tp1CloseRatio || 0.40;
  const tp2Ratio = params.tp2CloseRatio || 0.30;
  const tp3Ratio = 1.0 - tp1Ratio - tp2Ratio;

  const isLong = trade.direction === 'LONG';
  const entry = trade.entry;
  const tp = trade.tp || trade.takeProfit;
  const sl = trade.sl || trade.stopLoss;
  const exitPrice = trade.exitPrice;
  const size = trade.size || 1000;

  if (!entry || !tp || !sl || !exitPrice) return null;

  const tpDist = Math.abs(tp - entry);
  const tp1Price = isLong ? entry + tpDist * tp1Pct : entry - tpDist * tp1Pct;
  const tp2Price = isLong ? entry + tpDist * tp2Pct : entry - tpDist * tp2Pct;

  // Did price reach each TP level before exit?
  const isWin = trade.pnl > 0;
  const reachedTP1 = isWin || (isLong ? exitPrice >= tp1Price : exitPrice <= tp1Price);
  const reachedTP2 = isWin || (isLong ? exitPrice >= tp2Price : exitPrice <= tp2Price);
  const reachedTP3 = isWin;

  let totalPnl = 0;

  if (reachedTP1) {
    const diff = isLong ? tp1Price - entry : entry - tp1Price;
    totalPnl += (diff / entry) * size * tp1Ratio;
  }
  if (reachedTP2) {
    const diff = isLong ? tp2Price - entry : entry - tp2Price;
    totalPnl += (diff / entry) * size * tp2Ratio;
  }
  if (reachedTP3) {
    const diff = isLong ? tp - entry : entry - tp;
    totalPnl += (diff / entry) * size * tp3Ratio;
  }

  // Remaining position hits SL (after breakeven if TP1 was hit)
  if (!reachedTP3) {
    const remainingRatio = reachedTP2 ? tp3Ratio : reachedTP1 ? (tp2Ratio + tp3Ratio) : 1.0;
    const slPrice = reachedTP1 ? entry : sl; // Breakeven after TP1
    const diff = isLong ? slPrice - entry : entry - slPrice;
    totalPnl += (diff / entry) * size * remainingRatio;
  }

  return {
    symbol: trade.symbol,
    direction: trade.direction,
    entry,
    tp,
    sl,
    exitPrice,
    originalPnl: trade.pnl,
    partialTPPnl: totalPnl,
    improvement: totalPnl - (trade.pnl || 0),
    tp1Hit: reachedTP1,
    tp2Hit: reachedTP2,
    tp3Hit: reachedTP3
  };
}

// Analyze trades by various dimensions
function analyzeByDimension(trades, getDimension, dimensionName) {
  const groups = {};
  for (const t of trades) {
    const key = getDimension(t) || 'unknown';
    if (!groups[key]) groups[key] = { wins: 0, losses: 0, totalPnl: 0, count: 0 };
    groups[key].count++;
    groups[key].totalPnl += t.pnl || 0;
    if (t.pnl > 0) groups[key].wins++;
    else groups[key].losses++;
  }

  return Object.entries(groups).map(([key, data]) => ({
    [dimensionName]: key,
    trades: data.count,
    winRate: data.count > 0 ? Math.round(data.wins / data.count * 100) : 0,
    totalPnl: Math.round(data.totalPnl * 100) / 100,
    avgPnl: data.count > 0 ? Math.round(data.totalPnl / data.count * 100) / 100 : 0
  })).sort((a, b) => b.totalPnl - a.totalPnl);
}

export default async function handler(request, response) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (request.method === 'OPTIONS') return response.status(200).end();

  const r = getRedis();
  if (!r) return response.status(500).json({ success: false, error: 'Redis not configured' });

  try {
    // Load portfolio data
    const data = await r.get('dual_portfolio_data');
    if (!data) return response.status(200).json({ success: true, message: 'No trade data yet' });

    const portfolioData = typeof data === 'string' ? JSON.parse(data) : data;
    const allTrades = [
      ...(portfolioData.silver?.trades || []).map(t => ({ ...t, portfolio: 'silver' })),
      ...(portfolioData.gold?.trades || []).map(t => ({ ...t, portfolio: 'gold' }))
    ];
    const closedTrades = allTrades.filter(t => t.status === 'closed');

    if (request.method === 'GET') {
      // Return analysis of all closed trades
      const totalPnl = closedTrades.reduce((s, t) => s + (t.pnl || 0), 0);
      const wins = closedTrades.filter(t => t.pnl > 0);
      const losses = closedTrades.filter(t => t.pnl <= 0);

      // Simulate partial TP on all trades
      const partialTPResults = closedTrades.map(t => simulatePartialTP(t, {})).filter(Boolean);
      const partialTPTotal = partialTPResults.reduce((s, r) => s + r.partialTPPnl, 0);
      const partialTPImprovement = partialTPTotal - totalPnl;

      return response.status(200).json({
        success: true,
        summary: {
          totalTrades: closedTrades.length,
          wins: wins.length,
          losses: losses.length,
          winRate: closedTrades.length > 0 ? Math.round(wins.length / closedTrades.length * 100) : 0,
          totalPnl: Math.round(totalPnl * 100) / 100,
          avgPnl: closedTrades.length > 0 ? Math.round(totalPnl / closedTrades.length * 100) / 100 : 0,
          largestWin: wins.length > 0 ? Math.round(Math.max(...wins.map(t => t.pnl)) * 100) / 100 : 0,
          largestLoss: losses.length > 0 ? Math.round(Math.min(...losses.map(t => t.pnl)) * 100) / 100 : 0,
          partialTPSimulation: {
            totalPnl: Math.round(partialTPTotal * 100) / 100,
            improvement: Math.round(partialTPImprovement * 100) / 100,
            note: 'Simulated PnL if partial TP (40/30/30 at 50%/75%/100%) was used'
          }
        },
        bySymbol: analyzeByDimension(closedTrades, t => t.symbol, 'symbol'),
        byDirection: analyzeByDimension(closedTrades, t => t.direction, 'direction'),
        byPortfolio: analyzeByDimension(closedTrades, t => t.portfolio, 'portfolio'),
        byConsensus: analyzeByDimension(closedTrades, t => t.isGoldConsensus ? 'Gold' : 'Silver', 'consensus'),
        byAI: analyzeByDimension(closedTrades, t => (t.aiSources || []).join('+'), 'aiCombo'),
        bySession: analyzeByDimension(closedTrades, t => {
          const h = new Date(t.timestamp).getUTCHours();
          if (h >= 0 && h < 8) return 'Asian (00-08 UTC)';
          if (h >= 8 && h < 13) return 'European (08-13 UTC)';
          if (h >= 13 && h < 21) return 'US (13-21 UTC)';
          return 'Late (21-00 UTC)';
        }, 'session'),
        recentTrades: closedTrades.slice(-20).reverse().map(t => ({
          symbol: t.symbol,
          direction: t.direction,
          entry: t.entry,
          exit: t.exitPrice,
          pnl: Math.round((t.pnl || 0) * 100) / 100,
          portfolio: t.portfolio,
          isGold: t.isGoldConsensus,
          aiSources: t.aiSources,
          date: new Date(t.timestamp).toISOString().slice(0, 16)
        }))
      });
    }

    // POST: Custom backtest with parameters
    if (request.method === 'POST') {
      const params = request.body || {};
      const results = closedTrades.map(t => simulatePartialTP(t, params)).filter(Boolean);
      const originalTotal = closedTrades.reduce((s, t) => s + (t.pnl || 0), 0);
      const newTotal = results.reduce((s, r) => s + r.partialTPPnl, 0);

      return response.status(200).json({
        success: true,
        params,
        originalPnl: Math.round(originalTotal * 100) / 100,
        simulatedPnl: Math.round(newTotal * 100) / 100,
        improvement: Math.round((newTotal - originalTotal) * 100) / 100,
        trades: results.length,
        tp1HitRate: results.length > 0 ? Math.round(results.filter(r => r.tp1Hit).length / results.length * 100) : 0,
        tp2HitRate: results.length > 0 ? Math.round(results.filter(r => r.tp2Hit).length / results.length * 100) : 0,
        tp3HitRate: results.length > 0 ? Math.round(results.filter(r => r.tp3Hit).length / results.length * 100) : 0
      });
    }

    return response.status(405).json({ success: false, error: 'Method not allowed' });

  } catch (error) {
    console.error('Backtest API error:', error);
    return response.status(500).json({ success: false, error: error.message });
  }
}
