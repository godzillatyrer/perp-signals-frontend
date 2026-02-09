// AI Context API — Shows what data is fed to AIs, lessons learned, strategy changes
// Called by client-side AI Context viewer

import { Redis } from '@upstash/redis';

let redis = null;
function getRedis() {
  if (!redis && process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
  }
  return redis;
}

export default async function handler(request, response) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (request.method === 'OPTIONS') return response.status(200).end();

  const r = getRedis();
  if (!r) {
    return response.status(200).json({ success: false, error: 'Redis not configured' });
  }

  try {
    // Fetch all AI-related data in parallel
    const [
      tradeLessons,
      optimizationConfig,
      optimizationLog,
      aiSignalLog,
      confidenceTracking,
      aiPerformanceStats,
      portfolioData
    ] = await Promise.all([
      r.get('trade_lessons'),
      r.get('optimization_config'),
      r.get('optimization_log'),
      r.get('ai_signal_log'),
      r.get('confidence_tracking'),
      r.get('ai_performance_stats'),
      r.get('dual_portfolio_data')
    ]);

    const parse = (val) => {
      if (!val) return null;
      return typeof val === 'string' ? JSON.parse(val) : val;
    };

    const lessons = parse(tradeLessons) || [];
    const optConfig = parse(optimizationConfig);
    const optLog = parse(optimizationLog) || [];
    const signalLog = parse(aiSignalLog);
    const confTracking = parse(confidenceTracking) || [];
    const perfStats = parse(aiPerformanceStats);
    const portfolio = parse(portfolioData);

    // Build AI context summary — what the AIs actually see
    const aiContext = {
      // What lessons are included in prompts (last 10)
      promptLessons: lessons.slice(-10),

      // All lessons for full history view
      allLessons: lessons,

      // AI track records (what AIs see about each other)
      trackRecords: {},

      // Current optimization parameters
      optimizer: optConfig ? {
        alertConfidence: optConfig.alertConfidence,
        minRiskReward: optConfig.minRiskReward,
        minRiskRewardGold: optConfig.minRiskRewardGold,
        minADX: optConfig.minADX,
        cooldownHours: optConfig.cooldownHours,
        aiWeights: optConfig.aiWeights,
        symbolBlacklist: optConfig.symbolBlacklist || [],
        blockedRegimes: optConfig.blockedRegimes || [],
        consecutiveLosses: optConfig.consecutiveLosses || 0,
        paused: optConfig.pauseUntil ? Date.now() < optConfig.pauseUntil : false,
        pauseUntil: optConfig.pauseUntil,
        lastChanges: optConfig.lastChanges || [],
        lastReport: optConfig.lastReport,
        lastOptimized: optConfig.lastOptimized,
        cycleCount: optConfig.cycleCount,
        totalTradesAnalyzed: optConfig.totalTradesAnalyzed,
        symbolStats: optConfig.symbolStats || {},
        regimeStats: optConfig.regimeStats || {},
        directionStats: optConfig.directionStats || {}
      } : null,

      // Optimization history (strategy changes over time)
      optimizationHistory: optLog.slice(-10),

      // Confidence calibration data
      confidenceCalibration: buildConfidenceCalibration(confTracking),

      // AI performance stats
      aiPerformance: perfStats,

      // Recent AI signals with shadow results
      recentSignals: {
        claude: (signalLog?.claude || []).slice(-10),
        gemini: (signalLog?.openai || []).slice(-10),
        grok: (signalLog?.grok || []).slice(-10),
        consensus: (signalLog?.consensus || []).slice(-10)
      },

      // Win streak info
      winStreak: calculatePortfolioStreak(portfolio)
    };

    // Build per-AI track records (same logic as buildAnalysisPrompt)
    if (signalLog) {
      for (const aiName of ['claude', 'openai', 'grok']) {
        const signals = signalLog[aiName] || [];
        const resolved = signals.filter(s => s.shadowStatus === 'win' || s.shadowStatus === 'loss');
        const wins = resolved.filter(s => s.shadowStatus === 'win').length;
        const losses = resolved.filter(s => s.shadowStatus === 'loss').length;
        const total = wins + losses;
        const wr = total > 0 ? ((wins / total) * 100).toFixed(0) : 0;

        // Per-symbol breakdown
        const symbolBreakdown = {};
        for (const s of resolved) {
          if (!symbolBreakdown[s.symbol]) symbolBreakdown[s.symbol] = { wins: 0, losses: 0 };
          if (s.shadowStatus === 'win') symbolBreakdown[s.symbol].wins++;
          else symbolBreakdown[s.symbol].losses++;
        }

        const displayName = aiName === 'openai' ? 'gemini' : aiName;
        aiContext.trackRecords[displayName] = {
          wins, losses, total,
          winRate: Number(wr),
          symbolBreakdown,
          pendingSignals: signals.filter(s => s.shadowStatus === 'pending').length
        };
      }
    }

    return response.status(200).json({ success: true, ...aiContext });

  } catch (e) {
    console.error('[AI Context] Error:', e.message);
    return response.status(200).json({ success: false, error: e.message });
  }
}

function buildConfidenceCalibration(tracking) {
  const buckets = {};
  for (const entry of tracking) {
    const bucket = Math.floor(entry.confidence / 10) * 10;
    const key = `${bucket}-${bucket + 9}`;
    if (!buckets[key]) buckets[key] = { total: 0, wins: 0, totalPnl: 0 };
    buckets[key].total++;
    if (entry.outcome === 'win') buckets[key].wins++;
    buckets[key].totalPnl += entry.pnl || 0;
  }
  return buckets;
}

function calculatePortfolioStreak(portfolio) {
  if (!portfolio) return { silver: 0, gold: 0, combined: 0 };
  const calcStreak = (trades) => {
    const closed = (trades || [])
      .filter(t => t.status === 'closed' && t.pnl !== undefined)
      .sort((a, b) => (b.closeTimestamp || b.timestamp || 0) - (a.closeTimestamp || a.timestamp || 0));
    let streak = 0;
    for (const t of closed) {
      if (t.pnl > 0) streak++;
      else break;
    }
    return streak;
  };
  return {
    silver: calcStreak(portfolio.silver?.trades),
    gold: calcStreak(portfolio.gold?.trades),
    combined: calcStreak([...(portfolio.silver?.trades || []), ...(portfolio.gold?.trades || [])])
  };
}
