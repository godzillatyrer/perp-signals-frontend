// AI Stats API - Persistent AI performance tracking across devices via Redis
// Stores win/loss records, signal counts, and confidence metrics for each AI model

import { Redis } from '@upstash/redis';

const STATS_KEY = 'ai_performance_stats';

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

// Default stats structure
function getDefaultStats() {
  return {
    // Claude metrics
    claudeWins: 0,
    claudeLosses: 0,
    claudeSignals: 0,
    claudeTotalConf: 0,

    // OpenAI metrics
    openaiWins: 0,
    openaiLosses: 0,
    openaiSignals: 0,
    openaiTotalConf: 0,

    // Grok metrics
    grokWins: 0,
    grokLosses: 0,
    grokSignals: 0,
    grokTotalConf: 0,

    // Consensus metrics (Gold = 3/3 AI agreement, Silver = 2/3 AI agreement)
    goldConsensusWins: 0,
    goldConsensusLosses: 0,
    goldConsensusSignals: 0,
    silverConsensusWins: 0,
    silverConsensusLosses: 0,
    silverConsensusSignals: 0,

    // Trade history for win rate tracking (last 100 trades)
    recentTrades: [],

    // Last updated timestamp
    lastUpdated: Date.now()
  };
}

async function getStats() {
  const r = getRedis();
  if (!r) return getDefaultStats();

  try {
    const data = await r.get(STATS_KEY);
    if (data) {
      const parsed = typeof data === 'string' ? JSON.parse(data) : data;
      // Merge with defaults to ensure all fields exist
      return { ...getDefaultStats(), ...parsed };
    }
    return getDefaultStats();
  } catch (e) {
    console.error('Redis get error for ai stats:', e.message);
    return getDefaultStats();
  }
}

async function saveStats(stats) {
  const r = getRedis();
  if (!r) {
    console.log('Redis not configured - stats not persisted');
    return false;
  }

  try {
    stats.lastUpdated = Date.now();
    // Keep only last 100 recent trades to prevent unbounded growth
    if (stats.recentTrades && stats.recentTrades.length > 100) {
      stats.recentTrades = stats.recentTrades.slice(-100);
    }
    await r.set(STATS_KEY, JSON.stringify(stats));
    return true;
  } catch (e) {
    console.error('Redis save error for ai stats:', e.message);
    return false;
  }
}

export default async function handler(request, response) {
  // CORS headers
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (request.method === 'OPTIONS') {
    return response.status(200).end();
  }

  const r = getRedis();
  if (!r) {
    return response.status(500).json({
      success: false,
      error: 'Redis not configured'
    });
  }

  try {
    // GET - Fetch current stats (optionally includes signal log)
    if (request.method === 'GET') {
      const stats = await getStats();
      const result = { success: true, stats };

      // Include AI signal log if requested (or always for simplicity)
      try {
        const logData = await r.get('ai_signal_log');
        if (logData) {
          result.signalLog = typeof logData === 'string' ? JSON.parse(logData) : logData;
        }
      } catch (e) {
        console.error('Failed to load signal log:', e.message);
      }

      // Include trade lessons and confidence tracking
      try {
        const lessons = await r.get('trade_lessons');
        if (lessons) {
          result.tradeLessons = typeof lessons === 'string' ? JSON.parse(lessons) : lessons;
        }
        const confTracking = await r.get('confidence_tracking');
        if (confTracking) {
          result.confidenceTracking = typeof confTracking === 'string' ? JSON.parse(confTracking) : confTracking;
        }
      } catch (e) {
        console.error('Failed to load lessons/confidence:', e.message);
      }

      return response.status(200).json(result);
    }

    // POST - Replace all stats (full sync from client)
    if (request.method === 'POST') {
      const { stats } = request.body;

      if (!stats) {
        return response.status(400).json({
          success: false,
          error: 'stats object required'
        });
      }

      // Merge with defaults to ensure structure
      const mergedStats = { ...getDefaultStats(), ...stats };
      const saved = await saveStats(mergedStats);

      return response.status(200).json({
        success: saved,
        stats: mergedStats
      });
    }

    // PATCH - Increment specific stats (atomic updates)
    if (request.method === 'PATCH') {
      const { action, data } = request.body;

      const currentStats = await getStats();

      switch (action) {
        case 'increment_signal': {
          // Increment signal count for an AI source
          const { source, confidence } = data;
          if (source === 'claude') {
            currentStats.claudeSignals++;
            currentStats.claudeTotalConf += confidence || 0;
          } else if (source === 'openai') {
            currentStats.openaiSignals++;
            currentStats.openaiTotalConf += confidence || 0;
          } else if (source === 'grok') {
            currentStats.grokSignals++;
            currentStats.grokTotalConf += confidence || 0;
          }
          break;
        }

        case 'increment_consensus': {
          // Increment consensus signal count (gold or silver)
          const { type } = data || {};
          if (type === 'silver') {
            currentStats.silverConsensusSignals++;
          } else {
            currentStats.goldConsensusSignals++;
          }
          break;
        }

        case 'record_trade_result': {
          // Record a win or loss for specific AI sources
          const { aiSources, isGoldConsensus, isSilverConsensus, isWin, symbol, direction, entry, exit, pnl, timestamp } = data;

          // Track per-AI wins/losses
          if (aiSources && Array.isArray(aiSources)) {
            for (const source of aiSources) {
              if (isWin) {
                if (source === 'claude') currentStats.claudeWins++;
                else if (source === 'openai') currentStats.openaiWins++;
                else if (source === 'grok') currentStats.grokWins++;
              } else {
                if (source === 'claude') currentStats.claudeLosses++;
                else if (source === 'openai') currentStats.openaiLosses++;
                else if (source === 'grok') currentStats.grokLosses++;
              }
            }
          }

          // Track consensus wins/losses
          if (isGoldConsensus) {
            if (isWin) {
              currentStats.goldConsensusWins++;
            } else {
              currentStats.goldConsensusLosses++;
            }
          } else if (isSilverConsensus) {
            if (isWin) {
              currentStats.silverConsensusWins++;
            } else {
              currentStats.silverConsensusLosses++;
            }
          }

          // Add to recent trades history
          currentStats.recentTrades.push({
            symbol,
            direction,
            entry,
            exit,
            pnl,
            aiSources,
            isGoldConsensus,
            isSilverConsensus,
            isWin,
            timestamp: timestamp || Date.now()
          });
          break;
        }

        case 'bulk_increment_signals': {
          // Bulk update signal counts (for batch processing)
          const { claude, openai, grok, goldConsensus, silverConsensus } = data;
          if (claude) {
            currentStats.claudeSignals += claude.count || 0;
            currentStats.claudeTotalConf += claude.totalConf || 0;
          }
          if (openai) {
            currentStats.openaiSignals += openai.count || 0;
            currentStats.openaiTotalConf += openai.totalConf || 0;
          }
          if (grok) {
            currentStats.grokSignals += grok.count || 0;
            currentStats.grokTotalConf += grok.totalConf || 0;
          }
          if (goldConsensus) {
            currentStats.goldConsensusSignals += goldConsensus || 0;
          }
          if (silverConsensus) {
            currentStats.silverConsensusSignals += silverConsensus || 0;
          }
          break;
        }

        case 'sync_signal_log': {
          // Sync resolved shadow signals from client back to Redis
          // Client resolves pending→win/loss via price tracking, needs to persist to Redis
          const { signalLog } = data;
          if (signalLog && typeof signalLog === 'object') {
            // Merge: update shadow status of existing signals, keep any new server-side signals
            const existing = await r.get('ai_signal_log');
            const serverLog = existing
              ? (typeof existing === 'string' ? JSON.parse(existing) : existing)
              : { claude: [], openai: [], grok: [], consensus: [] };

            for (const source of ['claude', 'openai', 'grok', 'consensus']) {
              const clientSigs = signalLog[source] || [];
              const serverSigs = serverLog[source] || [];

              // Build lookup of client signals by timestamp+symbol for fast matching
              const clientMap = new Map();
              for (const sig of clientSigs) {
                clientMap.set(`${sig.timestamp}-${sig.symbol}`, sig);
              }

              // Update server signals with resolved status from client
              for (const serverSig of serverSigs) {
                const key = `${serverSig.timestamp}-${serverSig.symbol}`;
                const clientSig = clientMap.get(key);
                if (clientSig && serverSig.shadowStatus === 'pending' && clientSig.shadowStatus !== 'pending') {
                  serverSig.shadowStatus = clientSig.shadowStatus;
                  serverSig.shadowPnl = clientSig.shadowPnl;
                }
                // Remove from map so we know which client signals are new
                clientMap.delete(key);
              }

              // Add any client-only signals (resolved signals that were never on server)
              for (const [, sig] of clientMap) {
                serverSigs.push(sig);
              }

              // Sort newest first, keep max 100
              serverLog[source] = serverSigs
                .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
                .slice(0, 100);
            }

            await r.set('ai_signal_log', JSON.stringify(serverLog));
          }

          return response.status(200).json({ success: true, synced: true });
        }

        default:
          return response.status(400).json({
            success: false,
            error: `Unknown action: ${action}`
          });
      }

      const saved = await saveStats(currentStats);
      return response.status(200).json({
        success: saved,
        stats: currentStats
      });
    }

    // DELETE - Reset all stats
    if (request.method === 'DELETE') {
      const { confirm } = request.query;

      if (confirm !== 'true') {
        return response.status(400).json({
          success: false,
          error: 'Add ?confirm=true to reset all AI stats'
        });
      }

      const defaultStats = getDefaultStats();
      const saved = await saveStats(defaultStats);

      return response.status(200).json({
        success: saved,
        message: 'All AI stats have been reset',
        stats: defaultStats
      });
    }

    return response.status(405).json({
      success: false,
      error: 'Method not allowed'
    });

  } catch (error) {
    console.error('AI Stats API error:', error);
    return response.status(500).json({
      success: false,
      error: error.message
    });
  }
}
