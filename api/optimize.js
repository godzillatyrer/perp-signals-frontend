// Self-Learning Optimizer — Analyzes closed trades and adjusts system parameters
// Runs every 6 hours via Vercel cron
// Reads trade history from Redis, computes optimal config, writes it back
// scan.js reads this config and uses it instead of hardcoded defaults

import { Redis } from '@upstash/redis';

const PORTFOLIO_KEY = 'dual_portfolio_data';
const OPTIMIZATION_KEY = 'optimization_config';
const OPTIMIZATION_LOG_KEY = 'optimization_log';

// Minimum trades needed before we start adjusting parameters
const MIN_TRADES_TO_OPTIMIZE = 10;

// How much a parameter can change per optimization cycle (prevents wild swings)
const MAX_ADJUSTMENT_RATE = 0.20; // 20% max change per cycle

// Parameter bounds — hard limits to prevent dangerous values
const BOUNDS = {
  alertConfidence:   { min: 55, max: 90, default: 75 },
  minRiskReward:     { min: 1.2, max: 4.0, default: 2.0 },
  minRiskRewardGold: { min: 1.0, max: 3.0, default: 1.5 },
  minADX:            { min: 10, max: 30, default: 15 },
  aiWeight:          { min: 0.3, max: 2.0, default: 1.0 },
  cooldownHours:     { min: 4, max: 24, default: 12 },
};

function getDefaultOptConfig() {
  return {
    version: 1,
    lastOptimized: null,
    totalTradesAnalyzed: 0,
    cycleCount: 0,

    // Tunable parameters
    alertConfidence: 75,
    minRiskReward: 2.0,
    minRiskRewardGold: 1.5,
    minADX: 15,
    cooldownHours: 12,

    // AI weights (higher = more trusted in consensus scoring)
    aiWeights: { claude: 1.0, openai: 1.0, grok: 1.0 },

    // Symbol performance tracking
    symbolStats: {},    // { BTCUSDT: { wins: 5, losses: 3, blocked: false }, ... }
    symbolBlacklist: [], // Symbols with <30% win rate after 8+ trades

    // Regime performance
    regimeStats: {},    // { TRENDING_UP: { wins: 10, losses: 5 }, CHOPPY: { wins: 1, losses: 8 } }
    blockedRegimes: ['CHOPPY'],

    // Direction bias
    directionStats: { LONG: { wins: 0, losses: 0 }, SHORT: { wins: 0, losses: 0 } },

    // Loss streak protection
    consecutiveLosses: 0,
    pauseUntil: null,  // timestamp — if set, skip trading until this time
    maxConsecutiveLosses: 3, // pause after this many consecutive losses

    // What changed in last optimization
    lastChanges: [],
    lastReport: ''
  };
}

function getRedis() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

// Clamp a value within bounds, with max change rate from current
function adjustParam(current, optimal, bounds, maxRate = MAX_ADJUSTMENT_RATE) {
  // Limit change per cycle
  const maxDelta = current * maxRate;
  let newVal = optimal;
  if (newVal > current + maxDelta) newVal = current + maxDelta;
  if (newVal < current - maxDelta) newVal = current - maxDelta;
  // Clamp to hard bounds
  newVal = Math.max(bounds.min, Math.min(bounds.max, newVal));
  return Math.round(newVal * 100) / 100;
}

// ============================================
// ANALYSIS FUNCTIONS
// ============================================

function analyzeAiWeights(trades) {
  const stats = { claude: { wins: 0, losses: 0 }, openai: { wins: 0, losses: 0 }, grok: { wins: 0, losses: 0 } };

  for (const trade of trades) {
    if (!trade.aiSources || !trade.aiSources.length) continue;
    const isWin = (trade.pnl || 0) > 0;
    for (const source of trade.aiSources) {
      if (stats[source]) {
        if (isWin) stats[source].wins++;
        else stats[source].losses++;
      }
    }
  }

  const weights = {};
  const reasons = [];

  for (const [ai, s] of Object.entries(stats)) {
    const total = s.wins + s.losses;
    if (total < 5) {
      weights[ai] = 1.0; // Not enough data
      reasons.push(`${ai}: ${total} trades (need 5+), keeping weight at 1.0`);
    } else {
      const winRate = s.wins / total;
      // Weight = win rate normalized so 50% = 1.0, 70% = 1.4, 30% = 0.6
      weights[ai] = Math.round(winRate * 2 * 100) / 100;
      reasons.push(`${ai}: ${s.wins}W/${s.losses}L (${Math.round(winRate * 100)}%) → weight ${weights[ai]}`);
    }
  }

  return { weights, reasons, stats };
}

function analyzeConfidence(trades) {
  // Bucket trades by confidence level and find the sweet spot
  const buckets = {};
  for (const trade of trades) {
    const conf = trade.confidence || 75;
    const bucket = Math.floor(conf / 5) * 5; // 70, 75, 80, 85, etc.
    if (!buckets[bucket]) buckets[bucket] = { wins: 0, losses: 0 };
    if ((trade.pnl || 0) > 0) buckets[bucket].wins++;
    else buckets[bucket].losses++;
  }

  // Find the lowest confidence where win rate is still acceptable (>45%)
  let optimalMinConf = BOUNDS.alertConfidence.default;
  let bestWR = 0;

  const sortedBuckets = Object.entries(buckets)
    .map(([conf, stats]) => ({
      conf: parseInt(conf),
      total: stats.wins + stats.losses,
      winRate: stats.wins / (stats.wins + stats.losses)
    }))
    .sort((a, b) => a.conf - b.conf);

  // Find the confidence threshold that maximizes expected trades while keeping >45% WR
  for (const b of sortedBuckets) {
    if (b.total >= 3 && b.winRate >= 0.45) {
      if (b.conf < optimalMinConf || b.winRate > bestWR) {
        optimalMinConf = b.conf;
        bestWR = b.winRate;
      }
    }
  }

  return { optimalMinConf, buckets: sortedBuckets };
}

function analyzeRiskReward(trades) {
  const buckets = { low: { wins: 0, losses: 0 }, med: { wins: 0, losses: 0 }, high: { wins: 0, losses: 0 } };

  for (const trade of trades) {
    const rr = trade.tp && trade.sl && trade.entry ?
      Math.abs(trade.tp - trade.entry) / Math.abs(trade.entry - trade.sl) : 2.0;
    const isWin = (trade.pnl || 0) > 0;

    if (rr < 2.0) { if (isWin) buckets.low.wins++; else buckets.low.losses++; }
    else if (rr < 3.0) { if (isWin) buckets.med.wins++; else buckets.med.losses++; }
    else { if (isWin) buckets.high.wins++; else buckets.high.losses++; }
  }

  // Higher R:R means we need lower win rate to be profitable
  // Find the R:R bracket with best expected value (WR * avg_win - (1-WR) * avg_loss)
  let optimalMinRR = BOUNDS.minRiskReward.default;
  const lowTotal = buckets.low.wins + buckets.low.losses;
  const medTotal = buckets.med.wins + buckets.med.losses;
  const highTotal = buckets.high.wins + buckets.high.losses;

  // If low R:R trades have high win rate, we can lower the threshold
  if (lowTotal >= 5 && buckets.low.wins / lowTotal >= 0.55) {
    optimalMinRR = 1.5;
  } else if (medTotal >= 5 && buckets.med.wins / medTotal >= 0.45) {
    optimalMinRR = 2.0;
  } else if (highTotal >= 3) {
    optimalMinRR = 2.5; // Require higher R:R if lower brackets losing
  }

  return { optimalMinRR, buckets };
}

function analyzeSymbols(trades) {
  const stats = {};
  for (const trade of trades) {
    if (!trade.symbol) continue;
    if (!stats[trade.symbol]) stats[trade.symbol] = { wins: 0, losses: 0, totalPnl: 0 };
    if ((trade.pnl || 0) > 0) stats[trade.symbol].wins++;
    else stats[trade.symbol].losses++;
    stats[trade.symbol].totalPnl += (trade.pnl || 0);
  }

  const blacklist = [];
  for (const [symbol, s] of Object.entries(stats)) {
    const total = s.wins + s.losses;
    if (total >= 8 && s.wins / total < 0.30) {
      blacklist.push(symbol);
    }
  }

  return { stats, blacklist };
}

function analyzeRegimes(trades) {
  const stats = {};
  for (const trade of trades) {
    const regime = trade.marketRegime || 'UNKNOWN';
    if (!stats[regime]) stats[regime] = { wins: 0, losses: 0 };
    if ((trade.pnl || 0) > 0) stats[regime].wins++;
    else stats[regime].losses++;
  }

  const blocked = ['CHOPPY']; // Always block CHOPPY
  for (const [regime, s] of Object.entries(stats)) {
    const total = s.wins + s.losses;
    // Block regimes with <35% win rate after 6+ trades
    if (total >= 6 && s.wins / total < 0.35 && regime !== 'CHOPPY') {
      blocked.push(regime);
    }
  }

  return { stats, blocked: [...new Set(blocked)] };
}

function analyzeDirection(trades) {
  const stats = { LONG: { wins: 0, losses: 0 }, SHORT: { wins: 0, losses: 0 } };
  for (const trade of trades) {
    const dir = trade.direction || 'LONG';
    if (!stats[dir]) continue;
    if ((trade.pnl || 0) > 0) stats[dir].wins++;
    else stats[dir].losses++;
  }
  return stats;
}

function analyzeLossStreak(trades) {
  // Sort by close time (most recent first)
  const sorted = [...trades]
    .filter(t => t.closeTimestamp || t.closedAt)
    .sort((a, b) => (b.closeTimestamp || b.closedAt) - (a.closeTimestamp || a.closedAt));

  let streak = 0;
  for (const trade of sorted) {
    if ((trade.pnl || 0) <= 0) streak++;
    else break;
  }
  return streak;
}

// ============================================
// MAIN OPTIMIZER
// ============================================

async function runOptimization(redis) {
  // Load current optimization config
  let config;
  try {
    const saved = await redis.get(OPTIMIZATION_KEY);
    if (saved) {
      config = typeof saved === 'string' ? JSON.parse(saved) : saved;
      // Merge with defaults for any missing fields
      config = { ...getDefaultOptConfig(), ...config };
    } else {
      config = getDefaultOptConfig();
    }
  } catch (e) {
    console.error('Failed to load optimization config:', e.message);
    config = getDefaultOptConfig();
  }

  // Load all trades from both portfolios
  let portfolioData;
  try {
    const data = await redis.get(PORTFOLIO_KEY);
    if (!data) {
      return { config, report: 'No portfolio data found. Waiting for trades.' };
    }
    portfolioData = typeof data === 'string' ? JSON.parse(data) : data;
  } catch (e) {
    return { config, report: 'Failed to load portfolio data: ' + e.message };
  }

  // Collect all closed trades from both portfolios
  const silverTrades = (portfolioData.silver?.trades || []).filter(t => t.status === 'closed');
  const goldTrades = (portfolioData.gold?.trades || []).filter(t => t.status === 'closed');
  const allTrades = [...silverTrades, ...goldTrades];
  const allOpenTrades = [
    ...(portfolioData.silver?.trades || []).filter(t => t.status === 'open'),
    ...(portfolioData.gold?.trades || []).filter(t => t.status === 'open')
  ];

  console.log(`📊 Optimizer: ${allTrades.length} closed trades (${silverTrades.length} silver, ${goldTrades.length} gold), ${allOpenTrades.length} open`);

  if (allTrades.length < MIN_TRADES_TO_OPTIMIZE) {
    const report = `Need ${MIN_TRADES_TO_OPTIMIZE} closed trades to start optimizing. Currently have ${allTrades.length}.`;
    config.lastOptimized = Date.now();
    config.totalTradesAnalyzed = allTrades.length;
    config.lastReport = report;
    await redis.set(OPTIMIZATION_KEY, JSON.stringify(config));
    return { config, report };
  }

  const changes = [];
  const prevConfig = JSON.parse(JSON.stringify(config));

  // --- 1. AI WEIGHTS ---
  const aiAnalysis = analyzeAiWeights(allTrades);
  for (const [ai, newWeight] of Object.entries(aiAnalysis.weights)) {
    const oldWeight = config.aiWeights[ai] || 1.0;
    config.aiWeights[ai] = adjustParam(oldWeight, newWeight, BOUNDS.aiWeight);
    if (Math.abs(config.aiWeights[ai] - oldWeight) > 0.05) {
      changes.push(`AI weight ${ai}: ${oldWeight} → ${config.aiWeights[ai]}`);
    }
  }

  // --- 2. CONFIDENCE THRESHOLD ---
  const confAnalysis = analyzeConfidence(allTrades);
  const oldConf = config.alertConfidence;
  config.alertConfidence = adjustParam(oldConf, confAnalysis.optimalMinConf, BOUNDS.alertConfidence);
  if (Math.abs(config.alertConfidence - oldConf) > 1) {
    changes.push(`Min confidence: ${oldConf} → ${config.alertConfidence}`);
  }

  // --- 3. RISK/REWARD ---
  const rrAnalysis = analyzeRiskReward(allTrades);
  const oldRR = config.minRiskReward;
  config.minRiskReward = adjustParam(oldRR, rrAnalysis.optimalMinRR, BOUNDS.minRiskReward);
  if (Math.abs(config.minRiskReward - oldRR) > 0.1) {
    changes.push(`Min R:R: ${oldRR} → ${config.minRiskReward}`);
  }

  // Gold R:R is always lower
  config.minRiskRewardGold = Math.min(config.minRiskReward, adjustParam(
    config.minRiskRewardGold,
    config.minRiskReward * 0.75,
    BOUNDS.minRiskRewardGold
  ));

  // --- 4. SYMBOL PERFORMANCE ---
  const symbolAnalysis = analyzeSymbols(allTrades);
  config.symbolStats = symbolAnalysis.stats;
  config.symbolBlacklist = symbolAnalysis.blacklist;
  if (symbolAnalysis.blacklist.length > 0) {
    changes.push(`Blacklisted symbols: ${symbolAnalysis.blacklist.join(', ')}`);
  }

  // --- 5. REGIME ANALYSIS ---
  const regimeAnalysis = analyzeRegimes(allTrades);
  config.regimeStats = regimeAnalysis.stats;
  const oldBlocked = config.blockedRegimes || ['CHOPPY'];
  config.blockedRegimes = regimeAnalysis.blocked;
  const newBlocked = regimeAnalysis.blocked.filter(r => !oldBlocked.includes(r));
  if (newBlocked.length > 0) {
    changes.push(`Blocked regimes: added ${newBlocked.join(', ')}`);
  }

  // --- 6. DIRECTION BIAS ---
  config.directionStats = analyzeDirection(allTrades);

  // --- 7. LOSS STREAK DETECTION ---
  const lossStreak = analyzeLossStreak(allTrades);
  config.consecutiveLosses = lossStreak;
  if (lossStreak >= config.maxConsecutiveLosses) {
    // Pause trading for 2 hours
    config.pauseUntil = Date.now() + (2 * 60 * 60 * 1000);
    changes.push(`PAUSE: ${lossStreak} consecutive losses — pausing for 2 hours`);
  } else if (config.pauseUntil && Date.now() > config.pauseUntil) {
    config.pauseUntil = null; // Unpause
    changes.push('RESUME: Pause period expired');
  }

  // --- 8. ADX THRESHOLD ---
  // Analyze ADX effectiveness from trades that have indicator data
  // If most wins come from higher ADX, raise the threshold
  // This is a simplified version — we'd need indicator data stored with trades for full analysis
  // For now, keep adaptive based on overall win rate
  const overallWR = allTrades.length > 0 ?
    allTrades.filter(t => (t.pnl || 0) > 0).length / allTrades.length : 0.5;

  if (overallWR < 0.40) {
    // Losing overall — tighten ADX (require stronger trends)
    config.minADX = adjustParam(config.minADX, config.minADX + 2, BOUNDS.minADX);
    changes.push(`ADX threshold raised to ${config.minADX} (overall WR ${Math.round(overallWR * 100)}% too low)`);
  } else if (overallWR > 0.60) {
    // Winning well — can relax ADX slightly
    config.minADX = adjustParam(config.minADX, config.minADX - 1, BOUNDS.minADX);
  }

  // --- Build report ---
  const totalWins = allTrades.filter(t => (t.pnl || 0) > 0).length;
  const totalPnl = allTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);

  const report = [
    `=== OPTIMIZATION REPORT (Cycle #${config.cycleCount + 1}) ===`,
    `Trades analyzed: ${allTrades.length} (${silverTrades.length}S/${goldTrades.length}G)`,
    `Overall: ${totalWins}W / ${allTrades.length - totalWins}L (${Math.round(overallWR * 100)}%)`,
    `Total P&L: $${totalPnl.toFixed(2)}`,
    '',
    'AI Performance:',
    ...aiAnalysis.reasons,
    '',
    `Confidence threshold: ${config.alertConfidence}`,
    `Min R:R: ${config.minRiskReward} (Gold: ${config.minRiskRewardGold})`,
    `ADX threshold: ${config.minADX}`,
    `Blocked regimes: ${config.blockedRegimes.join(', ')}`,
    `Symbol blacklist: ${config.symbolBlacklist.length > 0 ? config.symbolBlacklist.join(', ') : 'none'}`,
    `Loss streak: ${lossStreak}${config.pauseUntil ? ' (PAUSED)' : ''}`,
    '',
    changes.length > 0 ? 'Changes this cycle:' : 'No parameter changes this cycle.',
    ...changes
  ].join('\n');

  // Update config metadata
  config.lastOptimized = Date.now();
  config.totalTradesAnalyzed = allTrades.length;
  config.cycleCount = (config.cycleCount || 0) + 1;
  config.lastChanges = changes;
  config.lastReport = report;

  // Save to Redis
  await redis.set(OPTIMIZATION_KEY, JSON.stringify(config));

  // Also save to optimization log (append, keep last 20 entries)
  try {
    let log = [];
    const savedLog = await redis.get(OPTIMIZATION_LOG_KEY);
    if (savedLog) {
      log = typeof savedLog === 'string' ? JSON.parse(savedLog) : savedLog;
    }
    log.unshift({
      timestamp: Date.now(),
      cycle: config.cycleCount,
      trades: allTrades.length,
      winRate: Math.round(overallWR * 100),
      pnl: Math.round(totalPnl * 100) / 100,
      changes: changes,
      aiWeights: { ...config.aiWeights }
    });
    log = log.slice(0, 20);
    await redis.set(OPTIMIZATION_LOG_KEY, JSON.stringify(log));
  } catch (e) {
    console.error('Failed to save optimization log:', e.message);
  }

  return { config, report };
}

// ============================================
// SEND TELEGRAM REPORT (optional)
// ============================================

async function sendTelegramReport(report) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) return;

  // Truncate for Telegram (4096 char limit)
  const msg = `🧠 *Self-Learning Optimizer*\n\n\`\`\`\n${report.slice(0, 3800)}\n\`\`\``;

  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: msg,
        parse_mode: 'Markdown'
      })
    });
  } catch (e) {
    console.error('Telegram report failed:', e.message);
  }
}

// ============================================
// HANDLER
// ============================================

export default async function handler(request, response) {
  // CORS headers
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (request.method === 'OPTIONS') {
    return response.status(200).end();
  }

  const startTime = Date.now();
  const redis = getRedis();
  if (!redis) {
    return response.status(500).json({ error: 'Redis not configured' });
  }

  // For GET requests from the client: just return saved config (no re-optimization)
  // Cron jobs trigger the actual optimization via the x-vercel-cron header or ?run=1
  const isCron = request.headers['x-vercel-cron'] || request.query?.run === '1';

  if (!isCron) {
    // Read-only: return saved optimization config
    try {
      const saved = await redis.get(OPTIMIZATION_KEY);
      const config = saved ? (typeof saved === 'string' ? JSON.parse(saved) : saved) : getDefaultOptConfig();
      return response.status(200).json({
        success: true,
        elapsed: (Date.now() - startTime) + 'ms',
        cycle: config.cycleCount || 0,
        tradesAnalyzed: config.totalTradesAnalyzed || 0,
        changes: config.lastChanges || [],
        config: {
          alertConfidence: config.alertConfidence,
          minRiskReward: config.minRiskReward,
          minRiskRewardGold: config.minRiskRewardGold,
          minADX: config.minADX,
          aiWeights: config.aiWeights,
          symbolBlacklist: config.symbolBlacklist || [],
          blockedRegimes: config.blockedRegimes || ['CHOPPY'],
          consecutiveLosses: config.consecutiveLosses || 0,
          pauseUntil: config.pauseUntil,
          cooldownHours: config.cooldownHours || 12
        },
        report: config.lastReport || 'Waiting for first optimization cycle.'
      });
    } catch (e) {
      console.error('Failed to read optimization config:', e.message);
      return response.status(200).json({
        success: true,
        config: getDefaultOptConfig(),
        report: 'Config not available yet.'
      });
    }
  }

  // Cron path: run full optimization
  console.log('🧠 Self-Learning Optimizer starting (cron)...');

  try {
    const { config, report } = await runOptimization(redis);

    console.log(report);

    // Send Telegram report if there were changes
    if (config.lastChanges && config.lastChanges.length > 0) {
      await sendTelegramReport(report);
    }

    const elapsed = Date.now() - startTime;
    return response.status(200).json({
      success: true,
      elapsed: elapsed + 'ms',
      cycle: config.cycleCount,
      tradesAnalyzed: config.totalTradesAnalyzed,
      changes: config.lastChanges || [],
      config: {
        alertConfidence: config.alertConfidence,
        minRiskReward: config.minRiskReward,
        minRiskRewardGold: config.minRiskRewardGold,
        minADX: config.minADX,
        aiWeights: config.aiWeights,
        symbolBlacklist: config.symbolBlacklist,
        blockedRegimes: config.blockedRegimes,
        consecutiveLosses: config.consecutiveLosses,
        pauseUntil: config.pauseUntil,
        cooldownHours: config.cooldownHours
      },
      report: report
    });
  } catch (error) {
    console.error('Optimizer error:', error);
    return response.status(500).json({
      error: error.message,
      elapsed: (Date.now() - startTime) + 'ms'
    });
  }
}
