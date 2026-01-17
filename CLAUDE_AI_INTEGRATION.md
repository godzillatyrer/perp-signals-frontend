# Claude AI Integration Guide

This guide explains how to integrate Claude AI for advanced market analysis and signal generation in Sentient Trader.

## Overview

You can integrate Claude AI to perform deeper market analysis by:
1. Sending technical indicator data to Claude API
2. Getting AI-powered insights and signal confirmation
3. Using Claude to generate trading narratives and explanations

## Setup

### 1. Get an Anthropic API Key

Sign up at [https://console.anthropic.com](https://console.anthropic.com) to get your API key.

**Pricing Note**: Claude API uses pay-per-token pricing:
- Claude 3.5 Sonnet: ~$3 per million input tokens, ~$15 per million output tokens
- For scanning 50 coins every 10 minutes, expect ~$5-20/month depending on analysis depth

### 2. Backend Proxy Setup (Recommended)

Since API keys shouldn't be exposed in frontend code, you'll need a simple backend proxy.

**Option A: Node.js Express Server**

Create `server.js`:

```javascript
const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
app.use(cors());
app.use(express.json());

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

app.post('/api/analyze', async (req, res) => {
  const { symbol, indicators, priceData } = req.body;

  try {
    const message = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `Analyze this cryptocurrency for trading:

Symbol: ${symbol}
Current Price: $${indicators.currentPrice}
RSI (14): ${indicators.rsi.toFixed(2)}
EMA20: $${indicators.ema20.toFixed(2)}
EMA50: $${indicators.ema50.toFixed(2)}
EMA200: $${indicators.ema200.toFixed(2)}
MACD: ${indicators.macd.macd.toFixed(4)} (Signal: ${indicators.macd.signal.toFixed(4)})
Bollinger Bands: Upper $${indicators.bb.upper.toFixed(2)}, Middle $${indicators.bb.middle.toFixed(2)}, Lower $${indicators.bb.lower.toFixed(2)}
ATR: ${indicators.atr.toFixed(4)}
Support Levels: ${indicators.supports.map(s => '$' + s.toFixed(2)).join(', ')}
Resistance Levels: ${indicators.resistances.map(r => '$' + r.toFixed(2)).join(', ')}

Provide a trading analysis with:
1. Direction recommendation (LONG/SHORT/NEUTRAL)
2. Confidence score (0-100)
3. Entry, stop-loss, and take-profit levels
4. Key reasons for your recommendation
5. Risk assessment

Format as JSON.`
      }]
    });

    res.json({ analysis: message.content[0].text });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(3001, () => console.log('AI proxy running on port 3001'));
```

**Option B: Cloudflare Workers (Serverless)**

```javascript
export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST',
          'Access-Control-Allow-Headers': 'Content-Type'
        }
      });
    }

    const { symbol, indicators } = await request.json();

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: `Analyze ${symbol} with RSI ${indicators.rsi}, price at EMA trend...`
        }]
      })
    });

    const data = await response.json();
    return new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
};
```

### 3. Frontend Integration

Add this to your `app.js`:

```javascript
// Configuration
const AI_CONFIG = {
  API_ENDPOINT: 'http://localhost:3001/api/analyze', // Your proxy endpoint
  SCAN_INTERVAL: 600000, // 10 minutes
  ENABLED: true
};

// Claude AI Analysis Function
async function analyzeWithClaude(symbol, candles) {
  if (!AI_CONFIG.ENABLED) return null;

  const closes = candles.map(c => c.close);
  const currentPrice = closes[closes.length - 1];

  const indicators = {
    currentPrice,
    rsi: calculateRSI(closes),
    ema20: calculateEMA(closes, 20),
    ema50: calculateEMA(closes, 50),
    ema200: calculateEMA(closes, 200),
    macd: calculateMACD(closes),
    bb: calculateBollingerBands(closes),
    atr: calculateATR(candles),
    ...findSupportResistance(candles)
  };

  try {
    const response = await fetch(AI_CONFIG.API_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, indicators })
    });

    const data = await response.json();
    return parseAIResponse(data.analysis);
  } catch (error) {
    console.error('Claude AI analysis failed:', error);
    return null;
  }
}

function parseAIResponse(text) {
  try {
    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.error('Failed to parse AI response:', e);
  }
  return null;
}

// Enhanced scan with AI
async function runAIScan() {
  console.log('Starting AI-enhanced scan...');

  for (const market of state.markets.slice(0, 20)) { // Top 20 by volume
    const candles = await fetchKlines(market.symbol, '240', 200);
    if (candles.length < 50) continue;

    // First: traditional technical analysis
    const technicalSignal = await analyzeMarket(market.symbol, '240');

    // Second: AI analysis for confirmation
    const aiAnalysis = await analyzeWithClaude(market.symbol, candles);

    if (technicalSignal && aiAnalysis) {
      // Combine signals
      const combinedConfidence = Math.round(
        (technicalSignal.confidence * 0.4) + (aiAnalysis.confidence * 0.6)
      );

      if (aiAnalysis.direction === technicalSignal.direction) {
        // AI confirms technical signal - boost confidence
        technicalSignal.confidence = Math.min(95, combinedConfidence + 10);
        technicalSignal.aiConfirmed = true;
        technicalSignal.aiInsights = aiAnalysis.reasons;
      }
    }

    await sleep(2000); // Rate limiting
  }
}

// Start AI scan interval
setInterval(runAIScan, AI_CONFIG.SCAN_INTERVAL);
```

## Advanced Prompts for Better Analysis

### Multi-Timeframe Analysis

```javascript
const prompt = `Analyze ${symbol} across multiple timeframes:

15-minute data:
- RSI: ${data['15m'].rsi}
- MACD: ${data['15m'].macd}

4-hour data:
- RSI: ${data['4h'].rsi}
- MACD: ${data['4h'].macd}
- Price vs EMA200: ${data['4h'].priceVsEma200}

Daily data:
- Trend: ${data['1d'].trend}
- Key levels: ${data['1d'].levels}

Identify:
1. Timeframe alignment (are all timeframes pointing same direction?)
2. Best entry timing based on lower timeframe
3. Stop-loss based on higher timeframe structure
4. Risk-reward assessment`;
```

### Sentiment & News Integration

```javascript
const prompt = `Given these market conditions for ${symbol}:

Technical: ${JSON.stringify(indicators)}

Recent sentiment indicators:
- Funding rate: ${fundingRate}%
- Open interest change (24h): ${oiChange}%
- Long/Short ratio: ${lsRatio}

Provide analysis considering both technical and sentiment factors.`;
```

## Cost Optimization Tips

1. **Batch Analysis**: Analyze multiple coins in a single prompt
2. **Cache Results**: Cache AI responses for 5-10 minutes
3. **Use Haiku for Screening**: Use Claude Haiku for initial screening, Sonnet for detailed analysis
4. **Limit Token Output**: Set max_tokens to 500-1000 for cost efficiency

```javascript
// Batch multiple coins in one request
const prompt = `Analyze these coins briefly (one line each):
${coins.map(c => `${c.symbol}: RSI ${c.rsi}, MACD ${c.macd > 0 ? '+' : '-'}`).join('\n')}

For each, respond with: SYMBOL | DIRECTION | CONFIDENCE | REASON`;
```

## Webhook Alerts

You can set up webhook notifications for high-confidence AI signals:

```javascript
async function sendWebhook(signal) {
  if (signal.confidence >= 85 && signal.aiConfirmed) {
    await fetch('YOUR_WEBHOOK_URL', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol: signal.symbol,
        direction: signal.direction,
        confidence: signal.confidence,
        entry: signal.entry,
        tp: signal.tp,
        sl: signal.sl,
        reasons: signal.aiInsights
      })
    });
  }
}
```

## Security Best Practices

1. **Never expose API keys in frontend code**
2. **Use environment variables for all secrets**
3. **Implement rate limiting on your proxy**
4. **Add authentication to your proxy endpoints**
5. **Monitor API usage to detect anomalies**

## Example Response Format

Claude will return analysis like:

```json
{
  "direction": "LONG",
  "confidence": 78,
  "entry": 95250.00,
  "stopLoss": 94200.00,
  "takeProfit": 97800.00,
  "riskReward": "1:2.4",
  "reasons": [
    "Price holding above EMA200 showing bullish structure",
    "RSI at 45 with room to run higher",
    "MACD histogram turning positive",
    "Strong support cluster at $94,500"
  ],
  "risks": [
    "Resistance at $96,500 may cause rejection",
    "Low volume suggests weak momentum"
  ],
  "timeframe": "4H"
}
```

## Questions?

For more information on Claude API:
- Documentation: https://docs.anthropic.com
- API Reference: https://docs.anthropic.com/en/api
- Pricing: https://www.anthropic.com/pricing
