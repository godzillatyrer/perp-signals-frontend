// AI Position Evaluator - Re-evaluates open trades every 30 minutes
// Uses a single Claude call to assess all open positions against current market conditions
// Can recommend: HOLD, TIGHTEN (move SL closer), or EXIT (close early)

import { Redis } from '@upstash/redis';

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

// ============================================
// MARKET DATA & INDICATORS
// ============================================

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

async function getCurrentPrices(symbols) {
  // Try Binance Futures first
  try {
    const response = await fetchWithTimeout('https://fapi.binance.com/fapi/v1/ticker/price', {}, 6000);
    const data = await response.json();
    if (Array.isArray(data)) {
      const prices = {};
      for (const item of data) {
        if (symbols.includes(item.symbol)) {
          prices[item.symbol] = parseFloat(item.price);
        }
      }
      if (Object.keys(prices).length > 0) return prices;
    }
  } catch (error) {
    console.log('Binance prices failed:', error.message, '— trying Bybit...');
  }

  // Bybit fallback
  try {
    const response = await fetchWithTimeout('https://api.bybit.com/v5/market/tickers?category=linear', {}, 6000);
    const data = await response.json();
    if (data?.result?.list) {
      const prices = {};
      for (const item of data.result.list) {
        if (symbols.includes(item.symbol)) {
          prices[item.symbol] = parseFloat(item.lastPrice);
        }
      }
      if (Object.keys(prices).length > 0) return prices;
    }
  } catch (error) {
    console.error('Bybit prices also failed:', error.message);
  }
  // Original error path
  console.error('Failed to fetch prices from all sources');
    return null;
  }
}

async function fetchCandlesticks(symbol, interval = '1h', limit = 100) {
  // Try Binance Futures first
  try {
    const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    const response = await fetchWithTimeout(url, {}, 6000);
    const data = await response.json();
    if (Array.isArray(data) && data.length > 0) {
      return data.map(k => ({
        time: k[0],
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5])
      }));
    }
  } catch (e) {
    console.log(`Binance candles failed for ${symbol}: ${e.message}, trying Bybit...`);
  }

  // Bybit fallback
  try {
    const intervalMap = { '1h': '60', '4h': '240', '1d': 'D', '15m': '15' };
    const bybitInterval = intervalMap[interval] || '60';
    const url = `https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol}&interval=${bybitInterval}&limit=${limit}`;
    const response = await fetchWithTimeout(url, {}, 6000);
    const data = await response.json();
    if (data?.result?.list?.length > 0) {
      return data.result.list.reverse().map(k => ({
        time: parseInt(k[0]),
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5])
      }));
    }
  } catch (e) {
    console.log(`Bybit candles also failed for ${symbol}: ${e.message}`);
  }

  return [];
}

function calculateRSI(closes, period = 14) {
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (change > 0 ? change : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (change < 0 ? -change : 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - (100 / (1 + avgGain / avgLoss));
}

function calculateEMA(data, period) {
  if (data.length < period) return data[data.length - 1] || 0;
  const k = 2 / (period + 1);
  let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < data.length; i++) {
    ema = data[i] * k + ema * (1 - k);
  }
  return ema;
}

function calculateMACD(closes) {
  if (closes.length < 26) return { histogram: 0 };
  const ema12 = calculateEMA(closes, 12);
  const ema26 = calculateEMA(closes, 26);
  const macd = ema12 - ema26;
  const macdLine = [];
  for (let i = 26; i <= closes.length; i++) {
    macdLine.push(calculateEMA(closes.slice(0, i), 12) - calculateEMA(closes.slice(0, i), 26));
  }
  const signal = macdLine.length >= 9 ? calculateEMA(macdLine, 9) : macd;
  return { macd, signal, histogram: macd - signal };
}

async function getQuickIndicators(symbol) {
  const candles = await fetchCandlesticks(symbol, '1h', 100);
  if (candles.length < 30) return null;

  const closes = candles.map(c => c.close);
  const currentPrice = closes[closes.length - 1];
  const rsi = calculateRSI(closes);
  const ema20 = calculateEMA(closes, 20);
  const ema50 = calculateEMA(closes, 50);
  const macd = calculateMACD(closes);

  // Volume trend
  const avgVol = candles.slice(-20).reduce((s, c) => s + c.volume, 0) / 20;
  const recentVol = candles.slice(-5).reduce((s, c) => s + c.volume, 0) / 5;
  const volumeTrend = recentVol > avgVol * 1.2 ? 'INCREASING' :
                      recentVol < avgVol * 0.8 ? 'DECREASING' : 'STABLE';

  // Price change last 4 hours
  const price4hAgo = candles.length >= 4 ? candles[candles.length - 4].close : currentPrice;
  const change4h = ((currentPrice - price4hAgo) / price4hAgo * 100).toFixed(2);

  // Trend
  let trend = 'NEUTRAL';
  if (currentPrice > ema20 && ema20 > ema50) trend = 'STRONG UPTREND';
  else if (currentPrice > ema20) trend = 'WEAK UPTREND';
  else if (currentPrice < ema20 && ema20 < ema50) trend = 'STRONG DOWNTREND';
  else if (currentPrice < ema20) trend = 'WEAK DOWNTREND';

  return {
    price: currentPrice,
    rsi: Math.round(rsi),
    ema20: ema20.toFixed(4),
    ema50: ema50.toFixed(4),
    macdHistogram: macd.histogram > 0 ? 'BULLISH' : 'BEARISH',
    volumeTrend,
    trend,
    change4h: `${change4h}%`
  };
}

// ============================================
// TELEGRAM
// ============================================

async function sendTelegramMessage(message) {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) return false;
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
    console.error('Telegram error:', error.message);
    return false;
  }
}

// ============================================
// AI EVALUATION
// ============================================

function buildEvaluationPrompt(positions) {
  let prompt = `You are an expert crypto futures trader. Evaluate these open positions and recommend an action for each.\n\n`;
  prompt += `For each position, respond with one of:\n`;
  prompt += `- HOLD: Keep position open, conditions still favorable\n`;
  prompt += `- TIGHTEN: Move stop-loss closer to lock in more profit (specify new SL price)\n`;
  prompt += `- EXIT: Close position immediately (market conditions have worsened)\n\n`;
  prompt += `Current time: ${new Date().toUTCString()}\n\n`;

  for (const pos of positions) {
    const pnlPct = ((pos.currentPrice - pos.entry) / pos.entry * (pos.direction === 'LONG' ? 1 : -1) * 100).toFixed(2);
    const hoursOpen = ((Date.now() - pos.timestamp) / 3600000).toFixed(1);

    prompt += `---\n`;
    prompt += `POSITION: ${pos.symbol} ${pos.direction}\n`;
    prompt += `Entry: $${pos.entry} | Current: $${pos.currentPrice} | PnL: ${pnlPct}%\n`;
    prompt += `TP: $${pos.tp} | SL: $${pos.sl}${pos.originalSl ? ` (original: $${pos.originalSl})` : ''}\n`;
    prompt += `Open for: ${hoursOpen} hours | Leverage: ${pos.leverage}x\n`;
    prompt += `Consensus: ${pos.isGoldConsensus ? 'GOLD (3/3)' : 'SILVER (2/3)'}\n`;

    if (pos.indicators) {
      prompt += `Indicators: RSI=${pos.indicators.rsi}, Trend=${pos.indicators.trend}, MACD=${pos.indicators.macdHistogram}, Vol=${pos.indicators.volumeTrend}, 4h Change=${pos.indicators.change4h}\n`;
    }
    prompt += `\n`;
  }

  prompt += `\nRespond in JSON format ONLY:\n`;
  prompt += `{"evaluations": [{"symbol": "BTCUSDT", "action": "HOLD|TIGHTEN|EXIT", "newSl": 12345.00, "reason": "brief reason"}]}\n`;
  prompt += `Only include newSl for TIGHTEN actions. Keep reasons under 20 words.`;

  return prompt;
}

async function evaluateWithAI(prompt) {
  // Use Claude for evaluation (most reliable for structured analysis)
  if (!process.env.CLAUDE_API_KEY) {
    console.log('Claude API key not configured, skipping AI evaluation');
    return null;
  }

  try {
    const response = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }]
      })
    }, 30000);

    const data = await response.json();
    if (data.content && data.content[0]) {
      const text = data.content[0].text;
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    }
  } catch (error) {
    console.error('AI evaluation error:', error.message);
  }
  return null;
}

// ============================================
// PORTFOLIO HELPERS
// ============================================

function getDefaultPortfolio(type) {
  return {
    type,
    balance: 5000,
    startBalance: 5000,
    trades: [],
    equityHistory: [{ time: Date.now(), value: 5000 }],
    stats: { totalTrades: 0, winningTrades: 0, losingTrades: 0, totalPnL: 0, maxDrawdown: 0, peakEquity: 5000 },
    lastUpdated: Date.now()
  };
}

function getDefaultData() {
  return {
    silver: getDefaultPortfolio('silver'),
    gold: getDefaultPortfolio('gold'),
    config: {},
    lastUpdated: Date.now()
  };
}

function calculateStats(portfolio) {
  const closedTrades = portfolio.trades.filter(t => t.status === 'closed');
  const wins = closedTrades.filter(t => t.pnl > 0);
  let peak = portfolio.equityHistory[0]?.value || portfolio.startBalance;
  let maxDd = 0;
  for (const point of portfolio.equityHistory) {
    if (point.value > peak) peak = point.value;
    const dd = (peak - point.value) / peak * 100;
    if (dd > maxDd) maxDd = dd;
  }
  return {
    totalTrades: closedTrades.length,
    winningTrades: wins.length,
    losingTrades: closedTrades.length - wins.length,
    totalPnL: closedTrades.reduce((sum, t) => sum + t.pnl, 0),
    maxDrawdown: maxDd,
    peakEquity: peak,
    winRate: closedTrades.length > 0 ? (wins.length / closedTrades.length * 100) : 0
  };
}

// ============================================
// MAIN HANDLER
// ============================================

export default async function handler(request, response) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (request.method === 'OPTIONS') {
    return response.status(200).end();
  }

  const startTime = Date.now();
  console.log('🧠 AI Position Evaluator starting...');

  const r = getRedis();
  if (!r) {
    return response.status(500).json({ success: false, error: 'Redis not configured' });
  }

  try {
    // 1. Load portfolio data
    let portfolioData;
    try {
      const data = await r.get(PORTFOLIO_KEY);
      if (data) {
        portfolioData = typeof data === 'string' ? JSON.parse(data) : data;
        const defaults = getDefaultData();
        portfolioData = {
          silver: { ...defaults.silver, ...portfolioData.silver },
          gold: { ...defaults.gold, ...portfolioData.gold },
          config: portfolioData.config || defaults.config,
          lastUpdated: portfolioData.lastUpdated || Date.now()
        };
      } else {
        portfolioData = getDefaultData();
      }
    } catch (e) {
      console.error('Redis read error:', e.message);
      portfolioData = getDefaultData();
    }

    // 2. Collect open trades
    const openTrades = [];
    for (const portfolioType of ['silver', 'gold']) {
      const portfolio = portfolioData[portfolioType];
      if (!portfolio.trades) continue;
      for (const trade of portfolio.trades) {
        if (trade.status === 'open') {
          openTrades.push({ ...trade, portfolioType });
        }
      }
    }

    if (openTrades.length === 0) {
      console.log('📭 No open trades to evaluate');
      return response.status(200).json({
        success: true,
        message: 'No open trades',
        duration: Date.now() - startTime
      });
    }

    console.log(`📊 Evaluating ${openTrades.length} open trades`);

    // 3. Get current prices and indicators
    const symbols = [...new Set(openTrades.map(t => t.symbol))];
    const prices = await getCurrentPrices(symbols);
    if (!prices) {
      return response.status(500).json({ success: false, error: 'Failed to fetch prices' });
    }

    // Fetch indicators for each symbol (in parallel)
    const indicatorPromises = symbols.map(async s => {
      const ind = await getQuickIndicators(s);
      return [s, ind];
    });
    const indicatorResults = await Promise.all(indicatorPromises);
    const indicators = Object.fromEntries(indicatorResults);

    // 4. Build positions list with current data
    const positions = openTrades.map(trade => ({
      ...trade,
      currentPrice: prices[trade.symbol] || trade.entry,
      indicators: indicators[trade.symbol] || null
    }));

    // 5. Call AI for evaluation
    const prompt = buildEvaluationPrompt(positions);
    console.log('🤖 Calling Claude for position evaluation...');
    const aiResult = await evaluateWithAI(prompt);

    if (!aiResult || !aiResult.evaluations) {
      console.log('⚠️ AI evaluation returned no results');
      return response.status(200).json({
        success: true,
        message: 'AI evaluation failed, no changes made',
        tradesChecked: openTrades.length,
        duration: Date.now() - startTime
      });
    }

    console.log(`🧠 AI evaluated ${aiResult.evaluations.length} positions`);

    // 6. Process AI recommendations
    let exitCount = 0;
    let tightenCount = 0;
    let holdCount = 0;
    const actions = [];
    let dataChanged = false;

    for (const evaluation of aiResult.evaluations) {
      const trade = openTrades.find(t => t.symbol === evaluation.symbol);
      if (!trade) continue;

      const portfolio = portfolioData[trade.portfolioType];
      const tradeInPortfolio = portfolio.trades.find(t => t.id === trade.id);
      if (!tradeInPortfolio) continue;

      const currentPrice = prices[trade.symbol] || trade.entry;
      const action = (evaluation.action || '').toUpperCase();

      if (action === 'EXIT') {
        // Close position early
        const isLong = trade.direction === 'LONG';
        const priceDiff = isLong ? currentPrice - trade.entry : trade.entry - currentPrice;
        const pnl = (priceDiff / trade.entry) * trade.size;

        tradeInPortfolio.status = 'closed';
        tradeInPortfolio.exitPrice = currentPrice;
        tradeInPortfolio.pnl = pnl;
        tradeInPortfolio.closeTimestamp = Date.now();
        tradeInPortfolio.closedBy = 'ai-evaluator';
        tradeInPortfolio.exitReason = evaluation.reason;

        portfolio.balance += pnl;
        portfolio.equityHistory.push({ time: Date.now(), value: portfolio.balance });

        exitCount++;
        dataChanged = true;
        actions.push({ symbol: trade.symbol, action: 'EXIT', pnl, reason: evaluation.reason });

        const emoji = trade.isGoldConsensus ? '🥇' : '🥈';
        const pnlSign = pnl >= 0 ? '+' : '';
        const resultEmoji = pnl >= 0 ? '✅' : '⚠️';
        await sendTelegramMessage(
          `${emoji} <b>AI EARLY EXIT</b> — ${trade.symbol} ${trade.direction}\n\n` +
          `${resultEmoji} PnL: <b>${pnlSign}$${pnl.toFixed(2)}</b>\n` +
          `📊 Entry: $${trade.entry.toFixed(4)} → Exit: $${currentPrice.toFixed(4)}\n\n` +
          `🧠 Reason: ${evaluation.reason}\n\n` +
          `⏰ Closed by AI Evaluator`
        );

        console.log(`🚪 EXIT ${trade.symbol}: ${evaluation.reason} | PnL: $${pnl.toFixed(2)}`);

      } else if (action === 'TIGHTEN' && evaluation.newSl) {
        const newSl = parseFloat(evaluation.newSl);
        const isLong = trade.direction === 'LONG';

        // Validate: new SL must be tighter (closer to current price, but between entry and current price)
        const isValid = isLong
          ? (newSl > tradeInPortfolio.sl && newSl < currentPrice)
          : (newSl < tradeInPortfolio.sl && newSl > currentPrice);

        if (isValid) {
          if (!tradeInPortfolio.originalSl) {
            tradeInPortfolio.originalSl = tradeInPortfolio.sl;
          }
          const oldSl = tradeInPortfolio.sl;
          tradeInPortfolio.sl = newSl;
          tradeInPortfolio.slAdjustedAt = Date.now();
          tradeInPortfolio.slAdjustedBy = 'ai-evaluator';

          tightenCount++;
          dataChanged = true;
          actions.push({ symbol: trade.symbol, action: 'TIGHTEN', oldSl, newSl, reason: evaluation.reason });

          const emoji = trade.isGoldConsensus ? '🥇' : '🥈';
          await sendTelegramMessage(
            `${emoji} <b>AI TIGHTEN SL</b> — ${trade.symbol} ${trade.direction}\n\n` +
            `🛑 SL: $${oldSl.toFixed(4)} → <b>$${newSl.toFixed(4)}</b>\n` +
            `💰 Current: $${currentPrice.toFixed(4)}\n\n` +
            `🧠 Reason: ${evaluation.reason}`
          );

          console.log(`🔧 TIGHTEN ${trade.symbol}: SL $${oldSl.toFixed(4)} → $${newSl.toFixed(4)} | ${evaluation.reason}`);
        } else {
          console.log(`⚠️ Invalid TIGHTEN for ${trade.symbol}: newSl=$${newSl} not valid`);
          holdCount++;
        }

      } else {
        holdCount++;
        actions.push({ symbol: trade.symbol, action: 'HOLD', reason: evaluation.reason });
        console.log(`✅ HOLD ${trade.symbol}: ${evaluation.reason}`);
      }
    }

    // 7. Save if anything changed
    if (dataChanged) {
      portfolioData.silver.stats = calculateStats(portfolioData.silver);
      portfolioData.gold.stats = calculateStats(portfolioData.gold);
      portfolioData.lastUpdated = Date.now();

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
    }

    const duration = Date.now() - startTime;
    console.log(`✅ AI Evaluation complete in ${duration}ms | Hold: ${holdCount} | Tighten: ${tightenCount} | Exit: ${exitCount}`);

    return response.status(200).json({
      success: true,
      tradesChecked: openTrades.length,
      hold: holdCount,
      tighten: tightenCount,
      exit: exitCount,
      actions,
      duration
    });

  } catch (error) {
    console.error('AI Evaluator error:', error);
    return response.status(500).json({ success: false, error: error.message });
  }
}
