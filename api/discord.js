// Discord Bot API - Collect trading calls from Discord channels
// Stores calls with win/loss tracking and provides them as context for AI analysis

import { Redis } from '@upstash/redis';

// Redis client singleton
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

// ============================================
// CALL PARSER - Extract trading signals from messages
// ============================================

const SUPPORTED_SYMBOLS = [
  'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'AVAX', 'LINK', 'DOT',
  'MATIC', 'SHIB', 'LTC', 'TRX', 'ATOM', 'UNI', 'XLM', 'NEAR', 'APT', 'ARB',
  'OP', 'INJ', 'SUI', 'SEI', 'TIA', 'JUP', 'WIF', 'PEPE', 'BONK', 'FLOKI'
];

function parseDiscordCall(message) {
  const text = message.toUpperCase();

  // Try to extract: symbol, direction, entry, TP, SL
  const call = {
    symbol: null,
    direction: null,
    entry: null,
    takeProfit: [],
    stopLoss: null,
    leverage: null,
    rawMessage: message
  };

  // Find symbol (e.g., "BTC", "BTCUSDT", "$BTC")
  for (const sym of SUPPORTED_SYMBOLS) {
    const patterns = [
      new RegExp(`\\$${sym}\\b`, 'i'),
      new RegExp(`\\b${sym}USDT\\b`, 'i'),
      new RegExp(`\\b${sym}/USDT\\b`, 'i'),
      new RegExp(`\\b${sym}\\s*(LONG|SHORT|PERP)`, 'i'),
      new RegExp(`(LONG|SHORT)\\s*${sym}\\b`, 'i'),
      new RegExp(`\\b${sym}\\b`, 'i')
    ];

    for (const pattern of patterns) {
      if (pattern.test(text)) {
        call.symbol = sym + 'USDT';
        break;
      }
    }
    if (call.symbol) break;
  }

  // Find direction
  if (/\bLONG\b/i.test(text) || /\bBUY\b/i.test(text) || /\bBULLISH\b/i.test(text)) {
    call.direction = 'LONG';
  } else if (/\bSHORT\b/i.test(text) || /\bSELL\b/i.test(text) || /\bBEARISH\b/i.test(text)) {
    call.direction = 'SHORT';
  }

  // Find entry price - various patterns
  const entryPatterns = [
    /ENTRY[:\s]*\$?([\d,]+\.?\d*)/i,
    /ENTER[:\s]*\$?([\d,]+\.?\d*)/i,
    /BUY[:\s]*@?\s*\$?([\d,]+\.?\d*)/i,
    /SELL[:\s]*@?\s*\$?([\d,]+\.?\d*)/i,
    /@\s*\$?([\d,]+\.?\d*)/,
    /PRICE[:\s]*\$?([\d,]+\.?\d*)/i,
    /CURRENT[:\s]*\$?([\d,]+\.?\d*)/i
  ];

  for (const pattern of entryPatterns) {
    const match = text.match(pattern);
    if (match) {
      call.entry = parseFloat(match[1].replace(/,/g, ''));
      break;
    }
  }

  // Find take profit(s) - can be multiple TPs
  const tpPatterns = [
    /TP\d?[:\s]*\$?([\d,]+\.?\d*)/gi,
    /TAKE\s*PROFIT[:\s]*\$?([\d,]+\.?\d*)/gi,
    /TARGET[:\s]*\$?([\d,]+\.?\d*)/gi,
    /TARGETS?[:\s]*([\d,\.\s$]+)/gi
  ];

  for (const pattern of tpPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const price = parseFloat(match[1].replace(/,/g, ''));
      if (price && !isNaN(price) && !call.takeProfit.includes(price)) {
        call.takeProfit.push(price);
      }
    }
  }

  // Find stop loss
  const slPatterns = [
    /SL[:\s]*\$?([\d,]+\.?\d*)/i,
    /STOP\s*LOSS[:\s]*\$?([\d,]+\.?\d*)/i,
    /STOP[:\s]*\$?([\d,]+\.?\d*)/i,
    /INVALIDATION[:\s]*\$?([\d,]+\.?\d*)/i
  ];

  for (const pattern of slPatterns) {
    const match = text.match(pattern);
    if (match) {
      call.stopLoss = parseFloat(match[1].replace(/,/g, ''));
      break;
    }
  }

  // Find leverage
  const leverageMatch = text.match(/(\d+)X\s*LEV/i) || text.match(/LEV[:\s]*(\d+)X?/i) || text.match(/(\d+)X\b/);
  if (leverageMatch) {
    call.leverage = parseInt(leverageMatch[1]);
  }

  // Validate - must have at least symbol and direction
  if (!call.symbol || !call.direction) {
    return null;
  }

  return call;
}

// ============================================
// REDIS STORAGE FOR DISCORD CALLS
// ============================================

// Store a new call
async function storeDiscordCall(call, discordMetadata = {}) {
  const r = getRedis();
  if (!r) {
    console.log('Redis not configured - cannot store Discord call');
    return null;
  }

  const callId = `discord:call:${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  const callData = {
    id: callId,
    ...call,
    status: 'OPEN', // OPEN, WIN, LOSS, CANCELLED
    createdAt: Date.now(),
    updatedAt: Date.now(),
    discord: {
      userId: discordMetadata.userId || null,
      username: discordMetadata.username || null,
      channelId: discordMetadata.channelId || null,
      messageId: discordMetadata.messageId || null,
      guildId: discordMetadata.guildId || null
    },
    outcome: null, // { exitPrice, pnlPercent, closedAt }
  };

  try {
    // Store the call with 30-day expiry
    await r.set(callId, JSON.stringify(callData), { ex: 30 * 24 * 60 * 60 });

    // Add to list of calls (for easy retrieval)
    await r.lpush('discord:calls:list', callId);

    // Trim list to last 500 calls
    await r.ltrim('discord:calls:list', 0, 499);

    console.log(`Stored Discord call: ${callId} - ${call.symbol} ${call.direction}`);
    return callData;
  } catch (e) {
    console.error('Error storing Discord call:', e.message);
    return null;
  }
}

// Get recent calls
async function getRecentCalls(limit = 50) {
  const r = getRedis();
  if (!r) return [];

  try {
    const callIds = await r.lrange('discord:calls:list', 0, limit - 1);
    if (!callIds || callIds.length === 0) return [];

    const calls = [];
    for (const id of callIds) {
      const data = await r.get(id);
      if (data) {
        const parsed = typeof data === 'string' ? JSON.parse(data) : data;
        calls.push(parsed);
      }
    }

    return calls;
  } catch (e) {
    console.error('Error getting recent calls:', e.message);
    return [];
  }
}

// Get calls by status
async function getCallsByStatus(status, limit = 50) {
  const calls = await getRecentCalls(limit * 2);
  return calls.filter(c => c.status === status).slice(0, limit);
}

// Update call status (WIN/LOSS/CANCELLED)
async function updateCallStatus(callId, status, outcome = null) {
  const r = getRedis();
  if (!r) return null;

  try {
    const data = await r.get(callId);
    if (!data) return null;

    const call = typeof data === 'string' ? JSON.parse(data) : data;
    call.status = status;
    call.updatedAt = Date.now();

    if (outcome) {
      call.outcome = {
        exitPrice: outcome.exitPrice,
        pnlPercent: outcome.pnlPercent,
        closedAt: Date.now(),
        notes: outcome.notes
      };
    }

    await r.set(callId, JSON.stringify(call), { ex: 30 * 24 * 60 * 60 });

    // Update statistics
    await updateCallerStats(call);

    console.log(`Updated call ${callId} to ${status}`);
    return call;
  } catch (e) {
    console.error('Error updating call status:', e.message);
    return null;
  }
}

// Track caller statistics
async function updateCallerStats(call) {
  const r = getRedis();
  if (!r || !call.discord?.username) return;

  const statsKey = `discord:stats:${call.discord.username}`;

  try {
    let stats = await r.get(statsKey);
    stats = stats ? (typeof stats === 'string' ? JSON.parse(stats) : stats) : {
      username: call.discord.username,
      totalCalls: 0,
      wins: 0,
      losses: 0,
      cancelled: 0,
      winRate: 0,
      avgPnl: 0,
      totalPnl: 0
    };

    if (call.status === 'WIN') {
      stats.wins++;
      if (call.outcome?.pnlPercent) {
        stats.totalPnl += call.outcome.pnlPercent;
      }
    } else if (call.status === 'LOSS') {
      stats.losses++;
      if (call.outcome?.pnlPercent) {
        stats.totalPnl += call.outcome.pnlPercent;
      }
    } else if (call.status === 'CANCELLED') {
      stats.cancelled++;
    }

    const closedCalls = stats.wins + stats.losses;
    stats.winRate = closedCalls > 0 ? Math.round((stats.wins / closedCalls) * 100) : 0;
    stats.avgPnl = closedCalls > 0 ? (stats.totalPnl / closedCalls).toFixed(2) : 0;
    stats.totalCalls++;

    await r.set(statsKey, JSON.stringify(stats), { ex: 90 * 24 * 60 * 60 }); // 90 day expiry

    return stats;
  } catch (e) {
    console.error('Error updating caller stats:', e.message);
    return null;
  }
}

// Get caller statistics
async function getCallerStats(username) {
  const r = getRedis();
  if (!r) return null;

  try {
    const stats = await r.get(`discord:stats:${username}`);
    return stats ? (typeof stats === 'string' ? JSON.parse(stats) : stats) : null;
  } catch (e) {
    console.error('Error getting caller stats:', e.message);
    return null;
  }
}

// Get all caller statistics (for leaderboard)
async function getAllCallerStats() {
  const r = getRedis();
  if (!r) return [];

  try {
    // Get unique usernames from recent calls
    const calls = await getRecentCalls(200);
    const usernames = [...new Set(calls.map(c => c.discord?.username).filter(Boolean))];

    const allStats = [];
    for (const username of usernames) {
      const stats = await getCallerStats(username);
      if (stats && (stats.wins + stats.losses) >= 3) { // Min 3 closed calls
        allStats.push(stats);
      }
    }

    // Sort by win rate, then by total calls
    return allStats.sort((a, b) => {
      if (b.winRate !== a.winRate) return b.winRate - a.winRate;
      return b.totalCalls - a.totalCalls;
    });
  } catch (e) {
    console.error('Error getting all caller stats:', e.message);
    return [];
  }
}

// ============================================
// FORMAT CALLS FOR AI CONTEXT
// ============================================

function formatCallsForAIContext(calls) {
  if (!calls || calls.length === 0) return '';

  let context = '\n\nHISTORICAL DISCORD TRADING CALLS (for reference):\n';

  // Separate by status
  const openCalls = calls.filter(c => c.status === 'OPEN');
  const recentWins = calls.filter(c => c.status === 'WIN').slice(0, 10);
  const recentLosses = calls.filter(c => c.status === 'LOSS').slice(0, 10);

  if (openCalls.length > 0) {
    context += '\nCurrently OPEN calls:\n';
    for (const call of openCalls.slice(0, 10)) {
      const age = Math.round((Date.now() - call.createdAt) / (1000 * 60 * 60));
      context += `- ${call.symbol} ${call.direction} @ $${call.entry || 'N/A'}`;
      if (call.takeProfit?.length) context += ` (TP: $${call.takeProfit[0]})`;
      if (call.stopLoss) context += ` (SL: $${call.stopLoss})`;
      context += ` - ${age}h ago`;
      if (call.discord?.username) context += ` by ${call.discord.username}`;
      context += '\n';
    }
  }

  if (recentWins.length > 0) {
    context += '\nRecent WINNING calls:\n';
    for (const call of recentWins) {
      context += `- ${call.symbol} ${call.direction}`;
      if (call.outcome?.pnlPercent) context += ` (+${call.outcome.pnlPercent}%)`;
      if (call.discord?.username) context += ` by ${call.discord.username}`;
      context += '\n';
    }
  }

  if (recentLosses.length > 0) {
    context += '\nRecent LOSING calls:\n';
    for (const call of recentLosses) {
      context += `- ${call.symbol} ${call.direction}`;
      if (call.outcome?.pnlPercent) context += ` (${call.outcome.pnlPercent}%)`;
      if (call.discord?.username) context += ` by ${call.discord.username}`;
      context += '\n';
    }
  }

  // Add top callers
  context += '\nNote: Consider alignment/conflict with these active community calls when making recommendations.\n';

  return context;
}

// ============================================
// API HANDLERS
// ============================================

export default async function handler(request, response) {
  const { method } = request;

  // CORS headers
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (method === 'OPTIONS') {
    return response.status(200).end();
  }

  try {
    // GET - Retrieve calls or stats
    if (method === 'GET') {
      const { action, limit, status, username } = request.query;

      if (action === 'stats' && username) {
        const stats = await getCallerStats(username);
        return response.status(200).json({ success: true, stats });
      }

      if (action === 'leaderboard') {
        const leaderboard = await getAllCallerStats();
        return response.status(200).json({ success: true, leaderboard });
      }

      if (action === 'context') {
        // Get calls formatted for AI context
        const calls = await getRecentCalls(100);
        const context = formatCallsForAIContext(calls);
        return response.status(200).json({ success: true, context, callCount: calls.length });
      }

      // Default: get recent calls
      const calls = status
        ? await getCallsByStatus(status, parseInt(limit) || 50)
        : await getRecentCalls(parseInt(limit) || 50);

      return response.status(200).json({
        success: true,
        calls,
        count: calls.length
      });
    }

    // POST - Add new call or parse message
    if (method === 'POST') {
      const body = request.body;

      // Discord webhook interaction
      if (body.type === 1) {
        // Discord PING verification
        return response.status(200).json({ type: 1 });
      }

      // Parse a message to extract call
      if (body.action === 'parse') {
        const call = parseDiscordCall(body.message);
        return response.status(200).json({
          success: true,
          parsed: call !== null,
          call
        });
      }

      // Store a new call
      if (body.action === 'store' || body.message) {
        const message = body.message || body.rawMessage;
        const call = body.call || parseDiscordCall(message);

        if (!call) {
          return response.status(400).json({
            success: false,
            error: 'Could not parse trading call from message'
          });
        }

        const stored = await storeDiscordCall(call, body.discord || {});

        return response.status(200).json({
          success: stored !== null,
          call: stored
        });
      }

      return response.status(400).json({
        success: false,
        error: 'Invalid POST action'
      });
    }

    // PUT - Update call status
    if (method === 'PUT') {
      const { callId, status, exitPrice, pnlPercent, notes } = request.body;

      if (!callId || !status) {
        return response.status(400).json({
          success: false,
          error: 'callId and status required'
        });
      }

      if (!['WIN', 'LOSS', 'CANCELLED', 'OPEN'].includes(status)) {
        return response.status(400).json({
          success: false,
          error: 'Invalid status. Must be WIN, LOSS, CANCELLED, or OPEN'
        });
      }

      const outcome = (status === 'WIN' || status === 'LOSS') ? {
        exitPrice,
        pnlPercent,
        notes
      } : null;

      const updated = await updateCallStatus(callId, status, outcome);

      return response.status(200).json({
        success: updated !== null,
        call: updated
      });
    }

    // DELETE - Remove a call (admin only)
    if (method === 'DELETE') {
      const { callId } = request.body || request.query;

      if (!callId) {
        return response.status(400).json({
          success: false,
          error: 'callId required'
        });
      }

      const r = getRedis();
      if (r) {
        await r.del(callId);
        await r.lrem('discord:calls:list', 0, callId);
      }

      return response.status(200).json({
        success: true,
        deleted: callId
      });
    }

    return response.status(405).json({
      success: false,
      error: 'Method not allowed'
    });

  } catch (error) {
    console.error('Discord API error:', error);
    return response.status(500).json({
      success: false,
      error: error.message
    });
  }
}

// Export helper functions for use in scan.js
export {
  getRecentCalls,
  formatCallsForAIContext,
  parseDiscordCall,
  storeDiscordCall,
  updateCallStatus,
  getCallerStats,
  getAllCallerStats
};
