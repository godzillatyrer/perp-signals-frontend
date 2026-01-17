// ============================================
// AI PERP SIGNALS - CRYPTO TRADING INTELLIGENCE
// ============================================

// --- Configuration ---
const CONFIG = {
  BINANCE_API: 'https://fapi.binance.com',
  SCAN_INTERVAL: 120000, // 2 minutes
  TOP_COINS_COUNT: 50,
  STARTING_BALANCE: 2000,
  AUTO_TRADE_THRESHOLD: 80,
  DEFAULT_LEVERAGE: 5,
  POSITION_SIZE_PERCENT: 5, // 5% of balance per trade
  TAKE_PROFIT_PERCENT: 2,
  STOP_LOSS_PERCENT: 1,
  TIMEFRAMES: ['5m', '15m', '1h', '4h'],
};

// --- State Management ---
const state = {
  markets: [],
  signals: [],
  trades: [],
  selectedSymbol: 'BTCUSDT',
  balance: CONFIG.STARTING_BALANCE,
  equityHistory: [CONFIG.STARTING_BALANCE],
  maxBalance: CONFIG.STARTING_BALANCE,
  isScanning: false,
  soundEnabled: true,
  drawingsVisible: true,
  currentTimeframe: '15',
  previousHighConfSignals: new Set(),
  alerts: [],
  priceCache: {},
  klineCache: {},
  tradingviewWidget: null,
};

// --- Utility Functions ---
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function formatPrice(price, decimals = 2) {
  if (price >= 1000) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 1) return price.toFixed(decimals);
  if (price >= 0.01) return price.toFixed(4);
  return price.toFixed(6);
}

function formatVolume(vol) {
  if (vol >= 1e9) return (vol / 1e9).toFixed(2) + 'B';
  if (vol >= 1e6) return (vol / 1e6).toFixed(2) + 'M';
  if (vol >= 1e3) return (vol / 1e3).toFixed(2) + 'K';
  return vol.toFixed(2);
}

function formatPnL(pnl) {
  const sign = pnl >= 0 ? '+' : '';
  return sign + '$' + Math.abs(pnl).toFixed(2);
}

function getTimeAgo(date) {
  const seconds = Math.floor((new Date() - date) / 1000);
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
  if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
  return Math.floor(seconds / 86400) + 'd ago';
}

// --- Binance API Integration ---
async function fetchWithRetry(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      if (i === retries - 1) throw error;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

async function getTop50Perps() {
  try {
    const ticker24h = await fetchWithRetry(`${CONFIG.BINANCE_API}/fapi/v1/ticker/24hr`);

    // Filter USDT perpetuals and sort by volume
    const perps = ticker24h
      .filter(t => t.symbol.endsWith('USDT') && !t.symbol.includes('_'))
      .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
      .slice(0, CONFIG.TOP_COINS_COUNT)
      .map(t => ({
        symbol: t.symbol,
        price: parseFloat(t.lastPrice),
        priceChange: parseFloat(t.priceChangePercent),
        volume: parseFloat(t.quoteVolume),
        high24h: parseFloat(t.highPrice),
        low24h: parseFloat(t.lowPrice),
      }));

    state.markets = perps;
    state.priceCache = {};
    perps.forEach(p => state.priceCache[p.symbol] = p.price);

    return perps;
  } catch (error) {
    console.error('Failed to fetch markets:', error);
    return state.markets;
  }
}

async function getKlines(symbol, interval = '15m', limit = 200) {
  const cacheKey = `${symbol}_${interval}`;
  const now = Date.now();

  // Return cached if less than 30 seconds old
  if (state.klineCache[cacheKey] && now - state.klineCache[cacheKey].timestamp < 30000) {
    return state.klineCache[cacheKey].data;
  }

  try {
    const klines = await fetchWithRetry(
      `${CONFIG.BINANCE_API}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
    );

    const data = klines.map(k => ({
      time: k[0],
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }));

    state.klineCache[cacheKey] = { data, timestamp: now };
    return data;
  } catch (error) {
    console.error(`Failed to fetch klines for ${symbol}:`, error);
    return [];
  }
}

// --- Technical Indicators ---
function calculateRSI(closes, period = 14) {
  if (closes.length < period + 1) return 50;

  let gains = 0, losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) {
      avgGain = (avgGain * (period - 1) + diff) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) - diff) / period;
    }
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calculateEMA(data, period) {
  if (data.length < period) return data[data.length - 1] || 0;

  const multiplier = 2 / (period + 1);
  let ema = data.slice(0, period).reduce((a, b) => a + b) / period;

  for (let i = period; i < data.length; i++) {
    ema = (data[i] - ema) * multiplier + ema;
  }

  return ema;
}

function calculateMACD(closes, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  if (closes.length < slowPeriod + signalPeriod) {
    return { macd: 0, signal: 0, histogram: 0 };
  }

  const fastEMA = calculateEMAArray(closes, fastPeriod);
  const slowEMA = calculateEMAArray(closes, slowPeriod);

  const macdLine = fastEMA.map((fast, i) => fast - slowEMA[i]);
  const signalLine = calculateEMAArray(macdLine.slice(-signalPeriod * 2), signalPeriod);

  const currentMACD = macdLine[macdLine.length - 1];
  const currentSignal = signalLine[signalLine.length - 1];
  const prevMACD = macdLine[macdLine.length - 2];
  const prevSignal = signalLine[signalLine.length - 2];

  return {
    macd: currentMACD,
    signal: currentSignal,
    histogram: currentMACD - currentSignal,
    crossUp: prevMACD <= prevSignal && currentMACD > currentSignal,
    crossDown: prevMACD >= prevSignal && currentMACD < currentSignal,
  };
}

function calculateEMAArray(data, period) {
  const result = [];
  const multiplier = 2 / (period + 1);
  let ema = data.slice(0, period).reduce((a, b) => a + b) / period;

  for (let i = 0; i < period; i++) {
    result.push(ema);
  }

  for (let i = period; i < data.length; i++) {
    ema = (data[i] - ema) * multiplier + ema;
    result.push(ema);
  }

  return result;
}

function findSupportResistance(klines) {
  if (klines.length < 50) return { supports: [], resistances: [] };

  const highs = klines.map(k => k.high);
  const lows = klines.map(k => k.low);
  const currentPrice = klines[klines.length - 1].close;

  // Find swing highs and lows
  const swingHighs = [];
  const swingLows = [];

  for (let i = 5; i < klines.length - 5; i++) {
    const isSwingHigh = highs[i] === Math.max(...highs.slice(i - 5, i + 6));
    const isSwingLow = lows[i] === Math.min(...lows.slice(i - 5, i + 6));

    if (isSwingHigh) swingHighs.push(highs[i]);
    if (isSwingLow) swingLows.push(lows[i]);
  }

  // Cluster similar levels
  const clusterLevels = (levels, threshold = 0.005) => {
    const clusters = [];
    const sorted = [...levels].sort((a, b) => a - b);

    for (const level of sorted) {
      const existingCluster = clusters.find(c => Math.abs(c.price - level) / level < threshold);
      if (existingCluster) {
        existingCluster.count++;
        existingCluster.price = (existingCluster.price + level) / 2;
      } else {
        clusters.push({ price: level, count: 1 });
      }
    }

    return clusters.sort((a, b) => b.count - a.count).slice(0, 5);
  };

  const resistanceLevels = clusterLevels(swingHighs)
    .filter(l => l.price > currentPrice)
    .sort((a, b) => a.price - b.price)
    .slice(0, 2);

  const supportLevels = clusterLevels(swingLows)
    .filter(l => l.price < currentPrice)
    .sort((a, b) => b.price - a.price)
    .slice(0, 2);

  return {
    supports: supportLevels.map(l => l.price),
    resistances: resistanceLevels.map(l => l.price),
  };
}

// --- AI Signal Generation ---
async function analyzeSymbol(symbol, timeframe = '15m') {
  const klines = await getKlines(symbol, timeframe, 200);
  if (klines.length < 50) return null;

  const closes = klines.map(k => k.close);
  const currentPrice = closes[closes.length - 1];

  // Calculate indicators
  const rsi = calculateRSI(closes);
  const ema200 = calculateEMA(closes, 200);
  const ema50 = calculateEMA(closes, 50);
  const macd = calculateMACD(closes);
  const { supports, resistances } = findSupportResistance(klines);

  // Score calculation
  let bullishScore = 0;
  let bearishScore = 0;
  const reasons = [];

  // RSI Analysis
  if (rsi < 30) {
    bullishScore += 20;
    reasons.push({ type: 'bullish', text: 'RSI oversold (' + rsi.toFixed(1) + ')' });
  } else if (rsi > 70) {
    bearishScore += 20;
    reasons.push({ type: 'bearish', text: 'RSI overbought (' + rsi.toFixed(1) + ')' });
  } else if (rsi > 50 && rsi < 70) {
    bullishScore += 10;
    reasons.push({ type: 'bullish', text: 'RSI bullish momentum (' + rsi.toFixed(1) + ')' });
  } else if (rsi < 50 && rsi > 30) {
    bearishScore += 10;
    reasons.push({ type: 'bearish', text: 'RSI bearish momentum (' + rsi.toFixed(1) + ')' });
  }

  // EMA200 Analysis
  if (currentPrice > ema200) {
    bullishScore += 25;
    reasons.push({ type: 'bullish', text: 'Price above EMA200 (bullish trend)' });
  } else {
    bearishScore += 25;
    reasons.push({ type: 'bearish', text: 'Price below EMA200 (bearish trend)' });
  }

  // EMA50/200 Cross
  if (ema50 > ema200) {
    bullishScore += 10;
    reasons.push({ type: 'bullish', text: 'EMA50 above EMA200 (golden cross zone)' });
  } else {
    bearishScore += 10;
    reasons.push({ type: 'bearish', text: 'EMA50 below EMA200 (death cross zone)' });
  }

  // MACD Analysis
  if (macd.crossUp) {
    bullishScore += 25;
    reasons.push({ type: 'bullish', text: 'MACD bullish crossover' });
  } else if (macd.crossDown) {
    bearishScore += 25;
    reasons.push({ type: 'bearish', text: 'MACD bearish crossover' });
  } else if (macd.histogram > 0 && macd.histogram > macd.macd * 0.1) {
    bullishScore += 15;
    reasons.push({ type: 'bullish', text: 'MACD histogram rising' });
  } else if (macd.histogram < 0 && macd.histogram < macd.macd * 0.1) {
    bearishScore += 15;
    reasons.push({ type: 'bearish', text: 'MACD histogram falling' });
  }

  // Support/Resistance Analysis
  if (supports.length > 0) {
    const nearestSupport = supports[0];
    const distToSupport = (currentPrice - nearestSupport) / currentPrice;
    if (distToSupport < 0.02) {
      bullishScore += 20;
      reasons.push({ type: 'bullish', text: 'Price near strong support ($' + formatPrice(nearestSupport) + ')' });
    }
  }

  if (resistances.length > 0) {
    const nearestResistance = resistances[0];
    const distToResistance = (nearestResistance - currentPrice) / currentPrice;
    if (distToResistance < 0.02) {
      bearishScore += 20;
      reasons.push({ type: 'bearish', text: 'Price near resistance ($' + formatPrice(nearestResistance) + ')' });
    }
  }

  // Volume analysis (simple: compare last candle to average)
  const volumes = klines.map(k => k.volume);
  const avgVolume = volumes.slice(-20).reduce((a, b) => a + b) / 20;
  const lastVolume = volumes[volumes.length - 1];

  if (lastVolume > avgVolume * 1.5) {
    if (closes[closes.length - 1] > closes[closes.length - 2]) {
      bullishScore += 10;
      reasons.push({ type: 'bullish', text: 'High volume on bullish candle' });
    } else {
      bearishScore += 10;
      reasons.push({ type: 'bearish', text: 'High volume on bearish candle' });
    }
  }

  // Determine direction and confidence
  const totalScore = bullishScore + bearishScore;
  const direction = bullishScore > bearishScore ? 'LONG' : 'SHORT';
  const dominantScore = Math.max(bullishScore, bearishScore);
  const confidence = Math.min(95, Math.round((dominantScore / Math.max(totalScore, 1)) * 100 * (dominantScore / 100)));

  // Filter reasons by direction
  const filteredReasons = reasons
    .filter(r => r.type === (direction === 'LONG' ? 'bullish' : 'bearish'))
    .map(r => r.text)
    .slice(0, 4);

  return {
    symbol,
    direction,
    timeframe,
    confidence,
    price: currentPrice,
    rsi,
    ema200,
    macd,
    supports,
    resistances,
    tldr: filteredReasons.length > 0 ? filteredReasons : ['Technical setup detected'],
    timestamp: Date.now(),
  };
}

async function runAIScan() {
  if (state.isScanning) return;

  state.isScanning = true;
  updateScanStatus('Scanning...');
  $('#scanDot').classList.add('active');

  try {
    await getTop50Perps();
    const signals = [];

    // Analyze each market
    for (const market of state.markets.slice(0, 30)) { // Limit to top 30 for performance
      for (const tf of ['15m', '1h', '4h']) {
        try {
          const signal = await analyzeSymbol(market.symbol, tf);
          if (signal && signal.confidence >= 50) {
            signals.push(signal);
          }
        } catch (e) {
          console.warn(`Failed to analyze ${market.symbol} ${tf}:`, e);
        }
      }
      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 100));
    }

    // Sort by confidence
    signals.sort((a, b) => b.confidence - a.confidence);

    // Check for new high confidence signals
    const currentHighConf = new Set(
      signals.filter(s => s.confidence >= 80).map(s => `${s.symbol}_${s.timeframe}_${s.direction}`)
    );

    for (const signalKey of currentHighConf) {
      if (!state.previousHighConfSignals.has(signalKey)) {
        const signal = signals.find(s => `${s.symbol}_${s.timeframe}_${s.direction}` === signalKey);
        if (signal) {
          showNotification(signal);
          addAlert(signal);

          // Auto-trade if enabled
          if (signal.confidence >= CONFIG.AUTO_TRADE_THRESHOLD) {
            autoTrade(signal);
          }
        }
      }
    }

    state.previousHighConfSignals = currentHighConf;
    state.signals = signals;

    // Update UI
    renderAll();
    updateLastUpdate();

  } catch (error) {
    console.error('Scan failed:', error);
  } finally {
    state.isScanning = false;
    $('#scanDot').classList.remove('active');
  }
}

// --- Paper Trading System ---
function autoTrade(signal) {
  // Check if we already have an open position for this symbol
  const existingOpen = state.trades.find(t => t.symbol === signal.symbol && t.status === 'OPEN');
  if (existingOpen) return;

  const positionSize = state.balance * (CONFIG.POSITION_SIZE_PERCENT / 100);
  const leverage = CONFIG.DEFAULT_LEVERAGE;

  const trade = {
    id: Date.now(),
    symbol: signal.symbol,
    direction: signal.direction,
    leverage: leverage,
    entry: signal.price,
    exit: null,
    confidence: signal.confidence,
    positionSize: positionSize,
    pnl: 0,
    pnlPercent: 0,
    status: 'OPEN',
    openTime: new Date(),
    closeTime: null,
    takeProfit: signal.direction === 'LONG'
      ? signal.price * (1 + CONFIG.TAKE_PROFIT_PERCENT / 100)
      : signal.price * (1 - CONFIG.TAKE_PROFIT_PERCENT / 100),
    stopLoss: signal.direction === 'LONG'
      ? signal.price * (1 - CONFIG.STOP_LOSS_PERCENT / 100)
      : signal.price * (1 + CONFIG.STOP_LOSS_PERCENT / 100),
  };

  state.trades.unshift(trade);
  saveState();

  showNotification({
    ...signal,
    isTradeOpen: true,
  });
}

function updateOpenPositions() {
  for (const trade of state.trades.filter(t => t.status === 'OPEN')) {
    const currentPrice = state.priceCache[trade.symbol];
    if (!currentPrice) continue;

    // Calculate unrealized PnL
    let priceDiff;
    if (trade.direction === 'LONG') {
      priceDiff = (currentPrice - trade.entry) / trade.entry;
    } else {
      priceDiff = (trade.entry - currentPrice) / trade.entry;
    }

    trade.pnlPercent = priceDiff * 100 * trade.leverage;
    trade.pnl = trade.positionSize * priceDiff * trade.leverage;

    // Check TP/SL
    if (trade.direction === 'LONG') {
      if (currentPrice >= trade.takeProfit || currentPrice <= trade.stopLoss) {
        closeTrade(trade, currentPrice);
      }
    } else {
      if (currentPrice <= trade.takeProfit || currentPrice >= trade.stopLoss) {
        closeTrade(trade, currentPrice);
      }
    }
  }
}

function closeTrade(trade, exitPrice) {
  trade.status = 'CLOSED';
  trade.exit = exitPrice;
  trade.closeTime = new Date();

  // Final PnL calculation
  let priceDiff;
  if (trade.direction === 'LONG') {
    priceDiff = (exitPrice - trade.entry) / trade.entry;
  } else {
    priceDiff = (trade.entry - exitPrice) / trade.entry;
  }

  trade.pnlPercent = priceDiff * 100 * trade.leverage;
  trade.pnl = trade.positionSize * priceDiff * trade.leverage;

  // Update balance
  state.balance += trade.pnl;
  state.equityHistory.push(state.balance);
  state.maxBalance = Math.max(state.maxBalance, state.balance);

  saveState();
  renderPnL();
}

function getTradeStats() {
  const closedTrades = state.trades.filter(t => t.status === 'CLOSED');
  const openTrades = state.trades.filter(t => t.status === 'OPEN');

  const wins = closedTrades.filter(t => t.pnl > 0);
  const losses = closedTrades.filter(t => t.pnl < 0);

  const totalPnL = closedTrades.reduce((sum, t) => sum + t.pnl, 0);
  const unrealizedPnL = openTrades.reduce((sum, t) => sum + t.pnl, 0);

  const winRate = closedTrades.length > 0
    ? (wins.length / closedTrades.length * 100).toFixed(1)
    : 0;

  // Calculate max drawdown
  let maxDrawdown = 0;
  let peak = CONFIG.STARTING_BALANCE;
  for (const equity of state.equityHistory) {
    if (equity > peak) peak = equity;
    const drawdown = (peak - equity) / peak * 100;
    maxDrawdown = Math.max(maxDrawdown, drawdown);
  }

  return {
    totalPnL,
    unrealizedPnL,
    winRate,
    totalTrades: closedTrades.length,
    openPositions: openTrades.length,
    maxDrawdown: maxDrawdown.toFixed(1),
  };
}

// --- Notifications & Alerts ---
function showNotification(signal) {
  if (!state.soundEnabled) return;

  // Play sound
  const audio = $('#alertSound');
  if (audio) {
    audio.currentTime = 0;
    audio.play().catch(() => {});
  }

  // Create notification element
  const container = $('#notificationContainer');
  const notification = document.createElement('div');
  notification.className = `notification ${signal.direction.toLowerCase()} ${signal.isTradeOpen ? 'trade' : ''}`;

  notification.innerHTML = `
    <div class="notification-header">
      <span class="notification-icon">
        ${signal.isTradeOpen ? '&#9889;' : '&#128200;'}
      </span>
      <span class="notification-title">
        ${signal.isTradeOpen ? 'Trade Opened' : 'New Signal'}: ${signal.symbol}
      </span>
      <button class="notification-close">&times;</button>
    </div>
    <div class="notification-body">
      <div class="notification-signal">
        <span class="tag ${signal.direction.toLowerCase()}">${signal.direction}</span>
        <span class="notification-conf">${signal.confidence}% confidence</span>
      </div>
      <div class="notification-reason">${signal.tldr[0]}</div>
    </div>
  `;

  notification.querySelector('.notification-close').addEventListener('click', () => {
    notification.classList.add('closing');
    setTimeout(() => notification.remove(), 300);
  });

  container.appendChild(notification);

  // Auto-remove after 10 seconds
  setTimeout(() => {
    if (notification.parentNode) {
      notification.classList.add('closing');
      setTimeout(() => notification.remove(), 300);
    }
  }, 10000);
}

function addAlert(signal) {
  state.alerts.unshift({
    ...signal,
    id: Date.now(),
    time: new Date(),
  });

  // Keep only last 20 alerts
  state.alerts = state.alerts.slice(0, 20);
  renderAlerts();
}

function renderAlerts() {
  const container = $('#alertsList');

  if (state.alerts.length === 0) {
    container.innerHTML = `
      <div class="empty-state small">
        <span class="muted">Waiting for signals...</span>
      </div>
    `;
    return;
  }

  container.innerHTML = state.alerts.map(alert => `
    <div class="alert-item ${alert.direction.toLowerCase()}" data-symbol="${alert.symbol}">
      <div class="alert-header">
        <span class="alert-symbol">${alert.symbol}</span>
        <span class="tag small ${alert.direction.toLowerCase()}">${alert.direction}</span>
      </div>
      <div class="alert-meta">
        <span class="alert-conf">${alert.confidence}%</span>
        <span class="alert-time">${getTimeAgo(alert.time)}</span>
      </div>
    </div>
  `).join('');

  // Add click handlers
  container.querySelectorAll('.alert-item').forEach(item => {
    item.addEventListener('click', () => {
      state.selectedSymbol = item.dataset.symbol;
      setView('charts');
      renderAll();
    });
  });
}

// --- TradingView Integration ---
function initTradingViewChart() {
  const container = $('#tradingviewChart');
  if (!container) return;

  // Clear loading spinner
  container.innerHTML = '';

  try {
    state.tradingviewWidget = new TradingView.widget({
      container_id: 'tradingviewChart',
      symbol: `BINANCE:${state.selectedSymbol}.P`,
      interval: state.currentTimeframe,
      timezone: 'Etc/UTC',
      theme: 'dark',
      style: '1',
      locale: 'en',
      toolbar_bg: '#0f1624',
      enable_publishing: false,
      hide_side_toolbar: false,
      allow_symbol_change: false,
      studies: ['RSI@tv-basicstudies', 'MACD@tv-basicstudies', 'EMA@tv-basicstudies'],
      overrides: {
        'mainSeriesProperties.candleStyle.upColor': '#37d67a',
        'mainSeriesProperties.candleStyle.downColor': '#ff5c77',
        'mainSeriesProperties.candleStyle.wickUpColor': '#37d67a',
        'mainSeriesProperties.candleStyle.wickDownColor': '#ff5c77',
        'paneProperties.background': '#0f1624',
        'paneProperties.vertGridProperties.color': 'rgba(255,255,255,0.05)',
        'paneProperties.horzGridProperties.color': 'rgba(255,255,255,0.05)',
      },
      loading_screen: { backgroundColor: '#0f1624', foregroundColor: '#7c5cff' },
      autosize: true,
    });
  } catch (error) {
    console.error('Failed to init TradingView:', error);
    container.innerHTML = `
      <div class="chart-fallback">
        <div class="chart-fallback-content">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="20" x2="18" y2="10"/>
            <line x1="12" y1="20" x2="12" y2="4"/>
            <line x1="6" y1="20" x2="6" y2="14"/>
          </svg>
          <div class="muted">TradingView chart for ${state.selectedSymbol}</div>
          <a href="https://www.tradingview.com/chart/?symbol=BINANCE:${state.selectedSymbol}.P" target="_blank" class="btn">
            Open in TradingView
          </a>
        </div>
      </div>
    `;
  }
}

function updateTradingViewSymbol() {
  if (state.tradingviewWidget && state.tradingviewWidget.iframe) {
    // Reinitialize with new symbol
    initTradingViewChart();
  }
}

// --- UI Rendering ---
function renderMarkets(list) {
  const el = $('#marketList');

  if (!list || list.length === 0) {
    el.innerHTML = `
      <div class="loading-spinner">
        <div class="spinner"></div>
        <span>Loading markets...</span>
      </div>
    `;
    return;
  }

  el.innerHTML = list.map(m => {
    const signal = state.signals.find(s => s.symbol === m.symbol);
    const hasSignal = signal && signal.confidence >= 70;

    return `
      <div class="market-item ${m.symbol === state.selectedSymbol ? 'active' : ''} ${hasSignal ? 'has-signal' : ''}"
           role="option" data-symbol="${m.symbol}">
        <div class="market-left">
          <div class="market-symbol">
            ${m.symbol.replace('USDT', '')}
            ${hasSignal ? `<span class="signal-dot ${signal.direction.toLowerCase()}"></span>` : ''}
          </div>
          <div class="market-meta">Perp | Vol: ${formatVolume(m.volume)}</div>
        </div>
        <div class="market-right">
          <div class="market-price">$${formatPrice(m.price)}</div>
          <div class="market-chg ${m.priceChange >= 0 ? 'up' : 'down'}">
            ${m.priceChange >= 0 ? '+' : ''}${m.priceChange.toFixed(2)}%
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Add click handlers
  el.querySelectorAll('.market-item').forEach(item => {
    item.addEventListener('click', () => {
      state.selectedSymbol = item.dataset.symbol;
      renderAll();
      updateTradingViewSymbol();
    });
  });
}

function applyMarketSearch() {
  const q = $('#marketSearch').value.trim().toUpperCase();
  if (!q) return state.markets;
  return state.markets.filter(m => m.symbol.includes(q));
}

function renderTopSignals() {
  const tbody = $('#topSignalsTable tbody');
  const top = state.signals.slice(0, 8);

  if (top.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="empty-cell">
          <div class="loading-spinner small">
            <div class="spinner"></div>
            <span>Analyzing markets...</span>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = top.map(s => `
    <tr class="signal-row" data-symbol="${s.symbol}">
      <td>
        <strong>${s.symbol.replace('USDT', '')}</strong>
        <span class="muted">/USDT</span>
      </td>
      <td><span class="tag ${s.direction.toLowerCase()}">${s.direction}</span></td>
      <td><span class="tf-badge">${s.timeframe}</span></td>
      <td><span class="conf ${confClass(s.confidence)}">${s.confidence}%</span></td>
      <td class="muted truncate">${s.tldr[0]}</td>
    </tr>
  `).join('');

  tbody.querySelectorAll('.signal-row').forEach(row => {
    row.addEventListener('click', () => {
      state.selectedSymbol = row.dataset.symbol;
      setView('charts');
      renderAll();
    });
  });
}

function renderSignalsTable() {
  const tbody = $('#signalsTable tbody');
  const filters = getFilters();
  const list = applySignalFilters(filters);

  // Update stats
  $('#totalSignals').textContent = list.length;
  $('#longSignals').textContent = list.filter(s => s.direction === 'LONG').length;
  $('#shortSignals').textContent = list.filter(s => s.direction === 'SHORT').length;
  $('#highConfSignals').textContent = list.filter(s => s.confidence >= 80).length;

  if (list.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="empty-cell muted">
          No signals match your filters. Try lowering the minimum confidence.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = list.map(s => `
    <tr class="signal-row" data-symbol="${s.symbol}">
      <td>
        <strong>${s.symbol.replace('USDT', '')}</strong>
        <span class="muted">/USDT</span>
      </td>
      <td><span class="tag ${s.direction.toLowerCase()}">${s.direction}</span></td>
      <td><span class="tf-badge">${s.timeframe}</span></td>
      <td><span class="conf ${confClass(s.confidence)}">${s.confidence}%</span></td>
      <td>
        <div class="tldr-list">
          ${s.tldr.map(t => `<div class="tldr-item">${t}</div>`).join('')}
        </div>
      </td>
      <td>
        <button class="btn small" data-trade="${s.symbol}">Trade</button>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('.signal-row').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      state.selectedSymbol = row.dataset.symbol;
      setView('charts');
      renderAll();
    });
  });

  tbody.querySelectorAll('[data-trade]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const symbol = btn.dataset.trade;
      const signal = state.signals.find(s => s.symbol === symbol);
      if (signal) {
        autoTrade(signal);
      }
    });
  });
}

function applySignalFilters(filters) {
  return state.signals.filter(s => {
    const tfOk = filters.tf === 'all' || s.timeframe === filters.tf;
    const dirOk = filters.dir === 'all' || s.direction.toLowerCase() === filters.dir;
    const confOk = s.confidence >= filters.minConf;
    return tfOk && dirOk && confOk;
  });
}

function getFilters() {
  return {
    tf: $('#tfSelect').value,
    dir: $('#dirSelect').value,
    minConf: parseInt($('#minConf').value, 10),
  };
}

function confClass(n) {
  if (n >= 80) return 'high';
  if (n >= 65) return 'mid';
  return 'low';
}

function renderSelectedMarket() {
  const market = state.markets.find(m => m.symbol === state.selectedSymbol);
  const signal = state.signals.find(s => s.symbol === state.selectedSymbol);

  $('#selectedSymbolBadge').textContent = state.selectedSymbol.replace('USDT', '/USDT');
  $('#chartSymbol').textContent = state.selectedSymbol;

  if (market) {
    $('#selectedPrice').textContent = '$' + formatPrice(market.price);
  }

  if (signal) {
    const trend = signal.direction === 'LONG' ? 'Bullish' : 'Bearish';
    const trendIcon = signal.direction === 'LONG'
      ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>'
      : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>';

    $('#selectedTrend').innerHTML = `
      <span class="trend-icon ${signal.direction.toLowerCase()}">${trendIcon}</span>
      ${trend}
    `;
    $('#selectedSignalDir').textContent = signal.direction;
    $('#selectedSignalDir').className = 'signal-display ' + signal.direction.toLowerCase();
    $('#selectedConfPill').textContent = signal.confidence + '%';
    $('#selectedConfBar').style.width = signal.confidence + '%';
    $('#selectedTldr').innerHTML = signal.tldr.map(t => `<li>${t}</li>`).join('');

    // Update charts panel
    updateChartsPanel(signal);
  } else {
    $('#selectedTrend').innerHTML = `<span class="muted">--</span>`;
    $('#selectedSignalDir').textContent = '--';
    $('#selectedConfPill').textContent = '--';
    $('#selectedConfBar').style.width = '0%';
    $('#selectedTldr').innerHTML = '<li class="muted">No signal detected. Waiting for next scan...</li>';
  }
}

async function updateChartsPanel(signal) {
  // Update indicators
  $('#rsiVal').textContent = signal.rsi ? signal.rsi.toFixed(1) : '--';
  $('#rsiFill').style.width = signal.rsi ? signal.rsi + '%' : '50%';

  const rsiClass = signal.rsi > 70 ? 'overbought' : signal.rsi < 30 ? 'oversold' : 'neutral';
  $('#rsiFill').className = 'indicator-fill rsi ' + rsiClass;

  const emaStatus = signal.price > signal.ema200 ? 'Above' : 'Below';
  $('#emaVal').textContent = emaStatus;
  $('#emaStatus').innerHTML = `
    <span class="status-dot ${signal.price > signal.ema200 ? 'bullish' : 'bearish'}"></span>
    <span>${signal.price > signal.ema200 ? 'Bullish trend' : 'Bearish trend'}</span>
  `;

  const macdStatus = signal.macd.histogram > 0 ? 'Bullish' : 'Bearish';
  $('#macdVal').textContent = macdStatus;
  $('#macdStatus').innerHTML = `
    <span class="status-dot ${signal.macd.histogram > 0 ? 'bullish' : 'bearish'}"></span>
    <span>${signal.macd.crossUp ? 'Cross up!' : signal.macd.crossDown ? 'Cross down!' : 'Momentum ' + (signal.macd.histogram > 0 ? 'rising' : 'falling')}</span>
  `;

  // Update direction and confidence
  $('#chartDirection').textContent = signal.direction;
  $('#chartDirection').className = 'pill direction-pill ' + signal.direction.toLowerCase();
  $('#chartConfPill').textContent = signal.confidence + '%';
  $('#chartConfBar').style.width = signal.confidence + '%';
  $('#chartTldr').innerHTML = signal.tldr.map(t => `<li>${t}</li>`).join('');

  // Update levels
  const price = signal.price;
  $('#currentPrice').textContent = '$' + formatPrice(price);

  if (signal.resistances.length >= 2) {
    $('#r1Price').textContent = '$' + formatPrice(signal.resistances[0]);
    $('#r2Price').textContent = '$' + formatPrice(signal.resistances[1]);
  }

  if (signal.supports.length >= 2) {
    $('#s1Price').textContent = '$' + formatPrice(signal.supports[0]);
    $('#s2Price').textContent = '$' + formatPrice(signal.supports[1]);
  }
}

function renderRecentTrades() {
  const tbody = $('#recentTradesTable tbody');
  const recent = state.trades.slice(0, 5);

  if (recent.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-cell muted">No trades yet</td></tr>';
    return;
  }

  tbody.innerHTML = recent.map(t => `
    <tr>
      <td class="muted">${getTimeAgo(t.openTime)}</td>
      <td><strong>${t.symbol.replace('USDT', '')}</strong></td>
      <td><span class="tag small ${t.direction.toLowerCase()}">${t.direction}</span></td>
      <td class="${t.pnl >= 0 ? 'pnl-positive' : 'pnl-negative'}">${formatPnL(t.pnl)}</td>
    </tr>
  `).join('');
}

function renderTradesTable() {
  const tbody = $('#tradesTable tbody');
  const filter = $('#tradeFilter')?.value || 'all';

  let trades = state.trades;
  if (filter === 'open') trades = trades.filter(t => t.status === 'OPEN');
  if (filter === 'closed') trades = trades.filter(t => t.status === 'CLOSED');
  if (filter === 'won') trades = trades.filter(t => t.status === 'CLOSED' && t.pnl > 0);
  if (filter === 'lost') trades = trades.filter(t => t.status === 'CLOSED' && t.pnl < 0);

  if (trades.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-cell muted">No trades match your filter.</td></tr>';
    return;
  }

  tbody.innerHTML = trades.map(t => `
    <tr class="${t.status === 'OPEN' ? 'open-trade' : ''}">
      <td class="muted">${t.openTime.toLocaleString()}</td>
      <td><strong>${t.symbol.replace('USDT', '')}</strong></td>
      <td><span class="tag small ${t.direction.toLowerCase()}">${t.direction}</span></td>
      <td>${t.leverage}x</td>
      <td>$${formatPrice(t.entry)}</td>
      <td>${t.exit ? '$' + formatPrice(t.exit) : '--'}</td>
      <td><span class="conf ${confClass(t.confidence)}">${t.confidence}%</span></td>
      <td class="${t.pnl >= 0 ? 'pnl-positive' : 'pnl-negative'}">${formatPnL(t.pnl)}</td>
      <td>
        <span class="status-badge ${t.status.toLowerCase()}">${t.status}</span>
        ${t.status === 'OPEN' ? `<button class="btn ghost small close-trade" data-id="${t.id}">Close</button>` : ''}
      </td>
    </tr>
  `).join('');

  // Add close button handlers
  tbody.querySelectorAll('.close-trade').forEach(btn => {
    btn.addEventListener('click', () => {
      const trade = state.trades.find(t => t.id === parseInt(btn.dataset.id));
      if (trade) {
        const currentPrice = state.priceCache[trade.symbol] || trade.entry;
        closeTrade(trade, currentPrice);
        renderTradesTable();
      }
    });
  });
}

function renderPnL() {
  const stats = getTradeStats();

  // Update all PnL displays
  const balanceFormatted = '$' + state.balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  $('#paperBalance').textContent = balanceFormatted;
  $('#pnlBalance').textContent = balanceFormatted;
  $('#openPositions').textContent = stats.openPositions;
  $('#winRate').textContent = stats.winRate + '%';
  $('#pnlWinRate').textContent = stats.winRate + '%';

  const totalPnL = state.balance - CONFIG.STARTING_BALANCE;
  const pnlPercent = ((totalPnL / CONFIG.STARTING_BALANCE) * 100).toFixed(2);
  $('#pnlTotal').textContent = formatPnL(totalPnL);
  $('#pnlTotal').className = 'big ' + (totalPnL >= 0 ? 'pnl-positive' : 'pnl-negative');

  $('#pnlChange').textContent = `${formatPnL(totalPnL)} (${pnlPercent}%)`;
  $('#pnlChange').className = 'balance-change ' + (totalPnL >= 0 ? 'positive' : 'negative');

  $('#pnlTotalTrades').textContent = stats.totalTrades;
  $('#pnlDD').textContent = '-' + stats.maxDrawdown + '%';

  // Update equity curve
  updateEquityCurve();
}

function updateEquityCurve() {
  if (state.equityHistory.length < 2) return;

  const min = Math.min(...state.equityHistory);
  const max = Math.max(...state.equityHistory);
  const range = max - min || 1;

  const points = state.equityHistory.map((eq, i) => {
    const x = (i / (state.equityHistory.length - 1)) * 100;
    const y = 40 - ((eq - min) / range) * 35;
    return `${x},${y}`;
  });

  const path = 'M' + points.join(' L');
  $('#equityPath')?.setAttribute('d', path);
}

function renderAll() {
  renderMarkets(applyMarketSearch());
  renderTopSignals();
  renderSignalsTable();
  renderSelectedMarket();
  renderRecentTrades();
  renderTradesTable();
  renderPnL();
  renderAlerts();
  updateKPIs();
}

function updateKPIs() {
  $('#kpiSetups').textContent = state.signals.length;
  $('#kpiHigh').textContent = state.signals.filter(s => s.confidence >= 80).length;
}

// --- Timer & Status ---
let scanCountdown = 120;

function updateScanStatus(status) {
  $('#scanStatus').innerHTML = status || `Next scan: <strong id="scanCountdown">${formatCountdown(scanCountdown)}</strong>`;
}

function formatCountdown(seconds) {
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function startScanTimer() {
  setInterval(() => {
    scanCountdown--;

    if (scanCountdown <= 0) {
      scanCountdown = 120;
      runAIScan();
    }

    $('#scanCountdown').textContent = formatCountdown(scanCountdown);
    $('#kpiNextScan').textContent = formatCountdown(scanCountdown);
  }, 1000);
}

function updateLastUpdate() {
  const now = new Date();
  $('#lastUpdate').textContent = `Last update: ${now.toLocaleTimeString()}`;
}

// --- Navigation ---
function setView(viewName) {
  $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.view === viewName));
  $$('.view').forEach(v => v.classList.toggle('active', v.id === `view-${viewName}`));

  if (viewName === 'charts') {
    setTimeout(initTradingViewChart, 100);
  }
}

// --- State Persistence ---
function saveState() {
  try {
    localStorage.setItem('perpSignals_balance', state.balance.toString());
    localStorage.setItem('perpSignals_trades', JSON.stringify(state.trades));
    localStorage.setItem('perpSignals_equity', JSON.stringify(state.equityHistory));
  } catch (e) {
    console.warn('Failed to save state:', e);
  }
}

function loadState() {
  try {
    const balance = localStorage.getItem('perpSignals_balance');
    const trades = localStorage.getItem('perpSignals_trades');
    const equity = localStorage.getItem('perpSignals_equity');

    if (balance) state.balance = parseFloat(balance);
    if (trades) {
      state.trades = JSON.parse(trades).map(t => ({
        ...t,
        openTime: new Date(t.openTime),
        closeTime: t.closeTime ? new Date(t.closeTime) : null,
      }));
    }
    if (equity) state.equityHistory = JSON.parse(equity);
  } catch (e) {
    console.warn('Failed to load state:', e);
  }
}

function resetPaperAccount() {
  if (!confirm('Are you sure you want to reset your paper trading account? This will clear all trades and reset your balance to $2,000.')) {
    return;
  }

  state.balance = CONFIG.STARTING_BALANCE;
  state.trades = [];
  state.equityHistory = [CONFIG.STARTING_BALANCE];
  state.maxBalance = CONFIG.STARTING_BALANCE;

  saveState();
  renderAll();
}

// --- Event Listeners ---
function initEventListeners() {
  // Navigation
  $$('.tab').forEach(btn => {
    btn.addEventListener('click', () => setView(btn.dataset.view));
  });

  $$('[data-nav]').forEach(btn => {
    btn.addEventListener('click', () => setView(btn.dataset.nav));
  });

  // Search
  $('#marketSearch').addEventListener('input', () => renderMarkets(applyMarketSearch()));

  // Filters
  $('#minConf').addEventListener('input', (e) => {
    $('#minConfPill').textContent = e.target.value + '%';
  });

  $('#applyFilters').addEventListener('click', () => {
    renderSignalsTable();
  });

  // Force scan
  $('#forceScanBtn').addEventListener('click', () => {
    scanCountdown = 120;
    runAIScan();
  });

  // Sound toggle
  $('#soundToggle').addEventListener('change', (e) => {
    state.soundEnabled = e.target.checked;
  });

  // Clear alerts
  $('#clearAlerts').addEventListener('click', () => {
    state.alerts = [];
    renderAlerts();
  });

  // Chart timeframe
  $$('.chip[data-chart-tf]').forEach(chip => {
    chip.addEventListener('click', () => {
      $$('.chip[data-chart-tf]').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      state.currentTimeframe = chip.dataset.chartTf;
      initTradingViewChart();
    });
  });

  // Toggle drawings
  $('#toggleDrawings')?.addEventListener('click', () => {
    state.drawingsVisible = !state.drawingsVisible;
    // TradingView handles its own drawings
  });

  // Paper trading
  $('#paperTradeBtn')?.addEventListener('click', () => {
    const signal = state.signals.find(s => s.symbol === state.selectedSymbol);
    if (signal) {
      autoTrade(signal);
    } else {
      alert('No signal available for this symbol.');
    }
  });

  $('#autoTradeBtn')?.addEventListener('click', () => {
    const highConfSignals = state.signals.filter(s => s.confidence >= 80);
    highConfSignals.forEach(signal => autoTrade(signal));
    alert(`Opened ${highConfSignals.length} trades with 80%+ confidence.`);
  });

  $('#resetPaper').addEventListener('click', resetPaperAccount);

  $('#manualTradeBtn')?.addEventListener('click', () => {
    const signal = state.signals.find(s => s.symbol === state.selectedSymbol);
    if (signal) {
      autoTrade(signal);
    } else {
      alert('Select a market with an active signal first.');
    }
  });

  // Trade filter
  $('#tradeFilter')?.addEventListener('change', renderTradesTable);

  // Export signals
  $('#exportSignals')?.addEventListener('click', () => {
    const data = state.signals.map(s => ({
      symbol: s.symbol,
      direction: s.direction,
      timeframe: s.timeframe,
      confidence: s.confidence,
      reasons: s.tldr.join('; '),
      price: s.price,
      timestamp: new Date(s.timestamp).toISOString(),
    }));

    const csv = [
      Object.keys(data[0] || {}).join(','),
      ...data.map(row => Object.values(row).join(','))
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `signals_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });
}

// --- Price Updates (WebSocket) ---
function initPriceWebSocket() {
  // Connect to Binance WebSocket for real-time price updates
  const symbols = state.markets.slice(0, 20).map(m => m.symbol.toLowerCase() + '@ticker');

  if (symbols.length === 0) {
    setTimeout(initPriceWebSocket, 5000);
    return;
  }

  try {
    const ws = new WebSocket(`wss://fstream.binance.com/stream?streams=${symbols.join('/')}`);

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.data && data.data.s) {
        const symbol = data.data.s;
        const price = parseFloat(data.data.c);

        state.priceCache[symbol] = price;

        // Update market list price
        const market = state.markets.find(m => m.symbol === symbol);
        if (market) {
          market.price = price;
          market.priceChange = parseFloat(data.data.P);
        }

        // Update open positions
        updateOpenPositions();
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    ws.onclose = () => {
      console.log('WebSocket closed, reconnecting...');
      setTimeout(initPriceWebSocket, 5000);
    };

  } catch (error) {
    console.error('Failed to init WebSocket:', error);
  }
}

// --- Initialization ---
async function init() {
  console.log('Initializing AI Perp Signals...');

  // Load saved state
  loadState();

  // Initialize event listeners
  initEventListeners();

  // Initial render
  renderAll();

  // Fetch initial data
  await getTop50Perps();
  renderMarkets(state.markets);

  // Run initial scan
  await runAIScan();

  // Start timer
  startScanTimer();

  // Init WebSocket for live prices
  setTimeout(initPriceWebSocket, 2000);

  // Periodic position updates
  setInterval(() => {
    updateOpenPositions();
    renderPnL();
    renderRecentTrades();
  }, 5000);

  console.log('AI Perp Signals initialized successfully!');
}

// Start the application
document.addEventListener('DOMContentLoaded', init);
