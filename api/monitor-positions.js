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

// Get current prices from Binance Futures
async function getCurrentPrices(symbols) {
  try {
    const response = await fetchWithTimeout('https://fapi.binance.com/fapi/v1/ticker/price', {}, 8000);
    const data = await response.json();

    const prices = {};
    for (const item of data) {
      if (symbols.includes(item.symbol)) {
        prices[item.symbol] = parseFloat(item.price);
      }
    }
    return prices;
  } catch (error) {
    console.error('Failed to fetch Binance prices:', error.message);
    return null;
  }
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
  const resultText = isTP ? 'TP HIT' : 'SL HIT';
  const pnlSign = pnl >= 0 ? '+' : '';

  return `${emoji} <b>${portfolioType.toUpperCase()} PORTFOLIO - ${resultText}</b>

${resultEmoji} <b>${trade.symbol}</b> ${trade.direction}

📊 Entry: $${trade.entry.toFixed(4)}
📊 Exit: $${exitPrice.toFixed(4)}
${isTP ? '🎯' : '🛑'} ${isTP ? 'Take Profit' : 'Stop Loss'}: $${(isTP ? trade.tp : trade.sl).toFixed(4)}

💰 PnL: <b>${pnlSign}$${pnl.toFixed(2)}</b>
📈 Position Size: $${trade.size.toFixed(2)}

⏰ Closed by: Backend Monitor
🤖 Auto-managed 24/7`;
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

      // --- TP/SL Check (uses potentially updated SL) ---
      let shouldClose = false;
      let isTP = false;
      const currentSL = tradeInPortfolio.sl;

      if (isLong) {
        if (currentPrice >= trade.tp) {
          shouldClose = true;
          isTP = true;
        } else if (currentPrice <= currentSL) {
          shouldClose = true;
          isTP = false;
        }
      } else {
        if (currentPrice <= trade.tp) {
          shouldClose = true;
          isTP = true;
        } else if (currentPrice >= currentSL) {
          shouldClose = true;
          isTP = false;
        }
      }

      if (shouldClose) {
        const exitPrice = isTP ? trade.tp : currentSL;
        const priceDiff = isLong
          ? exitPrice - trade.entry
          : trade.entry - exitPrice;
        const pnl = (priceDiff / trade.entry) * trade.size;

        tradeInPortfolio.status = 'closed';
        tradeInPortfolio.exitPrice = exitPrice;
        tradeInPortfolio.pnl = pnl;
        tradeInPortfolio.closeTimestamp = Date.now();
        tradeInPortfolio.closedBy = 'backend-monitor';

        portfolio.balance += pnl;
        portfolio.equityHistory.push({
          time: Date.now(),
          value: portfolio.balance
        });

        closedTrades.push({
          trade: tradeInPortfolio,
          portfolioType: trade.portfolioType,
          exitPrice,
          pnl,
          isTP
        });

        const closeType = isTP ? '🎯 TP' : (tradeInPortfolio.isTrailing ? '🔄 TRAIL SL' : '🛑 SL');
        console.log(`${closeType} Closed ${trade.symbol} ${trade.direction} | PnL: $${pnl.toFixed(2)}`);
      }
    }

    // 5. Save updated portfolio data if trades were closed OR stop-losses adjusted
    if (closedTrades.length > 0 || slAdjusted) {
      // Recalculate stats
      portfolioData.silver.stats = calculateStats(portfolioData.silver);
      portfolioData.gold.stats = calculateStats(portfolioData.gold);
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

      // 6. Send Telegram notifications for each closed trade
      for (const { trade, portfolioType, exitPrice, pnl, isTP } of closedTrades) {
        const message = formatTradeCloseMessage(trade, portfolioType, exitPrice, pnl, isTP);
        await sendTelegramMessage(message);
      }
    }

    const duration = Date.now() - startTime;
    console.log(`✅ Position Monitor complete in ${duration}ms | Checked: ${openTrades.length} | Closed: ${closedTrades.length} | SL adjusted: ${slAdjusted}`);

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
