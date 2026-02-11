// TradingView Webhook Receiver
// Receives BUY/SELL alerts from TradingView indicators and stores them in Redis
// Used as a confirmation filter: AI consensus trades only proceed if TV indicator agrees
//
// TradingView Alert Message format (set in alert dialog):
//   {"secret":"YOUR_SECRET","symbol":"{{ticker}}","signal":"BUY","price":"{{close}}","tp":"123.45","sl":"98.76","interval":"{{interval}}"}
//
// Fields:
//   secret   (required) — must match TV_WEBHOOK_SECRET env var
//   symbol   (required) — ticker symbol (auto-normalizes to USDT pair)
//   signal   (required) — "BUY" or "SELL"
//   price    (optional) — entry price at time of signal
//   tp       (optional) — take profit price from indicator
//   sl       (optional) — stop loss price from indicator
//   interval (optional) — chart timeframe
//   indicator(optional) — name of the indicator
//
// When TP/SL are provided, they override the AI-generated targets on confirmed trades.
// Signal TTL is configurable (default 30 min) — signals expire after this period.

import { Redis } from '@upstash/redis';
import { TV_INDICATOR } from '../lib/trading-config.js';

const REDIS_KEY_PREFIX = 'tv_signal:';

let redis = null;
function getRedis() {
  if (!redis && process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
  }
  return redis;
}

export default async function handler(request, response) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (request.method === 'OPTIONS') {
    return response.status(200).end();
  }

  // GET: Return current active TV signals (for frontend dashboard)
  if (request.method === 'GET') {
    try {
      const r = getRedis();
      if (!r) return response.status(200).json({ signals: [], enabled: TV_INDICATOR.enabled });

      // Scan for all tv_signal:* keys
      const signals = [];
      let cursor = 0;
      do {
        const [newCursor, keys] = await r.scan(cursor, { match: 'tv_signal:*', count: 100 });
        cursor = typeof newCursor === 'string' ? parseInt(newCursor) : newCursor;
        for (const key of keys) {
          const data = await r.get(key);
          if (data) {
            const parsed = typeof data === 'string' ? JSON.parse(data) : data;
            // Only include non-expired signals
            if (parsed.expiresAt > Date.now()) {
              signals.push(parsed);
            }
          }
        }
      } while (cursor !== 0);

      return response.status(200).json({
        signals,
        enabled: TV_INDICATOR.enabled,
        mode: TV_INDICATOR.mode,
        signalTTL: TV_INDICATOR.signalTTLMinutes
      });
    } catch (e) {
      return response.status(500).json({ error: e.message });
    }
  }

  // POST: Receive webhook from TradingView
  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = typeof request.body === 'string' ? JSON.parse(request.body) : request.body;

    // Validate webhook secret
    const expectedSecret = process.env.TV_WEBHOOK_SECRET;
    if (!expectedSecret) {
      console.log('⚠️ TV_WEBHOOK_SECRET not configured');
      return response.status(500).json({ error: 'Webhook secret not configured' });
    }
    if (body.secret !== expectedSecret) {
      console.log('🚫 TV webhook: invalid secret');
      return response.status(401).json({ error: 'Invalid secret' });
    }

    // Parse signal data
    let symbol = (body.symbol || '').toUpperCase().trim();
    const signal = (body.signal || '').toUpperCase().trim();
    const price = parseFloat(body.price) || 0;
    const tp = parseFloat(body.tp) || null;
    const sl = parseFloat(body.sl) || null;
    const interval = body.interval || '';
    const indicatorName = body.indicator || 'TV Indicator';

    // Validate required fields
    if (!symbol || !signal) {
      return response.status(400).json({ error: 'Missing symbol or signal' });
    }
    if (!['BUY', 'SELL'].includes(signal)) {
      return response.status(400).json({ error: 'Signal must be BUY or SELL' });
    }

    // Normalize symbol format: "BTCUSD" → "BTCUSDT", "BTC" → "BTCUSDT"
    if (!symbol.endsWith('USDT')) {
      if (symbol.endsWith('USD')) {
        symbol = symbol.replace('USD', 'USDT');
      } else if (symbol.endsWith('PERP') || symbol.endsWith('.P')) {
        symbol = symbol.replace(/\.P$|PERP$/, '') + 'USDT';
      } else {
        symbol = symbol + 'USDT';
      }
    }

    const r = getRedis();
    if (!r) {
      return response.status(500).json({ error: 'Redis not configured' });
    }

    const ttlMs = (TV_INDICATOR.signalTTLMinutes || 30) * 60 * 1000;
    const now = Date.now();

    const signalData = {
      symbol,
      signal,          // BUY or SELL
      price,
      tp,              // Take profit price (null if not provided)
      sl,              // Stop loss price (null if not provided)
      interval,
      indicatorName,
      timestamp: now,
      expiresAt: now + ttlMs
    };

    // Store in Redis with TTL
    const key = `${REDIS_KEY_PREFIX}${symbol}`;
    const ttlSeconds = Math.ceil(ttlMs / 1000);
    await r.set(key, JSON.stringify(signalData), { ex: ttlSeconds });

    const tpslInfo = tp && sl ? ` | TP: $${tp} SL: $${sl}` : '';
    console.log(`📺 TV Signal: ${signal} ${symbol} @ $${price}${tpslInfo} (TTL: ${TV_INDICATOR.signalTTLMinutes}min)`);

    // Also store in a recent signals list for the dashboard (last 50)
    const listKey = 'tv_signal_history';
    await r.lpush(listKey, JSON.stringify(signalData));
    await r.ltrim(listKey, 0, 49);

    return response.status(200).json({
      ok: true,
      stored: { symbol, signal, price, tp, sl, expiresAt: signalData.expiresAt }
    });

  } catch (e) {
    console.error('TV webhook error:', e);
    return response.status(500).json({ error: e.message });
  }
}
