/* ============================================
   SENTIENT TRADER - AI Crypto Trading Intelligence v3.1
   Powered by Claude AI + ChatGPT + Grok
   ============================================ */

// Debug mode - set to true to see detailed API logs
let DEBUG_MODE = false;

// Configuration
const CONFIG = {
  BINANCE_API: 'https://fapi.binance.com',
  BYBIT_API: 'https://api.bybit.com',
  COINGECKO_API: 'https://api.coingecko.com/api/v3',
  // Claude API
  CLAUDE_API: 'https://api.anthropic.com/v1/messages',
  CLAUDE_API_KEY: '', // Will be loaded from localStorage or prompted
  CLAUDE_MODEL: 'claude-sonnet-4-20250514', // Claude Sonnet 4 (latest)
  // OpenAI API
  OPENAI_API: 'https://api.openai.com/v1/chat/completions',
  OPENAI_API_KEY: '', // Will be loaded from localStorage or prompted
  OPENAI_MODEL: 'gpt-4o', // Using GPT-4o for best analysis
  // Grok API (xAI)
  GROK_API: 'https://api.x.ai/v1/chat/completions',
  GROK_API_KEY: '', // Will be loaded from localStorage or prompted
  GROK_MODEL: 'grok-4-1-fast-reasoning', // Grok 4.1 fast reasoning
  // LunarCrush API (Social Sentiment)
  LUNARCRUSH_API: 'https://lunarcrush.com/api4/public',
  LUNARCRUSH_API_KEY: '', // Get free key at lunarcrush.com/developers
  // Coinglass API (Liquidation & Derivatives Data) - Using v4 API
  // Note: Using CORS proxy because Coinglass doesn't allow browser CORS
  COINGLASS_API_BASE: 'https://open-api-v4.coinglass.com/api',
  COINGLASS_PROXY: 'https://corsproxy.io/?', // CORS proxy for browser requests
  COINGLASS_API_KEY: '', // Get free key at coinglass.com/api
  // Telegram Bot (Alerts)
  TELEGRAM_BOT_TOKEN: '', // Get from @BotFather
  TELEGRAM_CHAT_ID: '', // Get from @userinfobot
  TELEGRAM_ENABLED: false,
  // Discord Integration (Call Tracking)
  DISCORD_WEBHOOK_URL: '', // For sending alerts back to Discord
  DISCORD_ENABLED: false,
  SCAN_INTERVAL: 90000,
  AI_SCAN_INTERVAL: 600000, // 10 minutes for AI analysis
  PRICE_UPDATE_INTERVAL: 1000,
  PNL_UPDATE_INTERVAL: 500,
  CACHE_TTL: 30000,
  MIN_CONFIDENCE: 65,
  HIGH_CONFIDENCE: 85, // Alert threshold - only notify for 85%+
  ALERT_CONFIDENCE: 85, // Minimum confidence for alerts - raised back to 85% for quality
  TOP_COINS: 50,
  LEVERAGE: 5,
  RISK_PERCENT: 2,
  TP_PERCENT: 5, // Minimum 5% TP for worthwhile trades
  SL_PERCENT: 2, // Stop loss
  MAX_OPEN_TRADES: 5, // Increased for more trades
  MAX_POSITION_SIZE_PERCENT: 20, // 20% of balance per trade
  AI_MIN_CONFIDENCE: 85, // Only auto-trade 85%+ confidence signals
  CHART_HISTORY_LIMIT: 1000, // More candles for longer history
  MIN_RISK_REWARD: 2,
  MIN_ATR_PERCENT: 0.4,
  MAX_ENTRY_WIGGLE_PERCENT: 2,
  MAX_SL_WIGGLE_PERCENT: 3,
  MAX_TP_WIGGLE_PERCENT: 5,
  MIN_AI_WINRATE: 0.4,
  // Minimum move requirements by market cap
  MIN_TP_PERCENT_BTC_ETH: 3, // BTC/ETH need at least 3% move
  MIN_TP_PERCENT_LARGE_CAP: 5, // Large caps (top 10) need 5%
  MIN_TP_PERCENT_MID_CAP: 7, // Mid caps need 7%
  MIN_TP_PERCENT_SMALL_CAP: 10 // Small caps need 10% minimum move
};

// Load API keys from localStorage
function loadApiKeys() {
  const claudeKey = localStorage.getItem('claude_api_key');
  const openaiKey = localStorage.getItem('openai_api_key');
  const grokKey = localStorage.getItem('grok_api_key');
  const lunarcrushKey = localStorage.getItem('lunarcrush_api_key');
  const coinglassKey = localStorage.getItem('coinglass_api_key');
  const telegramToken = localStorage.getItem('telegram_bot_token');
  const telegramChatId = localStorage.getItem('telegram_chat_id');
  const telegramEnabled = localStorage.getItem('telegram_enabled');
  const discordWebhookUrl = localStorage.getItem('discord_webhook_url');
  const discordEnabled = localStorage.getItem('discord_enabled');

  if (claudeKey) CONFIG.CLAUDE_API_KEY = claudeKey;
  if (openaiKey) CONFIG.OPENAI_API_KEY = openaiKey;
  if (grokKey) CONFIG.GROK_API_KEY = grokKey;
  if (lunarcrushKey) CONFIG.LUNARCRUSH_API_KEY = lunarcrushKey;
  if (coinglassKey) CONFIG.COINGLASS_API_KEY = coinglassKey;
  if (telegramToken) CONFIG.TELEGRAM_BOT_TOKEN = telegramToken;
  if (telegramChatId) CONFIG.TELEGRAM_CHAT_ID = telegramChatId;
  CONFIG.TELEGRAM_ENABLED = telegramEnabled === 'true';
  if (discordWebhookUrl) CONFIG.DISCORD_WEBHOOK_URL = discordWebhookUrl;
  CONFIG.DISCORD_ENABLED = discordEnabled === 'true';

  return {
    claude: !!claudeKey,
    openai: !!openaiKey,
    grok: !!grokKey,
    lunarcrush: !!lunarcrushKey,
    coinglass: !!coinglassKey,
    telegram: !!(telegramToken && telegramChatId),
    discord: !!discordEnabled
  };
}

// Legacy function for backwards compatibility
function loadApiKey() {
  return loadApiKeys().claude;
}

// ============================================
// SIGNAL COOLDOWN TRACKING (localStorage-based)
// ============================================

const SIGNAL_COOLDOWN_HOURS = 12; // 12-hour cooldown per coin
const PRICE_OVERRIDE_PERCENT = 10; // 10% price move overrides cooldown

function getSentSignals() {
  try {
    const stored = localStorage.getItem('sent_signals');
    return stored ? JSON.parse(stored) : {};
  } catch (e) {
    return {};
  }
}

function saveSentSignals(signals) {
  try {
    localStorage.setItem('sent_signals', JSON.stringify(signals));
  } catch (e) {
    console.error('Failed to save sent signals:', e);
  }
}

function recordSentSignal(symbol, direction, entry) {
  const signals = getSentSignals();
  signals[symbol] = {
    direction,
    entry,
    timestamp: Date.now()
  };
  saveSentSignals(signals);
  console.log(`📝 Recorded signal: ${symbol} ${direction} at ${entry}`);
}

function isSignalOnCooldown(symbol, direction, currentEntry) {
  const signals = getSentSignals();
  const lastSignal = signals[symbol];

  if (!lastSignal) {
    return { onCooldown: false };
  }

  const hoursSinceLast = (Date.now() - lastSignal.timestamp) / (1000 * 60 * 60);

  // Cooldown expired
  if (hoursSinceLast >= SIGNAL_COOLDOWN_HOURS) {
    return { onCooldown: false };
  }

  // Check price change override
  const priceChange = Math.abs((currentEntry - lastSignal.entry) / lastSignal.entry * 100);

  // If price moved significantly (>10%), allow new signal
  if (priceChange >= PRICE_OVERRIDE_PERCENT) {
    console.log(`📈 ${symbol}: Price moved ${priceChange.toFixed(1)}% - allowing new signal`);
    return { onCooldown: false };
  }

  // On cooldown
  const hoursRemaining = (SIGNAL_COOLDOWN_HOURS - hoursSinceLast).toFixed(1);
  console.log(`⏳ ${symbol}: On cooldown (${hoursRemaining}h remaining, price only moved ${priceChange.toFixed(1)}%)`);
  return {
    onCooldown: true,
    hoursRemaining,
    lastDirection: lastSignal.direction,
    lastEntry: lastSignal.entry,
    priceChange: priceChange.toFixed(1)
  };
}

function cleanExpiredSignals() {
  const signals = getSentSignals();
  const now = Date.now();
  const maxAge = SIGNAL_COOLDOWN_HOURS * 60 * 60 * 1000;

  let cleaned = 0;
  for (const symbol of Object.keys(signals)) {
    if (now - signals[symbol].timestamp > maxAge) {
      delete signals[symbol];
      cleaned++;
    }
  }

  if (cleaned > 0) {
    saveSentSignals(signals);
    console.log(`🧹 Cleaned ${cleaned} expired signal records`);
  }
}

// Clean expired signals on load
cleanExpiredSignals();

// ============================================
// TELEGRAM ALERTS
// ============================================

async function sendTelegramMessage(message, parseMode = 'HTML', inlineKeyboard = null) {
  if (!CONFIG.TELEGRAM_BOT_TOKEN || !CONFIG.TELEGRAM_CHAT_ID) {
    console.warn('⚠️ Telegram not configured');
    return false;
  }

  try {
    const url = `https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}/sendMessage`;
    const body = {
      chat_id: CONFIG.TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: parseMode,
      disable_web_page_preview: true
    };

    // Add inline keyboard if provided
    if (inlineKeyboard) {
      body.reply_markup = { inline_keyboard: inlineKeyboard };
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const result = await response.json();
    if (!result.ok) {
      console.error('❌ Telegram error:', result.description);
      return false;
    }

    console.log('📱 Telegram message sent successfully');
    return true;
  } catch (error) {
    console.error('❌ Telegram send failed:', error);
    return false;
  }
}

// Create inline keyboard for trade tracking
function createTradeKeyboard(signal) {
  const signalId = `${signal.symbol}_${signal.direction}_${Date.now()}`;
  return [
    [
      { text: '✅ Win', callback_data: `win_${signalId}` },
      { text: '❌ Loss', callback_data: `loss_${signalId}` },
      { text: '⏭️ Skip', callback_data: `skip_${signalId}` }
    ]
  ];
}

function formatSignalForTelegram(signal) {
  const direction = signal.direction === 'LONG' ? '🟢 LONG' : '🔴 SHORT';
  const emoji = signal.direction === 'LONG' ? '📈' : '📉';
  const consensusType = signal.isGoldConsensus ? '🥇 GOLD CONSENSUS' :
                        signal.isSilverConsensus ? '🥈 SILVER CONSENSUS' :
                        '🎯 AI SIGNAL';

  // Format price values
  const entry = parseFloat(signal.entry).toFixed(signal.entry < 1 ? 6 : 2);
  const tp = parseFloat(signal.tp).toFixed(signal.tp < 1 ? 6 : 2);
  const sl = parseFloat(signal.sl).toFixed(signal.sl < 1 ? 6 : 2);
  const tpPercent = signal.tpPercent ? signal.tpPercent.toFixed(1) :
                    (((signal.tp - signal.entry) / signal.entry) * 100 * (signal.direction === 'LONG' ? 1 : -1)).toFixed(1);

  // AI sources
  const aiSources = signal.aiSources || [];
  const aiList = aiSources.length > 0 ? aiSources.map(ai => {
    if (ai === 'claude') return '🧠 Claude';
    if (ai === 'openai') return '🤖 GPT-4o';
    if (ai === 'grok') return '⚡ Grok';
    return ai;
  }).join(' + ') : 'AI Analysis';

  // Build message
  let message = `
<b>${consensusType}</b>
━━━━━━━━━━━━━━━━━━━━━

${emoji} <b>${signal.symbol}</b> ${direction}
🎯 Confidence: <b>${signal.confidence}%</b>

<b>📊 Trade Setup:</b>
├ Entry: <code>${entry}</code>
├ Take Profit: <code>${tp}</code> (+${tpPercent}%)
└ Stop Loss: <code>${sl}</code>

<b>🤖 AI Sources:</b> ${aiList}
`;

  // Add reasons if available
  if (signal.reasons && signal.reasons.length > 0) {
    message += `\n<b>📋 Analysis:</b>\n`;
    signal.reasons.slice(0, 4).forEach(reason => {
      message += `• ${reason}\n`;
    });
  }

  // Add entry trigger if available
  if (signal.entryTrigger) {
    message += `\n<b>⚡ Entry Trigger:</b> ${signal.entryTrigger}`;
  }

  // Add market regime if available
  if (signal.marketRegime) {
    const regimeEmoji = signal.marketRegime === 'TRENDING' ? '📈' :
                        signal.marketRegime === 'RANGING' ? '↔️' : '⚠️';
    message += `\n<b>🌍 Market:</b> ${regimeEmoji} ${signal.marketRegime}`;
  }

  // Add 3rd AI dissenting opinion for silver consensus
  if (signal.isSilverConsensus && signal.dissentingAi) {
    const aiName = signal.dissentingAi.source.charAt(0).toUpperCase() + signal.dissentingAi.source.slice(1);
    const aiEmoji = signal.dissentingAi.source === 'claude' ? '🧠' :
                    signal.dissentingAi.source === 'openai' ? '🤖' : '⚡';

    message += `\n\n<b>${signal.dissentingAi.type === 'OPPOSITE_DIRECTION' ? '⚠️' : '🤔'} 3rd AI (${aiEmoji} ${aiName}):</b>`;

    if (signal.dissentingAi.type === 'OPPOSITE_DIRECTION') {
      const dissDir = signal.dissentingAi.direction === 'LONG' ? '🟢 LONG' : '🔴 SHORT';
      const dissEntry = parseFloat(signal.dissentingAi.entry).toFixed(signal.dissentingAi.entry < 1 ? 6 : 2);
      message += `\n${dissDir} at $${dissEntry} (${signal.dissentingAi.confidence}%)`;
      message += `\n<i>${signal.dissentingAi.reasoning?.substring(0, 60) || 'Different analysis'}...</i>`;
    } else if (signal.dissentingAi.type === 'DIFFERENT_ENTRY') {
      const dissEntry = parseFloat(signal.dissentingAi.entry).toFixed(signal.dissentingAi.entry < 1 ? 6 : 2);
      message += `\nSame direction, entry at $${dissEntry}`;
    } else {
      message += `\nDid not signal this coin`;
    }
  }

  message += `\n\n⏰ ${new Date().toLocaleString()}`;
  message += `\n\n<i>Sentient Trader AI</i>`;

  return message.trim();
}

async function sendTelegramSignalAlert(signal) {
  if (!CONFIG.TELEGRAM_ENABLED) {
    return false;
  }

  // Only send alerts for high-confidence signals
  if (signal.confidence < CONFIG.ALERT_CONFIDENCE) {
    return false;
  }

  // Check cooldown - prevent spam
  const cooldownCheck = isSignalOnCooldown(signal.symbol, signal.direction, signal.entry);
  if (cooldownCheck.onCooldown) {
    console.log(`🚫 ${signal.symbol}: Blocked by cooldown (${cooldownCheck.hoursRemaining}h remaining)`);
    return false;
  }

  const message = formatSignalForTelegram(signal);
  const keyboard = createTradeKeyboard(signal);
  const success = await sendTelegramMessage(message, 'HTML', keyboard);

  // Record the signal if sent successfully
  if (success) {
    recordSentSignal(signal.symbol, signal.direction, signal.entry);
  }

  return success;
}

async function sendTelegramTestMessage() {
  const testMessage = `
<b>🧪 Test Message from Sentient Trader</b>
━━━━━━━━━━━━━━━━━━━━━

✅ Telegram alerts are working!

Your bot is properly configured and ready to receive trading signals.

<b>What you'll receive:</b>
• 🥇 Gold Consensus signals (all 3 AIs agree)
• 🥈 Silver Consensus signals (2 AIs agree)
• 🎯 High-confidence AI signals (85%+)

<i>Sentient Trader AI</i>
⏰ ${new Date().toLocaleString()}
`;

  return await sendTelegramMessage(testMessage.trim());
}

// Manual send signal to Telegram (bypasses enabled/confidence checks but still tracks cooldown)
async function sendSignalToTelegramManual(signal) {
  // Check if Telegram is configured (but not necessarily enabled)
  if (!CONFIG.TELEGRAM_BOT_TOKEN || !CONFIG.TELEGRAM_CHAT_ID) {
    alert('⚠️ Telegram not configured!\n\nPlease go to Settings and add your:\n• Telegram Bot Token\n• Telegram Chat ID');
    return false;
  }

  // Warn about cooldown but don't block manual sends
  const cooldownCheck = isSignalOnCooldown(signal.symbol, signal.direction, signal.entry);
  if (cooldownCheck.onCooldown) {
    console.warn(`⚠️ ${signal.symbol}: This coin is on cooldown (${cooldownCheck.hoursRemaining}h remaining) - sending anyway (manual override)`);
  }

  const message = formatSignalForTelegram(signal);
  const keyboard = createTradeKeyboard(signal);
  const success = await sendTelegramMessage(message, 'HTML', keyboard);

  if (success) {
    // Record the signal to prevent automatic duplicates
    recordSentSignal(signal.symbol, signal.direction, signal.entry);
    console.log(`📤 Manually sent ${signal.symbol} signal to Telegram with Win/Loss buttons`);
  }

  return success;
}

// ============================================
// DISCORD CALL TRACKING
// ============================================

async function updateDiscordStats() {
  const openCallsEl = document.getElementById('discordOpenCalls');
  const winRateEl = document.getElementById('discordWinRate');

  if (!openCallsEl || !winRateEl) return;

  try {
    const response = await fetch('/api/discord?limit=100');
    const data = await response.json();

    if (data.success && data.calls) {
      const openCalls = data.calls.filter(c => c.status === 'OPEN').length;
      const wins = data.calls.filter(c => c.status === 'WIN').length;
      const losses = data.calls.filter(c => c.status === 'LOSS').length;
      const closedTotal = wins + losses;
      const winRate = closedTotal > 0 ? Math.round((wins / closedTotal) * 100) : 0;

      openCallsEl.textContent = openCalls;
      winRateEl.textContent = closedTotal > 0 ? `${winRate}% (${wins}W/${losses}L)` : 'No data';
    }
  } catch (e) {
    console.log('Could not fetch Discord stats:', e.message);
    openCallsEl.textContent = '-';
    winRateEl.textContent = '-';
  }
}

async function fetchDiscordCalls() {
  try {
    const response = await fetch('/api/discord?limit=50');
    const data = await response.json();
    return data.success ? data.calls : [];
  } catch (e) {
    console.error('Failed to fetch Discord calls:', e);
    return [];
  }
}

function showDiscordCallsModal() {
  // Create modal if it doesn't exist
  let modal = document.getElementById('discordCallsModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'discordCallsModal';
    modal.className = 'settings-modal';
    modal.innerHTML = `
      <div class="settings-overlay" onclick="closeDiscordCallsModal()"></div>
      <div class="settings-panel" style="max-width: 700px;">
        <div class="settings-header">
          <h2>Discord Trading Calls</h2>
          <button class="settings-close" onclick="closeDiscordCallsModal()">&times;</button>
        </div>
        <div class="settings-body" id="discordCallsBody">
          <div class="loading">Loading calls...</div>
        </div>
        <div class="settings-footer">
          <button class="test-telegram-btn" onclick="refreshDiscordCalls()">Refresh</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  modal.classList.add('active');
  refreshDiscordCalls();
}

function closeDiscordCallsModal() {
  const modal = document.getElementById('discordCallsModal');
  if (modal) modal.classList.remove('active');
}

async function refreshDiscordCalls() {
  const body = document.getElementById('discordCallsBody');
  if (!body) return;

  body.innerHTML = '<div class="loading">Loading calls...</div>';

  const calls = await fetchDiscordCalls();

  if (calls.length === 0) {
    body.innerHTML = '<div class="empty-state">No Discord calls found.<br><br>Add calls manually or connect a Discord bot.</div>';
    return;
  }

  const openCalls = calls.filter(c => c.status === 'OPEN');
  const closedCalls = calls.filter(c => c.status !== 'OPEN');

  let html = '';

  if (openCalls.length > 0) {
    html += '<h3 style="margin-bottom: 12px;">Open Calls</h3>';
    html += '<div class="discord-calls-list">';
    for (const call of openCalls) {
      html += renderDiscordCall(call);
    }
    html += '</div>';
  }

  if (closedCalls.length > 0) {
    html += '<h3 style="margin: 20px 0 12px;">Closed Calls</h3>';
    html += '<div class="discord-calls-list">';
    for (const call of closedCalls.slice(0, 20)) {
      html += renderDiscordCall(call);
    }
    html += '</div>';
  }

  body.innerHTML = html;

  // Add event listeners for action buttons
  body.querySelectorAll('.call-action-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const callId = e.target.dataset.callId;
      const action = e.target.dataset.action;
      await updateDiscordCallStatus(callId, action);
    });
  });
}

function renderDiscordCall(call) {
  const dirEmoji = call.direction === 'LONG' ? '🚀' : '🔴';
  const statusClass = call.status === 'WIN' ? 'win' : call.status === 'LOSS' ? 'loss' : 'open';
  const age = Math.round((Date.now() - call.createdAt) / (1000 * 60 * 60));

  let statusBadge = '';
  if (call.status === 'WIN') statusBadge = '<span class="call-status win">WIN</span>';
  else if (call.status === 'LOSS') statusBadge = '<span class="call-status loss">LOSS</span>';
  else statusBadge = '<span class="call-status open">OPEN</span>';

  let actions = '';
  if (call.status === 'OPEN') {
    actions = `
      <div class="call-actions">
        <button class="call-action-btn win-btn" data-call-id="${call.id}" data-action="WIN">Win</button>
        <button class="call-action-btn loss-btn" data-call-id="${call.id}" data-action="LOSS">Loss</button>
        <button class="call-action-btn cancel-btn" data-call-id="${call.id}" data-action="CANCELLED">Cancel</button>
      </div>
    `;
  }

  return `
    <div class="discord-call ${statusClass}">
      <div class="call-header">
        <span class="call-symbol">${dirEmoji} ${call.symbol} ${call.direction}</span>
        ${statusBadge}
      </div>
      <div class="call-details">
        ${call.entry ? `<span>Entry: $${call.entry.toLocaleString()}</span>` : ''}
        ${call.takeProfit?.length ? `<span>TP: $${call.takeProfit[0].toLocaleString()}</span>` : ''}
        ${call.stopLoss ? `<span>SL: $${call.stopLoss.toLocaleString()}</span>` : ''}
      </div>
      <div class="call-meta">
        <span>${age}h ago</span>
        ${call.discord?.username ? `<span>by ${call.discord.username}</span>` : ''}
        ${call.outcome?.pnlPercent ? `<span class="${call.status === 'WIN' ? 'pnl-positive' : 'pnl-negative'}">${call.outcome.pnlPercent > 0 ? '+' : ''}${call.outcome.pnlPercent}%</span>` : ''}
      </div>
      ${actions}
    </div>
  `;
}

async function updateDiscordCallStatus(callId, status) {
  try {
    const response = await fetch('/api/discord', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callId, status })
    });
    const data = await response.json();
    if (data.success) {
      refreshDiscordCalls();
      updateDiscordStats();
    } else {
      alert('Failed to update call: ' + (data.error || 'Unknown error'));
    }
  } catch (e) {
    alert('Failed to update call: ' + e.message);
  }
}

function showAddDiscordCallModal() {
  let modal = document.getElementById('addDiscordCallModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'addDiscordCallModal';
    modal.className = 'settings-modal';
    modal.innerHTML = `
      <div class="settings-overlay" onclick="closeAddDiscordCallModal()"></div>
      <div class="settings-panel" style="max-width: 500px;">
        <div class="settings-header">
          <h2>Add Discord Call</h2>
          <button class="settings-close" onclick="closeAddDiscordCallModal()">&times;</button>
        </div>
        <div class="settings-body">
          <div class="api-input-group">
            <label>Paste call message or enter details:</label>
            <textarea id="discordCallMessage" rows="4" placeholder="e.g., BTC LONG Entry 65000 TP 68000 SL 63000" style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1); background: rgba(0,0,0,0.3); color: #fff; resize: vertical;"></textarea>
          </div>
          <div class="api-input-group" style="margin-top: 12px;">
            <label>Caller username (optional):</label>
            <input type="text" id="discordCallUsername" placeholder="Discord username" style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1); background: rgba(0,0,0,0.3); color: #fff;">
          </div>
          <div id="parsedCallPreview" style="margin-top: 16px; padding: 12px; background: rgba(0,0,0,0.3); border-radius: 8px; display: none;"></div>
        </div>
        <div class="settings-footer">
          <button class="test-telegram-btn" id="parseCallBtn">Parse Call</button>
          <button class="settings-save-btn" id="saveDiscordCallBtn" disabled>Save Call</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    // Add event listeners
    document.getElementById('parseCallBtn').addEventListener('click', parseAndPreviewCall);
    document.getElementById('saveDiscordCallBtn').addEventListener('click', saveDiscordCall);
  }

  modal.classList.add('active');
  document.getElementById('discordCallMessage').value = '';
  document.getElementById('discordCallUsername').value = '';
  document.getElementById('parsedCallPreview').style.display = 'none';
  document.getElementById('saveDiscordCallBtn').disabled = true;
}

function closeAddDiscordCallModal() {
  const modal = document.getElementById('addDiscordCallModal');
  if (modal) modal.classList.remove('active');
}

let parsedCallData = null;

async function parseAndPreviewCall() {
  const message = document.getElementById('discordCallMessage').value;
  const preview = document.getElementById('parsedCallPreview');
  const saveBtn = document.getElementById('saveDiscordCallBtn');

  if (!message.trim()) {
    preview.innerHTML = '<span style="color: #ff6b6b;">Please enter a call message</span>';
    preview.style.display = 'block';
    saveBtn.disabled = true;
    return;
  }

  try {
    const response = await fetch('/api/discord', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'parse', message })
    });
    const data = await response.json();

    if (data.parsed && data.call) {
      parsedCallData = data.call;
      const call = data.call;
      preview.innerHTML = `
        <div style="color: #4ade80;">Parsed successfully!</div>
        <div style="margin-top: 8px;">
          <strong>${call.direction === 'LONG' ? '🚀' : '🔴'} ${call.symbol} ${call.direction}</strong><br>
          ${call.entry ? `Entry: $${call.entry.toLocaleString()}<br>` : ''}
          ${call.takeProfit?.length ? `TP: $${call.takeProfit.join(', $')}<br>` : ''}
          ${call.stopLoss ? `SL: $${call.stopLoss.toLocaleString()}<br>` : ''}
          ${call.leverage ? `Leverage: ${call.leverage}x` : ''}
        </div>
      `;
      saveBtn.disabled = false;
    } else {
      parsedCallData = null;
      preview.innerHTML = '<span style="color: #ff6b6b;">Could not parse call. Make sure it includes a symbol (BTC, ETH, etc.) and direction (LONG/SHORT).</span>';
      saveBtn.disabled = true;
    }
    preview.style.display = 'block';
  } catch (e) {
    preview.innerHTML = `<span style="color: #ff6b6b;">Error: ${e.message}</span>`;
    preview.style.display = 'block';
    saveBtn.disabled = true;
  }
}

async function saveDiscordCall() {
  if (!parsedCallData) return;

  const username = document.getElementById('discordCallUsername').value.trim();

  try {
    const response = await fetch('/api/discord', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'store',
        call: parsedCallData,
        discord: { username: username || 'Manual Entry' }
      })
    });
    const data = await response.json();

    if (data.success) {
      closeAddDiscordCallModal();
      updateDiscordStats();
      showNotification({ type: 'success', message: `Call added: ${parsedCallData.symbol} ${parsedCallData.direction}` });
    } else {
      alert('Failed to save call: ' + (data.error || 'Unknown error'));
    }
  } catch (e) {
    alert('Failed to save call: ' + e.message);
  }
}

// Prompt for API keys
function promptForApiKeys() {
  // Claude API Key
  if (!CONFIG.CLAUDE_API_KEY) {
    const claudeKey = prompt('Enter your Claude API Key:\n\n(Get one at console.anthropic.com)\n\nLeave empty to skip.');
    if (claudeKey && claudeKey.trim().startsWith('sk-ant-')) {
      CONFIG.CLAUDE_API_KEY = claudeKey.trim();
      localStorage.setItem('claude_api_key', claudeKey.trim());
      console.log('🔑 Claude API Key saved');
    }
  }

  // OpenAI API Key
  if (!CONFIG.OPENAI_API_KEY) {
    const openaiKey = prompt('Enter your OpenAI API Key:\n\n(Get one at platform.openai.com)\n\nLeave empty to skip.');
    if (openaiKey && openaiKey.trim().startsWith('sk-')) {
      CONFIG.OPENAI_API_KEY = openaiKey.trim();
      localStorage.setItem('openai_api_key', openaiKey.trim());
      console.log('🔑 OpenAI API Key saved');
    }
  }

  return isAnyAiConfigured();
}

// Legacy function
function promptForApiKey() {
  return promptForApiKeys();
}

// Check if Claude is configured
function isClaudeConfigured() {
  return CONFIG.CLAUDE_API_KEY && CONFIG.CLAUDE_API_KEY.startsWith('sk-ant-');
}

// Check if OpenAI is configured
function isOpenAIConfigured() {
  return CONFIG.OPENAI_API_KEY && CONFIG.OPENAI_API_KEY.startsWith('sk-');
}

// Check if Grok is configured
function isGrokConfigured() {
  return CONFIG.GROK_API_KEY && CONFIG.GROK_API_KEY.startsWith('xai-');
}

// Check if any AI is configured
function isAnyAiConfigured() {
  return isClaudeConfigured() || isOpenAIConfigured() || isGrokConfigured();
}

// Count how many AIs are configured
function countConfiguredAIs() {
  let count = 0;
  if (isClaudeConfigured()) count++;
  if (isOpenAIConfigured()) count++;
  if (isGrokConfigured()) count++;
  return count;
}

// Legacy function
function isAiConfigured() {
  return isAnyAiConfigured();
}

// Manual API key setting (callable from console)
function setApiKeyManually(provider, key) {
  if (provider === 'claude' || provider === 'anthropic') {
    if (key && key.startsWith('sk-ant-')) {
      CONFIG.CLAUDE_API_KEY = key;
      localStorage.setItem('claude_api_key', key);
      console.log('✅ Claude API key saved successfully!');
      return true;
    } else {
      console.error('❌ Invalid Claude API key. It should start with "sk-ant-"');
      return false;
    }
  } else if (provider === 'openai' || provider === 'chatgpt') {
    if (key && key.startsWith('sk-')) {
      CONFIG.OPENAI_API_KEY = key;
      localStorage.setItem('openai_api_key', key);
      console.log('✅ OpenAI API key saved successfully!');
      return true;
    } else {
      console.error('❌ Invalid OpenAI API key. It should start with "sk-"');
      return false;
    }
  } else if (provider === 'lunarcrush' || provider === 'lunar') {
    if (key && key.length > 10) {
      CONFIG.LUNARCRUSH_API_KEY = key;
      localStorage.setItem('lunarcrush_api_key', key);
      console.log('✅ LunarCrush API key saved successfully!');
      return true;
    } else {
      console.error('❌ Invalid LunarCrush API key.');
      return false;
    }
  } else if (provider === 'coinglass' || provider === 'cg') {
    if (key && key.length > 10) {
      CONFIG.COINGLASS_API_KEY = key;
      localStorage.setItem('coinglass_api_key', key);
      console.log('✅ Coinglass API key saved successfully!');
      return true;
    } else {
      console.error('❌ Invalid Coinglass API key.');
      return false;
    }
  } else if (provider === 'grok' || provider === 'xai') {
    if (key && key.startsWith('xai-')) {
      CONFIG.GROK_API_KEY = key;
      localStorage.setItem('grok_api_key', key);
      console.log('✅ Grok API key saved successfully!');
      return true;
    } else {
      console.error('❌ Invalid Grok API key. It should start with "xai-"');
      return false;
    }
  } else {
    console.error('❌ Unknown provider. Use "claude", "openai", "grok", "lunarcrush", or "coinglass"');
    console.log('Examples:');
    console.log('   setApiKey("claude", "sk-ant-...")');
    console.log('   setApiKey("openai", "sk-proj-...")');
    console.log('   setApiKey("grok", "xai-...")');
    console.log('   setApiKey("lunarcrush", "your-api-key")');
    console.log('   setApiKey("coinglass", "your-api-key")');
    return false;
  }
}

// Check if LunarCrush is configured
function isLunarCrushConfigured() {
  return CONFIG.LUNARCRUSH_API_KEY && CONFIG.LUNARCRUSH_API_KEY.length > 10;
}

// Check if Coinglass is configured
function isCoinglassConfigured() {
  return CONFIG.COINGLASS_API_KEY && CONFIG.COINGLASS_API_KEY.length > 10;
}

// Show API key status
function showApiKeyStatus() {
  console.log('🔑 API Key Status:');
  console.log('   ');
  console.log('   AI Services:');
  console.log('   Claude:', isClaudeConfigured() ? '✅ Configured' : '❌ Not configured');
  console.log('   OpenAI:', isOpenAIConfigured() ? '✅ Configured' : '❌ Not configured');
  console.log('   ');
  console.log('   Data Providers:');
  console.log('   LunarCrush:', isLunarCrushConfigured() ? '✅ Configured' : '⚪ Optional (social sentiment)');
  console.log('   Coinglass:', isCoinglassConfigured() ? '✅ Configured' : '⚪ Optional (liquidation data)');
  console.log('');
  console.log('To add/update keys, run:');
  console.log('   setApiKey("claude", "sk-ant-...")');
  console.log('   setApiKey("openai", "sk-...")');
  console.log('   setApiKey("lunarcrush", "your-api-key")  // Get at: lunarcrush.com/developers');
  console.log('   setApiKey("coinglass", "your-api-key")   // Get at: coinglass.com/api');
}

// State
const state = {
  markets: [],
  marketLoadStatus: 'idle',
  marketLoadError: null,
  signals: [], // Only used as fallback if AI not configured
  trades: [],
  aiSignals: [], // AI-generated signals (PRIMARY source)
  signalHistory: [], // Track all signals with timestamps for "New" tab
  selectedSymbol: 'BTCUSDT',
  currentTimeframe: '240',
  balance: 2000,
  startBalance: 2000,
  equityHistory: [{ time: Date.now(), value: 2000 }],
  priceCache: {},
  klineCache: {},
  previousHighConfSignals: new Set(),
  isScanning: false,
  isAiScanning: false,
  soundEnabled: true,
  showSR: true,
  showIndicators: false,
  showVolume: false,
  dataSource: 'binance',
  chart: null,
  candleSeries: null,
  volumeSeries: null,
  srLines: [], // Support/Resistance price lines
  userLines: [], // User-drawn lines
  equityChart: null,
  equitySeries: null,
  wsConnection: null,
  signalFilter: 'all',
  signalTab: 'new', // 'new' or 'all'
  nextAiScanTime: null,
  lastAiAnalysis: null,
  aiAutoTradeEnabled: true,
  drawingMode: null, // 'hline', 'trendline', null
  pendingLine: null, // For drawing trendlines
  // Enhanced features
  fundingRates: {}, // Symbol -> funding rate
  openInterest: {}, // Symbol -> OI data
  socialSentiment: {}, // Symbol -> LunarCrush data
  liquidationData: {}, // Symbol -> Coinglass liquidation data
  performanceStats: {
    totalTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    totalPnL: 0,
    claudeWins: 0,
    claudeLosses: 0,
    claudeSignals: 0,
    claudeTotalConf: 0,
    openaiWins: 0,
    openaiLosses: 0,
    openaiSignals: 0,
    openaiTotalConf: 0,
    grokWins: 0,
    grokLosses: 0,
    grokSignals: 0,
    grokTotalConf: 0,
    consensusWins: 0,
    consensusLosses: 0,
    goldConsensusWins: 0,
    goldConsensusLosses: 0,
    goldConsensusSignals: 0,
    silverConsensusWins: 0,
    silverConsensusLosses: 0,
    silverConsensusSignals: 0,
    largestWin: 0,
    largestLoss: 0,
    currentStreak: 0,
    maxDrawdown: 0,
    peakBalance: 2000
  },
  aiPredictions: [], // Track individual AI predictions for stats view
  aiDebugStatus: {
    claude: { status: 'idle', lastCall: null, lastError: null, callCount: 0, successCount: 0 },
    openai: { status: 'idle', lastCall: null, lastError: null, callCount: 0, successCount: 0 },
    grok: { status: 'idle', lastCall: null, lastError: null, callCount: 0, successCount: 0 }
  },
  soundEnabled: true,
  notificationsEnabled: false,
  signalBlockStats: {},
  lastSignalSummary: '',
  aiRejectionLog: []
};

const getAiWinRateForSource = (source) => {
  const stats = state.performanceStats;
  if (source === 'claude') {
    const total = stats.claudeWins + stats.claudeLosses;
    return total > 0 ? stats.claudeWins / total : 0.5;
  }
  if (source === 'openai') {
    const total = stats.openaiWins + stats.openaiLosses;
    return total > 0 ? stats.openaiWins / total : 0.5;
  }
  if (source === 'grok') {
    const total = stats.grokWins + stats.grokLosses;
    return total > 0 ? stats.grokWins / total : 0.5;
  }
  return 0.5;
};

const getAiSampleSize = (source) => {
  const stats = state.performanceStats;
  if (source === 'claude') return stats.claudeWins + stats.claudeLosses;
  if (source === 'openai') return stats.openaiWins + stats.openaiLosses;
  if (source === 'grok') return stats.grokWins + stats.grokLosses;
  return 0;
};

const isAiEligible = (source) => {
  const sampleSize = getAiSampleSize(source);
  if (sampleSize < 3) return true;
  return getAiWinRateForSource(source) >= CONFIG.MIN_AI_WINRATE;
};

const buildAiPerformanceContext = (source) => {
  const sampleSize = getAiSampleSize(source);
  const winRate = Math.round(getAiWinRateForSource(source) * 100);
  if (sampleSize === 0) {
    return 'Performance: No tracked trades yet.';
  }
  return `Performance: ${winRate}% win rate over ${sampleSize} tracked trades.`;
};

const normalizeAiPick = (pick) => {
  if (!pick || typeof pick !== 'object') return null;
  const entry = Number(pick.entry);
  const takeProfit = Number(pick.takeProfit);
  const stopLoss = Number(pick.stopLoss);
  const confidence = Number(pick.confidence);
  const direction = typeof pick.direction === 'string' ? pick.direction.toUpperCase() : '';
  const entryTrigger = normalizeEntryTrigger(pick.entryTrigger);

  if (!isValidNumber(entry) || !isValidNumber(takeProfit) || !isValidNumber(stopLoss)) return null;
  if (!isValidNumber(confidence)) return null;
  if (!['LONG', 'SHORT'].includes(direction)) return null;

  return {
    ...pick,
    entry,
    takeProfit,
    stopLoss,
    confidence,
    direction,
    entryTrigger: entryTrigger || null
  };
};

const recordSignalRejection = (reason) => {
  if (!reason) return;
  state.aiRejectionLog.unshift({ reason, timestamp: Date.now() });
  state.aiRejectionLog = state.aiRejectionLog.slice(0, 50);
};

const summarizeRejections = () => {
  if (state.aiRejectionLog.length === 0) return 'No recent rejection data.';
  const counts = state.aiRejectionLog.reduce((acc, item) => {
    acc[item.reason] = (acc[item.reason] || 0) + 1;
    return acc;
  }, {});
  const top = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([reason, count]) => `${reason} (${count})`)
    .join(', ');
  return `Recent rejection patterns: ${top}.`;
};

const computeSignalQuality = (signal, marketInfo) => {
  const components = [];
  const base = Math.min(100, Math.max(0, signal.confidence || 0));
  components.push(base * 0.45);

  const rr = signal.riskReward || 0;
  const rrScore = Math.min(100, rr * 20);
  components.push(rrScore * 0.15);

  const mtfScore = marketInfo?.mtfAnalysis?.confluenceScore || 0;
  components.push(Math.min(100, mtfScore) * 0.15);

  const volumeTrend = marketInfo?.volumeTrend || 'UNKNOWN';
  const volumeScore = volumeTrend === 'INCREASING' ? 100 : volumeTrend === 'STABLE' ? 70 : 40;
  components.push(volumeScore * 0.1);

  const atrPercent = marketInfo?.atrPercent ?? 0;
  const atrScore = atrPercent >= 1 ? 90 : atrPercent >= 0.6 ? 70 : 40;
  components.push(atrScore * 0.1);

  const regime = marketInfo?.marketRegime || 'UNKNOWN';
  const regimeScore = ['TRENDING_UP', 'TRENDING_DOWN'].includes(regime) ? 90 : regime === 'VOLATILE' ? 50 : 60;
  components.push(regimeScore * 0.05);

  return Math.round(components.reduce((sum, val) => sum + val, 0));
};

const recordFilterReason = (reason) => {
  if (!reason) return;
  state.signalBlockStats[reason] = (state.signalBlockStats[reason] || 0) + 1;
};

const summarizeFilterReasons = () => {
  const entries = Object.entries(state.signalBlockStats);
  if (entries.length === 0) return 'No signals met the quality filters yet.';
  const top = entries
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([reason, count]) => `${reason} (${count})`)
    .join(', ');
  return `Most common filters: ${top}.`;
};

const validateAiPick = (pick, marketInfo) => {
  const normalized = normalizeAiPick(pick);
  if (!normalized) return { valid: false, reason: 'Invalid shape' };
  if (normalized.confidence < 0 || normalized.confidence > 100) return { valid: false, reason: 'Confidence out of range' };

  const isLong = normalized.direction === 'LONG';
  if (isLong && !(normalized.stopLoss < normalized.entry && normalized.takeProfit > normalized.entry)) {
    return { valid: false, reason: 'Invalid long levels' };
  }
  if (!isLong && !(normalized.stopLoss > normalized.entry && normalized.takeProfit < normalized.entry)) {
    return { valid: false, reason: 'Invalid short levels' };
  }

  const risk = Math.abs(normalized.entry - normalized.stopLoss);
  const reward = Math.abs(normalized.takeProfit - normalized.entry);
  const riskReward = reward / Math.max(risk, 1e-9);
  if (riskReward < CONFIG.MIN_RISK_REWARD) {
    return { valid: false, reason: `RR ${riskReward.toFixed(2)} < ${CONFIG.MIN_RISK_REWARD}` };
  }

  if (marketInfo?.atrPercent !== undefined && marketInfo.atrPercent < CONFIG.MIN_ATR_PERCENT) {
    return { valid: false, reason: `ATR ${marketInfo.atrPercent.toFixed(2)}% too low` };
  }
  if (marketInfo?.volumeTrend === 'DECREASING') {
    return { valid: false, reason: 'Volume decreasing' };
  }
  const regime = marketInfo?.marketRegime;
  if (['RANGING', 'CHOPPY', 'SIDEWAYS', 'VOLATILE'].includes(regime)) {
    return { valid: false, reason: `Regime ${regime}` };
  }

  return { valid: true, pick: normalized };
};

// Utility Functions
const formatPrice = (price, decimals = 2) => {
  if (price >= 1000) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 1) return price.toFixed(decimals);
  if (price >= 0.01) return price.toFixed(4);
  return price.toFixed(6);
};

const formatVolume = (vol) => {
  if (vol >= 1e9) return (vol / 1e9).toFixed(1) + 'B';
  if (vol >= 1e6) return (vol / 1e6).toFixed(1) + 'M';
  if (vol >= 1e3) return (vol / 1e3).toFixed(1) + 'K';
  return vol.toFixed(0);
};

const formatPercent = (pct) => (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%';

const timeAgo = (timestamp) => {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const AI_ENTRY_TRIGGERS = ['BREAKOUT', 'PULLBACK', 'REVERSAL', 'MOMENTUM'];

const isValidNumber = (value) => Number.isFinite(value);

const normalizeEntryTrigger = (trigger) => {
  if (!trigger || typeof trigger !== 'string') return null;
  const normalized = trigger.trim().toUpperCase();
  return AI_ENTRY_TRIGGERS.includes(normalized) ? normalized : null;
};

const isWithinPercent = (a, b, percent) => {
  if (!isValidNumber(a) || !isValidNumber(b)) return false;
  const diff = Math.abs(a - b) / Math.max(a, b) * 100;
  return diff <= percent;
};

// ============================================
// DATA FETCHING WITH FALLBACK
// ============================================

async function fetchWithRetry(url, options = {}, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeoutId);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      if (i === retries - 1) throw error;
      await sleep(1000 * (i + 1));
    }
  }
}

// Blocked tickers (problematic or unwanted)
const BLOCKED_TICKERS = ['BNXUSDT', 'BNXUSDTPERP'];

// ============================================
// FUNDING RATES & OPEN INTEREST
// ============================================

async function fetchFundingRates() {
  try {
    const data = await fetchWithRetry(`${CONFIG.BINANCE_API}/fapi/v1/premiumIndex`);
    const rates = {};
    for (const item of data) {
      if (item.symbol.endsWith('USDT')) {
        rates[item.symbol] = {
          fundingRate: parseFloat(item.lastFundingRate) * 100, // Convert to percentage
          nextFundingTime: item.nextFundingTime,
          markPrice: parseFloat(item.markPrice),
          indexPrice: parseFloat(item.indexPrice)
        };
      }
    }
    state.fundingRates = rates;
    console.log('📊 Funding rates updated for', Object.keys(rates).length, 'symbols');
    return rates;
  } catch (error) {
    console.error('Failed to fetch funding rates:', error);
    return {};
  }
}

async function fetchOpenInterest(symbol) {
  try {
    const data = await fetchWithRetry(`${CONFIG.BINANCE_API}/fapi/v1/openInterest?symbol=${symbol}`);
    const oiValue = parseFloat(data.openInterest);

    // Get historical OI for comparison
    const histData = await fetchWithRetry(
      `${CONFIG.BINANCE_API}/futures/data/openInterestHist?symbol=${symbol}&period=1h&limit=24`
    );

    let oiChange = 0;
    if (histData && histData.length > 1) {
      const oldOI = parseFloat(histData[0].sumOpenInterest);
      const newOI = parseFloat(histData[histData.length - 1].sumOpenInterest);
      oiChange = ((newOI - oldOI) / oldOI) * 100;
    }

    state.openInterest[symbol] = {
      value: oiValue,
      change24h: oiChange,
      timestamp: Date.now()
    };

    return state.openInterest[symbol];
  } catch (error) {
    console.error(`Failed to fetch OI for ${symbol}:`, error);
    return null;
  }
}

// ============================================
// LUNARCRUSH API (SOCIAL SENTIMENT)
// ============================================

async function fetchSocialSentiment(symbol) {
  if (!isLunarCrushConfigured()) {
    return null;
  }

  try {
    // Convert symbol format (e.g., BTCUSDT -> BTC)
    const coin = symbol.replace('USDT', '').toLowerCase();

    const response = await fetch(`${CONFIG.LUNARCRUSH_API}/coins/${coin}/v1`, {
      headers: {
        'Authorization': `Bearer ${CONFIG.LUNARCRUSH_API_KEY}`
      }
    });

    if (!response.ok) {
      if (response.status === 429) {
        console.warn('LunarCrush rate limited');
        return null;
      }
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    if (!data || !data.data) {
      return null;
    }

    const coinData = data.data;

    state.socialSentiment[symbol] = {
      galaxyScore: coinData.galaxy_score || 0, // 0-100, overall score
      altRank: coinData.alt_rank || 999, // Lower is better
      socialVolume: coinData.social_volume_24h || 0,
      socialScore: coinData.social_score || 0,
      sentiment: coinData.average_sentiment || 50, // 0-100
      socialDominance: coinData.social_dominance || 0,
      newsVolume: coinData.news_24h || 0,
      marketDominance: coinData.market_dominance || 0,
      correlationRank: coinData.correlation_rank || 0,
      volatility: coinData.volatility || 0,
      // Calculated sentiment label
      sentimentLabel: coinData.average_sentiment > 65 ? 'BULLISH' :
                      coinData.average_sentiment < 35 ? 'BEARISH' : 'NEUTRAL',
      timestamp: Date.now()
    };

    return state.socialSentiment[symbol];
  } catch (error) {
    console.error(`Failed to fetch LunarCrush data for ${symbol}:`, error);
    return null;
  }
}

async function fetchBatchSocialSentiment(symbols) {
  if (!isLunarCrushConfigured()) {
    console.log('⚪ LunarCrush not configured - skipping social sentiment');
    return {};
  }

  console.log('🌙 Fetching social sentiment data...');

  // Fetch for top 10 symbols only to avoid rate limits
  const topSymbols = symbols.slice(0, 10);

  for (const symbol of topSymbols) {
    await fetchSocialSentiment(symbol);
    await sleep(100); // Rate limiting
  }

  console.log(`🌙 Social sentiment loaded for ${Object.keys(state.socialSentiment).length} coins`);
  return state.socialSentiment;
}

// ============================================
// COINGLASS API (LIQUIDATION DATA) - V4 API
// ============================================

// Helper to build Coinglass URL with CORS proxy
function getCoinglassUrl(endpoint) {
  const baseUrl = `${CONFIG.COINGLASS_API_BASE}${endpoint}`;
  // Use CORS proxy for browser requests
  return `${CONFIG.COINGLASS_PROXY}${encodeURIComponent(baseUrl)}`;
}

// Cache for coin-list data (to avoid repeated API calls)
let coinglassCoinListCache = null;
let coinglassCoinListCacheTime = 0;
const COINGLASS_CACHE_TTL = 60000; // 1 minute cache

async function fetchLiquidationData(symbol) {
  if (!isCoinglassConfigured()) {
    if (DEBUG_MODE) console.log('💧 [COINGLASS] Not configured');
    return null;
  }

  // Use coin-list endpoint (works with Hobbyist plan, other endpoints need upgrade)
  return await fetchFromCoinglassCoinList(symbol);
}

// Primary method: Use coin-list endpoint (works with Hobbyist plan)
async function fetchFromCoinglassCoinList(symbol) {
  try {
    const cleanSymbol = symbol.replace('USDT', '');
    const now = Date.now();

    // Check cache first to avoid rate limits
    if (coinglassCoinListCache && (now - coinglassCoinListCacheTime) < COINGLASS_CACHE_TTL) {
      const coinData = coinglassCoinListCache.find(d =>
        d.symbol?.toUpperCase() === cleanSymbol.toUpperCase()
      );
      if (coinData) {
        return parseCoinglassData(symbol, coinData);
      }
    }

    // Fetch fresh data
    const url = getCoinglassUrl('/futures/liquidation/coin-list');
    if (DEBUG_MODE) console.log(`💧 [COINGLASS] Fetching coin-list...`);

    const response = await fetch(url, {
      headers: {
        'CG-API-KEY': CONFIG.COINGLASS_API_KEY,
        'accept': 'application/json'
      }
    });

    if (!response.ok) {
      if (DEBUG_MODE) console.log(`💧 [COINGLASS] HTTP ${response.status}`);
      return null;
    }

    const data = await response.json();

    if (!data || (data.code !== '0' && data.code !== 0) || !data.data) {
      if (DEBUG_MODE) console.log(`💧 [COINGLASS] Invalid response:`, data?.msg || data);
      return null;
    }

    // Cache the response
    coinglassCoinListCache = Array.isArray(data.data) ? data.data : [];
    coinglassCoinListCacheTime = now;

    if (DEBUG_MODE) console.log(`💧 [COINGLASS] ✅ Loaded ${coinglassCoinListCache.length} coins from API`);

    // Find our symbol
    const coinData = coinglassCoinListCache.find(d =>
      d.symbol?.toUpperCase() === cleanSymbol.toUpperCase()
    );

    if (!coinData) {
      if (DEBUG_MODE) console.log(`💧 [COINGLASS] ${cleanSymbol} not found`);
      return null;
    }

    return parseCoinglassData(symbol, coinData);
  } catch (error) {
    if (DEBUG_MODE) console.error(`💧 [COINGLASS] Error:`, error);
    return null;
  }
}

// Parse Coinglass coin data
function parseCoinglassData(symbol, coinData) {
  // Coinglass API uses snake_case field names:
  // long_liquidation_usd_24h, short_liquidation_usd_24h, etc.

  // Parse 24h liquidation values (with fallbacks to shorter timeframes)
  const totalLongLiq = parseFloat(
    coinData.long_liquidation_usd_24h ||
    coinData.long_liquidation_usd_12h ||
    coinData.long_liquidation_usd_4h ||
    coinData.long_liquidation_usd_1h ||
    0
  );
  const totalShortLiq = parseFloat(
    coinData.short_liquidation_usd_24h ||
    coinData.short_liquidation_usd_12h ||
    coinData.short_liquidation_usd_4h ||
    coinData.short_liquidation_usd_1h ||
    0
  );

  // Calculate long/short percentage from liquidation amounts
  // (this endpoint doesn't have account ratio, so we derive from liquidations)
  const totalLiq = totalLongLiq + totalShortLiq;
  const longRate = totalLiq > 0 ? (totalLongLiq / totalLiq) * 100 : 50;
  const shortRate = totalLiq > 0 ? (totalShortLiq / totalLiq) * 100 : 50;

  state.liquidationData[symbol] = {
    longLiquidations24h: totalLongLiq,
    shortLiquidations24h: totalShortLiq,
    totalLiquidations24h: totalLongLiq + totalShortLiq,
    liqRatio: totalLongLiq > 0 ? totalShortLiq / totalLongLiq : 0,
    dominantSide: totalLongLiq > totalShortLiq ? 'LONGS_LIQUIDATED' : 'SHORTS_LIQUIDATED',
    priceImplication: totalLongLiq > totalShortLiq * 1.5 ? 'POTENTIAL_BOTTOM' :
                      totalShortLiq > totalLongLiq * 1.5 ? 'POTENTIAL_TOP' : 'NEUTRAL',
    // Add long/short ratio
    longShortRatio: shortRate > 0 ? longRate / shortRate : 1,
    longPercent: longRate,
    shortPercent: shortRate,
    crowdBias: longRate > 55 ? 'CROWDED_LONG' : shortRate > 55 ? 'CROWDED_SHORT' : 'BALANCED',
    timestamp: Date.now()
  };

  if (DEBUG_MODE && (totalLongLiq > 0 || totalShortLiq > 0)) {
    console.log(`💧 [COINGLASS] ${symbol}: Long=$${totalLongLiq.toFixed(0)}, Short=$${totalShortLiq.toFixed(0)}, L/S=${longRate.toFixed(0)}%/${shortRate.toFixed(0)}%`);
  }

  return state.liquidationData[symbol];
}

async function fetchLongShortRatio(symbol) {
  // Long/short ratio is already fetched with coin-list data in parseCoinglassData
  // Just return existing data if available
  if (state.liquidationData[symbol]?.longPercent) {
    return state.liquidationData[symbol];
  }

  // If no data yet, fetch via coin-list
  return await fetchFromCoinglassCoinList(symbol);
}

async function fetchBatchLiquidationData(symbols) {
  if (!isCoinglassConfigured()) {
    console.log('⚪ Coinglass not configured - skipping liquidation data');
    return {};
  }

  console.log('💧 Fetching liquidation data...');

  // Fetch coin-list once (it contains all coins)
  // First call will fetch and cache, subsequent calls use cache
  await fetchFromCoinglassCoinList(symbols[0]);

  // Now parse data for all requested symbols from cache
  for (const symbol of symbols.slice(0, 20)) {
    const cleanSymbol = symbol.replace('USDT', '');
    if (coinglassCoinListCache) {
      const coinData = coinglassCoinListCache.find(d =>
        d.symbol?.toUpperCase() === cleanSymbol.toUpperCase()
      );
      if (coinData) {
        parseCoinglassData(symbol, coinData);
      }
    }
  }

  console.log(`💧 Liquidation data loaded for ${Object.keys(state.liquidationData).length} coins`);
  return state.liquidationData;
}

// ============================================
// MULTI-TIMEFRAME ANALYSIS
// ============================================

async function analyzeMultiTimeframe(symbol) {
  const timeframes = ['15', '60', '240', 'D']; // 15m, 1H, 4H, 1D
  const analysis = {};

  for (const tf of timeframes) {
    try {
      const candles = await fetchKlines(symbol, tf, 150);
      if (candles.length < 50) continue;

      const closes = candles.map(c => c.close);
      const ema20 = calculateEMA(closes, 20);
      const ema50 = calculateEMA(closes, 50);
      const rsi = calculateRSI(closes);
      const currentPrice = closes[closes.length - 1];

      // Determine trend
      let trend = 'NEUTRAL';
      if (currentPrice > ema20 && ema20 > ema50) trend = 'BULLISH';
      else if (currentPrice < ema20 && ema20 < ema50) trend = 'BEARISH';

      analysis[tf] = {
        trend,
        rsi,
        priceVsEma20: ((currentPrice - ema20) / ema20 * 100).toFixed(2),
        emaAlignment: ema20 > ema50 ? 'BULLISH' : 'BEARISH'
      };

      await sleep(50); // Rate limiting
    } catch (error) {
      console.error(`MTF analysis failed for ${symbol} ${tf}:`, error);
    }
  }

  // Calculate confluence score
  const bullishCount = Object.values(analysis).filter(a => a.trend === 'BULLISH').length;
  const bearishCount = Object.values(analysis).filter(a => a.trend === 'BEARISH').length;

  return {
    timeframes: analysis,
    confluence: bullishCount > bearishCount ? 'BULLISH' : bearishCount > bullishCount ? 'BEARISH' : 'MIXED',
    confluenceScore: Math.max(bullishCount, bearishCount) / Object.keys(analysis).length * 100,
    alignment: bullishCount === Object.keys(analysis).length ? 'FULL_BULLISH' :
               bearishCount === Object.keys(analysis).length ? 'FULL_BEARISH' : 'PARTIAL'
  };
}

// ============================================
// SOUND & BROWSER NOTIFICATIONS
// ============================================

function playAlertSound(type = 'signal') {
  if (!state.soundEnabled) return;

  try {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    if (type === 'consensus') {
      // Special sound for consensus - ascending notes
      oscillator.frequency.setValueAtTime(523.25, audioContext.currentTime); // C5
      oscillator.frequency.setValueAtTime(659.25, audioContext.currentTime + 0.1); // E5
      oscillator.frequency.setValueAtTime(783.99, audioContext.currentTime + 0.2); // G5
      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.4);
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.4);
    } else if (type === 'win') {
      // Victory sound
      oscillator.frequency.setValueAtTime(440, audioContext.currentTime);
      oscillator.frequency.setValueAtTime(554.37, audioContext.currentTime + 0.1);
      oscillator.frequency.setValueAtTime(659.25, audioContext.currentTime + 0.2);
      gainNode.gain.setValueAtTime(0.2, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.3);
    } else if (type === 'loss') {
      // Loss sound - descending
      oscillator.frequency.setValueAtTime(440, audioContext.currentTime);
      oscillator.frequency.setValueAtTime(349.23, audioContext.currentTime + 0.15);
      gainNode.gain.setValueAtTime(0.2, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.3);
    } else {
      // Default signal sound
      oscillator.frequency.setValueAtTime(600, audioContext.currentTime);
      gainNode.gain.setValueAtTime(0.2, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.2);
    }
  } catch (e) {
    console.log('Audio not available');
  }
}

async function requestNotificationPermission() {
  if ('Notification' in window) {
    const permission = await Notification.requestPermission();
    state.notificationsEnabled = permission === 'granted';
    console.log('🔔 Notifications:', state.notificationsEnabled ? 'enabled' : 'disabled');
    return state.notificationsEnabled;
  }
  return false;
}

function sendBrowserNotification(title, body, options = {}) {
  if (!state.notificationsEnabled || !('Notification' in window)) return;

  try {
    const notification = new Notification(title, {
      body,
      icon: '📊',
      badge: '📈',
      tag: options.tag || 'sentient-trader',
      requireInteraction: options.important || false,
      ...options
    });

    notification.onclick = () => {
      window.focus();
      if (options.symbol) selectMarket(options.symbol);
      notification.close();
    };

    // Auto close after 10 seconds
    setTimeout(() => notification.close(), 10000);
  } catch (e) {
    console.error('Notification failed:', e);
  }
}

// ============================================
// PERFORMANCE TRACKING
// ============================================

function updatePerformanceStats(trade, pnl) {
  const stats = state.performanceStats;

  stats.totalTrades++;
  stats.totalPnL += pnl;

  if (pnl > 0) {
    stats.winningTrades++;
    stats.currentStreak = stats.currentStreak >= 0 ? stats.currentStreak + 1 : 1;
    if (pnl > stats.largestWin) stats.largestWin = pnl;

    // Track by AI source
    if (trade.isConsensus) stats.consensusWins++;
    else if (trade.aiSource === 'claude') stats.claudeWins++;
    else if (trade.aiSource === 'openai') stats.openaiWins++;
  } else {
    stats.losingTrades++;
    stats.currentStreak = stats.currentStreak <= 0 ? stats.currentStreak - 1 : -1;
    if (pnl < stats.largestLoss) stats.largestLoss = pnl;

    // Track by AI source
    if (trade.isConsensus) stats.consensusLosses++;
    else if (trade.aiSource === 'claude') stats.claudeLosses++;
    else if (trade.aiSource === 'openai') stats.openaiLosses++;
  }

  // Update peak balance and drawdown
  if (state.balance > stats.peakBalance) {
    stats.peakBalance = state.balance;
  }
  const currentDrawdown = ((stats.peakBalance - state.balance) / stats.peakBalance) * 100;
  if (currentDrawdown > stats.maxDrawdown) {
    stats.maxDrawdown = currentDrawdown;
  }

  // Save stats
  localStorage.setItem('performance_stats', JSON.stringify(stats));

  // Play sound
  playAlertSound(pnl > 0 ? 'win' : 'loss');

  return stats;
}

function loadPerformanceStats() {
  try {
    const saved = localStorage.getItem('performance_stats');
    if (saved) {
      state.performanceStats = { ...state.performanceStats, ...JSON.parse(saved) };
    }
  } catch (e) {
    console.error('Failed to load performance stats:', e);
  }
}

function getWinRate() {
  const { totalTrades, winningTrades } = state.performanceStats;
  return totalTrades > 0 ? ((winningTrades / totalTrades) * 100).toFixed(1) : '0.0';
}

function getAIPerformance(aiSource) {
  const stats = state.performanceStats;
  if (aiSource === 'claude') {
    const total = stats.claudeWins + stats.claudeLosses;
    return total > 0 ? ((stats.claudeWins / total) * 100).toFixed(1) : 'N/A';
  } else if (aiSource === 'openai') {
    const total = stats.openaiWins + stats.openaiLosses;
    return total > 0 ? ((stats.openaiWins / total) * 100).toFixed(1) : 'N/A';
  } else if (aiSource === 'consensus') {
    const total = stats.consensusWins + stats.consensusLosses;
    return total > 0 ? ((stats.consensusWins / total) * 100).toFixed(1) : 'N/A';
  }
  return 'N/A';
}

function updateAiPredictionStats(prediction, pnlPercent) {
  const stats = state.performanceStats;
  const isWin = pnlPercent > 0;

  if (prediction.isConsensus) {
    if (isWin) stats.consensusWins++;
    else stats.consensusLosses++;
  }
  if (prediction.isGoldConsensus) {
    if (isWin) stats.goldConsensusWins++;
    else stats.goldConsensusLosses++;
  }
  if (prediction.isSilverConsensus) {
    if (isWin) stats.silverConsensusWins++;
    else stats.silverConsensusLosses++;
  }

  prediction.aiSources.forEach(source => {
    if (source === 'claude') {
      if (isWin) stats.claudeWins++;
      else stats.claudeLosses++;
    } else if (source === 'openai') {
      if (isWin) stats.openaiWins++;
      else stats.openaiLosses++;
    } else if (source === 'grok') {
      if (isWin) stats.grokWins++;
      else stats.grokLosses++;
    }
  });

  localStorage.setItem('performance_stats', JSON.stringify(stats));
}

function evaluateAiPredictions(symbol, currentPrice) {
  const pending = state.aiPredictions.filter(pred => pred.status === 'pending' && pred.symbol === symbol);
  if (pending.length === 0) return;

  for (const pred of pending) {
    if (!pred.sl || !pred.tp) continue;
    const hitTP = pred.direction === 'LONG' ? currentPrice >= pred.tp : currentPrice <= pred.tp;
    const hitSL = pred.direction === 'LONG' ? currentPrice <= pred.sl : currentPrice >= pred.sl;
    if (!hitTP && !hitSL) continue;

    const pnlPercent = pred.direction === 'LONG'
      ? ((currentPrice - pred.entry) / pred.entry) * 100
      : ((pred.entry - currentPrice) / pred.entry) * 100;

    pred.status = hitTP ? 'win' : 'loss';
    pred.exitPrice = currentPrice;
    pred.closeTimestamp = Date.now();
    pred.pnlPercent = parseFloat(pnlPercent.toFixed(2));

    updateAiPredictionStats(pred, pred.pnlPercent);
  }

  renderAiPredictions();
}

// ============================================
// TRAILING STOP LOSS
// ============================================

function updateTrailingStop(trade, currentPrice) {
  if (!trade.trailingStop || !trade.trailingStop.enabled) return;

  const { trailPercent, activationPercent } = trade.trailingStop;
  const entryPrice = trade.entry;

  // Calculate current profit percentage
  const profitPercent = trade.direction === 'LONG'
    ? ((currentPrice - entryPrice) / entryPrice) * 100
    : ((entryPrice - currentPrice) / entryPrice) * 100;

  // Only activate trailing stop after reaching activation threshold
  if (profitPercent < activationPercent) return;

  // Calculate new stop loss
  let newStopLoss;
  if (trade.direction === 'LONG') {
    newStopLoss = currentPrice * (1 - trailPercent / 100);
    if (newStopLoss > trade.sl) {
      trade.sl = newStopLoss;
      console.log(`📈 Trailing stop updated for ${trade.symbol}: $${formatPrice(newStopLoss)}`);
    }
  } else {
    newStopLoss = currentPrice * (1 + trailPercent / 100);
    if (newStopLoss < trade.sl) {
      trade.sl = newStopLoss;
      console.log(`📉 Trailing stop updated for ${trade.symbol}: $${formatPrice(newStopLoss)}`);
    }
  }
}

// Binance API
async function fetchBinanceMarkets() {
  const data = await fetchWithRetry(`${CONFIG.BINANCE_API}/fapi/v1/ticker/24hr`);
  return data
    .filter(t => t.symbol.endsWith('USDT') && !t.symbol.includes('_') && !BLOCKED_TICKERS.includes(t.symbol))
    .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
    .slice(0, CONFIG.TOP_COINS)
    .map(t => ({
      symbol: t.symbol,
      price: parseFloat(t.lastPrice),
      change: parseFloat(t.priceChangePercent),
      volume: parseFloat(t.quoteVolume),
      high: parseFloat(t.highPrice),
      low: parseFloat(t.lowPrice)
    }));
}

// Bybit API (Backup)
async function fetchBybitMarkets() {
  const data = await fetchWithRetry(`${CONFIG.BYBIT_API}/v5/market/tickers?category=linear`);
  return data.result.list
    .filter(t => t.symbol.endsWith('USDT') && !BLOCKED_TICKERS.includes(t.symbol))
    .sort((a, b) => parseFloat(b.turnover24h) - parseFloat(a.turnover24h))
    .slice(0, CONFIG.TOP_COINS)
    .map(t => ({
      symbol: t.symbol,
      price: parseFloat(t.lastPrice),
      change: parseFloat(t.price24hPcnt) * 100,
      volume: parseFloat(t.turnover24h),
      high: parseFloat(t.highPrice24h),
      low: parseFloat(t.lowPrice24h)
    }));
}

// Fetch markets with fallback
async function fetchMarkets() {
  state.marketLoadStatus = 'loading';
  state.marketLoadError = null;
  try {
    const markets = await fetchBinanceMarkets();
    state.dataSource = 'binance';
    updateDataSource('Binance', true);
    state.marketLoadStatus = 'ready';
    return markets;
  } catch (error) {
    console.warn('Binance failed, trying Bybit...', error);
    try {
      const markets = await fetchBybitMarkets();
      state.dataSource = 'bybit';
      updateDataSource('Bybit', true);
      state.marketLoadStatus = 'ready';
      return markets;
    } catch (error2) {
      console.error('All exchanges failed:', error2);
      updateDataSource('Offline', false);
      state.marketLoadStatus = 'error';
      state.marketLoadError = 'Unable to load markets. Check your connection or exchange access.';
      return [];
    }
  }
}

// Fetch Klines
async function fetchKlines(symbol, interval = '240', limit = 200) {
  const cacheKey = `${symbol}_${interval}`;
  const cached = state.klineCache[cacheKey];
  if (cached && Date.now() - cached.timestamp < CONFIG.CACHE_TTL) {
    return cached.data;
  }

  try {
    let data;
    if (state.dataSource === 'binance') {
      const intervalMap = { '5': '5m', '15': '15m', '60': '1h', '240': '4h', 'D': '1d' };
      data = await fetchWithRetry(
        `${CONFIG.BINANCE_API}/fapi/v1/klines?symbol=${symbol}&interval=${intervalMap[interval]}&limit=${limit}`
      );
      data = data.map(k => ({
        time: Math.floor(k[0] / 1000),
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5])
      }));
    } else {
      const intervalMap = { '5': '5', '15': '15', '60': '60', '240': '240', 'D': 'D' };
      const response = await fetchWithRetry(
        `${CONFIG.BYBIT_API}/v5/market/kline?category=linear&symbol=${symbol}&interval=${intervalMap[interval]}&limit=${limit}`
      );
      data = response.result.list.reverse().map(k => ({
        time: Math.floor(parseInt(k[0]) / 1000),
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5])
      }));
    }

    state.klineCache[cacheKey] = { data, timestamp: Date.now() };
    return data;
  } catch (error) {
    console.error(`Failed to fetch klines for ${symbol}:`, error);
    return cached?.data || [];
  }
}

// ============================================
// TECHNICAL INDICATORS
// ============================================

function calculateRSI(closes, period = 14) {
  if (closes.length < period + 1) return 50;

  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (change > 0 ? change : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (change < 0 ? -change : 0)) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calculateEMA(data, period) {
  if (data.length < period) return data[data.length - 1] || 0;
  const k = 2 / (period + 1);
  let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < data.length; i++) {
    ema = data[i] * k + ema * (1 - k);
  }
  return ema;
}

function calculateMACD(closes) {
  if (closes.length < 26) return { macd: 0, signal: 0, histogram: 0 };

  const ema12 = calculateEMA(closes, 12);
  const ema26 = calculateEMA(closes, 26);
  const macd = ema12 - ema26;

  const macdLine = [];
  for (let i = 26; i <= closes.length; i++) {
    const e12 = calculateEMA(closes.slice(0, i), 12);
    const e26 = calculateEMA(closes.slice(0, i), 26);
    macdLine.push(e12 - e26);
  }

  const signal = macdLine.length >= 9 ? calculateEMA(macdLine, 9) : macd;
  return { macd, signal, histogram: macd - signal };
}

function calculateBollingerBands(closes, period = 20, stdDev = 2) {
  if (closes.length < period) return { upper: 0, middle: 0, lower: 0 };

  const slice = closes.slice(-period);
  const middle = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((sum, val) => sum + Math.pow(val - middle, 2), 0) / period;
  const std = Math.sqrt(variance);

  return { upper: middle + std * stdDev, middle, lower: middle - std * stdDev };
}

function calculateATR(candles, period = 14) {
  if (candles.length < period + 1) return 0;

  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trs.push(tr);
  }

  return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
}

// ADX - Average Directional Index (Trend Strength)
// ADX > 25 = Strong trend, ADX < 20 = Weak/No trend
// Uses Wilder smoothing for accurate ADX calculation
function calculateADX(candles, period = 14) {
  if (candles.length < period * 2) return { adx: 0, plusDI: 0, minusDI: 0, trend: 'WEAK' };

  const plusDMs = [];
  const minusDMs = [];
  const trs = [];

  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevHigh = candles[i - 1].high;
    const prevLow = candles[i - 1].low;
    const prevClose = candles[i - 1].close;

    // True Range
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trs.push(tr);

    // Directional Movement
    const plusDM = high - prevHigh > prevLow - low ? Math.max(high - prevHigh, 0) : 0;
    const minusDM = prevLow - low > high - prevHigh ? Math.max(prevLow - low, 0) : 0;
    plusDMs.push(plusDM);
    minusDMs.push(minusDM);
  }

  // Use Wilder smoothing (exponential moving average with alpha = 1/period)
  let smoothedTR = trs.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothedPlusDM = plusDMs.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothedMinusDM = minusDMs.slice(0, period).reduce((a, b) => a + b, 0);

  const dxValues = [];

  for (let i = period; i < trs.length; i++) {
    // Wilder smoothing: smoothed = prev - (prev/period) + current
    smoothedTR = smoothedTR - (smoothedTR / period) + trs[i];
    smoothedPlusDM = smoothedPlusDM - (smoothedPlusDM / period) + plusDMs[i];
    smoothedMinusDM = smoothedMinusDM - (smoothedMinusDM / period) + minusDMs[i];

    const plusDI = smoothedTR > 0 ? (smoothedPlusDM / smoothedTR) * 100 : 0;
    const minusDI = smoothedTR > 0 ? (smoothedMinusDM / smoothedTR) * 100 : 0;

    const diDiff = Math.abs(plusDI - minusDI);
    const diSum = plusDI + minusDI;
    const dx = diSum > 0 ? (diDiff / diSum) * 100 : 0;
    dxValues.push({ dx, plusDI, minusDI });
  }

  if (dxValues.length < period) {
    const last = dxValues[dxValues.length - 1] || { dx: 0, plusDI: 0, minusDI: 0 };
    return { adx: Math.round(last.dx * 10) / 10, plusDI: Math.round(last.plusDI * 10) / 10, minusDI: Math.round(last.minusDI * 10) / 10, trend: 'WEAK' };
  }

  // Calculate ADX as smoothed average of DX values
  let adx = dxValues.slice(0, period).reduce((a, b) => a + b.dx, 0) / period;
  for (let i = period; i < dxValues.length; i++) {
    adx = ((adx * (period - 1)) + dxValues[i].dx) / period;
  }

  const lastDI = dxValues[dxValues.length - 1];
  const plusDI = lastDI.plusDI;
  const minusDI = lastDI.minusDI;

  // Determine trend strength
  let trend = 'WEAK';
  if (adx >= 50) trend = 'VERY_STRONG';
  else if (adx >= 25) trend = 'STRONG';
  else if (adx >= 20) trend = 'MODERATE';

  return { adx: Math.round(adx * 10) / 10, plusDI: Math.round(plusDI * 10) / 10, minusDI: Math.round(minusDI * 10) / 10, trend };
}

// Stochastic RSI - Better overbought/oversold than regular RSI
// %K is the raw stochastic RSI, %D is a 3-period SMA of %K for signal smoothing
function calculateStochRSI(closes, rsiPeriod = 14, stochPeriod = 14, kSmooth = 3, dSmooth = 3) {
  if (closes.length < rsiPeriod + stochPeriod + kSmooth) return { k: 50, d: 50, signal: 'NEUTRAL' };

  // Calculate RSI values for each point
  const rsiValues = [];
  for (let i = rsiPeriod; i <= closes.length; i++) {
    const slice = closes.slice(i - rsiPeriod - 1, i);
    let gains = 0, losses = 0;
    for (let j = 1; j < slice.length; j++) {
      const change = slice[j] - slice[j - 1];
      if (change > 0) gains += change;
      else losses -= change;
    }
    const avgGain = gains / rsiPeriod;
    const avgLoss = losses / rsiPeriod;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsiValues.push(100 - (100 / (1 + rs)));
  }

  if (rsiValues.length < stochPeriod + kSmooth) return { k: 50, d: 50, signal: 'NEUTRAL' };

  // Calculate raw stochastic RSI values
  const stochRSIValues = [];
  for (let i = stochPeriod; i <= rsiValues.length; i++) {
    const recentRSI = rsiValues.slice(i - stochPeriod, i);
    const minRSI = Math.min(...recentRSI);
    const maxRSI = Math.max(...recentRSI);
    const currentRSI = recentRSI[recentRSI.length - 1];
    const stochRSI = maxRSI - minRSI > 0 ? ((currentRSI - minRSI) / (maxRSI - minRSI)) * 100 : 50;
    stochRSIValues.push(stochRSI);
  }

  if (stochRSIValues.length < kSmooth) return { k: 50, d: 50, signal: 'NEUTRAL' };

  // Calculate %K as SMA of raw stochastic RSI (smoothed K)
  const kValues = [];
  for (let i = kSmooth; i <= stochRSIValues.length; i++) {
    const kSlice = stochRSIValues.slice(i - kSmooth, i);
    const kVal = kSlice.reduce((a, b) => a + b, 0) / kSmooth;
    kValues.push(kVal);
  }

  if (kValues.length < dSmooth) return { k: 50, d: 50, signal: 'NEUTRAL' };

  // Calculate %D as SMA of %K values
  const recentK = kValues.slice(-dSmooth);
  const d = recentK.reduce((a, b) => a + b, 0) / dSmooth;
  const k = kValues[kValues.length - 1];

  const kRounded = Math.round(k * 10) / 10;
  const dRounded = Math.round(d * 10) / 10;

  // Signal interpretation - now considers K/D crossover
  let signal = 'NEUTRAL';
  if (kRounded <= 20) signal = 'OVERSOLD';
  else if (kRounded >= 80) signal = 'OVERBOUGHT';
  else if (kRounded > 50 && kRounded > dRounded) signal = 'BULLISH';
  else if (kRounded < 50 && kRounded < dRounded) signal = 'BEARISH';

  return { k: kRounded, d: dRounded, signal };
}

// Supertrend - Clear trend direction indicator
function calculateSupertrend(candles, period = 10, multiplier = 3) {
  if (candles.length < period + 1) return { supertrend: 0, direction: 'NEUTRAL', signal: 'HOLD' };

  const atr = calculateATR(candles, period);
  const lastCandle = candles[candles.length - 1];
  const hl2 = (lastCandle.high + lastCandle.low) / 2;

  // Basic Bands
  const upperBand = hl2 + (multiplier * atr);
  const lowerBand = hl2 - (multiplier * atr);

  // Determine trend direction based on close vs bands
  const close = lastCandle.close;
  const prevClose = candles[candles.length - 2]?.close || close;

  let direction = 'UP';
  let supertrend = lowerBand;

  if (close < lowerBand) {
    direction = 'DOWN';
    supertrend = upperBand;
  } else if (close > upperBand) {
    direction = 'UP';
    supertrend = lowerBand;
  } else {
    // Price within bands - use previous trend
    direction = prevClose > hl2 ? 'UP' : 'DOWN';
    supertrend = direction === 'UP' ? lowerBand : upperBand;
  }

  // Signal
  let signal = 'HOLD';
  if (direction === 'UP' && close > supertrend) signal = 'BUY';
  else if (direction === 'DOWN' && close < supertrend) signal = 'SELL';

  return {
    supertrend: Math.round(supertrend * 100) / 100,
    direction,
    signal,
    upperBand: Math.round(upperBand * 100) / 100,
    lowerBand: Math.round(lowerBand * 100) / 100
  };
}

// ============================================
// USDT DOMINANCE (Market Sentiment Indicator)
// ============================================
// USDT.D falling = money flowing into crypto = BULLISH
// USDT.D rising = money flowing into stablecoins = BEARISH

let usdtDominanceData = {
  current: null,
  change24h: null,
  trend: null,
  signal: null,
  lastUpdate: 0
};

async function fetchUSDTDominance() {
  // Cache for 5 minutes
  if (Date.now() - usdtDominanceData.lastUpdate < 300000 && usdtDominanceData.current) {
    return usdtDominanceData;
  }

  try {
    // Fetch from CoinGecko global data
    const response = await fetch('https://api.coingecko.com/api/v3/global');
    const data = await response.json();

    if (data?.data?.market_cap_percentage?.usdt) {
      const current = data.data.market_cap_percentage.usdt;
      const previousCurrent = usdtDominanceData.current;

      // Calculate change if we have previous data
      let change24h = 0;
      if (previousCurrent && previousCurrent !== current) {
        change24h = ((current - previousCurrent) / previousCurrent * 100);
      }

      // Determine trend and signal
      let trend = 'NEUTRAL';
      let signal = 'NEUTRAL';

      if (current > 6.5) {
        trend = 'HIGH';
        signal = 'BEARISH'; // High USDT.D = risk-off
      } else if (current < 5.5) {
        trend = 'LOW';
        signal = 'BULLISH'; // Low USDT.D = risk-on
      } else {
        trend = 'NORMAL';
      }

      // If USDT.D is dropping, it's bullish for crypto
      if (change24h < -0.5) {
        signal = 'BULLISH';
      } else if (change24h > 0.5) {
        signal = 'BEARISH';
      }

      usdtDominanceData = {
        current: Math.round(current * 100) / 100,
        change24h: Math.round(change24h * 100) / 100,
        trend,
        signal,
        lastUpdate: Date.now()
      };

      console.log(`📊 USDT.D: ${current.toFixed(2)}% | Trend: ${trend} | Signal: ${signal}`);
    }
  } catch (error) {
    console.log('USDT.D fetch failed:', error.message);
  }

  return usdtDominanceData;
}

// ============================================
// FIBONACCI RETRACEMENT
// ============================================
// Key levels: 0.236, 0.382, 0.5, 0.618, 0.786

function calculateFibonacciLevels(candles, lookback = 50) {
  if (candles.length < lookback) return null;

  const recent = candles.slice(-lookback);

  // Find swing high and swing low
  let swingHigh = -Infinity;
  let swingLow = Infinity;
  let swingHighIdx = 0;
  let swingLowIdx = 0;

  for (let i = 0; i < recent.length; i++) {
    if (recent[i].high > swingHigh) {
      swingHigh = recent[i].high;
      swingHighIdx = i;
    }
    if (recent[i].low < swingLow) {
      swingLow = recent[i].low;
      swingLowIdx = i;
    }
  }

  const range = swingHigh - swingLow;
  const currentPrice = recent[recent.length - 1].close;

  // Determine if we're in uptrend or downtrend based on swing positions
  const isUptrend = swingLowIdx < swingHighIdx;

  // Calculate Fibonacci levels
  let levels;
  if (isUptrend) {
    // In uptrend, retracement from high
    levels = {
      level_0: swingHigh,
      level_236: swingHigh - range * 0.236,
      level_382: swingHigh - range * 0.382,
      level_500: swingHigh - range * 0.5,
      level_618: swingHigh - range * 0.618,
      level_786: swingHigh - range * 0.786,
      level_1: swingLow
    };
  } else {
    // In downtrend, retracement from low
    levels = {
      level_0: swingLow,
      level_236: swingLow + range * 0.236,
      level_382: swingLow + range * 0.382,
      level_500: swingLow + range * 0.5,
      level_618: swingLow + range * 0.618,
      level_786: swingLow + range * 0.786,
      level_1: swingHigh
    };
  }

  // Find nearest Fibonacci level to current price
  const allLevels = [
    { name: '0%', price: levels.level_0 },
    { name: '23.6%', price: levels.level_236 },
    { name: '38.2%', price: levels.level_382 },
    { name: '50%', price: levels.level_500 },
    { name: '61.8%', price: levels.level_618 },
    { name: '78.6%', price: levels.level_786 },
    { name: '100%', price: levels.level_1 }
  ];

  let nearestLevel = allLevels[0];
  let minDist = Math.abs(currentPrice - allLevels[0].price);

  for (const level of allLevels) {
    const dist = Math.abs(currentPrice - level.price);
    if (dist < minDist) {
      minDist = dist;
      nearestLevel = level;
    }
  }

  // Determine if price is at a key level (within 1%)
  const atKeyLevel = (minDist / currentPrice * 100) < 1;

  // Find support and resistance from Fib levels
  const fibSupport = allLevels.filter(l => l.price < currentPrice).sort((a, b) => b.price - a.price)[0];
  const fibResistance = allLevels.filter(l => l.price > currentPrice).sort((a, b) => a.price - b.price)[0];

  return {
    swingHigh: Math.round(swingHigh * 100) / 100,
    swingLow: Math.round(swingLow * 100) / 100,
    isUptrend,
    levels: {
      '0%': Math.round(levels.level_0 * 100) / 100,
      '23.6%': Math.round(levels.level_236 * 100) / 100,
      '38.2%': Math.round(levels.level_382 * 100) / 100,
      '50%': Math.round(levels.level_500 * 100) / 100,
      '61.8%': Math.round(levels.level_618 * 100) / 100,
      '78.6%': Math.round(levels.level_786 * 100) / 100,
      '100%': Math.round(levels.level_1 * 100) / 100
    },
    nearestLevel: nearestLevel.name,
    nearestPrice: Math.round(nearestLevel.price * 100) / 100,
    atKeyLevel,
    fibSupport: fibSupport ? { level: fibSupport.name, price: Math.round(fibSupport.price * 100) / 100 } : null,
    fibResistance: fibResistance ? { level: fibResistance.name, price: Math.round(fibResistance.price * 100) / 100 } : null
  };
}

// ============================================
// TREND STRUCTURE (Higher Highs/Lows, Lower Highs/Lows)
// ============================================

function analyzeTrendStructure(candles, lookback = 30) {
  if (candles.length < lookback) return null;

  const recent = candles.slice(-lookback);
  const swingPoints = [];

  // Find swing highs and lows
  for (let i = 2; i < recent.length - 2; i++) {
    const curr = recent[i];
    // Swing High
    if (curr.high > recent[i-1].high && curr.high > recent[i-2].high &&
        curr.high > recent[i+1].high && curr.high > recent[i+2].high) {
      swingPoints.push({ type: 'HIGH', price: curr.high, index: i });
    }
    // Swing Low
    if (curr.low < recent[i-1].low && curr.low < recent[i-2].low &&
        curr.low < recent[i+1].low && curr.low < recent[i+2].low) {
      swingPoints.push({ type: 'LOW', price: curr.low, index: i });
    }
  }

  if (swingPoints.length < 4) return { structure: 'UNDEFINED', swingPoints: [] };

  // Analyze the last 4 swing points
  const recentSwings = swingPoints.slice(-4);
  const highs = recentSwings.filter(s => s.type === 'HIGH').map(s => s.price);
  const lows = recentSwings.filter(s => s.type === 'LOW').map(s => s.price);

  let structure = 'RANGING';
  let structureBreak = null;

  // Check for Higher Highs and Higher Lows (Uptrend)
  const hasHigherHighs = highs.length >= 2 && highs[highs.length - 1] > highs[highs.length - 2];
  const hasHigherLows = lows.length >= 2 && lows[lows.length - 1] > lows[lows.length - 2];

  // Check for Lower Highs and Lower Lows (Downtrend)
  const hasLowerHighs = highs.length >= 2 && highs[highs.length - 1] < highs[highs.length - 2];
  const hasLowerLows = lows.length >= 2 && lows[lows.length - 1] < lows[lows.length - 2];

  if (hasHigherHighs && hasHigherLows) {
    structure = 'UPTREND';
  } else if (hasLowerHighs && hasLowerLows) {
    structure = 'DOWNTREND';
  } else if (hasHigherHighs && hasLowerLows) {
    structure = 'EXPANDING'; // Volatility expansion
  } else if (hasLowerHighs && hasHigherLows) {
    structure = 'CONTRACTING'; // Volatility contraction (triangle/wedge)
  }

  // Check for Break of Structure (BOS)
  const currentPrice = recent[recent.length - 1].close;
  const lastSwingHigh = highs.length > 0 ? Math.max(...highs.slice(-2)) : null;
  const lastSwingLow = lows.length > 0 ? Math.min(...lows.slice(-2)) : null;

  if (lastSwingHigh && currentPrice > lastSwingHigh) {
    structureBreak = 'BULLISH_BOS';
  } else if (lastSwingLow && currentPrice < lastSwingLow) {
    structureBreak = 'BEARISH_BOS';
  }

  return {
    structure,
    hasHigherHighs,
    hasHigherLows,
    hasLowerHighs,
    hasLowerLows,
    structureBreak,
    lastSwingHigh: lastSwingHigh ? Math.round(lastSwingHigh * 100) / 100 : null,
    lastSwingLow: lastSwingLow ? Math.round(lastSwingLow * 100) / 100 : null,
    swingCount: swingPoints.length
  };
}

// ============================================
// CONFLUENCE SCORING SYSTEM
// ============================================
// Combines multiple indicators to score trade quality

function calculateConfluenceScore(data) {
  let bullishScore = 0;
  let bearishScore = 0;
  const signals = [];

  // 1. Trend Direction (weight: 2)
  if (data.trend === 'STRONG UPTREND') { bullishScore += 2; signals.push('Strong Uptrend'); }
  else if (data.trend === 'STRONG DOWNTREND') { bearishScore += 2; signals.push('Strong Downtrend'); }
  else if (data.trend === 'WEAK UPTREND') { bullishScore += 1; }
  else if (data.trend === 'WEAK DOWNTREND') { bearishScore += 1; }

  // 2. RSI (weight: 1.5)
  if (data.rsi < 30) { bullishScore += 1.5; signals.push('RSI Oversold'); }
  else if (data.rsi > 70) { bearishScore += 1.5; signals.push('RSI Overbought'); }
  else if (data.rsi < 40) { bullishScore += 0.5; }
  else if (data.rsi > 60) { bearishScore += 0.5; }

  // 3. Stochastic RSI (weight: 1.5)
  if (data.stochRsi?.signal === 'OVERSOLD') { bullishScore += 1.5; signals.push('StochRSI Oversold'); }
  else if (data.stochRsi?.signal === 'OVERBOUGHT') { bearishScore += 1.5; signals.push('StochRSI Overbought'); }

  // 4. ADX Trend Strength (weight: 1)
  if (data.adx?.adx >= 25) {
    if (data.adx?.plusDI > data.adx?.minusDI) { bullishScore += 1; signals.push('ADX Bullish'); }
    else { bearishScore += 1; signals.push('ADX Bearish'); }
  }

  // 5. Supertrend (weight: 1.5)
  if (data.supertrend?.direction === 'UP') { bullishScore += 1.5; signals.push('Supertrend UP'); }
  else if (data.supertrend?.direction === 'DOWN') { bearishScore += 1.5; signals.push('Supertrend DOWN'); }

  // 6. Funding Rate (weight: 1) - Contrarian
  const funding = state.fundingRates[data.symbol];
  if (funding?.fundingRate > 0.01) {
    bearishScore += 1; // Crowded longs = bearish
    signals.push('High Funding (Crowded Longs)');
  } else if (funding?.fundingRate < -0.01) {
    bullishScore += 1; // Crowded shorts = bullish
    signals.push('Negative Funding (Crowded Shorts)');
  }

  // 7. USDT.D Sentiment (weight: 1)
  if (usdtDominanceData.signal === 'BULLISH') { bullishScore += 1; signals.push('USDT.D Bullish'); }
  else if (usdtDominanceData.signal === 'BEARISH') { bearishScore += 1; signals.push('USDT.D Bearish'); }

  // 8. Fibonacci Level (weight: 1)
  if (data.fibonacci?.atKeyLevel) {
    if (data.fibonacci.isUptrend && data.fibonacci.nearestLevel === '61.8%') {
      bullishScore += 1; signals.push('At Fib 61.8% Support');
    } else if (!data.fibonacci.isUptrend && data.fibonacci.nearestLevel === '61.8%') {
      bearishScore += 1; signals.push('At Fib 61.8% Resistance');
    }
  }

  // 9. Trend Structure (weight: 1.5)
  if (data.trendStructure?.structure === 'UPTREND') { bullishScore += 1.5; signals.push('HH/HL Structure'); }
  else if (data.trendStructure?.structure === 'DOWNTREND') { bearishScore += 1.5; signals.push('LH/LL Structure'); }

  // 10. Break of Structure (weight: 2)
  if (data.trendStructure?.structureBreak === 'BULLISH_BOS') { bullishScore += 2; signals.push('Bullish BOS'); }
  else if (data.trendStructure?.structureBreak === 'BEARISH_BOS') { bearishScore += 2; signals.push('Bearish BOS'); }

  // Calculate overall score and direction
  const totalScore = Math.max(bullishScore, bearishScore);
  const maxPossibleScore = 15; // Sum of all weights
  const confluencePercent = Math.round((totalScore / maxPossibleScore) * 100);

  const direction = bullishScore > bearishScore ? 'BULLISH' :
                    bearishScore > bullishScore ? 'BEARISH' : 'NEUTRAL';

  // Quality rating
  let quality = 'LOW';
  if (confluencePercent >= 60) quality = 'HIGH';
  else if (confluencePercent >= 40) quality = 'MEDIUM';

  return {
    direction,
    bullishScore: Math.round(bullishScore * 10) / 10,
    bearishScore: Math.round(bearishScore * 10) / 10,
    confluencePercent,
    quality,
    signals: signals.slice(0, 5) // Top 5 signals
  };
}

// ============================================
// MULTI-TIMEFRAME RSI ANALYSIS
// ============================================

async function analyzeMultiTimeframeRSI(symbol) {
  const timeframes = {
    '60': '1H',
    '240': '4H',
    'D': '1D'
  };

  const rsiData = {};
  let overboughtCount = 0;
  let oversoldCount = 0;

  for (const [interval, label] of Object.entries(timeframes)) {
    try {
      const candles = await fetchKlines(symbol, interval, 50);
      if (candles.length < 20) continue;

      const closes = candles.map(c => c.close);
      const rsi = calculateRSI(closes);

      rsiData[label] = {
        value: Math.round(rsi * 10) / 10,
        status: rsi > 70 ? 'OVERBOUGHT' : rsi < 30 ? 'OVERSOLD' : 'NEUTRAL'
      };

      if (rsi > 70) overboughtCount++;
      if (rsi < 30) oversoldCount++;

      await sleep(30);
    } catch (e) {
      console.log(`RSI fetch failed for ${symbol} ${label}`);
    }
  }

  // Determine confluence
  let confluence = 'MIXED';
  if (overboughtCount >= 2) confluence = 'OVERBOUGHT_CONFLUENCE';
  else if (oversoldCount >= 2) confluence = 'OVERSOLD_CONFLUENCE';

  return {
    timeframes: rsiData,
    confluence,
    overboughtCount,
    oversoldCount
  };
}

function findSupportResistance(candles, lookback = 50) {
  if (candles.length < lookback) return { supports: [], resistances: [] };

  const recent = candles.slice(-lookback);
  const swingHighs = [];
  const swingLows = [];

  for (let i = 2; i < recent.length - 2; i++) {
    const curr = recent[i];
    if (curr.high > recent[i-1].high && curr.high > recent[i-2].high &&
        curr.high > recent[i+1].high && curr.high > recent[i+2].high) {
      swingHighs.push(curr.high);
    }
    if (curr.low < recent[i-1].low && curr.low < recent[i-2].low &&
        curr.low < recent[i+1].low && curr.low < recent[i+2].low) {
      swingLows.push(curr.low);
    }
  }

  const clusterLevels = (levels, threshold = 0.005) => {
    const clusters = [];
    levels.sort((a, b) => a - b);

    for (const level of levels) {
      const existing = clusters.find(c => Math.abs(c.price - level) / level < threshold);
      if (existing) {
        existing.count++;
        existing.price = (existing.price + level) / 2;
      } else {
        clusters.push({ price: level, count: 1 });
      }
    }

    return clusters.sort((a, b) => b.count - a.count).slice(0, 3).map(c => c.price);
  };

  return { supports: clusterLevels(swingLows), resistances: clusterLevels(swingHighs) };
}

// ============================================
// ADVANCED INDICATORS (VWAP, Order Blocks, Pivot Points)
// ============================================

// Calculate VWAP (Volume Weighted Average Price)
function calculateVWAP(candles) {
  if (!candles || candles.length < 10) return { vwap: 0, upperBand: 0, lowerBand: 0, deviation: 0 };

  let cumulativeTPV = 0; // Cumulative (Typical Price * Volume)
  let cumulativeVolume = 0;
  const vwapValues = [];

  for (const candle of candles) {
    const typicalPrice = (candle.high + candle.low + candle.close) / 3;
    cumulativeTPV += typicalPrice * candle.volume;
    cumulativeVolume += candle.volume;
    vwapValues.push(cumulativeTPV / cumulativeVolume);
  }

  const vwap = vwapValues[vwapValues.length - 1];

  // Calculate standard deviation for bands
  let sumSquaredDiff = 0;
  for (let i = 0; i < candles.length; i++) {
    const typicalPrice = (candles[i].high + candles[i].low + candles[i].close) / 3;
    sumSquaredDiff += Math.pow(typicalPrice - vwapValues[i], 2);
  }
  const stdDev = Math.sqrt(sumSquaredDiff / candles.length);

  const currentPrice = candles[candles.length - 1].close;
  const deviation = ((currentPrice - vwap) / vwap) * 100;

  return {
    vwap,
    upperBand: vwap + (2 * stdDev),
    lowerBand: vwap - (2 * stdDev),
    deviation, // Positive = above VWAP, Negative = below VWAP
    pricePosition: currentPrice > vwap ? 'ABOVE_VWAP' : 'BELOW_VWAP',
    isExtended: Math.abs(deviation) > 3 // Extended from VWAP by more than 3%
  };
}

// Find Order Blocks (institutional supply/demand zones)
function findOrderBlocks(candles, lookback = 50) {
  if (!candles || candles.length < lookback) return { bullishOB: [], bearishOB: [] };

  const recent = candles.slice(-lookback);
  const bullishOB = []; // Demand zones
  const bearishOB = []; // Supply zones

  for (let i = 3; i < recent.length - 1; i++) {
    const curr = recent[i];
    const prev1 = recent[i - 1];
    const prev2 = recent[i - 2];
    const prev3 = recent[i - 3];
    const next = recent[i + 1];

    // Bullish Order Block: Last bearish candle before a strong bullish move
    // Look for: bearish candle followed by strong bullish candle that breaks previous high
    if (prev1.close < prev1.open && // Previous was bearish
        curr.close > curr.open && // Current is bullish
        curr.close > prev1.high && // Broke above previous high
        (curr.close - curr.open) > (prev1.open - prev1.close) * 1.5) { // Strong bullish move

      bullishOB.push({
        high: prev1.high,
        low: prev1.low,
        midpoint: (prev1.high + prev1.low) / 2,
        time: prev1.time,
        strength: 'MODERATE',
        type: 'BULLISH_OB'
      });
    }

    // Look for aggressive bullish OB (3 bearish candles followed by explosive bullish)
    if (prev3.close < prev3.open && prev2.close < prev2.open && prev1.close < prev1.open &&
        curr.close > curr.open && curr.close > prev3.high) {

      bullishOB.push({
        high: Math.max(prev3.high, prev2.high, prev1.high),
        low: Math.min(prev3.low, prev2.low, prev1.low),
        midpoint: (Math.max(prev3.high, prev2.high, prev1.high) + Math.min(prev3.low, prev2.low, prev1.low)) / 2,
        time: prev3.time,
        strength: 'STRONG',
        type: 'BULLISH_OB'
      });
    }

    // Bearish Order Block: Last bullish candle before a strong bearish move
    if (prev1.close > prev1.open && // Previous was bullish
        curr.close < curr.open && // Current is bearish
        curr.close < prev1.low && // Broke below previous low
        (curr.open - curr.close) > (prev1.close - prev1.open) * 1.5) { // Strong bearish move

      bearishOB.push({
        high: prev1.high,
        low: prev1.low,
        midpoint: (prev1.high + prev1.low) / 2,
        time: prev1.time,
        strength: 'MODERATE',
        type: 'BEARISH_OB'
      });
    }

    // Aggressive bearish OB
    if (prev3.close > prev3.open && prev2.close > prev2.open && prev1.close > prev1.open &&
        curr.close < curr.open && curr.close < prev3.low) {

      bearishOB.push({
        high: Math.max(prev3.high, prev2.high, prev1.high),
        low: Math.min(prev3.low, prev2.low, prev1.low),
        midpoint: (Math.max(prev3.high, prev2.high, prev1.high) + Math.min(prev3.low, prev2.low, prev1.low)) / 2,
        time: prev3.time,
        strength: 'STRONG',
        type: 'BEARISH_OB'
      });
    }
  }

  // Sort by strength and recency, take top 3
  const sortByStrength = (a, b) => {
    if (a.strength === 'STRONG' && b.strength !== 'STRONG') return -1;
    if (b.strength === 'STRONG' && a.strength !== 'STRONG') return 1;
    return b.time - a.time; // More recent first
  };

  return {
    bullishOB: bullishOB.sort(sortByStrength).slice(0, 3),
    bearishOB: bearishOB.sort(sortByStrength).slice(0, 3)
  };
}

// Calculate Pivot Points (Standard, Fibonacci, Camarilla)
function calculatePivotPoints(candles, type = 'standard') {
  if (!candles || candles.length < 2) return null;

  // Use previous day/period for pivot calculation
  const prev = candles[candles.length - 2];
  const curr = candles[candles.length - 1];

  const high = prev.high;
  const low = prev.low;
  const close = prev.close;

  // Standard Pivot Point
  const pivot = (high + low + close) / 3;

  let pivots;

  if (type === 'fibonacci') {
    // Fibonacci Pivot Points
    const range = high - low;
    pivots = {
      r3: pivot + (range * 1.000),
      r2: pivot + (range * 0.618),
      r1: pivot + (range * 0.382),
      pivot,
      s1: pivot - (range * 0.382),
      s2: pivot - (range * 0.618),
      s3: pivot - (range * 1.000)
    };
  } else if (type === 'camarilla') {
    // Camarilla Pivot Points (good for intraday)
    const range = high - low;
    pivots = {
      r4: close + (range * 1.1 / 2),
      r3: close + (range * 1.1 / 4),
      r2: close + (range * 1.1 / 6),
      r1: close + (range * 1.1 / 12),
      pivot,
      s1: close - (range * 1.1 / 12),
      s2: close - (range * 1.1 / 6),
      s3: close - (range * 1.1 / 4),
      s4: close - (range * 1.1 / 2)
    };
  } else {
    // Standard Pivot Points
    pivots = {
      r3: high + 2 * (pivot - low),
      r2: pivot + (high - low),
      r1: (2 * pivot) - low,
      pivot,
      s1: (2 * pivot) - high,
      s2: pivot - (high - low),
      s3: low - 2 * (high - pivot)
    };
  }

  // Determine current price position relative to pivots
  const price = curr.close;
  let position = 'AT_PIVOT';
  let nearestLevel = pivot;
  let nearestLevelName = 'Pivot';

  if (price > pivots.r2) {
    position = 'ABOVE_R2';
    nearestLevel = pivots.r2;
    nearestLevelName = 'R2';
  } else if (price > pivots.r1) {
    position = 'ABOVE_R1';
    nearestLevel = pivots.r1;
    nearestLevelName = 'R1';
  } else if (price > pivot) {
    position = 'ABOVE_PIVOT';
    nearestLevel = pivot;
    nearestLevelName = 'Pivot';
  } else if (price < pivots.s2) {
    position = 'BELOW_S2';
    nearestLevel = pivots.s2;
    nearestLevelName = 'S2';
  } else if (price < pivots.s1) {
    position = 'BELOW_S1';
    nearestLevel = pivots.s1;
    nearestLevelName = 'S1';
  } else if (price < pivot) {
    position = 'BELOW_PIVOT';
    nearestLevel = pivot;
    nearestLevelName = 'Pivot';
  }

  return {
    ...pivots,
    position,
    nearestLevel,
    nearestLevelName,
    priceToNearestLevel: ((price - nearestLevel) / nearestLevel * 100).toFixed(2)
  };
}

// Calculate Ichimoku Cloud
function calculateIchimoku(candles) {
  if (!candles || candles.length < 52) return null;

  const getHighLow = (data, period) => {
    const slice = data.slice(-period);
    return {
      high: Math.max(...slice.map(c => c.high)),
      low: Math.min(...slice.map(c => c.low))
    };
  };

  // Tenkan-sen (Conversion Line): 9-period high+low / 2
  const tenkan9 = getHighLow(candles, 9);
  const tenkanSen = (tenkan9.high + tenkan9.low) / 2;

  // Kijun-sen (Base Line): 26-period high+low / 2
  const kijun26 = getHighLow(candles, 26);
  const kijunSen = (kijun26.high + kijun26.low) / 2;

  // Senkou Span A: (Tenkan + Kijun) / 2
  const senkouSpanA = (tenkanSen + kijunSen) / 2;

  // Senkou Span B: 52-period high+low / 2
  const senkou52 = getHighLow(candles, 52);
  const senkouSpanB = (senkou52.high + senkou52.low) / 2;

  const currentPrice = candles[candles.length - 1].close;

  // Determine cloud color and position
  const cloudTop = Math.max(senkouSpanA, senkouSpanB);
  const cloudBottom = Math.min(senkouSpanA, senkouSpanB);
  const cloudColor = senkouSpanA > senkouSpanB ? 'BULLISH' : 'BEARISH';

  let signal = 'NEUTRAL';
  if (currentPrice > cloudTop && tenkanSen > kijunSen) {
    signal = 'STRONG_BULLISH';
  } else if (currentPrice > cloudTop) {
    signal = 'BULLISH';
  } else if (currentPrice < cloudBottom && tenkanSen < kijunSen) {
    signal = 'STRONG_BEARISH';
  } else if (currentPrice < cloudBottom) {
    signal = 'BEARISH';
  } else {
    signal = 'IN_CLOUD'; // Price is within the cloud - indecision
  }

  return {
    tenkanSen,
    kijunSen,
    senkouSpanA,
    senkouSpanB,
    cloudTop,
    cloudBottom,
    cloudColor,
    signal,
    tkCross: tenkanSen > kijunSen ? 'BULLISH_TK' : 'BEARISH_TK'
  };
}

// Calculate Market Structure (Higher Highs, Lower Lows)
function analyzeMarketStructure(candles, lookback = 30) {
  if (!candles || candles.length < lookback) return null;

  const recent = candles.slice(-lookback);
  const swingPoints = [];

  // Find swing highs and lows
  for (let i = 2; i < recent.length - 2; i++) {
    if (recent[i].high > recent[i-1].high && recent[i].high > recent[i-2].high &&
        recent[i].high > recent[i+1].high && recent[i].high > recent[i+2].high) {
      swingPoints.push({ type: 'HIGH', price: recent[i].high, index: i });
    }
    if (recent[i].low < recent[i-1].low && recent[i].low < recent[i-2].low &&
        recent[i].low < recent[i+1].low && recent[i].low < recent[i+2].low) {
      swingPoints.push({ type: 'LOW', price: recent[i].low, index: i });
    }
  }

  // Analyze structure
  const highs = swingPoints.filter(p => p.type === 'HIGH');
  const lows = swingPoints.filter(p => p.type === 'LOW');

  let structure = 'UNCLEAR';
  let structureBreak = null;

  if (highs.length >= 2 && lows.length >= 2) {
    const lastHigh = highs[highs.length - 1];
    const prevHigh = highs[highs.length - 2];
    const lastLow = lows[lows.length - 1];
    const prevLow = lows[lows.length - 2];

    const isHH = lastHigh.price > prevHigh.price;
    const isHL = lastLow.price > prevLow.price;
    const isLH = lastHigh.price < prevHigh.price;
    const isLL = lastLow.price < prevLow.price;

    if (isHH && isHL) {
      structure = 'UPTREND'; // Higher Highs and Higher Lows
    } else if (isLH && isLL) {
      structure = 'DOWNTREND'; // Lower Highs and Lower Lows
    } else if (isHH && isLL) {
      structure = 'EXPANDING'; // Volatility expansion
    } else if (isLH && isHL) {
      structure = 'CONTRACTING'; // Volatility contraction (triangle)
    }

    // Check for structure break (BOS/CHoCH)
    const currentPrice = recent[recent.length - 1].close;
    if (structure === 'DOWNTREND' && currentPrice > lastHigh.price) {
      structureBreak = 'BULLISH_BOS'; // Break of Structure
    } else if (structure === 'UPTREND' && currentPrice < lastLow.price) {
      structureBreak = 'BEARISH_BOS';
    }
  }

  return {
    structure,
    structureBreak,
    swingHighs: highs.map(h => h.price),
    swingLows: lows.map(l => l.price),
    lastSwingHigh: highs.length > 0 ? highs[highs.length - 1].price : null,
    lastSwingLow: lows.length > 0 ? lows[lows.length - 1].price : null
  };
}

// ============================================
// CLAUDE AI SERVICE
// ============================================

async function callClaudeAPI(prompt) {
  const startTime = Date.now();
  if (DEBUG_MODE) console.log(`🧠 [CLAUDE] Starting API call with model: ${CONFIG.CLAUDE_MODEL}`);
  updateAiDebugStatus('claude', 'calling');

  try {
    const response = await fetch(CONFIG.CLAUDE_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CONFIG.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: CONFIG.CLAUDE_MODEL,
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const elapsed = Date.now() - startTime;

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`🧠 [CLAUDE] API error ${response.status}: ${errorText}`);
      updateAiDebugStatus('claude', 'error', `HTTP ${response.status}`);
      return null;
    }

    const data = await response.json();
    if (DEBUG_MODE) console.log(`🧠 [CLAUDE] Success in ${elapsed}ms - Response length: ${data.content?.[0]?.text?.length || 0} chars`);
    updateAiDebugStatus('claude', 'success', `${elapsed}ms`);
    return data.content[0].text;
  } catch (error) {
    console.error('🧠 [CLAUDE] API call failed:', error.message);
    updateAiDebugStatus('claude', 'error', error.message);
    return null;
  }
}

async function callOpenAIAPI(prompt) {
  const startTime = Date.now();
  if (DEBUG_MODE) console.log(`🤖 [OPENAI] Starting API call with model: ${CONFIG.OPENAI_MODEL}`);
  updateAiDebugStatus('openai', 'calling');

  try {
    const response = await fetch(CONFIG.OPENAI_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CONFIG.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: CONFIG.OPENAI_MODEL,
        max_tokens: 4096,
        messages: [
          {
            role: 'system',
            content: 'You are an expert crypto perpetual futures trader. Always respond with valid JSON only.'
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3
      })
    });

    const elapsed = Date.now() - startTime;

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`🤖 [OPENAI] API error ${response.status}: ${errorText}`);
      updateAiDebugStatus('openai', 'error', `HTTP ${response.status}`);
      return null;
    }

    const data = await response.json();
    if (DEBUG_MODE) console.log(`🤖 [OPENAI] Success in ${elapsed}ms - Response length: ${data.choices?.[0]?.message?.content?.length || 0} chars`);
    updateAiDebugStatus('openai', 'success', `${elapsed}ms`);
    return data.choices[0].message.content;
  } catch (error) {
    console.error('🤖 [OPENAI] API call failed:', error.message);
    updateAiDebugStatus('openai', 'error', error.message);
    return null;
  }
}

async function callGrokAPI(prompt) {
  const startTime = Date.now();
  if (DEBUG_MODE) console.log(`⚡ [GROK] Starting API call with model: ${CONFIG.GROK_MODEL}`);
  updateAiDebugStatus('grok', 'calling');

  try {
    const response = await fetch(CONFIG.GROK_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CONFIG.GROK_API_KEY}`
      },
      body: JSON.stringify({
        model: CONFIG.GROK_MODEL,
        max_tokens: 4096,
        messages: [
          {
            role: 'system',
            content: 'You are an expert crypto perpetual futures trader. Always respond with valid JSON only.'
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3
      })
    });

    const elapsed = Date.now() - startTime;

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`⚡ [GROK] API error ${response.status}: ${errorText}`);
      updateAiDebugStatus('grok', 'error', `HTTP ${response.status}`);
      return null;
    }

    const data = await response.json();
    if (DEBUG_MODE) console.log(`⚡ [GROK] Success in ${elapsed}ms - Response length: ${data.choices?.[0]?.message?.content?.length || 0} chars`);
    updateAiDebugStatus('grok', 'success', `${elapsed}ms`);
    return data.choices[0].message.content;
  } catch (error) {
    console.error('⚡ [GROK] API call failed:', error.message);
    updateAiDebugStatus('grok', 'error', error.message);
    return null;
  }
}

// Format market data for AI prompts (shared)
function formatMarketDataForAI(marketData) {
  // Global market sentiment header
  const globalSentiment = `
=== GLOBAL MARKET SENTIMENT ===
- USDT Dominance: ${usdtDominanceData.current || 'N/A'}% (${usdtDominanceData.trend || 'N/A'}) ${usdtDominanceData.signal === 'BULLISH' ? '🟢 BULLISH FOR CRYPTO' : usdtDominanceData.signal === 'BEARISH' ? '🔴 BEARISH FOR CRYPTO' : ''}
`;

  const coinData = marketData.map(m => {
    const funding = state.fundingRates[m.symbol];
    const oi = state.openInterest[m.symbol];
    const social = state.socialSentiment[m.symbol];
    const liq = state.liquidationData[m.symbol];

    return `
${m.symbol}:
- Price: $${m.price} | 24h: ${m.change.toFixed(2)}% | Vol: $${formatVolume(m.volume)}
- Trend: ${m.trend || 'N/A'} | Regime: ${m.marketRegime || 'N/A'}
- RSI: ${m.rsi?.toFixed(1) || 'N/A'} | StochRSI: ${m.stochRsi?.signal || 'N/A'} ${m.stochRsi?.signal === 'OVERSOLD' ? '🟢' : m.stochRsi?.signal === 'OVERBOUGHT' ? '🔴' : ''}
- ADX: ${m.adx?.adx || 'N/A'} (${m.adx?.trend || 'N/A'}) ${m.adx?.adx >= 25 ? '✅ STRONG' : '⚠️ WEAK'}
- Supertrend: ${m.supertrend?.direction || 'N/A'} | Signal: ${m.supertrend?.signal || 'N/A'}
- EMAs: 20=$${m.ema20?.toFixed(2) || 'N/A'} | 50=$${m.ema50?.toFixed(2) || 'N/A'} | 200=$${m.ema200?.toFixed(2) || 'N/A'}
- Support: ${m.supports?.map(s => '$' + formatPrice(s)).join(', ') || 'N/A'}
- Resistance: ${m.resistances?.map(r => '$' + formatPrice(r)).join(', ') || 'N/A'}
- Fibonacci: ${m.fibonacci ? `Near ${m.fibonacci.nearestLevel} | Fib Support: ${m.fibonacci.fibSupport?.level || 'N/A'} ($${m.fibonacci.fibSupport?.price || 'N/A'}) | Fib Resist: ${m.fibonacci.fibResistance?.level || 'N/A'} ($${m.fibonacci.fibResistance?.price || 'N/A'})` : 'N/A'} ${m.fibonacci?.atKeyLevel ? '⚠️ AT KEY LEVEL' : ''}
- Structure: ${m.trendStructure?.structure || 'N/A'} ${m.trendStructure?.structureBreak ? `🔥 ${m.trendStructure.structureBreak}` : ''} (HH:${m.trendStructure?.hasHigherHighs ? '✓' : '✗'} HL:${m.trendStructure?.hasHigherLows ? '✓' : '✗'} LH:${m.trendStructure?.hasLowerHighs ? '✓' : '✗'} LL:${m.trendStructure?.hasLowerLows ? '✓' : '✗'})
- Confluence: ${m.confluence?.confluencePercent || 0}% ${m.confluence?.direction || 'NEUTRAL'} (${m.confluence?.quality || 'LOW'}) - Signals: ${m.confluence?.signals?.slice(0,3).join(', ') || 'None'}
- Funding: ${funding ? (funding.fundingRate > 0 ? '+' : '') + funding.fundingRate.toFixed(4) + '%' : 'N/A'} ${funding && Math.abs(funding.fundingRate) > 0.01 ? '⚠️ HIGH' : ''}
- OI Change: ${oi ? (oi.change24h > 0 ? '+' : '') + oi.change24h.toFixed(2) + '%' : 'N/A'}
- L/S Ratio: ${liq?.longShortRatio ? liq.longShortRatio.toFixed(2) : 'N/A'} ${liq?.crowdBias ? `(${liq.crowdBias})` : ''}
- Liquidations: ${liq ? `L:$${formatVolume(liq.longLiquidations24h || 0)} S:$${formatVolume(liq.shortLiquidations24h || 0)}` : 'N/A'} ${liq?.priceImplication || ''}
- VWAP: ${m.vwap?.pricePosition || 'N/A'} (${m.vwap?.deviation?.toFixed(2) || 0}% dev)
- ATR: ${m.atr?.toFixed(2) || 'N/A'} (${m.atrPercent?.toFixed(2) || 'N/A'}% of price)
- Volume Trend: ${m.volumeTrend || 'N/A'}
- Ichimoku: ${m.ichimoku?.signal || 'N/A'} (${m.ichimoku?.cloudColor || 'N/A'} cloud)`;
  }).join('\n');

  return globalSentiment + coinData;
}

// JSON response format (shared)
const AI_RESPONSE_FORMAT = `
{
  "topPicks": [
    {
      "symbol": "SYMBOL",
      "direction": "LONG or SHORT",
      "confidence": 75-95,
      "entry": price,
      "takeProfit": price,
      "stopLoss": price,
      "reasoning": "Brief 1-2 sentence explanation",
      "keyLevels": {
        "majorSupport": price,
        "majorResistance": price,
        "liquidationZone": price
      },
      "riskScore": 1-10,
      "timeHorizon": "4H to 1D",
      "entryTrigger": "BREAKOUT/PULLBACK/REVERSAL/MOMENTUM",
      "entryCondition": "Specific condition to enter (e.g., 'Break above 95000 with volume')"
    }
  ],
  "marketSentiment": "BULLISH/BEARISH/NEUTRAL",
  "marketCondition": "Brief market condition description"
}`;

// CLAUDE - Risk Manager (focuses on stop loss, traps, position sizing)
function buildClaudePrompt(marketData) {
  const dataStr = formatMarketDataForAI(marketData);
  const performance = buildAiPerformanceContext('claude');
  const rejectionSummary = summarizeRejections();
  return `You are CLAUDE, a RISK MANAGEMENT specialist for crypto perpetual futures trading. Your expertise:
- Optimal stop loss placement using market structure
- Identifying bull traps and bear traps
- Evaluating risk/reward ratios
- Spotting over-leveraged crowd positioning to fade
- Protecting capital above all else

${performance}
${rejectionSummary}

MARKET DATA:
${dataStr}

YOUR SPECIALIZED ANALYSIS FOCUS:
1. **TRAP IDENTIFICATION**: Look for bull traps (fake breakouts followed by rejection) and bear traps (fake breakdowns followed by recovery). Use order blocks and market structure to identify these.
2. **STOP LOSS OPTIMIZATION**: Place stops behind swing lows (for longs) or swing highs (for shorts). Consider ATR for volatility-adjusted stops.
3. **CROWD POSITIONING**: When crowd is CROWDED_LONG (>55%), look for short opportunities. When CROWDED_SHORT, look for longs. Fade the herd.
4. **LIQUIDATION ZONES**: Heavy long liquidations (POTENTIAL_BOTTOM) = smart money buying. Heavy short liquidations (POTENTIAL_TOP) = smart money selling.
5. **FUNDING RATE TRAPS**: High positive funding with price stalling = longs paying heavy fees, potential short squeeze setup.
6. **RISK/REWARD**: Only pick trades with at least 2:1 R/R ratio. Calculate: (TP - Entry) / (Entry - SL) >= 2

CRITICAL REQUIREMENTS (ALL must be met):
- **ADX MUST BE >= 25** (Strong trend required) - Skip coins with ADX < 25 (weak/no trend)
- **SUPERTREND must confirm direction** (Supertrend UP = longs only, DOWN = shorts only)
- ONLY trade in direction of higher timeframe trend (check MTF Confluence)
- Market Regime must be TRENDING (UP or DOWN), NOT VOLATILE or RANGING
- Must have clear structure break (BULLISH_BOS for longs, BEARISH_BOS for shorts) OR price at strong order block
- Place SL behind the nearest swing high/low with ATR buffer
- Entry must be at a favorable level (near support for longs, near resistance for shorts)
- **Stochastic RSI timing**: For longs prefer OVERSOLD or rising from <30. For shorts prefer OVERBOUGHT or falling from >70

⚠️ DO NOT SIGNAL ANY COIN WITH ADX < 25 - This is mandatory.

Respond ONLY with valid JSON in this exact format:
${AI_RESPONSE_FORMAT}

Select 0-2 setups ONLY if they meet ALL requirements. Better to return empty topPicks than signal weak setups.`;
}

// GPT-4o - Technical Analyst (focuses on chart patterns, S/R, price action)
function buildOpenAIPrompt(marketData) {
  const dataStr = formatMarketDataForAI(marketData);
  const performance = buildAiPerformanceContext('openai');
  const rejectionSummary = summarizeRejections();
  return `You are GPT-4o, a TECHNICAL ANALYSIS specialist for crypto perpetual futures trading. Your expertise:
- Chart pattern recognition (head & shoulders, triangles, wedges)
- Support/resistance level identification
- Price action analysis (candlestick patterns)
- EMA/MACD/RSI confluence
- Breakout and breakdown identification

${performance}
${rejectionSummary}

MARKET DATA:
${dataStr}

YOUR SPECIALIZED ANALYSIS FOCUS:
1. **CHART PATTERNS**: Look for classic patterns - double tops/bottoms, head & shoulders, triangles, wedges, channels.
2. **SUPPORT/RESISTANCE**: Identify major S/R levels. Look for price respecting these levels multiple times.
3. **PRICE ACTION**: Analyze candlestick patterns at key levels - engulfing, pin bars, inside bars.
4. **TECHNICAL INDICATORS**:
   - RSI: Oversold (<30) = potential long, Overbought (>70) = potential short
   - MACD: Histogram positive + crossover = bullish, negative + crossover = bearish
   - Bollinger Bands: Price at lower band + oversold = long opportunity
5. **VWAP ANALYSIS**: Price above VWAP = bullish bias. Price below VWAP = bearish bias. Extended (>3% deviation) = mean reversion expected.
6. **PIVOT POINTS**: Use daily pivots as targets. S1/S2 for support, R1/R2 for resistance.

CRITICAL REQUIREMENTS (ALL must be met):
- **ADX MUST BE >= 25** (Strong trend required) - Skip coins with ADX < 25 (weak/no trend)
- **SUPERTREND must confirm direction** (Supertrend UP = longs only, DOWN = shorts only)
- ONLY trade when technical indicators ALIGN (RSI + MACD + EMA + Supertrend all same direction)
- Price must be respecting key levels (not in no-man's-land)
- Volume should confirm the move (INCREASING volume trend preferred)
- MTF Confluence should be at least PARTIAL alignment
- Ichimoku signal should support the direction (not IN_CLOUD)
- **Stochastic RSI**: Use for entry timing - OVERSOLD for longs, OVERBOUGHT for shorts

⚠️ DO NOT SIGNAL ANY COIN WITH ADX < 25 - This is mandatory.

Respond ONLY with valid JSON in this exact format:
${AI_RESPONSE_FORMAT}

Select 0-2 setups ONLY if they meet ALL requirements. Better to return empty topPicks than signal weak setups.`;
}

// GROK - Momentum Hunter (focuses on trend strength, breakouts, volume)
function buildGrokPrompt(marketData) {
  const dataStr = formatMarketDataForAI(marketData);
  const performance = buildAiPerformanceContext('grok');
  const rejectionSummary = summarizeRejections();
  return `You are GROK, a MOMENTUM TRADING specialist for crypto perpetual futures trading. Your expertise:
- Identifying trend strength and acceleration
- Catching breakouts early
- Volume analysis and confirmation
- Momentum divergences
- Riding strong trends

${performance}
${rejectionSummary}

MARKET DATA:
${dataStr}

YOUR SPECIALIZED ANALYSIS FOCUS:
1. **TREND STRENGTH**: Look for STRONG UPTREND or STRONG DOWNTREND in trend direction. Avoid weak trends.
2. **BREAKOUT DETECTION**:
   - Price breaking above resistance with volume = long entry
   - Price breaking below support with volume = short entry
   - Structure breaks (BULLISH_BOS/BEARISH_BOS) are high-probability
3. **VOLUME CONFIRMATION**: Only trade when volume trend is INCREASING. Avoid DECREASING volume breakouts (likely fake).
4. **MOMENTUM INDICATORS**:
   - MACD Histogram: Look for histogram expanding (increasing momentum)
   - RSI: 50-70 zone for longs (momentum without overbought), 30-50 for shorts
5. **ORDER BLOCK MOMENTUM**: Price breaking through order block with momentum = strong continuation signal
6. **ICHIMOKU MOMENTUM**: STRONG_BULLISH or STRONG_BEARISH signals with TK cross = high momentum

CRITICAL REQUIREMENTS (ALL must be met):
- **ADX MUST BE >= 25** (Strong trend required) - Skip coins with ADX < 25 (weak/no trend)
- **SUPERTREND must confirm direction** (Supertrend UP = longs only, DOWN = shorts only)
- ONLY trade with the trend (no counter-trend trades)
- Market Structure must show UPTREND for longs, DOWNTREND for shorts
- Volume must be INCREASING or STABLE (never DECREASING)
- Prefer symbols with high 24h change (momentum already present)
- Entry should be on pullback to VWAP or EMA20, not at extended levels
- **Stochastic RSI**: K value should be in momentum zone (40-60) or just exiting oversold/overbought

⚠️ DO NOT SIGNAL ANY COIN WITH ADX < 25 - This is mandatory. No exceptions.

Respond ONLY with valid JSON in this exact format:
${AI_RESPONSE_FORMAT}

Select 0-2 setups ONLY if they meet ALL requirements. Better to return empty topPicks than chase weak momentum.`;
}

// Legacy function for backwards compatibility
function buildMarketAnalysisPrompt(marketData) {
  return buildOpenAIPrompt(marketData);
}

async function runAiAnalysis() {
  if (state.isAiScanning) return;

  // Check if any API key is configured
  if (!isAnyAiConfigured()) {
    console.log('⚠️ No AI API keys configured. Skipping AI analysis.');
    updateAiScanStatus('No API Key');
    return;
  }

  state.isAiScanning = true;
  state.signalBlockStats = {};
  const aiNames = [];
  if (isClaudeConfigured()) aiNames.push('Claude');
  if (isOpenAIConfigured()) aiNames.push('GPT-4o');
  if (isGrokConfigured()) aiNames.push('Grok');
  console.log(`🤖 Starting ${aiNames.join(' + ')} AI market analysis...`);

  // Check if we have at least 2 AIs for consensus (required for signals)
  const configuredAIs = countConfiguredAIs();
  if (configuredAIs < 2) {
    console.log('⚠️ At least 2 AI services required for consensus signals. Configure more APIs in Settings.');
    updateAiScanStatus('Need 2+ AIs');
  }
  updateAiScanStatus('Fetching data...');

  try {
    // Fetch all data sources in parallel for efficiency
    console.log('📊 Fetching market intelligence...');
    const topMarkets = state.markets.slice(0, 20);
    const topSymbols = topMarkets.map(m => m.symbol);

    // Fetch funding rates first (important for analysis)
    await fetchFundingRates();

    // Fetch USDT Dominance for market sentiment
    await fetchUSDTDominance();

    // Fetch social sentiment and liquidation data (if APIs are configured)
    await Promise.all([
      fetchBatchSocialSentiment(topSymbols),
      fetchBatchLiquidationData(topSymbols)
    ]);

    // Gather enhanced market data for top 20 coins
    const enrichedData = [];

    updateAiScanStatus('Analyzing markets...');

    for (const market of topMarkets) {
      // Fetch Open Interest for top 10 markets only (rate limiting)
      if (enrichedData.length < 10) {
        await fetchOpenInterest(market.symbol);
      }
      const candles = await fetchKlines(market.symbol, '240', 300);
      if (candles.length < 50) continue;

      const closes = candles.map(c => c.close);
      const rsi = calculateRSI(closes);
      const ema20 = calculateEMA(closes, 20);
      const ema50 = calculateEMA(closes, 50);
      const ema200 = calculateEMA(closes, 200);
      const macd = calculateMACD(closes);
      const bb = calculateBollingerBands(closes);
      const atr = calculateATR(candles);
      const { supports, resistances } = findSupportResistance(candles);

      // Volume analysis
      const avgVolume = candles.slice(-20).reduce((a, c) => a + c.volume, 0) / 20;
      const recentVolume = candles.slice(-5).reduce((a, c) => a + c.volume, 0) / 5;
      const volumeTrend = recentVolume > avgVolume * 1.2 ? 'INCREASING' :
                          recentVolume < avgVolume * 0.8 ? 'DECREASING' : 'STABLE';

      // Trend analysis
      const trend = ema20 > ema50 && ema50 > ema200 ? 'STRONG UPTREND' :
                    ema20 < ema50 && ema50 < ema200 ? 'STRONG DOWNTREND' :
                    ema20 > ema50 ? 'WEAK UPTREND' : 'WEAK DOWNTREND';

      // BB position
      const price = closes[closes.length - 1];
      const atrPercent = atr ? (atr / price) * 100 : 0;
      const bbPosition = price > bb.upper ? 'ABOVE UPPER' :
                         price < bb.lower ? 'BELOW LOWER' :
                         price > bb.middle ? 'UPPER HALF' : 'LOWER HALF';

      // Multi-timeframe analysis for top 5 coins only (expensive)
      let mtfAnalysis = null;
      if (enrichedData.length < 5) {
        mtfAnalysis = await analyzeMultiTimeframe(market.symbol);
      }

      // Calculate advanced indicators
      const vwap = calculateVWAP(candles);
      const orderBlocks = findOrderBlocks(candles);
      const pivotPoints = calculatePivotPoints(candles);
      const ichimoku = calculateIchimoku(candles);
      const marketStructure = analyzeMarketStructure(candles);
      const marketRegime = detectMarketRegime(candles);

      // NEW: Additional trend strength indicators
      const adx = calculateADX(candles);
      const stochRsi = calculateStochRSI(closes);
      const supertrend = calculateSupertrend(candles);

      // NEW: Fibonacci, Trend Structure, and Confluence
      const fibonacci = calculateFibonacciLevels(candles);
      const trendStructure = analyzeTrendStructure(candles);

      // Build partial data for confluence scoring
      const partialData = {
        symbol: market.symbol,
        trend,
        rsi,
        stochRsi,
        adx,
        supertrend,
        fibonacci,
        trendStructure
      };
      const confluence = calculateConfluenceScore(partialData);

      enrichedData.push({
        ...market,
        rsi,
        ema20,
        ema50,
        ema200,
        macdHistogram: macd.histogram,
        bb,
        bbPosition,
        atr,
        atrPercent,
        supports,
        resistances,
        volumeTrend,
        trend,
        mtfAnalysis,
        // Advanced indicators
        vwap,
        orderBlocks,
        pivotPoints,
        ichimoku,
        marketStructure,
        marketRegime,
        // Trend strength indicators
        adx,
        stochRsi,
        supertrend,
        // NEW: Fibonacci, Trend Structure, Confluence
        fibonacci,
        trendStructure,
        confluence
      });

      await sleep(30); // Rate limiting
    }

    updateAiScanStatus('Consulting AI...');

    const marketInfoBySymbol = Object.fromEntries(enrichedData.map(m => [m.symbol, m]));

    // Build specialized prompts for each AI
    // Claude = Risk Manager, GPT-4o = Technical Analyst, Grok = Momentum Hunter
    const claudePrompt = buildClaudePrompt(enrichedData);
    const openaiPrompt = buildOpenAIPrompt(enrichedData);
    const grokPrompt = buildGrokPrompt(enrichedData);

    console.log('🎯 Using specialized AI roles: Claude=Risk, GPT=Technical, Grok=Momentum');

    // Call all configured AIs in parallel with their specialized prompts
    const apiPromises = [];
    if (isClaudeConfigured()) {
      apiPromises.push(callClaudeAPI(claudePrompt).then(r => ({ source: 'claude', response: r })));
    }
    if (isOpenAIConfigured()) {
      apiPromises.push(callOpenAIAPI(openaiPrompt).then(r => ({ source: 'openai', response: r })));
    }
    if (isGrokConfigured()) {
      apiPromises.push(callGrokAPI(grokPrompt).then(r => ({ source: 'grok', response: r })));
    }

    const results = await Promise.allSettled(apiPromises);

    // Parse responses from each AI
    const claudePicks = [];
    const openaiPicks = [];
    const grokPicks = [];
    let claudeAnalysis = null;
    let openaiAnalysis = null;
    let grokAnalysis = null;

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.response) {
        try {
          const jsonMatch = result.value.response.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const analysis = JSON.parse(jsonMatch[0]);
            if (result.value.source === 'claude') {
              claudeAnalysis = analysis;
              if (analysis.topPicks) {
                analysis.topPicks.forEach(pick => {
                  const marketInfo = marketInfoBySymbol[pick.symbol];
                  const validation = validateAiPick(pick, marketInfo);
                  if (validation.valid) {
                    claudePicks.push({ ...validation.pick, reasoning: pick.reasoning, keyLevels: pick.keyLevels });
                  } else {
                    recordSignalRejection(validation.reason);
                    recordFilterReason(validation.reason);
                    console.log(`⛔ Claude pick rejected (${pick.symbol || 'unknown'}): ${validation.reason}`);
                  }
                });
              }
              console.log('✅ Claude analysis received:', analysis.topPicks?.length || 0, 'picks');
              // Track AI performance stats
              state.performanceStats.claudeSignals += analysis.topPicks?.length || 0;
              analysis.topPicks?.forEach(p => { state.performanceStats.claudeTotalConf += p.confidence || 0; });
            } else if (result.value.source === 'openai') {
              openaiAnalysis = analysis;
              if (analysis.topPicks) {
                analysis.topPicks.forEach(pick => {
                  const marketInfo = marketInfoBySymbol[pick.symbol];
                  const validation = validateAiPick(pick, marketInfo);
                  if (validation.valid) {
                    openaiPicks.push({ ...validation.pick, reasoning: pick.reasoning, keyLevels: pick.keyLevels });
                  } else {
                    recordSignalRejection(validation.reason);
                    recordFilterReason(validation.reason);
                    console.log(`⛔ GPT-4o pick rejected (${pick.symbol || 'unknown'}): ${validation.reason}`);
                  }
                });
              }
              console.log('✅ GPT-4o analysis received:', analysis.topPicks?.length || 0, 'picks');
              state.performanceStats.openaiSignals += analysis.topPicks?.length || 0;
              analysis.topPicks?.forEach(p => { state.performanceStats.openaiTotalConf += p.confidence || 0; });
            } else if (result.value.source === 'grok') {
              grokAnalysis = analysis;
              if (analysis.topPicks) {
                analysis.topPicks.forEach(pick => {
                  const marketInfo = marketInfoBySymbol[pick.symbol];
                  const validation = validateAiPick(pick, marketInfo);
                  if (validation.valid) {
                    grokPicks.push({ ...validation.pick, reasoning: pick.reasoning, keyLevels: pick.keyLevels });
                  } else {
                    recordSignalRejection(validation.reason);
                    recordFilterReason(validation.reason);
                    console.log(`⛔ Grok pick rejected (${pick.symbol || 'unknown'}): ${validation.reason}`);
                  }
                });
              }
              console.log('✅ Grok analysis received:', analysis.topPicks?.length || 0, 'picks');
              state.performanceStats.grokSignals += analysis.topPicks?.length || 0;
              analysis.topPicks?.forEach(p => { state.performanceStats.grokTotalConf += p.confidence || 0; });
            }
          }
        } catch (parseError) {
          console.error(`Failed to parse ${result.value.source} response:`, parseError);
        }
      }
    }

    const isEntryMatch = (entry1, entry2) => isWithinPercent(entry1, entry2, CONFIG.MAX_ENTRY_WIGGLE_PERCENT);
    const isStopMatch = (sl1, sl2) => isWithinPercent(sl1, sl2, CONFIG.MAX_SL_WIGGLE_PERCENT);
    const isTakeProfitMatch = (tp1, tp2) => isWithinPercent(tp1, tp2, CONFIG.MAX_TP_WIGGLE_PERCENT);
    const isTriggerMatch = (triggerA, triggerB) => {
      if (!triggerA || !triggerB) return true;
      return triggerA === triggerB;
    };

    // Collect all picks with their source
    const eligibleSources = ['claude', 'openai', 'grok'].filter(isAiEligible);
    if (eligibleSources.length < 3) {
      console.log(`⚖️ AI eligibility filter active. Eligible: ${eligibleSources.join(', ') || 'none'}`);
    }
    const allPicks = [
      ...claudePicks.map(p => ({ ...p, source: 'claude', aiModel: CONFIG.CLAUDE_MODEL })),
      ...openaiPicks.map(p => ({ ...p, source: 'openai', aiModel: CONFIG.OPENAI_MODEL })),
      ...grokPicks.map(p => ({ ...p, source: 'grok', aiModel: CONFIG.GROK_MODEL }))
    ].filter(pick => eligibleSources.includes(pick.source));

    // Group picks by symbol and direction
    const picksBySymbolDirection = {};
    for (const pick of allPicks) {
      const key = `${pick.symbol}_${pick.direction}`;
      if (!picksBySymbolDirection[key]) {
        picksBySymbolDirection[key] = [];
      }
      picksBySymbolDirection[key].push(pick);
    }

    // Find consensus signals (2+ AIs agree on symbol AND direction with entry wiggle room)
    const allSignals = [];

    // Debug: Log all picks grouped by symbol/direction
    for (const [key, picks] of Object.entries(picksBySymbolDirection)) {
      if (picks.length >= 2) {
        const sources = picks.map(p => p.source).join(', ');
        const entries = picks.map(p => `${p.source}: $${p.entry.toLocaleString()}`).join(', ');
        console.log(`🔍 Potential consensus ${key}: ${sources} | Entries: ${entries}`);
      }
    }

    for (const [key, picks] of Object.entries(picksBySymbolDirection)) {
      // Check for matches considering entry price wiggle room
      const matchingPicks = [];
      for (const pick of picks) {
        // Find other picks that match this one (same direction, similar entry)
        const matches = picks.filter(p =>
          p.source !== pick.source &&
          isEntryMatch(p.entry, pick.entry) &&
          isStopMatch(p.stopLoss, pick.stopLoss) &&
          isTakeProfitMatch(p.takeProfit, pick.takeProfit) &&
          isTriggerMatch(p.entryTrigger, pick.entryTrigger)
        );
        if (matches.length > 0 && !matchingPicks.some(m => m.source === pick.source)) {
          matchingPicks.push(pick);
          matches.forEach(m => {
            if (!matchingPicks.some(mp => mp.source === m.source)) {
              matchingPicks.push(m);
            }
          });
        }
      }

      // Only create signal if ALL 3 AIs agree (Gold consensus only for quality)
      if (matchingPicks.length >= 3) {
        const isGoldConsensus = true; // Now we only accept Gold consensus
        const isSilverConsensus = false; // No longer accepting silver consensus
        const symbol = matchingPicks[0].symbol;
        const direction = matchingPicks[0].direction;

        // Get market data for this symbol (for regime and MTF checks)
        const marketInfo = enrichedData.find(m => m.symbol === symbol);

        // HARD FILTER: ADX must be >= 25 (strong trend required)
        const adxValue = marketInfo?.adx?.adx || 0;
        if (adxValue < 25) {
          console.log(`⛔ ${symbol}: ADX ${adxValue} < 25 - Skipping (weak trend)`);
          recordFilterReason('ADX < 25');
          continue;
        }

        const regime = marketInfo?.marketRegime || 'UNKNOWN';
        if (['RANGING', 'CHOPPY', 'SIDEWAYS', 'VOLATILE'].includes(regime)) {
          console.log(`⛔ ${symbol}: Market regime ${regime} - Skipping`);
          recordFilterReason(`Regime ${regime}`);
          continue;
        }

        if (marketInfo?.volumeTrend === 'DECREASING') {
          console.log(`⛔ ${symbol}: Volume trend decreasing - Skipping`);
          recordFilterReason('Volume decreasing');
          continue;
        }

        if (marketInfo?.atrPercent !== undefined && marketInfo.atrPercent < CONFIG.MIN_ATR_PERCENT) {
          console.log(`⛔ ${symbol}: ATR ${marketInfo.atrPercent.toFixed(2)}% below ${CONFIG.MIN_ATR_PERCENT}% - Skipping`);
          recordFilterReason('ATR too low');
          continue;
        }

        // HARD FILTER: Supertrend must confirm direction
        const supertrendDir = marketInfo?.supertrend?.direction;
        if ((direction === 'LONG' && supertrendDir !== 'UP') || (direction === 'SHORT' && supertrendDir !== 'DOWN')) {
          console.log(`⛔ ${symbol}: Supertrend ${supertrendDir} conflicts with ${direction} - Skipping`);
          recordFilterReason('Supertrend mismatch');
          continue;
        }

        // MARKET CONDITIONS - Used for confidence adjustments
        const mtfConfluence = marketInfo?.mtfAnalysis?.confluence || 'N/A';
        const mtfScore = marketInfo?.mtfAnalysis?.confluenceScore || 0;
        const isMtfAligned = mtfConfluence === 'BULLISH' && direction === 'LONG' ||
                            mtfConfluence === 'BEARISH' && direction === 'SHORT' ||
                            mtfScore >= 60;

        // Average the values from matching picks
        const avgEntry = matchingPicks.reduce((sum, p) => sum + p.entry, 0) / matchingPicks.length;
        let avgConf = matchingPicks.reduce((sum, p) => sum + p.confidence, 0) / matchingPicks.length;

        // AI PERFORMANCE WEIGHTING - Weight by historical win rate
        const stats = state.performanceStats;
        const getAiWeight = (source) => {
          if (source === 'claude') {
            const total = stats.claudeWins + stats.claudeLosses;
            return total >= 3 ? (stats.claudeWins / total) : 0.5;
          }
          if (source === 'openai') {
            const total = stats.openaiWins + stats.openaiLosses;
            return total >= 3 ? (stats.openaiWins / total) : 0.5;
          }
          if (source === 'grok') {
            const total = stats.grokWins + stats.grokLosses;
            return total >= 3 ? (stats.grokWins / total) : 0.5;
          }
          return 0.5;
        };

        // Calculate weighted confidence
        let totalWeight = 0;
        let weightedConf = 0;
        for (const pick of matchingPicks) {
          const weight = getAiWeight(pick.source);
          weightedConf += pick.confidence * weight;
          totalWeight += weight;
        }
        const performanceWeightedConf = totalWeight > 0 ? weightedConf / totalWeight : avgConf;

        // CONFIDENCE ADJUSTMENT SYSTEM
        const baseConf = (avgConf + performanceWeightedConf) / 2;
        let adjustedConf = baseConf;
        const adjustments = [];

        // BONUS: Consensus level
        if (isGoldConsensus) {
          adjustedConf += 10;
          adjustments.push('+10% (Gold consensus - 3 AIs)');
        } else {
          adjustedConf += 5;
          adjustments.push('+5% (Silver consensus - 2 AIs)');
        }

        // BONUS: Strong MTF alignment
        if (isMtfAligned && mtfScore >= 75) {
          adjustedConf += 3;
          adjustments.push('+3% (Strong MTF alignment)');
        }

        // PENALTY: Non-trending market (ranging/choppy)
        const isRanging = ['RANGING', 'CHOPPY', 'SIDEWAYS', 'VOLATILE'].includes(regime);
        if (isRanging) {
          adjustedConf -= 5;
          adjustments.push('-5% (Ranging market)');
        }

        // PENALTY: Counter-trend trade
        const isCounterTrend = (regime === 'TRENDING_UP' && direction === 'SHORT') ||
                               (regime === 'TRENDING_DOWN' && direction === 'LONG');
        if (isCounterTrend) {
          adjustedConf -= 10;
          adjustments.push('-10% (Counter-trend)');
        }

        // PENALTY: MTF not aligned
        if (!isMtfAligned && mtfConfluence !== 'N/A' && mtfConfluence !== 'NEUTRAL') {
          adjustedConf -= 5;
          adjustments.push('-5% (MTF misaligned)');
        }

        // Clamp confidence between 50-98%
        let boostedConf = Math.max(50, Math.min(98, Math.round(adjustedConf)));

        // Log confidence calculation
        console.log(`✅ ${symbol} ${direction}: Base ${baseConf.toFixed(0)}% → Final ${boostedConf}%`);
        console.log(`   Adjustments: ${adjustments.join(', ')}`);
        console.log(`   Regime: ${regime}, MTF: ${mtfConfluence} (${mtfScore}%)`);

        // Use most aggressive TP from all matching picks
        const bestTP = direction === 'LONG'
          ? Math.max(...matchingPicks.map(p => p.takeProfit))
          : Math.min(...matchingPicks.map(p => p.takeProfit));

        // Use safest SL from all matching picks
        const safestSL = direction === 'LONG'
          ? Math.max(...matchingPicks.map(p => p.stopLoss))
          : Math.min(...matchingPicks.map(p => p.stopLoss));

        const riskReward = Math.abs(bestTP - avgEntry) / Math.abs(avgEntry - safestSL);
        if (riskReward < CONFIG.MIN_RISK_REWARD) {
          console.log(`⛔ ${symbol}: Risk/Reward ${riskReward.toFixed(2)} < ${CONFIG.MIN_RISK_REWARD} - Skipping`);
          recordFilterReason('Risk/Reward too low');
          continue;
        }

        const aiSources = matchingPicks.map(p => p.source);
        const reasons = matchingPicks.map(p => `${p.source.charAt(0).toUpperCase() + p.source.slice(1)}: ${p.reasoning}`);

        // Get entry trigger and condition from picks
        const entryTriggers = matchingPicks.map(p => p.entryTrigger).filter(t => t);
        const entryConditions = matchingPicks.map(p => p.entryCondition).filter(c => c);
        const primaryTrigger = entryTriggers[0] || 'MOMENTUM';
        const primaryCondition = entryConditions[0] || 'Price momentum confirmation';

        // DISSENTING AI: Find what the 3rd AI thinks (for silver consensus)
        let dissentingAi = null;
        if (isSilverConsensus) {
          const allAis = ['claude', 'openai', 'grok'];
          const agreeingAis = aiSources;
          const missingAi = allAis.find(ai => !agreeingAis.includes(ai));

          if (missingAi) {
            // Check if the missing AI had any opinion on this symbol
            const dissentingPick = allPicks.find(p => p.source === missingAi && p.symbol === symbol);

            if (dissentingPick) {
              // 3rd AI had a different opinion on the same coin
              dissentingAi = {
                source: missingAi,
                direction: dissentingPick.direction,
                entry: dissentingPick.entry,
                confidence: dissentingPick.confidence,
                reasoning: dissentingPick.reasoning || 'Different technical analysis',
                agrees: dissentingPick.direction === direction, // Same direction but different entry?
                type: dissentingPick.direction === direction ? 'DIFFERENT_ENTRY' : 'OPPOSITE_DIRECTION'
              };
              console.log(`🤔 ${missingAi} dissents on ${symbol}: ${dissentingPick.direction} at $${dissentingPick.entry.toLocaleString()} (vs ${direction} at $${avgEntry.toLocaleString()})`);
            } else {
              // 3rd AI didn't have any opinion on this coin
              dissentingAi = {
                source: missingAi,
                direction: null,
                confidence: null,
                reasoning: 'Did not signal this coin',
                type: 'NO_SIGNAL'
              };
              console.log(`🤷 ${missingAi} has no opinion on ${symbol}`);
            }
          }
        }

        const qualityScore = computeSignalQuality({ confidence: boostedConf, riskReward }, marketInfo);

        const signal = {
          symbol: symbol,
          direction: direction,
          confidence: boostedConf,
          entry: avgEntry,
          tp: bestTP,
          sl: safestSL,
          riskReward: riskReward,
          qualityScore: qualityScore,
          timeframe: 'AI',
          reasons: reasons,
          isAiGenerated: true,
          isConsensus: true,
          isGoldConsensus: isGoldConsensus,
          isSilverConsensus: isSilverConsensus,
          aiSources: aiSources,
          claudeModel: aiSources.includes('claude') ? CONFIG.CLAUDE_MODEL : null,
          openaiModel: aiSources.includes('openai') ? CONFIG.OPENAI_MODEL : null,
          grokModel: aiSources.includes('grok') ? CONFIG.GROK_MODEL : null,
          keyLevels: matchingPicks[0].keyLevels,
          timestamp: Date.now(),
          marketSentiment: claudeAnalysis?.marketSentiment || openaiAnalysis?.marketSentiment || grokAnalysis?.marketSentiment || 'NEUTRAL',
          // New fields
          marketRegime: regime,
          mtfConfluence: mtfConfluence,
          mtfScore: mtfScore,
          entryTrigger: primaryTrigger,
          entryCondition: primaryCondition,
          aiWeights: matchingPicks.reduce((acc, p) => { acc[p.source] = getAiWeight(p.source).toFixed(2); return acc; }, {}),
          dissentingAi: dissentingAi // 3rd AI opinion for silver consensus
        };

        allSignals.push(signal);

        // Track consensus stats
        if (isGoldConsensus) {
          state.performanceStats.goldConsensusSignals++;
          console.log(`🥇 GOLD CONSENSUS: All 3 AIs agree on ${signal.symbol} ${signal.direction}! [${regime}, MTF:${mtfScore}%]`);
        } else {
          state.performanceStats.silverConsensusSignals++;
          console.log(`🥈 SILVER CONSENSUS: ${aiSources.join(' + ')} agree on ${signal.symbol} ${signal.direction}! [${regime}, MTF:${mtfScore}%]`);
        }

        // Track prediction for stats
        state.aiPredictions.unshift({
          symbol: signal.symbol,
          direction: signal.direction,
          confidence: boostedConf,
          entry: avgEntry,
          tp: bestTP,
          sl: safestSL,
          qualityScore: qualityScore,
          aiSources: aiSources,
          isGoldConsensus: isGoldConsensus,
          isSilverConsensus: isSilverConsensus,
          isConsensus: true,
          marketRegime: regime,
          entryTrigger: primaryTrigger,
          timestamp: Date.now(),
          status: 'pending'
        });
        state.aiPredictions = state.aiPredictions.slice(0, 50); // Keep last 50
      }
    }

    // Log if no consensus found but individual AIs had picks
    if (allSignals.length === 0 && allPicks.length > 0) {
      console.log(`⚠️ No consensus: ${allPicks.length} individual picks but no 2+ AI agreement`);
      recordFilterReason('No consensus');
    }

    // Sort by gold consensus first, then silver, then confidence
    allSignals.sort((a, b) => {
      if (a.isGoldConsensus && !b.isGoldConsensus) return -1;
      if (!a.isGoldConsensus && b.isGoldConsensus) return 1;
      if (a.isSilverConsensus && !b.isSilverConsensus) return -1;
      if (!a.isSilverConsensus && b.isSilverConsensus) return 1;
      return b.confidence - a.confidence;
    });

    // Filter out signals with too small TP percentage
    const filteredSignals = allSignals.filter(signal => {
      const tpPercent = Math.abs((signal.tp - signal.entry) / signal.entry * 100);
      const symbol = signal.symbol;

      // Determine minimum TP based on symbol
      let minTP = CONFIG.MIN_TP_PERCENT_MID_CAP; // Default 7%
      if (symbol === 'BTCUSDT' || symbol === 'ETHUSDT') {
        minTP = CONFIG.MIN_TP_PERCENT_BTC_ETH; // 3%
      } else if (['BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT', 'AVAXUSDT', 'DOTUSDT', 'LINKUSDT'].includes(symbol)) {
        minTP = CONFIG.MIN_TP_PERCENT_LARGE_CAP; // 5%
      }

      // Add TP percentage to signal for display
      signal.tpPercent = tpPercent;

      if (tpPercent < minTP) {
        console.log(`⏭️ Filtered out ${symbol} - TP ${tpPercent.toFixed(1)}% below minimum ${minTP}%`);
        recordFilterReason('TP below minimum');
        return false;
      }
      return true;
    });

    if (filteredSignals.length > 0) {
      state.lastSignalSummary = '';
      state.lastAiAnalysis = { claudeAnalysis, openaiAnalysis, grokAnalysis };

      // Add to signal history (only filtered signals with good TP%)
      for (const signal of filteredSignals) {
        const existingIdx = state.signalHistory.findIndex(
          s => s.symbol === signal.symbol && s.direction === signal.direction
        );
        if (existingIdx === -1) {
          state.signalHistory.unshift({ ...signal, isNew: true });
        } else if (state.signalHistory[existingIdx].confidence !== signal.confidence) {
          state.signalHistory.splice(existingIdx, 1);
          state.signalHistory.unshift({ ...signal, isNew: true, isUpdated: true });
        }
      }
      state.signalHistory = state.signalHistory.slice(0, 100);
      saveSignalHistory(); // Persist signal history to localStorage

      state.aiSignals = filteredSignals;

      const goldCount = filteredSignals.filter(s => s.isGoldConsensus).length;
      const silverCount = filteredSignals.filter(s => s.isSilverConsensus).length;
      console.log(`🤖 AI Analysis complete: ${filteredSignals.length} signals (${goldCount} gold 🥇, ${silverCount} silver 🥈)`);

      // Show consensus notification for high-confidence signals (85%+)
      const highConfSignals = filteredSignals.filter(s => s.confidence >= CONFIG.ALERT_CONFIDENCE);
      if (highConfSignals.length > 0) {
        showConsensusNotification(highConfSignals);
      }

      // Auto-trade if enabled (prioritize consensus signals)
      if (state.aiAutoTradeEnabled) {
        await executeAiTrades();
      }

      // Update UI elements with new data
      updateAiBadges();
      renderDataView();
      updateAllSRFromAISignals();
    } else {
      state.lastSignalSummary = `No high-quality signals right now. ${summarizeFilterReasons()}`;
    }
  } catch (error) {
    console.error('AI Analysis failed:', error);
  }

  state.isAiScanning = false;
  state.nextAiScanTime = Date.now() + CONFIG.AI_SCAN_INTERVAL;
  updateAiScanCountdown();
  renderAlertBar();
}

// Show special notification for consensus signals
function showConsensusNotification(consensusSignals) {
  for (const signal of consensusSignals) {
    // Play consensus sound
    playAlertSound('consensus');

    const isGold = signal.isGoldConsensus;
    const aiList = signal.aiSources.map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' + ');
    const emoji = isGold ? '🥇' : '🥈';
    const label = isGold ? 'GOLD CONSENSUS' : 'CONSENSUS';

    // Show in-app notification
    showNotification({
      type: isGold ? 'gold-consensus' : 'consensus',
      title: `${emoji} ${label} ALERT`,
      symbol: signal.symbol,
      direction: signal.direction,
      confidence: signal.confidence,
      message: `${aiList} agree: ${signal.symbol} ${signal.direction}`,
      reasons: signal.reasons
    });

    // Send browser notification
    sendBrowserNotification(
      `${emoji} ${label}: ${signal.symbol}`,
      `${signal.aiSources.length} AIs agree: ${signal.direction} with ${signal.confidence}% confidence`,
      { symbol: signal.symbol, important: true, tag: 'consensus-' + signal.symbol }
    );

    // Send Telegram alert
    sendTelegramSignalAlert(signal);
  }
}

async function executeAiTrades() {
  const openTrades = state.trades.filter(t => t.status === 'open');

  // Check if we can open more trades
  if (openTrades.length >= CONFIG.MAX_OPEN_TRADES) {
    console.log('🤖 Max open trades reached, skipping auto-trade');
    return;
  }

  for (const signal of state.aiSignals) {
    // Skip if already have a trade for this symbol
    if (openTrades.some(t => t.symbol === signal.symbol)) continue;

    // Only trade high confidence AI signals
    if (signal.confidence < CONFIG.AI_MIN_CONFIDENCE) continue;

    // Check if we have enough balance
    const maxPositionSize = state.balance * CONFIG.MAX_POSITION_SIZE_PERCENT / 100;
    const positionSize = Math.min(
      (state.balance * CONFIG.RISK_PERCENT / 100) * CONFIG.LEVERAGE,
      maxPositionSize * CONFIG.LEVERAGE
    );

    if (positionSize < 10) {
      console.log('🤖 Insufficient balance for trade');
      continue;
    }

    // Open the trade
    const trade = {
      id: Date.now(),
      symbol: signal.symbol,
      direction: signal.direction,
      entry: signal.entry,
      tp: signal.tp,
      sl: signal.sl,
      size: positionSize,
      leverage: CONFIG.LEVERAGE,
      timestamp: Date.now(),
      status: 'open',
      pnl: 0,
      isAiTrade: true,
      aiConfidence: signal.confidence,
      aiReasoning: signal.reasons[0]
    };

    state.trades.push(trade);
    console.log(`🤖 AI Auto-Trade opened: ${signal.direction} ${signal.symbol} @ $${formatPrice(signal.entry)}`);

    showNotification({
      ...signal,
      isAutoTrade: true
    });

    saveTrades();

    // Only open one trade per AI scan
    break;
  }

  renderPositions();
  renderHistory();
  updatePortfolioStats();
}

function updateAiScanStatus(status) {
  const scanEl = document.getElementById('nextAiScan');
  if (scanEl) scanEl.textContent = status;
}

function updateAiScanCountdown() {
  if (!state.nextAiScanTime) return;

  const update = () => {
    const remaining = Math.max(0, state.nextAiScanTime - Date.now());
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    const scanEl = document.getElementById('nextAiScan');
    if (scanEl) {
      scanEl.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
  };

  update();
  setInterval(update, 1000);
}

// ============================================
// ADVANCED TECHNICAL ANALYSIS
// ============================================

function findTrendlines(candles, lookback = 50) {
  if (candles.length < lookback) return { uptrends: [], downtrends: [] };

  const recent = candles.slice(-lookback);
  const highs = recent.map((c, i) => ({ price: c.high, index: i, time: c.time }));
  const lows = recent.map((c, i) => ({ price: c.low, index: i, time: c.time }));

  // Find swing highs and lows for trendlines
  const swingHighs = [];
  const swingLows = [];

  for (let i = 2; i < recent.length - 2; i++) {
    if (recent[i].high > recent[i-1].high && recent[i].high > recent[i-2].high &&
        recent[i].high > recent[i+1].high && recent[i].high > recent[i+2].high) {
      swingHighs.push({ price: recent[i].high, index: i, time: recent[i].time });
    }
    if (recent[i].low < recent[i-1].low && recent[i].low < recent[i-2].low &&
        recent[i].low < recent[i+1].low && recent[i].low < recent[i+2].low) {
      swingLows.push({ price: recent[i].low, index: i, time: recent[i].time });
    }
  }

  // Calculate trendlines (slope between two most recent points)
  const uptrends = [];
  const downtrends = [];

  if (swingLows.length >= 2) {
    const recent2Lows = swingLows.slice(-2);
    if (recent2Lows[1].price > recent2Lows[0].price) {
      uptrends.push({
        start: recent2Lows[0],
        end: recent2Lows[1],
        slope: (recent2Lows[1].price - recent2Lows[0].price) / (recent2Lows[1].index - recent2Lows[0].index)
      });
    }
  }

  if (swingHighs.length >= 2) {
    const recent2Highs = swingHighs.slice(-2);
    if (recent2Highs[1].price < recent2Highs[0].price) {
      downtrends.push({
        start: recent2Highs[0],
        end: recent2Highs[1],
        slope: (recent2Highs[1].price - recent2Highs[0].price) / (recent2Highs[1].index - recent2Highs[0].index)
      });
    }
  }

  return { uptrends, downtrends, swingHighs, swingLows };
}

function estimateLiquidationZones(price, leverage = 10) {
  // Estimate liquidation zones for typical leveraged positions
  // Long liquidation: price drops significantly
  // Short liquidation: price rises significantly
  const longLiquidation = price * (1 - (1 / leverage) * 0.9); // ~90% of liquidation price
  const shortLiquidation = price * (1 + (1 / leverage) * 0.9);

  return {
    longLiquidationZone: { from: longLiquidation * 0.98, to: longLiquidation * 1.02 },
    shortLiquidationZone: { from: shortLiquidation * 0.98, to: shortLiquidation * 1.02 }
  };
}

function calculateVolumeProfile(candles, numBins = 20) {
  if (candles.length < 10) return [];

  const minPrice = Math.min(...candles.map(c => c.low));
  const maxPrice = Math.max(...candles.map(c => c.high));
  const binSize = (maxPrice - minPrice) / numBins;

  const profile = [];
  for (let i = 0; i < numBins; i++) {
    profile.push({
      priceFrom: minPrice + i * binSize,
      priceTo: minPrice + (i + 1) * binSize,
      volume: 0
    });
  }

  for (const candle of candles) {
    const avgPrice = (candle.high + candle.low) / 2;
    const binIndex = Math.min(Math.floor((avgPrice - minPrice) / binSize), numBins - 1);
    if (binIndex >= 0) {
      profile[binIndex].volume += candle.volume;
    }
  }

  // Find high volume nodes (HVN) and low volume nodes (LVN)
  const maxVolume = Math.max(...profile.map(p => p.volume));
  return profile.map(p => ({
    ...p,
    priceCenter: (p.priceFrom + p.priceTo) / 2,
    isHVN: p.volume > maxVolume * 0.7,
    isLVN: p.volume < maxVolume * 0.3
  }));
}

// ============================================
// SIGNAL GENERATION
// ============================================

async function analyzeMarket(symbol, timeframe = '240') {
  try {
    const candles = await fetchKlines(symbol, timeframe, 200);
    if (candles.length < 50) return null;

    const closes = candles.map(c => c.close);
    const currentPrice = closes[closes.length - 1];

    const rsi = calculateRSI(closes);
    const ema20 = calculateEMA(closes, 20);
    const ema50 = calculateEMA(closes, 50);
    const ema200 = calculateEMA(closes, 200);
    const macd = calculateMACD(closes);
    const bb = calculateBollingerBands(closes);
    const atr = calculateATR(candles);
    const { supports, resistances } = findSupportResistance(candles);

    let bullScore = 0, bearScore = 0;
    const reasons = [];

    // RSI Analysis
    if (rsi < 30) { bullScore += 20; reasons.push('RSI oversold (<30)'); }
    else if (rsi > 70) { bearScore += 20; reasons.push('RSI overbought (>70)'); }
    else if (rsi < 45) { bullScore += 10; reasons.push('RSI showing bullish momentum'); }
    else if (rsi > 55) { bearScore += 10; reasons.push('RSI showing bearish momentum'); }

    // EMA Trend
    if (currentPrice > ema200) { bullScore += 15; reasons.push('Price above EMA200 (bullish trend)'); }
    else { bearScore += 15; reasons.push('Price below EMA200 (bearish trend)'); }

    if (ema20 > ema50) { bullScore += 10; reasons.push('EMA20 > EMA50 (bullish cross)'); }
    else { bearScore += 10; reasons.push('EMA20 < EMA50 (bearish cross)'); }

    if (ema50 > ema200) { bullScore += 10; reasons.push('Golden cross zone'); }
    else { bearScore += 10; reasons.push('Death cross zone'); }

    // MACD
    if (macd.histogram > 0 && macd.macd > macd.signal) {
      bullScore += 15; reasons.push('MACD bullish crossover');
    } else if (macd.histogram < 0 && macd.macd < macd.signal) {
      bearScore += 15; reasons.push('MACD bearish crossover');
    }

    // Bollinger Bands
    if (currentPrice < bb.lower) { bullScore += 15; reasons.push('Price below lower BB'); }
    else if (currentPrice > bb.upper) { bearScore += 15; reasons.push('Price above upper BB'); }

    // Support/Resistance
    const nearestSupport = supports.find(s => currentPrice > s && (currentPrice - s) / s < 0.02);
    const nearestResistance = resistances.find(r => currentPrice < r && (r - currentPrice) / currentPrice < 0.02);

    if (nearestSupport) { bullScore += 15; reasons.push(`Near support ($${formatPrice(nearestSupport)})`); }
    if (nearestResistance) { bearScore += 15; reasons.push(`Near resistance ($${formatPrice(nearestResistance)})`); }

    // Volume analysis
    const avgVolume = candles.slice(-20).reduce((a, c) => a + c.volume, 0) / 20;
    const lastVolume = candles[candles.length - 1].volume;
    if (lastVolume > avgVolume * 1.5) {
      const lastCandle = candles[candles.length - 1];
      if (lastCandle.close > lastCandle.open) { bullScore += 10; reasons.push('High volume bullish candle'); }
      else { bearScore += 10; reasons.push('High volume bearish candle'); }
    }

    const totalScore = bullScore + bearScore;
    const direction = bullScore > bearScore ? 'LONG' : 'SHORT';
    const dominantScore = direction === 'LONG' ? bullScore : bearScore;
    const confidence = Math.min(95, Math.round((dominantScore / Math.max(totalScore, 1)) * 100));

    if (confidence < CONFIG.MIN_CONFIDENCE) return null;

    const entry = currentPrice;
    const tp = direction === 'LONG' ? entry * (1 + CONFIG.TP_PERCENT / 100) : entry * (1 - CONFIG.TP_PERCENT / 100);
    const sl = direction === 'LONG' ? entry * (1 - CONFIG.SL_PERCENT / 100) : entry * (1 + CONFIG.SL_PERCENT / 100);
    const riskReward = Math.abs(tp - entry) / Math.abs(entry - sl);

    return {
      symbol, direction, confidence, entry, tp, sl, riskReward, timeframe,
      reasons: reasons.slice(0, 5),
      indicators: { rsi, ema20, ema50, ema200, macd, bb, atr },
      levels: { supports, resistances },
      timestamp: Date.now()
    };
  } catch (error) {
    console.error(`Analysis failed for ${symbol}:`, error);
    return null;
  }
}

async function runScan() {
  // Skip traditional scan if AI is configured - AI signals are primary
  if (isAnyAiConfigured()) {
    console.log('⏭️ Skipping traditional scan - using AI signals only');
    state.isScanning = false;
    updateScanStatus(state.markets.length, state.aiSignals.length);
    renderSignals();
    return;
  }

  if (state.isScanning) return;
  state.isScanning = true;
  updateScanStatus(0, 0);

  const newSignals = [];
  const timeframes = ['240', 'D'];

  for (let i = 0; i < state.markets.length; i++) {
    const market = state.markets[i];
    updateScanStatus(i + 1, newSignals.length);

    for (const tf of timeframes) {
      const signal = await analyzeMarket(market.symbol, tf);
      if (signal) {
        const existingIdx = newSignals.findIndex(s => s.symbol === signal.symbol);
        if (existingIdx === -1 || newSignals[existingIdx].confidence < signal.confidence) {
          if (existingIdx !== -1) newSignals.splice(existingIdx, 1);
          newSignals.push(signal);
        }
      }
    }
    await sleep(50);
  }

  newSignals.sort((a, b) => b.confidence - a.confidence);
  state.signals = newSignals;

  // Add new signals to history (keep last 100)
  for (const signal of newSignals) {
    const existingIdx = state.signalHistory.findIndex(
      s => s.symbol === signal.symbol && s.direction === signal.direction
    );
    if (existingIdx === -1) {
      // New signal - add to history
      state.signalHistory.unshift({ ...signal, isNew: true });
    } else if (state.signalHistory[existingIdx].confidence !== signal.confidence) {
      // Signal updated - move to top
      state.signalHistory.splice(existingIdx, 1);
      state.signalHistory.unshift({ ...signal, isNew: true, isUpdated: true });
    }
  }
  // Keep only last 100 signals in history
  state.signalHistory = state.signalHistory.slice(0, 100);
  saveSignalHistory(); // Persist signal history to localStorage

  const highConfSignals = newSignals.filter(s => s.confidence >= CONFIG.HIGH_CONFIDENCE);
  for (const signal of highConfSignals) {
    const key = `${signal.symbol}_${signal.direction}_${signal.timeframe}`;
    if (!state.previousHighConfSignals.has(key)) {
      showNotification(signal);
      state.previousHighConfSignals.add(key);
    }
  }

  state.isScanning = false;
  renderAll();
}

// ============================================
// PAPER TRADING
// ============================================

function openTrade(signal) {
  const positionSize = (state.balance * CONFIG.RISK_PERCENT / 100) * CONFIG.LEVERAGE;
  const trade = {
    id: Date.now(),
    symbol: signal.symbol,
    direction: signal.direction,
    entry: signal.entry,
    tp: signal.tp,
    sl: signal.sl,
    size: positionSize,
    leverage: CONFIG.LEVERAGE,
    timestamp: Date.now(),
    status: 'open',
    pnl: 0
  };

  state.trades.push(trade);
  saveTrades();
  renderPositions();
  renderHistory();
  updatePortfolioStats();
}

function updateOpenPositions() {
  const openTrades = state.trades.filter(t => t.status === 'open');
  let totalUnrealizedPnl = 0;

  for (const trade of openTrades) {
    const currentPrice = state.priceCache[trade.symbol] || trade.entry;
    const priceDiff = trade.direction === 'LONG' ? currentPrice - trade.entry : trade.entry - currentPrice;
    trade.pnl = (priceDiff / trade.entry) * trade.size;
    totalUnrealizedPnl += trade.pnl;

    if (trade.direction === 'LONG') {
      if (currentPrice >= trade.tp || currentPrice <= trade.sl) closeTrade(trade, currentPrice);
    } else {
      if (currentPrice <= trade.tp || currentPrice >= trade.sl) closeTrade(trade, currentPrice);
    }
  }

  const unrealizedEl = document.getElementById('unrealizedPnl');
  if (unrealizedEl) {
    unrealizedEl.textContent = (totalUnrealizedPnl >= 0 ? '+' : '') + totalUnrealizedPnl.toFixed(2);
    unrealizedEl.className = 'stat-value ' + (totalUnrealizedPnl >= 0 ? 'green' : 'red');
  }
  renderPositions();
}

function closeTrade(trade, exitPrice) {
  trade.status = 'closed';
  trade.exitPrice = exitPrice;
  trade.closeTimestamp = Date.now();

  const priceDiff = trade.direction === 'LONG' ? exitPrice - trade.entry : trade.entry - exitPrice;
  trade.pnl = (priceDiff / trade.entry) * trade.size;

  state.balance += trade.pnl;
  state.equityHistory.push({ time: Date.now(), value: state.balance });

  saveTrades();
  renderHistory();
  updatePortfolioStats();
  updateEquityChart();
}

function updatePortfolioStats() {
  const closedTrades = state.trades.filter(t => t.status === 'closed');
  const wins = closedTrades.filter(t => t.pnl > 0).length;
  const winRate = closedTrades.length > 0 ? (wins / closedTrades.length * 100) : 0;
  const maxDrawdown = calculateMaxDrawdown();

  const equityEl = document.getElementById('equityValue');
  const winRateEl = document.getElementById('winRateValue');
  const maxDdEl = document.getElementById('maxDrawdown');
  const posCountEl = document.getElementById('positionCount');
  const histCountEl = document.getElementById('historyCount');

  if (equityEl) equityEl.textContent = '$' + state.balance.toFixed(2);
  if (winRateEl) winRateEl.textContent = winRate.toFixed(0) + '%';
  if (maxDdEl) maxDdEl.textContent = maxDrawdown.toFixed(1) + '%';
  if (posCountEl) posCountEl.textContent = state.trades.filter(t => t.status === 'open').length;
  if (histCountEl) histCountEl.textContent = closedTrades.length;
}

function calculateMaxDrawdown() {
  if (state.equityHistory.length < 2) return 0;
  let peak = state.equityHistory[0].value;
  let maxDd = 0;

  for (const point of state.equityHistory) {
    if (point.value > peak) peak = point.value;
    const dd = (peak - point.value) / peak * 100;
    if (dd > maxDd) maxDd = dd;
  }
  return maxDd;
}

// ============================================
// WEBSOCKET FOR REAL-TIME PRICES
// ============================================

function initWebSocket() {
  if (state.wsConnection) state.wsConnection.close();

  const symbols = state.markets.slice(0, 20).map(m => m.symbol.toLowerCase());
  const streams = symbols.map(s => `${s}@ticker`).join('/');

  try {
    state.wsConnection = new WebSocket(`wss://fstream.binance.com/stream?streams=${streams}`);

    state.wsConnection.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.data) {
        const ticker = data.data;
        const symbol = ticker.s;
        const currentPrice = parseFloat(ticker.c);
        state.priceCache[symbol] = currentPrice;

        const market = state.markets.find(m => m.symbol === symbol);
        if (market) {
          market.price = currentPrice;
          market.change = parseFloat(ticker.P);
        }

        if (symbol === state.selectedSymbol) {
          updateChartPrice(currentPrice, parseFloat(ticker.P));
        }

        evaluateAiPredictions(symbol, currentPrice);
      }
    };

    state.wsConnection.onerror = () => {
      console.warn('WebSocket error, falling back to polling');
      startPricePolling();
    };

    state.wsConnection.onclose = () => setTimeout(initWebSocket, 5000);
  } catch (error) {
    console.error('WebSocket init failed:', error);
    startPricePolling();
  }
}

function startPricePolling() {
  setInterval(async () => {
    try {
      const markets = await fetchMarkets();
      state.markets = markets;
      for (const m of markets) {
        state.priceCache[m.symbol] = m.price;
        evaluateAiPredictions(m.symbol, m.price);
      }
      renderMarkets();
    } catch (error) {
      console.error('Price polling failed:', error);
    }
  }, 5000);
}

// ============================================
// CHART RENDERING
// ============================================

function initChart() {
  const container = document.getElementById('tradingChart');
  if (!container || typeof LightweightCharts === 'undefined') {
    console.error('Chart container or LightweightCharts not available');
    return;
  }

  container.innerHTML = '';

  state.chart = LightweightCharts.createChart(container, {
    width: container.clientWidth,
    height: container.clientHeight,
    layout: {
      background: { type: 'solid', color: '#111820' },
      textColor: '#8b949e'
    },
    grid: {
      vertLines: { color: 'rgba(255, 255, 255, 0.03)' },
      horzLines: { color: 'rgba(255, 255, 255, 0.03)' }
    },
    crosshair: {
      mode: LightweightCharts.CrosshairMode.Normal,
      vertLine: { color: 'rgba(124, 92, 255, 0.4)', width: 1, style: 2 },
      horzLine: { color: 'rgba(124, 92, 255, 0.4)', width: 1, style: 2 }
    },
    rightPriceScale: {
      borderColor: 'rgba(255, 255, 255, 0.1)',
      scaleMargins: { top: 0.1, bottom: 0.2 }
    },
    timeScale: {
      borderColor: 'rgba(255, 255, 255, 0.1)',
      timeVisible: true,
      secondsVisible: false
    }
  });

  state.candleSeries = state.chart.addCandlestickSeries({
    upColor: '#3fb950',
    downColor: '#f85149',
    borderUpColor: '#3fb950',
    borderDownColor: '#f85149',
    wickUpColor: '#3fb950',
    wickDownColor: '#f85149'
  });

  // Add EMA lines (hidden by default, toggle with IND button)
  state.ema20Series = state.chart.addLineSeries({
    color: '#58a6ff',
    lineWidth: 1,
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false,
    visible: false
  });

  state.ema50Series = state.chart.addLineSeries({
    color: '#d29922',
    lineWidth: 1,
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false,
    visible: false
  });

  state.ema200Series = state.chart.addLineSeries({
    color: '#a371f7',
    lineWidth: 2,
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false,
    visible: false
  });

  // Hide legend by default
  setTimeout(() => {
    const legend = document.querySelector('.chart-legend');
    if (legend) legend.style.display = 'none';
  }, 100);

  state.volumeSeries = state.chart.addHistogramSeries({
    color: '#7c5cff',
    priceFormat: { type: 'volume' },
    priceScaleId: '',
    scaleMargins: { top: 0.85, bottom: 0 }
  });

  new ResizeObserver(() => {
    if (state.chart) {
      state.chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
    }
  }).observe(container);

  loadChartData();
}

async function loadChartData() {
  // Load more candles for longer history view
  const candles = await fetchKlines(state.selectedSymbol, state.currentTimeframe, CONFIG.CHART_HISTORY_LIMIT);
  if (candles.length === 0 || !state.candleSeries || !state.chart) return;

  // CRITICAL: Reset price scale to auto-scale for new data range
  state.chart.priceScale('right').applyOptions({
    autoScale: true,
    scaleMargins: { top: 0.1, bottom: 0.2 }
  });

  // Reset time scale before loading new data
  state.chart.timeScale().resetTimeScale();

  // Set candle data
  state.candleSeries.setData(candles);

  // Set volume data
  state.volumeSeries.setData(candles.map(c => ({
    time: c.time,
    value: c.volume,
    color: c.close >= c.open ? 'rgba(63, 185, 80, 0.3)' : 'rgba(248, 81, 73, 0.3)'
  })));

  // Calculate and display EMAs
  const closes = candles.map(c => c.close);

  // EMA 20
  const ema20Data = [];
  if (closes.length >= 20) {
    let ema20 = closes.slice(0, 20).reduce((a, b) => a + b, 0) / 20;
    for (let i = 20; i < candles.length; i++) {
      ema20 = closes[i] * (2 / 21) + ema20 * (1 - 2 / 21);
      ema20Data.push({ time: candles[i].time, value: ema20 });
    }
  }
  if (state.ema20Series) state.ema20Series.setData(ema20Data);

  // EMA 50
  const ema50Data = [];
  if (closes.length >= 50) {
    let ema50 = closes.slice(0, 50).reduce((a, b) => a + b, 0) / 50;
    for (let i = 50; i < candles.length; i++) {
      ema50 = closes[i] * (2 / 51) + ema50 * (1 - 2 / 51);
      ema50Data.push({ time: candles[i].time, value: ema50 });
    }
  }
  if (state.ema50Series) state.ema50Series.setData(ema50Data);

  // EMA 200
  const ema200Data = [];
  if (closes.length >= 200) {
    let ema200 = closes.slice(0, 200).reduce((a, b) => a + b, 0) / 200;
    for (let i = 200; i < candles.length; i++) {
      ema200 = closes[i] * (2 / 201) + ema200 * (1 - 2 / 201);
      ema200Data.push({ time: candles[i].time, value: ema200 });
    }
  }
  if (state.ema200Series) state.ema200Series.setData(ema200Data);

  // Draw support/resistance lines
  if (state.showSR) {
    const { supports, resistances } = findSupportResistance(candles);
    updateChartLevels(supports, resistances, candles[candles.length - 1].close);
  }

  // Load user-drawn lines for this symbol
  loadUserLines();

  // Fit content with a small delay to ensure data is rendered
  setTimeout(() => {
    if (state.chart) {
      state.chart.timeScale().fitContent();
    }
  }, 50);
}

function updateChartLevels(supports, resistances, currentPrice) {
  // Update the side panel levels
  const container = document.getElementById('chartLevels');
  if (container) {
    container.innerHTML = '';

    const allLevels = [
      ...resistances.map(p => ({ price: p, type: 'resistance' })),
      { price: currentPrice, type: 'current' },
      ...supports.map(p => ({ price: p, type: 'support' }))
    ].sort((a, b) => b.price - a.price);

    for (const level of allLevels.slice(0, 5)) {
      const marker = document.createElement('div');
      marker.className = `level-marker ${level.type}`;
      marker.textContent = formatPrice(level.price);
      container.appendChild(marker);
    }
  }

  // Draw horizontal lines on the chart
  drawSupportResistanceLines(supports, resistances);
}

// User-drawn lines management
function addUserLine(price) {
  if (!state.candleSeries) return;

  const line = state.candleSeries.createPriceLine({
    price: price,
    color: '#d29922', // Yellow for user lines
    lineWidth: 2,
    lineStyle: LightweightCharts.LineStyle.Solid,
    axisLabelVisible: true,
    title: 'User',
    lineVisible: true,
    axisLabelColor: '#d29922',
    axisLabelTextColor: '#ffffff'
  });

  state.userLines.push(line);
  console.log(`📏 User line added at $${formatPrice(price)}`);

  // Save user lines to localStorage
  saveUserLines();
}

function clearUserLines() {
  if (!state.candleSeries || state.userLines.length === 0) return;

  state.userLines.forEach(line => {
    try {
      state.candleSeries.removePriceLine(line);
    } catch (e) {
      // Line might already be removed
    }
  });

  state.userLines = [];
  localStorage.removeItem(`user_lines_${state.selectedSymbol}`);
  console.log('📏 User lines cleared');
}

function saveUserLines() {
  const prices = state.userLines.map(line => {
    try {
      return line.options().price;
    } catch (e) {
      return null;
    }
  }).filter(p => p !== null);

  localStorage.setItem(`user_lines_${state.selectedSymbol}`, JSON.stringify(prices));
}

function loadUserLines() {
  if (!state.candleSeries) return;

  // Clear existing user lines first
  state.userLines.forEach(line => {
    try {
      state.candleSeries.removePriceLine(line);
    } catch (e) {}
  });
  state.userLines = [];

  // Load saved lines for this symbol
  try {
    const saved = localStorage.getItem(`user_lines_${state.selectedSymbol}`);
    if (saved) {
      const prices = JSON.parse(saved);
      for (const price of prices) {
        const line = state.candleSeries.createPriceLine({
          price: price,
          color: '#d29922',
          lineWidth: 2,
          lineStyle: LightweightCharts.LineStyle.Solid,
          axisLabelVisible: true,
          title: 'User',
          lineVisible: true,
          axisLabelColor: '#d29922',
          axisLabelTextColor: '#ffffff'
        });
        state.userLines.push(line);
      }
    }
  } catch (e) {
    console.error('Failed to load user lines:', e);
  }
}

function drawSupportResistanceLines(supports, resistances) {
  if (!state.candleSeries) return;

  // Remove existing price lines
  if (state.srLines && state.srLines.length > 0) {
    state.srLines.forEach(line => {
      try {
        state.candleSeries.removePriceLine(line);
      } catch (e) {
        // Line might already be removed
      }
    });
  }
  state.srLines = [];

  if (!state.showSR) return;

  // Draw resistance lines (red)
  resistances.forEach((price, index) => {
    const line = state.candleSeries.createPriceLine({
      price: price,
      color: '#f85149',
      lineWidth: 2,
      lineStyle: LightweightCharts.LineStyle.Dashed,
      axisLabelVisible: true,
      title: `R${index + 1}`,
      lineVisible: true,
      axisLabelColor: '#f85149',
      axisLabelTextColor: '#ffffff'
    });
    state.srLines.push(line);
  });

  // Draw support lines (green)
  supports.forEach((price, index) => {
    const line = state.candleSeries.createPriceLine({
      price: price,
      color: '#3fb950',
      lineWidth: 2,
      lineStyle: LightweightCharts.LineStyle.Dashed,
      axisLabelVisible: true,
      title: `S${index + 1}`,
      lineVisible: true,
      axisLabelColor: '#3fb950',
      axisLabelTextColor: '#ffffff'
    });
    state.srLines.push(line);
  });
}

function updateChartPrice(price, change) {
  const priceEl = document.getElementById('chartPrice');
  const changeEl = document.getElementById('chartChange');
  if (priceEl) priceEl.textContent = '$' + formatPrice(price);
  if (changeEl) {
    changeEl.textContent = formatPercent(change);
    changeEl.className = 'chart-change ' + (change >= 0 ? 'up' : 'down');
  }
}

function initEquityChart() {
  const container = document.getElementById('equityChart');
  if (!container || typeof LightweightCharts === 'undefined') return;

  state.equityChart = LightweightCharts.createChart(container, {
    width: container.clientWidth,
    height: 120,
    layout: { background: { type: 'solid', color: '#111820' }, textColor: '#8b949e' },
    grid: { vertLines: { visible: false }, horzLines: { color: 'rgba(255, 255, 255, 0.03)' } },
    rightPriceScale: { visible: false },
    timeScale: { visible: false },
    crosshair: { mode: LightweightCharts.CrosshairMode.Hidden }
  });

  state.equitySeries = state.equityChart.addAreaSeries({
    lineColor: '#7c5cff',
    topColor: 'rgba(124, 92, 255, 0.3)',
    bottomColor: 'rgba(124, 92, 255, 0.05)',
    lineWidth: 2
  });

  updateEquityChart();
}

function updateEquityChart() {
  if (!state.equitySeries) return;

  const data = state.equityHistory.map(p => ({
    time: Math.floor(p.time / 1000),
    value: p.value
  }));

  if (data.length > 0) {
    state.equitySeries.setData(data);
    state.equityChart.timeScale().fitContent();
  }
}

// ============================================
// UI RENDERING
// ============================================

function renderMarkets() {
  const container = document.getElementById('marketList');
  if (!container) return;

  if (!state.markets.length) {
    const message = state.marketLoadStatus === 'error'
      ? state.marketLoadError
      : 'Loading markets...';
    container.innerHTML = `<div class="empty-state">${message}</div>`;
    return;
  }

  const html = state.markets.map(market => {
    const signal = state.signals.find(s => s.symbol === market.symbol);
    const isActive = market.symbol === state.selectedSymbol;

    let classes = 'market-item';
    if (isActive) classes += ' active';
    if (signal) classes += ` has-signal ${signal.direction.toLowerCase()}`;

    return `
      <div class="${classes}" data-symbol="${market.symbol}">
        <div class="market-row">
          <span class="market-symbol">${market.symbol.replace('USDT', '')}</span>
          <span class="market-change ${market.change >= 0 ? 'up' : 'down'}">${formatPercent(market.change)}</span>
        </div>
        <div class="market-meta">
          <span class="market-price">$${formatPrice(market.price)}</span>
          <span class="market-volume">Vol: ${formatVolume(market.volume)}</span>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = html;
  container.querySelectorAll('.market-item').forEach(el => {
    el.addEventListener('click', () => selectMarket(el.dataset.symbol));
  });
}

// Signal decay warning - shown when signal is getting old
function getSignalDecayWarning(signal) {
  const ageMinutes = (Date.now() - signal.timestamp) / 60000;

  if (ageMinutes < 30) return '';

  const decayLevel = ageMinutes < 60 ? 'moderate' : 'high';
  const confReduction = ageMinutes < 60 ? '5-10%' : '15-25%';

  return `
    <div class="signal-decay ${decayLevel}">
      <span class="decay-icon">⏳</span>
      <span class="decay-text">Signal aging - confidence may be ${confReduction} lower</span>
      <span class="decay-time">${Math.floor(ageMinutes)}m ago</span>
    </div>
  `;
}

// Funding rate alert - shown when funding is extreme
function getFundingRateAlert(symbol) {
  const fundingRate = state.fundingRates[symbol];
  if (!fundingRate) return '';

  const rate = parseFloat(fundingRate);
  const isExtreme = Math.abs(rate) > 0.1; // 0.1% threshold

  if (!isExtreme) return '';

  const direction = rate > 0 ? 'extreme-long' : 'extreme-short';
  const implication = rate > 0
    ? '🔻 Longs paying shorts - potential short squeeze'
    : '🔺 Shorts paying longs - potential long squeeze';

  return `
    <div class="funding-alert ${direction}">
      <div class="funding-header">
        <span class="funding-label">⚡ Extreme Funding</span>
        <span class="funding-rate-value ${rate > 0 ? 'positive' : 'negative'}">${rate > 0 ? '+' : ''}${(rate * 100).toFixed(4)}%</span>
      </div>
      <div class="funding-implication">${implication}</div>
    </div>
  `;
}

// Market regime detection
function detectMarketRegime(candles) {
  if (!candles || candles.length < 50) return 'UNKNOWN';

  const closes = candles.map(c => c.close);
  const ema20 = calculateEMA(closes, 20);
  const ema50 = calculateEMA(closes, 50);
  const atr = calculateATR(candles);

  const price = closes[closes.length - 1];
  const avgPrice = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const volatility = (atr / avgPrice) * 100;

  // High volatility = volatile market
  if (volatility > 5) return 'VOLATILE';

  // Strong trends
  if (ema20 > ema50 * 1.02) return 'TRENDING_UP';
  if (ema20 < ema50 * 0.98) return 'TRENDING_DOWN';

  // Otherwise ranging
  return 'RANGING';
}

function renderSignals() {
  const container = document.getElementById('signalsList');
  if (!container) return;
  const banner = document.getElementById('signalStatusBanner');

  // When AI is configured, use AI signals; otherwise fall back to traditional signals
  // "new" tab uses signalHistory (which includes AI signals), "all" tab uses aiSignals or signals
  let signals;
  if (isAnyAiConfigured()) {
    signals = state.signalTab === 'new' ? state.signalHistory.filter(s => s.isAiGenerated) : state.aiSignals;
  } else {
    signals = state.signalTab === 'new' ? state.signalHistory : state.signals;
  }

  if (state.signalFilter === 'longs') signals = signals.filter(s => s.direction === 'LONG');
  else if (state.signalFilter === 'shorts') signals = signals.filter(s => s.direction === 'SHORT');

  if (signals.length === 0) {
    const apiStatus = isAnyAiConfigured();
    if (!apiStatus) {
      container.innerHTML = `
        <div class="empty-state api-setup">
          <h3>🔑 Setup AI Analysis</h3>
          <p>Open browser console (F12) and run:</p>
          <code>setApiKey("claude", "sk-ant-...")</code>
          <code>setApiKey("openai", "sk-...")</code>
          <p class="optional">Optional data sources:</p>
          <code>setApiKey("lunarcrush", "key")</code>
          <code>setApiKey("coinglass", "key")</code>
          <p class="links">
            Get keys at:<br>
            <a href="https://console.anthropic.com" target="_blank">console.anthropic.com</a><br>
            <a href="https://platform.openai.com" target="_blank">platform.openai.com</a>
          </p>
        </div>`;
      if (banner) banner.style.display = 'none';
    } else {
      const aiCount = countConfiguredAIs();
      if (aiCount < 2) {
        container.innerHTML = '<div class="empty-state">⚠️ Configure at least 2 AI services for consensus signals.<br><br>Go to Settings (⚙️) to add API keys.</div>';
      } else {
        container.innerHTML = '<div class="empty-state">Waiting for AI consensus... Next scan in a few minutes.<br><br>🥇 Gold = All 3 AIs agree<br>🥈 Silver = 2 AIs agree</div>';
      }
      if (banner) {
        const message = state.lastSignalSummary || 'No AI signals available yet.';
        banner.innerHTML = `<span class="banner-icon">⚠️</span><strong>No Trade:</strong> ${message}`;
        banner.style.display = 'flex';
      }
    }
    return;
  }

  if (banner) banner.style.display = 'none';

  // For "new" tab, show recent signals first (already sorted by time)
  // For "all" tab, sort by confidence
  if (state.signalTab === 'all') {
    signals = [...signals].sort((a, b) => b.confidence - a.confidence);
  }

  container.innerHTML = signals.map(signal => {
    const isRecent = Date.now() - signal.timestamp < 300000; // 5 minutes
    const isNew = signal.isNew && isRecent;
    const hasOpenTrade = state.trades.some(t => t.status === 'open' && t.symbol === signal.symbol);
    const qualityScore = signal.qualityScore ?? Math.round(signal.confidence || 0);
    const qualityClass = qualityScore >= 80 ? 'quality-high' : qualityScore >= 65 ? 'quality-mid' : 'quality-low';

    // Build AI source badge
    let aiSourceBadge = '';
    if (signal.isAiGenerated) {
      const hasClaude = signal.aiSources?.includes('claude');
      const hasOpenAI = signal.aiSources?.includes('openai');
      const hasGrok = signal.aiSources?.includes('grok');

      if (signal.isGoldConsensus) {
        // GOLD consensus - all 3 AIs agree
        aiSourceBadge = `
          <div class="gold-consensus-badge">
            <span class="gold-icon">🥇</span>
            <span class="gold-label">GOLD CONSENSUS</span>
            <div class="ai-trio">
              <span class="claude">Claude</span>
              <span class="openai">GPT-4o</span>
              <span class="grok">Grok</span>
            </div>
          </div>`;
      } else if (signal.isSilverConsensus || signal.isConsensus) {
        // Silver consensus - 2 AIs agree
        const aiModels = [];
        if (hasClaude) aiModels.push('<span class="ai-model claude">Claude</span>');
        if (hasOpenAI) aiModels.push('<span class="ai-model openai">GPT-4o</span>');
        if (hasGrok) aiModels.push('<span class="ai-model grok">Grok</span>');

        aiSourceBadge = `
          <div class="silver-consensus-badge">
            <span class="silver-icon">🥈</span>
            <span class="silver-label">CONSENSUS</span>
            <div class="ai-models">
              ${aiModels.join('')}
            </div>
            ${signal.marketSentiment ? `<span class="sentiment ${signal.marketSentiment.toLowerCase()}">${signal.marketSentiment}</span>` : ''}
          </div>`;
      } else if (hasClaude) {
        const modelShort = signal.claudeModel ? signal.claudeModel.replace('claude-', '').replace('-20241022', '') : '3.5-sonnet';
        aiSourceBadge = `
          <div class="claude-model-badge">
            <span class="model-icon">🧠</span>
            <span class="model-name">Claude ${modelShort}</span>
            ${signal.marketSentiment ? `<span class="sentiment ${signal.marketSentiment.toLowerCase()}">${signal.marketSentiment}</span>` : ''}
          </div>`;
      } else if (hasOpenAI) {
        const modelShort = signal.openaiModel ? signal.openaiModel.replace('gpt-', 'GPT-').replace('-preview', '') : 'GPT-4o';
        aiSourceBadge = `
          <div class="openai-model-badge">
            <span class="model-icon">🤖</span>
            <span class="model-name">${modelShort}</span>
            ${signal.marketSentiment ? `<span class="sentiment ${signal.marketSentiment.toLowerCase()}">${signal.marketSentiment}</span>` : ''}
          </div>`;
      } else if (hasGrok) {
        aiSourceBadge = `
          <div class="grok-model-badge">
            <span class="model-icon">⚡</span>
            <span class="model-name">Grok</span>
            ${signal.marketSentiment ? `<span class="sentiment ${signal.marketSentiment.toLowerCase()}">${signal.marketSentiment}</span>` : ''}
          </div>`;
      } else {
        // Fallback for AI signals without specific source info
        aiSourceBadge = `
          <div class="claude-model-badge">
            <span class="model-icon">🤖</span>
            <span class="model-name">AI Analysis</span>
            ${signal.marketSentiment ? `<span class="sentiment ${signal.marketSentiment.toLowerCase()}">${signal.marketSentiment}</span>` : ''}
          </div>`;
      }
    }

    const consensusClass = signal.isGoldConsensus ? 'gold-consensus' : (signal.isSilverConsensus ? 'silver-consensus' : (signal.isConsensus ? 'consensus-signal' : ''));
    const consensusBadge = signal.isGoldConsensus ? '<span class="gold-badge">🥇 GOLD</span>' :
                           (signal.isSilverConsensus ? '<span class="silver-badge">🥈 CONSENSUS</span>' : '');

    return `
    <div class="signal-card ${signal.direction.toLowerCase()} ${isNew ? 'new-signal' : ''} ${consensusClass}" data-symbol="${signal.symbol}">
      <div class="signal-header">
        <div class="signal-symbol-info">
          <span class="signal-symbol">${signal.symbol.replace('USDT', '')}</span>
          <span class="signal-direction ${signal.direction.toLowerCase()}">${signal.direction}</span>
          ${consensusBadge}
          ${isNew && !signal.isConsensus && !signal.isGoldConsensus && !signal.isSilverConsensus ? '<span class="new-badge">NEW</span>' : ''}
          ${signal.isUpdated ? '<span class="updated-badge">UPDATED</span>' : ''}
          ${hasOpenTrade ? '<span class="trading-badge">TRADING</span>' : ''}
        </div>
        <div class="signal-confidence">
          <span class="conf-label">Confidence:</span>
          <span class="conf-value">${signal.confidence}%</span>
          <span class="signal-quality-badge ${qualityClass}">Q${qualityScore}</span>
          <span class="signal-time">${timeAgo(signal.timestamp)}</span>
        </div>
      </div>
      <div class="signal-body">
        ${aiSourceBadge}
        <div class="signal-tags">
          ${signal.reasons.slice(0, 4).map((r, i) =>
            `<span class="signal-tag ${i < 2 ? 'active' : ''}">${r.length > 50 ? r.substring(0, 50) + '...' : r}</span>`
          ).join('')}
        </div>
        <div class="signal-analysis">${signal.reasons.slice(0, 2).join('. ')}</div>
        <div class="signal-levels">
          <div class="level-item tp-pct"><div class="level-label">Target %</div><div class="level-value ${signal.tpPercent >= 5 ? 'green' : 'yellow'}">${signal.tpPercent ? '+' + signal.tpPercent.toFixed(1) + '%' : '+' + Math.abs((signal.tp - signal.entry) / signal.entry * 100).toFixed(1) + '%'}</div></div>
          <div class="level-item entry"><div class="level-label">Entry</div><div class="level-value">${formatPrice(signal.entry)}</div></div>
          <div class="level-item target"><div class="level-label">Target</div><div class="level-value">${formatPrice(signal.tp)}</div></div>
          <div class="level-item stop"><div class="level-label">Stop</div><div class="level-value">${formatPrice(signal.sl)}</div></div>
        </div>
        ${signal.entryTrigger || signal.marketRegime || signal.mtfScore ? `
        <div class="signal-intel entry-intel">
          ${signal.entryTrigger ? `
          <div class="intel-item trigger-${signal.entryTrigger.toLowerCase()}">
            <span class="intel-icon">🎯</span>
            <span class="intel-label">Entry</span>
            <span class="intel-value">${signal.entryTrigger}</span>
          </div>
          ` : ''}
          ${signal.marketRegime && signal.marketRegime !== 'UNKNOWN' ? `
          <div class="intel-item regime-${signal.marketRegime.toLowerCase().replace('_', '-')}">
            <span class="intel-icon">📊</span>
            <span class="intel-label">Regime</span>
            <span class="intel-value">${signal.marketRegime.replace('_', ' ')}</span>
          </div>
          ` : ''}
          ${signal.mtfScore ? `
          <div class="intel-item mtf-${signal.mtfScore >= 75 ? 'strong' : signal.mtfScore >= 50 ? 'partial' : 'weak'}">
            <span class="intel-icon">📈</span>
            <span class="intel-label">MTF</span>
            <span class="intel-value">${signal.mtfScore.toFixed(0)}% ${signal.mtfConfluence || ''}</span>
          </div>
          ` : ''}
        </div>
        ` : ''}
        ${signal.entryCondition ? `
        <div class="entry-condition">
          <span class="condition-label">📋 When to enter:</span>
          <span class="condition-text">${signal.entryCondition}</span>
        </div>
        ` : ''}
        ${signal.dissentingAi && signal.isSilverConsensus ? `
        <div class="dissenting-ai ${signal.dissentingAi.type === 'OPPOSITE_DIRECTION' ? 'warning' : 'neutral'}">
          <div class="dissent-header">
            <span class="dissent-icon">${signal.dissentingAi.type === 'OPPOSITE_DIRECTION' ? '⚠️' : signal.dissentingAi.type === 'NO_SIGNAL' ? '🤷' : '🤔'}</span>
            <span class="dissent-label">3rd AI (${signal.dissentingAi.source.charAt(0).toUpperCase() + signal.dissentingAi.source.slice(1)}):</span>
          </div>
          <div class="dissent-content">
            ${signal.dissentingAi.type === 'OPPOSITE_DIRECTION' ? `
              <span class="dissent-direction ${signal.dissentingAi.direction.toLowerCase()}">${signal.dissentingAi.direction}</span> at ${formatPrice(signal.dissentingAi.entry)} (${signal.dissentingAi.confidence}%)
            ` : signal.dissentingAi.type === 'DIFFERENT_ENTRY' ? `
              Same direction, different entry: ${formatPrice(signal.dissentingAi.entry)}
            ` : `
              Did not signal this coin
            `}
          </div>
          ${signal.dissentingAi.reasoning && signal.dissentingAi.type !== 'NO_SIGNAL' ? `
          <div class="dissent-reason">${signal.dissentingAi.reasoning.substring(0, 80)}${signal.dissentingAi.reasoning.length > 80 ? '...' : ''}</div>
          ` : ''}
        </div>
        ` : ''}
        ${(state.socialSentiment[signal.symbol] || state.liquidationData[signal.symbol]) ? `
        <div class="signal-intel">
          ${state.socialSentiment[signal.symbol] ? `
          <div class="intel-item sentiment-${state.socialSentiment[signal.symbol].sentimentLabel.toLowerCase()}">
            <span class="intel-icon">🌙</span>
            <span class="intel-label">Sentiment</span>
            <span class="intel-value">${state.socialSentiment[signal.symbol].sentimentLabel} (${state.socialSentiment[signal.symbol].sentiment})</span>
          </div>
          ` : ''}
          ${state.liquidationData[signal.symbol]?.crowdBias ? `
          <div class="intel-item crowd-${state.liquidationData[signal.symbol].crowdBias.toLowerCase().replace('_', '-')}">
            <span class="intel-icon">👥</span>
            <span class="intel-label">Crowd</span>
            <span class="intel-value">${state.liquidationData[signal.symbol].crowdBias.replace('_', ' ')}</span>
          </div>
          ` : ''}
          ${state.liquidationData[signal.symbol]?.priceImplication && state.liquidationData[signal.symbol].priceImplication !== 'NEUTRAL' ? `
          <div class="intel-item liq-${state.liquidationData[signal.symbol].priceImplication.toLowerCase().replace('_', '-')}">
            <span class="intel-icon">💧</span>
            <span class="intel-label">Liqs</span>
            <span class="intel-value">${state.liquidationData[signal.symbol].priceImplication.replace('_', ' ')}</span>
          </div>
          ` : ''}
        </div>
        ` : ''}
      </div>
      ${getSignalDecayWarning(signal)}
      ${getFundingRateAlert(signal.symbol)}
      <div class="signal-footer">
        <div class="footer-stat"><div class="label">Risk ($)</div><div class="value">${(state.balance * CONFIG.RISK_PERCENT / 100).toFixed(0)}</div></div>
        <div class="footer-stat"><div class="label">Size</div><div class="value green">$${(state.balance * CONFIG.RISK_PERCENT / 100 * CONFIG.LEVERAGE).toFixed(0)}</div></div>
        <div class="footer-stat">
          <div class="label">Status</div>
          <div class="value ${hasOpenTrade ? 'green' : signal.isGoldConsensus ? 'gold' : signal.isSilverConsensus ? 'silver' : signal.confidence >= CONFIG.AI_MIN_CONFIDENCE ? 'cyan' : ''}">${hasOpenTrade ? '✓ In Trade' : signal.isGoldConsensus ? '🥇 Gold' : signal.isSilverConsensus ? '🥈 Priority' : signal.confidence >= CONFIG.AI_MIN_CONFIDENCE ? 'Auto-Trade' : 'Watching'}</div>
        </div>
        <button class="telegram-send-btn" data-symbol="${signal.symbol}" data-direction="${signal.direction}" title="Send to Telegram">
          📤 Telegram
        </button>
      </div>
    </div>
  `}).join('');

  container.querySelectorAll('.signal-card').forEach(el => {
    el.addEventListener('click', (e) => {
      // Don't navigate if clicking buttons
      if (e.target.classList.contains('take-trade-btn') || e.target.classList.contains('telegram-send-btn')) return;
      selectMarket(el.dataset.symbol);
    });
  });

  // Take Trade button handlers
  container.querySelectorAll('.take-trade-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const symbol = btn.dataset.symbol;
      const direction = btn.dataset.direction;
      const signal = signals.find(s => s.symbol === symbol && s.direction === direction);
      if (signal) {
        openTrade(signal);
        btn.textContent = '✓ Opened';
        btn.disabled = true;
        btn.classList.add('traded');
      }
    });
  });

  // Manual Telegram send button handlers
  container.querySelectorAll('.telegram-send-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const symbol = btn.dataset.symbol;
      const direction = btn.dataset.direction;
      const signal = signals.find(s => s.symbol === symbol && s.direction === direction);

      if (signal) {
        btn.disabled = true;
        btn.textContent = '📤 Sending...';

        const success = await sendSignalToTelegramManual(signal);

        if (success) {
          btn.textContent = '✅ Sent!';
          btn.classList.add('sent');
          setTimeout(() => {
            btn.textContent = '📤 Telegram';
            btn.disabled = false;
            btn.classList.remove('sent');
          }, 3000);
        } else {
          btn.textContent = '❌ Failed';
          setTimeout(() => {
            btn.textContent = '📤 Telegram';
            btn.disabled = false;
          }, 2000);
        }
      }
    });
  });
}

// ============================================
// DATA VIEW RENDERING (Coinglass/LunarCrush)
// ============================================

function renderDataView() {
  renderLiquidationData();
  renderLongShortRatio();
  renderSentimentData();
}

function renderLiquidationData() {
  const container = document.getElementById('liquidationList');
  if (!container) return;

  const data = Object.entries(state.liquidationData).slice(0, 10);

  if (data.length === 0 || !isCoinglassConfigured()) {
    container.innerHTML = `
      <div class="empty-state">
        <p>Configure Coinglass API in Settings</p>
        <p class="hint">Get key at coinglass.com/api</p>
      </div>`;
    return;
  }

  container.innerHTML = data.map(([symbol, liq]) => {
    const signalClass = liq.priceImplication === 'POTENTIAL_BOTTOM' ? 'bottom' :
                        liq.priceImplication === 'POTENTIAL_TOP' ? 'top' : '';
    return `
      <div class="liq-item">
        <span class="symbol">${symbol.replace('USDT', '')}</span>
        <div class="data">
          <span class="longs">L: $${formatVolume(liq.longLiquidations24h || 0)}</span>
          <span class="shorts">S: $${formatVolume(liq.shortLiquidations24h || 0)}</span>
          ${signalClass ? `<span class="signal ${signalClass}">${liq.priceImplication?.replace('POTENTIAL_', '')}</span>` : ''}
        </div>
      </div>
    `;
  }).join('');

  // Update timestamp
  const updateEl = document.getElementById('liqDataUpdate');
  if (updateEl && data.length > 0) {
    const lastUpdate = data[0][1].timestamp;
    updateEl.textContent = lastUpdate ? timeAgo(lastUpdate) : '--';
  }
}

function renderLongShortRatio() {
  const container = document.getElementById('lsRatioList');
  if (!container) return;

  const data = Object.entries(state.liquidationData)
    .filter(([_, d]) => d.longPercent && d.shortPercent)
    .slice(0, 8);

  if (data.length === 0) {
    container.innerHTML = '<div class="empty-state">No data available</div>';
    return;
  }

  container.innerHTML = data.map(([symbol, d]) => {
    const longPct = d.longPercent || 50;
    const shortPct = d.shortPercent || 50;
    return `
      <div class="ls-item">
        <span class="symbol">${symbol.replace('USDT', '')}</span>
        <span class="pct long">${longPct.toFixed(0)}%</span>
        <div class="ratio-bar">
          <div class="long-fill" style="width: ${longPct}%"></div>
          <div class="short-fill" style="width: ${shortPct}%"></div>
        </div>
        <span class="pct short">${shortPct.toFixed(0)}%</span>
      </div>
    `;
  }).join('');
}

function renderSentimentData() {
  const container = document.getElementById('sentimentList');
  if (!container) return;

  const data = Object.entries(state.socialSentiment).slice(0, 8);

  if (data.length === 0 || !isLunarCrushConfigured()) {
    container.innerHTML = `
      <div class="empty-state">
        <p>Configure LunarCrush API in Settings</p>
        <p class="hint">Get key at lunarcrush.com/developers</p>
      </div>`;
    return;
  }

  container.innerHTML = data.map(([symbol, s]) => {
    const galaxyClass = s.galaxyScore >= 70 ? 'high' : s.galaxyScore >= 40 ? 'medium' : 'low';
    const moodClass = s.sentimentLabel?.toLowerCase() || 'neutral';
    return `
      <div class="sentiment-item">
        <span class="symbol">${symbol.replace('USDT', '')}</span>
        <div class="score">
          <span class="galaxy ${galaxyClass}">${s.galaxyScore || 0}</span>
          <span class="mood ${moodClass}">${s.sentimentLabel || 'NEUTRAL'}</span>
        </div>
      </div>
    `;
  }).join('');
}

// ============================================
// AI STATS VIEW
// ============================================

function renderStatsView() {
  const stats = state.performanceStats;

  // Calculate win rates for each AI
  const claudeWinRate = stats.claudeSignals > 0
    ? Math.round((stats.claudeWins / (stats.claudeWins + stats.claudeLosses)) * 100) || 0
    : 0;
  const openaiWinRate = stats.openaiSignals > 0
    ? Math.round((stats.openaiWins / (stats.openaiWins + stats.openaiLosses)) * 100) || 0
    : 0;
  const grokWinRate = stats.grokSignals > 0
    ? Math.round((stats.grokWins / (stats.grokWins + stats.grokLosses)) * 100) || 0
    : 0;

  // Calculate average confidence
  const claudeAvgConf = stats.claudeSignals > 0
    ? Math.round(stats.claudeTotalConf / stats.claudeSignals)
    : 0;
  const openaiAvgConf = stats.openaiSignals > 0
    ? Math.round(stats.openaiTotalConf / stats.openaiSignals)
    : 0;
  const grokAvgConf = stats.grokSignals > 0
    ? Math.round(stats.grokTotalConf / stats.grokSignals)
    : 0;

  // Calculate consensus win rates
  const goldWinRate = stats.goldConsensusSignals > 0
    ? Math.round((stats.goldConsensusWins / (stats.goldConsensusWins + stats.goldConsensusLosses)) * 100) || 0
    : 0;
  const silverWinRate = stats.silverConsensusSignals > 0
    ? Math.round((stats.silverConsensusWins / (stats.silverConsensusWins + stats.silverConsensusLosses)) * 100) || 0
    : 0;

  // Update UI elements
  const updateEl = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };

  updateEl('claudeWinRate', claudeWinRate + '%');
  updateEl('claudeTotalTrades', stats.claudeSignals);
  updateEl('claudeAvgConf', claudeAvgConf + '%');
  updateEl('claudePerfBar', null);
  document.getElementById('claudePerfBar')?.style.setProperty('width', claudeWinRate + '%');

  updateEl('openaiWinRate', openaiWinRate + '%');
  updateEl('openaiTotalTrades', stats.openaiSignals);
  updateEl('openaiAvgConf', openaiAvgConf + '%');
  document.getElementById('openaiPerfBar')?.style.setProperty('width', openaiWinRate + '%');

  updateEl('grokWinRate', grokWinRate + '%');
  updateEl('grokTotalTrades', stats.grokSignals);
  updateEl('grokAvgConf', grokAvgConf + '%');
  document.getElementById('grokPerfBar')?.style.setProperty('width', grokWinRate + '%');

  updateEl('goldConsensusRate', goldWinRate + '%');
  updateEl('goldConsensusCount', stats.goldConsensusSignals + ' signals');
  updateEl('silverConsensusRate', silverWinRate + '%');
  updateEl('silverConsensusCount', stats.silverConsensusSignals + ' signals');

  // Render recent predictions
  renderAiPredictions();
}

function renderAiPredictions() {
  const container = document.getElementById('aiPredictionsList');
  if (!container) return;

  if (state.aiPredictions.length === 0) {
    container.innerHTML = '<div class="empty-state">No predictions recorded yet</div>';
    return;
  }

  container.innerHTML = state.aiPredictions.slice(0, 20).map(pred => {
    const statusClass = pred.status === 'win' ? 'win' : (pred.status === 'loss' ? 'loss' : 'pending');
    const resultText = pred.status === 'win' ? '+' + (pred.pnlPercent || '?') + '%' :
                       pred.status === 'loss' ? (pred.pnlPercent || '?') + '%' : 'Pending';

    return `
      <div class="prediction-item ${statusClass}">
        <span class="prediction-symbol">${pred.symbol.replace('USDT', '')}</span>
        <span class="prediction-direction ${pred.direction.toLowerCase()}">${pred.direction}</span>
        <div class="prediction-ais">
          ${pred.aiSources.includes('claude') ? '<span class="prediction-ai claude">🧠</span>' : ''}
          ${pred.aiSources.includes('openai') ? '<span class="prediction-ai openai">🤖</span>' : ''}
          ${pred.aiSources.includes('grok') ? '<span class="prediction-ai grok">⚡</span>' : ''}
        </div>
        <span class="prediction-result ${statusClass}">${resultText}</span>
      </div>
    `;
  }).join('');
}

// ============================================
// NEWS VIEW
// ============================================

const CRYPTO_NEWS_SOURCES = [
  { name: 'CoinDesk', icon: '📰' },
  { name: 'CoinTelegraph', icon: '📡' },
  { name: 'The Block', icon: '🧱' },
  { name: 'Decrypt', icon: '🔓' }
];

// Mock news data (in production, this would come from an API like CryptoPanic)
function getMockNews() {
  return [
    {
      title: 'Bitcoin Breaks Through Key Resistance Level',
      source: 'CoinDesk',
      time: new Date(Date.now() - 1800000), // 30 min ago
      sentiment: 'bullish',
      coins: ['BTC'],
      isHighImpact: true
    },
    {
      title: 'SEC Delays Decision on Spot ETH ETF Applications',
      source: 'The Block',
      time: new Date(Date.now() - 3600000), // 1 hour ago
      sentiment: 'neutral',
      coins: ['ETH'],
      isHighImpact: true
    },
    {
      title: 'Solana DeFi TVL Reaches New All-Time High',
      source: 'CoinTelegraph',
      time: new Date(Date.now() - 7200000), // 2 hours ago
      sentiment: 'bullish',
      coins: ['SOL'],
      isHighImpact: false
    },
    {
      title: 'Major Exchange Reports Record Trading Volume',
      source: 'Decrypt',
      time: new Date(Date.now() - 10800000), // 3 hours ago
      sentiment: 'bullish',
      coins: ['BNB'],
      isHighImpact: false
    },
    {
      title: 'Whale Moves 10,000 BTC to Unknown Wallet',
      source: 'CoinDesk',
      time: new Date(Date.now() - 14400000), // 4 hours ago
      sentiment: 'bearish',
      coins: ['BTC'],
      isHighImpact: true
    }
  ];
}

function renderNewsView() {
  const newsList = document.getElementById('newsList');
  const highPriorityNews = document.getElementById('highPriorityNews');

  if (!newsList || !highPriorityNews) return;

  const news = getMockNews();
  const highImpact = news.filter(n => n.isHighImpact);
  const allNews = news;

  // Render high priority news
  if (highImpact.length > 0) {
    highPriorityNews.innerHTML = highImpact.map(item => renderNewsItem(item, true)).join('');
  } else {
    highPriorityNews.innerHTML = '<div class="empty-state">No high-impact news right now</div>';
  }

  // Render all news
  newsList.innerHTML = allNews.map(item => renderNewsItem(item, false)).join('');

  // Add news filter functionality
  document.querySelectorAll('.news-filter').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.news-filter').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const filter = btn.dataset.newsFilter;

      let filtered = allNews;
      if (filter === 'bullish') {
        filtered = allNews.filter(n => n.sentiment === 'bullish');
      } else if (filter === 'bearish') {
        filtered = allNews.filter(n => n.sentiment === 'bearish');
      }

      newsList.innerHTML = filtered.map(item => renderNewsItem(item, false)).join('');
    });
  });
}

function renderNewsItem(item, isHighImpact) {
  const sentimentEmoji = item.sentiment === 'bullish' ? '🟢' :
                         item.sentiment === 'bearish' ? '🔴' : '⚪';
  const timeAgo = formatTimeAgo(item.time);
  const sentimentClass = item.sentiment;

  return `
    <div class="news-item ${sentimentClass} ${isHighImpact ? 'high-impact' : ''}">
      <div class="news-item-header">
        <span class="news-title">${item.title}</span>
        <span class="news-sentiment">${sentimentEmoji}</span>
      </div>
      <div class="news-meta">
        <span class="news-source">📰 ${item.source}</span>
        <span class="news-time">${timeAgo}</span>
      </div>
      ${item.coins && item.coins.length > 0 ? `
        <div class="news-coins">
          ${item.coins.map(c => `<span class="news-coin-tag">${c}</span>`).join('')}
        </div>
      ` : ''}
    </div>
  `;
}

function formatTimeAgo(date) {
  const seconds = Math.floor((new Date() - date) / 1000);
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

// ============================================
// CALENDAR VIEW
// ============================================

const ECONOMIC_EVENTS = [
  // FOMC Meetings (Federal Reserve)
  { date: '2025-01-29', name: 'FOMC Meeting', type: 'FOMC', impact: 3 },
  { date: '2025-03-19', name: 'FOMC Meeting', type: 'FOMC', impact: 3 },
  { date: '2025-05-07', name: 'FOMC Meeting', type: 'FOMC', impact: 3 },
  { date: '2025-06-18', name: 'FOMC Meeting', type: 'FOMC', impact: 3 },
  { date: '2025-07-30', name: 'FOMC Meeting', type: 'FOMC', impact: 3 },
  { date: '2025-09-17', name: 'FOMC Meeting', type: 'FOMC', impact: 3 },
  { date: '2025-11-05', name: 'FOMC Meeting', type: 'FOMC', impact: 3 },
  { date: '2025-12-17', name: 'FOMC Meeting', type: 'FOMC', impact: 3 },
  // CPI Releases
  { date: '2025-01-15', name: 'CPI Release', type: 'CPI', impact: 3 },
  { date: '2025-02-12', name: 'CPI Release', type: 'CPI', impact: 3 },
  { date: '2025-03-12', name: 'CPI Release', type: 'CPI', impact: 3 },
  { date: '2025-04-10', name: 'CPI Release', type: 'CPI', impact: 3 },
  { date: '2025-05-13', name: 'CPI Release', type: 'CPI', impact: 3 },
  { date: '2025-06-11', name: 'CPI Release', type: 'CPI', impact: 3 },
  { date: '2025-07-11', name: 'CPI Release', type: 'CPI', impact: 3 },
  { date: '2025-08-13', name: 'CPI Release', type: 'CPI', impact: 3 },
  { date: '2025-09-10', name: 'CPI Release', type: 'CPI', impact: 3 },
  { date: '2025-10-10', name: 'CPI Release', type: 'CPI', impact: 3 },
  { date: '2025-11-13', name: 'CPI Release', type: 'CPI', impact: 3 },
  { date: '2025-12-10', name: 'CPI Release', type: 'CPI', impact: 3 },
  // NFP (Non-Farm Payrolls)
  { date: '2025-01-10', name: 'NFP Release', type: 'NFP', impact: 2 },
  { date: '2025-02-07', name: 'NFP Release', type: 'NFP', impact: 2 },
  { date: '2025-03-07', name: 'NFP Release', type: 'NFP', impact: 2 },
  { date: '2025-04-04', name: 'NFP Release', type: 'NFP', impact: 2 },
  { date: '2025-05-02', name: 'NFP Release', type: 'NFP', impact: 2 },
  { date: '2025-06-06', name: 'NFP Release', type: 'NFP', impact: 2 },
  { date: '2025-07-03', name: 'NFP Release', type: 'NFP', impact: 2 },
  { date: '2025-08-01', name: 'NFP Release', type: 'NFP', impact: 2 },
  { date: '2025-09-05', name: 'NFP Release', type: 'NFP', impact: 2 },
  { date: '2025-10-03', name: 'NFP Release', type: 'NFP', impact: 2 },
  { date: '2025-11-07', name: 'NFP Release', type: 'NFP', impact: 2 },
  { date: '2025-12-05', name: 'NFP Release', type: 'NFP', impact: 2 },
  // 2026 events
  { date: '2026-01-14', name: 'CPI Release', type: 'CPI', impact: 3 },
  { date: '2026-01-28', name: 'FOMC Meeting', type: 'FOMC', impact: 3 },
  { date: '2026-01-09', name: 'NFP Release', type: 'NFP', impact: 2 },
];

function renderCalendarView() {
  const upcomingList = document.getElementById('upcomingEvents');
  const pastList = document.getElementById('pastEvents');

  if (!upcomingList || !pastList) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  // Sort events by date
  const sortedEvents = [...ECONOMIC_EVENTS].sort((a, b) =>
    new Date(a.date) - new Date(b.date)
  );

  // Split into upcoming and past
  const upcoming = sortedEvents.filter(e => new Date(e.date) >= today).slice(0, 8);
  const past = sortedEvents.filter(e => {
    const eventDate = new Date(e.date);
    return eventDate < today && eventDate >= sevenDaysAgo;
  }).reverse().slice(0, 5);

  // Render upcoming events
  if (upcoming.length > 0) {
    upcomingList.innerHTML = upcoming.map(event => renderCalendarEvent(event, today)).join('');
  } else {
    upcomingList.innerHTML = '<div class="empty-state">No upcoming events</div>';
  }

  // Render past events
  if (past.length > 0) {
    pastList.innerHTML = past.map(event => renderCalendarEvent(event, today, true)).join('');
  } else {
    pastList.innerHTML = '<div class="empty-state">No recent events</div>';
  }
}

function renderCalendarEvent(event, today, isPast = false) {
  const eventDate = new Date(event.date);
  const isToday = eventDate.toDateString() === today.toDateString();

  const daysUntil = Math.ceil((eventDate - today) / (1000 * 60 * 60 * 24));
  let countdown = '';
  if (isToday) {
    countdown = '<span class="event-countdown today">TODAY</span>';
  } else if (daysUntil === 1) {
    countdown = '<span class="event-countdown">Tomorrow</span>';
  } else if (daysUntil > 0) {
    countdown = `<span class="event-countdown">In ${daysUntil} days</span>`;
  } else if (isPast) {
    countdown = `<span class="event-countdown">${Math.abs(daysUntil)} days ago</span>`;
  }

  const formattedDate = eventDate.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  });

  const impactDots = Array(3).fill(0).map((_, i) =>
    `<span class="impact-dot ${i < event.impact ? 'active' : ''}"></span>`
  ).join('');

  return `
    <div class="calendar-event ${event.type.toLowerCase()} ${isToday ? 'today' : ''}">
      <div class="event-header">
        <span class="event-name">${event.name}</span>
        <span class="event-type ${event.type.toLowerCase()}">${event.type}</span>
      </div>
      <div class="event-date">
        <span>📅 ${formattedDate}</span>
        ${countdown}
      </div>
      <div class="event-impact">
        <span>Impact:</span>
        <div class="impact-dots">${impactDots}</div>
      </div>
    </div>
  `;
}

// ============================================
// AI DEBUG STATUS
// ============================================

function updateAiDebugStatus(ai, status, detail = null) {
  if (!state.aiDebugStatus[ai]) return;

  const debug = state.aiDebugStatus[ai];
  debug.status = status;
  debug.lastCall = Date.now();

  if (status === 'calling') {
    debug.callCount++;
  } else if (status === 'success') {
    debug.successCount++;
    debug.lastError = null;
  } else if (status === 'error') {
    debug.lastError = detail;
  }

  // Update the debug panel if visible
  renderDebugPanel();
}

function renderDebugPanel() {
  const container = document.getElementById('debugPanel');
  if (!container) return;

  const getStatusIcon = (status) => {
    switch(status) {
      case 'calling': return '🔄';
      case 'success': return '✅';
      case 'error': return '❌';
      default: return '⏸️';
    }
  };

  const getStatusClass = (status) => {
    switch(status) {
      case 'calling': return 'calling';
      case 'success': return 'success';
      case 'error': return 'error';
      default: return 'idle';
    }
  };

  const formatTime = (timestamp) => {
    if (!timestamp) return 'Never';
    const diff = (Date.now() - timestamp) / 1000;
    if (diff < 60) return `${Math.floor(diff)}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return `${Math.floor(diff / 3600)}h ago`;
  };

  container.innerHTML = `
    <div class="debug-header">
      <span class="debug-title">🔧 AI Debug Status</span>
      <button class="debug-close" onclick="toggleDebugPanel()">×</button>
    </div>
    <div class="debug-body">
      ${['claude', 'openai', 'grok'].map(ai => {
        const d = state.aiDebugStatus[ai];
        const configured = ai === 'claude' ? isClaudeConfigured() :
                          ai === 'openai' ? isOpenAIConfigured() : isGrokConfigured();
        const model = ai === 'claude' ? CONFIG.CLAUDE_MODEL :
                      ai === 'openai' ? CONFIG.OPENAI_MODEL : CONFIG.GROK_MODEL;
        const icon = ai === 'claude' ? '🧠' : ai === 'openai' ? '🤖' : '⚡';

        return `
          <div class="debug-ai ${getStatusClass(d.status)} ${configured ? '' : 'not-configured'}">
            <div class="debug-ai-header">
              <span class="debug-ai-icon">${icon}</span>
              <span class="debug-ai-name">${ai.toUpperCase()}</span>
              <span class="debug-ai-status">${getStatusIcon(d.status)}</span>
            </div>
            <div class="debug-ai-details">
              <div class="debug-row">
                <span class="debug-label">Configured:</span>
                <span class="debug-value ${configured ? 'yes' : 'no'}">${configured ? 'Yes' : 'No'}</span>
              </div>
              <div class="debug-row">
                <span class="debug-label">Model:</span>
                <span class="debug-value model">${model}</span>
              </div>
              <div class="debug-row">
                <span class="debug-label">Calls:</span>
                <span class="debug-value">${d.callCount} (${d.successCount} success)</span>
              </div>
              <div class="debug-row">
                <span class="debug-label">Last Call:</span>
                <span class="debug-value">${formatTime(d.lastCall)}</span>
              </div>
              ${d.lastError ? `
              <div class="debug-row error">
                <span class="debug-label">Last Error:</span>
                <span class="debug-value error">${d.lastError}</span>
              </div>
              ` : ''}
            </div>
          </div>
        `;
      }).join('')}
    </div>
    <div class="debug-footer">
      <span>Debug mode: ${DEBUG_MODE ? 'ON' : 'OFF'}</span>
      <button class="debug-btn" onclick="window.forceAiScan()">Force Scan Now</button>
    </div>
  `;
}

function toggleDebugPanel() {
  const panel = document.getElementById('debugPanel');
  if (panel) {
    panel.classList.toggle('visible');
    if (panel.classList.contains('visible')) {
      renderDebugPanel();
    }
  }
}

// Expose debug functions globally
window.toggleDebug = () => {
  DEBUG_MODE = !DEBUG_MODE;
  console.log(`🔧 Debug mode: ${DEBUG_MODE ? 'ON' : 'OFF'}`);
};

window.forceAiScan = () => {
  console.log('🔧 Forcing AI scan...');
  runAiAnalysis();
};

window.showAiStatus = () => {
  console.log('🔧 AI Debug Status:');
  console.log('Claude:', state.aiDebugStatus.claude);
  console.log('OpenAI:', state.aiDebugStatus.openai);
  console.log('Grok:', state.aiDebugStatus.grok);
};

// ============================================
// TRADE JOURNAL EXPORT
// ============================================

function exportToCSV() {
  const trades = state.trades;
  const stats = state.performanceStats;

  if (trades.length === 0) {
    alert('No trades to export');
    return;
  }

  // CSV header
  const headers = [
    'Date', 'Symbol', 'Direction', 'Entry', 'Exit', 'Size', 'PnL', 'PnL%',
    'Status', 'AI Sources', 'Confidence', 'Gold Consensus', 'Reasoning'
  ];

  // CSV rows
  const rows = trades.map(t => [
    new Date(t.timestamp).toISOString(),
    t.symbol,
    t.direction,
    t.entry,
    t.exit || '',
    t.size,
    t.pnl?.toFixed(2) || '',
    t.pnlPercent?.toFixed(2) || '',
    t.status,
    t.aiSources?.join('+') || 'manual',
    t.confidence || '',
    t.isGoldConsensus ? 'Yes' : 'No',
    (t.reasons || []).join(' | ').replace(/,/g, ';')
  ]);

  // Add summary at the end
  rows.push([]);
  rows.push(['=== PERFORMANCE SUMMARY ===']);
  rows.push(['Total Trades', stats.totalTrades]);
  rows.push(['Win Rate', ((stats.winningTrades / stats.totalTrades) * 100 || 0).toFixed(1) + '%']);
  rows.push(['Total PnL', '$' + stats.totalPnL.toFixed(2)]);
  rows.push(['Claude Signals', stats.claudeSignals]);
  rows.push(['OpenAI Signals', stats.openaiSignals]);
  rows.push(['Grok Signals', stats.grokSignals]);
  rows.push(['Gold Consensus', stats.goldConsensusSignals]);
  rows.push(['Silver Consensus', stats.silverConsensusSignals]);

  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  downloadFile(csv, 'sentient-trades-' + new Date().toISOString().slice(0, 10) + '.csv', 'text/csv');
}

function exportToJSON() {
  const data = {
    exportDate: new Date().toISOString(),
    trades: state.trades,
    aiSignals: state.aiSignals,
    aiPredictions: state.aiPredictions,
    performanceStats: state.performanceStats,
    signalDiagnostics: {
      lastSignalSummary: state.lastSignalSummary,
      filterStats: state.signalBlockStats,
      rejectionLog: state.aiRejectionLog
    },
    config: {
      minConfidence: CONFIG.AI_MIN_CONFIDENCE,
      alertConfidence: CONFIG.ALERT_CONFIDENCE,
      leverage: CONFIG.LEVERAGE,
      riskPercent: CONFIG.RISK_PERCENT
    }
  };

  const json = JSON.stringify(data, null, 2);
  downloadFile(json, 'sentient-journal-' + new Date().toISOString().slice(0, 10) + '.json', 'application/json');
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ============================================
// AI BADGE UPDATES
// ============================================

function updateAiBadges() {
  const claudeBadge = document.getElementById('claudeBadge');
  const openaiBadge = document.getElementById('openaiBadge');
  const grokBadge = document.getElementById('grokBadge');

  if (claudeBadge) {
    claudeBadge.style.display = isClaudeConfigured() ? 'flex' : 'none';
  }
  if (openaiBadge) {
    openaiBadge.style.display = isOpenAIConfigured() ? 'flex' : 'none';
  }
  if (grokBadge) {
    grokBadge.style.display = isGrokConfigured() ? 'flex' : 'none';
  }

  // If no AI configured, show a placeholder
  const badgesContainer = document.getElementById('aiActiveBadges');
  if (badgesContainer && !isAnyAiConfigured()) {
    badgesContainer.innerHTML = `
      <div class="ai-badge" style="background: var(--bg-hover); opacity: 0.7;">
        <span>⚠️</span>
        <span>No AI</span>
      </div>
    `;
  }
}

// ============================================
// AI S/R LINE UPDATES
// ============================================

function updateSRLinesFromAI(signal) {
  if (!signal || !signal.keyLevels) return;

  const { majorSupport, majorResistance, liquidationZone } = signal.keyLevels;

  // Clear existing AI-generated S/R lines
  state.srLines = state.srLines.filter(line => !line.isAiGenerated);

  // Add new AI-generated levels
  if (majorSupport && state.candleSeries) {
    const supportLine = state.candleSeries.createPriceLine({
      price: majorSupport,
      color: '#3fb950',
      lineWidth: 2,
      lineStyle: 0, // Solid
      axisLabelVisible: true,
      title: 'AI Support',
    });
    state.srLines.push({ line: supportLine, isAiGenerated: true, type: 'support' });
  }

  if (majorResistance && state.candleSeries) {
    const resistanceLine = state.candleSeries.createPriceLine({
      price: majorResistance,
      color: '#f85149',
      lineWidth: 2,
      lineStyle: 0,
      axisLabelVisible: true,
      title: 'AI Resistance',
    });
    state.srLines.push({ line: resistanceLine, isAiGenerated: true, type: 'resistance' });
  }

  if (liquidationZone && state.candleSeries) {
    const liqLine = state.candleSeries.createPriceLine({
      price: liquidationZone,
      color: '#d29922',
      lineWidth: 1,
      lineStyle: 2, // Dashed
      axisLabelVisible: true,
      title: 'Liq Zone',
    });
    state.srLines.push({ line: liqLine, isAiGenerated: true, type: 'liquidation' });
  }

  console.log('📍 Updated AI S/R lines for', signal.symbol);
}

function updateAllSRFromAISignals() {
  // Find the signal for the currently selected symbol
  const currentSignal = state.aiSignals.find(s => s.symbol === state.selectedSymbol) ||
                        state.signalHistory.find(s => s.symbol === state.selectedSymbol && s.isAiGenerated);

  if (currentSignal) {
    updateSRLinesFromAI(currentSignal);
  }
}

function renderAlertBar() {
  const container = document.getElementById('alertBarSignals');
  if (!container) return;

  // Prioritize AI signals, then fall back to regular high confidence signals
  let topSignals = [];

  if (state.aiSignals && state.aiSignals.length > 0) {
    topSignals = state.aiSignals.slice(0, 2);
  } else {
    topSignals = state.signals.filter(s => s.confidence >= CONFIG.HIGH_CONFIDENCE).slice(0, 2);
  }

  if (topSignals.length === 0) {
    container.innerHTML = '<span class="muted">AI analyzing markets for top opportunities...</span>';
    return;
  }

  container.innerHTML = topSignals.map(s => `
    <div class="alert-signal ${s.isConsensus ? 'consensus' : ''}" data-symbol="${s.symbol}">
      <span class="symbol">${s.symbol.replace('USDT', '')}</span>
      <span class="direction ${s.direction.toLowerCase()}">${s.direction}</span>
      <span class="entry">$${formatPrice(s.entry)}</span>
      <span class="conf">${s.confidence}%</span>
      ${s.isConsensus ? '<span class="ai-indicator consensus">🎯 Both AIs</span>' :
        s.aiSources?.includes('claude') && s.aiSources?.includes('openai') ? '<span class="ai-indicator consensus">🎯 Both AIs</span>' :
        s.aiSources?.includes('claude') ? '<span class="ai-indicator claude">Claude</span>' :
        s.aiSources?.includes('openai') ? '<span class="ai-indicator openai">ChatGPT</span>' :
        s.isAiGenerated ? '<span class="ai-indicator">AI Pick</span>' : ''}
    </div>
  `).join('');

  container.querySelectorAll('.alert-signal').forEach(el => {
    el.addEventListener('click', () => selectMarket(el.dataset.symbol));
  });
}

function renderMarketBias() {
  const longs = state.signals.filter(s => s.direction === 'LONG').length;
  const shorts = state.signals.filter(s => s.direction === 'SHORT').length;
  const total = longs + shorts || 1;

  const bullishPct = Math.round(longs / total * 100);
  const bearishPct = 100 - bullishPct;

  let biasText = 'Neutral';
  if (bullishPct >= 60) biasText = 'Bullish';
  else if (bearishPct >= 60) biasText = 'Bearish';

  const biasValueEl = document.getElementById('marketBiasValue');
  const biasBullEl = document.getElementById('biasFillBullish');
  const biasBearEl = document.getElementById('biasFillBearish');

  if (biasValueEl) biasValueEl.textContent = `${biasText} (${bullishPct}%)`;
  if (biasBullEl) biasBullEl.style.width = `${bullishPct}%`;
  if (biasBearEl) biasBearEl.style.width = `${bearishPct}%`;
}

function renderPositions() {
  const container = document.getElementById('positionsList');
  if (!container) return;

  const openTrades = state.trades.filter(t => t.status === 'open');

  if (openTrades.length === 0) {
    container.innerHTML = '<div class="empty-state">No open positions</div>';
    return;
  }

  container.innerHTML = openTrades.map(t => {
    const currentPrice = state.priceCache[t.symbol] || t.entry;
    const pnlPct = (t.pnl / t.size * 100).toFixed(2);

    return `
      <div class="position-item">
        <span class="symbol">
          ${t.symbol.replace('USDT', '')}
          ${t.isAiTrade ? '<span class="ai-trade-badge">🤖 AI</span>' : ''}
        </span>
        <span class="direction ${t.direction.toLowerCase()}">${t.direction}</span>
        <span class="entry">$${formatPrice(t.entry)}</span>
        <span class="current">$${formatPrice(currentPrice)}</span>
        <span class="pnl ${t.pnl >= 0 ? 'positive' : 'negative'}">${t.pnl >= 0 ? '+' : ''}$${t.pnl.toFixed(2)}</span>
        <span class="pnl-pct ${t.pnl >= 0 ? 'positive' : 'negative'}">${pnlPct}%</span>
      </div>
    `;
  }).join('');
}

function renderHistory() {
  const container = document.getElementById('historyList');
  if (!container) return;

  const closedTrades = state.trades.filter(t => t.status === 'closed').slice(-20).reverse();

  if (closedTrades.length === 0) {
    container.innerHTML = '<div class="empty-state">No trade history</div>';
    return;
  }

  container.innerHTML = closedTrades.map(t => `
    <div class="history-item">
      <span class="symbol">
        ${t.symbol.replace('USDT', '')}
        ${t.isAiTrade ? '<span class="ai-trade-badge">🤖</span>' : ''}
      </span>
      <span class="direction ${t.direction.toLowerCase()}">${t.direction}</span>
      <span class="entry">$${formatPrice(t.entry)}</span>
      <span class="exit">$${formatPrice(t.exitPrice)}</span>
      <span class="pnl ${t.pnl >= 0 ? 'positive' : 'negative'}">${t.pnl >= 0 ? '+' : ''}$${t.pnl.toFixed(2)}</span>
      <span class="time">${timeAgo(t.closeTimestamp)}</span>
    </div>
  `).join('');
}

function renderAll() {
  renderMarkets();
  renderSignals();
  renderAlertBar();
  renderMarketBias();
  renderPositions();
  renderHistory();
  updatePortfolioStats();
}

// ============================================
// UI HELPERS
// ============================================

function selectMarket(symbol) {
  state.selectedSymbol = symbol;
  const symbolNameEl = document.getElementById('chartSymbolName');
  if (symbolNameEl) symbolNameEl.textContent = symbol;

  const market = state.markets.find(m => m.symbol === symbol);
  if (market) updateChartPrice(market.price, market.change);

  renderMarkets();

  // Clear existing chart data and S/R lines before loading new data
  if (state.candleSeries) {
    state.candleSeries.setData([]);
  }
  if (state.volumeSeries) {
    state.volumeSeries.setData([]);
  }
  if (state.ema20Series) {
    state.ema20Series.setData([]);
  }
  if (state.ema50Series) {
    state.ema50Series.setData([]);
  }
  if (state.ema200Series) {
    state.ema200Series.setData([]);
  }

  // Remove existing S/R lines
  if (state.srLines && state.srLines.length > 0) {
    state.srLines.forEach(line => {
      try {
        state.candleSeries.removePriceLine(line);
      } catch (e) {}
    });
    state.srLines = [];
  }

  loadChartData();

  // Update S/R lines from AI analysis for the new symbol
  updateAllSRFromAISignals();
}

function updateScanStatus(current, found) {
  const progressEl = document.getElementById('scanProgress');
  const analyzedEl = document.getElementById('analyzedCount');
  if (progressEl) progressEl.textContent = current;
  if (analyzedEl) analyzedEl.textContent = `${found} analyzed`;
}

function updateDataSource(name, isLive) {
  const nameEl = document.getElementById('dataSourceName');
  const statusEl = document.getElementById('dataSourceStatus');
  if (nameEl) nameEl.textContent = name;
  if (statusEl) {
    statusEl.textContent = isLive ? '● Live' : '● Offline';
    statusEl.style.color = isLive ? 'var(--green)' : 'var(--red)';
  }
}

function showNotification(signal) {
  if (state.soundEnabled) {
    const audio = document.getElementById('alertSound');
    if (audio) audio.play().catch(() => {});
  }

  const container = document.getElementById('notificationContainer');
  if (!container) return;

  const notification = document.createElement('div');
  notification.className = `notification ${signal.direction.toLowerCase()}`;

  const isAutoTrade = signal.isAutoTrade || signal.isAiGenerated;
  const icon = isAutoTrade ? '🤖' : (signal.direction === 'LONG' ? '📈' : '📉');
  const title = isAutoTrade
    ? `AI AUTO-TRADE: ${signal.symbol} ${signal.direction}`
    : `${signal.symbol} ${signal.direction}`;

  notification.innerHTML = `
    <div class="notification-header">
      <span class="notification-icon">${icon}</span>
      <span class="notification-title">${title}</span>
      <button class="notification-close">&times;</button>
    </div>
    <div class="notification-body">
      <div class="notification-signal">
        <span class="notification-conf">Confidence: ${signal.confidence}%</span>
        ${isAutoTrade ? '<span style="color: var(--purple); margin-left: 8px;">Position Opened</span>' : ''}
      </div>
      <div class="notification-reason">${signal.reasons ? signal.reasons[0] : 'AI Analysis'}</div>
      ${isAutoTrade ? `
        <div style="margin-top: 8px; font-size: 11px; color: var(--text-secondary);">
          Entry: $${formatPrice(signal.entry)} | TP: $${formatPrice(signal.tp)} | SL: $${formatPrice(signal.sl)}
        </div>
      ` : ''}
    </div>
  `;

  container.appendChild(notification);

  notification.querySelector('.notification-close').addEventListener('click', () => {
    notification.classList.add('closing');
    setTimeout(() => notification.remove(), 300);
  });

  setTimeout(() => {
    if (notification.parentElement) {
      notification.classList.add('closing');
      setTimeout(() => notification.remove(), 300);
    }
  }, isAutoTrade ? 12000 : 8000);
}

// ============================================
// PERSISTENCE
// ============================================

function saveTrades() {
  localStorage.setItem('sentient_trades', JSON.stringify(state.trades));
  localStorage.setItem('sentient_balance', state.balance.toString());
  localStorage.setItem('sentient_equity', JSON.stringify(state.equityHistory));
}

function loadTrades() {
  try {
    const trades = localStorage.getItem('sentient_trades');
    const balance = localStorage.getItem('sentient_balance');
    const equity = localStorage.getItem('sentient_equity');

    if (trades) state.trades = JSON.parse(trades);
    if (balance) state.balance = parseFloat(balance);
    if (equity) state.equityHistory = JSON.parse(equity);
  } catch (e) {
    console.error('Failed to load saved data:', e);
  }
}

function saveSignalHistory() {
  try {
    // Save last 100 signals to localStorage
    const historyToSave = state.signalHistory.slice(0, 100).map(signal => ({
      ...signal,
      isNew: false // Mark as not new when reloading
    }));
    localStorage.setItem('sentient_signal_history', JSON.stringify(historyToSave));
  } catch (e) {
    console.error('Failed to save signal history:', e);
  }
}

function loadSignalHistory() {
  try {
    const saved = localStorage.getItem('sentient_signal_history');
    if (saved) {
      state.signalHistory = JSON.parse(saved);
      console.log(`📜 Loaded ${state.signalHistory.length} signals from history`);
    }
  } catch (e) {
    console.error('Failed to load signal history:', e);
  }
}

function resetBalance() {
  if (!confirm('Are you sure you want to reset your balance to $2000? This will close all open positions and clear trade history.')) {
    return;
  }

  state.balance = 2000;
  state.startBalance = 2000;
  state.trades = [];
  state.equityHistory = [{ time: Date.now(), value: 2000 }];
  state.aiSignals = [];

  saveTrades();
  renderPositions();
  renderHistory();
  updatePortfolioStats();
  updateEquityChart();

  console.log('💰 Balance reset to $2000');

  showNotification({
    symbol: 'SYSTEM',
    direction: 'LONG',
    confidence: 100,
    reasons: ['Balance reset to $2000. Ready to trade!'],
    entry: 2000,
    tp: 2000,
    sl: 2000
  });
}

// ============================================
// EVENT LISTENERS
// ============================================

function initEventListeners() {
  // Navigation
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const view = btn.dataset.view;
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      const viewEl = document.getElementById(`view-${view}`);
      if (viewEl) viewEl.classList.add('active');
    });
  });

  // Mobile navigation
  document.querySelectorAll('.mobile-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;

      // Update active button
      document.querySelectorAll('.mobile-nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Handle different views
      const sidebarRight = document.querySelector('.sidebar-right');
      const mainContent = document.querySelector('.main-content');

      switch(view) {
        case 'chart':
          sidebarRight?.classList.remove('mobile-active');
          mainContent.style.display = 'flex';
          // Resize chart when returning to chart view
          setTimeout(() => {
            if (state.chart) state.chart.resize(
              document.getElementById('chart')?.clientWidth || window.innerWidth,
              document.getElementById('chart')?.clientHeight || 400
            );
          }, 100);
          break;

        case 'signals':
          sidebarRight?.classList.add('mobile-active');
          mainContent.style.display = 'none';
          // Activate signals tab
          document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
          document.querySelector('.tab-btn[data-tab="signals"]')?.classList.add('active');
          document.querySelectorAll('.sidebar-view').forEach(v => v.classList.remove('active'));
          document.getElementById('signalsView')?.classList.add('active');
          break;

        case 'data':
          sidebarRight?.classList.add('mobile-active');
          mainContent.style.display = 'none';
          // Activate data tab
          document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
          document.querySelector('.tab-btn[data-tab="data"]')?.classList.add('active');
          document.querySelectorAll('.sidebar-view').forEach(v => v.classList.remove('active'));
          document.getElementById('dataView')?.classList.add('active');
          break;

        case 'portfolio':
          sidebarRight?.classList.add('mobile-active');
          mainContent.style.display = 'none';
          // Activate stats tab
          document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
          document.querySelector('.tab-btn[data-tab="stats"]')?.classList.add('active');
          document.querySelectorAll('.sidebar-view').forEach(v => v.classList.remove('active'));
          document.getElementById('statsView')?.classList.add('active');
          break;

        case 'settings':
          // Open settings modal properly (loads saved values)
          openSettingsModal();
          break;
      }
    });
  });

  // Timeframe buttons
  document.querySelectorAll('.tf-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.currentTimeframe = btn.dataset.tf;
      loadChartData();
    });
  });

  // Tool buttons
  const toggleSR = document.getElementById('toggleSR');
  if (toggleSR) {
    toggleSR.addEventListener('click', (e) => {
      e.target.classList.toggle('active');
      state.showSR = e.target.classList.contains('active');

      if (!state.showSR) {
        // Remove S/R lines when toggled off
        if (state.srLines && state.srLines.length > 0) {
          state.srLines.forEach(line => {
            try {
              state.candleSeries.removePriceLine(line);
            } catch (err) {}
          });
          state.srLines = [];
        }
        // Clear the level markers
        const container = document.getElementById('chartLevels');
        if (container) container.innerHTML = '';
      } else {
        // Reload chart data to show S/R lines
        loadChartData();
      }
    });
  }

  const toggleVolume = document.getElementById('toggleVolume');
  if (toggleVolume) {
    toggleVolume.addEventListener('click', (e) => {
      e.target.classList.toggle('active');
      state.showVolume = e.target.classList.contains('active');
      if (state.volumeSeries) state.volumeSeries.applyOptions({ visible: state.showVolume });
    });
  }

  // Toggle indicators (EMAs)
  const toggleIndicators = document.getElementById('toggleIndicators');
  if (toggleIndicators) {
    toggleIndicators.addEventListener('click', (e) => {
      e.target.classList.toggle('active');
      state.showIndicators = e.target.classList.contains('active');
      const visible = state.showIndicators;
      if (state.ema20Series) state.ema20Series.applyOptions({ visible });
      if (state.ema50Series) state.ema50Series.applyOptions({ visible });
      if (state.ema200Series) state.ema200Series.applyOptions({ visible });

      // Toggle legend visibility
      const legend = document.querySelector('.chart-legend');
      if (legend) legend.style.display = visible ? 'flex' : 'none';
    });
  }

  // Drawing tools
  const drawHLineBtn = document.getElementById('drawHLine');
  const clearLinesBtn = document.getElementById('clearLines');

  if (drawHLineBtn) {
    drawHLineBtn.addEventListener('click', () => {
      if (state.drawingMode === 'hline') {
        state.drawingMode = null;
        drawHLineBtn.classList.remove('drawing');
      } else {
        state.drawingMode = 'hline';
        drawHLineBtn.classList.add('drawing');
      }
    });
  }

  if (clearLinesBtn) {
    clearLinesBtn.addEventListener('click', () => {
      clearUserLines();
    });
  }

  // Chart click handler for drawing
  const chartContainer = document.getElementById('tradingChart');
  if (chartContainer) {
    chartContainer.addEventListener('click', (event) => {
      if (state.drawingMode === 'hline' && state.chart && state.candleSeries) {
        // Get price from click position
        const rect = chartContainer.getBoundingClientRect();
        const y = event.clientY - rect.top;

        // Convert Y position to price using the chart's coordinate conversion
        const price = state.candleSeries.coordinateToPrice(y);

        if (price && price > 0) {
          addUserLine(price);
          // Exit drawing mode after placing line
          state.drawingMode = null;
          if (drawHLineBtn) drawHLineBtn.classList.remove('drawing');
        }
      }
    });
  }

  // Signal tabs (New/All/Data/News/Calendar/Stats)
  document.querySelectorAll('.signal-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.signal-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      const tabType = tab.dataset.signalTab;

      // Handle sidebar view switching
      // Hide all views first
      document.getElementById('signalsView')?.classList.remove('active');
      document.getElementById('dataView')?.classList.remove('active');
      document.getElementById('newsView')?.classList.remove('active');
      document.getElementById('calendarView')?.classList.remove('active');
      document.getElementById('statsView')?.classList.remove('active');

      if (tabType === 'data') {
        document.getElementById('dataView')?.classList.add('active');
        renderDataView();
      } else if (tabType === 'news') {
        document.getElementById('newsView')?.classList.add('active');
        renderNewsView();
      } else if (tabType === 'calendar') {
        document.getElementById('calendarView')?.classList.add('active');
        renderCalendarView();
      } else if (tabType === 'stats') {
        document.getElementById('statsView')?.classList.add('active');
        renderStatsView();
      } else {
        document.getElementById('signalsView')?.classList.add('active');
        state.signalTab = tabType;
        renderSignals();
      }
    });
  });

  // Signal filters
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.signalFilter = btn.dataset.filter;
      renderSignals();
    });
  });

  // Portfolio tabs
  document.querySelectorAll('.portfolio-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.portfolio-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      const tabContent = document.getElementById(`tab-${tab.dataset.tab}`);
      if (tabContent) tabContent.classList.add('active');
    });
  });

  // Refresh button
  const refreshBtn = document.getElementById('refreshBtn');
  if (refreshBtn) refreshBtn.addEventListener('click', () => {
    runScan();
    runAiAnalysis();
  });

  // Reset balance button
  const resetBalanceBtn = document.getElementById('resetBalanceBtn');
  if (resetBalanceBtn) resetBalanceBtn.addEventListener('click', resetBalance);

  // Settings button - open settings modal
  const settingsBtn = document.getElementById('settingsBtn');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', openSettingsModal);
  }

  // Settings modal handlers
  initSettingsModal();

  // Export buttons
  document.getElementById('exportCsvBtn')?.addEventListener('click', exportToCSV);
  document.getElementById('exportJsonBtn')?.addEventListener('click', exportToJSON);

  // Debug panel
  document.getElementById('debugBtn')?.addEventListener('click', toggleDebugPanel);
}

// ============================================
// SETTINGS MODAL
// ============================================

function openSettingsModal() {
  const modal = document.getElementById('settingsModal');
  if (!modal) return;

  // Load current values into inputs
  document.getElementById('claudeApiKey').value = CONFIG.CLAUDE_API_KEY || '';
  document.getElementById('openaiApiKey').value = CONFIG.OPENAI_API_KEY || '';
  document.getElementById('grokApiKey').value = CONFIG.GROK_API_KEY || '';
  document.getElementById('lunarcrushApiKey').value = CONFIG.LUNARCRUSH_API_KEY || '';
  document.getElementById('coinglassApiKey').value = CONFIG.COINGLASS_API_KEY || '';

  // Load toggle states
  document.getElementById('aiAutoTradeToggle').checked = state.aiAutoTradeEnabled;
  document.getElementById('soundToggle').checked = state.soundEnabled;
  document.getElementById('notificationToggle').checked = state.notificationsEnabled;

  // Load Telegram settings
  const telegramBotToken = document.getElementById('telegramBotToken');
  const telegramChatId = document.getElementById('telegramChatId');
  const telegramToggle = document.getElementById('telegramToggle');
  if (telegramBotToken) telegramBotToken.value = CONFIG.TELEGRAM_BOT_TOKEN || '';
  if (telegramChatId) telegramChatId.value = CONFIG.TELEGRAM_CHAT_ID || '';
  if (telegramToggle) telegramToggle.checked = CONFIG.TELEGRAM_ENABLED;

  // Load Discord settings
  const discordWebhookUrl = document.getElementById('discordWebhookUrl');
  const discordToggle = document.getElementById('discordToggle');
  if (discordWebhookUrl) discordWebhookUrl.value = CONFIG.DISCORD_WEBHOOK_URL || '';
  if (discordToggle) discordToggle.checked = CONFIG.DISCORD_ENABLED;

  // Update Discord stats
  updateDiscordStats();

  // Update API status display
  updateSettingsApiStatus();

  modal.classList.add('active');
}

function closeSettingsModal() {
  const modal = document.getElementById('settingsModal');
  if (modal) modal.classList.remove('active');
}

function updateSettingsApiStatus() {
  const statusEl = document.getElementById('settingsApiStatus');
  if (!statusEl) return;

  const claudeInput = document.getElementById('claudeApiKey');
  const openaiInput = document.getElementById('openaiApiKey');
  const grokInput = document.getElementById('grokApiKey');

  const claudeKey = claudeInput?.value || '';
  const openaiKey = openaiInput?.value || '';
  const grokKey = grokInput?.value || '';

  const claudeValid = claudeKey.startsWith('sk-ant-');
  const openaiValid = openaiKey.startsWith('sk-');
  const grokValid = grokKey.startsWith('xai-');

  // Update input visual states
  if (claudeInput) {
    claudeInput.classList.toggle('valid', claudeValid && claudeKey.length > 20);
    claudeInput.classList.toggle('invalid', claudeKey && !claudeValid);
  }
  if (openaiInput) {
    openaiInput.classList.toggle('valid', openaiValid && openaiKey.length > 20);
    openaiInput.classList.toggle('invalid', openaiKey && !openaiValid);
  }
  if (grokInput) {
    grokInput.classList.toggle('valid', grokValid && grokKey.length > 20);
    grokInput.classList.toggle('invalid', grokKey && !grokValid);
  }

  // Count valid AIs
  const validCount = [claudeValid, openaiValid, grokValid].filter(Boolean).length;
  const validNames = [];
  if (claudeValid) validNames.push('Claude');
  if (openaiValid) validNames.push('GPT-4o');
  if (grokValid) validNames.push('Grok');

  // Update status indicator
  if (validCount >= 3) {
    statusEl.className = 'api-status connected gold';
    statusEl.querySelector('.status-text').textContent = '🥇 All 3 AIs configured - Gold consensus enabled!';
  } else if (validCount === 2) {
    statusEl.className = 'api-status connected';
    statusEl.querySelector('.status-text').textContent = '🥈 ' + validNames.join(' + ') + ' - Consensus enabled';
  } else if (validCount === 1) {
    statusEl.className = 'api-status partial';
    statusEl.querySelector('.status-text').textContent = '⚠️ ' + validNames[0] + ' only - Add 1 more AI for consensus';
  } else {
    statusEl.className = 'api-status disconnected';
    statusEl.querySelector('.status-text').textContent = '❌ Configure at least 2 AIs for consensus signals';
  }
}

function saveSettings() {
  // Get values from inputs
  const claudeKey = document.getElementById('claudeApiKey')?.value?.trim() || '';
  const openaiKey = document.getElementById('openaiApiKey')?.value?.trim() || '';
  const grokKey = document.getElementById('grokApiKey')?.value?.trim() || '';
  const lunarcrushKey = document.getElementById('lunarcrushApiKey')?.value?.trim() || '';
  const coinglassKey = document.getElementById('coinglassApiKey')?.value?.trim() || '';

  // Validate and save Claude API key
  if (claudeKey) {
    if (claudeKey.startsWith('sk-ant-')) {
      CONFIG.CLAUDE_API_KEY = claudeKey;
      localStorage.setItem('claude_api_key', claudeKey);
      console.log('✅ Claude API key saved');
    } else if (claudeKey.length > 0) {
      console.warn('⚠️ Invalid Claude API key format');
    }
  } else {
    CONFIG.CLAUDE_API_KEY = '';
    localStorage.removeItem('claude_api_key');
  }

  // Validate and save OpenAI API key
  if (openaiKey) {
    if (openaiKey.startsWith('sk-')) {
      CONFIG.OPENAI_API_KEY = openaiKey;
      localStorage.setItem('openai_api_key', openaiKey);
      console.log('✅ OpenAI API key saved');
    } else if (openaiKey.length > 0) {
      console.warn('⚠️ Invalid OpenAI API key format');
    }
  } else {
    CONFIG.OPENAI_API_KEY = '';
    localStorage.removeItem('openai_api_key');
  }

  // Validate and save Grok API key
  if (grokKey) {
    if (grokKey.startsWith('xai-')) {
      CONFIG.GROK_API_KEY = grokKey;
      localStorage.setItem('grok_api_key', grokKey);
      console.log('✅ Grok API key saved');
    } else if (grokKey.length > 0) {
      console.warn('⚠️ Invalid Grok API key format');
    }
  } else {
    CONFIG.GROK_API_KEY = '';
    localStorage.removeItem('grok_api_key');
  }

  // Save LunarCrush API key (no specific format validation)
  if (lunarcrushKey && lunarcrushKey.length > 5) {
    CONFIG.LUNARCRUSH_API_KEY = lunarcrushKey;
    localStorage.setItem('lunarcrush_api_key', lunarcrushKey);
    console.log('✅ LunarCrush API key saved');
  } else {
    CONFIG.LUNARCRUSH_API_KEY = '';
    localStorage.removeItem('lunarcrush_api_key');
  }

  // Save Coinglass API key (no specific format validation)
  if (coinglassKey && coinglassKey.length > 5) {
    CONFIG.COINGLASS_API_KEY = coinglassKey;
    localStorage.setItem('coinglass_api_key', coinglassKey);
    console.log('✅ Coinglass API key saved');
  } else {
    CONFIG.COINGLASS_API_KEY = '';
    localStorage.removeItem('coinglass_api_key');
  }

  // Save Telegram settings
  const telegramToken = document.getElementById('telegramBotToken')?.value?.trim() || '';
  const telegramChatId = document.getElementById('telegramChatId')?.value?.trim() || '';
  const telegramEnabled = document.getElementById('telegramToggle')?.checked ?? false;

  if (telegramToken && telegramToken.length > 10) {
    CONFIG.TELEGRAM_BOT_TOKEN = telegramToken;
    localStorage.setItem('telegram_bot_token', telegramToken);
    console.log('✅ Telegram Bot Token saved');
  } else {
    CONFIG.TELEGRAM_BOT_TOKEN = '';
    localStorage.removeItem('telegram_bot_token');
  }

  if (telegramChatId && telegramChatId.length > 0) {
    CONFIG.TELEGRAM_CHAT_ID = telegramChatId;
    localStorage.setItem('telegram_chat_id', telegramChatId);
    console.log('✅ Telegram Chat ID saved');
  } else {
    CONFIG.TELEGRAM_CHAT_ID = '';
    localStorage.removeItem('telegram_chat_id');
  }

  CONFIG.TELEGRAM_ENABLED = telegramEnabled;
  localStorage.setItem('telegram_enabled', telegramEnabled.toString());

  // Save Discord settings
  const discordWebhookUrl = document.getElementById('discordWebhookUrl')?.value?.trim() || '';
  const discordEnabled = document.getElementById('discordToggle')?.checked ?? false;

  if (discordWebhookUrl && discordWebhookUrl.startsWith('https://discord.com/api/webhooks/')) {
    CONFIG.DISCORD_WEBHOOK_URL = discordWebhookUrl;
    localStorage.setItem('discord_webhook_url', discordWebhookUrl);
    console.log('Discord webhook URL saved');
  } else if (!discordWebhookUrl) {
    CONFIG.DISCORD_WEBHOOK_URL = '';
    localStorage.removeItem('discord_webhook_url');
  }

  CONFIG.DISCORD_ENABLED = discordEnabled;
  localStorage.setItem('discord_enabled', discordEnabled.toString());

  // Save toggle states
  state.aiAutoTradeEnabled = document.getElementById('aiAutoTradeToggle')?.checked ?? true;
  state.soundEnabled = document.getElementById('soundToggle')?.checked ?? true;
  state.notificationsEnabled = document.getElementById('notificationToggle')?.checked ?? false;

  // Request notification permission if enabled
  if (state.notificationsEnabled) {
    requestNotificationPermission();
  }

  // Close modal
  closeSettingsModal();

  // Show success notification
  showNotification({
    type: 'info',
    title: 'Settings Saved',
    message: 'Your API keys and settings have been saved.'
  });

  // Run AI analysis if configured
  if (isAnyAiConfigured()) {
    console.log('🤖 AI configured - starting analysis...');
    updateAiScanStatus('Starting...');
    setTimeout(() => runAiAnalysis(), 1000);
  } else {
    updateAiScanStatus('No API Key');
  }

  // Re-render signals panel
  renderSignals();

  // Update AI badges to reflect current configuration
  updateAiBadges();
}

function initSettingsModal() {
  // Close button
  const closeBtn = document.getElementById('settingsClose');
  if (closeBtn) closeBtn.addEventListener('click', closeSettingsModal);

  // Overlay click to close
  const overlay = document.querySelector('.settings-overlay');
  if (overlay) overlay.addEventListener('click', closeSettingsModal);

  // Save button
  const saveBtn = document.getElementById('settingsSaveBtn');
  if (saveBtn) saveBtn.addEventListener('click', saveSettings);

  // Toggle visibility buttons
  document.querySelectorAll('.toggle-visibility').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.target;
      const input = document.getElementById(targetId);
      if (input) {
        const isPassword = input.type === 'password';
        input.type = isPassword ? 'text' : 'password';
        btn.textContent = isPassword ? '🙈' : '👁';
      }
    });
  });

  // Real-time validation on input
  ['claudeApiKey', 'openaiApiKey', 'grokApiKey'].forEach(id => {
    const input = document.getElementById(id);
    if (input) {
      input.addEventListener('input', updateSettingsApiStatus);
    }
  });

  // Test Telegram button
  const testTelegramBtn = document.getElementById('testTelegramBtn');
  if (testTelegramBtn) {
    testTelegramBtn.addEventListener('click', async () => {
      testTelegramBtn.disabled = true;
      testTelegramBtn.textContent = '📤 Sending...';

      // Temporarily save current input values to CONFIG for test
      const botToken = document.getElementById('telegramBotToken')?.value?.trim();
      const chatId = document.getElementById('telegramChatId')?.value?.trim();

      if (!botToken || !chatId) {
        testTelegramBtn.textContent = '❌ Missing Token/ID';
        setTimeout(() => { testTelegramBtn.textContent = '📤 Send Test Message'; testTelegramBtn.disabled = false; }, 2000);
        return;
      }

      // Temporarily set config for test
      const origToken = CONFIG.TELEGRAM_BOT_TOKEN;
      const origChatId = CONFIG.TELEGRAM_CHAT_ID;
      CONFIG.TELEGRAM_BOT_TOKEN = botToken;
      CONFIG.TELEGRAM_CHAT_ID = chatId;

      const success = await sendTelegramTestMessage();

      // Restore original config (will be properly saved when user clicks Save)
      CONFIG.TELEGRAM_BOT_TOKEN = origToken;
      CONFIG.TELEGRAM_CHAT_ID = origChatId;

      if (success) {
        testTelegramBtn.textContent = '✅ Message Sent!';
      } else {
        testTelegramBtn.textContent = '❌ Failed - Check Token/ID';
      }

      setTimeout(() => {
        testTelegramBtn.textContent = '📤 Send Test Message';
        testTelegramBtn.disabled = false;
      }, 3000);
    });
  }

  // Discord buttons
  const viewDiscordCallsBtn = document.getElementById('viewDiscordCallsBtn');
  if (viewDiscordCallsBtn) {
    viewDiscordCallsBtn.addEventListener('click', showDiscordCallsModal);
  }

  const addDiscordCallBtn = document.getElementById('addDiscordCallBtn');
  if (addDiscordCallBtn) {
    addDiscordCallBtn.addEventListener('click', showAddDiscordCallModal);
  }

  // Escape key to close
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeSettingsModal();
      closeDiscordCallsModal();
      closeAddDiscordCallModal();
    }
  });
}

// ============================================
// INITIALIZATION
// ============================================

async function init() {
  loadTrades();
  loadPerformanceStats();
  loadSignalHistory();

  // Render loaded signal history immediately
  if (state.signalHistory.length > 0) {
    setTimeout(() => renderSignals(), 100);
  }

  // Load API keys from localStorage
  const keysLoaded = loadApiKeys();
  console.log('🔑 API Keys loaded:', keysLoaded.claude ? 'Claude ✓' : 'Claude ✗', keysLoaded.openai ? 'OpenAI ✓' : 'OpenAI ✗');

  // Prompt for missing API keys after UI loads
  if (!keysLoaded.claude || !keysLoaded.openai) {
    setTimeout(() => {
      promptForApiKeys();
    }, 2000);
  }

  // Request notification permission
  requestNotificationPermission();

  // Expose functions to manage API keys and stats from console
  window.setApiKey = setApiKeyManually;
  window.showApiStatus = showApiKeyStatus;
  window.showStats = () => {
    const s = state.performanceStats;
    console.log('📊 Performance Stats:');
    console.log(`   Win Rate: ${getWinRate()}%`);
    console.log(`   Total Trades: ${s.totalTrades} (${s.winningTrades}W / ${s.losingTrades}L)`);
    console.log(`   Total PnL: $${s.totalPnL.toFixed(2)}`);
    console.log(`   Largest Win: $${s.largestWin.toFixed(2)}`);
    console.log(`   Largest Loss: $${s.largestLoss.toFixed(2)}`);
    console.log(`   Max Drawdown: ${s.maxDrawdown.toFixed(2)}%`);
    console.log(`   Current Streak: ${s.currentStreak}`);
    console.log('');
    console.log('   AI Performance:');
    console.log(`   Claude: ${getAIPerformance('claude')}% win rate`);
    console.log(`   ChatGPT: ${getAIPerformance('openai')}% win rate`);
    console.log(`   Consensus: ${getAIPerformance('consensus')}% win rate`);
  };
  window.toggleSound = () => { state.soundEnabled = !state.soundEnabled; console.log('🔊 Sound:', state.soundEnabled ? 'ON' : 'OFF'); };
  console.log('💡 Commands: setApiKey(), showApiStatus(), showStats(), toggleSound()');

  // Update balance display
  const startBalEl = document.getElementById('startBalance');
  if (startBalEl) startBalEl.textContent = '$' + state.startBalance.toFixed(0);

  state.markets = await fetchMarkets();
  renderMarkets();

  initChart();
  initEquityChart();

  if (state.markets.length > 0) selectMarket(state.markets[0].symbol);

  initWebSocket();
  initEventListeners();

  // Update AI badges based on loaded API keys
  updateAiBadges();

  // Run initial scans
  runScan();

  // Start regular scan interval
  setInterval(runScan, CONFIG.SCAN_INTERVAL);
  setInterval(updateOpenPositions, CONFIG.PNL_UPDATE_INTERVAL);
  setInterval(renderMarkets, 2000);

  // Initialize AI scanning with 10-minute interval
  console.log('🤖 Sentient Trader v4.0 - Dual AI System');
  console.log('💰 Starting balance: $' + state.balance.toFixed(2));
  console.log('📊 Features: Funding Rates, OI Tracking, MTF Analysis, Trailing Stops');
  console.log('🎯 AI Consensus Detection enabled');

  // Run first AI analysis after initial data is loaded
  setTimeout(() => {
    if (isAnyAiConfigured()) {
      runAiAnalysis();
    }
  }, 5000);

  // Set up 10-minute AI scan interval
  setInterval(runAiAnalysis, CONFIG.AI_SCAN_INTERVAL);

  // Periodically update funding rates (every 5 minutes)
  setInterval(fetchFundingRates, 300000);

  // Initialize countdown
  state.nextAiScanTime = Date.now() + 5000; // First scan in 5 seconds
  updateAiScanCountdown();

  console.log('✅ Sentient Trader initialized successfully');
}

document.addEventListener('DOMContentLoaded', init);
