/* ============================================
   SENTIENT TRADER - AI Crypto Trading Intelligence v2.1
   ============================================ */

// Configuration
const CONFIG = {
  BINANCE_API: 'https://fapi.binance.com',
  BYBIT_API: 'https://api.bybit.com',
  COINGECKO_API: 'https://api.coingecko.com/api/v3',
  SCAN_INTERVAL: 90000,
  PRICE_UPDATE_INTERVAL: 1000,
  PNL_UPDATE_INTERVAL: 500,
  CACHE_TTL: 30000,
  MIN_CONFIDENCE: 65,
  HIGH_CONFIDENCE: 80,
  TOP_COINS: 50,
  LEVERAGE: 5,
  RISK_PERCENT: 2,
  TP_PERCENT: 2,
  SL_PERCENT: 1
};

// State
const state = {
  markets: [],
  signals: [],
  trades: [],
  selectedSymbol: 'BTCUSDT',
  currentTimeframe: '240',
  balance: 2000,
  startBalance: 2000,
  equityHistory: [{ time: Date.now(), value: 2000 }],
  priceCache: {},
  klineCache: {},
  previousHighConfSignals: new Set(),
  isScanning: false,
  soundEnabled: true,
  showSR: true,
  showIndicators: false,
  showVolume: false,
  dataSource: 'binance',
  chart: null,
  candleSeries: null,
  volumeSeries: null,
  priceLines: [],
  equityChart: null,
  equitySeries: null,
  growthChart: null,
  growthSeries: null,
  wsConnection: null,
  signalFilter: 'all'
};

// Utility Functions
const formatPrice = (price, decimals = 2) => {
  if (price >= 1000) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 1) return price.toFixed(decimals);
  if (price >= 0.01) return price.toFixed(4);
  return price.toFixed(6);
};

const formatVolume = (vol) => {
  if (vol >= 1e9) return (vol / 1e9).toFixed(1) + 'B';
  if (vol >= 1e6) return (vol / 1e6).toFixed(1) + 'M';
  if (vol >= 1e3) return (vol / 1e3).toFixed(1) + 'K';
  return vol.toFixed(0);
};

const formatPercent = (pct) => (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%';

const timeAgo = (timestamp) => {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ============================================
// DATA FETCHING WITH FALLBACK
// ============================================

async function fetchWithRetry(url, options = {}, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeoutId);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      if (i === retries - 1) throw error;
      await sleep(1000 * (i + 1));
    }
  }
}

// Binance API
async function fetchBinanceMarkets() {
  const data = await fetchWithRetry(`${CONFIG.BINANCE_API}/fapi/v1/ticker/24hr`);
  return data
    .filter(t => t.symbol.endsWith('USDT') && !t.symbol.includes('_'))
    .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
    .slice(0, CONFIG.TOP_COINS)
    .map(t => ({
      symbol: t.symbol,
      price: parseFloat(t.lastPrice),
      change: parseFloat(t.priceChangePercent),
      volume: parseFloat(t.quoteVolume),
      high: parseFloat(t.highPrice),
      low: parseFloat(t.lowPrice)
    }));
}

// Bybit API (Backup)
async function fetchBybitMarkets() {
  const data = await fetchWithRetry(`${CONFIG.BYBIT_API}/v5/market/tickers?category=linear`);
  return data.result.list
    .filter(t => t.symbol.endsWith('USDT'))
    .sort((a, b) => parseFloat(b.turnover24h) - parseFloat(a.turnover24h))
    .slice(0, CONFIG.TOP_COINS)
    .map(t => ({
      symbol: t.symbol,
      price: parseFloat(t.lastPrice),
      change: parseFloat(t.price24hPcnt) * 100,
      volume: parseFloat(t.turnover24h),
      high: parseFloat(t.highPrice24h),
      low: parseFloat(t.lowPrice24h)
    }));
}

// Fetch markets with fallback
async function fetchMarkets() {
  try {
    const markets = await fetchBinanceMarkets();
    state.dataSource = 'binance';
    updateDataSource('Binance', true);
    return markets;
  } catch (error) {
    console.warn('Binance failed, trying Bybit...', error);
    try {
      const markets = await fetchBybitMarkets();
      state.dataSource = 'bybit';
      updateDataSource('Bybit', true);
      return markets;
    } catch (error2) {
      console.error('All exchanges failed:', error2);
      updateDataSource('Offline', false);
      return state.markets;
    }
  }
}

// Fetch Klines
async function fetchKlines(symbol, interval = '240', limit = 200) {
  const cacheKey = `${symbol}_${interval}`;
  const cached = state.klineCache[cacheKey];
  if (cached && Date.now() - cached.timestamp < CONFIG.CACHE_TTL) {
    return cached.data;
  }

  try {
    let data;
    if (state.dataSource === 'binance') {
      const intervalMap = { '5': '5m', '15': '15m', '60': '1h', '240': '4h', 'D': '1d' };
      data = await fetchWithRetry(
        `${CONFIG.BINANCE_API}/fapi/v1/klines?symbol=${symbol}&interval=${intervalMap[interval]}&limit=${limit}`
      );
      data = data.map(k => ({
        time: Math.floor(k[0] / 1000),
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5])
      }));
    } else {
      const intervalMap = { '5': '5', '15': '15', '60': '60', '240': '240', 'D': 'D' };
      const response = await fetchWithRetry(
        `${CONFIG.BYBIT_API}/v5/market/kline?category=linear&symbol=${symbol}&interval=${intervalMap[interval]}&limit=${limit}`
      );
      data = response.result.list.reverse().map(k => ({
        time: Math.floor(parseInt(k[0]) / 1000),
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5])
      }));
    }

    state.klineCache[cacheKey] = { data, timestamp: Date.now() };
    return data;
  } catch (error) {
    console.error(`Failed to fetch klines for ${symbol}:`, error);
    return cached?.data || [];
  }
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

function findSupportResistance(candles, lookback = 50) {
  if (candles.length < lookback) return { supports: [], resistances: [] };

  const recent = candles.slice(-lookback);
  const swingHighs = [];
  const swingLows = [];

  for (let i = 2; i < recent.length - 2; i++) {
    const curr = recent[i];
    if (curr.high > recent[i-1].high && curr.high > recent[i-2].high &&
        curr.high > recent[i+1].high && curr.high > recent[i+2].high) {
      swingHighs.push(curr.high);
    }
    if (curr.low < recent[i-1].low && curr.low < recent[i-2].low &&
        curr.low < recent[i+1].low && curr.low < recent[i+2].low) {
      swingLows.push(curr.low);
    }
  }

  const clusterLevels = (levels, threshold = 0.005) => {
    const clusters = [];
    levels.sort((a, b) => a - b);

    for (const level of levels) {
      const existing = clusters.find(c => Math.abs(c.price - level) / level < threshold);
      if (existing) {
        existing.count++;
        existing.price = (existing.price + level) / 2;
      } else {
        clusters.push({ price: level, count: 1 });
      }
    }

    return clusters.sort((a, b) => b.count - a.count).slice(0, 3).map(c => c.price);
  };

  return { supports: clusterLevels(swingLows), resistances: clusterLevels(swingHighs) };
}

// ============================================
// SIGNAL GENERATION
// ============================================

async function analyzeMarket(symbol, timeframe = '240') {
  try {
    const candles = await fetchKlines(symbol, timeframe, 200);
    if (candles.length < 50) return null;

    const closes = candles.map(c => c.close);
    const currentPrice = closes[closes.length - 1];

    const rsi = calculateRSI(closes);
    const ema20 = calculateEMA(closes, 20);
    const ema50 = calculateEMA(closes, 50);
    const ema200 = calculateEMA(closes, 200);
    const macd = calculateMACD(closes);
    const bb = calculateBollingerBands(closes);
    const atr = calculateATR(candles);
    const { supports, resistances } = findSupportResistance(candles);

    let bullScore = 0, bearScore = 0;
    const reasons = [];

    // RSI Analysis
    if (rsi < 30) { bullScore += 20; reasons.push('RSI oversold (<30)'); }
    else if (rsi > 70) { bearScore += 20; reasons.push('RSI overbought (>70)'); }
    else if (rsi < 45) { bullScore += 10; reasons.push('RSI showing bullish momentum'); }
    else if (rsi > 55) { bearScore += 10; reasons.push('RSI showing bearish momentum'); }

    // EMA Trend
    if (currentPrice > ema200) { bullScore += 15; reasons.push('Price above EMA200 (bullish trend)'); }
    else { bearScore += 15; reasons.push('Price below EMA200 (bearish trend)'); }

    if (ema20 > ema50) { bullScore += 10; reasons.push('EMA20 > EMA50 (bullish cross)'); }
    else { bearScore += 10; reasons.push('EMA20 < EMA50 (bearish cross)'); }

    if (ema50 > ema200) { bullScore += 10; reasons.push('Golden cross zone'); }
    else { bearScore += 10; reasons.push('Death cross zone'); }

    // MACD
    if (macd.histogram > 0 && macd.macd > macd.signal) {
      bullScore += 15; reasons.push('MACD bullish crossover');
    } else if (macd.histogram < 0 && macd.macd < macd.signal) {
      bearScore += 15; reasons.push('MACD bearish crossover');
    }

    // Bollinger Bands
    if (currentPrice < bb.lower) { bullScore += 15; reasons.push('Price below lower BB'); }
    else if (currentPrice > bb.upper) { bearScore += 15; reasons.push('Price above upper BB'); }

    // Support/Resistance
    const nearestSupport = supports.find(s => currentPrice > s && (currentPrice - s) / s < 0.02);
    const nearestResistance = resistances.find(r => currentPrice < r && (r - currentPrice) / currentPrice < 0.02);

    if (nearestSupport) { bullScore += 15; reasons.push(`Near support ($${formatPrice(nearestSupport)})`); }
    if (nearestResistance) { bearScore += 15; reasons.push(`Near resistance ($${formatPrice(nearestResistance)})`); }

    // Volume analysis
    const avgVolume = candles.slice(-20).reduce((a, c) => a + c.volume, 0) / 20;
    const lastVolume = candles[candles.length - 1].volume;
    if (lastVolume > avgVolume * 1.5) {
      const lastCandle = candles[candles.length - 1];
      if (lastCandle.close > lastCandle.open) { bullScore += 10; reasons.push('High volume bullish candle'); }
      else { bearScore += 10; reasons.push('High volume bearish candle'); }
    }

    const totalScore = bullScore + bearScore;
    const direction = bullScore > bearScore ? 'LONG' : 'SHORT';
    const dominantScore = direction === 'LONG' ? bullScore : bearScore;
    const confidence = Math.min(95, Math.round((dominantScore / Math.max(totalScore, 1)) * 100));

    if (confidence < CONFIG.MIN_CONFIDENCE) return null;

    const entry = currentPrice;
    const tp = direction === 'LONG' ? entry * (1 + CONFIG.TP_PERCENT / 100) : entry * (1 - CONFIG.TP_PERCENT / 100);
    const sl = direction === 'LONG' ? entry * (1 - CONFIG.SL_PERCENT / 100) : entry * (1 + CONFIG.SL_PERCENT / 100);
    const riskReward = Math.abs(tp - entry) / Math.abs(entry - sl);

    return {
      symbol, direction, confidence, entry, tp, sl, riskReward, timeframe,
      reasons: reasons.slice(0, 5),
      indicators: { rsi, ema20, ema50, ema200, macd, bb, atr },
      levels: { supports, resistances },
      timestamp: Date.now()
    };
  } catch (error) {
    console.error(`Analysis failed for ${symbol}:`, error);
    return null;
  }
}

async function runScan() {
  if (state.isScanning) return;
  state.isScanning = true;
  updateScanStatus(0, 0);

  const newSignals = [];
  const timeframes = ['240', 'D'];

  for (let i = 0; i < state.markets.length; i++) {
    const market = state.markets[i];
    updateScanStatus(i + 1, newSignals.length);

    for (const tf of timeframes) {
      const signal = await analyzeMarket(market.symbol, tf);
      if (signal) {
        const existingIdx = newSignals.findIndex(s => s.symbol === signal.symbol);
        if (existingIdx === -1 || newSignals[existingIdx].confidence < signal.confidence) {
          if (existingIdx !== -1) newSignals.splice(existingIdx, 1);
          newSignals.push(signal);
        }
      }
    }
    await sleep(50);
  }

  newSignals.sort((a, b) => b.confidence - a.confidence);
  state.signals = newSignals;

  const highConfSignals = newSignals.filter(s => s.confidence >= CONFIG.HIGH_CONFIDENCE);
  for (const signal of highConfSignals) {
    const key = `${signal.symbol}_${signal.direction}_${signal.timeframe}`;
    if (!state.previousHighConfSignals.has(key)) {
      showNotification(signal);
      state.previousHighConfSignals.add(key);
    }
  }

  state.isScanning = false;
  renderAll();
}

// ============================================
// PAPER TRADING
// ============================================

function openTrade(signal) {
  const positionSize = (state.balance * CONFIG.RISK_PERCENT / 100) * CONFIG.LEVERAGE;
  const trade = {
    id: Date.now(),
    symbol: signal.symbol,
    direction: signal.direction,
    entry: signal.entry,
    tp: signal.tp,
    sl: signal.sl,
    size: positionSize,
    leverage: CONFIG.LEVERAGE,
    timestamp: Date.now(),
    status: 'open',
    pnl: 0
  };

  state.trades.push(trade);
  saveTrades();
  renderPositions();
  renderHistory();
  updatePortfolioStats();
}

function updateOpenPositions() {
  const openTrades = state.trades.filter(t => t.status === 'open');
  let totalUnrealizedPnl = 0;

  for (const trade of openTrades) {
    const currentPrice = state.priceCache[trade.symbol] || trade.entry;
    const priceDiff = trade.direction === 'LONG' ? currentPrice - trade.entry : trade.entry - currentPrice;
    trade.pnl = (priceDiff / trade.entry) * trade.size;
    totalUnrealizedPnl += trade.pnl;

    if (trade.direction === 'LONG') {
      if (currentPrice >= trade.tp || currentPrice <= trade.sl) closeTrade(trade, currentPrice);
    } else {
      if (currentPrice <= trade.tp || currentPrice >= trade.sl) closeTrade(trade, currentPrice);
    }
  }

  const unrealizedEl = document.getElementById('unrealizedPnl');
  if (unrealizedEl) {
    unrealizedEl.textContent = (totalUnrealizedPnl >= 0 ? '+' : '') + totalUnrealizedPnl.toFixed(2);
    unrealizedEl.className = 'stat-value ' + (totalUnrealizedPnl >= 0 ? 'green' : 'red');
  }
  renderPositions();
}

function closeTrade(trade, exitPrice) {
  trade.status = 'closed';
  trade.exitPrice = exitPrice;
  trade.closeTimestamp = Date.now();

  const priceDiff = trade.direction === 'LONG' ? exitPrice - trade.entry : trade.entry - exitPrice;
  trade.pnl = (priceDiff / trade.entry) * trade.size;

  state.balance += trade.pnl;
  state.equityHistory.push({ time: Date.now(), value: state.balance });

  saveTrades();
  renderHistory();
  updatePortfolioStats();
  updateEquityChart();
}

function updatePortfolioStats() {
  const closedTrades = state.trades.filter(t => t.status === 'closed');
  const wins = closedTrades.filter(t => t.pnl > 0).length;
  const winRate = closedTrades.length > 0 ? (wins / closedTrades.length * 100) : 0;
  const maxDrawdown = calculateMaxDrawdown();

  const equityEl = document.getElementById('equityValue');
  const winRateEl = document.getElementById('winRateValue');
  const maxDdEl = document.getElementById('maxDrawdown');
  const posCountEl = document.getElementById('positionCount');
  const histCountEl = document.getElementById('historyCount');

  if (equityEl) equityEl.textContent = '$' + state.balance.toFixed(2);
  if (winRateEl) winRateEl.textContent = winRate.toFixed(0) + '%';
  if (maxDdEl) maxDdEl.textContent = maxDrawdown.toFixed(1) + '%';
  if (posCountEl) posCountEl.textContent = state.trades.filter(t => t.status === 'open').length;
  if (histCountEl) histCountEl.textContent = closedTrades.length;
}

function calculateMaxDrawdown() {
  if (state.equityHistory.length < 2) return 0;
  let peak = state.equityHistory[0].value;
  let maxDd = 0;

  for (const point of state.equityHistory) {
    if (point.value > peak) peak = point.value;
    const dd = (peak - point.value) / peak * 100;
    if (dd > maxDd) maxDd = dd;
  }
  return maxDd;
}

// ============================================
// WEBSOCKET FOR REAL-TIME PRICES
// ============================================

function initWebSocket() {
  if (state.wsConnection) state.wsConnection.close();

  const symbols = state.markets.slice(0, 20).map(m => m.symbol.toLowerCase());
  const streams = symbols.map(s => `${s}@ticker`).join('/');

  try {
    state.wsConnection = new WebSocket(`wss://fstream.binance.com/stream?streams=${streams}`);

    state.wsConnection.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.data) {
        const ticker = data.data;
        const symbol = ticker.s;
        state.priceCache[symbol] = parseFloat(ticker.c);

        const market = state.markets.find(m => m.symbol === symbol);
        if (market) {
          market.price = parseFloat(ticker.c);
          market.change = parseFloat(ticker.P);
        }

        if (symbol === state.selectedSymbol) {
          updateChartPrice(parseFloat(ticker.c), parseFloat(ticker.P));
        }
      }
    };

    state.wsConnection.onerror = () => {
      console.warn('WebSocket error, falling back to polling');
      startPricePolling();
    };

    state.wsConnection.onclose = () => setTimeout(initWebSocket, 5000);
  } catch (error) {
    console.error('WebSocket init failed:', error);
    startPricePolling();
  }
}

function startPricePolling() {
  setInterval(async () => {
    try {
      const markets = await fetchMarkets();
      state.markets = markets;
      for (const m of markets) state.priceCache[m.symbol] = m.price;
      renderMarkets();
    } catch (error) {
      console.error('Price polling failed:', error);
    }
  }, 5000);
}

// ============================================
// CHART RENDERING
// ============================================

function initChart() {
  const container = document.getElementById('tradingChart');
  if (!container || typeof LightweightCharts === 'undefined') {
    console.error('Chart container or LightweightCharts not available');
    return;
  }

  container.innerHTML = '';

  state.chart = LightweightCharts.createChart(container, {
    width: container.clientWidth,
    height: container.clientHeight,
    layout: {
      background: { type: 'solid', color: '#111820' },
      textColor: '#8b949e'
    },
    grid: {
      vertLines: { color: 'rgba(255, 255, 255, 0.03)' },
      horzLines: { color: 'rgba(255, 255, 255, 0.03)' }
    },
    crosshair: {
      mode: LightweightCharts.CrosshairMode.Normal,
      vertLine: { color: 'rgba(124, 92, 255, 0.4)', width: 1, style: 2 },
      horzLine: { color: 'rgba(124, 92, 255, 0.4)', width: 1, style: 2 }
    },
    rightPriceScale: {
      borderColor: 'rgba(255, 255, 255, 0.1)',
      scaleMargins: { top: 0.1, bottom: 0.2 }
    },
    timeScale: {
      borderColor: 'rgba(255, 255, 255, 0.1)',
      timeVisible: true,
      secondsVisible: false
    }
  });

  state.candleSeries = state.chart.addCandlestickSeries({
    upColor: '#3fb950',
    downColor: '#f85149',
    borderUpColor: '#3fb950',
    borderDownColor: '#f85149',
    wickUpColor: '#3fb950',
    wickDownColor: '#f85149'
  });

  state.volumeSeries = state.chart.addHistogramSeries({
    color: '#7c5cff',
    priceFormat: { type: 'volume' },
    priceScaleId: '',
    scaleMargins: { top: 0.85, bottom: 0 }
  });

  new ResizeObserver(() => {
    if (state.chart) {
      state.chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
    }
  }).observe(container);

  loadChartData();
}

async function loadChartData() {
  const candles = await fetchKlines(state.selectedSymbol, state.currentTimeframe, 300);
  if (candles.length === 0 || !state.candleSeries) return;

  // Clear existing price lines
  clearPriceLines();

  // Set new data
  state.candleSeries.setData(candles);
  state.volumeSeries.setData(candles.map(c => ({
    time: c.time,
    value: c.volume,
    color: c.close >= c.open ? 'rgba(63, 185, 80, 0.3)' : 'rgba(248, 81, 73, 0.3)'
  })));

  // Add S/R price lines on chart
  if (state.showSR) {
    const { supports, resistances } = findSupportResistance(candles);
    addPriceLines(supports, resistances, candles[candles.length - 1].close);
    updateChartLevels(supports, resistances, candles[candles.length - 1].close);
  }

  // Auto-fit content to show correct price range
  state.chart.timeScale().fitContent();
}

function clearPriceLines() {
  // Remove all existing price lines from candleSeries
  if (state.priceLines && state.priceLines.length > 0) {
    state.priceLines.forEach(line => {
      try {
        state.candleSeries.removePriceLine(line);
      } catch (e) {
        // Line may have already been removed
      }
    });
  }
  state.priceLines = [];
}

function addPriceLines(supports, resistances, currentPrice) {
  // Add resistance lines (red)
  resistances.forEach((price, idx) => {
    const line = state.candleSeries.createPriceLine({
      price: price,
      color: '#f85149',
      lineWidth: 1,
      lineStyle: 2, // Dashed
      axisLabelVisible: true,
      title: `R${idx + 1}`
    });
    state.priceLines.push(line);
  });

  // Add support lines (green)
  supports.forEach((price, idx) => {
    const line = state.candleSeries.createPriceLine({
      price: price,
      color: '#3fb950',
      lineWidth: 1,
      lineStyle: 2, // Dashed
      axisLabelVisible: true,
      title: `S${idx + 1}`
    });
    state.priceLines.push(line);
  });

  // Add current price line (purple)
  const currentLine = state.candleSeries.createPriceLine({
    price: currentPrice,
    color: '#7c5cff',
    lineWidth: 2,
    lineStyle: 0, // Solid
    axisLabelVisible: true,
    title: 'NOW'
  });
  state.priceLines.push(currentLine);
}

function updateChartLevels(supports, resistances, currentPrice) {
  const container = document.getElementById('chartLevels');
  if (!container) return;
  container.innerHTML = '';

  const allLevels = [
    ...resistances.map(p => ({ price: p, type: 'resistance' })),
    { price: currentPrice, type: 'current' },
    ...supports.map(p => ({ price: p, type: 'support' }))
  ].sort((a, b) => b.price - a.price);

  for (const level of allLevels.slice(0, 5)) {
    const marker = document.createElement('div');
    marker.className = `level-marker ${level.type}`;
    marker.textContent = formatPrice(level.price);
    container.appendChild(marker);
  }
}

function updateChartPrice(price, change) {
  const priceEl = document.getElementById('chartPrice');
  const changeEl = document.getElementById('chartChange');
  if (priceEl) priceEl.textContent = '$' + formatPrice(price);
  if (changeEl) {
    changeEl.textContent = formatPercent(change);
    changeEl.className = 'chart-change ' + (change >= 0 ? 'up' : 'down');
  }
}

function initEquityChart() {
  const container = document.getElementById('equityChart');
  if (!container || typeof LightweightCharts === 'undefined') return;

  state.equityChart = LightweightCharts.createChart(container, {
    width: container.clientWidth,
    height: 120,
    layout: { background: { type: 'solid', color: '#111820' }, textColor: '#8b949e' },
    grid: { vertLines: { visible: false }, horzLines: { color: 'rgba(255, 255, 255, 0.03)' } },
    rightPriceScale: { visible: false },
    timeScale: { visible: false },
    crosshair: { mode: LightweightCharts.CrosshairMode.Hidden }
  });

  state.equitySeries = state.equityChart.addAreaSeries({
    lineColor: '#7c5cff',
    topColor: 'rgba(124, 92, 255, 0.3)',
    bottomColor: 'rgba(124, 92, 255, 0.05)',
    lineWidth: 2
  });

  updateEquityChart();
}

function updateEquityChart() {
  if (!state.equitySeries) return;

  const data = state.equityHistory.map(p => ({
    time: Math.floor(p.time / 1000),
    value: p.value
  }));

  if (data.length > 0) {
    state.equitySeries.setData(data);
    state.equityChart.timeScale().fitContent();
  }
}

// ============================================
// UI RENDERING
// ============================================

function renderMarkets() {
  const container = document.getElementById('marketList');
  if (!container) return;

  const html = state.markets.map(market => {
    const signal = state.signals.find(s => s.symbol === market.symbol);
    const isActive = market.symbol === state.selectedSymbol;

    let classes = 'market-item';
    if (isActive) classes += ' active';
    if (signal) classes += ` has-signal ${signal.direction.toLowerCase()}`;

    return `
      <div class="${classes}" data-symbol="${market.symbol}">
        <div class="market-row">
          <span class="market-symbol">${market.symbol.replace('USDT', '')}</span>
          <span class="market-change ${market.change >= 0 ? 'up' : 'down'}">${formatPercent(market.change)}</span>
        </div>
        <div class="market-meta">
          <span class="market-price">$${formatPrice(market.price)}</span>
          <span class="market-volume">Vol: ${formatVolume(market.volume)}</span>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = html;
  container.querySelectorAll('.market-item').forEach(el => {
    el.addEventListener('click', () => selectMarket(el.dataset.symbol));
  });
}

function renderSignals() {
  const container = document.getElementById('signalsList');
  if (!container) return;

  let signals = state.signals;
  if (state.signalFilter === 'longs') signals = signals.filter(s => s.direction === 'LONG');
  else if (state.signalFilter === 'shorts') signals = signals.filter(s => s.direction === 'SHORT');

  if (signals.length === 0) {
    container.innerHTML = '<div class="empty-state">No signals found</div>';
    return;
  }

  container.innerHTML = signals.map(signal => `
    <div class="signal-card ${signal.direction.toLowerCase()}" data-symbol="${signal.symbol}">
      <div class="signal-header">
        <div class="signal-symbol-info">
          <span class="signal-symbol">${signal.symbol.replace('USDT', '')}</span>
          <span class="signal-direction ${signal.direction.toLowerCase()}">${signal.direction}</span>
          <span class="signal-leverage">LEV ${CONFIG.LEVERAGE}x</span>
        </div>
        <div class="signal-confidence">
          <span class="conf-label">Total Conf:</span>
          <span class="conf-value">${signal.confidence}%</span>
          <span class="signal-time">${timeAgo(signal.timestamp)}</span>
        </div>
      </div>
      <div class="signal-body">
        <div class="signal-tags">
          ${signal.reasons.slice(0, 4).map((r, i) =>
            `<span class="signal-tag ${i < 2 ? 'active' : ''}">${r.split(' ').slice(0, 3).join(' ')}</span>`
          ).join('')}
        </div>
        <div class="signal-analysis">${signal.reasons.slice(0, 2).join('. ')}...</div>
        <div class="signal-levels">
          <div class="level-item rr"><div class="level-label">R/R Ratio</div><div class="level-value">1:${signal.riskReward.toFixed(1)}</div></div>
          <div class="level-item entry"><div class="level-label">Entry</div><div class="level-value">${formatPrice(signal.entry)}</div></div>
          <div class="level-item target"><div class="level-label">Target</div><div class="level-value">${formatPrice(signal.tp)}</div></div>
          <div class="level-item stop"><div class="level-label">Stop</div><div class="level-value">${formatPrice(signal.sl)}</div></div>
        </div>
      </div>
      <div class="signal-footer">
        <div class="footer-stat"><div class="label">Risk Amount ($)</div><div class="value">${(state.balance * CONFIG.RISK_PERCENT / 100).toFixed(0)}</div></div>
        <div class="footer-stat"><div class="label">SL Distance</div><div class="value red">${CONFIG.SL_PERCENT}%</div></div>
        <div class="footer-stat"><div class="label">Position Size</div><div class="value green">$${(state.balance * CONFIG.RISK_PERCENT / 100 * CONFIG.LEVERAGE).toFixed(0)}</div></div>
      </div>
    </div>
  `).join('');

  container.querySelectorAll('.signal-card').forEach(el => {
    el.addEventListener('click', () => selectMarket(el.dataset.symbol));
  });
}

function renderAlertBar() {
  const container = document.getElementById('alertBarSignals');
  if (!container) return;

  const highConfSignals = state.signals.filter(s => s.confidence >= CONFIG.HIGH_CONFIDENCE).slice(0, 5);

  if (highConfSignals.length === 0) {
    container.innerHTML = '<span class="muted">No high confidence signals</span>';
    return;
  }

  container.innerHTML = highConfSignals.map(s => `
    <div class="alert-signal" data-symbol="${s.symbol}">
      <span class="symbol">${s.symbol.replace('USDT', '')}</span>
      <span class="direction ${s.direction.toLowerCase()}">${s.direction}</span>
      <span class="entry">Entry ${formatPrice(s.entry)}</span>
      <span class="conf">Conf ${s.confidence}%</span>
    </div>
  `).join('');

  container.querySelectorAll('.alert-signal').forEach(el => {
    el.addEventListener('click', () => selectMarket(el.dataset.symbol));
  });
}

function renderMarketBias() {
  const longs = state.signals.filter(s => s.direction === 'LONG').length;
  const shorts = state.signals.filter(s => s.direction === 'SHORT').length;
  const total = longs + shorts || 1;

  const bullishPct = Math.round(longs / total * 100);
  const bearishPct = 100 - bullishPct;

  let biasText = 'Neutral';
  if (bullishPct >= 60) biasText = 'Bullish';
  else if (bearishPct >= 60) biasText = 'Bearish';

  const biasValueEl = document.getElementById('marketBiasValue');
  const biasBullEl = document.getElementById('biasFillBullish');
  const biasBearEl = document.getElementById('biasFillBearish');

  if (biasValueEl) biasValueEl.textContent = `${biasText} (${bullishPct}%)`;
  if (biasBullEl) biasBullEl.style.width = `${bullishPct}%`;
  if (biasBearEl) biasBearEl.style.width = `${bearishPct}%`;
}

function renderPositions() {
  const container = document.getElementById('positionsList');
  if (!container) return;

  const openTrades = state.trades.filter(t => t.status === 'open');

  if (openTrades.length === 0) {
    container.innerHTML = '<div class="empty-state">No open positions</div>';
    return;
  }

  container.innerHTML = openTrades.map(t => {
    const currentPrice = state.priceCache[t.symbol] || t.entry;
    const pnlPct = (t.pnl / t.size * 100).toFixed(2);

    return `
      <div class="position-item">
        <span class="symbol">${t.symbol.replace('USDT', '')}</span>
        <span class="direction ${t.direction.toLowerCase()}">${t.direction}</span>
        <span class="entry">$${formatPrice(t.entry)}</span>
        <span class="current">$${formatPrice(currentPrice)}</span>
        <span class="pnl ${t.pnl >= 0 ? 'positive' : 'negative'}">${t.pnl >= 0 ? '+' : ''}$${t.pnl.toFixed(2)}</span>
        <span class="pnl-pct ${t.pnl >= 0 ? 'positive' : 'negative'}">${pnlPct}%</span>
      </div>
    `;
  }).join('');
}

function renderHistory() {
  const container = document.getElementById('historyList');
  if (!container) return;

  const closedTrades = state.trades.filter(t => t.status === 'closed').slice(-20).reverse();

  if (closedTrades.length === 0) {
    container.innerHTML = '<div class="empty-state">No trade history</div>';
    return;
  }

  container.innerHTML = closedTrades.map(t => `
    <div class="history-item">
      <span class="symbol">${t.symbol.replace('USDT', '')}</span>
      <span class="direction ${t.direction.toLowerCase()}">${t.direction}</span>
      <span class="entry">$${formatPrice(t.entry)}</span>
      <span class="exit">$${formatPrice(t.exitPrice)}</span>
      <span class="pnl ${t.pnl >= 0 ? 'positive' : 'negative'}">${t.pnl >= 0 ? '+' : ''}$${t.pnl.toFixed(2)}</span>
      <span class="time">${timeAgo(t.closeTimestamp)}</span>
    </div>
  `).join('');
}

function renderAll() {
  renderMarkets();
  renderSignals();
  renderAlertBar();
  renderMarketBias();
  renderPositions();
  renderHistory();
  updatePortfolioStats();
  renderGrowthView();
}

// ============================================
// GROWTH VIEW RENDERING
// ============================================

function initGrowthChart() {
  const container = document.getElementById('growthChart');
  if (!container || typeof LightweightCharts === 'undefined') return;

  state.growthChart = LightweightCharts.createChart(container, {
    width: container.clientWidth,
    height: 300,
    layout: {
      background: { type: 'solid', color: '#0a0e14' },
      textColor: '#8b949e'
    },
    grid: {
      vertLines: { color: 'rgba(255, 255, 255, 0.03)' },
      horzLines: { color: 'rgba(255, 255, 255, 0.03)' }
    },
    rightPriceScale: {
      borderColor: 'rgba(255, 255, 255, 0.1)'
    },
    timeScale: {
      borderColor: 'rgba(255, 255, 255, 0.1)',
      timeVisible: true
    },
    crosshair: {
      mode: LightweightCharts.CrosshairMode.Normal
    }
  });

  state.growthSeries = state.growthChart.addAreaSeries({
    lineColor: '#7c5cff',
    topColor: 'rgba(124, 92, 255, 0.4)',
    bottomColor: 'rgba(124, 92, 255, 0.05)',
    lineWidth: 2
  });

  // Add baseline at starting balance
  state.growthSeries.createPriceLine({
    price: state.startBalance,
    color: '#8b949e',
    lineWidth: 1,
    lineStyle: 2,
    axisLabelVisible: true,
    title: 'Start'
  });

  new ResizeObserver(() => {
    if (state.growthChart) {
      state.growthChart.applyOptions({ width: container.clientWidth });
    }
  }).observe(container);

  updateGrowthChart();
}

function updateGrowthChart() {
  if (!state.growthSeries) return;

  const data = state.equityHistory.map(p => ({
    time: Math.floor(p.time / 1000),
    value: p.value
  }));

  if (data.length > 0) {
    state.growthSeries.setData(data);
    state.growthChart.timeScale().fitContent();
  }
}

function renderGrowthView() {
  const closedTrades = state.trades.filter(t => t.status === 'closed');
  const openTrades = state.trades.filter(t => t.status === 'open');
  const wins = closedTrades.filter(t => t.pnl > 0);
  const losses = closedTrades.filter(t => t.pnl < 0);

  const totalPnl = state.balance - state.startBalance;
  const winRate = closedTrades.length > 0 ? (wins.length / closedTrades.length * 100) : 0;
  const avgWin = wins.length > 0 ? wins.reduce((a, t) => a + t.pnl, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((a, t) => a + t.pnl, 0) / losses.length) : 0;
  const totalWins = wins.reduce((a, t) => a + t.pnl, 0);
  const totalLosses = Math.abs(losses.reduce((a, t) => a + t.pnl, 0));
  const profitFactor = totalLosses > 0 ? (totalWins / totalLosses) : totalWins > 0 ? 999 : 0;
  const maxDd = calculateMaxDrawdown();

  // Update stat cards
  const growthEquity = document.getElementById('growthEquity');
  const growthTotalPnl = document.getElementById('growthTotalPnl');
  const growthWinRate = document.getElementById('growthWinRate');
  const growthPnlIcon = document.getElementById('growthPnlIcon');

  if (growthEquity) growthEquity.textContent = '$' + state.balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (growthTotalPnl) {
    growthTotalPnl.textContent = (totalPnl >= 0 ? '+' : '') + '$' + totalPnl.toFixed(2);
    growthTotalPnl.style.color = totalPnl >= 0 ? 'var(--green)' : 'var(--red)';
  }
  if (growthPnlIcon) growthPnlIcon.className = 'stat-icon ' + (totalPnl >= 0 ? 'green' : 'red');
  if (growthWinRate) growthWinRate.textContent = winRate.toFixed(0) + '%';

  // Update statistics
  const els = {
    growthTotalTrades: closedTrades.length,
    growthWinTrades: wins.length,
    growthLossTrades: losses.length,
    growthAvgWin: '$' + avgWin.toFixed(2),
    growthAvgLoss: '$' + avgLoss.toFixed(2),
    growthMaxDD: maxDd.toFixed(1) + '%',
    growthProfitFactor: profitFactor.toFixed(2),
    growthOpenPos: openTrades.length
  };

  for (const [id, value] of Object.entries(els)) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  // Render trade history table
  renderGrowthHistoryTable();

  // Update chart
  updateGrowthChart();
}

function renderGrowthHistoryTable() {
  const tbody = document.getElementById('growthHistoryBody');
  if (!tbody) return;

  const allTrades = [...state.trades].sort((a, b) => b.timestamp - a.timestamp);

  if (allTrades.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">No trades yet</td></tr>';
    return;
  }

  tbody.innerHTML = allTrades.map(t => {
    const time = new Date(t.timestamp).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    return `
      <tr>
        <td>${time}</td>
        <td><strong>${t.symbol.replace('USDT', '')}</strong></td>
        <td><span class="side-${t.direction.toLowerCase()}">${t.direction}</span></td>
        <td>$${formatPrice(t.entry)}</td>
        <td>${t.exitPrice ? '$' + formatPrice(t.exitPrice) : '-'}</td>
        <td class="${t.pnl >= 0 ? 'pnl-positive' : 'pnl-negative'}">${t.pnl >= 0 ? '+' : ''}$${t.pnl.toFixed(2)}</td>
        <td><span class="status-${t.status}">${t.status.toUpperCase()}</span></td>
      </tr>
    `;
  }).join('');
}

function resetAccount() {
  if (!confirm('Are you sure you want to reset your paper trading account? This will clear all trades and reset balance to $2,000.')) {
    return;
  }

  state.balance = state.startBalance;
  state.trades = [];
  state.equityHistory = [{ time: Date.now(), value: state.startBalance }];

  saveTrades();
  renderAll();
  updateEquityChart();

  if (state.growthSeries) {
    state.growthSeries.setData([{ time: Math.floor(Date.now() / 1000), value: state.startBalance }]);
  }
}

// ============================================
// UI HELPERS
// ============================================

function selectMarket(symbol) {
  state.selectedSymbol = symbol;
  const symbolNameEl = document.getElementById('chartSymbolName');
  if (symbolNameEl) symbolNameEl.textContent = symbol;

  const market = state.markets.find(m => m.symbol === symbol);
  if (market) updateChartPrice(market.price, market.change);

  renderMarkets();
  loadChartData();
}

function updateScanStatus(current, found) {
  const progressEl = document.getElementById('scanProgress');
  const analyzedEl = document.getElementById('analyzedCount');
  if (progressEl) progressEl.textContent = current;
  if (analyzedEl) analyzedEl.textContent = `${found} analyzed`;
}

function updateDataSource(name, isLive) {
  const nameEl = document.getElementById('dataSourceName');
  const statusEl = document.getElementById('dataSourceStatus');
  if (nameEl) nameEl.textContent = name;
  if (statusEl) {
    statusEl.textContent = isLive ? '● Live' : '● Offline';
    statusEl.style.color = isLive ? 'var(--green)' : 'var(--red)';
  }
}

function showNotification(signal) {
  if (state.soundEnabled) {
    const audio = document.getElementById('alertSound');
    if (audio) audio.play().catch(() => {});
  }

  const container = document.getElementById('notificationContainer');
  if (!container) return;

  const notification = document.createElement('div');
  notification.className = `notification ${signal.direction.toLowerCase()}`;
  notification.innerHTML = `
    <div class="notification-header">
      <span class="notification-icon">${signal.direction === 'LONG' ? '📈' : '📉'}</span>
      <span class="notification-title">${signal.symbol} ${signal.direction}</span>
      <button class="notification-close">&times;</button>
    </div>
    <div class="notification-body">
      <div class="notification-signal">
        <span class="notification-conf">Confidence: ${signal.confidence}%</span>
      </div>
      <div class="notification-reason">${signal.reasons[0]}</div>
    </div>
  `;

  container.appendChild(notification);

  notification.querySelector('.notification-close').addEventListener('click', () => {
    notification.classList.add('closing');
    setTimeout(() => notification.remove(), 300);
  });

  setTimeout(() => {
    if (notification.parentElement) {
      notification.classList.add('closing');
      setTimeout(() => notification.remove(), 300);
    }
  }, 8000);
}

// ============================================
// PERSISTENCE
// ============================================

function saveTrades() {
  localStorage.setItem('sentient_trades', JSON.stringify(state.trades));
  localStorage.setItem('sentient_balance', state.balance.toString());
  localStorage.setItem('sentient_equity', JSON.stringify(state.equityHistory));
}

function loadTrades() {
  try {
    const trades = localStorage.getItem('sentient_trades');
    const balance = localStorage.getItem('sentient_balance');
    const equity = localStorage.getItem('sentient_equity');

    if (trades) state.trades = JSON.parse(trades);
    if (balance) state.balance = parseFloat(balance);
    if (equity) state.equityHistory = JSON.parse(equity);
  } catch (e) {
    console.error('Failed to load saved data:', e);
  }
}

// ============================================
// EVENT LISTENERS
// ============================================

function initEventListeners() {
  // Navigation
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const view = btn.dataset.view;
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      const viewEl = document.getElementById(`view-${view}`);
      if (viewEl) viewEl.classList.add('active');

      // Initialize growth chart when switching to growth view
      if (view === 'growth' && !state.growthChart) {
        setTimeout(initGrowthChart, 100);
      }
    });
  });

  // Timeframe buttons
  document.querySelectorAll('.tf-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.currentTimeframe = btn.dataset.tf;
      loadChartData();
    });
  });

  // Tool buttons
  const toggleSR = document.getElementById('toggleSR');
  if (toggleSR) {
    toggleSR.addEventListener('click', (e) => {
      e.target.classList.toggle('active');
      state.showSR = e.target.classList.contains('active');
      loadChartData();
    });
  }

  const toggleVolume = document.getElementById('toggleVolume');
  if (toggleVolume) {
    toggleVolume.addEventListener('click', (e) => {
      e.target.classList.toggle('active');
      state.showVolume = e.target.classList.contains('active');
      if (state.volumeSeries) state.volumeSeries.applyOptions({ visible: state.showVolume });
    });
  }

  // Signal tabs
  document.querySelectorAll('.signal-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.signal-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
    });
  });

  // Signal filters
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.signalFilter = btn.dataset.filter;
      renderSignals();
    });
  });

  // Portfolio tabs
  document.querySelectorAll('.portfolio-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.portfolio-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      const tabContent = document.getElementById(`tab-${tab.dataset.tab}`);
      if (tabContent) tabContent.classList.add('active');
    });
  });

  // Refresh button
  const refreshBtn = document.getElementById('refreshBtn');
  if (refreshBtn) refreshBtn.addEventListener('click', () => runScan());

  // Reset account button
  const resetBtn = document.getElementById('resetAccountBtn');
  if (resetBtn) resetBtn.addEventListener('click', resetAccount);

  // Growth period buttons
  document.querySelectorAll('.growth-period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.growth-period-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      // Period filtering could be added here
    });
  });
}

// ============================================
// INITIALIZATION
// ============================================

async function init() {
  loadTrades();

  state.markets = await fetchMarkets();
  renderMarkets();

  initChart();
  initEquityChart();

  if (state.markets.length > 0) selectMarket(state.markets[0].symbol);

  initWebSocket();
  initEventListeners();

  runScan();

  setInterval(runScan, CONFIG.SCAN_INTERVAL);
  setInterval(updateOpenPositions, CONFIG.PNL_UPDATE_INTERVAL);
  setInterval(renderMarkets, 2000);

  console.log('Sentient Trader initialized');
}

document.addEventListener('DOMContentLoaded', init);
