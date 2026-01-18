// Vercel Serverless Function for AI Signal Scanning
// Runs on cron schedule and sends Telegram alerts

const CONFIG = {
  // Minimum confidence for alerts
  ALERT_CONFIDENCE: 85,
  // Minimum TP percentages by market cap
  MIN_TP_PERCENT_BTC_ETH: 3,
  MIN_TP_PERCENT_LARGE_CAP: 5,
  MIN_TP_PERCENT_MID_CAP: 7,
  // Top coins to analyze
  TOP_COINS: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'LINKUSDT', 'DOTUSDT']
};

// ============================================
// MARKET DATA FETCHING
// ============================================

// Helper function for fetch with timeout
async function fetchWithTimeout(url, options = {}, timeout = 10000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

async function fetchMarketData() {
  const data = {
    prices: {},
    fundingRates: {},
    openInterest: {},
    liquidations: {},
    longShortRatio: {}
  };

  // Try multiple data sources for prices
  let pricesLoaded = false;

  // Source 1: Try Binance Spot API (more reliable)
  if (!pricesLoaded) {
    try {
      console.log('Trying Binance Spot API...');
      const pricesRes = await fetchWithTimeout('https://api.binance.com/api/v3/ticker/24hr', {}, 8000);
      const pricesData = await pricesRes.json();

      if (Array.isArray(pricesData)) {
        for (const coin of CONFIG.TOP_COINS) {
          const ticker = pricesData.find(t => t.symbol === coin);
          if (ticker) {
            data.prices[coin] = {
              price: parseFloat(ticker.lastPrice),
              change24h: parseFloat(ticker.priceChangePercent),
              high24h: parseFloat(ticker.highPrice),
              low24h: parseFloat(ticker.lowPrice),
              volume: parseFloat(ticker.quoteVolume)
            };
          }
        }
        pricesLoaded = Object.keys(data.prices).length > 0;
        console.log(`Binance Spot: loaded ${Object.keys(data.prices).length} prices`);
      }
    } catch (e) {
      console.log('Binance Spot failed:', e.message);
    }
  }

  // Source 2: Try Binance Futures API
  if (!pricesLoaded) {
    try {
      console.log('Trying Binance Futures API...');
      const pricesRes = await fetchWithTimeout('https://fapi.binance.com/fapi/v1/ticker/24hr', {}, 8000);
      const pricesData = await pricesRes.json();

      if (Array.isArray(pricesData)) {
        for (const coin of CONFIG.TOP_COINS) {
          const ticker = pricesData.find(t => t.symbol === coin);
          if (ticker) {
            data.prices[coin] = {
              price: parseFloat(ticker.lastPrice),
              change24h: parseFloat(ticker.priceChangePercent),
              high24h: parseFloat(ticker.highPrice),
              low24h: parseFloat(ticker.lowPrice),
              volume: parseFloat(ticker.quoteVolume)
            };
          }
        }
        pricesLoaded = Object.keys(data.prices).length > 0;
        console.log(`Binance Futures: loaded ${Object.keys(data.prices).length} prices`);
      }
    } catch (e) {
      console.log('Binance Futures failed:', e.message);
    }
  }

  // Source 3: Try CoinGecko as fallback (no API key needed)
  if (!pricesLoaded) {
    try {
      console.log('Trying CoinGecko API...');
      const cgIds = {
        'BTCUSDT': 'bitcoin',
        'ETHUSDT': 'ethereum',
        'SOLUSDT': 'solana',
        'BNBUSDT': 'binancecoin',
        'XRPUSDT': 'ripple',
        'DOGEUSDT': 'dogecoin',
        'ADAUSDT': 'cardano',
        'AVAXUSDT': 'avalanche-2',
        'LINKUSDT': 'chainlink',
        'DOTUSDT': 'polkadot'
      };

      const ids = Object.values(cgIds).join(',');
      const cgRes = await fetchWithTimeout(
        `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids}&price_change_percentage=24h`,
        {},
        8000
      );
      const cgData = await cgRes.json();

      if (Array.isArray(cgData)) {
        for (const [symbol, cgId] of Object.entries(cgIds)) {
          const coin = cgData.find(c => c.id === cgId);
          if (coin) {
            data.prices[symbol] = {
              price: coin.current_price,
              change24h: coin.price_change_percentage_24h || 0,
              high24h: coin.high_24h || coin.current_price,
              low24h: coin.low_24h || coin.current_price,
              volume: coin.total_volume || 0
            };
          }
        }
        pricesLoaded = Object.keys(data.prices).length > 0;
        console.log(`CoinGecko: loaded ${Object.keys(data.prices).length} prices`);
      }
    } catch (e) {
      console.log('CoinGecko failed:', e.message);
    }
  }

  if (!pricesLoaded) {
    console.error('All price sources failed!');
    return data;
  }

  // Fetch funding rates from Coinglass (if API key provided)
  if (process.env.COINGLASS_API_KEY) {
      try {
        const fundingRes = await fetch('https://open-api-v3.coinglass.com/api/futures/fundingRate/current?exchange=Binance', {
          headers: { 'CG-API-KEY': process.env.COINGLASS_API_KEY }
        });
        const fundingData = await fundingRes.json();

        if (fundingData.success && fundingData.data) {
          for (const item of fundingData.data) {
            const symbol = item.symbol + 'USDT';
            if (CONFIG.TOP_COINS.includes(symbol)) {
              data.fundingRates[symbol] = parseFloat(item.fundingRate) * 100;
            }
          }
        }
      } catch (e) {
        console.log('Coinglass funding rates unavailable:', e.message);
      }

      // Fetch Open Interest
      try {
        const oiRes = await fetch('https://open-api-v3.coinglass.com/api/futures/openInterest/chart?exchange=Binance&interval=1d&limit=2', {
          headers: { 'CG-API-KEY': process.env.COINGLASS_API_KEY }
        });
        const oiData = await oiRes.json();

        if (oiData.success && oiData.data) {
          for (const [symbol, values] of Object.entries(oiData.data)) {
            const fullSymbol = symbol + 'USDT';
            if (CONFIG.TOP_COINS.includes(fullSymbol) && values.length >= 2) {
              const current = values[values.length - 1];
              const previous = values[values.length - 2];
              data.openInterest[fullSymbol] = {
                current: current,
                change: ((current - previous) / previous * 100).toFixed(2)
              };
            }
          }
        }
      } catch (e) {
        console.log('Coinglass OI unavailable:', e.message);
      }

      // Fetch Long/Short Ratio
      try {
        const lsRes = await fetch('https://open-api-v3.coinglass.com/api/futures/globalLongShortAccountRatio/chart?exchange=Binance&interval=1d&limit=1', {
          headers: { 'CG-API-KEY': process.env.COINGLASS_API_KEY }
        });
        const lsData = await lsRes.json();

        if (lsData.success && lsData.data) {
          for (const [symbol, values] of Object.entries(lsData.data)) {
            const fullSymbol = symbol + 'USDT';
            if (CONFIG.TOP_COINS.includes(fullSymbol) && values.length > 0) {
              data.longShortRatio[fullSymbol] = parseFloat(values[0].longShortRatio);
            }
          }
        }
      } catch (e) {
        console.log('Coinglass L/S ratio unavailable:', e.message);
      }
    }

  return data;
}

// ============================================
// AI ANALYSIS
// ============================================

function buildAnalysisPrompt(marketData) {
  let prompt = `You are an expert crypto perpetual futures trader. Analyze the following market data and identify the BEST trading opportunities.

CURRENT MARKET DATA:
`;

  for (const symbol of CONFIG.TOP_COINS) {
    const price = marketData.prices[symbol];
    if (!price) continue;

    prompt += `\n${symbol}:
  Price: $${price.price.toLocaleString()}
  24h Change: ${price.change24h > 0 ? '+' : ''}${price.change24h.toFixed(2)}%
  24h High/Low: $${price.high24h.toLocaleString()} / $${price.low24h.toLocaleString()}
  Volume: $${(price.volume / 1e9).toFixed(2)}B`;

    if (marketData.fundingRates[symbol]) {
      prompt += `\n  Funding Rate: ${marketData.fundingRates[symbol].toFixed(4)}%`;
    }
    if (marketData.openInterest[symbol]) {
      prompt += `\n  OI Change: ${marketData.openInterest[symbol].change}%`;
    }
    if (marketData.longShortRatio[symbol]) {
      prompt += `\n  Long/Short Ratio: ${marketData.longShortRatio[symbol].toFixed(2)}`;
    }
  }

  prompt += `

TASK: Identify 1-3 highest conviction trade setups. For each, provide:
1. Symbol, Direction (LONG/SHORT), Confidence (0-100%)
2. Entry price, Stop Loss, Take Profit (with specific prices)
3. Key reasons (2-3 bullet points)

RULES:
- Only signals with 80%+ confidence
- Stop loss within 2-5% of entry
- Take profit should give minimum 2:1 risk/reward
- Consider funding rates (negative = shorts paying longs)
- Consider OI changes and L/S ratio for sentiment

Respond in this exact JSON format:
{
  "signals": [
    {
      "symbol": "BTCUSDT",
      "direction": "LONG",
      "confidence": 85,
      "entry": 65000,
      "stopLoss": 63500,
      "takeProfit": 68000,
      "reasons": ["reason1", "reason2"]
    }
  ]
}`;

  return prompt;
}

async function analyzeWithClaude(prompt) {
  if (!process.env.CLAUDE_API_KEY) return null;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();
    if (data.content && data.content[0]) {
      const text = data.content[0].text;
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return { source: 'claude', ...JSON.parse(jsonMatch[0]) };
      }
    }
  } catch (error) {
    console.error('Claude analysis error:', error);
  }
  return null;
}

async function analyzeWithOpenAI(prompt) {
  if (!process.env.OPENAI_API_KEY) return null;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1024
      })
    });

    const data = await response.json();
    if (data.choices && data.choices[0]) {
      const text = data.choices[0].message.content;
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return { source: 'openai', ...JSON.parse(jsonMatch[0]) };
      }
    }
  } catch (error) {
    console.error('OpenAI analysis error:', error);
  }
  return null;
}

async function analyzeWithGrok(prompt) {
  if (!process.env.GROK_API_KEY) return null;

  try {
    const response = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROK_API_KEY}`
      },
      body: JSON.stringify({
        model: 'grok-2-latest',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1024
      })
    });

    const data = await response.json();
    if (data.choices && data.choices[0]) {
      const text = data.choices[0].message.content;
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return { source: 'grok', ...JSON.parse(jsonMatch[0]) };
      }
    }
  } catch (error) {
    console.error('Grok analysis error:', error);
  }
  return null;
}

function findConsensusSignals(analyses) {
  const validAnalyses = analyses.filter(a => a && a.signals && a.signals.length > 0);
  if (validAnalyses.length < 2) return [];

  const consensusSignals = [];
  const allSignals = validAnalyses.flatMap(a =>
    a.signals.map(s => ({ ...s, aiSource: a.source }))
  );

  // Group signals by symbol and direction
  const grouped = {};
  for (const signal of allSignals) {
    const key = `${signal.symbol}-${signal.direction}`;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(signal);
  }

  // Find consensus (2+ AIs agree)
  for (const [key, signals] of Object.entries(grouped)) {
    if (signals.length >= 2) {
      const aiSources = [...new Set(signals.map(s => s.aiSource))];
      if (aiSources.length >= 2) {
        // Average the values
        const avgEntry = signals.reduce((sum, s) => sum + s.entry, 0) / signals.length;
        const avgSL = signals.reduce((sum, s) => sum + s.stopLoss, 0) / signals.length;
        const avgTP = signals.reduce((sum, s) => sum + s.takeProfit, 0) / signals.length;
        const avgConfidence = signals.reduce((sum, s) => sum + s.confidence, 0) / signals.length;

        // Collect all reasons
        const allReasons = [...new Set(signals.flatMap(s => s.reasons || []))];

        consensusSignals.push({
          symbol: signals[0].symbol,
          direction: signals[0].direction,
          entry: avgEntry,
          stopLoss: avgSL,
          takeProfit: avgTP,
          confidence: Math.round(avgConfidence),
          aiSources: aiSources,
          isGoldConsensus: aiSources.length >= 3,
          isSilverConsensus: aiSources.length === 2,
          reasons: allReasons.slice(0, 5)
        });
      }
    }
  }

  return consensusSignals;
}

// ============================================
// TELEGRAM
// ============================================

async function sendTelegramMessage(message) {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    console.log('Telegram not configured');
    return false;
  }

  try {
    const url = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      })
    });

    const data = await response.json();
    if (!data.ok) {
      console.error('Telegram error:', data.description);
      return false;
    }
    return true;
  } catch (error) {
    console.error('Telegram send error:', error);
    return false;
  }
}

function formatSignalForTelegram(signal) {
  const directionEmoji = signal.direction === 'LONG' ? '🚀' : '🔴';
  const consensusType = signal.isGoldConsensus ? '🥇 GOLD CONSENSUS' :
                        signal.isSilverConsensus ? '🥈 SILVER CONSENSUS' : '📊 CONSENSUS';

  const riskPercent = Math.abs((signal.stopLoss - signal.entry) / signal.entry * 100);
  const rewardPercent = Math.abs((signal.takeProfit - signal.entry) / signal.entry * 100);
  const riskReward = (rewardPercent / riskPercent).toFixed(1);

  const aiList = signal.aiSources.map(s => {
    if (s === 'claude') return '🟣 Claude';
    if (s === 'openai') return '🟢 GPT-4o';
    if (s === 'grok') return '⚡ Grok';
    return s;
  }).join(' + ');

  let message = `${directionEmoji} <b>${signal.direction} ${signal.symbol}</b>\n`;
  message += `${consensusType}\n\n`;
  message += `📊 <b>Confidence:</b> ${signal.confidence}%\n\n`;
  message += `💰 <b>Trade Setup:</b>\n`;
  message += `   Entry: $${signal.entry.toLocaleString()}\n`;
  message += `   Stop Loss: $${signal.stopLoss.toLocaleString()} (${riskPercent.toFixed(1)}%)\n`;
  message += `   Take Profit: $${signal.takeProfit.toLocaleString()} (${rewardPercent.toFixed(1)}%)\n`;
  message += `   R:R Ratio: 1:${riskReward}\n\n`;
  message += `🤖 <b>AI Sources:</b> ${aiList}\n\n`;

  if (signal.reasons && signal.reasons.length > 0) {
    message += `📝 <b>Reasons:</b>\n`;
    for (const reason of signal.reasons.slice(0, 4)) {
      message += `• ${reason}\n`;
    }
  }

  message += `\n⏰ ${new Date().toUTCString()}`;

  return message;
}

// ============================================
// MAIN HANDLER
// ============================================

export default async function handler(request, response) {
  console.log('🔄 Starting AI scan...');

  try {
    // Check if we have at least 2 AI APIs configured
    const aiCount = [
      process.env.CLAUDE_API_KEY,
      process.env.OPENAI_API_KEY,
      process.env.GROK_API_KEY
    ].filter(Boolean).length;

    if (aiCount < 2) {
      return response.status(200).json({
        success: false,
        message: 'At least 2 AI API keys required for consensus signals',
        configured: aiCount
      });
    }

    // Fetch market data
    console.log('📊 Fetching market data...');
    const marketData = await fetchMarketData();

    if (Object.keys(marketData.prices).length === 0) {
      return response.status(200).json({
        success: false,
        message: 'Failed to fetch market data'
      });
    }

    // Build analysis prompt
    const prompt = buildAnalysisPrompt(marketData);

    // Run AI analyses in parallel
    console.log('🤖 Running AI analysis...');
    const [claudeResult, openaiResult, grokResult] = await Promise.all([
      analyzeWithClaude(prompt),
      analyzeWithOpenAI(prompt),
      analyzeWithGrok(prompt)
    ]);

    const analyses = [claudeResult, openaiResult, grokResult].filter(Boolean);
    console.log(`✅ Got ${analyses.length} AI responses`);

    // Find consensus signals
    const consensusSignals = findConsensusSignals(analyses);
    console.log(`🎯 Found ${consensusSignals.length} consensus signals`);

    // Filter by confidence and TP%
    const alertSignals = consensusSignals.filter(signal => {
      if (signal.confidence < CONFIG.ALERT_CONFIDENCE) return false;

      const tpPercent = Math.abs((signal.takeProfit - signal.entry) / signal.entry * 100);
      let minTP = CONFIG.MIN_TP_PERCENT_MID_CAP;

      if (signal.symbol === 'BTCUSDT' || signal.symbol === 'ETHUSDT') {
        minTP = CONFIG.MIN_TP_PERCENT_BTC_ETH;
      } else if (['BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT', 'AVAXUSDT', 'DOTUSDT', 'LINKUSDT'].includes(signal.symbol)) {
        minTP = CONFIG.MIN_TP_PERCENT_LARGE_CAP;
      }

      return tpPercent >= minTP;
    });

    // Send Telegram alerts
    let alertsSent = 0;
    for (const signal of alertSignals) {
      const message = formatSignalForTelegram(signal);
      const sent = await sendTelegramMessage(message);
      if (sent) alertsSent++;
    }

    console.log(`📤 Sent ${alertsSent} Telegram alerts`);

    return response.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      aiResponses: analyses.length,
      consensusSignals: consensusSignals.length,
      alertsSent: alertsSent,
      signals: alertSignals.map(s => ({
        symbol: s.symbol,
        direction: s.direction,
        confidence: s.confidence,
        aiSources: s.aiSources
      }))
    });

  } catch (error) {
    console.error('Scan error:', error);
    return response.status(500).json({
      success: false,
      error: error.message
    });
  }
}
