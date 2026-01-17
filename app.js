/* ============================================
   SENTIENT TRADER - AI Crypto Trading Intelligence v3.1
   Powered by Claude AI + ChatGPT
   ============================================ */

// Configuration
const CONFIG = {
  BINANCE_API: 'https://fapi.binance.com',
  BYBIT_API: 'https://api.bybit.com',
  COINGECKO_API: 'https://api.coingecko.com/api/v3',
  // Claude API
  CLAUDE_API: 'https://api.anthropic.com/v1/messages',
  CLAUDE_API_KEY: '', // Will be loaded from localStorage or prompted
  CLAUDE_MODEL: 'claude-3-5-sonnet-20241022', // Model used for analysis
  // OpenAI API
  OPENAI_API: 'https://api.openai.com/v1/chat/completions',
  OPENAI_API_KEY: '', // Will be loaded from localStorage or prompted
  OPENAI_MODEL: 'gpt-4o', // Using GPT-4o for best analysis
  // LunarCrush API (Social Sentiment)
  LUNARCRUSH_API: 'https://lunarcrush.com/api4/public',
  LUNARCRUSH_API_KEY: '', // Get free key at lunarcrush.com/developers
  // Coinglass API (Liquidation & Derivatives Data)
  COINGLASS_API: 'https://open-api.coinglass.com/public/v2',
  COINGLASS_API_KEY: '', // Get free key at coinglass.com/api
  SCAN_INTERVAL: 90000,
  AI_SCAN_INTERVAL: 600000, // 10 minutes for AI analysis
  PRICE_UPDATE_INTERVAL: 1000,
  PNL_UPDATE_INTERVAL: 500,
  CACHE_TTL: 30000,
  MIN_CONFIDENCE: 65,
  HIGH_CONFIDENCE: 75, // Lowered for AI auto-trade
  TOP_COINS: 50,
  LEVERAGE: 5,
  RISK_PERCENT: 2,
  TP_PERCENT: 5, // Minimum 5% TP for worthwhile trades
  SL_PERCENT: 2, // Stop loss
  MAX_OPEN_TRADES: 5, // Increased for more trades
  MAX_POSITION_SIZE_PERCENT: 20, // 20% of balance per trade
  AI_MIN_CONFIDENCE: 70, // Lower threshold for AI auto-trade
  CHART_HISTORY_LIMIT: 1000, // More candles for longer history
  // Minimum move requirements by market cap
  MIN_TP_PERCENT_BTC_ETH: 3, // BTC/ETH need at least 3% move
  MIN_TP_PERCENT_LARGE_CAP: 5, // Large caps (top 10) need 5%
  MIN_TP_PERCENT_MID_CAP: 7, // Mid caps need 7%
  MIN_TP_PERCENT_SMALL_CAP: 10 // Small caps need 10% minimum move
};

// Load API keys from localStorage
function loadApiKeys() {
  const claudeKey = localStorage.getItem('claude_api_key');
  const openaiKey = localStorage.getItem('openai_api_key');
  const lunarcrushKey = localStorage.getItem('lunarcrush_api_key');
  const coinglassKey = localStorage.getItem('coinglass_api_key');

  if (claudeKey) CONFIG.CLAUDE_API_KEY = claudeKey;
  if (openaiKey) CONFIG.OPENAI_API_KEY = openaiKey;
  if (lunarcrushKey) CONFIG.LUNARCRUSH_API_KEY = lunarcrushKey;
  if (coinglassKey) CONFIG.COINGLASS_API_KEY = coinglassKey;

  return {
    claude: !!claudeKey,
    openai: !!openaiKey,
    lunarcrush: !!lunarcrushKey,
    coinglass: !!coinglassKey
  };
}

// Legacy function for backwards compatibility
function loadApiKey() {
  return loadApiKeys().claude;
}

// Prompt for API keys
function promptForApiKeys() {
  // Claude API Key
  if (!CONFIG.CLAUDE_API_KEY) {
    const claudeKey = prompt('Enter your Claude API Key:\n\n(Get one at console.anthropic.com)\n\nLeave empty to skip.');
    if (claudeKey && claudeKey.trim().startsWith('sk-ant-')) {
      CONFIG.CLAUDE_API_KEY = claudeKey.trim();
      localStorage.setItem('claude_api_key', claudeKey.trim());
      console.log('🔑 Claude API Key saved');
    }
  }

  // OpenAI API Key
  if (!CONFIG.OPENAI_API_KEY) {
    const openaiKey = prompt('Enter your OpenAI API Key:\n\n(Get one at platform.openai.com)\n\nLeave empty to skip.');
    if (openaiKey && openaiKey.trim().startsWith('sk-')) {
      CONFIG.OPENAI_API_KEY = openaiKey.trim();
      localStorage.setItem('openai_api_key', openaiKey.trim());
      console.log('🔑 OpenAI API Key saved');
    }
  }

  return isAnyAiConfigured();
}

// Legacy function
function promptForApiKey() {
  return promptForApiKeys();
}

// Check if Claude is configured
function isClaudeConfigured() {
  return CONFIG.CLAUDE_API_KEY && CONFIG.CLAUDE_API_KEY.startsWith('sk-ant-');
}

// Check if OpenAI is configured
function isOpenAIConfigured() {
  return CONFIG.OPENAI_API_KEY && CONFIG.OPENAI_API_KEY.startsWith('sk-');
}

// Check if any AI is configured
function isAnyAiConfigured() {
  return isClaudeConfigured() || isOpenAIConfigured();
}

// Legacy function
function isAiConfigured() {
  return isAnyAiConfigured();
}

// Manual API key setting (callable from console)
function setApiKeyManually(provider, key) {
  if (provider === 'claude' || provider === 'anthropic') {
    if (key && key.startsWith('sk-ant-')) {
      CONFIG.CLAUDE_API_KEY = key;
      localStorage.setItem('claude_api_key', key);
      console.log('✅ Claude API key saved successfully!');
      return true;
    } else {
      console.error('❌ Invalid Claude API key. It should start with "sk-ant-"');
      return false;
    }
  } else if (provider === 'openai' || provider === 'chatgpt') {
    if (key && key.startsWith('sk-')) {
      CONFIG.OPENAI_API_KEY = key;
      localStorage.setItem('openai_api_key', key);
      console.log('✅ OpenAI API key saved successfully!');
      return true;
    } else {
      console.error('❌ Invalid OpenAI API key. It should start with "sk-"');
      return false;
    }
  } else if (provider === 'lunarcrush' || provider === 'lunar') {
    if (key && key.length > 10) {
      CONFIG.LUNARCRUSH_API_KEY = key;
      localStorage.setItem('lunarcrush_api_key', key);
      console.log('✅ LunarCrush API key saved successfully!');
      return true;
    } else {
      console.error('❌ Invalid LunarCrush API key.');
      return false;
    }
  } else if (provider === 'coinglass' || provider === 'cg') {
    if (key && key.length > 10) {
      CONFIG.COINGLASS_API_KEY = key;
      localStorage.setItem('coinglass_api_key', key);
      console.log('✅ Coinglass API key saved successfully!');
      return true;
    } else {
      console.error('❌ Invalid Coinglass API key.');
      return false;
    }
  } else {
    console.error('❌ Unknown provider. Use "claude", "openai", "lunarcrush", or "coinglass"');
    console.log('Examples:');
    console.log('   setApiKey("openai", "sk-proj-...")');
    console.log('   setApiKey("lunarcrush", "your-api-key")');
    console.log('   setApiKey("coinglass", "your-api-key")');
    return false;
  }
}

// Check if LunarCrush is configured
function isLunarCrushConfigured() {
  return CONFIG.LUNARCRUSH_API_KEY && CONFIG.LUNARCRUSH_API_KEY.length > 10;
}

// Check if Coinglass is configured
function isCoinglassConfigured() {
  return CONFIG.COINGLASS_API_KEY && CONFIG.COINGLASS_API_KEY.length > 10;
}

// Show API key status
function showApiKeyStatus() {
  console.log('🔑 API Key Status:');
  console.log('   ');
  console.log('   AI Services:');
  console.log('   Claude:', isClaudeConfigured() ? '✅ Configured' : '❌ Not configured');
  console.log('   OpenAI:', isOpenAIConfigured() ? '✅ Configured' : '❌ Not configured');
  console.log('   ');
  console.log('   Data Providers:');
  console.log('   LunarCrush:', isLunarCrushConfigured() ? '✅ Configured' : '⚪ Optional (social sentiment)');
  console.log('   Coinglass:', isCoinglassConfigured() ? '✅ Configured' : '⚪ Optional (liquidation data)');
  console.log('');
  console.log('To add/update keys, run:');
  console.log('   setApiKey("claude", "sk-ant-...")');
  console.log('   setApiKey("openai", "sk-...")');
  console.log('   setApiKey("lunarcrush", "your-api-key")  // Get at: lunarcrush.com/developers');
  console.log('   setApiKey("coinglass", "your-api-key")   // Get at: coinglass.com/api');
}

// State
const state = {
  markets: [],
  signals: [], // Only used as fallback if AI not configured
  trades: [],
  aiSignals: [], // AI-generated signals (PRIMARY source)
  signalHistory: [], // Track all signals with timestamps for "New" tab
  selectedSymbol: 'BTCUSDT',
  currentTimeframe: '240',
  balance: 2000,
  startBalance: 2000,
  equityHistory: [{ time: Date.now(), value: 2000 }],
  priceCache: {},
  klineCache: {},
  previousHighConfSignals: new Set(),
  isScanning: false,
  isAiScanning: false,
  soundEnabled: true,
  showSR: true,
  showIndicators: false,
  showVolume: false,
  dataSource: 'binance',
  chart: null,
  candleSeries: null,
  volumeSeries: null,
  srLines: [], // Support/Resistance price lines
  userLines: [], // User-drawn lines
  equityChart: null,
  equitySeries: null,
  wsConnection: null,
  signalFilter: 'all',
  signalTab: 'new', // 'new' or 'all'
  nextAiScanTime: null,
  lastAiAnalysis: null,
  aiAutoTradeEnabled: true,
  drawingMode: null, // 'hline', 'trendline', null
  pendingLine: null, // For drawing trendlines
  // Enhanced features
  fundingRates: {}, // Symbol -> funding rate
  openInterest: {}, // Symbol -> OI data
  socialSentiment: {}, // Symbol -> LunarCrush data
  liquidationData: {}, // Symbol -> Coinglass liquidation data
  performanceStats: {
    totalTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    totalPnL: 0,
    claudeWins: 0,
    claudeLosses: 0,
    openaiWins: 0,
    openaiLosses: 0,
    consensusWins: 0,
    consensusLosses: 0,
    largestWin: 0,
    largestLoss: 0,
    currentStreak: 0,
    maxDrawdown: 0,
    peakBalance: 2000
  },
  soundEnabled: true,
  notificationsEnabled: false
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

// Blocked tickers (problematic or unwanted)
const BLOCKED_TICKERS = ['BNXUSDT', 'BNXUSDTPERP'];

// ============================================
// FUNDING RATES & OPEN INTEREST
// ============================================

async function fetchFundingRates() {
  try {
    const data = await fetchWithRetry(`${CONFIG.BINANCE_API}/fapi/v1/premiumIndex`);
    const rates = {};
    for (const item of data) {
      if (item.symbol.endsWith('USDT')) {
        rates[item.symbol] = {
          fundingRate: parseFloat(item.lastFundingRate) * 100, // Convert to percentage
          nextFundingTime: item.nextFundingTime,
          markPrice: parseFloat(item.markPrice),
          indexPrice: parseFloat(item.indexPrice)
        };
      }
    }
    state.fundingRates = rates;
    console.log('📊 Funding rates updated for', Object.keys(rates).length, 'symbols');
    return rates;
  } catch (error) {
    console.error('Failed to fetch funding rates:', error);
    return {};
  }
}

async function fetchOpenInterest(symbol) {
  try {
    const data = await fetchWithRetry(`${CONFIG.BINANCE_API}/fapi/v1/openInterest?symbol=${symbol}`);
    const oiValue = parseFloat(data.openInterest);

    // Get historical OI for comparison
    const histData = await fetchWithRetry(
      `${CONFIG.BINANCE_API}/futures/data/openInterestHist?symbol=${symbol}&period=1h&limit=24`
    );

    let oiChange = 0;
    if (histData && histData.length > 1) {
      const oldOI = parseFloat(histData[0].sumOpenInterest);
      const newOI = parseFloat(histData[histData.length - 1].sumOpenInterest);
      oiChange = ((newOI - oldOI) / oldOI) * 100;
    }

    state.openInterest[symbol] = {
      value: oiValue,
      change24h: oiChange,
      timestamp: Date.now()
    };

    return state.openInterest[symbol];
  } catch (error) {
    console.error(`Failed to fetch OI for ${symbol}:`, error);
    return null;
  }
}

// ============================================
// LUNARCRUSH API (SOCIAL SENTIMENT)
// ============================================

async function fetchSocialSentiment(symbol) {
  if (!isLunarCrushConfigured()) {
    return null;
  }

  try {
    // Convert symbol format (e.g., BTCUSDT -> BTC)
    const coin = symbol.replace('USDT', '').toLowerCase();

    const response = await fetch(`${CONFIG.LUNARCRUSH_API}/coins/${coin}/v1`, {
      headers: {
        'Authorization': `Bearer ${CONFIG.LUNARCRUSH_API_KEY}`
      }
    });

    if (!response.ok) {
      if (response.status === 429) {
        console.warn('LunarCrush rate limited');
        return null;
      }
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    if (!data || !data.data) {
      return null;
    }

    const coinData = data.data;

    state.socialSentiment[symbol] = {
      galaxyScore: coinData.galaxy_score || 0, // 0-100, overall score
      altRank: coinData.alt_rank || 999, // Lower is better
      socialVolume: coinData.social_volume_24h || 0,
      socialScore: coinData.social_score || 0,
      sentiment: coinData.average_sentiment || 50, // 0-100
      socialDominance: coinData.social_dominance || 0,
      newsVolume: coinData.news_24h || 0,
      marketDominance: coinData.market_dominance || 0,
      correlationRank: coinData.correlation_rank || 0,
      volatility: coinData.volatility || 0,
      // Calculated sentiment label
      sentimentLabel: coinData.average_sentiment > 65 ? 'BULLISH' :
                      coinData.average_sentiment < 35 ? 'BEARISH' : 'NEUTRAL',
      timestamp: Date.now()
    };

    return state.socialSentiment[symbol];
  } catch (error) {
    console.error(`Failed to fetch LunarCrush data for ${symbol}:`, error);
    return null;
  }
}

async function fetchBatchSocialSentiment(symbols) {
  if (!isLunarCrushConfigured()) {
    console.log('⚪ LunarCrush not configured - skipping social sentiment');
    return {};
  }

  console.log('🌙 Fetching social sentiment data...');

  // Fetch for top 10 symbols only to avoid rate limits
  const topSymbols = symbols.slice(0, 10);

  for (const symbol of topSymbols) {
    await fetchSocialSentiment(symbol);
    await sleep(100); // Rate limiting
  }

  console.log(`🌙 Social sentiment loaded for ${Object.keys(state.socialSentiment).length} coins`);
  return state.socialSentiment;
}

// ============================================
// COINGLASS API (LIQUIDATION DATA)
// ============================================

async function fetchLiquidationData(symbol) {
  if (!isCoinglassConfigured()) {
    return null;
  }

  try {
    // Convert symbol format for Coinglass
    const cleanSymbol = symbol.replace('USDT', '');

    // Fetch liquidation data
    const response = await fetch(`${CONFIG.COINGLASS_API}/liquidation_chart?symbol=${cleanSymbol}&interval=h1`, {
      headers: {
        'coinglassSecret': CONFIG.COINGLASS_API_KEY
      }
    });

    if (!response.ok) {
      if (response.status === 429) {
        console.warn('Coinglass rate limited');
        return null;
      }
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    if (!data || data.code !== '0' || !data.data) {
      return null;
    }

    // Get most recent hour data
    const recentData = data.data.slice(-24);
    const totalLongLiq = recentData.reduce((sum, d) => sum + (d.longLiquidationUsd || 0), 0);
    const totalShortLiq = recentData.reduce((sum, d) => sum + (d.shortLiquidationUsd || 0), 0);

    state.liquidationData[symbol] = {
      longLiquidations24h: totalLongLiq,
      shortLiquidations24h: totalShortLiq,
      totalLiquidations24h: totalLongLiq + totalShortLiq,
      liqRatio: totalLongLiq > 0 ? totalShortLiq / totalLongLiq : 0, // > 1 means more shorts liquidated
      dominantSide: totalLongLiq > totalShortLiq ? 'LONGS_LIQUIDATED' : 'SHORTS_LIQUIDATED',
      // If longs are being liquidated, might be near bottom. If shorts, might be near top.
      priceImplication: totalLongLiq > totalShortLiq * 1.5 ? 'POTENTIAL_BOTTOM' :
                        totalShortLiq > totalLongLiq * 1.5 ? 'POTENTIAL_TOP' : 'NEUTRAL',
      timestamp: Date.now()
    };

    return state.liquidationData[symbol];
  } catch (error) {
    console.error(`Failed to fetch Coinglass data for ${symbol}:`, error);
    return null;
  }
}

async function fetchLongShortRatio(symbol) {
  if (!isCoinglassConfigured()) {
    return null;
  }

  try {
    const cleanSymbol = symbol.replace('USDT', '');

    const response = await fetch(`${CONFIG.COINGLASS_API}/long_short?symbol=${cleanSymbol}&interval=h1`, {
      headers: {
        'coinglassSecret': CONFIG.COINGLASS_API_KEY
      }
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();

    if (!data || data.code !== '0' || !data.data || !data.data.length) {
      return null;
    }

    // Get most recent data
    const recent = data.data[data.data.length - 1];

    // Add to existing liquidation data
    if (!state.liquidationData[symbol]) {
      state.liquidationData[symbol] = { timestamp: Date.now() };
    }

    state.liquidationData[symbol].longShortRatio = recent.longRate / recent.shortRate;
    state.liquidationData[symbol].longPercent = recent.longRate;
    state.liquidationData[symbol].shortPercent = recent.shortRate;
    state.liquidationData[symbol].crowdBias = recent.longRate > 55 ? 'CROWDED_LONG' :
                                               recent.shortRate > 55 ? 'CROWDED_SHORT' : 'BALANCED';

    return state.liquidationData[symbol];
  } catch (error) {
    console.error(`Failed to fetch long/short ratio for ${symbol}:`, error);
    return null;
  }
}

async function fetchBatchLiquidationData(symbols) {
  if (!isCoinglassConfigured()) {
    console.log('⚪ Coinglass not configured - skipping liquidation data');
    return {};
  }

  console.log('💧 Fetching liquidation data...');

  // Fetch for top 10 symbols only to avoid rate limits
  const topSymbols = symbols.slice(0, 10);

  for (const symbol of topSymbols) {
    await fetchLiquidationData(symbol);
    await fetchLongShortRatio(symbol);
    await sleep(150); // Rate limiting
  }

  console.log(`💧 Liquidation data loaded for ${Object.keys(state.liquidationData).length} coins`);
  return state.liquidationData;
}

// ============================================
// MULTI-TIMEFRAME ANALYSIS
// ============================================

async function analyzeMultiTimeframe(symbol) {
  const timeframes = ['15', '60', '240', 'D']; // 15m, 1H, 4H, 1D
  const analysis = {};

  for (const tf of timeframes) {
    try {
      const candles = await fetchKlines(symbol, tf, 100);
      if (candles.length < 50) continue;

      const closes = candles.map(c => c.close);
      const ema20 = calculateEMA(closes, 20);
      const ema50 = calculateEMA(closes, 50);
      const rsi = calculateRSI(closes);
      const currentPrice = closes[closes.length - 1];

      // Determine trend
      let trend = 'NEUTRAL';
      if (currentPrice > ema20 && ema20 > ema50) trend = 'BULLISH';
      else if (currentPrice < ema20 && ema20 < ema50) trend = 'BEARISH';

      analysis[tf] = {
        trend,
        rsi,
        priceVsEma20: ((currentPrice - ema20) / ema20 * 100).toFixed(2),
        emaAlignment: ema20 > ema50 ? 'BULLISH' : 'BEARISH'
      };

      await sleep(50); // Rate limiting
    } catch (error) {
      console.error(`MTF analysis failed for ${symbol} ${tf}:`, error);
    }
  }

  // Calculate confluence score
  const bullishCount = Object.values(analysis).filter(a => a.trend === 'BULLISH').length;
  const bearishCount = Object.values(analysis).filter(a => a.trend === 'BEARISH').length;

  return {
    timeframes: analysis,
    confluence: bullishCount > bearishCount ? 'BULLISH' : bearishCount > bullishCount ? 'BEARISH' : 'MIXED',
    confluenceScore: Math.max(bullishCount, bearishCount) / Object.keys(analysis).length * 100,
    alignment: bullishCount === Object.keys(analysis).length ? 'FULL_BULLISH' :
               bearishCount === Object.keys(analysis).length ? 'FULL_BEARISH' : 'PARTIAL'
  };
}

// ============================================
// SOUND & BROWSER NOTIFICATIONS
// ============================================

function playAlertSound(type = 'signal') {
  if (!state.soundEnabled) return;

  try {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    if (type === 'consensus') {
      // Special sound for consensus - ascending notes
      oscillator.frequency.setValueAtTime(523.25, audioContext.currentTime); // C5
      oscillator.frequency.setValueAtTime(659.25, audioContext.currentTime + 0.1); // E5
      oscillator.frequency.setValueAtTime(783.99, audioContext.currentTime + 0.2); // G5
      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.4);
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.4);
    } else if (type === 'win') {
      // Victory sound
      oscillator.frequency.setValueAtTime(440, audioContext.currentTime);
      oscillator.frequency.setValueAtTime(554.37, audioContext.currentTime + 0.1);
      oscillator.frequency.setValueAtTime(659.25, audioContext.currentTime + 0.2);
      gainNode.gain.setValueAtTime(0.2, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.3);
    } else if (type === 'loss') {
      // Loss sound - descending
      oscillator.frequency.setValueAtTime(440, audioContext.currentTime);
      oscillator.frequency.setValueAtTime(349.23, audioContext.currentTime + 0.15);
      gainNode.gain.setValueAtTime(0.2, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.3);
    } else {
      // Default signal sound
      oscillator.frequency.setValueAtTime(600, audioContext.currentTime);
      gainNode.gain.setValueAtTime(0.2, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.2);
    }
  } catch (e) {
    console.log('Audio not available');
  }
}

async function requestNotificationPermission() {
  if ('Notification' in window) {
    const permission = await Notification.requestPermission();
    state.notificationsEnabled = permission === 'granted';
    console.log('🔔 Notifications:', state.notificationsEnabled ? 'enabled' : 'disabled');
    return state.notificationsEnabled;
  }
  return false;
}

function sendBrowserNotification(title, body, options = {}) {
  if (!state.notificationsEnabled || !('Notification' in window)) return;

  try {
    const notification = new Notification(title, {
      body,
      icon: '📊',
      badge: '📈',
      tag: options.tag || 'sentient-trader',
      requireInteraction: options.important || false,
      ...options
    });

    notification.onclick = () => {
      window.focus();
      if (options.symbol) selectMarket(options.symbol);
      notification.close();
    };

    // Auto close after 10 seconds
    setTimeout(() => notification.close(), 10000);
  } catch (e) {
    console.error('Notification failed:', e);
  }
}

// ============================================
// PERFORMANCE TRACKING
// ============================================

function updatePerformanceStats(trade, pnl) {
  const stats = state.performanceStats;

  stats.totalTrades++;
  stats.totalPnL += pnl;

  if (pnl > 0) {
    stats.winningTrades++;
    stats.currentStreak = stats.currentStreak >= 0 ? stats.currentStreak + 1 : 1;
    if (pnl > stats.largestWin) stats.largestWin = pnl;

    // Track by AI source
    if (trade.isConsensus) stats.consensusWins++;
    else if (trade.aiSource === 'claude') stats.claudeWins++;
    else if (trade.aiSource === 'openai') stats.openaiWins++;
  } else {
    stats.losingTrades++;
    stats.currentStreak = stats.currentStreak <= 0 ? stats.currentStreak - 1 : -1;
    if (pnl < stats.largestLoss) stats.largestLoss = pnl;

    // Track by AI source
    if (trade.isConsensus) stats.consensusLosses++;
    else if (trade.aiSource === 'claude') stats.claudeLosses++;
    else if (trade.aiSource === 'openai') stats.openaiLosses++;
  }

  // Update peak balance and drawdown
  if (state.balance > stats.peakBalance) {
    stats.peakBalance = state.balance;
  }
  const currentDrawdown = ((stats.peakBalance - state.balance) / stats.peakBalance) * 100;
  if (currentDrawdown > stats.maxDrawdown) {
    stats.maxDrawdown = currentDrawdown;
  }

  // Save stats
  localStorage.setItem('performance_stats', JSON.stringify(stats));

  // Play sound
  playAlertSound(pnl > 0 ? 'win' : 'loss');

  return stats;
}

function loadPerformanceStats() {
  try {
    const saved = localStorage.getItem('performance_stats');
    if (saved) {
      state.performanceStats = { ...state.performanceStats, ...JSON.parse(saved) };
    }
  } catch (e) {
    console.error('Failed to load performance stats:', e);
  }
}

function getWinRate() {
  const { totalTrades, winningTrades } = state.performanceStats;
  return totalTrades > 0 ? ((winningTrades / totalTrades) * 100).toFixed(1) : '0.0';
}

function getAIPerformance(aiSource) {
  const stats = state.performanceStats;
  if (aiSource === 'claude') {
    const total = stats.claudeWins + stats.claudeLosses;
    return total > 0 ? ((stats.claudeWins / total) * 100).toFixed(1) : 'N/A';
  } else if (aiSource === 'openai') {
    const total = stats.openaiWins + stats.openaiLosses;
    return total > 0 ? ((stats.openaiWins / total) * 100).toFixed(1) : 'N/A';
  } else if (aiSource === 'consensus') {
    const total = stats.consensusWins + stats.consensusLosses;
    return total > 0 ? ((stats.consensusWins / total) * 100).toFixed(1) : 'N/A';
  }
  return 'N/A';
}

// ============================================
// TRAILING STOP LOSS
// ============================================

function updateTrailingStop(trade, currentPrice) {
  if (!trade.trailingStop || !trade.trailingStop.enabled) return;

  const { trailPercent, activationPercent } = trade.trailingStop;
  const entryPrice = trade.entry;

  // Calculate current profit percentage
  const profitPercent = trade.direction === 'LONG'
    ? ((currentPrice - entryPrice) / entryPrice) * 100
    : ((entryPrice - currentPrice) / entryPrice) * 100;

  // Only activate trailing stop after reaching activation threshold
  if (profitPercent < activationPercent) return;

  // Calculate new stop loss
  let newStopLoss;
  if (trade.direction === 'LONG') {
    newStopLoss = currentPrice * (1 - trailPercent / 100);
    if (newStopLoss > trade.sl) {
      trade.sl = newStopLoss;
      console.log(`📈 Trailing stop updated for ${trade.symbol}: $${formatPrice(newStopLoss)}`);
    }
  } else {
    newStopLoss = currentPrice * (1 + trailPercent / 100);
    if (newStopLoss < trade.sl) {
      trade.sl = newStopLoss;
      console.log(`📉 Trailing stop updated for ${trade.symbol}: $${formatPrice(newStopLoss)}`);
    }
  }
}

// Binance API
async function fetchBinanceMarkets() {
  const data = await fetchWithRetry(`${CONFIG.BINANCE_API}/fapi/v1/ticker/24hr`);
  return data
    .filter(t => t.symbol.endsWith('USDT') && !t.symbol.includes('_') && !BLOCKED_TICKERS.includes(t.symbol))
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
    .filter(t => t.symbol.endsWith('USDT') && !BLOCKED_TICKERS.includes(t.symbol))
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
// CLAUDE AI SERVICE
// ============================================

async function callClaudeAPI(prompt) {
  try {
    const response = await fetch(CONFIG.CLAUDE_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CONFIG.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: CONFIG.CLAUDE_MODEL,
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      console.error('Claude API error:', response.status);
      return null;
    }

    const data = await response.json();
    return data.content[0].text;
  } catch (error) {
    console.error('Claude API call failed:', error);
    return null;
  }
}

async function callOpenAIAPI(prompt) {
  try {
    const response = await fetch(CONFIG.OPENAI_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CONFIG.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: CONFIG.OPENAI_MODEL,
        max_tokens: 2048,
        messages: [
          {
            role: 'system',
            content: 'You are an expert crypto perpetual futures trader. Always respond with valid JSON only.'
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3
      })
    });

    if (!response.ok) {
      console.error('OpenAI API error:', response.status);
      return null;
    }

    const data = await response.json();
    return data.choices[0].message.content;
  } catch (error) {
    console.error('OpenAI API call failed:', error);
    return null;
  }
}

function buildMarketAnalysisPrompt(marketData) {
  return `You are an expert crypto perpetual futures trader. Analyze the following market data and provide trading recommendations.

MARKET DATA:
${marketData.map(m => {
  const funding = state.fundingRates[m.symbol];
  const oi = state.openInterest[m.symbol];
  const social = state.socialSentiment[m.symbol];
  const liq = state.liquidationData[m.symbol];
  return `
${m.symbol}:
- Current Price: $${m.price}
- 24h Change: ${m.change.toFixed(2)}%
- 24h Volume: $${formatVolume(m.volume)}
- Funding Rate: ${funding ? (funding.fundingRate > 0 ? '+' : '') + funding.fundingRate.toFixed(4) + '%' : 'N/A'} ${funding && Math.abs(funding.fundingRate) > 0.01 ? '⚠️ HIGH' : ''}
- Open Interest Change (24h): ${oi ? (oi.change24h > 0 ? '+' : '') + oi.change24h.toFixed(2) + '%' : 'N/A'}
- RSI (14): ${m.rsi?.toFixed(1) || 'N/A'}
- EMA20: $${m.ema20?.toFixed(2) || 'N/A'}
- EMA50: $${m.ema50?.toFixed(2) || 'N/A'}
- EMA200: $${m.ema200?.toFixed(2) || 'N/A'}
- MACD Histogram: ${m.macdHistogram?.toFixed(4) || 'N/A'}
- Bollinger Band Position: ${m.bbPosition || 'N/A'}
- Support Levels: ${m.supports?.map(s => '$' + formatPrice(s)).join(', ') || 'N/A'}
- Resistance Levels: ${m.resistances?.map(r => '$' + formatPrice(r)).join(', ') || 'N/A'}
- ATR (14): ${m.atr?.toFixed(4) || 'N/A'}
- Volume Trend: ${m.volumeTrend || 'N/A'}
- Trend Direction: ${m.trend || 'N/A'}
- MTF Confluence: ${m.mtfAnalysis?.confluence || 'N/A'} (${m.mtfAnalysis?.confluenceScore?.toFixed(0) || 0}%)
- Social Sentiment: ${social ? `${social.sentimentLabel} (Score: ${social.sentiment}/100, Galaxy: ${social.galaxyScore})` : 'N/A'}
- Social Volume: ${social ? formatVolume(social.socialVolume) : 'N/A'}
- Long/Short Ratio: ${liq?.longShortRatio ? liq.longShortRatio.toFixed(2) : 'N/A'} ${liq?.crowdBias ? `(${liq.crowdBias})` : ''}
- 24h Liquidations: ${liq ? `Longs: $${formatVolume(liq.longLiquidations24h || 0)} | Shorts: $${formatVolume(liq.shortLiquidations24h || 0)}` : 'N/A'}
- Liquidation Signal: ${liq?.priceImplication || 'N/A'}`;
}).join('\n')}

ANALYSIS REQUIREMENTS:
1. Consider RSI extremes (oversold <30, overbought >70)
2. Evaluate EMA alignments and crossovers
3. Check MACD momentum and divergences
4. Assess Bollinger Band breakouts or mean reversion
5. Identify key support/resistance levels
6. Consider volume confirmation
7. Look for liquidation zones (typically 3-5% from current price in leveraged markets)
8. Evaluate trend strength and potential reversals
9. **FUNDING RATE ANALYSIS**: High positive funding (>0.01%) suggests overleveraged longs - consider shorts. High negative funding suggests overleveraged shorts - consider longs.
10. **OPEN INTEREST**: Rising OI with price = trend continuation. Rising OI against price = potential reversal.
11. **MULTI-TIMEFRAME**: Prefer setups where multiple timeframes align (higher confluence score = stronger signal)
12. **SOCIAL SENTIMENT**: High Galaxy Score (>70) with bullish sentiment = strong conviction. Bearish sentiment divergence from price = potential reversal.
13. **LONG/SHORT RATIO**: CROWDED_LONG (>55% longs) often leads to long squeeze - favor shorts. CROWDED_SHORT favors longs.
14. **LIQUIDATION DATA**: Heavy long liquidations = potential bottom (buy). Heavy short liquidations = potential top (sell).

Respond ONLY with valid JSON in this exact format (no other text):
{
  "topPicks": [
    {
      "symbol": "SYMBOL",
      "direction": "LONG or SHORT",
      "confidence": 75-95,
      "entry": price,
      "takeProfit": price,
      "stopLoss": price,
      "reasoning": "Brief 1-2 sentence explanation including funding/OI insight",
      "keyLevels": {
        "majorSupport": price,
        "majorResistance": price,
        "liquidationZone": price
      },
      "riskScore": 1-10,
      "timeHorizon": "4H to 1D",
      "fundingBias": "FAVORABLE/UNFAVORABLE/NEUTRAL",
      "socialSentiment": "BULLISH/BEARISH/NEUTRAL",
      "crowdPositioning": "CROWDED_LONG/CROWDED_SHORT/BALANCED"
    }
  ],
  "marketSentiment": "BULLISH/BEARISH/NEUTRAL",
  "marketCondition": "Brief market condition description including social/liquidation insights",
  "avoidList": ["symbols to avoid with reasons"]
}

CRITICAL REQUIREMENTS:
- Use DAILY and 4H timeframes for analysis (higher timeframes = bigger moves)
- BTC/ETH: Minimum 3% target move from entry
- Large caps (top 10 volume): Minimum 5% target move
- Mid/Small caps: Minimum 7-10% target move
- REJECT any setup with less than these minimum moves - not worth the risk
- Focus on SWING trades, not scalps

Select the 2-3 BEST opportunities with highest probability setups. Prioritize:
1. Setups where funding rate supports the direction
2. Sentiment aligned with technical direction
3. Crowd positioning that favors the trade (fade the crowd)
4. Strong liquidation signals (POTENTIAL_BOTTOM for longs, POTENTIAL_TOP for shorts)
5. LARGER MOVES - We want significant percentage gains, not small scalps
Be conservative with confidence scores.`;
}

async function runAiAnalysis() {
  if (state.isAiScanning) return;

  // Check if any API key is configured
  if (!isAnyAiConfigured()) {
    console.log('⚠️ No AI API keys configured. Skipping AI analysis.');
    updateAiScanStatus('No API Key');
    return;
  }

  state.isAiScanning = true;
  const aiNames = [];
  if (isClaudeConfigured()) aiNames.push('Claude');
  if (isOpenAIConfigured()) aiNames.push('ChatGPT');
  console.log(`🤖 Starting ${aiNames.join(' + ')} AI market analysis...`);
  updateAiScanStatus('Fetching data...');

  try {
    // Fetch all data sources in parallel for efficiency
    console.log('📊 Fetching market intelligence...');
    const topMarkets = state.markets.slice(0, 20);
    const topSymbols = topMarkets.map(m => m.symbol);

    // Fetch funding rates first (important for analysis)
    await fetchFundingRates();

    // Fetch social sentiment and liquidation data (if APIs are configured)
    await Promise.all([
      fetchBatchSocialSentiment(topSymbols),
      fetchBatchLiquidationData(topSymbols)
    ]);

    // Gather enhanced market data for top 20 coins
    const enrichedData = [];

    updateAiScanStatus('Analyzing markets...');

    for (const market of topMarkets) {
      // Fetch Open Interest for top 10 markets only (rate limiting)
      if (enrichedData.length < 10) {
        await fetchOpenInterest(market.symbol);
      }
      const candles = await fetchKlines(market.symbol, '240', 200);
      if (candles.length < 50) continue;

      const closes = candles.map(c => c.close);
      const rsi = calculateRSI(closes);
      const ema20 = calculateEMA(closes, 20);
      const ema50 = calculateEMA(closes, 50);
      const ema200 = calculateEMA(closes, 200);
      const macd = calculateMACD(closes);
      const bb = calculateBollingerBands(closes);
      const atr = calculateATR(candles);
      const { supports, resistances } = findSupportResistance(candles);

      // Volume analysis
      const avgVolume = candles.slice(-20).reduce((a, c) => a + c.volume, 0) / 20;
      const recentVolume = candles.slice(-5).reduce((a, c) => a + c.volume, 0) / 5;
      const volumeTrend = recentVolume > avgVolume * 1.2 ? 'INCREASING' :
                          recentVolume < avgVolume * 0.8 ? 'DECREASING' : 'STABLE';

      // Trend analysis
      const trend = ema20 > ema50 && ema50 > ema200 ? 'STRONG UPTREND' :
                    ema20 < ema50 && ema50 < ema200 ? 'STRONG DOWNTREND' :
                    ema20 > ema50 ? 'WEAK UPTREND' : 'WEAK DOWNTREND';

      // BB position
      const price = closes[closes.length - 1];
      const bbPosition = price > bb.upper ? 'ABOVE UPPER' :
                         price < bb.lower ? 'BELOW LOWER' :
                         price > bb.middle ? 'UPPER HALF' : 'LOWER HALF';

      // Multi-timeframe analysis for top 5 coins only (expensive)
      let mtfAnalysis = null;
      if (enrichedData.length < 5) {
        mtfAnalysis = await analyzeMultiTimeframe(market.symbol);
      }

      enrichedData.push({
        ...market,
        rsi,
        ema20,
        ema50,
        ema200,
        macdHistogram: macd.histogram,
        bb,
        bbPosition,
        atr,
        supports,
        resistances,
        volumeTrend,
        trend,
        mtfAnalysis
      });

      await sleep(30); // Rate limiting
    }

    updateAiScanStatus('Consulting AI...');

    // Build prompt
    const prompt = buildMarketAnalysisPrompt(enrichedData);

    // Call both AIs in parallel if both are configured
    const apiPromises = [];
    if (isClaudeConfigured()) {
      apiPromises.push(callClaudeAPI(prompt).then(r => ({ source: 'claude', response: r })));
    }
    if (isOpenAIConfigured()) {
      apiPromises.push(callOpenAIAPI(prompt).then(r => ({ source: 'openai', response: r })));
    }

    const results = await Promise.allSettled(apiPromises);

    // Parse responses from each AI
    const claudePicks = [];
    const openaiPicks = [];
    let claudeAnalysis = null;
    let openaiAnalysis = null;

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.response) {
        try {
          const jsonMatch = result.value.response.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const analysis = JSON.parse(jsonMatch[0]);
            if (result.value.source === 'claude') {
              claudeAnalysis = analysis;
              if (analysis.topPicks) claudePicks.push(...analysis.topPicks);
              console.log('✅ Claude analysis received:', analysis.topPicks?.length || 0, 'picks');
            } else {
              openaiAnalysis = analysis;
              if (analysis.topPicks) openaiPicks.push(...analysis.topPicks);
              console.log('✅ ChatGPT analysis received:', analysis.topPicks?.length || 0, 'picks');
            }
          }
        } catch (parseError) {
          console.error(`Failed to parse ${result.value.source} response:`, parseError);
        }
      }
    }

    // Find consensus signals (both AIs agree on symbol AND direction)
    const consensusSignals = [];
    for (const claudePick of claudePicks) {
      const matchingOpenai = openaiPicks.find(
        op => op.symbol === claudePick.symbol && op.direction === claudePick.direction
      );
      if (matchingOpenai) {
        // CONSENSUS FOUND! Average the confidence and boost it
        const avgConfidence = Math.min(95, Math.round((claudePick.confidence + matchingOpenai.confidence) / 2 + 5));
        consensusSignals.push({
          symbol: claudePick.symbol,
          direction: claudePick.direction,
          confidence: avgConfidence,
          entry: (claudePick.entry + matchingOpenai.entry) / 2,
          tp: Math.max(claudePick.takeProfit, matchingOpenai.takeProfit),
          sl: claudePick.direction === 'LONG'
            ? Math.max(claudePick.stopLoss, matchingOpenai.stopLoss)
            : Math.min(claudePick.stopLoss, matchingOpenai.stopLoss),
          isConsensus: true,
          claudeReasoning: claudePick.reasoning,
          openaiReasoning: matchingOpenai.reasoning,
          claudeModel: CONFIG.CLAUDE_MODEL,
          openaiModel: CONFIG.OPENAI_MODEL
        });
        console.log(`🎯 CONSENSUS: Both AIs agree on ${claudePick.symbol} ${claudePick.direction}!`);
      }
    }

    // Combine all signals
    const allSignals = [];

    // Add consensus signals first (highest priority)
    for (const cs of consensusSignals) {
      allSignals.push({
        symbol: cs.symbol,
        direction: cs.direction,
        confidence: cs.confidence,
        entry: cs.entry,
        tp: cs.tp,
        sl: cs.sl,
        riskReward: Math.abs(cs.tp - cs.entry) / Math.abs(cs.entry - cs.sl),
        timeframe: 'AI',
        reasons: [`Claude: ${cs.claudeReasoning}`, `ChatGPT: ${cs.openaiReasoning}`],
        isAiGenerated: true,
        isConsensus: true,
        aiSources: ['claude', 'openai'],
        claudeModel: cs.claudeModel,
        openaiModel: cs.openaiModel,
        timestamp: Date.now(),
        marketSentiment: claudeAnalysis?.marketSentiment || openaiAnalysis?.marketSentiment || 'NEUTRAL'
      });
    }

    // Add non-consensus Claude picks
    for (const pick of claudePicks) {
      if (!consensusSignals.some(cs => cs.symbol === pick.symbol && cs.direction === pick.direction)) {
        allSignals.push({
          symbol: pick.symbol,
          direction: pick.direction,
          confidence: pick.confidence,
          entry: pick.entry,
          tp: pick.takeProfit,
          sl: pick.stopLoss,
          riskReward: Math.abs(pick.takeProfit - pick.entry) / Math.abs(pick.entry - pick.stopLoss),
          timeframe: 'AI',
          reasons: [pick.reasoning],
          isAiGenerated: true,
          isConsensus: false,
          aiSources: ['claude'],
          claudeModel: CONFIG.CLAUDE_MODEL,
          keyLevels: pick.keyLevels,
          riskScore: pick.riskScore,
          timestamp: Date.now(),
          marketSentiment: claudeAnalysis?.marketSentiment || 'NEUTRAL'
        });
      }
    }

    // Add non-consensus OpenAI picks
    for (const pick of openaiPicks) {
      if (!consensusSignals.some(cs => cs.symbol === pick.symbol && cs.direction === pick.direction)) {
        allSignals.push({
          symbol: pick.symbol,
          direction: pick.direction,
          confidence: pick.confidence,
          entry: pick.entry,
          tp: pick.takeProfit,
          sl: pick.stopLoss,
          riskReward: Math.abs(pick.takeProfit - pick.entry) / Math.abs(pick.entry - pick.stopLoss),
          timeframe: 'AI',
          reasons: [pick.reasoning],
          isAiGenerated: true,
          isConsensus: false,
          aiSources: ['openai'],
          openaiModel: CONFIG.OPENAI_MODEL,
          keyLevels: pick.keyLevels,
          riskScore: pick.riskScore,
          timestamp: Date.now(),
          marketSentiment: openaiAnalysis?.marketSentiment || 'NEUTRAL'
        });
      }
    }

    // Sort by consensus first, then confidence
    allSignals.sort((a, b) => {
      if (a.isConsensus && !b.isConsensus) return -1;
      if (!a.isConsensus && b.isConsensus) return 1;
      return b.confidence - a.confidence;
    });

    // Filter out signals with too small TP percentage
    const filteredSignals = allSignals.filter(signal => {
      const tpPercent = Math.abs((signal.tp - signal.entry) / signal.entry * 100);
      const symbol = signal.symbol;

      // Determine minimum TP based on symbol
      let minTP = CONFIG.MIN_TP_PERCENT_MID_CAP; // Default 7%
      if (symbol === 'BTCUSDT' || symbol === 'ETHUSDT') {
        minTP = CONFIG.MIN_TP_PERCENT_BTC_ETH; // 3%
      } else if (['BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT', 'AVAXUSDT', 'DOTUSDT', 'LINKUSDT'].includes(symbol)) {
        minTP = CONFIG.MIN_TP_PERCENT_LARGE_CAP; // 5%
      }

      // Add TP percentage to signal for display
      signal.tpPercent = tpPercent;

      if (tpPercent < minTP) {
        console.log(`⏭️ Filtered out ${symbol} - TP ${tpPercent.toFixed(1)}% below minimum ${minTP}%`);
        return false;
      }
      return true;
    });

    if (filteredSignals.length > 0) {
      state.lastAiAnalysis = { claudeAnalysis, openaiAnalysis };

      // Add to signal history (only filtered signals with good TP%)
      for (const signal of filteredSignals) {
        const existingIdx = state.signalHistory.findIndex(
          s => s.symbol === signal.symbol && s.direction === signal.direction
        );
        if (existingIdx === -1) {
          state.signalHistory.unshift({ ...signal, isNew: true });
        } else if (state.signalHistory[existingIdx].confidence !== signal.confidence) {
          state.signalHistory.splice(existingIdx, 1);
          state.signalHistory.unshift({ ...signal, isNew: true, isUpdated: true });
        }
      }
      state.signalHistory = state.signalHistory.slice(0, 100);

      state.aiSignals = filteredSignals;

      const consensusCount = filteredSignals.filter(s => s.isConsensus).length;
      console.log(`🤖 AI Analysis complete: ${filteredSignals.length} signals (${consensusCount} consensus, ${allSignals.length - filteredSignals.length} filtered for small TP%)`);

      // Show consensus notification
      if (consensusSignals.length > 0) {
        showConsensusNotification(consensusSignals);
      }

      // Auto-trade if enabled (prioritize consensus signals)
      if (state.aiAutoTradeEnabled) {
        await executeAiTrades();
      }
    }
  } catch (error) {
    console.error('AI Analysis failed:', error);
  }

  state.isAiScanning = false;
  state.nextAiScanTime = Date.now() + CONFIG.AI_SCAN_INTERVAL;
  updateAiScanCountdown();
  renderAlertBar();
}

// Show special notification for consensus signals
function showConsensusNotification(consensusSignals) {
  for (const signal of consensusSignals) {
    // Play consensus sound
    playAlertSound('consensus');

    // Show in-app notification
    showNotification({
      type: 'consensus',
      title: '🎯 AI CONSENSUS ALERT',
      symbol: signal.symbol,
      direction: signal.direction,
      confidence: signal.confidence,
      message: `Both Claude & ChatGPT agree: ${signal.symbol} ${signal.direction}`,
      reasons: [`Claude: ${signal.claudeReasoning}`, `ChatGPT: ${signal.openaiReasoning}`]
    });

    // Send browser notification
    sendBrowserNotification(
      '🎯 AI CONSENSUS: ' + signal.symbol,
      `Both AIs agree: ${signal.direction} with ${signal.confidence}% confidence`,
      { symbol: signal.symbol, important: true, tag: 'consensus-' + signal.symbol }
    );
  }
}

async function executeAiTrades() {
  const openTrades = state.trades.filter(t => t.status === 'open');

  // Check if we can open more trades
  if (openTrades.length >= CONFIG.MAX_OPEN_TRADES) {
    console.log('🤖 Max open trades reached, skipping auto-trade');
    return;
  }

  for (const signal of state.aiSignals) {
    // Skip if already have a trade for this symbol
    if (openTrades.some(t => t.symbol === signal.symbol)) continue;

    // Only trade high confidence AI signals
    if (signal.confidence < CONFIG.AI_MIN_CONFIDENCE) continue;

    // Check if we have enough balance
    const maxPositionSize = state.balance * CONFIG.MAX_POSITION_SIZE_PERCENT / 100;
    const positionSize = Math.min(
      (state.balance * CONFIG.RISK_PERCENT / 100) * CONFIG.LEVERAGE,
      maxPositionSize * CONFIG.LEVERAGE
    );

    if (positionSize < 10) {
      console.log('🤖 Insufficient balance for trade');
      continue;
    }

    // Open the trade
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
      pnl: 0,
      isAiTrade: true,
      aiConfidence: signal.confidence,
      aiReasoning: signal.reasons[0]
    };

    state.trades.push(trade);
    console.log(`🤖 AI Auto-Trade opened: ${signal.direction} ${signal.symbol} @ $${formatPrice(signal.entry)}`);

    showNotification({
      ...signal,
      isAutoTrade: true
    });

    saveTrades();

    // Only open one trade per AI scan
    break;
  }

  renderPositions();
  renderHistory();
  updatePortfolioStats();
}

function updateAiScanStatus(status) {
  const scanEl = document.getElementById('nextAiScan');
  if (scanEl) scanEl.textContent = status;
}

function updateAiScanCountdown() {
  if (!state.nextAiScanTime) return;

  const update = () => {
    const remaining = Math.max(0, state.nextAiScanTime - Date.now());
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    const scanEl = document.getElementById('nextAiScan');
    if (scanEl) {
      scanEl.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
  };

  update();
  setInterval(update, 1000);
}

// ============================================
// ADVANCED TECHNICAL ANALYSIS
// ============================================

function findTrendlines(candles, lookback = 50) {
  if (candles.length < lookback) return { uptrends: [], downtrends: [] };

  const recent = candles.slice(-lookback);
  const highs = recent.map((c, i) => ({ price: c.high, index: i, time: c.time }));
  const lows = recent.map((c, i) => ({ price: c.low, index: i, time: c.time }));

  // Find swing highs and lows for trendlines
  const swingHighs = [];
  const swingLows = [];

  for (let i = 2; i < recent.length - 2; i++) {
    if (recent[i].high > recent[i-1].high && recent[i].high > recent[i-2].high &&
        recent[i].high > recent[i+1].high && recent[i].high > recent[i+2].high) {
      swingHighs.push({ price: recent[i].high, index: i, time: recent[i].time });
    }
    if (recent[i].low < recent[i-1].low && recent[i].low < recent[i-2].low &&
        recent[i].low < recent[i+1].low && recent[i].low < recent[i+2].low) {
      swingLows.push({ price: recent[i].low, index: i, time: recent[i].time });
    }
  }

  // Calculate trendlines (slope between two most recent points)
  const uptrends = [];
  const downtrends = [];

  if (swingLows.length >= 2) {
    const recent2Lows = swingLows.slice(-2);
    if (recent2Lows[1].price > recent2Lows[0].price) {
      uptrends.push({
        start: recent2Lows[0],
        end: recent2Lows[1],
        slope: (recent2Lows[1].price - recent2Lows[0].price) / (recent2Lows[1].index - recent2Lows[0].index)
      });
    }
  }

  if (swingHighs.length >= 2) {
    const recent2Highs = swingHighs.slice(-2);
    if (recent2Highs[1].price < recent2Highs[0].price) {
      downtrends.push({
        start: recent2Highs[0],
        end: recent2Highs[1],
        slope: (recent2Highs[1].price - recent2Highs[0].price) / (recent2Highs[1].index - recent2Highs[0].index)
      });
    }
  }

  return { uptrends, downtrends, swingHighs, swingLows };
}

function estimateLiquidationZones(price, leverage = 10) {
  // Estimate liquidation zones for typical leveraged positions
  // Long liquidation: price drops significantly
  // Short liquidation: price rises significantly
  const longLiquidation = price * (1 - (1 / leverage) * 0.9); // ~90% of liquidation price
  const shortLiquidation = price * (1 + (1 / leverage) * 0.9);

  return {
    longLiquidationZone: { from: longLiquidation * 0.98, to: longLiquidation * 1.02 },
    shortLiquidationZone: { from: shortLiquidation * 0.98, to: shortLiquidation * 1.02 }
  };
}

function calculateVolumeProfile(candles, numBins = 20) {
  if (candles.length < 10) return [];

  const minPrice = Math.min(...candles.map(c => c.low));
  const maxPrice = Math.max(...candles.map(c => c.high));
  const binSize = (maxPrice - minPrice) / numBins;

  const profile = [];
  for (let i = 0; i < numBins; i++) {
    profile.push({
      priceFrom: minPrice + i * binSize,
      priceTo: minPrice + (i + 1) * binSize,
      volume: 0
    });
  }

  for (const candle of candles) {
    const avgPrice = (candle.high + candle.low) / 2;
    const binIndex = Math.min(Math.floor((avgPrice - minPrice) / binSize), numBins - 1);
    if (binIndex >= 0) {
      profile[binIndex].volume += candle.volume;
    }
  }

  // Find high volume nodes (HVN) and low volume nodes (LVN)
  const maxVolume = Math.max(...profile.map(p => p.volume));
  return profile.map(p => ({
    ...p,
    priceCenter: (p.priceFrom + p.priceTo) / 2,
    isHVN: p.volume > maxVolume * 0.7,
    isLVN: p.volume < maxVolume * 0.3
  }));
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
  // Skip traditional scan if AI is configured - AI signals are primary
  if (isAnyAiConfigured()) {
    console.log('⏭️ Skipping traditional scan - using AI signals only');
    state.isScanning = false;
    updateScanStatus(state.markets.length, state.aiSignals.length);
    renderSignals();
    return;
  }

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

  // Add new signals to history (keep last 100)
  for (const signal of newSignals) {
    const existingIdx = state.signalHistory.findIndex(
      s => s.symbol === signal.symbol && s.direction === signal.direction
    );
    if (existingIdx === -1) {
      // New signal - add to history
      state.signalHistory.unshift({ ...signal, isNew: true });
    } else if (state.signalHistory[existingIdx].confidence !== signal.confidence) {
      // Signal updated - move to top
      state.signalHistory.splice(existingIdx, 1);
      state.signalHistory.unshift({ ...signal, isNew: true, isUpdated: true });
    }
  }
  // Keep only last 100 signals in history
  state.signalHistory = state.signalHistory.slice(0, 100);

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

  // Add EMA lines (hidden by default, toggle with IND button)
  state.ema20Series = state.chart.addLineSeries({
    color: '#58a6ff',
    lineWidth: 1,
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false,
    visible: false
  });

  state.ema50Series = state.chart.addLineSeries({
    color: '#d29922',
    lineWidth: 1,
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false,
    visible: false
  });

  state.ema200Series = state.chart.addLineSeries({
    color: '#a371f7',
    lineWidth: 2,
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false,
    visible: false
  });

  // Hide legend by default
  setTimeout(() => {
    const legend = document.querySelector('.chart-legend');
    if (legend) legend.style.display = 'none';
  }, 100);

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
  // Load more candles for longer history view
  const candles = await fetchKlines(state.selectedSymbol, state.currentTimeframe, CONFIG.CHART_HISTORY_LIMIT);
  if (candles.length === 0 || !state.candleSeries || !state.chart) return;

  // CRITICAL: Reset price scale to auto-scale for new data range
  state.chart.priceScale('right').applyOptions({
    autoScale: true,
    scaleMargins: { top: 0.1, bottom: 0.2 }
  });

  // Reset time scale before loading new data
  state.chart.timeScale().resetTimeScale();

  // Set candle data
  state.candleSeries.setData(candles);

  // Set volume data
  state.volumeSeries.setData(candles.map(c => ({
    time: c.time,
    value: c.volume,
    color: c.close >= c.open ? 'rgba(63, 185, 80, 0.3)' : 'rgba(248, 81, 73, 0.3)'
  })));

  // Calculate and display EMAs
  const closes = candles.map(c => c.close);

  // EMA 20
  const ema20Data = [];
  if (closes.length >= 20) {
    let ema20 = closes.slice(0, 20).reduce((a, b) => a + b, 0) / 20;
    for (let i = 20; i < candles.length; i++) {
      ema20 = closes[i] * (2 / 21) + ema20 * (1 - 2 / 21);
      ema20Data.push({ time: candles[i].time, value: ema20 });
    }
  }
  if (state.ema20Series) state.ema20Series.setData(ema20Data);

  // EMA 50
  const ema50Data = [];
  if (closes.length >= 50) {
    let ema50 = closes.slice(0, 50).reduce((a, b) => a + b, 0) / 50;
    for (let i = 50; i < candles.length; i++) {
      ema50 = closes[i] * (2 / 51) + ema50 * (1 - 2 / 51);
      ema50Data.push({ time: candles[i].time, value: ema50 });
    }
  }
  if (state.ema50Series) state.ema50Series.setData(ema50Data);

  // EMA 200
  const ema200Data = [];
  if (closes.length >= 200) {
    let ema200 = closes.slice(0, 200).reduce((a, b) => a + b, 0) / 200;
    for (let i = 200; i < candles.length; i++) {
      ema200 = closes[i] * (2 / 201) + ema200 * (1 - 2 / 201);
      ema200Data.push({ time: candles[i].time, value: ema200 });
    }
  }
  if (state.ema200Series) state.ema200Series.setData(ema200Data);

  // Draw support/resistance lines
  if (state.showSR) {
    const { supports, resistances } = findSupportResistance(candles);
    updateChartLevels(supports, resistances, candles[candles.length - 1].close);
  }

  // Load user-drawn lines for this symbol
  loadUserLines();

  // Fit content with a small delay to ensure data is rendered
  setTimeout(() => {
    if (state.chart) {
      state.chart.timeScale().fitContent();
    }
  }, 50);
}

function updateChartLevels(supports, resistances, currentPrice) {
  // Update the side panel levels
  const container = document.getElementById('chartLevels');
  if (container) {
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

  // Draw horizontal lines on the chart
  drawSupportResistanceLines(supports, resistances);
}

// User-drawn lines management
function addUserLine(price) {
  if (!state.candleSeries) return;

  const line = state.candleSeries.createPriceLine({
    price: price,
    color: '#d29922', // Yellow for user lines
    lineWidth: 2,
    lineStyle: LightweightCharts.LineStyle.Solid,
    axisLabelVisible: true,
    title: 'User',
    lineVisible: true,
    axisLabelColor: '#d29922',
    axisLabelTextColor: '#ffffff'
  });

  state.userLines.push(line);
  console.log(`📏 User line added at $${formatPrice(price)}`);

  // Save user lines to localStorage
  saveUserLines();
}

function clearUserLines() {
  if (!state.candleSeries || state.userLines.length === 0) return;

  state.userLines.forEach(line => {
    try {
      state.candleSeries.removePriceLine(line);
    } catch (e) {
      // Line might already be removed
    }
  });

  state.userLines = [];
  localStorage.removeItem(`user_lines_${state.selectedSymbol}`);
  console.log('📏 User lines cleared');
}

function saveUserLines() {
  const prices = state.userLines.map(line => {
    try {
      return line.options().price;
    } catch (e) {
      return null;
    }
  }).filter(p => p !== null);

  localStorage.setItem(`user_lines_${state.selectedSymbol}`, JSON.stringify(prices));
}

function loadUserLines() {
  if (!state.candleSeries) return;

  // Clear existing user lines first
  state.userLines.forEach(line => {
    try {
      state.candleSeries.removePriceLine(line);
    } catch (e) {}
  });
  state.userLines = [];

  // Load saved lines for this symbol
  try {
    const saved = localStorage.getItem(`user_lines_${state.selectedSymbol}`);
    if (saved) {
      const prices = JSON.parse(saved);
      for (const price of prices) {
        const line = state.candleSeries.createPriceLine({
          price: price,
          color: '#d29922',
          lineWidth: 2,
          lineStyle: LightweightCharts.LineStyle.Solid,
          axisLabelVisible: true,
          title: 'User',
          lineVisible: true,
          axisLabelColor: '#d29922',
          axisLabelTextColor: '#ffffff'
        });
        state.userLines.push(line);
      }
    }
  } catch (e) {
    console.error('Failed to load user lines:', e);
  }
}

function drawSupportResistanceLines(supports, resistances) {
  if (!state.candleSeries) return;

  // Remove existing price lines
  if (state.srLines && state.srLines.length > 0) {
    state.srLines.forEach(line => {
      try {
        state.candleSeries.removePriceLine(line);
      } catch (e) {
        // Line might already be removed
      }
    });
  }
  state.srLines = [];

  if (!state.showSR) return;

  // Draw resistance lines (red)
  resistances.forEach((price, index) => {
    const line = state.candleSeries.createPriceLine({
      price: price,
      color: '#f85149',
      lineWidth: 2,
      lineStyle: LightweightCharts.LineStyle.Dashed,
      axisLabelVisible: true,
      title: `R${index + 1}`,
      lineVisible: true,
      axisLabelColor: '#f85149',
      axisLabelTextColor: '#ffffff'
    });
    state.srLines.push(line);
  });

  // Draw support lines (green)
  supports.forEach((price, index) => {
    const line = state.candleSeries.createPriceLine({
      price: price,
      color: '#3fb950',
      lineWidth: 2,
      lineStyle: LightweightCharts.LineStyle.Dashed,
      axisLabelVisible: true,
      title: `S${index + 1}`,
      lineVisible: true,
      axisLabelColor: '#3fb950',
      axisLabelTextColor: '#ffffff'
    });
    state.srLines.push(line);
  });
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

  // When AI is configured, use AI signals; otherwise fall back to traditional signals
  // "new" tab uses signalHistory (which includes AI signals), "all" tab uses aiSignals or signals
  let signals;
  if (isAnyAiConfigured()) {
    signals = state.signalTab === 'new' ? state.signalHistory.filter(s => s.isAiGenerated) : state.aiSignals;
  } else {
    signals = state.signalTab === 'new' ? state.signalHistory : state.signals;
  }

  if (state.signalFilter === 'longs') signals = signals.filter(s => s.direction === 'LONG');
  else if (state.signalFilter === 'shorts') signals = signals.filter(s => s.direction === 'SHORT');

  if (signals.length === 0) {
    const apiStatus = isAnyAiConfigured();
    if (!apiStatus) {
      container.innerHTML = `
        <div class="empty-state api-setup">
          <h3>🔑 Setup AI Analysis</h3>
          <p>Open browser console (F12) and run:</p>
          <code>setApiKey("claude", "sk-ant-...")</code>
          <code>setApiKey("openai", "sk-...")</code>
          <p class="optional">Optional data sources:</p>
          <code>setApiKey("lunarcrush", "key")</code>
          <code>setApiKey("coinglass", "key")</code>
          <p class="links">
            Get keys at:<br>
            <a href="https://console.anthropic.com" target="_blank">console.anthropic.com</a><br>
            <a href="https://platform.openai.com" target="_blank">platform.openai.com</a>
          </p>
        </div>`;
    } else {
      container.innerHTML = '<div class="empty-state">Waiting for AI analysis... Next scan in a few minutes.</div>';
    }
    return;
  }

  // For "new" tab, show recent signals first (already sorted by time)
  // For "all" tab, sort by confidence
  if (state.signalTab === 'all') {
    signals = [...signals].sort((a, b) => b.confidence - a.confidence);
  }

  container.innerHTML = signals.map(signal => {
    const isRecent = Date.now() - signal.timestamp < 300000; // 5 minutes
    const isNew = signal.isNew && isRecent;
    const hasOpenTrade = state.trades.some(t => t.status === 'open' && t.symbol === signal.symbol);

    // Build AI source badge
    let aiSourceBadge = '';
    if (signal.isAiGenerated) {
      const hasClaude = signal.aiSources?.includes('claude') || signal.claudeModel;
      const hasOpenAI = signal.aiSources?.includes('openai') || signal.openaiModel;

      if (signal.isConsensus || (hasClaude && hasOpenAI)) {
        // Consensus signal - both AIs agree
        aiSourceBadge = `
          <div class="ai-consensus-badge">
            <span class="consensus-icon">🎯</span>
            <span class="consensus-label">AI CONSENSUS</span>
            <div class="ai-models">
              <span class="ai-model claude">Claude</span>
              <span class="ai-model openai">GPT-4o</span>
            </div>
            ${signal.marketSentiment ? `<span class="sentiment ${signal.marketSentiment.toLowerCase()}">${signal.marketSentiment}</span>` : ''}
          </div>`;
      } else if (hasClaude) {
        const modelShort = signal.claudeModel ? signal.claudeModel.replace('claude-', '').replace('-20241022', '') : '3.5-sonnet';
        aiSourceBadge = `
          <div class="claude-model-badge">
            <span class="model-icon">🧠</span>
            <span class="model-name">Claude ${modelShort}</span>
            ${signal.marketSentiment ? `<span class="sentiment ${signal.marketSentiment.toLowerCase()}">${signal.marketSentiment}</span>` : ''}
          </div>`;
      } else if (hasOpenAI) {
        const modelShort = signal.openaiModel ? signal.openaiModel.replace('gpt-', 'GPT-').replace('-preview', '') : 'GPT-4o';
        aiSourceBadge = `
          <div class="openai-model-badge">
            <span class="model-icon">🤖</span>
            <span class="model-name">${modelShort}</span>
            ${signal.marketSentiment ? `<span class="sentiment ${signal.marketSentiment.toLowerCase()}">${signal.marketSentiment}</span>` : ''}
          </div>`;
      } else {
        // Fallback for AI signals without specific source info
        aiSourceBadge = `
          <div class="claude-model-badge">
            <span class="model-icon">🤖</span>
            <span class="model-name">AI Analysis</span>
            ${signal.marketSentiment ? `<span class="sentiment ${signal.marketSentiment.toLowerCase()}">${signal.marketSentiment}</span>` : ''}
          </div>`;
      }
    }

    return `
    <div class="signal-card ${signal.direction.toLowerCase()} ${isNew ? 'new-signal' : ''} ${signal.isConsensus ? 'consensus-signal' : ''}" data-symbol="${signal.symbol}">
      <div class="signal-header">
        <div class="signal-symbol-info">
          <span class="signal-symbol">${signal.symbol.replace('USDT', '')}</span>
          <span class="signal-direction ${signal.direction.toLowerCase()}">${signal.direction}</span>
          ${signal.isConsensus ? '<span class="consensus-badge">🎯 CONSENSUS</span>' : ''}
          ${isNew && !signal.isConsensus ? '<span class="new-badge">NEW</span>' : ''}
          ${signal.isUpdated ? '<span class="updated-badge">UPDATED</span>' : ''}
          ${hasOpenTrade ? '<span class="trading-badge">TRADING</span>' : ''}
        </div>
        <div class="signal-confidence">
          <span class="conf-label">Confidence:</span>
          <span class="conf-value">${signal.confidence}%</span>
          <span class="signal-time">${timeAgo(signal.timestamp)}</span>
        </div>
      </div>
      <div class="signal-body">
        ${aiSourceBadge}
        <div class="signal-tags">
          ${signal.reasons.slice(0, 4).map((r, i) =>
            `<span class="signal-tag ${i < 2 ? 'active' : ''}">${r.length > 50 ? r.substring(0, 50) + '...' : r}</span>`
          ).join('')}
        </div>
        <div class="signal-analysis">${signal.reasons.slice(0, 2).join('. ')}</div>
        <div class="signal-levels">
          <div class="level-item tp-pct"><div class="level-label">Target %</div><div class="level-value ${signal.tpPercent >= 5 ? 'green' : 'yellow'}">${signal.tpPercent ? '+' + signal.tpPercent.toFixed(1) + '%' : '+' + Math.abs((signal.tp - signal.entry) / signal.entry * 100).toFixed(1) + '%'}</div></div>
          <div class="level-item entry"><div class="level-label">Entry</div><div class="level-value">${formatPrice(signal.entry)}</div></div>
          <div class="level-item target"><div class="level-label">Target</div><div class="level-value">${formatPrice(signal.tp)}</div></div>
          <div class="level-item stop"><div class="level-label">Stop</div><div class="level-value">${formatPrice(signal.sl)}</div></div>
        </div>
        ${(state.socialSentiment[signal.symbol] || state.liquidationData[signal.symbol]) ? `
        <div class="signal-intel">
          ${state.socialSentiment[signal.symbol] ? `
          <div class="intel-item sentiment-${state.socialSentiment[signal.symbol].sentimentLabel.toLowerCase()}">
            <span class="intel-icon">🌙</span>
            <span class="intel-label">Sentiment</span>
            <span class="intel-value">${state.socialSentiment[signal.symbol].sentimentLabel} (${state.socialSentiment[signal.symbol].sentiment})</span>
          </div>
          ` : ''}
          ${state.liquidationData[signal.symbol]?.crowdBias ? `
          <div class="intel-item crowd-${state.liquidationData[signal.symbol].crowdBias.toLowerCase().replace('_', '-')}">
            <span class="intel-icon">👥</span>
            <span class="intel-label">Crowd</span>
            <span class="intel-value">${state.liquidationData[signal.symbol].crowdBias.replace('_', ' ')}</span>
          </div>
          ` : ''}
          ${state.liquidationData[signal.symbol]?.priceImplication && state.liquidationData[signal.symbol].priceImplication !== 'NEUTRAL' ? `
          <div class="intel-item liq-${state.liquidationData[signal.symbol].priceImplication.toLowerCase().replace('_', '-')}">
            <span class="intel-icon">💧</span>
            <span class="intel-label">Liqs</span>
            <span class="intel-value">${state.liquidationData[signal.symbol].priceImplication.replace('_', ' ')}</span>
          </div>
          ` : ''}
        </div>
        ` : ''}
      </div>
      <div class="signal-footer">
        <div class="footer-stat"><div class="label">Risk ($)</div><div class="value">${(state.balance * CONFIG.RISK_PERCENT / 100).toFixed(0)}</div></div>
        <div class="footer-stat"><div class="label">Size</div><div class="value green">$${(state.balance * CONFIG.RISK_PERCENT / 100 * CONFIG.LEVERAGE).toFixed(0)}</div></div>
        <div class="footer-stat">
          <div class="label">Status</div>
          <div class="value ${hasOpenTrade ? 'green' : signal.isConsensus ? 'gold' : signal.confidence >= CONFIG.AI_MIN_CONFIDENCE ? 'cyan' : ''}">${hasOpenTrade ? '✓ In Trade' : signal.isConsensus ? '🎯 Priority' : signal.confidence >= CONFIG.AI_MIN_CONFIDENCE ? 'Auto-Trade' : 'Watching'}</div>
        </div>
      </div>
    </div>
  `}).join('');

  container.querySelectorAll('.signal-card').forEach(el => {
    el.addEventListener('click', (e) => {
      // Don't navigate if clicking the trade button
      if (e.target.classList.contains('take-trade-btn')) return;
      selectMarket(el.dataset.symbol);
    });
  });

  // Take Trade button handlers
  container.querySelectorAll('.take-trade-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const symbol = btn.dataset.symbol;
      const direction = btn.dataset.direction;
      const signal = signals.find(s => s.symbol === symbol && s.direction === direction);
      if (signal) {
        openTrade(signal);
        btn.textContent = '✓ Opened';
        btn.disabled = true;
        btn.classList.add('traded');
      }
    });
  });
}

function renderAlertBar() {
  const container = document.getElementById('alertBarSignals');
  if (!container) return;

  // Prioritize AI signals, then fall back to regular high confidence signals
  let topSignals = [];

  if (state.aiSignals && state.aiSignals.length > 0) {
    topSignals = state.aiSignals.slice(0, 2);
  } else {
    topSignals = state.signals.filter(s => s.confidence >= CONFIG.HIGH_CONFIDENCE).slice(0, 2);
  }

  if (topSignals.length === 0) {
    container.innerHTML = '<span class="muted">AI analyzing markets for top opportunities...</span>';
    return;
  }

  container.innerHTML = topSignals.map(s => `
    <div class="alert-signal ${s.isConsensus ? 'consensus' : ''}" data-symbol="${s.symbol}">
      <span class="symbol">${s.symbol.replace('USDT', '')}</span>
      <span class="direction ${s.direction.toLowerCase()}">${s.direction}</span>
      <span class="entry">$${formatPrice(s.entry)}</span>
      <span class="conf">${s.confidence}%</span>
      ${s.isConsensus ? '<span class="ai-indicator consensus">🎯 Both AIs</span>' :
        s.aiSources?.includes('claude') && s.aiSources?.includes('openai') ? '<span class="ai-indicator consensus">🎯 Both AIs</span>' :
        s.aiSources?.includes('claude') ? '<span class="ai-indicator claude">Claude</span>' :
        s.aiSources?.includes('openai') ? '<span class="ai-indicator openai">ChatGPT</span>' :
        s.isAiGenerated ? '<span class="ai-indicator">AI Pick</span>' : ''}
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
        <span class="symbol">
          ${t.symbol.replace('USDT', '')}
          ${t.isAiTrade ? '<span class="ai-trade-badge">🤖 AI</span>' : ''}
        </span>
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
      <span class="symbol">
        ${t.symbol.replace('USDT', '')}
        ${t.isAiTrade ? '<span class="ai-trade-badge">🤖</span>' : ''}
      </span>
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

  // Clear existing chart data and S/R lines before loading new data
  if (state.candleSeries) {
    state.candleSeries.setData([]);
  }
  if (state.volumeSeries) {
    state.volumeSeries.setData([]);
  }
  if (state.ema20Series) {
    state.ema20Series.setData([]);
  }
  if (state.ema50Series) {
    state.ema50Series.setData([]);
  }
  if (state.ema200Series) {
    state.ema200Series.setData([]);
  }

  // Remove existing S/R lines
  if (state.srLines && state.srLines.length > 0) {
    state.srLines.forEach(line => {
      try {
        state.candleSeries.removePriceLine(line);
      } catch (e) {}
    });
    state.srLines = [];
  }

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

  const isAutoTrade = signal.isAutoTrade || signal.isAiGenerated;
  const icon = isAutoTrade ? '🤖' : (signal.direction === 'LONG' ? '📈' : '📉');
  const title = isAutoTrade
    ? `AI AUTO-TRADE: ${signal.symbol} ${signal.direction}`
    : `${signal.symbol} ${signal.direction}`;

  notification.innerHTML = `
    <div class="notification-header">
      <span class="notification-icon">${icon}</span>
      <span class="notification-title">${title}</span>
      <button class="notification-close">&times;</button>
    </div>
    <div class="notification-body">
      <div class="notification-signal">
        <span class="notification-conf">Confidence: ${signal.confidence}%</span>
        ${isAutoTrade ? '<span style="color: var(--purple); margin-left: 8px;">Position Opened</span>' : ''}
      </div>
      <div class="notification-reason">${signal.reasons ? signal.reasons[0] : 'AI Analysis'}</div>
      ${isAutoTrade ? `
        <div style="margin-top: 8px; font-size: 11px; color: var(--text-secondary);">
          Entry: $${formatPrice(signal.entry)} | TP: $${formatPrice(signal.tp)} | SL: $${formatPrice(signal.sl)}
        </div>
      ` : ''}
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
  }, isAutoTrade ? 12000 : 8000);
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

function resetBalance() {
  if (!confirm('Are you sure you want to reset your balance to $2000? This will close all open positions and clear trade history.')) {
    return;
  }

  state.balance = 2000;
  state.startBalance = 2000;
  state.trades = [];
  state.equityHistory = [{ time: Date.now(), value: 2000 }];
  state.aiSignals = [];

  saveTrades();
  renderPositions();
  renderHistory();
  updatePortfolioStats();
  updateEquityChart();

  console.log('💰 Balance reset to $2000');

  showNotification({
    symbol: 'SYSTEM',
    direction: 'LONG',
    confidence: 100,
    reasons: ['Balance reset to $2000. Ready to trade!'],
    entry: 2000,
    tp: 2000,
    sl: 2000
  });
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

      if (!state.showSR) {
        // Remove S/R lines when toggled off
        if (state.srLines && state.srLines.length > 0) {
          state.srLines.forEach(line => {
            try {
              state.candleSeries.removePriceLine(line);
            } catch (err) {}
          });
          state.srLines = [];
        }
        // Clear the level markers
        const container = document.getElementById('chartLevels');
        if (container) container.innerHTML = '';
      } else {
        // Reload chart data to show S/R lines
        loadChartData();
      }
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

  // Toggle indicators (EMAs)
  const toggleIndicators = document.getElementById('toggleIndicators');
  if (toggleIndicators) {
    toggleIndicators.addEventListener('click', (e) => {
      e.target.classList.toggle('active');
      state.showIndicators = e.target.classList.contains('active');
      const visible = state.showIndicators;
      if (state.ema20Series) state.ema20Series.applyOptions({ visible });
      if (state.ema50Series) state.ema50Series.applyOptions({ visible });
      if (state.ema200Series) state.ema200Series.applyOptions({ visible });

      // Toggle legend visibility
      const legend = document.querySelector('.chart-legend');
      if (legend) legend.style.display = visible ? 'flex' : 'none';
    });
  }

  // Drawing tools
  const drawHLineBtn = document.getElementById('drawHLine');
  const clearLinesBtn = document.getElementById('clearLines');

  if (drawHLineBtn) {
    drawHLineBtn.addEventListener('click', () => {
      if (state.drawingMode === 'hline') {
        state.drawingMode = null;
        drawHLineBtn.classList.remove('drawing');
      } else {
        state.drawingMode = 'hline';
        drawHLineBtn.classList.add('drawing');
      }
    });
  }

  if (clearLinesBtn) {
    clearLinesBtn.addEventListener('click', () => {
      clearUserLines();
    });
  }

  // Chart click handler for drawing
  const chartContainer = document.getElementById('tradingChart');
  if (chartContainer) {
    chartContainer.addEventListener('click', (event) => {
      if (state.drawingMode === 'hline' && state.chart && state.candleSeries) {
        // Get price from click position
        const rect = chartContainer.getBoundingClientRect();
        const y = event.clientY - rect.top;

        // Convert Y position to price using the chart's coordinate conversion
        const price = state.candleSeries.coordinateToPrice(y);

        if (price && price > 0) {
          addUserLine(price);
          // Exit drawing mode after placing line
          state.drawingMode = null;
          if (drawHLineBtn) drawHLineBtn.classList.remove('drawing');
        }
      }
    });
  }

  // Signal tabs (New/All)
  document.querySelectorAll('.signal-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.signal-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      state.signalTab = tab.dataset.signalTab; // 'new' or 'all'
      renderSignals();
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
  if (refreshBtn) refreshBtn.addEventListener('click', () => {
    runScan();
    runAiAnalysis();
  });

  // Reset balance button
  const resetBalanceBtn = document.getElementById('resetBalanceBtn');
  if (resetBalanceBtn) resetBalanceBtn.addEventListener('click', resetBalance);

  // Settings button - open settings modal
  const settingsBtn = document.getElementById('settingsBtn');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', openSettingsModal);
  }

  // Settings modal handlers
  initSettingsModal();
}

// ============================================
// SETTINGS MODAL
// ============================================

function openSettingsModal() {
  const modal = document.getElementById('settingsModal');
  if (!modal) return;

  // Load current values into inputs
  document.getElementById('claudeApiKey').value = CONFIG.CLAUDE_API_KEY || '';
  document.getElementById('openaiApiKey').value = CONFIG.OPENAI_API_KEY || '';
  document.getElementById('lunarcrushApiKey').value = CONFIG.LUNARCRUSH_API_KEY || '';
  document.getElementById('coinglassApiKey').value = CONFIG.COINGLASS_API_KEY || '';

  // Load toggle states
  document.getElementById('aiAutoTradeToggle').checked = state.aiAutoTradeEnabled;
  document.getElementById('soundToggle').checked = state.soundEnabled;
  document.getElementById('notificationToggle').checked = state.notificationsEnabled;

  // Update API status display
  updateSettingsApiStatus();

  modal.classList.add('active');
}

function closeSettingsModal() {
  const modal = document.getElementById('settingsModal');
  if (modal) modal.classList.remove('active');
}

function updateSettingsApiStatus() {
  const statusEl = document.getElementById('settingsApiStatus');
  if (!statusEl) return;

  const claudeInput = document.getElementById('claudeApiKey');
  const openaiInput = document.getElementById('openaiApiKey');

  const claudeKey = claudeInput?.value || '';
  const openaiKey = openaiInput?.value || '';

  const claudeValid = claudeKey.startsWith('sk-ant-');
  const openaiValid = openaiKey.startsWith('sk-');

  // Update input visual states
  if (claudeInput) {
    claudeInput.classList.toggle('valid', claudeValid && claudeKey.length > 20);
    claudeInput.classList.toggle('invalid', claudeKey && !claudeValid);
  }
  if (openaiInput) {
    openaiInput.classList.toggle('valid', openaiValid && openaiKey.length > 20);
    openaiInput.classList.toggle('invalid', openaiKey && !openaiValid);
  }

  // Update status indicator
  if (claudeValid || openaiValid) {
    if (claudeValid && openaiValid) {
      statusEl.className = 'api-status connected';
      statusEl.querySelector('.status-text').textContent = 'Both AIs configured';
    } else {
      statusEl.className = 'api-status partial';
      statusEl.querySelector('.status-text').textContent = claudeValid ? 'Claude configured' : 'OpenAI configured';
    }
  } else {
    statusEl.className = 'api-status disconnected';
    statusEl.querySelector('.status-text').textContent = 'No AI configured';
  }
}

function saveSettings() {
  // Get values from inputs
  const claudeKey = document.getElementById('claudeApiKey')?.value?.trim() || '';
  const openaiKey = document.getElementById('openaiApiKey')?.value?.trim() || '';
  const lunarcrushKey = document.getElementById('lunarcrushApiKey')?.value?.trim() || '';
  const coinglassKey = document.getElementById('coinglassApiKey')?.value?.trim() || '';

  // Validate and save Claude API key
  if (claudeKey) {
    if (claudeKey.startsWith('sk-ant-')) {
      CONFIG.CLAUDE_API_KEY = claudeKey;
      localStorage.setItem('claude_api_key', claudeKey);
      console.log('✅ Claude API key saved');
    } else if (claudeKey.length > 0) {
      console.warn('⚠️ Invalid Claude API key format');
    }
  } else {
    CONFIG.CLAUDE_API_KEY = '';
    localStorage.removeItem('claude_api_key');
  }

  // Validate and save OpenAI API key
  if (openaiKey) {
    if (openaiKey.startsWith('sk-')) {
      CONFIG.OPENAI_API_KEY = openaiKey;
      localStorage.setItem('openai_api_key', openaiKey);
      console.log('✅ OpenAI API key saved');
    } else if (openaiKey.length > 0) {
      console.warn('⚠️ Invalid OpenAI API key format');
    }
  } else {
    CONFIG.OPENAI_API_KEY = '';
    localStorage.removeItem('openai_api_key');
  }

  // Save LunarCrush API key (no specific format validation)
  if (lunarcrushKey && lunarcrushKey.length > 5) {
    CONFIG.LUNARCRUSH_API_KEY = lunarcrushKey;
    localStorage.setItem('lunarcrush_api_key', lunarcrushKey);
    console.log('✅ LunarCrush API key saved');
  } else {
    CONFIG.LUNARCRUSH_API_KEY = '';
    localStorage.removeItem('lunarcrush_api_key');
  }

  // Save Coinglass API key (no specific format validation)
  if (coinglassKey && coinglassKey.length > 5) {
    CONFIG.COINGLASS_API_KEY = coinglassKey;
    localStorage.setItem('coinglass_api_key', coinglassKey);
    console.log('✅ Coinglass API key saved');
  } else {
    CONFIG.COINGLASS_API_KEY = '';
    localStorage.removeItem('coinglass_api_key');
  }

  // Save toggle states
  state.aiAutoTradeEnabled = document.getElementById('aiAutoTradeToggle')?.checked ?? true;
  state.soundEnabled = document.getElementById('soundToggle')?.checked ?? true;
  state.notificationsEnabled = document.getElementById('notificationToggle')?.checked ?? false;

  // Request notification permission if enabled
  if (state.notificationsEnabled) {
    requestNotificationPermission();
  }

  // Close modal
  closeSettingsModal();

  // Show success notification
  showNotification({
    type: 'info',
    title: 'Settings Saved',
    message: 'Your API keys and settings have been saved.'
  });

  // Run AI analysis if configured
  if (isAnyAiConfigured()) {
    console.log('🤖 AI configured - starting analysis...');
    updateAiScanStatus('Starting...');
    setTimeout(() => runAiAnalysis(), 1000);
  } else {
    updateAiScanStatus('No API Key');
  }

  // Re-render signals panel
  renderSignals();
}

function initSettingsModal() {
  // Close button
  const closeBtn = document.getElementById('settingsClose');
  if (closeBtn) closeBtn.addEventListener('click', closeSettingsModal);

  // Overlay click to close
  const overlay = document.querySelector('.settings-overlay');
  if (overlay) overlay.addEventListener('click', closeSettingsModal);

  // Save button
  const saveBtn = document.getElementById('settingsSaveBtn');
  if (saveBtn) saveBtn.addEventListener('click', saveSettings);

  // Toggle visibility buttons
  document.querySelectorAll('.toggle-visibility').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.target;
      const input = document.getElementById(targetId);
      if (input) {
        const isPassword = input.type === 'password';
        input.type = isPassword ? 'text' : 'password';
        btn.textContent = isPassword ? '🙈' : '👁';
      }
    });
  });

  // Real-time validation on input
  ['claudeApiKey', 'openaiApiKey'].forEach(id => {
    const input = document.getElementById(id);
    if (input) {
      input.addEventListener('input', updateSettingsApiStatus);
    }
  });

  // Escape key to close
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeSettingsModal();
    }
  });
}

// ============================================
// INITIALIZATION
// ============================================

async function init() {
  loadTrades();
  loadPerformanceStats();

  // Load API keys from localStorage
  const keysLoaded = loadApiKeys();
  console.log('🔑 API Keys loaded:', keysLoaded.claude ? 'Claude ✓' : 'Claude ✗', keysLoaded.openai ? 'OpenAI ✓' : 'OpenAI ✗');

  // Prompt for missing API keys after UI loads
  if (!keysLoaded.claude || !keysLoaded.openai) {
    setTimeout(() => {
      promptForApiKeys();
    }, 2000);
  }

  // Request notification permission
  requestNotificationPermission();

  // Expose functions to manage API keys and stats from console
  window.setApiKey = setApiKeyManually;
  window.showApiStatus = showApiKeyStatus;
  window.showStats = () => {
    const s = state.performanceStats;
    console.log('📊 Performance Stats:');
    console.log(`   Win Rate: ${getWinRate()}%`);
    console.log(`   Total Trades: ${s.totalTrades} (${s.winningTrades}W / ${s.losingTrades}L)`);
    console.log(`   Total PnL: $${s.totalPnL.toFixed(2)}`);
    console.log(`   Largest Win: $${s.largestWin.toFixed(2)}`);
    console.log(`   Largest Loss: $${s.largestLoss.toFixed(2)}`);
    console.log(`   Max Drawdown: ${s.maxDrawdown.toFixed(2)}%`);
    console.log(`   Current Streak: ${s.currentStreak}`);
    console.log('');
    console.log('   AI Performance:');
    console.log(`   Claude: ${getAIPerformance('claude')}% win rate`);
    console.log(`   ChatGPT: ${getAIPerformance('openai')}% win rate`);
    console.log(`   Consensus: ${getAIPerformance('consensus')}% win rate`);
  };
  window.toggleSound = () => { state.soundEnabled = !state.soundEnabled; console.log('🔊 Sound:', state.soundEnabled ? 'ON' : 'OFF'); };
  console.log('💡 Commands: setApiKey(), showApiStatus(), showStats(), toggleSound()');

  // Update balance display
  const startBalEl = document.getElementById('startBalance');
  if (startBalEl) startBalEl.textContent = '$' + state.startBalance.toFixed(0);

  state.markets = await fetchMarkets();
  renderMarkets();

  initChart();
  initEquityChart();

  if (state.markets.length > 0) selectMarket(state.markets[0].symbol);

  initWebSocket();
  initEventListeners();

  // Run initial scans
  runScan();

  // Start regular scan interval
  setInterval(runScan, CONFIG.SCAN_INTERVAL);
  setInterval(updateOpenPositions, CONFIG.PNL_UPDATE_INTERVAL);
  setInterval(renderMarkets, 2000);

  // Initialize AI scanning with 10-minute interval
  console.log('🤖 Sentient Trader v4.0 - Dual AI System');
  console.log('💰 Starting balance: $' + state.balance.toFixed(2));
  console.log('📊 Features: Funding Rates, OI Tracking, MTF Analysis, Trailing Stops');
  console.log('🎯 AI Consensus Detection enabled');

  // Run first AI analysis after initial data is loaded
  setTimeout(() => {
    if (isAnyAiConfigured()) {
      runAiAnalysis();
    }
  }, 5000);

  // Set up 10-minute AI scan interval
  setInterval(runAiAnalysis, CONFIG.AI_SCAN_INTERVAL);

  // Periodically update funding rates (every 5 minutes)
  setInterval(fetchFundingRates, 300000);

  // Initialize countdown
  state.nextAiScanTime = Date.now() + 5000; // First scan in 5 seconds
  updateAiScanCountdown();

  console.log('✅ Sentient Trader initialized successfully');
}

document.addEventListener('DOMContentLoaded', init);
