// Cooldown API - Shared Redis-based cooldown tracking for all signal sources
// This ensures web app and serverless function share the same cooldown state

import { Redis } from '@upstash/redis';

const CONFIG = {
  SIGNAL_COOLDOWN_HOURS: 4,
  PRICE_MOVE_OVERRIDE_PERCENT: 10  // Only 10%+ price move can override cooldown
};

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
    return data ? (typeof data === 'string' ? JSON.parse(data) : data) : null;
  } catch (e) {
    console.error(`Redis get error for ${symbol}:`, e.message);
    return null;
  }
}

async function saveSignal(symbol, direction, entry) {
  const r = getRedis();
  if (!r) {
    console.log('Redis not configured - signal not persisted');
    return false;
  }

  try {
    const signalData = {
      symbol,
      direction,
      entry,
      timestamp: Date.now()
    };
    // Store with 24h expiry (longer than cooldown for safety)
    await r.set(`signal:${symbol}`, JSON.stringify(signalData), { ex: 24 * 60 * 60 });
    console.log(`📝 Saved ${symbol} ${direction} @ ${entry} to Redis`);
    return true;
  } catch (e) {
    console.error(`Redis save error for ${symbol}:`, e.message);
    return false;
  }
}

async function isSignalOnCooldown(symbol, direction, currentPrice) {
  const lastSignal = await getLastSignal(symbol);

  if (!lastSignal) {
    return { onCooldown: false, reason: 'No previous signal found' };
  }

  const hoursSinceLast = (Date.now() - lastSignal.timestamp) / (1000 * 60 * 60);

  // Cooldown expired (4h passed)
  if (hoursSinceLast >= CONFIG.SIGNAL_COOLDOWN_HOURS) {
    return {
      onCooldown: false,
      reason: `Cooldown expired (${hoursSinceLast.toFixed(1)}h ago)`
    };
  }

  // Check price movement - ONLY 10%+ can override
  if (lastSignal.entry && currentPrice) {
    const priceChange = Math.abs((currentPrice - lastSignal.entry) / lastSignal.entry * 100);

    // Price moved significantly (10%+) - allow new signal
    if (priceChange >= CONFIG.PRICE_MOVE_OVERRIDE_PERCENT) {
      return {
        onCooldown: false,
        reason: `Price moved ${priceChange.toFixed(1)}% (>= 10%) - override allowed`
      };
    }
  }

  // ON COOLDOWN - Block signal regardless of small price movements
  const hoursRemaining = (CONFIG.SIGNAL_COOLDOWN_HOURS - hoursSinceLast).toFixed(1);
  const priceInfo = lastSignal.entry && currentPrice
    ? ` (price moved ${Math.abs((currentPrice - lastSignal.entry) / lastSignal.entry * 100).toFixed(1)}%, need 10%+ to override)`
    : '';
  return {
    onCooldown: true,
    hoursRemaining,
    reason: `On cooldown (${hoursRemaining}h remaining)${priceInfo}`,
    lastSignal
  };
}

// Clear cooldown for a specific symbol or all symbols
async function clearCooldown(symbol = null) {
  const r = getRedis();
  if (!r) return { cleared: 0 };

  try {
    if (symbol) {
      // Clear specific symbol
      await r.del(`signal:${symbol}`);
      return { cleared: 1, symbols: [symbol] };
    } else {
      // Clear all signal:* keys
      // Note: This scans for keys with signal: prefix
      const keys = await r.keys('signal:*');
      if (keys && keys.length > 0) {
        for (const key of keys) {
          await r.del(key);
        }
        return { cleared: keys.length, symbols: keys.map(k => k.replace('signal:', '')) };
      }
      return { cleared: 0, symbols: [] };
    }
  } catch (e) {
    console.error('Error clearing cooldown:', e.message);
    return { cleared: 0, error: e.message };
  }
}

export default async function handler(request, response) {
  // CORS headers
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
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
    // GET - Check cooldown status
    if (request.method === 'GET') {
      const { symbol, direction, price } = request.query;

      if (!symbol) {
        return response.status(400).json({
          success: false,
          error: 'symbol parameter required'
        });
      }

      const currentPrice = price ? parseFloat(price) : null;
      const result = await isSignalOnCooldown(symbol, direction, currentPrice);

      return response.status(200).json({
        success: true,
        symbol,
        ...result
      });
    }

    // POST - Record a signal (for cooldown tracking)
    if (request.method === 'POST') {
      const { symbol, direction, entry, checkFirst } = request.body;

      if (!symbol || !direction) {
        return response.status(400).json({
          success: false,
          error: 'symbol and direction required'
        });
      }

      // Optionally check cooldown first before recording
      if (checkFirst) {
        const cooldownResult = await isSignalOnCooldown(symbol, direction, entry);
        if (cooldownResult.onCooldown) {
          return response.status(200).json({
            success: false,
            blocked: true,
            ...cooldownResult
          });
        }
      }

      // Record the signal
      const saved = await saveSignal(symbol, direction, entry);

      return response.status(200).json({
        success: saved,
        symbol,
        direction,
        entry,
        timestamp: Date.now()
      });
    }

    // DELETE - Clear cooldown history
    if (request.method === 'DELETE') {
      const { symbol, clearAll } = request.query;

      // Safety check - require either a specific symbol or explicit clearAll=true
      if (!symbol && clearAll !== 'true') {
        return response.status(400).json({
          success: false,
          error: 'Specify symbol to clear, or use clearAll=true to clear all cooldowns'
        });
      }

      const result = await clearCooldown(symbol || null);

      return response.status(200).json({
        success: true,
        message: symbol
          ? `Cleared cooldown for ${symbol}`
          : `Cleared all ${result.cleared} cooldown records`,
        ...result
      });
    }

    return response.status(405).json({
      success: false,
      error: 'Method not allowed'
    });

  } catch (error) {
    console.error('Cooldown API error:', error);
    return response.status(500).json({
      success: false,
      error: error.message
    });
  }
}
