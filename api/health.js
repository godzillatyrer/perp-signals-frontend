// System Health API — Reports status of all APIs, processes, and data pipelines
// Called by client-side System Health dashboard

import { Redis } from '@upstash/redis';

let redis = null;
function getRedis() {
  if (!redis && process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
  }
  return redis;
}

async function checkEndpoint(url, timeout = 5000) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const start = Date.now();
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return { ok: res.ok, status: res.status, latency: Date.now() - start };
  } catch (e) {
    return { ok: false, status: 0, latency: -1, error: e.message };
  }
}

export default async function handler(request, response) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (request.method === 'OPTIONS') return response.status(200).end();

  const startTime = Date.now();
  const health = {
    timestamp: Date.now(),
    apis: {},
    processes: {},
    data: {},
    config: {}
  };

  // --- API Keys Configuration ---
  health.config = {
    claude: !!process.env.CLAUDE_API_KEY,
    gemini: !!process.env.OPENAI_API_KEY,
    grok: !!process.env.GROK_API_KEY,
    coinglass: !!process.env.COINGLASS_API_KEY,
    telegram: !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
    redis: !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN)
  };

  // --- External API Connectivity (parallel checks) ---
  const [binanceSpot, bybit, coingecko, coinglass] = await Promise.all([
    checkEndpoint('https://api.binance.com/api/v3/ping', 4000),
    checkEndpoint('https://api.bybit.com/v5/market/time', 4000),
    checkEndpoint('https://api.coingecko.com/api/v3/ping', 4000),
    process.env.COINGLASS_API_KEY
      ? checkEndpoint('https://open-api-v4.coinglass.com/api/futures/liquidation/coin-list', 5000)
        .then(r => ({ ...r, note: 'Needs CG-API-KEY header, HTTP check only' }))
      : Promise.resolve({ ok: false, status: 0, error: 'No API key' })
  ]);

  health.apis = {
    binanceSpot: { ...binanceSpot, name: 'Binance Spot' },
    bybit: { ...bybit, name: 'Bybit' },
    coingecko: { ...coingecko, name: 'CoinGecko' },
    coinglass: { ...coinglass, name: 'Coinglass' }
  };

  // --- Redis Health ---
  const r = getRedis();
  if (r) {
    try {
      const start = Date.now();
      await r.ping();
      health.apis.redis = { ok: true, latency: Date.now() - start, name: 'Redis (Upstash)' };
    } catch (e) {
      health.apis.redis = { ok: false, error: e.message, name: 'Redis (Upstash)' };
    }
  } else {
    health.apis.redis = { ok: false, error: 'Not configured', name: 'Redis (Upstash)' };
  }

  // --- Process Status (from Redis data) ---
  if (r) {
    try {
      // Portfolio data — shows if monitor-positions is working
      const portfolio = await r.get('dual_portfolio_data');
      if (portfolio) {
        const pd = typeof portfolio === 'string' ? JSON.parse(portfolio) : portfolio;
        const silverOpen = (pd.silver?.trades || []).filter(t => t.status === 'open').length;
        const goldOpen = (pd.gold?.trades || []).filter(t => t.status === 'open').length;
        const silverClosed = (pd.silver?.trades || []).filter(t => t.status === 'closed').length;
        const goldClosed = (pd.gold?.trades || []).filter(t => t.status === 'closed').length;
        const lastTrade = [...(pd.silver?.trades || []), ...(pd.gold?.trades || [])]
          .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))[0];

        // Win streak for display
        const allClosed = [...(pd.silver?.trades || []), ...(pd.gold?.trades || [])]
          .filter(t => t.status === 'closed' && t.pnl !== undefined)
          .sort((a, b) => (b.closeTimestamp || b.timestamp || 0) - (a.closeTimestamp || a.timestamp || 0));
        let winStreak = 0;
        for (const t of allClosed) { if (t.pnl > 0) winStreak++; else break; }

        health.processes.portfolio = {
          active: true,
          lastUpdated: pd.lastUpdated,
          silverOpen, goldOpen, silverClosed, goldClosed,
          silverBalance: pd.silver?.balance,
          goldBalance: pd.gold?.balance,
          lastTradeTime: lastTrade?.timestamp,
          lastTradeSymbol: lastTrade?.symbol,
          winStreak,
          riskMultiplier: Math.min(1 + winStreak * 0.5, 3.0)
        };

        // Enhanced stats
        health.processes.stats = {
          silver: pd.silver?.stats || {},
          gold: pd.gold?.stats || {}
        };
      } else {
        health.processes.portfolio = { active: false, note: 'No portfolio data in Redis' };
      }

      // Optimization config
      const optConfig = await r.get('optimization_config');
      if (optConfig) {
        const oc = typeof optConfig === 'string' ? JSON.parse(optConfig) : optConfig;
        health.processes.optimizer = {
          active: true,
          lastOptimized: oc.lastOptimized,
          cycle: oc.cycleCount,
          tradesAnalyzed: oc.totalTradesAnalyzed,
          paused: oc.pauseUntil ? Date.now() < oc.pauseUntil : false,
          pauseUntil: oc.pauseUntil,
          consecutiveLosses: oc.consecutiveLosses,
          aiWeights: oc.aiWeights,
          alertConfidence: oc.alertConfidence,
          minRiskReward: oc.minRiskReward,
          blockedRegimes: oc.blockedRegimes,
          symbolBlacklist: oc.symbolBlacklist
        };
      } else {
        health.processes.optimizer = { active: false, note: 'Optimizer has not run yet' };
      }

      // Trade lessons
      const lessons = await r.get('trade_lessons');
      const parsedLessons = lessons ? (typeof lessons === 'string' ? JSON.parse(lessons) : lessons) : [];
      health.data.tradeLessons = {
        count: parsedLessons.length,
        latest: parsedLessons.slice(-3)
      };

      // Confidence tracking
      const confTracking = await r.get('confidence_tracking');
      const parsedConf = confTracking ? (typeof confTracking === 'string' ? JSON.parse(confTracking) : confTracking) : [];
      health.data.confidenceTracking = { count: parsedConf.length };

      // AI signal log
      const signalLog = await r.get('ai_signal_log');
      if (signalLog) {
        const sl = typeof signalLog === 'string' ? JSON.parse(signalLog) : signalLog;
        health.data.signalLog = {
          claude: (sl.claude || []).length,
          gemini: (sl.openai || []).length,
          grok: (sl.grok || []).length,
          consensus: (sl.consensus || []).length
        };
      }

      // Cooldown data
      const cooldownKeys = [];
      for (const coin of ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT']) {
        const cd = await r.get(`signal:${coin}`);
        if (cd) {
          const parsed = typeof cd === 'string' ? JSON.parse(cd) : cd;
          cooldownKeys.push({ symbol: coin, ...parsed });
        }
      }
      health.data.cooldowns = cooldownKeys;

      // Cron job heartbeat status — detect if background scanning has stopped
      const cronJobs = {
        scan: { key: 'cron:scan:heartbeat', expectedInterval: 10 * 60 * 1000 },        // every 10 min
        monitor: { key: 'cron:monitor:heartbeat', expectedInterval: 2 * 60 * 1000 },    // every 2 min
        evaluate: { key: 'cron:evaluate:heartbeat', expectedInterval: 30 * 60 * 1000 },  // every 30 min
        optimize: { key: 'cron:optimize:heartbeat', expectedInterval: 6 * 60 * 60 * 1000 } // every 6 hours
      };
      health.processes.crons = {};
      for (const [name, { key, expectedInterval }] of Object.entries(cronJobs)) {
        const hb = await r.get(key);
        if (hb) {
          const parsed = typeof hb === 'string' ? JSON.parse(hb) : hb;
          const msSinceLastRun = Date.now() - parsed.lastRun;
          // Consider stale if 3x the expected interval has passed without a run
          const isStale = msSinceLastRun > expectedInterval * 3;
          health.processes.crons[name] = {
            ...parsed,
            msSinceLastRun,
            isStale,
            status: isStale ? 'STALE' : parsed.success ? 'OK' : 'FAILED'
          };
        } else {
          health.processes.crons[name] = {
            status: 'NEVER_RUN',
            isStale: true,
            note: 'No heartbeat recorded - cron may not be deployed or running'
          };
        }
      }

    } catch (e) {
      health.processes.error = e.message;
    }
  }

  health.duration = Date.now() - startTime;

  return response.status(200).json({ success: true, ...health });
}
