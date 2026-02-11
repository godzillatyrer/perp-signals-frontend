// Backend Position Monitor - Checks open trades and executes TP/SL
// Runs as a Vercel cron job every 2 minutes to ensure trades are managed 24/7
// Features: TP/SL execution, breakeven stop-loss, trailing stop

import { Redis } from '@upstash/redis';

const PORTFOLIO_KEY = 'dual_portfolio_data';

// Trailing stop config per portfolio type
const TRAIL_CONFIG = {
  silver: { breakevenThreshold: 0.50, trailPercent: 2.0 },
  gold:   { breakevenThreshold: 0.50, trailPercent: 1.5 }
};

// Partial Take Profit levels
// TP1: Close 40% at 50% of target, move SL to breakeven
// TP2: Close 30% at 75% of target
// TP3: Close remaining 30% at full target (or trail)
const PARTIAL_TP = {
  tp1: { percent: 0.50, closeRatio: 0.40 },
  tp2: { percent: 0.75, closeRatio: 0.30 },
  tp3: { percent: 1.00, closeRatio: 0.30 }
};

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

// Fetch with timeout helper
async function fetchWithTimeout(url, options = {}, timeout = 10000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

// Get current prices — multiple fallback sources for reliability
async function getCurrentPrices(symbols) {
  // Source 1: Binance Spot API (more reliable from Vercel than Futures API)
  try {
    const response = await fetchWithTimeout('https://api.binance.com/api/v3/ticker/price', {}, 5000);
    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data)) {
        const prices = {};
        for (const item of data) {
          if (symbols.includes(item.symbol)) {
            prices[item.symbol] = parseFloat(item.price);
          }
        }
        if (Object.keys(prices).length > 0) {
          console.log('Prices from Binance Spot');
          return prices;
        }
      }
    }
  } catch (error) {
    console.log('Binance Spot prices failed:', error.message);
  }

  // Source 2: Bybit
  try {
    const response = await fetchWithTimeout('https://api.bybit.com/v5/market/tickers?category=linear', {}, 5000);
    if (response.ok) {
      const data = await response.json();
      if (data?.result?.list) {
        const prices = {};
        for (const item of data.result.list) {
          if (symbols.includes(item.symbol)) {
            prices[item.symbol] = parseFloat(item.lastPrice);
          }
        }
        if (Object.keys(prices).length > 0) {
          console.log('Prices from Bybit');
          return prices;
        }
      }
    }
  } catch (error) {
    console.log('Bybit prices failed:', error.message);
  }

  // Source 3: CoinGecko (always accessible, rate-limited but reliable)
  try {
    const cgIds = symbols.map(s => {
      const base = s.replace('USDT', '').toLowerCase();
      const idMap = { btc: 'bitcoin', eth: 'ethereum', sol: 'solana', bnb: 'binancecoin', xrp: 'ripple', doge: 'dogecoin', ada: 'cardano', avax: 'avalanche-2', link: 'chainlink', dot: 'polkadot' };
      return idMap[base] || base;
    });
    const response = await fetchWithTimeout(
      `https://api.coingecko.com/api/v3/simple/price?ids=${cgIds.join(',')}&vs_currencies=usd`, {}, 5000
    );
    if (response.ok) {
      const data = await response.json();
      const prices = {};
      const reverseMap = { bitcoin: 'BTCUSDT', ethereum: 'ETHUSDT', solana: 'SOLUSDT', binancecoin: 'BNBUSDT', ripple: 'XRPUSDT', dogecoin: 'DOGEUSDT', cardano: 'ADAUSDT', 'avalanche-2': 'AVAXUSDT', chainlink: 'LINKUSDT', polkadot: 'DOTUSDT' };
      for (const [cgId, priceData] of Object.entries(data)) {
        const symbol = reverseMap[cgId];
        if (symbol && symbols.includes(symbol) && priceData.usd) {
          prices[symbol] = priceData.usd;
        }
      }
      if (Object.keys(prices).length > 0) {
        console.log('Prices from CoinGecko');
        return prices;
      }
    }
  } catch (error) {
    console.log('CoinGecko prices failed:', error.message);
  }

  console.error('All price sources failed for:', symbols);
  return null;
}

// Send Telegram notification
async function sendTelegramMessage(message) {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    console.log('Telegram not configured');
    return false;
  }

  try {
    const url = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      })
    });
    return response.ok;
  } catch (error) {
    console.error('Telegram send error:', error.message);
    return false;
  }
}

// Format trade close notification
function formatTradeCloseMessage(trade, portfolioType, exitPrice, pnl, isTP) {
  const emoji = trade.isGoldConsensus ? '🥇' : '🥈';
  const resultEmoji = pnl > 0 ? '✅' : '❌';
  const resultText = isTP ? 'FULL TP HIT' : (trade.isTrailing ? 'TRAIL SL HIT' : 'SL HIT');
  const pnlSign = pnl >= 0 ? '+' : '';

  let partialInfo = '';
  if (trade.tp1Hit || trade.tp2Hit) {
    const parts = [];
    if (trade.tp1Hit) parts.push('TP1 ✅');
    if (trade.tp2Hit) parts.push('TP2 ✅');
    if (trade.tp3Hit) parts.push('TP3 ✅');
    partialInfo = `\n📊 Partial TPs: ${parts.join(' → ')}`;
  }

  return `${emoji} <b>${portfolioType.toUpperCase()} PORTFOLIO - ${resultText}</b>

${resultEmoji} <b>${trade.symbol}</b> ${trade.direction}

📊 Entry: $${trade.entry.toFixed(4)}
📊 Exit: $${exitPrice.toFixed(4)}${partialInfo}

💰 Total PnL: <b>${pnlSign}$${pnl.toFixed(2)}</b>
📈 Position Size: $${trade.size.toFixed(2)}

⏰ Closed by: Backend Monitor
🤖 Auto-managed 24/7`;
}

// === POST-TRADE ANALYSIS: AI-generated lessons from closed trades ===
async function generateTradeLesson(trade, exitPrice, pnl) {
  if (!process.env.CLAUDE_API_KEY) return null;

  try {
    const outcome = pnl > 0 ? 'WIN' : 'LOSS';
    const holdTime = trade.closeTimestamp ? ((trade.closeTimestamp - trade.timestamp) / 3600000).toFixed(1) : 'unknown';
    const prompt = `A crypto perpetual futures trade just closed. Analyze what happened and provide a 1-line lesson.

Trade: ${trade.symbol} ${trade.direction}
Entry: $${trade.entry} | Exit: $${exitPrice} | PnL: ${pnl > 0 ? '+' : ''}$${pnl.toFixed(2)} (${outcome})
Confidence: ${trade.confidence || 'N/A'}% | Hold time: ${holdTime}h
Consensus: ${trade.isGoldConsensus ? 'Gold (3/3)' : 'Silver (2/3)'}
Partial TPs: ${trade.tp1Hit ? 'TP1✅' : 'TP1❌'} ${trade.tp2Hit ? 'TP2✅' : 'TP2❌'} ${trade.tp3Hit ? 'TP3✅' : 'TP3❌'}
SL was trailing: ${trade.isTrailing ? 'Yes' : 'No'}

Respond with ONLY a JSON object: {"lesson": "one sentence lesson", "category": "ENTRY_TIMING|EXIT_TIMING|TREND_WRONG|STOP_TOO_TIGHT|STOP_TOO_WIDE|GOOD_TRADE|LUCKY_TRADE"}`;

    const response = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }]
      })
    }, 15000);

    const data = await response.json();
    if (data.content?.[0]?.text) {
      const jsonMatch = data.content[0].text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          symbol: trade.symbol,
          direction: trade.direction,
          outcome,
          pnl: pnl.toFixed(2),
          confidence: trade.confidence || null,
          lesson: parsed.lesson,
          category: parsed.category,
          timestamp: Date.now()
        };
      }
    }
  } catch (e) {
    console.log('Trade lesson generation failed:', e.message);
  }
  return null;
}

async function saveTradeLesson(r, lesson) {
  if (!r || !lesson) return;
  try {
    let lessons = await r.get('trade_lessons') || [];
    if (typeof lessons === 'string') lessons = JSON.parse(lessons);
    lessons.push(lesson);
    // Keep last 50 lessons
    if (lessons.length > 50) lessons = lessons.slice(-50);
    await r.set('trade_lessons', JSON.stringify(lessons));
    console.log(`📝 Trade lesson saved: ${lesson.lesson}`);
  } catch (e) {
    console.log('Failed to save trade lesson:', e.message);
  }
}

// === CONFIDENCE vs OUTCOME TRACKING (#3) ===
async function trackConfidenceOutcome(r, trade, pnl) {
  if (!r || !trade.confidence) return;
  try {
    let tracking = await r.get('confidence_tracking') || [];
    if (typeof tracking === 'string') tracking = JSON.parse(tracking);
    tracking.push({
      symbol: trade.symbol,
      direction: trade.direction,
      confidence: trade.confidence,
      outcome: pnl > 0 ? 'win' : 'loss',
      pnl: parseFloat(pnl.toFixed(2)),
      isGold: trade.isGoldConsensus || false,
      timestamp: Date.now()
    });
    // Keep last 200 entries
    if (tracking.length > 200) tracking = tracking.slice(-200);
    await r.set('confidence_tracking', JSON.stringify(tracking));
  } catch (e) {
    console.log('Failed to track confidence:', e.message);
  }
}

// === ENHANCED STATS: Sharpe ratio, profit factor, expectancy (#12) ===
function calculateEnhancedStats(portfolio) {
  const closedTrades = portfolio.trades.filter(t => t.status === 'closed');
  const wins = closedTrades.filter(t => t.pnl > 0);
  const losses = closedTrades.filter(t => t.pnl <= 0);

  // Basic stats
  let peak = portfolio.equityHistory[0]?.value || portfolio.startBalance;
  let maxDd = 0;
  for (const point of portfolio.equityHistory) {
    if (point.value > peak) peak = point.value;
    const dd = (peak - point.value) / peak * 100;
    if (dd > maxDd) maxDd = dd;
  }
  const totalPnL = closedTrades.reduce((sum, t) => sum + t.pnl, 0);

  // Profit Factor = gross wins / gross losses
  const grossWins = wins.reduce((sum, t) => sum + t.pnl, 0);
  const grossLosses = Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0));
  const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0;

  // Average Win / Average Loss
  const avgWin = wins.length > 0 ? grossWins / wins.length : 0;
  const avgLoss = losses.length > 0 ? grossLosses / losses.length : 0;

  // Expectancy = (WinRate × AvgWin) - (LossRate × AvgLoss)
  const winRate = closedTrades.length > 0 ? wins.length / closedTrades.length : 0;
  const expectancy = (winRate * avgWin) - ((1 - winRate) * avgLoss);

  // Sharpe Ratio (simplified: mean return / std dev of returns)
  let sharpeRatio = 0;
  if (closedTrades.length >= 5) {
    const returns = closedTrades.map(t => t.pnl);
    const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);
    sharpeRatio = stdDev > 0 ? (meanReturn / stdDev) * Math.sqrt(252) : 0; // Annualized
  }

  // Consecutive wins/losses
  let maxConsecWins = 0, maxConsecLosses = 0, curWins = 0, curLosses = 0;
  for (const t of closedTrades) {
    if (t.pnl > 0) { curWins++; curLosses = 0; maxConsecWins = Math.max(maxConsecWins, curWins); }
    else { curLosses++; curWins = 0; maxConsecLosses = Math.max(maxConsecLosses, curLosses); }
  }

  return {
    totalTrades: closedTrades.length,
    winningTrades: wins.length,
    losingTrades: losses.length,
    totalPnL,
    maxDrawdown: maxDd,
    peakEquity: peak,
    winRate: closedTrades.length > 0 ? (wins.length / closedTrades.length * 100) : 0,
    profitFactor: Math.round(profitFactor * 100) / 100,
    avgWin: Math.round(avgWin * 100) / 100,
    avgLoss: Math.round(avgLoss * 100) / 100,
    expectancy: Math.round(expectancy * 100) / 100,
    sharpeRatio: Math.round(sharpeRatio * 100) / 100,
    maxConsecWins,
    maxConsecLosses
  };
}

// Get default portfolio structure
function getDefaultPortfolio(type) {
  return {
    type,
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
      peakEquity: 5000
    },
    lastUpdated: Date.now()
  };
}

function getDefaultData() {
  return {
    silver: getDefaultPortfolio('silver'),
    gold: getDefaultPortfolio('gold'),
    config: {
      silverConfig: {
        leverage: 10,
        riskPercent: 5,
        maxOpenTrades: 8,
        tpMultiplier: 2.5,
        slPercent: 2
      },
      goldConfig: {
        leverage: 15,
        riskPercent: 8,
        maxOpenTrades: 5,
        tpMultiplier: 3,
        slPercent: 1.5
      }
    },
    lastUpdated: Date.now()
  };
}

// Calculate stats for portfolio
function calculateStats(portfolio) {
  const closedTrades = portfolio.trades.filter(t => t.status === 'closed');
  const wins = closedTrades.filter(t => t.pnl > 0);
  const losses = closedTrades.filter(t => t.pnl <= 0);

  let peak = portfolio.equityHistory[0]?.value || portfolio.startBalance;
  let maxDd = 0;
  for (const point of portfolio.equityHistory) {
    if (point.value > peak) peak = point.value;
    const dd = (peak - point.value) / peak * 100;
    if (dd > maxDd) maxDd = dd;
  }

  const totalPnL = closedTrades.reduce((sum, t) => sum + t.pnl, 0);

  return {
    totalTrades: closedTrades.length,
    winningTrades: wins.length,
    losingTrades: losses.length,
    totalPnL,
    maxDrawdown: maxDd,
    peakEquity: peak,
    winRate: closedTrades.length > 0 ? (wins.length / closedTrades.length * 100) : 0
  };
}

export default async function handler(request, response) {
  // CORS headers
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (request.method === 'OPTIONS') {
    return response.status(200).end();
  }

  const startTime = Date.now();
  console.log('🔍 Position Monitor starting...');

  const r = getRedis();
  if (!r) {
    return response.status(500).json({
      success: false,
      error: 'Redis not configured'
    });
  }

  try {
    // 1. Load portfolio data from Redis
    let portfolioData;
    try {
      const data = await r.get(PORTFOLIO_KEY);
      if (data) {
        portfolioData = typeof data === 'string' ? JSON.parse(data) : data;
        // Merge with defaults
        const defaultData = getDefaultData();
        portfolioData = {
          silver: { ...defaultData.silver, ...portfolioData.silver },
          gold: { ...defaultData.gold, ...portfolioData.gold },
          config: { ...defaultData.config, ...portfolioData.config },
          lastUpdated: portfolioData.lastUpdated || Date.now()
        };
      } else {
        portfolioData = getDefaultData();
      }
    } catch (e) {
      console.error('Redis get error:', e.message);
      portfolioData = getDefaultData();
    }

    // 2. Collect all open trades and their symbols
    const openTrades = [];
    const symbols = new Set();

    for (const portfolioType of ['silver', 'gold']) {
      const portfolio = portfolioData[portfolioType];
      if (!portfolio.trades) continue;

      for (const trade of portfolio.trades) {
        if (trade.status === 'open') {
          openTrades.push({ ...trade, portfolioType });
          symbols.add(trade.symbol);
        }
      }
    }

    if (openTrades.length === 0) {
      console.log('📭 No open trades to monitor');
      return response.status(200).json({
        success: true,
        message: 'No open trades',
        tradesChecked: 0,
        tradesClosed: 0,
        duration: Date.now() - startTime
      });
    }

    console.log(`📊 Found ${openTrades.length} open trades across ${symbols.size} symbols`);

    // 3. Fetch current prices
    const prices = await getCurrentPrices([...symbols]);
    if (!prices || Object.keys(prices).length === 0) {
      console.error('Failed to fetch prices');
      return response.status(500).json({
        success: false,
        error: 'Failed to fetch current prices'
      });
    }

    console.log('💰 Fetched prices:', prices);

    // 4. Check each trade for TP/SL + breakeven + trailing stop
    const closedTrades = [];
    let slAdjusted = false;

    for (const trade of openTrades) {
      const currentPrice = prices[trade.symbol];
      if (!currentPrice) {
        console.log(`⚠️ No price for ${trade.symbol}, skipping`);
        continue;
      }

      const portfolio = portfolioData[trade.portfolioType];
      const tradeInPortfolio = portfolio.trades.find(t => t.id === trade.id);
      if (!tradeInPortfolio) continue;

      const config = TRAIL_CONFIG[trade.portfolioType] || TRAIL_CONFIG.silver;

      // --- Breakeven + Trailing Stop Logic ---
      const tpDistance = Math.abs(trade.tp - trade.entry);
      const breakevenTarget = trade.direction === 'LONG'
        ? trade.entry + tpDistance * config.breakevenThreshold
        : trade.entry - tpDistance * config.breakevenThreshold;

      const originalSL = trade.originalSl || trade.sl;
      const isLong = trade.direction === 'LONG';
      const priceProgress = isLong
        ? (currentPrice - trade.entry) / tpDistance
        : (trade.entry - currentPrice) / tpDistance;

      // Only adjust if price has moved past breakeven threshold
      if (priceProgress >= config.breakevenThreshold) {
        const trailDistance = trade.entry * (config.trailPercent / 100);
        const newTrailSL = isLong
          ? currentPrice - trailDistance
          : currentPrice + trailDistance;

        // Breakeven floor: SL never goes below entry once breakeven is triggered
        const breakevenSL = trade.entry;
        const bestSL = isLong
          ? Math.max(newTrailSL, breakevenSL)
          : Math.min(newTrailSL, breakevenSL);

        // Only move SL in favorable direction (never widen the stop)
        const shouldUpdate = isLong
          ? bestSL > tradeInPortfolio.sl
          : bestSL < tradeInPortfolio.sl;

        if (shouldUpdate) {
          // Save original SL for reference
          if (!tradeInPortfolio.originalSl) {
            tradeInPortfolio.originalSl = tradeInPortfolio.sl;
          }

          const oldSL = tradeInPortfolio.sl;
          tradeInPortfolio.sl = bestSL;
          tradeInPortfolio.slAdjustedAt = Date.now();
          tradeInPortfolio.isTrailing = true;
          slAdjusted = true;

          const moveType = Math.abs(bestSL - trade.entry) < 0.0001 ? 'BREAKEVEN' : 'TRAILING';
          console.log(`🔄 ${trade.symbol}: SL moved ${moveType} $${oldSL.toFixed(4)} → $${bestSL.toFixed(4)} (price: $${currentPrice.toFixed(4)})`);

          // Send Telegram notification for SL adjustment
          const emoji = trade.isGoldConsensus ? '🥇' : '🥈';
          const slMsg = `${emoji} <b>SL ${moveType}</b> — ${trade.symbol} ${trade.direction}\n\n` +
            `📊 Entry: $${trade.entry.toFixed(4)}\n` +
            `💰 Current: $${currentPrice.toFixed(4)} (${priceProgress > 0 ? '+' : ''}${(priceProgress * 100).toFixed(1)}%)\n` +
            `🛑 SL: $${oldSL.toFixed(4)} → <b>$${bestSL.toFixed(4)}</b>\n` +
            `🎯 TP: $${trade.tp.toFixed(4)}\n\n` +
            `🔒 ${moveType === 'BREAKEVEN' ? 'Zero-risk trade' : 'Profits locked in'}`;
          await sendTelegramMessage(slMsg);
        }
      }

      // --- Partial TP + SL Check ---
      const currentSL = tradeInPortfolio.sl;
      const remainingSize = tradeInPortfolio.remainingSize || tradeInPortfolio.size;

      // Check SL first
      const slHit = isLong ? currentPrice <= currentSL : currentPrice >= currentSL;

      if (slHit) {
        // Close entire remaining position at SL
        const priceDiff = isLong ? currentSL - trade.entry : trade.entry - currentSL;
        const pnl = (priceDiff / trade.entry) * remainingSize;
        const totalPnl = (tradeInPortfolio.partialPnl || 0) + pnl;

        tradeInPortfolio.status = 'closed';
        tradeInPortfolio.exitPrice = currentSL;
        tradeInPortfolio.pnl = totalPnl;
        tradeInPortfolio.closeTimestamp = Date.now();
        tradeInPortfolio.closedBy = 'backend-monitor';
        tradeInPortfolio.remainingSize = 0;

        portfolio.balance += pnl;
        portfolio.equityHistory.push({ time: Date.now(), value: portfolio.balance });

        closedTrades.push({
          trade: tradeInPortfolio,
          portfolioType: trade.portfolioType,
          exitPrice: currentSL,
          pnl: totalPnl,
          isTP: false
        });

        const closeType = tradeInPortfolio.isTrailing ? '🔄 TRAIL SL' : '🛑 SL';
        console.log(`${closeType} Closed ${trade.symbol} ${trade.direction} | PnL: $${totalPnl.toFixed(2)}`);
      } else {
        // Check partial TP levels
        const tpLevels = [
          { key: 'tp1Hit', ...PARTIAL_TP.tp1 },
          { key: 'tp2Hit', ...PARTIAL_TP.tp2 },
          { key: 'tp3Hit', ...PARTIAL_TP.tp3 }
        ];

        for (const level of tpLevels) {
          if (tradeInPortfolio[level.key]) continue; // Already hit this level

          const tpPrice = isLong
            ? trade.entry + tpDistance * level.percent
            : trade.entry - tpDistance * level.percent;
          const hit = isLong ? currentPrice >= tpPrice : currentPrice <= tpPrice;

          if (hit) {
            const closeSize = trade.size * level.closeRatio;
            const priceDiff = isLong ? tpPrice - trade.entry : trade.entry - tpPrice;
            const partialPnl = (priceDiff / trade.entry) * closeSize;

            tradeInPortfolio[level.key] = true;
            tradeInPortfolio.remainingSize = (tradeInPortfolio.remainingSize || trade.size) - closeSize;
            tradeInPortfolio.partialPnl = (tradeInPortfolio.partialPnl || 0) + partialPnl;
            portfolio.balance += partialPnl;
            slAdjusted = true; // Mark as changed to trigger save

            const tpLabel = level.key.toUpperCase().replace('HIT', '');
            console.log(`🎯 ${tpLabel} HIT ${trade.symbol}: closed ${(level.closeRatio * 100)}% @ $${tpPrice.toFixed(4)} | +$${partialPnl.toFixed(2)}`);

            // Move SL to breakeven after TP1
            if (level.key === 'tp1Hit' && !tradeInPortfolio.originalSl) {
              tradeInPortfolio.originalSl = tradeInPortfolio.sl;
              tradeInPortfolio.sl = trade.entry;
              console.log(`🔒 ${trade.symbol}: SL moved to BREAKEVEN after TP1`);
            }

            // Send Telegram for partial TP
            const emoji = trade.isGoldConsensus ? '🥇' : '🥈';
            const tpMsg = `${emoji} <b>PARTIAL ${tpLabel} HIT</b> — ${trade.symbol} ${trade.direction}\n\n` +
              `🎯 Closed ${(level.closeRatio * 100)}% @ $${tpPrice.toFixed(4)}\n` +
              `💰 Partial PnL: +$${partialPnl.toFixed(2)}\n` +
              `📊 Remaining: ${((tradeInPortfolio.remainingSize / trade.size) * 100).toFixed(0)}%\n` +
              (level.key === 'tp1Hit' ? `🔒 SL moved to BREAKEVEN` : `🛑 SL: $${tradeInPortfolio.sl.toFixed(4)}`);
            await sendTelegramMessage(tpMsg);

            // If TP3 hit (full target), close remaining position
            if (level.key === 'tp3Hit') {
              const totalPnl = tradeInPortfolio.partialPnl;
              tradeInPortfolio.status = 'closed';
              tradeInPortfolio.exitPrice = tpPrice;
              tradeInPortfolio.pnl = totalPnl;
              tradeInPortfolio.closeTimestamp = Date.now();
              tradeInPortfolio.closedBy = 'backend-monitor';
              tradeInPortfolio.remainingSize = 0;

              portfolio.equityHistory.push({ time: Date.now(), value: portfolio.balance });

              closedTrades.push({
                trade: tradeInPortfolio,
                portfolioType: trade.portfolioType,
                exitPrice: tpPrice,
                pnl: totalPnl,
                isTP: true
              });

              console.log(`🎯 FULL TP Closed ${trade.symbol} ${trade.direction} | Total PnL: $${totalPnl.toFixed(2)}`);
            }
            break; // Only process one TP level per check
          }
        }
      }
    }

    // 5. Save updated portfolio data if trades were closed OR stop-losses adjusted
    if (closedTrades.length > 0 || slAdjusted) {
      // Recalculate stats with enhanced metrics (Sharpe, profit factor, expectancy)
      portfolioData.silver.stats = calculateEnhancedStats(portfolioData.silver);
      portfolioData.gold.stats = calculateEnhancedStats(portfolioData.gold);
      portfolioData.lastUpdated = Date.now();

      // Keep equity history bounded
      for (const type of ['silver', 'gold']) {
        if (portfolioData[type].equityHistory.length > 200) {
          portfolioData[type].equityHistory = portfolioData[type].equityHistory.slice(-200);
        }
        if (portfolioData[type].trades.length > 100) {
          portfolioData[type].trades = portfolioData[type].trades.slice(-100);
        }
      }

      await r.set(PORTFOLIO_KEY, JSON.stringify(portfolioData));
      console.log('💾 Saved updated portfolio to Redis');

      // 6. Send Telegram notifications + post-trade analysis for each closed trade
      for (const { trade, portfolioType, exitPrice, pnl, isTP } of closedTrades) {
        const message = formatTradeCloseMessage(trade, portfolioType, exitPrice, pnl, isTP);
        await sendTelegramMessage(message);

        // Track confidence vs outcome (#3)
        await trackConfidenceOutcome(r, trade, pnl);

        // Generate AI lesson for this trade (#8)
        const lesson = await generateTradeLesson(trade, exitPrice, pnl);
        if (lesson) {
          await saveTradeLesson(r, lesson);
          // Include lesson in Telegram notification
          await sendTelegramMessage(`📝 <b>Trade Lesson</b> — ${trade.symbol} ${trade.direction}\n\n💡 ${lesson.lesson}\n📂 Category: ${lesson.category}`);
        }
      }
    }

    // 7. Server-side shadow PnL resolution for AI signal log
    // Resolves pending→win/loss so AI Strategy tab and AI prompts have track record data
    let shadowResolved = 0;
    try {
      const signalLogRaw = await r.get('ai_signal_log');
      if (signalLogRaw) {
        const signalLog = typeof signalLogRaw === 'string' ? JSON.parse(signalLogRaw) : signalLogRaw;
        // Collect symbols that need prices
        const shadowSymbols = new Set();
        for (const source of ['claude', 'openai', 'grok']) {
          for (const sig of (signalLog[source] || [])) {
            if (sig.shadowStatus === 'pending' && sig.symbol) shadowSymbols.add(sig.symbol);
          }
        }

        if (shadowSymbols.size > 0) {
          // Reuse prices already fetched for positions, fetch any missing ones
          const missingSymbols = [...shadowSymbols].filter(s => !prices[s]);
          let shadowPrices = { ...prices };
          if (missingSymbols.length > 0) {
            const extraPrices = await getCurrentPrices(missingSymbols);
            shadowPrices = { ...shadowPrices, ...extraPrices };
          }

          let changed = false;
          const now = Date.now();
          for (const source of ['claude', 'openai', 'grok']) {
            for (const sig of (signalLog[source] || [])) {
              if (sig.shadowStatus !== 'pending') continue;
              const currentPrice = shadowPrices[sig.symbol];
              if (!currentPrice) continue;

              const isLong = sig.direction === 'LONG';
              if (isLong) {
                if (currentPrice >= sig.tp) {
                  sig.shadowStatus = 'win';
                  sig.shadowPnl = ((sig.tp - sig.entry) / sig.entry * 100).toFixed(2);
                  changed = true; shadowResolved++;
                } else if (currentPrice <= sig.sl) {
                  sig.shadowStatus = 'loss';
                  sig.shadowPnl = ((sig.sl - sig.entry) / sig.entry * 100).toFixed(2);
                  changed = true; shadowResolved++;
                }
              } else {
                if (currentPrice <= sig.tp) {
                  sig.shadowStatus = 'win';
                  sig.shadowPnl = ((sig.entry - sig.tp) / sig.entry * 100).toFixed(2);
                  changed = true; shadowResolved++;
                } else if (currentPrice >= sig.sl) {
                  sig.shadowStatus = 'loss';
                  sig.shadowPnl = ((sig.entry - sig.sl) / sig.entry * 100).toFixed(2);
                  changed = true; shadowResolved++;
                }
              }

              // Expire pending signals older than 6h
              if (sig.shadowStatus === 'pending' && now - sig.timestamp > 6 * 60 * 60 * 1000) {
                const priceDiff = isLong ? currentPrice - sig.entry : sig.entry - currentPrice;
                sig.shadowStatus = priceDiff > 0 ? 'win' : 'loss';
                sig.shadowPnl = (priceDiff / sig.entry * 100).toFixed(2);
                changed = true; shadowResolved++;
              }
            }
          }

          if (changed) {
            await r.set('ai_signal_log', JSON.stringify(signalLog));
            console.log(`🔮 Shadow PnL: resolved ${shadowResolved} signals`);
          }
        }
      }
    } catch (e) {
      console.log('Shadow PnL resolution skipped:', e.message);
    }

    const duration = Date.now() - startTime;
    console.log(`✅ Position Monitor complete in ${duration}ms | Checked: ${openTrades.length} | Closed: ${closedTrades.length} | SL adjusted: ${slAdjusted} | Shadow resolved: ${shadowResolved}`);

    return response.status(200).json({
      success: true,
      tradesChecked: openTrades.length,
      tradesClosed: closedTrades.length,
      slAdjusted,
      closedTrades: closedTrades.map(ct => ({
        symbol: ct.trade.symbol,
        direction: ct.trade.direction,
        pnl: ct.pnl,
        isTP: ct.isTP,
        portfolio: ct.portfolioType
      })),
      shadowResolved,
      duration
    });

  } catch (error) {
    console.error('Position Monitor error:', error);
    return response.status(500).json({
      success: false,
      error: error.message
    });
  }
}
