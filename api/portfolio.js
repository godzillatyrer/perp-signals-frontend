// Portfolio API - Persistent dual-portfolio tracking across devices via Redis
// Supports two portfolios: 2/3 consensus and 3/3 consensus strategies

import { Redis } from '@upstash/redis';
import { PORTFOLIO_CONFIG } from '../lib/trading-config.js';

const PORTFOLIO_KEY = 'dual_portfolio_data';

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

// Default portfolio structure for aggressive 200% monthly growth
function getDefaultPortfolio(type) {
  return {
    type, // 'silver' (2/3 consensus) or 'gold' (3/3 consensus)
    balance: 5000,
    startBalance: 5000,
    trades: [],
    equityHistory: [{ time: Date.now(), value: 5000 }],
    stats: {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      totalPnL: 0,
      maxDrawdown: 0,
      peakEquity: 5000,
      monthlyReturn: 0,
      sharpeRatio: 0,
      avgWin: 0,
      avgLoss: 0,
      largestWin: 0,
      largestLoss: 0,
      consecutiveWins: 0,
      consecutiveLosses: 0,
      maxConsecutiveWins: 0,
      maxConsecutiveLosses: 0
    },
    lastUpdated: Date.now()
  };
}

function getDefaultData() {
  return {
    silver: getDefaultPortfolio('silver'), // 2/3 consensus
    gold: getDefaultPortfolio('gold'),     // 3/3 consensus
    config: {
      silverConfig: { ...PORTFOLIO_CONFIG.silver },
      goldConfig: { ...PORTFOLIO_CONFIG.gold }
    },
    lastUpdated: Date.now()
  };
}

async function getData() {
  const r = getRedis();
  if (!r) return getDefaultData();

  try {
    const data = await r.get(PORTFOLIO_KEY);
    if (data) {
      const parsed = typeof data === 'string' ? JSON.parse(data) : data;
      // Merge with defaults to ensure all fields exist
      const defaultData = getDefaultData();
      return {
        silver: { ...defaultData.silver, ...parsed.silver },
        gold: { ...defaultData.gold, ...parsed.gold },
        config: { ...defaultData.config, ...parsed.config },
        lastUpdated: parsed.lastUpdated || Date.now()
      };
    }
    return getDefaultData();
  } catch (e) {
    console.error('Redis get error for portfolio:', e.message);
    return getDefaultData();
  }
}

async function saveData(data) {
  const r = getRedis();
  if (!r) {
    console.log('Redis not configured - portfolio not persisted');
    return false;
  }

  try {
    data.lastUpdated = Date.now();
    // Keep only last 200 equity points per portfolio to prevent unbounded growth
    if (data.silver.equityHistory && data.silver.equityHistory.length > 200) {
      data.silver.equityHistory = data.silver.equityHistory.slice(-200);
    }
    if (data.gold.equityHistory && data.gold.equityHistory.length > 200) {
      data.gold.equityHistory = data.gold.equityHistory.slice(-200);
    }
    // Keep only last 100 trades per portfolio
    if (data.silver.trades && data.silver.trades.length > 100) {
      data.silver.trades = data.silver.trades.slice(-100);
    }
    if (data.gold.trades && data.gold.trades.length > 100) {
      data.gold.trades = data.gold.trades.slice(-100);
    }
    await r.set(PORTFOLIO_KEY, JSON.stringify(data));
    return true;
  } catch (e) {
    console.error('Redis save error for portfolio:', e.message);
    return false;
  }
}

function calculateStats(portfolio) {
  const closedTrades = portfolio.trades.filter(t => t.status === 'closed');
  const wins = closedTrades.filter(t => t.pnl > 0);
  const losses = closedTrades.filter(t => t.pnl <= 0);

  // Calculate max drawdown from equity history
  let peak = portfolio.equityHistory[0]?.value || portfolio.startBalance;
  let maxDd = 0;
  for (const point of portfolio.equityHistory) {
    if (point.value > peak) peak = point.value;
    const dd = (peak - point.value) / peak * 100;
    if (dd > maxDd) maxDd = dd;
  }

  // Calculate consecutive wins/losses
  let consecutiveWins = 0;
  let consecutiveLosses = 0;
  let maxConsecutiveWins = 0;
  let maxConsecutiveLosses = 0;
  let currentStreak = 0;
  let lastWasWin = null;

  for (const trade of closedTrades) {
    const isWin = trade.pnl > 0;
    if (lastWasWin === null) {
      currentStreak = 1;
    } else if (isWin === lastWasWin) {
      currentStreak++;
    } else {
      currentStreak = 1;
    }

    if (isWin) {
      consecutiveWins = currentStreak;
      if (currentStreak > maxConsecutiveWins) maxConsecutiveWins = currentStreak;
    } else {
      consecutiveLosses = currentStreak;
      if (currentStreak > maxConsecutiveLosses) maxConsecutiveLosses = currentStreak;
    }
    lastWasWin = isWin;
  }

  const totalPnL = closedTrades.reduce((sum, t) => sum + t.pnl, 0);
  const avgWin = wins.length > 0 ? wins.reduce((sum, t) => sum + t.pnl, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0) / losses.length) : 0;

  // Monthly return calculation
  const daysSinceStart = (Date.now() - (portfolio.equityHistory[0]?.time || Date.now())) / (1000 * 60 * 60 * 24);
  const totalReturn = ((portfolio.balance - portfolio.startBalance) / portfolio.startBalance) * 100;
  const monthlyReturn = daysSinceStart > 0 ? (totalReturn / daysSinceStart) * 30 : 0;

  return {
    totalTrades: closedTrades.length,
    winningTrades: wins.length,
    losingTrades: losses.length,
    totalPnL,
    maxDrawdown: maxDd,
    peakEquity: peak,
    monthlyReturn,
    avgWin,
    avgLoss,
    largestWin: wins.length > 0 ? Math.max(...wins.map(t => t.pnl)) : 0,
    largestLoss: losses.length > 0 ? Math.min(...losses.map(t => t.pnl)) : 0,
    consecutiveWins,
    consecutiveLosses,
    maxConsecutiveWins,
    maxConsecutiveLosses,
    winRate: closedTrades.length > 0 ? (wins.length / closedTrades.length * 100) : 0,
    profitFactor: avgLoss > 0 ? avgWin / avgLoss : 0
  };
}

export default async function handler(request, response) {
  // CORS headers
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (request.method === 'OPTIONS') {
    return response.status(200).end();
  }

  const r = getRedis();
  if (!r) {
    return response.status(500).json({
      success: false,
      error: 'Redis not configured'
    });
  }

  try {
    // GET - Fetch current portfolio data
    if (request.method === 'GET') {
      const data = await getData();
      // Recalculate stats on fetch
      data.silver.stats = calculateStats(data.silver);
      data.gold.stats = calculateStats(data.gold);
      return response.status(200).json({
        success: true,
        data
      });
    }

    // POST - Replace all portfolio data (full sync from client)
    if (request.method === 'POST') {
      const { action, data } = request.body || {};

      // Save sentiment data to Redis for server-side scan.js to use
      if (action === 'save_sentiment' && data) {
        try {
          await r.set('social_sentiment_data', JSON.stringify(data), { ex: 3600 }); // 1h TTL
          return response.status(200).json({ success: true });
        } catch (e) {
          return response.status(200).json({ success: false, error: e.message });
        }
      }

      if (!data) {
        return response.status(400).json({
          success: false,
          error: 'data object required'
        });
      }

      // Merge with defaults to ensure structure
      const defaultData = getDefaultData();
      const mergedData = {
        silver: { ...defaultData.silver, ...data.silver },
        gold: { ...defaultData.gold, ...data.gold },
        config: { ...defaultData.config, ...data.config },
        lastUpdated: Date.now()
      };
      const saved = await saveData(mergedData);

      return response.status(200).json({
        success: saved,
        data: mergedData
      });
    }

    // PATCH - Update specific portfolio actions
    if (request.method === 'PATCH') {
      const { action, portfolio, data } = request.body;
      const currentData = await getData();

      if (!['silver', 'gold'].includes(portfolio)) {
        return response.status(400).json({
          success: false,
          error: 'portfolio must be "silver" or "gold"'
        });
      }

      switch (action) {
        case 'open_trade': {
          const trade = {
            id: Date.now(),
            ...data,
            status: 'open',
            pnl: 0,
            openTime: Date.now()
          };
          currentData[portfolio].trades.push(trade);
          break;
        }

        case 'close_trade': {
          const { tradeId, exitPrice, pnl } = data;
          const trade = currentData[portfolio].trades.find(t => t.id === tradeId);
          if (trade) {
            trade.status = 'closed';
            trade.exitPrice = exitPrice;
            trade.pnl = pnl;
            trade.closeTime = Date.now();

            // Update balance
            currentData[portfolio].balance += pnl;

            // Add equity point
            currentData[portfolio].equityHistory.push({
              time: Date.now(),
              value: currentData[portfolio].balance
            });
          }
          break;
        }

        case 'update_balance': {
          const { balance, equityPoint } = data;
          currentData[portfolio].balance = balance;
          if (equityPoint) {
            currentData[portfolio].equityHistory.push(equityPoint);
          }
          break;
        }

        case 'reset': {
          currentData[portfolio] = getDefaultPortfolio(portfolio);
          break;
        }

        case 'update_config': {
          const configKey = portfolio === 'silver' ? 'silverConfig' : 'goldConfig';
          currentData.config[configKey] = { ...currentData.config[configKey], ...data };
          break;
        }

        default:
          return response.status(400).json({
            success: false,
            error: `Unknown action: ${action}`
          });
      }

      // Recalculate stats
      currentData[portfolio].stats = calculateStats(currentData[portfolio]);
      currentData[portfolio].lastUpdated = Date.now();

      const saved = await saveData(currentData);
      return response.status(200).json({
        success: saved,
        data: currentData
      });
    }

    // DELETE - Reset portfolios
    if (request.method === 'DELETE') {
      const { portfolio, confirm } = request.query;

      if (confirm !== 'true') {
        return response.status(400).json({
          success: false,
          error: 'Add ?confirm=true to reset portfolio'
        });
      }

      const currentData = await getData();

      if (portfolio && ['silver', 'gold'].includes(portfolio)) {
        // Reset specific portfolio
        currentData[portfolio] = getDefaultPortfolio(portfolio);
      } else {
        // Reset both portfolios
        currentData.silver = getDefaultPortfolio('silver');
        currentData.gold = getDefaultPortfolio('gold');
      }

      const saved = await saveData(currentData);

      return response.status(200).json({
        success: saved,
        message: portfolio ? `${portfolio} portfolio reset` : 'All portfolios reset',
        data: currentData
      });
    }

    return response.status(405).json({
      success: false,
      error: 'Method not allowed'
    });

  } catch (error) {
    console.error('Portfolio API error:', error);
    return response.status(500).json({
      success: false,
      error: error.message
    });
  }
}
