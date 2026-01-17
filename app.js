// --- Mock data (replace later with real API responses) ---
const mockMarkets = Array.from({ length: 50 }).map((_, i) => {
  const symbols = [
    "BTCUSDT","ETHUSDT","SOLUSDT","BNBUSDT","XRPUSDT","ADAUSDT","AVAXUSDT","DOGEUSDT","LINKUSDT","SUIUSDT",
    "TONUSDT","ARBUSDT","OPUSDT","MATICUSDT","APTUSDT","INJUSDT","ATOMUSDT","SEIUSDT","WIFUSDT","JUPUSDT",
    "PEPEUSDT","TRXUSDT","LTCUSDT","BCHUSDT","FILUSDT","TIAUSDT","NEARUSDT","RNDRUSDT","UNIUSDT","AAVEUSDT",
    "FTMUSDT","ENAUSDT","GALAUSDT","STXUSDT","RUNEUSDT","IMXUSDT","KASUSDT","ETCUSDT","XLMUSDT","ICPUSDT",
    "SANDUSDT","MANAUSDT","FLOWUSDT","HBARUSDT","EGLDUSDT","ONDOUSDT","PYTHUSDT","JTOUSDT","BONKUSDT","SHIBUSDT"
  ];
  const sym = symbols[i] || `COIN${i}USDT`;
  const vol = Math.round((Math.random() * 900 + 100) * 10) / 10; // 100-1000
  const chg = Math.round((Math.random() * 10 - 5) * 100) / 100; // -5% to +5%
  return {
    symbol: sym,
    volumeB: vol, // pretend "B"
    changePct: chg
  };
});

let mockSignals = [
  { symbol:"BTCUSDT", dir:"LONG", tf:"15m", conf:84, tldr:["Price above EMA200 (1h)","MACD cross up","Reclaimed resistance → support"] },
  { symbol:"ETHUSDT", dir:"SHORT", tf:"1h", conf:78, tldr:["Rejected at 4h resistance","RSI rolling over","MACD weakening"] },
  { symbol:"SOLUSDT", dir:"LONG", tf:"1h", conf:82, tldr:["Higher lows on trendline","RSI > 50","MACD histogram rising"] },
  { symbol:"AVAXUSDT", dir:"SHORT", tf:"15m", conf:73, tldr:["Lower highs","Lost EMA200 (15m)","Bearish MACD cross"] },
  { symbol:"SUIUSDT", dir:"LONG", tf:"4h", conf:88, tldr:["Breakout + retest","Strong volume (mock)","Multi-TF bullish alignment"] },
  { symbol:"BONKUSDT", dir:"SHORT", tf:"15m", conf:69, tldr:["Overbought RSI","Resistance cluster above","Momentum fading"] },
];

let mockTrades = [
  { opened:"Today 01:10", symbol:"SUIUSDT", dir:"LONG", lev:"5x", entry:"1.205", exit:"1.245", conf:88, pnl:"+$38.40", status:"CLOSED" },
  { opened:"Today 00:32", symbol:"BTCUSDT", dir:"LONG", lev:"3x", entry:"43120", exit:"43305", conf:84, pnl:"+$21.10", status:"CLOSED" },
  { opened:"Yesterday 23:55", symbol:"ETHUSDT", dir:"SHORT", lev:"3x", entry:"2280", exit:"2294", conf:81, pnl:"-$14.80", status:"CLOSED" },
  { opened:"Yesterday 22:40", symbol:"SOLUSDT", dir:"LONG", lev:"4x", entry:"98.10", exit:"—", conf:82, pnl:"+$7.50", status:"OPEN" },
];

// --- State ---
let selectedSymbol = "BTCUSDT";
let drawingsVisible = true;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// --- Navigation ---
function setView(viewName){
  $$(".tab").forEach(b => b.classList.toggle("active", b.dataset.view === viewName));
  $$(".view").forEach(v => v.classList.toggle("active", v.id === `view-${viewName}`));
}

$$(".tab").forEach(btn => {
  btn.addEventListener("click", () => setView(btn.dataset.view));
});

$$("[data-nav]").forEach(btn => {
  btn.addEventListener("click", () => setView(btn.dataset.nav));
});

// --- Markets list render ---
function renderMarkets(list){
  const el = $("#marketList");
  el.innerHTML = "";
  list.forEach(m => {
    const item = document.createElement("div");
    item.className = `market-item ${m.symbol === selectedSymbol ? "active" : ""}`;
    item.setAttribute("role","option");
    item.innerHTML = `
      <div class="market-left">
        <div class="market-symbol">${m.symbol}</div>
        <div class="market-meta">Perp • Vol: ${m.volumeB}B</div>
      </div>
      <div class="market-right">
        <div class="market-vol">${m.volumeB}B</div>
        <div class="market-chg ${m.changePct >= 0 ? "up" : "down"}">${m.changePct >= 0 ? "+" : ""}${m.changePct}%</div>
      </div>
    `;
    item.addEventListener("click", () => {
      selectedSymbol = m.symbol;
      renderMarkets(applyMarketSearch());
      hydrateSelectedMarket();
      hydrateChartsPanel();
      hydrateTables();
    });
    el.appendChild(item);
  });
}

function applyMarketSearch(){
  const q = $("#marketSearch").value.trim().toUpperCase();
  if(!q) return mockMarkets;
  return mockMarkets.filter(m => m.symbol.includes(q));
}

// --- Signals filtering ---
function getFilters(){
  const tf = $("#tfSelect").value;
  const dir = $("#dirSelect").value;
  const minConf = parseInt($("#minConf").value, 10);
  return { tf, dir, minConf };
}

function applySignalFilters(){
  const { tf, dir, minConf } = getFilters();
  return mockSignals.filter(s => {
    const tfOk = tf ? (s.tf === tf) : true;
    const dirOk = dir === "all" ? true : (s.dir.toLowerCase() === dir);
    const confOk = s.conf >= minConf;
    return tfOk && dirOk && confOk;
  });
}

// --- Tables ---
function confClass(n){
  if(n >= 80) return "high";
  if(n >= 65) return "mid";
  return "low";
}

function renderTopSignals(){
  const tbody = $("#topSignalsTable tbody");
  tbody.innerHTML = "";
  const top = [...mockSignals].sort((a,b)=>b.conf-a.conf).slice(0,6);
  top.forEach(s => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${s.symbol}</strong></td>
      <td><span class="tag ${s.dir === "LONG" ? "long" : "short"}">${s.dir}</span></td>
      <td>${s.tf}</td>
      <td><span class="conf ${confClass(s.conf)}">${s.conf}%</span></td>
      <td class="muted">${s.tldr[0]}</td>
    `;
    tr.addEventListener("click", () => {
      selectedSymbol = s.symbol;
      setView("charts");
      renderMarkets(applyMarketSearch());
      hydrateSelectedMarket();
      hydrateChartsPanel();
    });
    tbody.appendChild(tr);
  });
}

function renderSignalsTable(){
  const tbody = $("#signalsTable tbody");
  tbody.innerHTML = "";
  const list = applySignalFilters();

  list.forEach(s => {
    const tr = document.createElement("tr");
    const bullets = s.tldr.map(x => `<div class="muted">• ${x}</div>`).join("");
    tr.innerHTML = `
      <td><strong>${s.symbol}</strong></td>
      <td><span class="tag ${s.dir === "LONG" ? "long" : "short"}">${s.dir}</span></td>
      <td>${s.tf}</td>
      <td><span class="conf ${confClass(s.conf)}">${s.conf}%</span></td>
      <td>${bullets}</td>
      <td><button class="btn ghost small" data-open-chart="${s.symbol}">Open</button></td>
    `;
    tbody.appendChild(tr);
  });

  // attach open buttons
  $$("[data-open-chart]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      selectedSymbol = btn.dataset.openChart;
      setView("charts");
      renderMarkets(applyMarketSearch());
      hydrateSelectedMarket();
      hydrateChartsPanel();
    });
  });
}

function renderRecentTrades(){
  const tbody = $("#recentTradesTable tbody");
  tbody.innerHTML = "";
  mockTrades.slice(0,4).forEach(t => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="muted">${t.opened}</td>
      <td><strong>${t.symbol}</strong></td>
      <td><span class="tag ${t.dir === "LONG" ? "long" : "short"}">${t.dir}</span></td>
      <td class="${t.pnl.startsWith("+") ? "conf high" : "conf low"}">${t.pnl}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderTradesTable(){
  const tbody = $("#tradesTable tbody");
  tbody.innerHTML = "";
  mockTrades.forEach(t => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="muted">${t.opened}</td>
      <td><strong>${t.symbol}</strong></td>
      <td><span class="tag ${t.dir === "LONG" ? "long" : "short"}">${t.dir}</span></td>
      <td>${t.lev}</td>
      <td class="muted">${t.entry}</td>
      <td class="muted">${t.exit}</td>
      <td><span class="conf ${confClass(t.conf)}">${t.conf}%</span></td>
      <td class="${t.pnl.startsWith("+") ? "conf high" : "conf low"}">${t.pnl}</td>
      <td class="muted">${t.status}</td>
    `;
    tbody.appendChild(tr);
  });
}

function hydrateTables(){
  renderTopSignals();
  renderSignalsTable();
  renderRecentTrades();
  renderTradesTable();
  // KPI mocks
  $("#kpiSetups").textContent = mockSignals.length;
  $("#kpiHigh").textContent = mockSignals.filter(s => s.conf >= 80).length;
}

// --- Selected Market / Chart panel ---
function hydrateSelectedMarket(){
  $("#selectedSymbolBadge").textContent = selectedSymbol;
  $("#chartSymbol").textContent = selectedSymbol;

  const signal = [...mockSignals].filter(s => s.symbol === selectedSymbol).sort((a,b)=>b.conf-a.conf)[0]
    || { dir:"—", conf:0, tldr:["No setup found on current filters."], tf: $("#tfSelect").value };

  const trend = signal.dir === "LONG" ? "Bullish" : (signal.dir === "SHORT" ? "Bearish" : "Neutral");
  $("#selectedTrend").textContent = trend;
  $("#selectedSignalDir").textContent = signal.dir;
  $("#selectedConfPill").textContent = `${signal.conf}%`;
  $("#selectedConfBar").style.width = `${signal.conf}%`;
  $("#selectedTldr").innerHTML = signal.tldr.map(x => `<li>${x}</li>`).join("");
}

function hydrateChartsPanel(){
  const signal = [...mockSignals].filter(s => s.symbol === selectedSymbol).sort((a,b)=>b.conf-a.conf)[0]
    || { dir:"LONG", conf:70, tldr:["Mock setup."], tf: "15m" };

  $("#chartConf").textContent = `${signal.conf}%`;
  $("#chartTF").textContent = signal.tf;
  $("#chartTldr").innerHTML = signal.tldr.map(x => `<li>${x}</li>`).join("");

  // random-ish indicator values (mock)
  $("#rsiVal").textContent = (45 + Math.random()*25).toFixed(1);
  $("#emaVal").textContent = signal.dir === "LONG" ? "Above" : "Below";
  $("#macdVal").textContent = signal.dir === "LONG" ? "Cross Up" : "Cross Down";
}

// --- Controls ---
$("#marketSearch").addEventListener("input", () => renderMarkets(applyMarketSearch()));

$("#minConf").addEventListener("input", (e) => {
  $("#minConfPill").textContent = `${e.target.value}%`;
});

$("#applyFilters").addEventListener("click", () => {
  hydrateTables();
  hydrateSelectedMarket();
});

$("#mockRescanBtn").addEventListener("click", () => {
  // Slightly shuffle conf to simulate a rescan
  mockSignals = mockSignals.map(s => ({
    ...s,
    conf: Math.max(40, Math.min(95, s.conf + Math.round((Math.random()*10 - 5))))
  }));
  hydrateTables();
  hydrateSelectedMarket();
  hydrateChartsPanel();
});

$("#toggleDrawings").addEventListener("click", () => {
  drawingsVisible = !drawingsVisible;
  $("#drawingsOverlay").style.display = drawingsVisible ? "block" : "none";
});

$$(".chip").forEach(chip => {
  chip.addEventListener("click", () => {
    $$(".chip").forEach(c => c.classList.remove("active"));
    chip.classList.add("active");
    // In real build: request new candles/drawings for this tf
    $("#chartTF").textContent = chip.dataset.chartTf;
  });
});

$("#paperTradeMock").addEventListener("click", () => {
  alert("Mock: would open paper trades for signals with confidence ≥ 80%");
});

$("#exportMock").addEventListener("click", () => {
  alert("Mock: would export signals to CSV/JSON");
});

$("#addWatchMock").addEventListener("click", () => {
  alert(`Mock: added ${selectedSymbol} to watchlist`);
});

$("#resetPaper").addEventListener("click", () => {
  alert("Mock: reset paper account to $2,000 (frontend only)");
});

$("#newTradeMock").addEventListener("click", () => {
  const s = [...mockSignals].sort((a,b)=>b.conf-a.conf)[0];
  const now = new Date();
  const label = `Today ${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;
  mockTrades.unshift({
    opened: label,
    symbol: s.symbol,
    dir: s.dir,
    lev: "3x",
    entry: "—",
    exit: "—",
    conf: s.conf,
    pnl: "+$0.00",
    status: "OPEN"
  });
  hydrateTables();
});

// --- Countdown mock ---
let seconds = 94;
setInterval(() => {
  seconds = (seconds <= 0) ? 120 : seconds - 1;
  const mm = String(Math.floor(seconds/60)).padStart(2,"0");
  const ss = String(seconds%60).padStart(2,"0");
  $("#kpiNextScan").textContent = `${mm}:${ss}`;
}, 1000);

// --- Initial render ---
renderMarkets(mockMarkets);
hydrateTables();
hydrateSelectedMarket();
hydrateChartsPanel();
