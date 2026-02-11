// ============================================
// SHARED TRADING CONFIG — SINGLE SOURCE OF TRUTH
// ============================================
// This file is the authoritative config for ALL trading parameters.
// Server-side: import directly from '../lib/trading-config.js'
// Client-side: fetched via /api/trading-config endpoint on startup
//
// IMPORTANT: When changing ANY value here, it automatically propagates to:
//   - api/scan.js (trade opening)
//   - api/monitor-positions.js (TP/SL monitoring, trailing, partial TP)
//   - api/portfolio.js (portfolio defaults)
//   - app.js (client-side trading via /api/trading-config fetch)

// === DUAL PORTFOLIO CONFIG ===
export const PORTFOLIO_CONFIG = {
  silver: {
    leverage: 5,
    riskPercent: 18,      // 18% of portfolio per trade
    maxOpenTrades: 5,
    tpMultiplier: 2.5,    // TP at 2.5x the risk distance
    slPercent: 2           // 2% stop loss from entry
  },
  gold: {
    leverage: 7,
    riskPercent: 22,       // 22% of portfolio per trade
    maxOpenTrades: 4,
    tpMultiplier: 3,       // TP at 3x the risk distance
    slPercent: 1.5         // 1.5% stop loss from entry
  }
};

// === CONFIDENCE-BASED POSITION SCALING ===
// Multiplier applied to base risk % based on signal confidence
export const CONFIDENCE_SCALING = {
  ultra: { minConfidence: 92, multiplier: 1.3 },   // 92%+ → 30% bigger
  high:  { minConfidence: 85, multiplier: 1.1 },   // 85-91% → 10% bigger
  base:  { minConfidence: 75, multiplier: 1.0 },   // 75-84% → base size
  low:   { minConfidence: 0,  multiplier: 0.7 }    // <75% → 30% smaller
};

// === ANTI-MARTINGALE (WIN STREAK SCALING) ===
// Progressive risk increase on consecutive wins, reset on loss
export const ANTI_MARTINGALE = {
  streakIncrement: 0.3,  // +30% per consecutive win
  maxMultiplier: 2.0     // Cap at 2x base risk
};

// === KELLY CRITERION POSITION SIZING ===
// Half-Kelly for safety — uses actual win rate & avg win/loss
export const KELLY_CRITERION = {
  minClosedTrades: 15,    // Need 15+ closed trades before activating
  kellyFraction: 0.5,     // Half-Kelly (standard safety practice)
  minRiskPercent: 1,      // Floor: never go below 1%
  maxRiskMultiplier: 2    // Ceiling: never exceed 2x base risk
};

// === REGIME-SPECIFIC RISK ADJUSTMENT ===
// Reduce risk in choppy/volatile markets, increase in trends
export const REGIME_RISK = {
  TRENDING_UP:   1.1,    // +10% in uptrend
  TRENDING_DOWN: 1.1,    // +10% in downtrend
  VOLATILE:      0.7,    // -30% in volatile
  RANGING:       0.6,    // -40% in ranging
  CHOPPY:        0.6,    // -40% in choppy
  DEFAULT:       1.0     // Neutral/unknown
};

// === HARD RISK CAP ===
// Absolute maximum risk per trade regardless of multiplier stacking
export const MAX_RISK_CAP_PERCENT = 40;

// === PARTIAL TAKE PROFIT ===
// Incremental profit-taking at 3 levels
export const PARTIAL_TP = {
  tp1: { percent: 0.50, closeRatio: 0.40 },  // Close 40% at 50% of target
  tp2: { percent: 0.75, closeRatio: 0.30 },  // Close 30% at 75% of target
  tp3: { percent: 1.00, closeRatio: 0.30 }   // Close remaining 30% at full target
};

// === BREAKEVEN + TRAILING STOP ===
// Moves SL to breakeven at threshold, then trails behind price
export const TRAIL_CONFIG = {
  silver: { breakevenThreshold: 0.50, trailPercent: 2.0 },  // Breakeven at 50% to TP, trail 2%
  gold:   { breakevenThreshold: 0.50, trailPercent: 1.5 }   // Breakeven at 50% to TP, trail 1.5%
};

// === DRAWDOWN KILL SWITCH ===
export const DRAWDOWN_KILL = {
  threshold: 0.30,       // -30% from peak → halt all new trades
  recoveryThreshold: 0.25, // Resume trading when recovered to -25%
  overrideDurationMs: 24 * 60 * 60 * 1000  // Manual override lasts 24h
};

// === CIRCUIT BREAKERS ===
// Daily/weekly loss limits to prevent cascading losses
export const CIRCUIT_BREAKERS = {
  dailyLossLimit: 0.05,   // 5% of balance
  weeklyLossLimit: 0.15   // 15% of balance
};

// === MAX EXPOSURE ===
// Total open position value cannot exceed this fraction of balance
export const MAX_EXPOSURE_RATIO = 0.60;  // 60% of balance

// === CORRELATION GROUPS ===
// Max 1 trade per group to avoid correlated losses
export const CORRELATION_GROUPS = {
  'BTC_ECOSYSTEM': ['BTCUSDT', 'STXUSDT', 'ORDIUSDT', 'KASUSDT'],
  'ETH_ECOSYSTEM': ['ETHUSDT', 'OPUSDT', 'ARBUSDT', 'MATICUSDT', 'IMXUSDT', 'EIGENUSDT'],
  'ALT_L1': ['SOLUSDT', 'AVAXUSDT', 'DOTUSDT', 'NEARUSDT', 'APTUSDT', 'SUIUSDT', 'ATOMUSDT', 'ICPUSDT', 'SEIUSDT', 'FTMUSDT', 'ALGOUSDT', 'HBARUSDT', 'FLOWUSDT', 'THETAUSDT'],
  'MEME': ['DOGEUSDT', 'PEPEUSDT', 'WIFUSDT', 'BLURUSDT', 'JASMYUSDT', 'COOKIEUSDT'],
  'DEFI': ['LINKUSDT', 'ADAUSDT', 'UNIUSDT', 'AAVEUSDT', 'INJUSDT', 'RUNEUSDT', 'PENDLEUSDT', 'MKRUSDT', 'LDOUSDT', 'SNXUSDT', 'GMXUSDT', 'DYDXUSDT', 'JUPUSDT'],
  'AI_TOKENS': ['FETUSDT', 'RENDERUSDT', 'WLDUSDT'],
  'STORAGE': ['FILUSDT', 'TIAUSDT'],
  'RWA': ['ONDOUSDT', 'ENAUSDT'],
  'INFRA': ['GRTUSDT'],
  'EXCHANGE': ['BNBUSDT'],
  'LEGACY': ['LTCUSDT', 'TRXUSDT', 'XRPUSDT']
};

export const MAX_SIGNALS_PER_GROUP = 2;

// === TRADINGVIEW INDICATOR CONFIRMATION ===
// When enabled, AI consensus signals must be confirmed by a TradingView indicator
// The TV indicator sends BUY/SELL webhooks to /api/tv-webhook
export const TV_INDICATOR = {
  enabled: true,           // Master toggle for TV confirmation filter
  mode: 'confirmation',    // 'confirmation' = gate for AI trades, 'standalone' = independent signals
  signalTTLMinutes: 30,    // How long a TV signal stays valid after received
  // When strict=true, ALL coins need TV confirmation. When false, only coins that
  // have received at least one TV signal are filtered (others trade freely).
  strict: false,
  // Redis key prefix for TV signals
  redisKeyPrefix: 'tv_signal:'
};

// === TRADINGVIEW INDICATOR STANDALONE PORTFOLIO ===
// Independent portfolio that tracks P&L of TV indicator signals separately from AI consensus
export const TV_PORTFOLIO = {
  enabled: true,
  redisKey: 'tv_portfolio_data',
  // Use silver-level position sizing as baseline
  leverage: 5,
  riskPercent: 18,
  maxOpenTrades: 5,
  startBalance: 5000
};

// === DEFAULT PORTFOLIO STATE ===
export const DEFAULT_PORTFOLIO = {
  balance: 5000,
  startBalance: 5000
};

// === HELPER FUNCTIONS ===
// These are shared between server and client to ensure consistency

export function getStreakMultiplier(streak) {
  return Math.min(1 + streak * ANTI_MARTINGALE.streakIncrement, ANTI_MARTINGALE.maxMultiplier);
}

export function getConfidenceMultiplier(confidence) {
  if (confidence >= CONFIDENCE_SCALING.ultra.minConfidence) return CONFIDENCE_SCALING.ultra.multiplier;
  if (confidence >= CONFIDENCE_SCALING.high.minConfidence) return CONFIDENCE_SCALING.high.multiplier;
  if (confidence >= CONFIDENCE_SCALING.base.minConfidence) return CONFIDENCE_SCALING.base.multiplier;
  return CONFIDENCE_SCALING.low.multiplier;
}

export function getConfidenceLabel(confidence) {
  if (confidence >= CONFIDENCE_SCALING.ultra.minConfidence) return 'ULTRA';
  if (confidence >= CONFIDENCE_SCALING.high.minConfidence) return 'HIGH';
  if (confidence >= CONFIDENCE_SCALING.base.minConfidence) return 'BASE';
  return 'LOW';
}

export function getRegimeMultiplier(regime) {
  return REGIME_RISK[regime] || REGIME_RISK.DEFAULT;
}

export function calculateKellyRisk(closedTrades, baseRiskPercent) {
  if (closedTrades.length < KELLY_CRITERION.minClosedTrades) {
    return baseRiskPercent;
  }
  const wins = closedTrades.filter(t => t.pnl > 0);
  const losses = closedTrades.filter(t => t.pnl <= 0);
  const winRate = wins.length / closedTrades.length;
  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + t.pnl, 0) / losses.length) : 1;
  const winLossRatio = avgLoss > 0 ? avgWin / avgLoss : 1;

  // Kelly: f* = (bp - q) / b
  const kellyFull = (winLossRatio * winRate - (1 - winRate)) / Math.max(winLossRatio, 0.01);
  const kellyHalf = Math.max(0, kellyFull * KELLY_CRITERION.kellyFraction) * 100;
  return Math.max(KELLY_CRITERION.minRiskPercent, Math.min(kellyHalf, baseRiskPercent * KELLY_CRITERION.maxRiskMultiplier));
}

export function calculateAdjustedRisk({ baseRiskPercent, closedTrades, winStreak, marketRegime, confidence }) {
  // 1. Kelly Criterion (replaces base risk if enough data)
  let risk = calculateKellyRisk(closedTrades || [], baseRiskPercent);

  // 2. Anti-Martingale streak multiplier
  const streakMult = getStreakMultiplier(winStreak || 0);

  // 3. Regime multiplier
  const regimeMult = getRegimeMultiplier(marketRegime);

  // 4. Confidence multiplier
  const confMult = getConfidenceMultiplier(confidence || 80);

  // Combine all multipliers
  let adjustedRisk = risk * streakMult * regimeMult * confMult;

  // 5. Hard cap
  if (adjustedRisk > MAX_RISK_CAP_PERCENT) {
    adjustedRisk = MAX_RISK_CAP_PERCENT;
  }

  return {
    adjustedRisk,
    kellyRisk: risk,
    streakMultiplier: streakMult,
    regimeMultiplier: regimeMult,
    confidenceMultiplier: confMult,
    confidenceLabel: getConfidenceLabel(confidence || 80),
    wasCapped: risk * streakMult * regimeMult * confMult > MAX_RISK_CAP_PERCENT
  };
}

export function getCorrelationGroup(symbol) {
  for (const [group, symbols] of Object.entries(CORRELATION_GROUPS)) {
    if (symbols.includes(symbol)) return group;
  }
  return symbol; // Each uncategorized symbol is its own group
}

// Export everything as a single object for the API endpoint
export const TRADING_CONFIG = {
  PORTFOLIO_CONFIG,
  CONFIDENCE_SCALING,
  ANTI_MARTINGALE,
  KELLY_CRITERION,
  REGIME_RISK,
  MAX_RISK_CAP_PERCENT,
  PARTIAL_TP,
  TRAIL_CONFIG,
  DRAWDOWN_KILL,
  CIRCUIT_BREAKERS,
  MAX_EXPOSURE_RATIO,
  CORRELATION_GROUPS,
  MAX_SIGNALS_PER_GROUP,
  DEFAULT_PORTFOLIO,
  TV_INDICATOR,
  TV_PORTFOLIO
};
