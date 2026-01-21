// Pending Signals API - Track AI signals waiting for entry and evaluate TP/SL
//
// Flow:
// 1. When consensus signal generated -> store as pending for each AI source
// 2. On each scan -> check if price hit entry (signal becomes "active")
// 3. When active -> check if TP or SL hit -> record win/loss
// 4. 48-hour expiry for pending signals that never trigger
// 5. Deduplication: Only first signal per coin per AI counts

import { Redis } from '@upstash/redis';

const PENDING_SIGNALS_KEY = 'pending_ai_signals';
const MAX_SIGNAL_AGE_HOURS = 48;

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

// Get all pending signals
async function getPendingSignals() {
  const r = getRedis();
  if (!r) return [];

  try {
    const data = await r.get(PENDING_SIGNALS_KEY);
    if (data) {
      const signals = typeof data === 'string' ? JSON.parse(data) : data;
      return Array.isArray(signals) ? signals : [];
    }
    return [];
  } catch (e) {
    console.error('Redis get error for pending signals:', e.message);
    return [];
  }
}

// Save all pending signals
async function savePendingSignals(signals) {
  const r = getRedis();
  if (!r) return false;

  try {
    await r.set(PENDING_SIGNALS_KEY, JSON.stringify(signals));
    return true;
  } catch (e) {
    console.error('Redis save error for pending signals:', e.message);
    return false;
  }
}

// Add a new pending signal (checks for duplicates)
async function addPendingSignal(signal) {
  const signals = await getPendingSignals();

  // Check for duplicate: same symbol + same AI source with active/pending signal
  const existing = signals.find(s =>
    s.symbol === signal.symbol &&
    s.aiSource === signal.aiSource &&
    !s.resolved // Not yet resolved (win/loss/expired)
  );

  if (existing) {
    console.log(`⏭️ Skipping duplicate signal: ${signal.symbol} from ${signal.aiSource} (already pending/active)`);
    return { added: false, reason: 'duplicate', existing };
  }

  // Add new pending signal
  const newSignal = {
    id: `${signal.symbol}_${signal.aiSource}_${Date.now()}`,
    symbol: signal.symbol,
    direction: signal.direction,
    entry: signal.entry,
    stopLoss: signal.stopLoss,
    takeProfit: signal.takeProfit,
    aiSource: signal.aiSource,
    confidence: signal.confidence,
    createdAt: Date.now(),
    entryHit: false,
    entryHitAt: null,
    resolved: false,
    resolvedAt: null,
    result: null // 'win', 'loss', 'expired'
  };

  signals.push(newSignal);
  await savePendingSignals(signals);

  console.log(`📝 Added pending signal: ${signal.symbol} ${signal.direction} from ${signal.aiSource} @ ${signal.entry}`);
  return { added: true, signal: newSignal };
}

// Evaluate all pending signals against current prices
// Returns: { wins: [], losses: [], expired: [], stillPending: [] }
async function evaluatePendingSignals(currentPrices) {
  const signals = await getPendingSignals();
  const now = Date.now();
  const maxAgeMs = MAX_SIGNAL_AGE_HOURS * 60 * 60 * 1000;

  const results = {
    wins: [],
    losses: [],
    expired: [],
    stillPending: [],
    entryTriggered: []
  };

  for (const signal of signals) {
    // Skip already resolved signals
    if (signal.resolved) continue;

    const currentPrice = currentPrices[signal.symbol];
    if (!currentPrice) {
      results.stillPending.push(signal);
      continue;
    }

    const age = now - signal.createdAt;
    const isExpired = age > maxAgeMs;

    // Check if signal is expired (48h without entry hit)
    if (isExpired && !signal.entryHit) {
      signal.resolved = true;
      signal.resolvedAt = now;
      signal.result = 'expired';
      results.expired.push(signal);
      console.log(`⏰ Expired: ${signal.symbol} from ${signal.aiSource} (entry never hit in 48h)`);
      continue;
    }

    // If entry not hit yet, check if price reached entry
    if (!signal.entryHit) {
      const entryHit = checkEntryHit(signal, currentPrice);
      if (entryHit) {
        signal.entryHit = true;
        signal.entryHitAt = now;
        results.entryTriggered.push(signal);
        console.log(`🎯 Entry hit: ${signal.symbol} ${signal.direction} from ${signal.aiSource} @ ${currentPrice}`);
      }
    }

    // If entry was hit (either just now or previously), check TP/SL
    if (signal.entryHit) {
      // Check if expired after entry (48h total from signal creation)
      if (isExpired) {
        // Auto-close: check if in profit
        const isInProfit = checkInProfit(signal, currentPrice);
        signal.resolved = true;
        signal.resolvedAt = now;
        signal.result = isInProfit ? 'win' : 'loss';
        signal.exitPrice = currentPrice;

        if (isInProfit) {
          results.wins.push(signal);
          console.log(`✅ Auto-close WIN: ${signal.symbol} from ${signal.aiSource} (in profit at 48h)`);
        } else {
          results.losses.push(signal);
          console.log(`❌ Auto-close LOSS: ${signal.symbol} from ${signal.aiSource} (in loss at 48h)`);
        }
        continue;
      }

      // Check TP hit
      const tpHit = checkTPHit(signal, currentPrice);
      if (tpHit) {
        signal.resolved = true;
        signal.resolvedAt = now;
        signal.result = 'win';
        signal.exitPrice = currentPrice;
        results.wins.push(signal);
        console.log(`✅ TP Hit WIN: ${signal.symbol} from ${signal.aiSource} @ ${currentPrice}`);
        continue;
      }

      // Check SL hit
      const slHit = checkSLHit(signal, currentPrice);
      if (slHit) {
        signal.resolved = true;
        signal.resolvedAt = now;
        signal.result = 'loss';
        signal.exitPrice = currentPrice;
        results.losses.push(signal);
        console.log(`❌ SL Hit LOSS: ${signal.symbol} from ${signal.aiSource} @ ${currentPrice}`);
        continue;
      }

      // Still active (entry hit but no TP/SL yet)
      results.stillPending.push(signal);
    } else {
      // Entry not yet hit
      results.stillPending.push(signal);
    }
  }

  // Update signals in Redis (keep only unresolved ones for storage efficiency)
  // Resolved ones are counted and removed
  const unresolvedSignals = signals.filter(s => !s.resolved);
  await savePendingSignals(unresolvedSignals);

  return results;
}

// Check if current price has reached the entry price
function checkEntryHit(signal, currentPrice) {
  // For LONG: price should drop to or below entry to "enter"
  // For SHORT: price should rise to or above entry to "enter"
  // Using a small tolerance (0.1%) for price matching
  const tolerance = signal.entry * 0.001;

  if (signal.direction === 'LONG') {
    // Entry hit if price is at or below entry (we're looking to buy low)
    return currentPrice <= signal.entry + tolerance;
  } else {
    // Entry hit if price is at or above entry (we're looking to sell high)
    return currentPrice >= signal.entry - tolerance;
  }
}

// Check if TP was hit
function checkTPHit(signal, currentPrice) {
  if (signal.direction === 'LONG') {
    return currentPrice >= signal.takeProfit;
  } else {
    return currentPrice <= signal.takeProfit;
  }
}

// Check if SL was hit
function checkSLHit(signal, currentPrice) {
  if (signal.direction === 'LONG') {
    return currentPrice <= signal.stopLoss;
  } else {
    return currentPrice >= signal.stopLoss;
  }
}

// Check if currently in profit (for auto-close)
function checkInProfit(signal, currentPrice) {
  if (signal.direction === 'LONG') {
    return currentPrice > signal.entry;
  } else {
    return currentPrice < signal.entry;
  }
}

// Get summary stats for pending signals
async function getPendingSignalsSummary() {
  const signals = await getPendingSignals();
  const now = Date.now();

  const summary = {
    total: signals.length,
    pendingEntry: signals.filter(s => !s.entryHit && !s.resolved).length,
    activeMonitoring: signals.filter(s => s.entryHit && !s.resolved).length,
    byAI: {
      claude: signals.filter(s => s.aiSource === 'claude' && !s.resolved).length,
      openai: signals.filter(s => s.aiSource === 'openai' && !s.resolved).length,
      grok: signals.filter(s => s.aiSource === 'grok' && !s.resolved).length
    },
    bySymbol: {}
  };

  for (const signal of signals.filter(s => !s.resolved)) {
    if (!summary.bySymbol[signal.symbol]) {
      summary.bySymbol[signal.symbol] = { pending: 0, active: 0 };
    }
    if (signal.entryHit) {
      summary.bySymbol[signal.symbol].active++;
    } else {
      summary.bySymbol[signal.symbol].pending++;
    }
  }

  return summary;
}

// Clear all pending signals (for testing/reset)
async function clearPendingSignals() {
  const r = getRedis();
  if (!r) return false;

  try {
    await r.del(PENDING_SIGNALS_KEY);
    return true;
  } catch (e) {
    console.error('Error clearing pending signals:', e.message);
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
    // GET - Get pending signals summary or full list
    if (request.method === 'GET') {
      const { full } = request.query;

      if (full === 'true') {
        const signals = await getPendingSignals();
        return response.status(200).json({
          success: true,
          signals,
          count: signals.length
        });
      }

      const summary = await getPendingSignalsSummary();
      return response.status(200).json({
        success: true,
        summary
      });
    }

    // POST - Add a new pending signal
    if (request.method === 'POST') {
      const { signal } = request.body;

      if (!signal || !signal.symbol || !signal.direction || !signal.entry || !signal.aiSource) {
        return response.status(400).json({
          success: false,
          error: 'Invalid signal: requires symbol, direction, entry, stopLoss, takeProfit, aiSource'
        });
      }

      const result = await addPendingSignal(signal);
      return response.status(200).json({
        success: result.added,
        ...result
      });
    }

    // PATCH - Evaluate pending signals with current prices
    if (request.method === 'PATCH') {
      const { action, prices } = request.body;

      if (action === 'evaluate') {
        if (!prices || typeof prices !== 'object') {
          return response.status(400).json({
            success: false,
            error: 'prices object required for evaluation'
          });
        }

        const results = await evaluatePendingSignals(prices);
        return response.status(200).json({
          success: true,
          results,
          summary: {
            wins: results.wins.length,
            losses: results.losses.length,
            expired: results.expired.length,
            stillPending: results.stillPending.length,
            entryTriggered: results.entryTriggered.length
          }
        });
      }

      return response.status(400).json({
        success: false,
        error: 'Unknown action. Use action: "evaluate"'
      });
    }

    // DELETE - Clear all pending signals
    if (request.method === 'DELETE') {
      const { confirm } = request.query;

      if (confirm !== 'true') {
        return response.status(400).json({
          success: false,
          error: 'Add ?confirm=true to clear all pending signals'
        });
      }

      const cleared = await clearPendingSignals();
      return response.status(200).json({
        success: cleared,
        message: cleared ? 'All pending signals cleared' : 'Failed to clear'
      });
    }

    return response.status(405).json({
      success: false,
      error: 'Method not allowed'
    });

  } catch (error) {
    console.error('Pending signals API error:', error);
    return response.status(500).json({
      success: false,
      error: error.message
    });
  }
}

// Export functions for use in scan.js
export {
  addPendingSignal,
  evaluatePendingSignals,
  getPendingSignals,
  getPendingSignalsSummary,
  clearPendingSignals
};
