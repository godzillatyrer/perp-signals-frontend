// Vercel Serverless Function for AI Signal Scanning
// Runs on cron schedule and sends Telegram alerts
//
// Uses Upstash Redis for persistent cooldown tracking across invocations
// Integrates Discord community calls for enhanced AI context

import { Redis } from '@upstash/redis';
import { getRecentCalls, formatCallsForAIContext } from './discord.js';

const CONFIG = {
  // Minimum confidence for alerts - STRICT (raised to 85%)
  ALERT_CONFIDENCE: 85,
  // Minimum TP percentages by market cap
  MIN_TP_PERCENT_BTC_ETH: 3,
  MIN_TP_PERCENT_LARGE_CAP: 5,
  MIN_TP_PERCENT_MID_CAP: 7,
  // Top coins to analyze
  TOP_COINS: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'LINKUSDT', 'DOTUSDT'],
  // Signal cooldown in hours - 12 hours per coin
  SIGNAL_COOLDOWN_HOURS: 12,
  // Price move % that overrides cooldown - INCREASED to 10%
  PRICE_MOVE_OVERRIDE_PERCENT: 10,
  // Minimum price change to even consider a signal (blocks tiny entry updates)
  MIN_PRICE_CHANGE_PERCENT: 2,
  // Correlation groups (don't send multiple signals from same group)
  CORRELATION_GROUPS: {
    'LAYER1': ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'AVAXUSDT', 'DOTUSDT'],
    'MEME': ['DOGEUSDT'],
    'DEFI': ['LINKUSDT', 'ADAUSDT'],
    'EXCHANGE': ['BNBUSDT']
  },
  // Max signals per correlation group per scan
  MAX_SIGNALS_PER_GROUP: 1,
  MIN_RISK_REWARD: 2,
  MIN_ATR_PERCENT: 0.4,
  MAX_ENTRY_WIGGLE_PERCENT: 2,
  MAX_SL_WIGGLE_PERCENT: 3,
  MAX_TP_WIGGLE_PERCENT: 5,
  // GOLD CONSENSUS ONLY - require all 3 AIs to agree
  REQUIRE_GOLD_CONSENSUS: true
};

const ENTRY_TRIGGERS = ['BREAKOUT', 'PULLBACK', 'REVERSAL', 'MOMENTUM'];

function isWithinPercent(a, b, percent) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  const diff = Math.abs(a - b) / Math.max(a, b) * 100;
  return diff <= percent;
}

function normalizeEntryTrigger(trigger) {
  if (!trigger || typeof trigger !== 'string') return null;
  const normalized = trigger.trim().toUpperCase();
  return ENTRY_TRIGGERS.includes(normalized) ? normalized : null;
}

// ============================================
// ECONOMIC CALENDAR - Major Events to Avoid
// ============================================

const MAJOR_EVENTS_2025 = [
  // FOMC Meetings (Federal Reserve)
  { date: '2025-01-29', name: 'FOMC Meeting', type: 'FOMC' },
  { date: '2025-03-19', name: 'FOMC Meeting', type: 'FOMC' },
  { date: '2025-05-07', name: 'FOMC Meeting', type: 'FOMC' },
  { date: '2025-06-18', name: 'FOMC Meeting', type: 'FOMC' },
  { date: '2025-07-30', name: 'FOMC Meeting', type: 'FOMC' },
  { date: '2025-09-17', name: 'FOMC Meeting', type: 'FOMC' },
  { date: '2025-11-05', name: 'FOMC Meeting', type: 'FOMC' },
  { date: '2025-12-17', name: 'FOMC Meeting', type: 'FOMC' },
  // CPI Releases (usually 8:30 AM ET)
  { date: '2025-01-15', name: 'CPI Release', type: 'CPI' },
  { date: '2025-02-12', name: 'CPI Release', type: 'CPI' },
  { date: '2025-03-12', name: 'CPI Release', type: 'CPI' },
  { date: '2025-04-10', name: 'CPI Release', type: 'CPI' },
  { date: '2025-05-13', name: 'CPI Release', type: 'CPI' },
  { date: '2025-06-11', name: 'CPI Release', type: 'CPI' },
  { date: '2025-07-11', name: 'CPI Release', type: 'CPI' },
  { date: '2025-08-13', name: 'CPI Release', type: 'CPI' },
  { date: '2025-09-10', name: 'CPI Release', type: 'CPI' },
  { date: '2025-10-10', name: 'CPI Release', type: 'CPI' },
  { date: '2025-11-13', name: 'CPI Release', type: 'CPI' },
  { date: '2025-12-10', name: 'CPI Release', type: 'CPI' },
  // NFP (Non-Farm Payrolls) - First Friday of each month
  { date: '2025-01-10', name: 'NFP Release', type: 'NFP' },
  { date: '2025-02-07', name: 'NFP Release', type: 'NFP' },
  { date: '2025-03-07', name: 'NFP Release', type: 'NFP' },
  { date: '2025-04-04', name: 'NFP Release', type: 'NFP' },
  { date: '2025-05-02', name: 'NFP Release', type: 'NFP' },
  { date: '2025-06-06', name: 'NFP Release', type: 'NFP' },
  { date: '2025-07-03', name: 'NFP Release', type: 'NFP' },
  { date: '2025-08-01', name: 'NFP Release', type: 'NFP' },
  { date: '2025-09-05', name: 'NFP Release', type: 'NFP' },
  { date: '2025-10-03', name: 'NFP Release', type: 'NFP' },
  { date: '2025-11-07', name: 'NFP Release', type: 'NFP' },
  { date: '2025-12-05', name: 'NFP Release', type: 'NFP' },
  // 2026 events
  { date: '2026-01-14', name: 'CPI Release', type: 'CPI' },
  { date: '2026-01-28', name: 'FOMC Meeting', type: 'FOMC' },
  { date: '2026-01-09', name: 'NFP Release', type: 'NFP' },
];

// Check if today is a major economic event day
function isMajorEventDay() {
  const today = new Date().toISOString().split('T')[0];
  const event = MAJOR_EVENTS_2025.find(e => e.date === today);
  if (event) {
    console.log(`⚠️ Major event today: ${event.name}`);
    return event;
  }
  return null;
}

// ============================================
// SIGNAL TRACKING (Persistent via Upstash Redis)
// ============================================
// Stores: { direction, entry, timestamp } for each symbol
// Cooldown: 24 hours, unless direction flips or price moves 10%+

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

async function getLastSignal(symbol) {
  const r = getRedis();
  if (!r) return null;

  try {
    const data = await r.get(`signal:${symbol}`);
    return data;
  } catch (e) {
    console.log(`Redis get error for ${symbol}:`, e.message);
    return null;
  }
}

async function saveSignal(symbol, direction, entry) {
  const r = getRedis();
  if (!r) {
    console.log(`📝 Redis not configured - signal not persisted`);
    return;
  }

  try {
    const data = {
      direction,
      entry,
      timestamp: Date.now()
    };
    // Store with 48-hour expiry (auto-cleanup)
    await r.set(`signal:${symbol}`, JSON.stringify(data), { ex: 48 * 60 * 60 });
    console.log(`📝 Saved ${symbol} ${direction} @ ${entry} to Redis`);
  } catch (e) {
    console.log(`Redis save error for ${symbol}:`, e.message);
  }
}

async function isSignalOnCooldown(symbol, direction, currentPrice) {
  const lastSignalRaw = await getLastSignal(symbol);
  if (!lastSignalRaw) {
    console.log(`✅ ${symbol}: No previous signal found - OK to send`);
    return false;
  }

  let lastSignal;
  try {
    lastSignal = typeof lastSignalRaw === 'string' ? JSON.parse(lastSignalRaw) : lastSignalRaw;
  } catch (e) {
    console.log(`✅ ${symbol}: Could not parse last signal - OK to send`);
    return false;
  }

  const hoursSinceLast = (Date.now() - lastSignal.timestamp) / (1000 * 60 * 60);

  // Cooldown expired
  if (hoursSinceLast >= CONFIG.SIGNAL_COOLDOWN_HOURS) {
    console.log(`✅ ${symbol}: Cooldown expired (${hoursSinceLast.toFixed(1)}h ago) - OK to send`);
    return false;
  }

  // Direction flipped (LONG -> SHORT or vice versa)
  if (lastSignal.direction && lastSignal.direction !== direction) {
    console.log(`🔄 ${symbol}: Direction flipped ${lastSignal.direction} → ${direction} - OK to send`);
    return false;
  }

  // Price moved significantly (10%+)
  if (lastSignal.entry && currentPrice) {
    const priceChange = Math.abs((currentPrice - lastSignal.entry) / lastSignal.entry * 100);
    if (priceChange >= CONFIG.PRICE_MOVE_OVERRIDE_PERCENT) {
      console.log(`📈 ${symbol}: Price moved ${priceChange.toFixed(1)}% - OK to send`);
      return false;
    }

    // Price barely moved - definitely on cooldown
    if (priceChange < CONFIG.MIN_PRICE_CHANGE_PERCENT) {
      console.log(`🚫 ${symbol}: Price only moved ${priceChange.toFixed(1)}% (< ${CONFIG.MIN_PRICE_CHANGE_PERCENT}%) - BLOCKED`);
      return true;
    }
  }

  // Still on cooldown
  const hoursRemaining = (CONFIG.SIGNAL_COOLDOWN_HOURS - hoursSinceLast).toFixed(1);
  console.log(`⏳ ${symbol}: On cooldown (${hoursRemaining}h remaining) - BLOCKED`);
  return true;
}

// ============================================
// CORRELATION CHECK
// ============================================

function getCorrelationGroup(symbol) {
  for (const [group, symbols] of Object.entries(CONFIG.CORRELATION_GROUPS)) {
    if (symbols.includes(symbol)) {
      return group;
    }
  }
  return symbol; // If not in a group, use symbol as its own group
}

function filterCorrelatedSignals(signals) {
  const groupCounts = {};
  const filtered = [];

  // Sort by confidence (highest first)
  const sorted = [...signals].sort((a, b) => b.confidence - a.confidence);

  for (const signal of sorted) {
    const group = getCorrelationGroup(signal.symbol);
    const groupKey = `${group}_${signal.direction}`;

    if (!groupCounts[groupKey]) {
      groupCounts[groupKey] = 0;
    }

    if (groupCounts[groupKey] < CONFIG.MAX_SIGNALS_PER_GROUP) {
      filtered.push(signal);
      groupCounts[groupKey]++;
    } else {
      console.log(`🔗 Filtered ${signal.symbol} ${signal.direction} - Already have signal from ${group} group`);
    }
  }

  return filtered;
}

// ============================================
// TECHNICAL INDICATORS
// ============================================

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
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
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
  if (closes.length < 26) return { macd: 0, signal: 0, histogram: 0 };

  const ema12 = calculateEMA(closes, 12);
  const ema26 = calculateEMA(closes, 26);
  const macd = ema12 - ema26;

  const macdLine = [];
  for (let i = 26; i <= closes.length; i++) {
    const e12 = calculateEMA(closes.slice(0, i), 12);
    const e26 = calculateEMA(closes.slice(0, i), 26);
    macdLine.push(e12 - e26);
  }

  const signal = macdLine.length >= 9 ? calculateEMA(macdLine, 9) : macd;
  return { macd, signal, histogram: macd - signal };
}

function calculateBollingerBands(closes, period = 20, stdDev = 2) {
  if (closes.length < period) return { upper: 0, middle: 0, lower: 0 };

  const slice = closes.slice(-period);
  const middle = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((sum, val) => sum + Math.pow(val - middle, 2), 0) / period;
  const std = Math.sqrt(variance);

  return { upper: middle + std * stdDev, middle, lower: middle - std * stdDev };
}

function calculateATR(candles, period = 14) {
  if (candles.length < period + 1) return 0;

  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trs.push(tr);
  }

  return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
}

// ADX - Average Directional Index (Trend Strength)
// ADX > 25 = Strong trend, ADX < 20 = Weak/No trend
function calculateADX(candles, period = 14) {
  if (candles.length < period * 2) return { adx: 0, plusDI: 0, minusDI: 0, trend: 'WEAK' };

  const plusDMs = [];
  const minusDMs = [];
  const trs = [];

  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevHigh = candles[i - 1].high;
    const prevLow = candles[i - 1].low;
    const prevClose = candles[i - 1].close;

    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trs.push(tr);

    const plusDM = high - prevHigh > prevLow - low ? Math.max(high - prevHigh, 0) : 0;
    const minusDM = prevLow - low > high - prevHigh ? Math.max(prevLow - low, 0) : 0;
    plusDMs.push(plusDM);
    minusDMs.push(minusDM);
  }

  const smoothedTR = trs.slice(-period).reduce((a, b) => a + b, 0);
  const smoothedPlusDM = plusDMs.slice(-period).reduce((a, b) => a + b, 0);
  const smoothedMinusDM = minusDMs.slice(-period).reduce((a, b) => a + b, 0);

  const plusDI = smoothedTR > 0 ? (smoothedPlusDM / smoothedTR) * 100 : 0;
  const minusDI = smoothedTR > 0 ? (smoothedMinusDM / smoothedTR) * 100 : 0;

  const diDiff = Math.abs(plusDI - minusDI);
  const diSum = plusDI + minusDI;
  const dx = diSum > 0 ? (diDiff / diSum) * 100 : 0;
  const adx = dx;

  let trend = 'WEAK';
  if (adx >= 50) trend = 'VERY_STRONG';
  else if (adx >= 25) trend = 'STRONG';
  else if (adx >= 20) trend = 'MODERATE';

  return { adx: Math.round(adx * 10) / 10, plusDI: Math.round(plusDI * 10) / 10, minusDI: Math.round(minusDI * 10) / 10, trend };
}

// Stochastic RSI - Better overbought/oversold than regular RSI
function calculateStochRSI(closes, rsiPeriod = 14, stochPeriod = 14) {
  if (closes.length < rsiPeriod + stochPeriod) return { k: 50, d: 50, signal: 'NEUTRAL' };

  const rsiValues = [];
  for (let i = rsiPeriod; i <= closes.length; i++) {
    const slice = closes.slice(i - rsiPeriod - 1, i);
    let gains = 0, losses = 0;
    for (let j = 1; j < slice.length; j++) {
      const change = slice[j] - slice[j - 1];
      if (change > 0) gains += change;
      else losses -= change;
    }
    const avgGain = gains / rsiPeriod;
    const avgLoss = losses / rsiPeriod;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsiValues.push(100 - (100 / (1 + rs)));
  }

  if (rsiValues.length < stochPeriod) return { k: 50, d: 50, signal: 'NEUTRAL' };

  const recentRSI = rsiValues.slice(-stochPeriod);
  const minRSI = Math.min(...recentRSI);
  const maxRSI = Math.max(...recentRSI);
  const currentRSI = recentRSI[recentRSI.length - 1];

  const stochRSI = maxRSI - minRSI > 0 ? ((currentRSI - minRSI) / (maxRSI - minRSI)) * 100 : 50;
  const k = Math.round(stochRSI * 10) / 10;
  const d = k;

  let signal = 'NEUTRAL';
  if (k <= 20) signal = 'OVERSOLD';
  else if (k >= 80) signal = 'OVERBOUGHT';
  else if (k > 50) signal = 'BULLISH';
  else if (k < 50) signal = 'BEARISH';

  return { k, d, signal };
}

// Supertrend - Clear trend direction indicator
function calculateSupertrend(candles, period = 10, multiplier = 3) {
  if (candles.length < period + 1) return { supertrend: 0, direction: 'NEUTRAL', signal: 'HOLD' };

  const atr = calculateATR(candles, period);
  const lastCandle = candles[candles.length - 1];
  const hl2 = (lastCandle.high + lastCandle.low) / 2;

  const upperBand = hl2 + (multiplier * atr);
  const lowerBand = hl2 - (multiplier * atr);

  const close = lastCandle.close;
  const prevClose = candles[candles.length - 2]?.close || close;

  let direction = 'UP';
  let supertrend = lowerBand;

  if (close < lowerBand) {
    direction = 'DOWN';
    supertrend = upperBand;
  } else if (close > upperBand) {
    direction = 'UP';
    supertrend = lowerBand;
  } else {
    direction = prevClose > hl2 ? 'UP' : 'DOWN';
    supertrend = direction === 'UP' ? lowerBand : upperBand;
  }

  let signal = 'HOLD';
  if (direction === 'UP' && close > supertrend) signal = 'BUY';
  else if (direction === 'DOWN' && close < supertrend) signal = 'SELL';

  return { supertrend: Math.round(supertrend * 100) / 100, direction, signal };
}

// Fibonacci Retracement Levels
function calculateFibonacciLevels(candles, lookback = 50) {
  if (candles.length < lookback) return null;

  const recent = candles.slice(-lookback);
  let swingHigh = -Infinity, swingLow = Infinity;
  let swingHighIdx = 0, swingLowIdx = 0;

  for (let i = 0; i < recent.length; i++) {
    if (recent[i].high > swingHigh) { swingHigh = recent[i].high; swingHighIdx = i; }
    if (recent[i].low < swingLow) { swingLow = recent[i].low; swingLowIdx = i; }
  }

  const range = swingHigh - swingLow;
  const currentPrice = recent[recent.length - 1].close;
  const isUptrend = swingLowIdx < swingHighIdx;

  let levels;
  if (isUptrend) {
    levels = {
      '0%': swingHigh,
      '23.6%': swingHigh - range * 0.236,
      '38.2%': swingHigh - range * 0.382,
      '50%': swingHigh - range * 0.5,
      '61.8%': swingHigh - range * 0.618,
      '78.6%': swingHigh - range * 0.786,
      '100%': swingLow
    };
  } else {
    levels = {
      '0%': swingLow,
      '23.6%': swingLow + range * 0.236,
      '38.2%': swingLow + range * 0.382,
      '50%': swingLow + range * 0.5,
      '61.8%': swingLow + range * 0.618,
      '78.6%': swingLow + range * 0.786,
      '100%': swingHigh
    };
  }

  // Find nearest level
  const allLevels = Object.entries(levels).map(([name, price]) => ({ name, price }));
  let nearestLevel = allLevels[0];
  let minDist = Math.abs(currentPrice - allLevels[0].price);

  for (const level of allLevels) {
    const dist = Math.abs(currentPrice - level.price);
    if (dist < minDist) { minDist = dist; nearestLevel = level; }
  }

  const atKeyLevel = (minDist / currentPrice * 100) < 1;

  return {
    swingHigh: Math.round(swingHigh * 100) / 100,
    swingLow: Math.round(swingLow * 100) / 100,
    isUptrend,
    nearestLevel: nearestLevel.name,
    atKeyLevel,
    levels
  };
}

// VWAP (Volume Weighted Average Price)
function calculateVWAP(candles) {
  if (!candles || candles.length < 10) return { vwap: 0, deviation: 0, pricePosition: 'NEUTRAL' };

  let cumulativeTPV = 0;
  let cumulativeVolume = 0;

  for (const candle of candles) {
    const typicalPrice = (candle.high + candle.low + candle.close) / 3;
    cumulativeTPV += typicalPrice * candle.volume;
    cumulativeVolume += candle.volume;
  }

  const vwap = cumulativeTPV / cumulativeVolume;
  const currentPrice = candles[candles.length - 1].close;
  const deviation = ((currentPrice - vwap) / vwap) * 100;

  return {
    vwap,
    deviation,
    pricePosition: currentPrice > vwap ? 'ABOVE_VWAP' : 'BELOW_VWAP',
    isExtended: Math.abs(deviation) > 3
  };
}

// Ichimoku Cloud
function calculateIchimoku(candles) {
  if (!candles || candles.length < 52) return null;

  const getHighLow = (data, period) => {
    const slice = data.slice(-period);
    return {
      high: Math.max(...slice.map(c => c.high)),
      low: Math.min(...slice.map(c => c.low))
    };
  };

  const tenkan9 = getHighLow(candles, 9);
  const tenkanSen = (tenkan9.high + tenkan9.low) / 2;

  const kijun26 = getHighLow(candles, 26);
  const kijunSen = (kijun26.high + kijun26.low) / 2;

  const senkouSpanA = (tenkanSen + kijunSen) / 2;

  const senkou52 = getHighLow(candles, 52);
  const senkouSpanB = (senkou52.high + senkou52.low) / 2;

  const currentPrice = candles[candles.length - 1].close;
  const cloudTop = Math.max(senkouSpanA, senkouSpanB);
  const cloudBottom = Math.min(senkouSpanA, senkouSpanB);
  const cloudColor = senkouSpanA > senkouSpanB ? 'BULLISH' : 'BEARISH';

  let signal = 'NEUTRAL';
  if (currentPrice > cloudTop && tenkanSen > kijunSen) signal = 'STRONG_BULLISH';
  else if (currentPrice > cloudTop) signal = 'BULLISH';
  else if (currentPrice < cloudBottom && tenkanSen < kijunSen) signal = 'STRONG_BEARISH';
  else if (currentPrice < cloudBottom) signal = 'BEARISH';
  else signal = 'IN_CLOUD';

  return { cloudColor, signal, tkCross: tenkanSen > kijunSen ? 'BULLISH_TK' : 'BEARISH_TK' };
}

// ============================================
// FETCH CANDLESTICK DATA FOR INDICATORS
// ============================================

async function fetchCandlesticks(symbol, interval = '1h', limit = 100) {
  try {
    const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    const response = await fetchWithTimeout(url, {}, 8000);
    const data = await response.json();

    if (!Array.isArray(data)) return [];

    return data.map(k => ({
      time: k[0],
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5])
    }));
  } catch (e) {
    console.log(`Failed to fetch candles for ${symbol}:`, e.message);
    return [];
  }
}

function getVolumeTrend(candles) {
  if (!candles || candles.length < 20) return 'UNKNOWN';
  const avgVolume = candles.slice(-20).reduce((sum, c) => sum + c.volume, 0) / 20;
  const recentVolume = candles.slice(-5).reduce((sum, c) => sum + c.volume, 0) / 5;
  if (recentVolume > avgVolume * 1.2) return 'INCREASING';
  if (recentVolume < avgVolume * 0.8) return 'DECREASING';
  return 'STABLE';
}

function classifyMarketRegime(indicators) {
  if (!indicators || !indicators.adx) return 'UNKNOWN';
  if (indicators.atrPercent && indicators.atrPercent > 5) return 'VOLATILE';
  if (indicators.adx.adx < 20) return 'RANGING';
  if (indicators.trend.includes('UPTREND')) return 'TRENDING_UP';
  if (indicators.trend.includes('DOWNTREND')) return 'TRENDING_DOWN';
  return 'CHOPPY';
}

// Calculate all indicators for a symbol
async function calculateIndicators(symbol) {
  const candles = await fetchCandlesticks(symbol, '1h', 200);
  if (candles.length < 50) {
    console.log(`Insufficient candles for ${symbol}: ${candles.length}`);
    return null;
  }

  const closes = candles.map(c => c.close);
  const currentPrice = closes[closes.length - 1];

  const rsi = calculateRSI(closes);
  const ema20 = calculateEMA(closes, 20);
  const ema50 = calculateEMA(closes, 50);
  const ema200 = calculateEMA(closes, 200);
  const macd = calculateMACD(closes);
  const bollinger = calculateBollingerBands(closes);
  const atr = calculateATR(candles);
  const atrPercent = atr ? (atr / currentPrice) * 100 : 0;
  const adx = calculateADX(candles);
  const stochRsi = calculateStochRSI(closes);
  const supertrend = calculateSupertrend(candles);
  const fibonacci = calculateFibonacciLevels(candles);
  const vwap = calculateVWAP(candles);
  const ichimoku = calculateIchimoku(candles);
  const volumeTrend = getVolumeTrend(candles);

  // Determine trend from EMAs
  let trend = 'NEUTRAL';
  if (currentPrice > ema20 && ema20 > ema50) trend = 'STRONG UPTREND';
  else if (currentPrice > ema20) trend = 'WEAK UPTREND';
  else if (currentPrice < ema20 && ema20 < ema50) trend = 'STRONG DOWNTREND';
  else if (currentPrice < ema20) trend = 'WEAK DOWNTREND';

  return {
    symbol,
    price: currentPrice,
    rsi: Math.round(rsi * 10) / 10,
    ema20: Math.round(ema20 * 100) / 100,
    ema50: Math.round(ema50 * 100) / 100,
    ema200: Math.round(ema200 * 100) / 100,
    macd,
    bollinger,
    atr: Math.round(atr * 100) / 100,
    atrPercent,
    adx,
    stochRsi,
    supertrend,
    fibonacci,
    vwap,
    ichimoku,
    trend,
    volumeTrend,
    marketRegime: classifyMarketRegime({ trend, adx, atrPercent })
  };
}

// ============================================
// DYNAMIC TP/SL BASED ON VOLATILITY
// ============================================

function calculateVolatility(priceData) {
  // Calculate volatility as (high - low) / price * 100
  const volatility = ((priceData.high24h - priceData.low24h) / priceData.price) * 100;
  return volatility;
}

function adjustTPSLForVolatility(signal, marketData) {
  const priceData = marketData.prices[signal.symbol];
  if (!priceData) return signal;

  const volatility = calculateVolatility(priceData);
  const adjustedSignal = { ...signal };

  // Volatility multiplier: high volatility = wider TP/SL
  // Normal volatility ~3-5%, high >7%, low <2%
  let multiplier = 1;
  if (volatility > 7) {
    multiplier = 1.3; // Widen by 30%
    adjustedSignal.volatilityNote = 'High volatility - widened TP/SL';
  } else if (volatility > 5) {
    multiplier = 1.15; // Widen by 15%
    adjustedSignal.volatilityNote = 'Moderate volatility';
  } else if (volatility < 2) {
    multiplier = 0.85; // Tighten by 15%
    adjustedSignal.volatilityNote = 'Low volatility - tightened TP/SL';
  }

  // Adjust TP and SL based on direction
  const entryPrice = signal.entry;
  const originalTPDist = Math.abs(signal.takeProfit - entryPrice);
  const originalSLDist = Math.abs(signal.stopLoss - entryPrice);

  if (signal.direction === 'LONG') {
    adjustedSignal.takeProfit = entryPrice + (originalTPDist * multiplier);
    adjustedSignal.stopLoss = entryPrice - (originalSLDist * multiplier);
  } else {
    adjustedSignal.takeProfit = entryPrice - (originalTPDist * multiplier);
    adjustedSignal.stopLoss = entryPrice + (originalSLDist * multiplier);
  }

  adjustedSignal.volatility = volatility.toFixed(1);

  console.log(`📊 ${signal.symbol} volatility: ${volatility.toFixed(1)}% (multiplier: ${multiplier}x)`);

  return adjustedSignal;
}

// ============================================
// MARKET DATA FETCHING
// ============================================

// Helper function for fetch with timeout
async function fetchWithTimeout(url, options = {}, timeout = 10000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

async function fetchMarketData() {
  const data = {
    prices: {},
    fundingRates: {},
    openInterest: {},
    liquidations: {},
    longShortRatio: {}
  };

  // Try multiple data sources for prices
  let pricesLoaded = false;

  // Source 1: Try Binance Spot API (more reliable)
  if (!pricesLoaded) {
    try {
      console.log('Trying Binance Spot API...');
      const pricesRes = await fetchWithTimeout('https://api.binance.com/api/v3/ticker/24hr', {}, 8000);
      const pricesData = await pricesRes.json();

      if (Array.isArray(pricesData)) {
        for (const coin of CONFIG.TOP_COINS) {
          const ticker = pricesData.find(t => t.symbol === coin);
          if (ticker) {
            data.prices[coin] = {
              price: parseFloat(ticker.lastPrice),
              change24h: parseFloat(ticker.priceChangePercent),
              high24h: parseFloat(ticker.highPrice),
              low24h: parseFloat(ticker.lowPrice),
              volume: parseFloat(ticker.quoteVolume)
            };
          }
        }
        pricesLoaded = Object.keys(data.prices).length > 0;
        console.log(`Binance Spot: loaded ${Object.keys(data.prices).length} prices`);
      }
    } catch (e) {
      console.log('Binance Spot failed:', e.message);
    }
  }

  // Source 2: Try Binance Futures API
  if (!pricesLoaded) {
    try {
      console.log('Trying Binance Futures API...');
      const pricesRes = await fetchWithTimeout('https://fapi.binance.com/fapi/v1/ticker/24hr', {}, 8000);
      const pricesData = await pricesRes.json();

      if (Array.isArray(pricesData)) {
        for (const coin of CONFIG.TOP_COINS) {
          const ticker = pricesData.find(t => t.symbol === coin);
          if (ticker) {
            data.prices[coin] = {
              price: parseFloat(ticker.lastPrice),
              change24h: parseFloat(ticker.priceChangePercent),
              high24h: parseFloat(ticker.highPrice),
              low24h: parseFloat(ticker.lowPrice),
              volume: parseFloat(ticker.quoteVolume)
            };
          }
        }
        pricesLoaded = Object.keys(data.prices).length > 0;
        console.log(`Binance Futures: loaded ${Object.keys(data.prices).length} prices`);
      }
    } catch (e) {
      console.log('Binance Futures failed:', e.message);
    }
  }

  // Source 3: Try CoinGecko as fallback (no API key needed)
  if (!pricesLoaded) {
    try {
      console.log('Trying CoinGecko API...');
      const cgIds = {
        'BTCUSDT': 'bitcoin',
        'ETHUSDT': 'ethereum',
        'SOLUSDT': 'solana',
        'BNBUSDT': 'binancecoin',
        'XRPUSDT': 'ripple',
        'DOGEUSDT': 'dogecoin',
        'ADAUSDT': 'cardano',
        'AVAXUSDT': 'avalanche-2',
        'LINKUSDT': 'chainlink',
        'DOTUSDT': 'polkadot'
      };

      const ids = Object.values(cgIds).join(',');
      const cgRes = await fetchWithTimeout(
        `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids}&price_change_percentage=24h`,
        {},
        8000
      );
      const cgData = await cgRes.json();

      if (Array.isArray(cgData)) {
        for (const [symbol, cgId] of Object.entries(cgIds)) {
          const coin = cgData.find(c => c.id === cgId);
          if (coin) {
            data.prices[symbol] = {
              price: coin.current_price,
              change24h: coin.price_change_percentage_24h || 0,
              high24h: coin.high_24h || coin.current_price,
              low24h: coin.low_24h || coin.current_price,
              volume: coin.total_volume || 0
            };
          }
        }
        pricesLoaded = Object.keys(data.prices).length > 0;
        console.log(`CoinGecko: loaded ${Object.keys(data.prices).length} prices`);
      }
    } catch (e) {
      console.log('CoinGecko failed:', e.message);
    }
  }

  if (!pricesLoaded) {
    console.error('All price sources failed!');
    return data;
  }

  // Fetch funding rates from Coinglass (if API key provided)
  if (process.env.COINGLASS_API_KEY) {
      try {
        const fundingRes = await fetch('https://open-api-v3.coinglass.com/api/futures/fundingRate/current?exchange=Binance', {
          headers: { 'CG-API-KEY': process.env.COINGLASS_API_KEY }
        });
        const fundingData = await fundingRes.json();

        if (fundingData.success && fundingData.data) {
          for (const item of fundingData.data) {
            const symbol = item.symbol + 'USDT';
            if (CONFIG.TOP_COINS.includes(symbol)) {
              data.fundingRates[symbol] = parseFloat(item.fundingRate) * 100;
            }
          }
        }
      } catch (e) {
        console.log('Coinglass funding rates unavailable:', e.message);
      }

      // Fetch Open Interest
      try {
        const oiRes = await fetch('https://open-api-v3.coinglass.com/api/futures/openInterest/chart?exchange=Binance&interval=1d&limit=2', {
          headers: { 'CG-API-KEY': process.env.COINGLASS_API_KEY }
        });
        const oiData = await oiRes.json();

        if (oiData.success && oiData.data) {
          for (const [symbol, values] of Object.entries(oiData.data)) {
            const fullSymbol = symbol + 'USDT';
            if (CONFIG.TOP_COINS.includes(fullSymbol) && values.length >= 2) {
              const current = values[values.length - 1];
              const previous = values[values.length - 2];
              data.openInterest[fullSymbol] = {
                current: current,
                change: ((current - previous) / previous * 100).toFixed(2)
              };
            }
          }
        }
      } catch (e) {
        console.log('Coinglass OI unavailable:', e.message);
      }

      // Fetch Long/Short Ratio
      try {
        const lsRes = await fetch('https://open-api-v3.coinglass.com/api/futures/globalLongShortAccountRatio/chart?exchange=Binance&interval=1d&limit=1', {
          headers: { 'CG-API-KEY': process.env.COINGLASS_API_KEY }
        });
        const lsData = await lsRes.json();

        if (lsData.success && lsData.data) {
          for (const [symbol, values] of Object.entries(lsData.data)) {
            const fullSymbol = symbol + 'USDT';
            if (CONFIG.TOP_COINS.includes(fullSymbol) && values.length > 0) {
              data.longShortRatio[fullSymbol] = parseFloat(values[0].longShortRatio);
            }
          }
        }
      } catch (e) {
        console.log('Coinglass L/S ratio unavailable:', e.message);
      }
    }

  return data;
}

// ============================================
// AI ANALYSIS
// ============================================

async function buildAnalysisPrompt(marketData, indicatorData) {
  let prompt = `You are an expert crypto perpetual futures trader. Analyze the following market data with TECHNICAL INDICATORS and identify the BEST trading opportunities.

CRITICAL REQUIREMENTS:
- ADX must be >= 25 (strong trend required) - DO NOT signal weak trend coins
- Supertrend must confirm direction (UP = longs only, DOWN = shorts only)
- Stochastic RSI should support entry timing (OVERSOLD for longs, OVERBOUGHT for shorts)
- Price position relative to VWAP and EMAs must align with trade direction
- Volume trend must be STABLE or INCREASING
- Risk/Reward must be >= 2.0

`;

  // Add Discord community calls context
  try {
    const discordCalls = await getRecentCalls(100);
    if (discordCalls && discordCalls.length > 0) {
      const discordContext = formatCallsForAIContext(discordCalls);
      prompt += discordContext + '\n';
    }
  } catch (e) {
    console.log('Could not fetch Discord calls context:', e.message);
  }

  prompt += 'MARKET DATA WITH TECHNICAL INDICATORS:\n';

  for (const symbol of CONFIG.TOP_COINS) {
    const price = marketData.prices[symbol];
    const indicators = indicatorData[symbol];
    if (!price) continue;

    prompt += `\n${symbol}:
  Price: $${price.price.toLocaleString()}
  24h Change: ${price.change24h > 0 ? '+' : ''}${price.change24h.toFixed(2)}%
  24h High/Low: $${price.high24h.toLocaleString()} / $${price.low24h.toLocaleString()}
  Volume: $${(price.volume / 1e9).toFixed(2)}B`;

    if (marketData.fundingRates[symbol]) {
      prompt += `\n  Funding Rate: ${marketData.fundingRates[symbol].toFixed(4)}%`;
    }
    if (marketData.openInterest[symbol]) {
      prompt += `\n  OI Change: ${marketData.openInterest[symbol].change}%`;
    }
    if (marketData.longShortRatio[symbol]) {
      prompt += `\n  Long/Short Ratio: ${marketData.longShortRatio[symbol].toFixed(2)}`;
    }

    // Add technical indicators
    if (indicators) {
      prompt += `\n  --- TECHNICAL INDICATORS ---`;
      prompt += `\n  Trend: ${indicators.trend}`;
      prompt += `\n  RSI(14): ${indicators.rsi} ${indicators.rsi < 30 ? '🟢 OVERSOLD' : indicators.rsi > 70 ? '🔴 OVERBOUGHT' : ''}`;
      prompt += `\n  StochRSI: ${indicators.stochRsi?.k} (${indicators.stochRsi?.signal})`;
      prompt += `\n  ADX: ${indicators.adx?.adx} (${indicators.adx?.trend}) ${indicators.adx?.adx >= 25 ? '✅ STRONG TREND' : '⚠️ WEAK TREND - SKIP'}`;
      prompt += `\n  +DI/-DI: ${indicators.adx?.plusDI}/${indicators.adx?.minusDI}`;
      prompt += `\n  Supertrend: ${indicators.supertrend?.direction} (${indicators.supertrend?.signal})`;
      prompt += `\n  EMAs: 20=${indicators.ema20} | 50=${indicators.ema50} | 200=${indicators.ema200}`;
      prompt += `\n  MACD: ${indicators.macd?.histogram > 0 ? '📈 Bullish' : '📉 Bearish'} (Hist: ${indicators.macd?.histogram?.toFixed(2)})`;
      prompt += `\n  Bollinger: Upper=${indicators.bollinger?.upper?.toFixed(2)} | Mid=${indicators.bollinger?.middle?.toFixed(2)} | Lower=${indicators.bollinger?.lower?.toFixed(2)}`;
      prompt += `\n  ATR(14): ${indicators.atr}`;
      prompt += `\n  ATR%: ${indicators.atrPercent?.toFixed(2)}%`;
      prompt += `\n  Volume Trend: ${indicators.volumeTrend}`;
      prompt += `\n  Market Regime: ${indicators.marketRegime}`;
      if (indicators.vwap) {
        prompt += `\n  VWAP: ${indicators.vwap.pricePosition} (${indicators.vwap.deviation?.toFixed(2)}% dev)${indicators.vwap.isExtended ? ' ⚠️ EXTENDED' : ''}`;
      }
      if (indicators.ichimoku) {
        prompt += `\n  Ichimoku: ${indicators.ichimoku.signal} (${indicators.ichimoku.cloudColor} cloud)`;
      }
      if (indicators.fibonacci) {
        prompt += `\n  Fibonacci: Near ${indicators.fibonacci.nearestLevel}${indicators.fibonacci.atKeyLevel ? ' ⚠️ AT KEY LEVEL' : ''} | Trend: ${indicators.fibonacci.isUptrend ? 'UP' : 'DOWN'}`;
      }
    }
  }

  prompt += `

ANALYSIS RULES:
1. **ADX MUST BE >= 25** - Skip ANY coin with ADX < 25 (no exceptions)
2. **SUPERTREND MUST CONFIRM** - Supertrend UP = LONG only, Supertrend DOWN = SHORT only
3. **CONFLUENCE REQUIRED** - Multiple indicators must align:
   - For LONG: RSI < 50 (not overbought), MACD bullish, price above VWAP, Supertrend UP
   - For SHORT: RSI > 50 (not oversold), MACD bearish, price below VWAP, Supertrend DOWN
4. **ENTRY TIMING** - Use StochRSI: OVERSOLD for long entries, OVERBOUGHT for short entries
5. **TREND ALIGNMENT** - EMAs should confirm direction (price > EMA20 > EMA50 for longs)
6. **REGIME & VOLUME** - Skip RANGING/CHOPPY regimes and avoid DECREASING volume
7. **RISK/REWARD** - Must be >= 2.0 based on Entry/Stop/Target

TASK: Identify 1-3 highest conviction trade setups. For each, provide:
1. Symbol, Direction (LONG/SHORT), Confidence (0-100%)
2. Entry price, Stop Loss (use ATR for sizing), Take Profit
3. Key indicator reasons (cite specific values)

Respond in this exact JSON format:
{
  "signals": [
    {
      "symbol": "BTCUSDT",
      "direction": "LONG",
      "confidence": 85,
      "entry": 65000,
      "stopLoss": 63500,
      "takeProfit": 68000,
      "entryTrigger": "BREAKOUT/PULLBACK/REVERSAL/MOMENTUM",
      "entryCondition": "Specific condition to enter",
      "reasons": ["ADX 32 confirms strong trend", "Supertrend UP", "StochRSI oversold at 18"]
    }
  ]
}`;

  return prompt;
}

async function analyzeWithClaude(prompt) {
  if (!process.env.CLAUDE_API_KEY) return null;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();
    if (data.content && data.content[0]) {
      const text = data.content[0].text;
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return { source: 'claude', ...JSON.parse(jsonMatch[0]) };
      }
    }
  } catch (error) {
    console.error('Claude analysis error:', error);
  }
  return null;
}

async function analyzeWithOpenAI(prompt) {
  if (!process.env.OPENAI_API_KEY) return null;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1024
      })
    });

    const data = await response.json();
    if (data.choices && data.choices[0]) {
      const text = data.choices[0].message.content;
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return { source: 'openai', ...JSON.parse(jsonMatch[0]) };
      }
    }
  } catch (error) {
    console.error('OpenAI analysis error:', error);
  }
  return null;
}

async function analyzeWithGrok(prompt) {
  if (!process.env.GROK_API_KEY) return null;

  try {
    const response = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROK_API_KEY}`
      },
      body: JSON.stringify({
        model: 'grok-2-latest',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1024
      })
    });

    const data = await response.json();
    if (data.choices && data.choices[0]) {
      const text = data.choices[0].message.content;
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return { source: 'grok', ...JSON.parse(jsonMatch[0]) };
      }
    }
  } catch (error) {
    console.error('Grok analysis error:', error);
  }
  return null;
}

function normalizeSignal(signal) {
  if (!signal || typeof signal !== 'object') return null;
  const entry = Number(signal.entry);
  const stopLoss = Number(signal.stopLoss);
  const takeProfit = Number(signal.takeProfit);
  const confidence = Number(signal.confidence);
  const direction = typeof signal.direction === 'string' ? signal.direction.toUpperCase() : '';
  if (!Number.isFinite(entry) || !Number.isFinite(stopLoss) || !Number.isFinite(takeProfit) || !Number.isFinite(confidence)) {
    return null;
  }
  if (confidence < 0 || confidence > 100) return null;
  if (!['LONG', 'SHORT'].includes(direction)) return null;

  return {
    ...signal,
    entry,
    stopLoss,
    takeProfit,
    confidence,
    direction,
    entryTrigger: normalizeEntryTrigger(signal.entryTrigger)
  };
}

function validateSignalLevels(signal) {
  const isLong = signal.direction === 'LONG';
  if (isLong && !(signal.stopLoss < signal.entry && signal.takeProfit > signal.entry)) return false;
  if (!isLong && !(signal.stopLoss > signal.entry && signal.takeProfit < signal.entry)) return false;
  const risk = Math.abs(signal.entry - signal.stopLoss);
  const reward = Math.abs(signal.takeProfit - signal.entry);
  const rr = reward / Math.max(risk, 1e-9);
  return rr >= CONFIG.MIN_RISK_REWARD;
}

function validateSignalWithIndicators(signal, indicators) {
  if (!validateSignalLevels(signal)) return false;
  if (!indicators) return true;
  if (indicators.atrPercent !== undefined && indicators.atrPercent < CONFIG.MIN_ATR_PERCENT) return false;
  if (indicators.volumeTrend === 'DECREASING') return false;
  if (['RANGING', 'CHOPPY', 'SIDEWAYS', 'VOLATILE'].includes(indicators.marketRegime)) return false;
  return true;
}

function findConsensusSignals(analyses, indicatorData) {
  const validAnalyses = analyses.filter(a => a && a.signals && a.signals.length > 0);
  if (validAnalyses.length < 2) return [];

  const consensusSignals = [];
  const allSignals = validAnalyses.flatMap(a =>
    a.signals.map(s => {
      const normalized = normalizeSignal(s);
      if (!normalized) return null;
      return { ...normalized, aiSource: a.source };
    }).filter(Boolean)
  );

  // Group signals by symbol and direction
  const grouped = {};
  for (const signal of allSignals) {
    const key = `${signal.symbol}-${signal.direction}`;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(signal);
  }

  // Find consensus (2+ AIs agree)
  for (const [key, signals] of Object.entries(grouped)) {
    if (signals.length >= 2) {
      const matchingSignals = [];
      for (const signal of signals) {
        const matches = signals.filter(s =>
          s.aiSource !== signal.aiSource &&
          isWithinPercent(s.entry, signal.entry, CONFIG.MAX_ENTRY_WIGGLE_PERCENT) &&
          isWithinPercent(s.stopLoss, signal.stopLoss, CONFIG.MAX_SL_WIGGLE_PERCENT) &&
          isWithinPercent(s.takeProfit, signal.takeProfit, CONFIG.MAX_TP_WIGGLE_PERCENT) &&
          (!s.entryTrigger || !signal.entryTrigger || s.entryTrigger === signal.entryTrigger)
        );
        if (matches.length > 0 && !matchingSignals.some(m => m.aiSource === signal.aiSource)) {
          matchingSignals.push(signal);
          matches.forEach(match => {
            if (!matchingSignals.some(m => m.aiSource === match.aiSource)) {
              matchingSignals.push(match);
            }
          });
        }
      }

      const aiSources = [...new Set(matchingSignals.map(s => s.aiSource))];
      if (aiSources.length >= 2) {
        const avgEntry = matchingSignals.reduce((sum, s) => sum + s.entry, 0) / matchingSignals.length;
        const avgSL = matchingSignals.reduce((sum, s) => sum + s.stopLoss, 0) / matchingSignals.length;
        const avgTP = matchingSignals.reduce((sum, s) => sum + s.takeProfit, 0) / matchingSignals.length;
        const avgConfidence = matchingSignals.reduce((sum, s) => sum + s.confidence, 0) / matchingSignals.length;

        const allReasons = [...new Set(matchingSignals.flatMap(s => s.reasons || []))];
        const entryTriggers = matchingSignals.map(s => s.entryTrigger).filter(Boolean);
        const entryConditions = matchingSignals.map(s => s.entryCondition).filter(Boolean);

        const candidate = {
          symbol: matchingSignals[0].symbol,
          direction: matchingSignals[0].direction,
          entry: avgEntry,
          stopLoss: avgSL,
          takeProfit: avgTP,
          confidence: Math.round(avgConfidence),
          aiSources: aiSources,
          isGoldConsensus: aiSources.length >= 3,
          isSilverConsensus: aiSources.length === 2,
          reasons: allReasons.slice(0, 5),
          entryTrigger: entryTriggers[0] || null,
          entryCondition: entryConditions[0] || null
        };

        const indicators = indicatorData?.[candidate.symbol];
        if (validateSignalWithIndicators(candidate, indicators)) {
          consensusSignals.push(candidate);
        } else {
          console.log(`⛔ ${candidate.symbol}: Consensus rejected by validation filters`);
        }
      }
    }
  }

  return consensusSignals;
}

// ============================================
// TELEGRAM
// ============================================

async function sendTelegramMessage(message, inlineKeyboard = null) {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    console.log('Telegram not configured');
    return false;
  }

  try {
    const url = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
    const body = {
      chat_id: process.env.TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    };

    // Add inline keyboard if provided
    if (inlineKeyboard) {
      body.reply_markup = { inline_keyboard: inlineKeyboard };
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await response.json();
    if (!data.ok) {
      console.error('Telegram error:', data.description);
      return false;
    }
    return true;
  } catch (error) {
    console.error('Telegram send error:', error);
    return false;
  }
}

function formatSignalForTelegram(signal, majorEvent = null, indicators = null) {
  const directionEmoji = signal.direction === 'LONG' ? '🚀' : '🔴';
  const consensusType = signal.isGoldConsensus ? '🥇 GOLD CONSENSUS' :
                        signal.isSilverConsensus ? '🥈 SILVER CONSENSUS' : '📊 CONSENSUS';

  const riskPercent = Math.abs((signal.stopLoss - signal.entry) / signal.entry * 100);
  const rewardPercent = Math.abs((signal.takeProfit - signal.entry) / signal.entry * 100);
  const riskReward = (rewardPercent / riskPercent).toFixed(1);

  const aiList = signal.aiSources.map(s => {
    if (s === 'claude') return '🟣 Claude';
    if (s === 'openai') return '🟢 GPT-4o';
    if (s === 'grok') return '⚡ Grok';
    return s;
  }).join(' + ');

  let message = `${directionEmoji} <b>${signal.direction} ${signal.symbol}</b>\n`;
  message += `${consensusType}\n\n`;

  // Add warning if major event day
  if (majorEvent) {
    message += `⚠️ <b>CAUTION:</b> ${majorEvent.name} today!\n\n`;
  }

  message += `📊 <b>Confidence:</b> ${signal.confidence}%\n`;

  // Add volatility info if available
  if (signal.volatility) {
    message += `📈 <b>Volatility:</b> ${signal.volatility}%`;
    if (signal.volatilityNote) {
      message += ` (${signal.volatilityNote})`;
    }
    message += `\n`;
  }

  message += `\n💰 <b>Trade Setup:</b>\n`;
  message += `   Entry: $${signal.entry.toLocaleString()}\n`;
  message += `   Stop Loss: $${signal.stopLoss.toLocaleString()} (${riskPercent.toFixed(1)}%)\n`;
  message += `   Take Profit: $${signal.takeProfit.toLocaleString()} (${rewardPercent.toFixed(1)}%)\n`;
  message += `   R:R Ratio: 1:${riskReward}\n\n`;

  if (signal.entryTrigger) {
    message += `🎯 <b>Entry Trigger:</b> ${signal.entryTrigger}\n`;
  }
  if (signal.entryCondition) {
    message += `🧩 <b>Entry Condition:</b> ${signal.entryCondition}\n`;
  }
  if (signal.entryTrigger || signal.entryCondition) {
    message += `\n`;
  }

  // Add technical indicators summary
  if (indicators) {
    message += `📈 <b>Technical Indicators:</b>\n`;
    message += `   ADX: ${indicators.adx?.adx} (${indicators.adx?.trend})\n`;
    message += `   Supertrend: ${indicators.supertrend?.direction}\n`;
    message += `   RSI: ${indicators.rsi} | StochRSI: ${indicators.stochRsi?.signal}\n`;
    message += `   MACD: ${indicators.macd?.histogram > 0 ? 'Bullish' : 'Bearish'}\n`;
    if (indicators.vwap) {
      message += `   VWAP: ${indicators.vwap.pricePosition}\n`;
    }
    message += `\n`;
  }

  message += `🤖 <b>AI Sources:</b> ${aiList}\n\n`;

  if (signal.reasons && signal.reasons.length > 0) {
    message += `📝 <b>Reasons:</b>\n`;
    for (const reason of signal.reasons.slice(0, 4)) {
      message += `• ${reason}\n`;
    }
  }

  message += `\n⏰ ${new Date().toUTCString()}`;

  return message;
}

// Create inline keyboard for trade tracking
function createTradeKeyboard(signal) {
  const signalId = `${signal.symbol}_${signal.direction}_${Date.now()}`;
  return [
    [
      { text: '✅ Win', callback_data: `win_${signalId}` },
      { text: '❌ Loss', callback_data: `loss_${signalId}` },
      { text: '⏭️ Skip', callback_data: `skip_${signalId}` }
    ]
  ];
}

// ============================================
// MAIN HANDLER
// ============================================

export default async function handler(request, response) {
  console.log('🔄 Starting AI scan...');

  try {
    // Check for major economic events
    const majorEvent = isMajorEventDay();
    if (majorEvent) {
      console.log(`⚠️ Major event day: ${majorEvent.name} - Signals will include warning`);
    }

    // Check if we have at least 2 AI APIs configured
    const aiCount = [
      process.env.CLAUDE_API_KEY,
      process.env.OPENAI_API_KEY,
      process.env.GROK_API_KEY
    ].filter(Boolean).length;

    if (aiCount < 2) {
      return response.status(200).json({
        success: false,
        message: 'At least 2 AI API keys required for consensus signals',
        configured: aiCount
      });
    }

    // Fetch market data
    console.log('📊 Fetching market data...');
    const marketData = await fetchMarketData();

    if (Object.keys(marketData.prices).length === 0) {
      return response.status(200).json({
        success: false,
        message: 'Failed to fetch market data'
      });
    }

    // Fetch technical indicators for all coins
    console.log('📈 Calculating technical indicators...');
    const indicatorData = {};
    for (const symbol of CONFIG.TOP_COINS) {
      const indicators = await calculateIndicators(symbol);
      if (indicators) {
        indicatorData[symbol] = indicators;
        console.log(`  ${symbol}: ADX=${indicators.adx?.adx} Supertrend=${indicators.supertrend?.direction} RSI=${indicators.rsi}`);
      }
    }

    // Build analysis prompt with indicator data
    const prompt = await buildAnalysisPrompt(marketData, indicatorData);

    // Run AI analyses in parallel
    console.log('🤖 Running AI analysis...');
    const [claudeResult, openaiResult, grokResult] = await Promise.all([
      analyzeWithClaude(prompt),
      analyzeWithOpenAI(prompt),
      analyzeWithGrok(prompt)
    ]);

    const analyses = [claudeResult, openaiResult, grokResult].filter(Boolean);
    console.log(`✅ Got ${analyses.length} AI responses`);

    // Find consensus signals
    const consensusSignals = findConsensusSignals(analyses, indicatorData);
    console.log(`🎯 Found ${consensusSignals.length} consensus signals`);

    // Filter by confidence and TP%
    let alertSignals = consensusSignals.filter(signal => {
      if (signal.confidence < CONFIG.ALERT_CONFIDENCE) return false;

      const tpPercent = Math.abs((signal.takeProfit - signal.entry) / signal.entry * 100);
      let minTP = CONFIG.MIN_TP_PERCENT_MID_CAP;

      if (signal.symbol === 'BTCUSDT' || signal.symbol === 'ETHUSDT') {
        minTP = CONFIG.MIN_TP_PERCENT_BTC_ETH;
      } else if (['BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT', 'AVAXUSDT', 'DOTUSDT', 'LINKUSDT'].includes(signal.symbol)) {
        minTP = CONFIG.MIN_TP_PERCENT_LARGE_CAP;
      }

      return tpPercent >= minTP;
    });

    // Filter by Gold consensus only (all 3 AIs must agree)
    if (CONFIG.REQUIRE_GOLD_CONSENSUS) {
      alertSignals = alertSignals.filter(signal => {
        if (!signal.isGoldConsensus) {
          console.log(`⛔ ${signal.symbol}: Not Gold consensus (only ${signal.aiSources.length} AIs) - Skipping`);
          return false;
        }
        return true;
      });
      console.log(`🥇 After Gold consensus filter: ${alertSignals.length} signals`);
    }

    // Filter by ADX >= 25 (strong trend required)
    alertSignals = alertSignals.filter(signal => {
      const indicators = indicatorData[signal.symbol];
      if (!indicators || !indicators.adx) {
        console.log(`⚠️ ${signal.symbol}: No indicator data - allowing signal`);
        return true;
      }
      if (indicators.adx.adx < 25) {
        console.log(`⛔ ${signal.symbol}: ADX ${indicators.adx.adx} < 25 (weak trend) - BLOCKED`);
        return false;
      }
      console.log(`✅ ${signal.symbol}: ADX ${indicators.adx.adx} >= 25 (${indicators.adx.trend}) - OK`);
      return true;
    });
    console.log(`📊 After ADX filter: ${alertSignals.length} signals`);

    // Filter by Supertrend direction confirmation
    alertSignals = alertSignals.filter(signal => {
      const indicators = indicatorData[signal.symbol];
      if (!indicators || !indicators.supertrend) {
        console.log(`⚠️ ${signal.symbol}: No supertrend data - allowing signal`);
        return true;
      }
      const supertrendDir = indicators.supertrend.direction;
      if (signal.direction === 'LONG' && supertrendDir !== 'UP') {
        console.log(`⛔ ${signal.symbol}: LONG signal but Supertrend is ${supertrendDir} - BLOCKED`);
        return false;
      }
      if (signal.direction === 'SHORT' && supertrendDir !== 'DOWN') {
        console.log(`⛔ ${signal.symbol}: SHORT signal but Supertrend is ${supertrendDir} - BLOCKED`);
        return false;
      }
      console.log(`✅ ${signal.symbol}: ${signal.direction} confirmed by Supertrend ${supertrendDir} - OK`);
      return true;
    });
    console.log(`🔄 After Supertrend filter: ${alertSignals.length} signals`);

    // Filter by market regime, volume trend, and ATR threshold
    alertSignals = alertSignals.filter(signal => {
      const indicators = indicatorData[signal.symbol];
      if (!indicators) return true;
      if (indicators.atrPercent !== undefined && indicators.atrPercent < CONFIG.MIN_ATR_PERCENT) {
        console.log(`⛔ ${signal.symbol}: ATR ${indicators.atrPercent.toFixed(2)}% below ${CONFIG.MIN_ATR_PERCENT}% - BLOCKED`);
        return false;
      }
      if (indicators.volumeTrend === 'DECREASING') {
        console.log(`⛔ ${signal.symbol}: Volume trend decreasing - BLOCKED`);
        return false;
      }
      if (['RANGING', 'CHOPPY', 'SIDEWAYS', 'VOLATILE'].includes(indicators.marketRegime)) {
        console.log(`⛔ ${signal.symbol}: Market regime ${indicators.marketRegime} - BLOCKED`);
        return false;
      }
      return true;
    });
    console.log(`📉 After regime/volume/ATR filter: ${alertSignals.length} signals`);

    // Apply Redis-based cooldown filter (persistent across invocations)
    const cooldownChecks = await Promise.all(
      alertSignals.map(async signal => {
        const currentPrice = marketData.prices[signal.symbol]?.price || signal.entry;
        const onCooldown = await isSignalOnCooldown(signal.symbol, signal.direction, currentPrice);
        return { signal, onCooldown };
      })
    );
    alertSignals = cooldownChecks.filter(c => !c.onCooldown).map(c => c.signal);
    console.log(`⏱️ After cooldown filter: ${alertSignals.length} signals`);

    // Apply correlation filter (don't send multiple signals from same group)
    alertSignals = filterCorrelatedSignals(alertSignals);
    console.log(`🔗 After correlation filter: ${alertSignals.length} signals`);

    // Adjust TP/SL based on volatility
    alertSignals = alertSignals.map(signal => adjustTPSLForVolatility(signal, marketData));

    // Re-validate risk/reward after volatility adjustment
    alertSignals = alertSignals.filter(signal => {
      const risk = Math.abs(signal.entry - signal.stopLoss);
      const reward = Math.abs(signal.takeProfit - signal.entry);
      const rr = reward / Math.max(risk, 1e-9);
      if (rr < CONFIG.MIN_RISK_REWARD) {
        console.log(`⛔ ${signal.symbol}: R/R ${rr.toFixed(2)} < ${CONFIG.MIN_RISK_REWARD} after volatility adjust - BLOCKED`);
        return false;
      }
      return true;
    });
    console.log(`✅ After R/R validation: ${alertSignals.length} signals`);

    // Send Telegram alerts with inline keyboards
    let alertsSent = 0;
    for (const signal of alertSignals) {
      const indicators = indicatorData[signal.symbol];
      const message = formatSignalForTelegram(signal, majorEvent, indicators);
      const keyboard = createTradeKeyboard(signal);
      const sent = await sendTelegramMessage(message, keyboard);
      if (sent) {
        alertsSent++;
        // Save to Redis for cooldown tracking
        await saveSignal(signal.symbol, signal.direction, signal.entry);
        console.log(`✅ Sent alert for ${signal.symbol} ${signal.direction}`);
      }
    }

    console.log(`📤 Sent ${alertsSent} Telegram alerts`);

    return response.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      aiResponses: analyses.length,
      consensusSignals: consensusSignals.length,
      alertsSent: alertsSent,
      signals: alertSignals.map(s => ({
        symbol: s.symbol,
        direction: s.direction,
        confidence: s.confidence,
        aiSources: s.aiSources
      }))
    });

  } catch (error) {
    console.error('Scan error:', error);
    return response.status(500).json({
      success: false,
      error: error.message
    });
  }
}
