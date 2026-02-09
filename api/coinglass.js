// Coinglass API Proxy — bypasses CORS by making requests server-side
// The browser can't send custom headers (CG-API-KEY) through CORS proxies,
// so this endpoint acts as a relay.

export default async function handler(request, response) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (request.method === 'OPTIONS') {
    return response.status(200).end();
  }

  const apiKey = process.env.COINGLASS_API_KEY;
  if (!apiKey) {
    return response.status(200).json({ success: false, error: 'COINGLASS_API_KEY not set in environment' });
  }

  const endpoint = request.query.endpoint || '/futures/liquidation/coin-list';
  const symbol = request.query.symbol || '';
  const baseUrl = 'https://open-api-v4.coinglass.com/api';

  try {
    const params = new URLSearchParams();
    if (symbol) params.set('symbol', symbol);

    const url = `${baseUrl}${endpoint}${params.toString() ? '?' + params.toString() : ''}`;
    console.log(`[Coinglass Proxy] ${endpoint}${symbol ? ' (' + symbol + ')' : ''}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(url, {
      headers: {
        'CG-API-KEY': apiKey,
        'accept': 'application/json'
      },
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return response.status(200).json({
        success: false,
        error: `Coinglass HTTP ${res.status}`,
        status: res.status
      });
    }

    const data = await res.json();

    return response.status(200).json({
      success: true,
      ...data
    });
  } catch (error) {
    console.error('[Coinglass Proxy] Error:', error.message);
    return response.status(200).json({
      success: false,
      error: error.message
    });
  }
}
