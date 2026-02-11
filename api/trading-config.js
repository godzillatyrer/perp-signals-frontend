// API endpoint: serves shared trading config to the frontend
// Source of truth: lib/trading-config.js
import { TRADING_CONFIG } from '../lib/trading-config.js';

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=300'); // 5 min cache
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).json(TRADING_CONFIG);
}
