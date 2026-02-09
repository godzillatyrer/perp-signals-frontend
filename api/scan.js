// Vercel Serverless Function for AI Signal Scanning
// Runs on cron schedule and sends Telegram alerts
//
// Uses Upstash Redis for persistent cooldown tracking across invocations
// Integrates Discord community calls for enhanced AI context

import { Redis } from '@upstash/redis';
import { getRecentCalls, formatCallsForAIContext } from './discord.js';
import { addPendingSignal, evaluatePendingSignals, getPendingSignalsSummary } from './pending-signals.js';

const CONFIG = {
  // Minimum confidence for alerts
  ALERT_CONFIDENCE: 75,
  // Minimum TP percentages by market cap
  MIN_TP_PERCENT_BTC_ETH: 3,
  MIN_TP_PERCENT_LARGE_CAP: 5,
  MIN_TP_PERCENT_MID_CAP: 7,
  // Top coins to analyze
  TOP_COINS: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'LINKUSDT', 'DOTUSDT'],
  // Signal cooldown in hours - 12 hours per coin (same coin cannot signal again)
  SIGNAL_COOLDOWN_HOURS: 12,
  // Price move % that overrides cooldown - ONLY 10%+ can bypass 12h cooldown
  PRICE_MOVE_OVERRIDE_PERCENT: 10,
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
  MAX_ENTRY_WIGGLE_PERCENT: 4,
  MAX_SL_WIGGLE_PERCENT: 3,
  MAX_TP_WIGGLE_PERCENT: 5,
  // Allow both Silver (2/3) and Gold (3/3) consensus signals
  REQUIRE_GOLD_CONSENSUS: false
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
  // 2026 events - FOMC Meetings
  { date: '2026-01-28', name: 'FOMC Meeting', type: 'FOMC' },
  { date: '2026-03-18', name: 'FOMC Meeting', type: 'FOMC' },
  { date: '2026-05-06', name: 'FOMC Meeting', type: 'FOMC' },
  { date: '2026-06-17', name: 'FOMC Meeting', type: 'FOMC' },
  { date: '2026-07-29', name: 'FOMC Meeting', type: 'FOMC' },
  { date: '2026-09-16', name: 'FOMC Meeting', type: 'FOMC' },
  { date: '2026-11-04', name: 'FOMC Meeting', type: 'FOMC' },
  { date: '2026-12-16', name: 'FOMC Meeting', type: 'FOMC' },
  // 2026 CPI Releases
  { date: '2026-01-14', name: 'CPI Release', type: 'CPI' },
  { date: '2026-02-11', name: 'CPI Release', type: 'CPI' },
  { date: '2026-03-11', name: 'CPI Release', type: 'CPI' },
  { date: '2026-04-14', name: 'CPI Release', type: 'CPI' },
  { date: '2026-05-12', name: 'CPI Release', type: 'CPI' },
  { date: '2026-06-10', name: 'CPI Release', type: 'CPI' },
  { date: '2026-07-15', name: 'CPI Release', type: 'CPI' },
  { date: '2026-08-12', name: 'CPI Release', type: 'CPI' },
  { date: '2026-09-15', name: 'CPI Release', type: 'CPI' },
  { date: '2026-10-13', name: 'CPI Release', type: 'CPI' },
  { date: '2026-11-12', name: 'CPI Release', type: 'CPI' },
  { date: '2026-12-10', name: 'CPI Release', type: 'CPI' },
  // 2026 NFP Releases (First Friday of each month)
  { date: '2026-01-09', name: 'NFP Release', type: 'NFP' },
  { date: '2026-02-06', name: 'NFP Release', type: 'NFP' },
  { date: '2026-03-06', name: 'NFP Release', type: 'NFP' },
  { date: '2026-04-03', name: 'NFP Release', type: 'NFP' },
  { date: '2026-05-01', name: 'NFP Release', type: 'NFP' },
  { date: '2026-06-05', name: 'NFP Release', type: 'NFP' },
  { date: '2026-07-02', name: 'NFP Release', type: 'NFP' },
  { date: '2026-08-07', name: 'NFP Release', type: 'NFP' },
  { date: '2026-09-04', name: 'NFP Release', type: 'NFP' },
  { date: '2026-10-02', name: 'NFP Release', type: 'NFP' },
  { date: '2026-11-06', name: 'NFP Release', type: 'NFP' },
  { date: '2026-12-04', name: 'NFP Release', type: 'NFP' },
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
// Cooldown: 12 hours, unless direction flips or price moves 10%+

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

  // NOTE: Direction flip bypass REMOVED - 12h cooldown applies regardless of direction
  // The same coin should not get signals within 12h, whether LONG or SHORT
  // This prevents oscillating signals when AI recommendations flip back and forth

  // Check price movement - ONLY 10%+ can override cooldown
  if (lastSignal.entry && currentPrice) {
    const priceChange = Math.abs((currentPrice - lastSignal.entry) / lastSignal.entry * 100);
    if (priceChange >= CONFIG.PRICE_MOVE_OVERRIDE_PERCENT) {
      console.log(`📈 ${symbol}: Price moved ${priceChange.toFixed(1)}% (>= 10%) - OK to send`);
      return false;
    }
  }

  // ON COOLDOWN - Block signal regardless of small price movements
  const hoursRemaining = (CONFIG.SIGNAL_COOLDOWN_HOURS - hoursSinceLast).toFixed(1);
  console.log(`🚫 ${symbol}: On cooldown (${hoursRemaining}h remaining) - BLOCKED`);
  return true;
}

// ============================================
// AI PERFORMANCE STATS TRACKING
// ============================================
// Persists AI signal counts to Redis so they update even when frontend is closed

const AI_STATS_KEY = 'ai_performance_stats';

async function getAIStats() {
  const r = getRedis();
  if (!r) return null;

  try {
    const data = await r.get(AI_STATS_KEY);
    if (data) {
      return typeof data === 'string' ? JSON.parse(data) : data;
    }
    return {
      claudeWins: 0, claudeLosses: 0, claudeSignals: 0, claudeTotalConf: 0,
      openaiWins: 0, openaiLosses: 0, openaiSignals: 0, openaiTotalConf: 0,
      grokWins: 0, grokLosses: 0, grokSignals: 0, grokTotalConf: 0,
      goldConsensusWins: 0, goldConsensusLosses: 0, goldConsensusSignals: 0,
      silverConsensusWins: 0, silverConsensusLosses: 0, silverConsensusSignals: 0,
      lastUpdated: Date.now()
    };
  } catch (e) {
    console.error('Redis get error for AI stats:', e.message);
    return null;
  }
}

async function updateAISignalCounts(analyses, consensusSignals) {
  const r = getRedis();
  if (!r) {
    console.log('📊 Redis not configured - AI stats not persisted');
    return;
  }

  try {
    const stats = await getAIStats() || {
      claudeWins: 0, claudeLosses: 0, claudeSignals: 0, claudeTotalConf: 0,
      openaiWins: 0, openaiLosses: 0, openaiSignals: 0, openaiTotalConf: 0,
      grokWins: 0, grokLosses: 0, grokSignals: 0, grokTotalConf: 0,
      goldConsensusWins: 0, goldConsensusLosses: 0, goldConsensusSignals: 0,
      silverConsensusWins: 0, silverConsensusLosses: 0, silverConsensusSignals: 0
    };

    // Count signals from each AI that responded
    for (const analysis of analyses) {
      if (!analysis || !analysis.source) continue;

      const signalCount = analysis.signals?.length || 0;
      const totalConf = analysis.signals?.reduce((sum, p) => sum + (p.confidence || 0), 0) || 0;

      if (analysis.source === 'claude') {
        stats.claudeSignals += signalCount;
        stats.claudeTotalConf += totalConf;
        console.log(`📊 Claude: +${signalCount} signals (total: ${stats.claudeSignals})`);
      } else if (analysis.source === 'openai') {
        stats.openaiSignals += signalCount;
        stats.openaiTotalConf += totalConf;
        console.log(`📊 Gemini: +${signalCount} signals (total: ${stats.openaiSignals})`);
      } else if (analysis.source === 'grok') {
        stats.grokSignals += signalCount;
        stats.grokTotalConf += totalConf;
        console.log(`📊 Grok: +${signalCount} signals (total: ${stats.grokSignals})`);
      }
    }

    // Count consensus signals
    for (const signal of consensusSignals) {
      if (signal.isGoldConsensus) {
        stats.goldConsensusSignals++;
      } else if (signal.aiSources?.length >= 2) {
        stats.silverConsensusSignals++;
      }
    }

    stats.lastUpdated = Date.now();
    await r.set(AI_STATS_KEY, JSON.stringify(stats));
    console.log('📊 AI stats saved to Redis');
  } catch (e) {
    console.error('Failed to update AI stats:', e.message);
  }
}

// ============================================
// AI SIGNAL LOG - Persist individual AI picks to Redis
// ============================================
// Saves each AI's individual signal details so the AI tab works even when browser is closed

const AI_SIGNAL_LOG_KEY = 'ai_signal_log';

async function saveAiSignalLogToRedis(analyses, consensusSignals) {
  const r = getRedis();
  if (!r) return;

  try {
    // Load existing signal log
    const existing = await r.get(AI_SIGNAL_LOG_KEY);
    const log = existing
      ? (typeof existing === 'string' ? JSON.parse(existing) : existing)
      : { claude: [], openai: [], grok: [], consensus: [] };

    const now = Date.now();

    // Add individual AI signals
    for (const analysis of analyses) {
      if (!analysis || !analysis.source || !analysis.signals) continue;
      const source = analysis.source;
      if (!log[source]) log[source] = [];

      for (const sig of analysis.signals) {
        const normalized = normalizeSignal(sig);
        if (!normalized) continue;

        // Skip if there's already a pending signal for same symbol+direction from this AI
        const hasPending = log[source].some(s =>
          s.symbol === normalized.symbol &&
          s.direction === normalized.direction &&
          s.shadowStatus === 'pending'
        );
        if (hasPending) {
          console.log(`⏭️ ${source}: Skipping duplicate ${normalized.symbol} ${normalized.direction} — pending signal exists`);
          continue;
        }

        log[source].unshift({
          symbol: normalized.symbol,
          direction: normalized.direction,
          entry: normalized.entry,
          tp: normalized.takeProfit,
          sl: normalized.stopLoss,
          confidence: normalized.confidence,
          reasoning: (normalized.reasons || []).slice(0, 3).join('; ').slice(0, 200),
          timestamp: now,
          shadowStatus: 'pending',
          shadowPnl: null
        });
      }

      // Keep last 50 per AI
      log[source] = log[source].slice(0, 50);
    }

    // Add consensus signals
    for (const sig of consensusSignals) {
      if (!log.consensus) log.consensus = [];

      // Skip if pending consensus already exists for same symbol+direction
      const hasPendingConsensus = log.consensus.some(s =>
        s.symbol === sig.symbol &&
        s.direction === sig.direction &&
        !s.tradeResult
      );
      if (hasPendingConsensus) {
        console.log(`⏭️ consensus: Skipping duplicate ${sig.symbol} ${sig.direction} — pending consensus exists`);
        continue;
      }

      log.consensus.unshift({
        symbol: sig.symbol,
        direction: sig.direction,
        entry: sig.entry,
        tp: sig.takeProfit,
        sl: sig.stopLoss,
        confidence: sig.confidence,
        aiSources: sig.aiSources,
        isGold: sig.isGoldConsensus,
        reasons: (sig.reasons || []).slice(0, 3),
        timestamp: now,
        tradeResult: null,
        tradePnl: null
      });
    }
    log.consensus = (log.consensus || []).slice(0, 50);

    await r.set(AI_SIGNAL_LOG_KEY, JSON.stringify(log));
    console.log(`📝 AI signal log saved to Redis (claude:${log.claude.length} gemini:${log.openai.length} grok:${log.grok.length} consensus:${log.consensus.length})`);
  } catch (e) {
    console.error('Failed to save AI signal log:', e.message);
  }
}

// ============================================
// PENDING SIGNAL EVALUATION & WIN/LOSS TRACKING
// ============================================
// Evaluates pending signals against current prices and updates AI win/loss stats

async function evaluateAndUpdateAIWinLoss(marketPrices) {
  const r = getRedis();
  if (!r) {
    console.log('📊 Redis not configured - skipping pending signal evaluation');
    return { wins: 0, losses: 0, expired: 0 };
  }

  try {
    // Convert market prices to simple symbol -> price map
    const priceMap = {};
    for (const [symbol, data] of Object.entries(marketPrices)) {
      priceMap[symbol] = typeof data === 'object' ? data.price : data;
    }

    console.log('📈 Evaluating pending signals against current prices...');
    const results = await evaluatePendingSignals(priceMap);

    // Update AI stats for wins and losses
    if (results.wins.length > 0 || results.losses.length > 0) {
      const stats = await getAIStats() || {
        claudeWins: 0, claudeLosses: 0, claudeSignals: 0, claudeTotalConf: 0,
        openaiWins: 0, openaiLosses: 0, openaiSignals: 0, openaiTotalConf: 0,
        grokWins: 0, grokLosses: 0, grokSignals: 0, grokTotalConf: 0,
        goldConsensusWins: 0, goldConsensusLosses: 0, goldConsensusSignals: 0,
        silverConsensusWins: 0, silverConsensusLosses: 0, silverConsensusSignals: 0
      };

      // Record wins
      for (const signal of results.wins) {
        if (signal.aiSource === 'claude') {
          stats.claudeWins++;
          console.log(`✅ Claude WIN: ${signal.symbol} ${signal.direction}`);
        } else if (signal.aiSource === 'openai') {
          stats.openaiWins++;
          console.log(`✅ OpenAI WIN: ${signal.symbol} ${signal.direction}`);
        } else if (signal.aiSource === 'grok') {
          stats.grokWins++;
          console.log(`✅ Grok WIN: ${signal.symbol} ${signal.direction}`);
        }
      }

      // Record losses
      for (const signal of results.losses) {
        if (signal.aiSource === 'claude') {
          stats.claudeLosses++;
          console.log(`❌ Claude LOSS: ${signal.symbol} ${signal.direction}`);
        } else if (signal.aiSource === 'openai') {
          stats.openaiLosses++;
          console.log(`❌ OpenAI LOSS: ${signal.symbol} ${signal.direction}`);
        } else if (signal.aiSource === 'grok') {
          stats.grokLosses++;
          console.log(`❌ Grok LOSS: ${signal.symbol} ${signal.direction}`);
        }
      }

      stats.lastUpdated = Date.now();
      await r.set(AI_STATS_KEY, JSON.stringify(stats));
      console.log(`📊 Updated AI stats: +${results.wins.length} wins, +${results.losses.length} losses`);
    }

    // Log summary
    if (results.entryTriggered.length > 0) {
      console.log(`🎯 Entry triggered for ${results.entryTriggered.length} signals`);
    }
    if (results.expired.length > 0) {
      console.log(`⏰ ${results.expired.length} signals expired (entry never hit)`);
    }
    console.log(`📋 ${results.stillPending.length} signals still pending/active`);

    return {
      wins: results.wins.length,
      losses: results.losses.length,
      expired: results.expired.length,
      entryTriggered: results.entryTriggered.length,
      stillPending: results.stillPending.length
    };
  } catch (e) {
    console.error('Error evaluating pending signals:', e.message);
    return { wins: 0, losses: 0, expired: 0, error: e.message };
  }
}

// Store new consensus signal as pending for each AI source
async function storePendingSignals(consensusSignal) {
  const results = [];

  // Create a pending signal entry for each AI that contributed to this consensus
  for (const aiSource of consensusSignal.aiSources) {
    const pendingSignal = {
      symbol: consensusSignal.symbol,
      direction: consensusSignal.direction,
      entry: consensusSignal.entry,
      stopLoss: consensusSignal.stopLoss,
      takeProfit: consensusSignal.takeProfit,
      aiSource: aiSource,
      confidence: consensusSignal.confidence,
      isGoldConsensus: consensusSignal.isGoldConsensus,
      isSilverConsensus: consensusSignal.isSilverConsensus
    };

    const result = await addPendingSignal(pendingSignal);
    results.push({ aiSource, ...result });
  }

  return results;
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
// Uses Wilder smoothing for accurate ADX calculation
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

  // Use Wilder smoothing (exponential moving average with alpha = 1/period)
  let smoothedTR = trs.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothedPlusDM = plusDMs.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothedMinusDM = minusDMs.slice(0, period).reduce((a, b) => a + b, 0);

  const dxValues = [];

  for (let i = period; i < trs.length; i++) {
    // Wilder smoothing: smoothed = prev - (prev/period) + current
    smoothedTR = smoothedTR - (smoothedTR / period) + trs[i];
    smoothedPlusDM = smoothedPlusDM - (smoothedPlusDM / period) + plusDMs[i];
    smoothedMinusDM = smoothedMinusDM - (smoothedMinusDM / period) + minusDMs[i];

    const plusDI = smoothedTR > 0 ? (smoothedPlusDM / smoothedTR) * 100 : 0;
    const minusDI = smoothedTR > 0 ? (smoothedMinusDM / smoothedTR) * 100 : 0;

    const diDiff = Math.abs(plusDI - minusDI);
    const diSum = plusDI + minusDI;
    const dx = diSum > 0 ? (diDiff / diSum) * 100 : 0;
    dxValues.push({ dx, plusDI, minusDI });
  }

  if (dxValues.length < period) {
    const last = dxValues[dxValues.length - 1] || { dx: 0, plusDI: 0, minusDI: 0 };
    return { adx: Math.round(last.dx * 10) / 10, plusDI: Math.round(last.plusDI * 10) / 10, minusDI: Math.round(last.minusDI * 10) / 10, trend: 'WEAK' };
  }

  // Calculate ADX as smoothed average of DX values
  let adx = dxValues.slice(0, period).reduce((a, b) => a + b.dx, 0) / period;
  for (let i = period; i < dxValues.length; i++) {
    adx = ((adx * (period - 1)) + dxValues[i].dx) / period;
  }

  const lastDI = dxValues[dxValues.length - 1];
  const plusDI = lastDI.plusDI;
  const minusDI = lastDI.minusDI;

  let trend = 'WEAK';
  if (adx >= 50) trend = 'VERY_STRONG';
  else if (adx >= 25) trend = 'STRONG';
  else if (adx >= 20) trend = 'MODERATE';

  return { adx: Math.round(adx * 10) / 10, plusDI: Math.round(plusDI * 10) / 10, minusDI: Math.round(minusDI * 10) / 10, trend };
}

// Stochastic RSI - Better overbought/oversold than regular RSI
// %K is the raw stochastic RSI, %D is a 3-period SMA of %K for signal smoothing
function calculateStochRSI(closes, rsiPeriod = 14, stochPeriod = 14, kSmooth = 3, dSmooth = 3) {
  if (closes.length < rsiPeriod + stochPeriod + kSmooth) return { k: 50, d: 50, signal: 'NEUTRAL' };

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

  if (rsiValues.length < stochPeriod + kSmooth) return { k: 50, d: 50, signal: 'NEUTRAL' };

  // Calculate raw stochastic RSI values
  const stochRSIValues = [];
  for (let i = stochPeriod; i <= rsiValues.length; i++) {
    const recentRSI = rsiValues.slice(i - stochPeriod, i);
    const minRSI = Math.min(...recentRSI);
    const maxRSI = Math.max(...recentRSI);
    const currentRSI = recentRSI[recentRSI.length - 1];
    const stochRSI = maxRSI - minRSI > 0 ? ((currentRSI - minRSI) / (maxRSI - minRSI)) * 100 : 50;
    stochRSIValues.push(stochRSI);
  }

  if (stochRSIValues.length < kSmooth) return { k: 50, d: 50, signal: 'NEUTRAL' };

  // Calculate %K as SMA of raw stochastic RSI (smoothed K)
  const kValues = [];
  for (let i = kSmooth; i <= stochRSIValues.length; i++) {
    const kSlice = stochRSIValues.slice(i - kSmooth, i);
    const kVal = kSlice.reduce((a, b) => a + b, 0) / kSmooth;
    kValues.push(kVal);
  }

  if (kValues.length < dSmooth) return { k: 50, d: 50, signal: 'NEUTRAL' };

  // Calculate %D as SMA of %K values
  const recentK = kValues.slice(-dSmooth);
  const d = recentK.reduce((a, b) => a + b, 0) / dSmooth;
  const k = kValues[kValues.length - 1];

  const kRounded = Math.round(k * 10) / 10;
  const dRounded = Math.round(d * 10) / 10;

  let signal = 'NEUTRAL';
  if (kRounded <= 20) signal = 'OVERSOLD';
  else if (kRounded >= 80) signal = 'OVERBOUGHT';
  else if (kRounded > 50 && kRounded > dRounded) signal = 'BULLISH';
  else if (kRounded < 50 && kRounded < dRounded) signal = 'BEARISH';

  return { k: kRounded, d: dRounded, signal };
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
  // Try Binance Futures first, fall back to Bybit if blocked
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
    console.log(`Binance candles failed for ${symbol} ${interval}: ${e.message}, trying Bybit...`);
  }

  // Bybit fallback
  try {
    const intervalMap = { '1h': '60', '4h': '240', '1d': 'D', '15m': '15', '5m': '5' };
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
    console.log(`Bybit candles also failed for ${symbol} ${interval}: ${e.message}`);
  }

  return [];
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
  // Fetch all timeframes in parallel to avoid sequential timeout
  const [candles, candles4hRaw, candlesDRaw] = await Promise.all([
    fetchCandlesticks(symbol, '1h', 200),
    fetchCandlesticks(symbol, '4h', 100),
    fetchCandlesticks(symbol, '1d', 100)
  ]);
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

  // Higher Timeframe: 4H indicators (already fetched in parallel above)
  let htf4h = null;
  try {
    const candles4h = candles4hRaw;
    if (candles4h.length >= 50) {
      const closes4h = candles4h.map(c => c.close);
      const ema20_4h = calculateEMA(closes4h, 20);
      const ema50_4h = calculateEMA(closes4h, 50);
      const adx4h = calculateADX(candles4h);
      const supertrend4h = calculateSupertrend(candles4h);
      const rsi4h = calculateRSI(closes4h);
      htf4h = {
        trend: ema20_4h > ema50_4h ? 'BULLISH' : 'BEARISH',
        adx: adx4h?.adx?.toFixed(1),
        supertrend: supertrend4h?.direction,
        rsi: Math.round(rsi4h * 10) / 10
      };
    }
  } catch (e) { console.log(`4H fetch failed for ${symbol}`); }

  // Higher Timeframe: 1D indicators (already fetched in parallel above)
  let htfDaily = null;
  try {
    const candlesD = candlesDRaw;
    if (candlesD.length >= 50) {
      const closesD = candlesD.map(c => c.close);
      const ema20D = calculateEMA(closesD, 20);
      const ema50D = calculateEMA(closesD, 50);
      const ema200D = calculateEMA(closesD, 200);
      const adxD = calculateADX(candlesD);
      const supertrendD = calculateSupertrend(candlesD);
      const rsiD = calculateRSI(closesD);
      const priceD = closesD[closesD.length - 1];
      htfDaily = {
        trend: ema20D > ema50D && ema50D > ema200D ? 'STRONG UPTREND' :
               ema20D < ema50D && ema50D < ema200D ? 'STRONG DOWNTREND' :
               ema20D > ema50D ? 'WEAK UPTREND' : 'WEAK DOWNTREND',
        adx: adxD?.adx?.toFixed(1),
        supertrend: supertrendD?.direction,
        rsi: Math.round(rsiD * 10) / 10,
        priceVsEma200: ((priceD - ema200D) / ema200D * 100).toFixed(1)
      };
    }
  } catch (e) { console.log(`Daily fetch failed for ${symbol}`); }

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
    marketRegime: classifyMarketRegime({ trend, adx, atrPercent }),
    htf4h,
    htfDaily
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

// BTC Dominance macro filter
async function fetchBtcDominance() {
  try {
    const response = await fetchWithTimeout('https://api.coingecko.com/api/v3/global', {}, 6000);
    const data = await response.json();
    if (data?.data?.market_cap_percentage?.btc) {
      return {
        current: data.data.market_cap_percentage.btc,
        timestamp: Date.now()
      };
    }
  } catch (e) {
    console.log('BTC dominance fetch failed:', e.message);
  }
  return null;
}

async function fetchMarketData() {
  const data = {
    prices: {},
    fundingRates: {},
    openInterest: {},
    liquidations: {},
    longShortRatio: {},
    btcDominance: null
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

  // Source 3: Try Bybit
  if (!pricesLoaded) {
    try {
      console.log('Trying Bybit API...');
      const bybitRes = await fetchWithTimeout('https://api.bybit.com/v5/market/tickers?category=linear', {}, 6000);
      const bybitData = await bybitRes.json();
      if (bybitData?.result?.list) {
        for (const coin of CONFIG.TOP_COINS) {
          const ticker = bybitData.result.list.find(t => t.symbol === coin);
          if (ticker) {
            data.prices[coin] = {
              price: parseFloat(ticker.lastPrice),
              change24h: parseFloat(ticker.price24hPcnt) * 100,
              high24h: parseFloat(ticker.highPrice24h),
              low24h: parseFloat(ticker.lowPrice24h),
              volume: parseFloat(ticker.turnover24h)
            };
          }
        }
        pricesLoaded = Object.keys(data.prices).length > 0;
        console.log(`Bybit: loaded ${Object.keys(data.prices).length} prices`);
      }
    } catch (e) {
      console.log('Bybit failed:', e.message);
    }
  }

  // Source 4: Try CoinGecko as fallback (no API key needed)
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

  // Fetch BTC dominance for macro filter
  data.btcDominance = await fetchBtcDominance();
  _btcDominance = data.btcDominance;
  _btcPrice24hChange = data.prices?.BTCUSDT?.change24h || 0;

  return data;
}

// ============================================
// AI ANALYSIS
// ============================================

async function buildAnalysisPrompt(marketData, indicatorData) {
  // Build per-AI outcome feedback from Redis signal log
  let outcomeContext = '';
  try {
    const r = getRedis();
    const signalLog = r ? await r.get('ai_signal_log') : null;
    if (signalLog) {
      const sources = ['claude', 'openai', 'grok'];
      for (const src of sources) {
        const signals = signalLog[src] || [];
        const resolved = signals.filter(s => s.shadowStatus === 'win' || s.shadowStatus === 'loss');
        if (resolved.length > 0) {
          const bySymbol = {};
          for (const s of resolved) {
            if (!bySymbol[s.symbol]) bySymbol[s.symbol] = { wins: 0, losses: 0 };
            if (s.shadowStatus === 'win') bySymbol[s.symbol].wins++;
            else bySymbol[s.symbol].losses++;
          }
          const records = Object.entries(bySymbol).slice(0, 6).map(([sym, r]) => `${sym}:${r.wins}W/${r.losses}L`).join(', ');
          const wr = Math.round(resolved.filter(s => s.shadowStatus === 'win').length / resolved.length * 100);
          outcomeContext += `${src.toUpperCase()} track record: ${wr}% WR (${resolved.length} trades) — ${records}\n`;
        }
      }
    }
  } catch (e) { console.log('Could not load signal log for prompt:', e.message); }

  // Load trade lessons from Redis
  let lessonsContext = '';
  try {
    const r = getRedis();
    if (r) {
      let lessons = await r.get('trade_lessons');
      if (lessons) {
        if (typeof lessons === 'string') lessons = JSON.parse(lessons);
        const recent = lessons.slice(-10);
        if (recent.length > 0) {
          lessonsContext = '=== LESSONS FROM RECENT TRADES ===\n' +
            recent.map(l => `- ${l.symbol} ${l.direction} (${l.outcome}): "${l.lesson}"`).join('\n') +
            '\nAPPLY these lessons to avoid repeating mistakes.\n';
        }
      }
    }
  } catch (e) { console.log('Could not load trade lessons:', e.message); }

  let prompt = `You are an expert crypto perpetual futures trader. Analyze the following market data with MULTI-TIMEFRAME TECHNICAL INDICATORS and DERIVATIVES DATA to identify the BEST trading opportunities.

${outcomeContext ? `=== AI TRACK RECORD (learn from past mistakes) ===\n${outcomeContext}If you keep losing on a symbol, skip it or reverse your bias. Double down on symbols where you've been accurate.\n` : ''}
${lessonsContext}
MULTI-TIMEFRAME RULES (CRITICAL):
- **DAILY TREND is the #1 filter** — ONLY trade in the direction of the Daily trend
- If Daily = STRONG UPTREND + 4H = BULLISH → HIGH conviction LONG
- If Daily = STRONG DOWNTREND + 4H = BEARISH → HIGH conviction SHORT
- If 1H + 4H + Daily all agree → MAXIMUM conviction (add 10 to confidence)
- NEVER signal against the Daily trend unless extreme reversal conditions (Daily RSI <25 or >75)
- Daily Supertrend direction overrides 1H signals

DERIVATIVES INTELLIGENCE:
- **Funding Rate >+0.03%**: Crowded longs, favor shorts or avoid new longs
- **Funding Rate <-0.03%**: Crowded shorts, favor longs
- **OI Rising + Price Rising**: New money entering, trend continues. OI Rising + Price Falling: Shorts being added, more downside.
- **OI Falling + Price Rising**: Short covering (weak rally). OI Falling + Price Falling: Longs capitulating (near bottom).
- **L/S Ratio > 1.3**: Crowd long-biased, contrarian short at resistance. L/S < 0.7: Crowd short-biased, contrarian long at support.
- **Heavy liquidations on one side**: Potential exhaustion/reversal zone.

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
      prompt += `\n  ADX: ${indicators.adx?.adx} (${indicators.adx?.trend}) ${indicators.adx?.adx >= 20 ? '✅ STRONG TREND' : indicators.adx?.adx >= 15 ? '⚡ MODERATE TREND' : '⚠️ WEAK TREND'}`;
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
      // Higher Timeframe context
      if (indicators.htf4h) {
        prompt += `\n  --- 4H TIMEFRAME ---`;
        prompt += `\n  4H Trend: ${indicators.htf4h.trend} | 4H ADX: ${indicators.htf4h.adx} | 4H Supertrend: ${indicators.htf4h.supertrend} | 4H RSI: ${indicators.htf4h.rsi}`;
      }
      if (indicators.htfDaily) {
        prompt += `\n  --- DAILY TIMEFRAME ---`;
        prompt += `\n  Daily Trend: ${indicators.htfDaily.trend} | Daily ADX: ${indicators.htfDaily.adx} | Daily Supertrend: ${indicators.htfDaily.supertrend} | Daily RSI: ${indicators.htfDaily.rsi}`;
        prompt += `\n  Price vs Daily 200 EMA: ${indicators.htfDaily.priceVsEma200}%`;
      }
    }
  }

  prompt += `

ANALYSIS RULES (ranked by importance):
1. **DAILY TREND ALIGNMENT is #1** — Only signal in the direction of the Daily trend. If Daily = UPTREND, only LONG. If Daily = DOWNTREND, only SHORT.
2. **ADX >= 15 required** - Higher ADX = stronger trend. Prefer >= 20, but 15+ is acceptable
3. **SUPERTREND on both 4H and Daily should confirm** — Both agreeing = high conviction
4. **MULTI-TIMEFRAME CONFLUENCE** - 1H + 4H + Daily all agreeing = maximum confidence (+10 points)
5. **DERIVATIVES CONFIRMATION** - Funding rate, OI direction, and L/S ratio should support the trade direction
6. **ENTRY TIMING** - Use 1H StochRSI for entry timing. OVERSOLD for long entries, OVERBOUGHT for short entries
7. **TREND ALIGNMENT** - EMAs confirming direction across timeframes adds confidence
8. **REGIME & VOLUME** - TRENDING regime and INCREASING volume add confidence
9. **RISK/REWARD** - Must be >= 2.0 based on Entry/Stop/Target

IMPORTANT: You MUST return at least 1 signal if any coin has ADX >= 15 AND Daily trend alignment. Use lower confidence (60-70) for weaker setups rather than returning empty signals.

TASK: Identify 1-3 highest conviction trade setups. For each, provide:
1. Symbol, Direction (LONG/SHORT), Confidence (0-100%)
2. Entry price, Stop Loss (use ATR for sizing), Take Profit
3. Key indicator reasons — MUST cite the Daily trend, 4H confirmation, and any derivatives data used

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
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 2048,
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

async function analyzeWithGemini(prompt) {
  if (!process.env.GEMINI_API_KEY) return null;

  console.log('💎 [GEMINI] Starting API call...');

  try {
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GEMINI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gemini-2.0-flash',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 4096
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`💎 [GEMINI] HTTP ${response.status}: ${errorText.slice(0, 300)}`);
      return null;
    }

    const data = await response.json();
    if (data.error) {
      console.error('💎 [GEMINI] API error:', data.error.message || JSON.stringify(data.error));
      return null;
    }

    if (data.choices && data.choices[0]?.message?.content) {
      const text = data.choices[0].message.content;
      console.log(`💎 [GEMINI] Response: ${text.length} chars`);
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return { source: 'openai', ...JSON.parse(jsonMatch[0]) };
      } else {
        console.error('💎 [GEMINI] No JSON found in response:', text.slice(0, 300));
      }
    } else {
      console.error('💎 [GEMINI] Unexpected response format:', JSON.stringify(data).slice(0, 300));
    }
  } catch (error) {
    console.error('Gemini analysis error:', error);
  }
  return null;
}

async function analyzeWithGrok(prompt) {
  if (!process.env.GROK_API_KEY) {
    console.warn('⚠️ GROK_API_KEY not configured - Grok analysis skipped (Gold consensus requires all 3 AIs!)');
    return null;
  }

  console.log('⚡ [GROK] Starting API call...');

  try {
    const response = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROK_API_KEY}`
      },
      body: JSON.stringify({
        model: 'grok-4-1-fast-reasoning',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 2048
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`⚡ [GROK] API error ${response.status}: ${errorText}`);
      return null;
    }

    const data = await response.json();
    console.log('⚡ [GROK] Response received, parsing...');

    if (data.choices && data.choices[0]) {
      const text = data.choices[0].message.content;
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        console.log(`⚡ [GROK] Success - found ${parsed.signals?.length || 0} picks`);
        return { source: 'grok', ...parsed };
      } else {
        console.warn('⚡ [GROK] No JSON found in response');
      }
    } else {
      console.warn('⚡ [GROK] Unexpected response structure:', JSON.stringify(data).slice(0, 200));
    }
  } catch (error) {
    console.error('⚡ [GROK] Analysis error:', error.message || error);
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
          isWithinPercent(s.entry, signal.entry, CONFIG.MAX_ENTRY_WIGGLE_PERCENT)
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
        // Weighted confidence — use optimizer AI weights if available
        const getWeight = (src) => optConfig?.aiWeights?.[src] || 1.0;
        let totalWeight = 0;
        let weightedConf = 0;
        for (const s of matchingSignals) {
          const w = getWeight(s.aiSource);
          weightedConf += s.confidence * w;
          totalWeight += w;
        }
        const avgConfidence = totalWeight > 0 ? weightedConf / totalWeight
          : matchingSignals.reduce((sum, s) => sum + s.confidence, 0) / matchingSignals.length;

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
          entryCondition: entryConditions[0] || null,
          marketRegime: indicators?.marketRegime || null
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
    if (s === 'openai') return '💎 Gemini';
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
// AUTO TRADE OPENING — Opens trades in Redis portfolio
// ============================================
// Same logic as client-side openDualPortfolioTrade() but server-side
// Portfolio data is shared via Redis key 'dual_portfolio_data'

const PORTFOLIO_KEY = 'dual_portfolio_data';

// Module-level cache for BTC dominance (set during fetchMarketData, read in openTradeForSignal)
let _btcDominance = null;
let _btcPrice24hChange = null;

const TRADE_CONFIG = {
  silver: { leverage: 10, riskPercent: 5, maxOpenTrades: 8 },
  gold: { leverage: 15, riskPercent: 8, maxOpenTrades: 5 }
};

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

function getDefaultPortfolioData() {
  return {
    silver: getDefaultPortfolio('silver'),
    gold: getDefaultPortfolio('gold'),
    config: {
      silverConfig: TRADE_CONFIG.silver,
      goldConfig: TRADE_CONFIG.gold
    },
    lastUpdated: Date.now()
  };
}

async function openTradeForSignal(signal) {
  const r = getRedis();
  if (!r) {
    console.log('📦 Redis not configured - cannot open trade');
    return { opened: false, reason: 'no_redis' };
  }

  try {
    // Load current portfolio from Redis
    let portfolioData;
    try {
      const data = await r.get(PORTFOLIO_KEY);
      if (data) {
        portfolioData = typeof data === 'string' ? JSON.parse(data) : data;
        const defaults = getDefaultPortfolioData();
        portfolioData = {
          silver: { ...defaults.silver, ...portfolioData.silver },
          gold: { ...defaults.gold, ...portfolioData.gold },
          config: portfolioData.config || defaults.config,
          lastUpdated: portfolioData.lastUpdated || Date.now()
        };
      } else {
        portfolioData = getDefaultPortfolioData();
      }
    } catch (e) {
      console.error('Redis portfolio read error:', e.message);
      portfolioData = getDefaultPortfolioData();
    }

    const portfolioType = signal.isGoldConsensus ? 'gold' : 'silver';
    const portfolio = portfolioData[portfolioType];
    const config = TRADE_CONFIG[portfolioType];

    // Use config from Redis if available (client may have customized it)
    const redisConfig = portfolioData.config?.[portfolioType] ||
                        portfolioData.config?.[`${portfolioType}Config`];
    const leverage = redisConfig?.leverage || config.leverage;
    const riskPercent = redisConfig?.riskPercent || config.riskPercent;
    const maxOpenTrades = redisConfig?.maxOpenTrades || config.maxOpenTrades;

    // Ensure trades array exists
    if (!portfolio.trades) portfolio.trades = [];

    // Check max open trades
    const openTrades = portfolio.trades.filter(t => t.status === 'open');
    if (openTrades.length >= maxOpenTrades) {
      console.log(`📦 ${portfolioType.toUpperCase()}: Max ${maxOpenTrades} trades reached, skipping ${signal.symbol}`);
      return { opened: false, reason: 'max_trades' };
    }

    // Check if already in this symbol
    if (openTrades.some(t => t.symbol === signal.symbol)) {
      console.log(`📦 ${portfolioType.toUpperCase()}: Already in ${signal.symbol}, skipping`);
      return { opened: false, reason: 'duplicate' };
    }

    // Correlation protection — max 1 trade per correlation group
    const tradeGroup = getCorrelationGroup(signal.symbol);
    const groupConflict = openTrades.find(t => getCorrelationGroup(t.symbol) === tradeGroup);
    if (groupConflict) {
      console.log(`🔗 ${portfolioType.toUpperCase()}: Already in ${groupConflict.symbol} (same ${tradeGroup} group), skipping ${signal.symbol}`);
      return { opened: false, reason: 'correlation' };
    }

    // Max exposure limit — total open position value capped at 60% of balance
    const totalExposure = openTrades.reduce((sum, t) => sum + (t.remainingSize || t.size), 0);
    const maxExposure = portfolio.balance * 0.60;
    if (totalExposure >= maxExposure) {
      console.log(`🛡️ ${portfolioType.toUpperCase()}: Exposure $${totalExposure.toFixed(0)} >= 60% of balance ($${maxExposure.toFixed(0)}), skipping`);
      return { opened: false, reason: 'max_exposure' };
    }

    // === CIRCUIT BREAKER: Daily & Weekly Loss Limits ===
    const DAILY_LOSS_LIMIT = 0.05;  // 5% of balance
    const WEEKLY_LOSS_LIMIT = 0.15; // 15% of balance
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;

    const closedTrades = (portfolio.trades || []).filter(t => t.status === 'closed');
    const dailyLosses = closedTrades
      .filter(t => t.closeTimestamp && t.closeTimestamp > oneDayAgo && t.pnl < 0)
      .reduce((sum, t) => sum + Math.abs(t.pnl), 0);
    const weeklyLosses = closedTrades
      .filter(t => t.closeTimestamp && t.closeTimestamp > oneWeekAgo && t.pnl < 0)
      .reduce((sum, t) => sum + Math.abs(t.pnl), 0);

    const dailyLimit = portfolio.balance * DAILY_LOSS_LIMIT;
    const weeklyLimit = portfolio.balance * WEEKLY_LOSS_LIMIT;

    if (dailyLosses >= dailyLimit) {
      console.log(`🚨 CIRCUIT BREAKER: ${portfolioType.toUpperCase()} daily losses $${dailyLosses.toFixed(0)} >= 5% limit $${dailyLimit.toFixed(0)}`);
      // Send Telegram alert (once per trigger)
      if (!portfolio._dailyBreaker || portfolio._dailyBreaker < oneDayAgo) {
        portfolio._dailyBreaker = now;
        await sendTelegramMessage(`🚨 <b>CIRCUIT BREAKER TRIGGERED</b>\n\n${portfolioType.toUpperCase()} portfolio daily losses: $${dailyLosses.toFixed(2)}\nLimit: $${dailyLimit.toFixed(2)} (5% of balance)\n\n⛔ No new trades until losses reset.`);
      }
      return { opened: false, reason: 'daily_loss_limit' };
    }

    if (weeklyLosses >= weeklyLimit) {
      console.log(`🚨 CIRCUIT BREAKER: ${portfolioType.toUpperCase()} weekly losses $${weeklyLosses.toFixed(0)} >= 15% limit $${weeklyLimit.toFixed(0)}`);
      if (!portfolio._weeklyBreaker || portfolio._weeklyBreaker < oneWeekAgo) {
        portfolio._weeklyBreaker = now;
        await sendTelegramMessage(`🚨 <b>WEEKLY CIRCUIT BREAKER</b>\n\n${portfolioType.toUpperCase()} portfolio weekly losses: $${weeklyLosses.toFixed(2)}\nLimit: $${weeklyLimit.toFixed(2)} (15% of balance)\n\n⛔ No new trades until weekly losses reset.`);
      }
      return { opened: false, reason: 'weekly_loss_limit' };
    }

    // === BTC DOMINANCE MACRO FILTER ===
    // If BTC dominance rising + BTC price rising → alts get drained, block alt LONGs
    // If BTC dominance falling + BTC stable → alt season, allow alt trades
    const isAlt = signal.symbol !== 'BTCUSDT' && signal.symbol !== 'ETHUSDT';
    if (isAlt && _btcDominance && _btcPrice24hChange !== null) {
      const btcDom = _btcDominance.current;
      const btcUp = _btcPrice24hChange > 1; // BTC rose >1% today
      const highDominance = btcDom > 55; // BTC dominance above 55%

      if (highDominance && btcUp && signal.direction === 'LONG') {
        console.log(`📊 BTC DOM FILTER: BTC.D=${btcDom.toFixed(1)}% + BTC +${_btcPrice24hChange.toFixed(1)}% → blocking alt LONG on ${signal.symbol}`);
        return { opened: false, reason: 'btc_dominance_filter' };
      }
    }

    // Session-aware filter — prefer US/EU overlap (13:00-21:00 UTC) for higher quality
    const utcHour = new Date().getUTCHours();
    const isHighVolSession = utcHour >= 13 && utcHour <= 21;
    if (!isHighVolSession && !signal.isGoldConsensus) {
      // Only allow Gold consensus trades during low-volume hours (Asian session)
      console.log(`🕐 ${portfolioType.toUpperCase()}: Low-volume session (${utcHour}:00 UTC) — Silver signals blocked, only Gold allowed`);
      return { opened: false, reason: 'session_filter' };
    }

    // Calculate position size
    const riskAmount = portfolio.balance * (riskPercent / 100);
    const positionSize = riskAmount * leverage;

    // Volatility-adjusted targets — widen TP/SL in high ATR, tighten in low
    let adjustedTP = signal.takeProfit;
    let adjustedSL = signal.stopLoss;
    if (signal.atrPercent) {
      const atr = signal.atrPercent;
      // Normal ATR ~1.5-3%. Scale TP/SL if outside that range
      if (atr > 3) {
        // High volatility: widen targets by 20%
        const tpDist = Math.abs(signal.takeProfit - signal.entry) * 1.2;
        const slDist = Math.abs(signal.stopLoss - signal.entry) * 1.2;
        adjustedTP = signal.direction === 'LONG' ? signal.entry + tpDist : signal.entry - tpDist;
        adjustedSL = signal.direction === 'LONG' ? signal.entry - slDist : signal.entry + slDist;
        console.log(`📐 ${signal.symbol}: High ATR ${atr.toFixed(1)}% — widened TP/SL by 20%`);
      } else if (atr < 1) {
        // Low volatility: tighten targets by 15%
        const tpDist = Math.abs(signal.takeProfit - signal.entry) * 0.85;
        const slDist = Math.abs(signal.stopLoss - signal.entry) * 0.85;
        adjustedTP = signal.direction === 'LONG' ? signal.entry + tpDist : signal.entry - tpDist;
        adjustedSL = signal.direction === 'LONG' ? signal.entry - slDist : signal.entry + slDist;
        console.log(`📐 ${signal.symbol}: Low ATR ${atr.toFixed(1)}% — tightened TP/SL by 15%`);
      }
    }

    const trade = {
      id: Date.now(),
      symbol: signal.symbol,
      direction: signal.direction,
      entry: signal.entry,
      tp: adjustedTP,
      sl: adjustedSL,
      originalTp: signal.takeProfit,
      originalSl: signal.stopLoss,
      size: positionSize,
      leverage: leverage,
      timestamp: Date.now(),
      status: 'open',
      pnl: 0,
      aiSources: signal.aiSources || [],
      isGoldConsensus: signal.isGoldConsensus || false,
      isSilverConsensus: signal.isSilverConsensus || false,
      confidence: signal.confidence,
      marketRegime: signal.marketRegime || null,
      atrPercent: signal.atrPercent || null,
      openedBy: 'backend-scan'
    };

    portfolio.trades.push(trade);
    portfolio.lastUpdated = Date.now();
    portfolioData.lastUpdated = Date.now();

    // Save back to Redis
    await r.set(PORTFOLIO_KEY, JSON.stringify(portfolioData));

    const emoji = signal.isGoldConsensus ? '🥇' : '🥈';
    console.log(`${emoji} ${portfolioType.toUpperCase()} TRADE OPENED: ${signal.direction} ${signal.symbol} @ $${signal.entry} | Size: $${positionSize.toFixed(2)} | Leverage: ${leverage}x`);

    return {
      opened: true,
      portfolioType,
      trade: {
        symbol: trade.symbol,
        direction: trade.direction,
        entry: trade.entry,
        size: trade.size,
        leverage: trade.leverage
      }
    };
  } catch (e) {
    console.error('Error opening trade:', e.message);
    return { opened: false, reason: 'error', error: e.message };
  }
}

function formatTradeOpenMessage(signal, tradeResult) {
  const emoji = signal.isGoldConsensus ? '🥇' : '🥈';
  const portfolioType = tradeResult.portfolioType.toUpperCase();
  const trade = tradeResult.trade;

  const riskPercent = Math.abs((signal.stopLoss - signal.entry) / signal.entry * 100);
  const rewardPercent = Math.abs((signal.takeProfit - signal.entry) / signal.entry * 100);

  // Calculate partial TP levels
  const tpDist = Math.abs(signal.takeProfit - signal.entry);
  const tp1Price = signal.direction === 'LONG' ? signal.entry + tpDist * 0.5 : signal.entry - tpDist * 0.5;
  const tp2Price = signal.direction === 'LONG' ? signal.entry + tpDist * 0.75 : signal.entry - tpDist * 0.75;

  return `${emoji} <b>${portfolioType} PORTFOLIO — TRADE OPENED</b>

📊 <b>${signal.direction} ${signal.symbol}</b>

💰 Entry: $${signal.entry.toLocaleString()}
🎯 TP1 (40%): $${tp1Price.toLocaleString()} → SL moves to breakeven
🎯 TP2 (30%): $${tp2Price.toLocaleString()}
🎯 TP3 (30%): $${signal.takeProfit.toLocaleString()} (+${rewardPercent.toFixed(1)}%)
🛑 Stop Loss: $${signal.stopLoss.toLocaleString()} (-${riskPercent.toFixed(1)}%)

📈 Position: $${trade.size.toFixed(2)} @ ${trade.leverage}x leverage

🤖 Auto-opened by Backend Scanner
⏰ ${new Date().toUTCString()}`;
}

// ============================================
// MAIN HANDLER
// ============================================

export default async function handler(request, response) {
  console.log('🔄 Starting AI scan...');

  try {
    // ======= LOAD OPTIMIZED CONFIG =======
    // Self-learning optimizer saves tuned parameters to Redis every 6 hours
    let optConfig = null;
    try {
      const r = getRedis();
      if (r) {
        const saved = await r.get('optimization_config');
        if (saved) {
          optConfig = typeof saved === 'string' ? JSON.parse(saved) : saved;
          console.log(`🧠 Loaded optimized config (cycle #${optConfig.cycleCount || 0}, ${optConfig.totalTradesAnalyzed || 0} trades analyzed)`);

          // Check if trading is paused due to loss streak
          if (optConfig.pauseUntil && Date.now() < optConfig.pauseUntil) {
            const resumeIn = Math.round((optConfig.pauseUntil - Date.now()) / 60000);
            console.log(`⏸️ Trading PAUSED (${optConfig.consecutiveLosses} consecutive losses). Resuming in ${resumeIn} minutes.`);
            return response.status(200).json({
              success: true,
              paused: true,
              reason: `${optConfig.consecutiveLosses} consecutive losses`,
              resumesIn: resumeIn + ' minutes',
              alertsSent: 0,
              tradesOpened: 0
            });
          }
        }
      }
    } catch (e) {
      console.log('⚠️ Could not load optimization config, using defaults:', e.message);
    }

    // Helper: get optimized value or fall back to CONFIG default
    const opt = (key, fallback) => {
      if (optConfig && optConfig[key] !== undefined && optConfig[key] !== null) return optConfig[key];
      return fallback;
    };

    // Check for major economic events
    const majorEvent = isMajorEventDay();
    if (majorEvent) {
      console.log(`⚠️ Major event day: ${majorEvent.name} - Signals will include warning`);
    }

    // Check if we have at least 2 AI APIs configured
    const hasClaudeKey = !!process.env.CLAUDE_API_KEY;
    const hasOpenAIKey = !!process.env.GEMINI_API_KEY;
    const hasGrokKey = !!process.env.GROK_API_KEY;
    const aiCount = [hasClaudeKey, hasOpenAIKey, hasGrokKey].filter(Boolean).length;

    console.log('🔑 API Keys configured:');
    console.log(`   Claude: ${hasClaudeKey ? '✅' : '❌'}`);
    console.log(`   Gemini: ${hasOpenAIKey ? '✅' : '❌'}`);
    console.log(`   Grok: ${hasGrokKey ? '✅' : '❌'} ${hasGrokKey ? `(starts with: ${process.env.GROK_API_KEY.slice(0, 8)}...)` : ''}`);

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

    // FIRST: Evaluate pending signals against current prices
    // This checks if entry was hit, TP/SL was hit, or 48h expired
    console.log('🔍 Evaluating pending signals...');
    const evalResults = await evaluateAndUpdateAIWinLoss(marketData.prices);
    console.log(`   Evaluation: ${evalResults.wins || 0} wins, ${evalResults.losses || 0} losses, ${evalResults.expired || 0} expired`);

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
      analyzeWithGemini(prompt),
      analyzeWithGrok(prompt)
    ]);

    const analyses = [claudeResult, openaiResult, grokResult].filter(Boolean);
    console.log(`✅ Got ${analyses.length} AI responses`);

    // Find consensus signals
    const consensusSignals = findConsensusSignals(analyses, indicatorData);
    console.log(`🎯 Found ${consensusSignals.length} consensus signals`);

    // Update AI signal counts in Redis (persists even when frontend is closed)
    await updateAISignalCounts(analyses, consensusSignals);

    // Save individual AI signal details to Redis (so AI tab works even when browser is closed)
    await saveAiSignalLogToRedis(analyses, consensusSignals);

    // Filter by confidence and TP% (uses optimized threshold if available)
    const minConfidence = opt('alertConfidence', CONFIG.ALERT_CONFIDENCE);
    console.log(`🎯 Using min confidence: ${minConfidence}${optConfig ? ' (optimized)' : ' (default)'}`);
    let alertSignals = consensusSignals.filter(signal => {
      if (signal.confidence < minConfidence) return false;

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

    // Filter by ADX (uses optimized threshold)
    const minADX = opt('minADX', 15);
    alertSignals = alertSignals.filter(signal => {
      const indicators = indicatorData[signal.symbol];
      if (!indicators || !indicators.adx) {
        console.log(`⚠️ ${signal.symbol}: No indicator data - allowing signal`);
        return true;
      }
      if (indicators.adx.adx < minADX) {
        console.log(`⛔ ${signal.symbol}: ADX ${indicators.adx.adx} < ${minADX} - BLOCKED`);
        return false;
      }
      console.log(`✅ ${signal.symbol}: ADX ${indicators.adx.adx} >= ${minADX} (${indicators.adx.trend}) - OK`);
      return true;
    });
    console.log(`📊 After ADX filter: ${alertSignals.length} signals`);

    // Filter by Supertrend direction confirmation (Gold consensus overrides)
    alertSignals = alertSignals.filter(signal => {
      const indicators = indicatorData[signal.symbol];
      if (!indicators || !indicators.supertrend) {
        console.log(`⚠️ ${signal.symbol}: No supertrend data - allowing signal`);
        return true;
      }
      const supertrendDir = indicators.supertrend.direction;
      const mismatch = (signal.direction === 'LONG' && supertrendDir !== 'UP') ||
                        (signal.direction === 'SHORT' && supertrendDir !== 'DOWN');
      if (mismatch) {
        // Gold consensus (3/3 AIs) overrides Supertrend mismatch
        if (signal.isGoldConsensus) {
          console.log(`⚠️ ${signal.symbol}: Supertrend mismatch but GOLD CONSENSUS overrides - ALLOWED`);
          return true;
        }
        console.log(`⛔ ${signal.symbol}: ${signal.direction} signal but Supertrend is ${supertrendDir} - BLOCKED`);
        return false;
      }
      console.log(`✅ ${signal.symbol}: ${signal.direction} confirmed by Supertrend ${supertrendDir} - OK`);
      return true;
    });
    console.log(`🔄 After Supertrend filter: ${alertSignals.length} signals`);

    // Filter by market regime (uses optimized blocked list)
    const blockedRegimes = optConfig?.blockedRegimes || ['CHOPPY'];
    alertSignals = alertSignals.filter(signal => {
      const indicators = indicatorData[signal.symbol];
      if (!indicators) return true;
      if (blockedRegimes.includes(indicators.marketRegime)) {
        console.log(`⛔ ${signal.symbol}: Market regime ${indicators.marketRegime} - BLOCKED`);
        return false;
      }
      // Log soft warnings for volume/ATR but don't block
      if (indicators.atrPercent !== undefined && indicators.atrPercent < CONFIG.MIN_ATR_PERCENT) {
        console.log(`⚠️ ${signal.symbol}: Low ATR ${indicators.atrPercent.toFixed(2)}% (soft warning)`);
      }
      if (indicators.volumeTrend === 'DECREASING') {
        console.log(`⚠️ ${signal.symbol}: Decreasing volume (soft warning)`);
      }
      return true;
    });
    console.log(`📉 After regime filter: ${alertSignals.length} signals`);

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

    // Re-validate risk/reward after volatility adjustment (uses optimized thresholds)
    const optMinRR = opt('minRiskReward', CONFIG.MIN_RISK_REWARD);
    const optMinRRGold = opt('minRiskRewardGold', 1.5);
    alertSignals = alertSignals.filter(signal => {
      const risk = Math.abs(signal.entry - signal.stopLoss);
      const reward = Math.abs(signal.takeProfit - signal.entry);
      const rr = reward / Math.max(risk, 1e-9);
      const minRR = signal.isGoldConsensus ? optMinRRGold : optMinRR;
      if (rr < minRR) {
        console.log(`⛔ ${signal.symbol}: R/R ${rr.toFixed(2)} < ${minRR} after volatility adjust - BLOCKED`);
        return false;
      }
      return true;
    });
    console.log(`✅ After R/R validation: ${alertSignals.length} signals`);

    // Filter by symbol blacklist (optimizer auto-blacklists symbols with <30% win rate)
    const symbolBlacklist = optConfig?.symbolBlacklist || [];
    if (symbolBlacklist.length > 0) {
      alertSignals = alertSignals.filter(signal => {
        if (symbolBlacklist.includes(signal.symbol)) {
          console.log(`⛔ ${signal.symbol}: BLACKLISTED by optimizer (poor historical performance) - BLOCKED`);
          return false;
        }
        return true;
      });
      console.log(`🚫 After blacklist filter: ${alertSignals.length} signals (blacklisted: ${symbolBlacklist.join(', ')})`);
    }

    // Send Telegram alerts, open trades, and track pending signals
    let alertsSent = 0;
    let tradesOpened = 0;
    let pendingSignalsAdded = 0;
    const openedTrades = [];

    for (const signal of alertSignals) {
      const indicators = indicatorData[signal.symbol];
      // Attach ATR for volatility-adjusted targets
      signal.atrPercent = indicators?.atrPercent || null;
      const message = formatSignalForTelegram(signal, majorEvent, indicators);
      const keyboard = createTradeKeyboard(signal);
      const sent = await sendTelegramMessage(message, keyboard);
      if (sent) {
        alertsSent++;
        // Save to Redis for cooldown tracking
        await saveSignal(signal.symbol, signal.direction, signal.entry);

        // Store as pending signal for each AI source (for win ratio calculation)
        const pendingResults = await storePendingSignals(signal);
        const addedCount = pendingResults.filter(r => r.added).length;
        pendingSignalsAdded += addedCount;
        console.log(`✅ Sent alert for ${signal.symbol} ${signal.direction} (${addedCount} pending signals added)`);
      }

      // AUTO TRADE: Open trade in Redis portfolio (works even when browser is closed)
      const tradeResult = await openTradeForSignal(signal);
      if (tradeResult.opened) {
        tradesOpened++;
        openedTrades.push(tradeResult.trade);

        // Send separate Telegram notification for trade opening
        const tradeMsg = formatTradeOpenMessage(signal, tradeResult);
        await sendTelegramMessage(tradeMsg);
      } else {
        console.log(`📦 Trade not opened for ${signal.symbol}: ${tradeResult.reason}`);
      }
    }

    console.log(`📤 Sent ${alertsSent} alerts, opened ${tradesOpened} trades, ${pendingSignalsAdded} pending signals added`);

    // Get pending signals summary for response
    const pendingSummary = await getPendingSignalsSummary();

    return response.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      aiResponses: analyses.length,
      consensusSignals: consensusSignals.length,
      alertsSent: alertsSent,
      tradesOpened: tradesOpened,
      openedTrades: openedTrades,
      pendingSignals: pendingSummary,
      evaluation: evalResults,
      signals: alertSignals.map(s => ({
        symbol: s.symbol,
        direction: s.direction,
        confidence: s.confidence,
        aiSources: s.aiSources
      })),
      optimization: optConfig ? {
        cycle: optConfig.cycleCount,
        aiWeights: optConfig.aiWeights,
        minConfidence: minConfidence,
        minADX: minADX,
        minRR: optMinRR,
        blockedRegimes: blockedRegimes,
        symbolBlacklist: symbolBlacklist,
        paused: !!optConfig.pauseUntil
      } : null
    });

  } catch (error) {
    console.error('Scan error:', error);
    return response.status(500).json({
      success: false,
      error: error.message
    });
  }
}
