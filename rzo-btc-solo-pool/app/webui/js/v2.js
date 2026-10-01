"use strict";

(() => {
  const V = "3.2.0";
  const isMiner = location.pathname.endsWith("miner.html");
  const STORE = `rzo-v2-${isMiner ? "miner" : "pool"}`;
  const MAX_POINTS = 2016;
  const state = JSON.parse(localStorage.getItem(STORE) || '{"history":[],"records":{},"events":[],"baseline":{}}');
  state.history ||= []; state.records ||= {}; state.events ||= []; state.baseline ||= {};
  state.records.firstSeen ||= Date.now();
  state.records.maxWorkers ||= 0;
  state.records.maxSessions ||= 0;
  state.records.maxAccepted ||= 0;
  let lastAccepted = null;
  let lastBest = Number(state.records.best || 0);
  let lastBlocks = Number(state.records.blocks || 0);

  const $ = id => document.getElementById(id);
  const number = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
  const pick = (obj, keys, fallback = 0) => { for (const key of keys) if (obj && obj[key] != null) return obj[key]; return fallback; };
  const fmt = (v, d = 2) => new Intl.NumberFormat("de-DE", { maximumFractionDigits: d }).format(number(v));
  const diff = v => {
    const n = number(v); const units = [[1e18,"E"],[1e15,"P"],[1e12,"T"],[1e9,"G"],[1e6,"M"],[1e3,"K"]];
    for (const [x,s] of units) if (Math.abs(n) >= x) return `${fmt(n/x,2)} ${s}`;
    return fmt(n,2);
  };
  const hr = v => {
    const n = number(v); const units = [[1e18,"EH/s"],[1e15,"PH/s"],[1e12,"TH/s"],[1e9,"GH/s"],[1e6,"MH/s"],[1e3,"kH/s"]];
    for (const [x,s] of units) if (n >= x) return `${fmt(n/x,2)} ${s}`;
    return `${fmt(n,0)} H/s`;
  };
  const save = () => localStorage.setItem(STORE, JSON.stringify(state));
  const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));

  function copyText(text, button) {
    const done = () => { const old = button.textContent; button.textContent = "Kopiert ✓"; setTimeout(() => button.textContent = old, 1400); };
    const fallback = () => { const t=document.createElement("textarea"); t.value=text; t.style.cssText="position:fixed;opacity:0"; document.body.appendChild(t); t.select(); try { document.execCommand("copy"); done(); } finally { t.remove(); } };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done).catch(fallback); else fallback();
  }

  function installCopyFix() {
    document.addEventListener("click", e => {
      const b=e.target.closest("[data-copy-value],#copy-address-button"); if(!b) return;
      e.preventDefault(); e.stopImmediatePropagation();
      const text=b.dataset.copyValue || $("address-display")?.textContent?.trim(); if(text) copyText(text,b);
    }, true);
  }

  function notify(title, body) {
    if ("Notification" in window && Notification.permission === "granted") new Notification(title,{body,icon:"/img/rzo.svg"});
  }

  function addShell() {
    const main=document.querySelector("main"); if(!main || $("rzo-v2-tools")) return;
    const section=document.createElement("section"); section.id="rzo-v2-tools"; section.className="rzo-section rzo-v2-section";
    section.innerHTML=`
      <div class="rzo-mission-status" aria-label="RZO Kontrollzentrum Status">
        <div class="rzo-health-item"><i id="health-pool"></i><span>Pool</span><strong id="health-pool-text">Prüfung …</strong></div>
        <div class="rzo-health-item"><i id="health-node"></i><span>Bitcoin Node</span><strong id="health-node-text">Prüfung …</strong></div>
        <div class="rzo-health-item"><i id="health-stratum"></i><span>Stratum</span><strong id="health-stratum-text">Prüfung …</strong></div>
        <div class="rzo-health-item"><i id="health-zmq"></i><span>ZMQ</span><strong id="health-zmq-text">nicht gemeldet</strong></div>
        <div class="rzo-health-item"><i id="health-api"></i><span>Web API</span><strong id="health-api-text">Prüfung …</strong></div>
      </div>
      <div class="rzo-section-heading"><div><span class="rzo-kicker">RZO WebUI v${V}</span><h2>Kontrollzentrum</h2></div>
      ${isMiner ? '<div class="rzo-v2-actions"><button id="rzo-notify">Benachrichtigungen</button><button id="rzo-export">CSV exportieren</button><button id="rzo-theme">Darstellung</button></div>' : ''}</div>
      <div class="rzo-mission-grid">
        <article class="rzo-mission-primary"><span>Live Hashrate</span><strong id="rzo-mission-hash">–</strong><small id="rzo-mission-workers">Worker werden geladen</small></article>
        <article class="rzo-v2-card"><span>Erwartete Blockzeit</span><strong id="rzo-block-time">–</strong><small>Mathematischer Erwartungswert</small></article>
        <article class="rzo-v2-card"><span>Chance pro Stunde</span><strong id="rzo-chance-hour">–</strong><small id="rzo-chance-hour-detail">Wird berechnet</small></article>
        <article class="rzo-v2-card"><span>Chance pro Tag</span><strong id="rzo-chance-day">–</strong><small id="rzo-chance-day-detail">Wird berechnet</small></article>
        <article class="rzo-v2-card"><span>Chance pro Woche</span><strong id="rzo-chance-week">–</strong><small id="rzo-chance-week-detail">Wird berechnet</small></article>
        <article class="rzo-v2-card"><span>Best Share / Blockziel</span><strong id="rzo-best-ratio">–</strong><small id="rzo-best-factor">–</small></article>
        <article class="rzo-v2-card"><span>Statistischer Fortschritt</span><strong id="rzo-luck">–</strong><small id="rzo-luck-detail">Seit Beginn der RZO-Erfassung</small></article>
        <article class="rzo-v2-card"><span>Erwartungsfaktor</span><strong id="rzo-expected-factor">–</strong><small id="rzo-expected-factor-detail">Noch keine ausreichenden Daten</small></article>
        <article class="rzo-v2-card"><span>Netzwerk-Difficulty</span><strong id="rzo-network-diff">–</strong><small id="rzo-block-height">Blockhöhe wird geladen</small></article>
        <article class="rzo-v2-card"><span>Netzwerk-Hashrate</span><strong id="rzo-network-hash">–</strong><small id="rzo-diff-change">Daten vom Bitcoin-Backend</small></article>
        <article class="rzo-v2-card"><span>Mempool</span><strong id="rzo-mempool">–</strong><small id="rzo-fee">Vom Backend, sofern verfügbar</small></article>
        <article class="rzo-v2-card"><span>Rekord-Hashrate</span><strong id="rzo-record-hash">–</strong><small>Browserlokaler Rekord auf diesem Gerät</small></article>
        <article class="rzo-v2-card"><span>Coinbase-Tag</span><strong>|RZO|</strong><small>Im gelieferten ScriptSig verifiziert</small></article>
      </div>
      <div class="rzo-chart-panel rzo-chart-panel-v32">
        <div class="rzo-chart-head">
          <div>
            <strong>Hashrate-Verlauf</strong>
            <small>Live-Verlauf auf diesem Gerät</small>
          </div>
          <div class="rzo-range">
            <button data-range="3600000">1 h</button>
            <button data-range="21600000">6 h</button>
            <button data-range="86400000" class="is-active">24 h</button>
            <button data-range="604800000">7 T</button>
          </div>
        </div>

        <div class="rzo-chart-summary">
          <div><span>Aktuell</span><strong id="rzo-chart-current">–</strong></div>
          <div><span>Ø</span><strong id="rzo-chart-average">–</strong></div>
          <div><span>Minimum</span><strong id="rzo-chart-min">–</strong></div>
          <div><span>Maximum</span><strong id="rzo-chart-max">–</strong></div>
        </div>

        <div class="rzo-chart-canvas-wrap rzo-chart-canvas-wrap-v32">
          <canvas id="rzo-history-chart" class="rzo-history-chart" height="300" aria-label="Hashrate-Verlauf"></canvas>
        </div>
      </div>

      <style id="rzo-connected-miners-style">
        .rzo-connected-miners-panel {
          margin-top: 18px;
        }

        .rzo-connected-miners-wrap {
          overflow-x: auto;
          margin-top: 12px;
        }

        .rzo-connected-miners-table {
          width: 100%;
          min-width: 680px;
          border-collapse: collapse;
        }

        .rzo-connected-miners-table th,
        .rzo-connected-miners-table td {
          padding: 11px 12px;
          text-align: right;
          border-bottom: 1px solid rgba(255,255,255,.08);
          white-space: nowrap;
        }

        .rzo-connected-miners-table th:first-child,
        .rzo-connected-miners-table td:first-child {
          text-align: left;
        }

        .rzo-connected-miners-table th {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: .08em;
          opacity: .65;
        }

        .rzo-connected-miners-table tbody tr:last-child td {
          border-bottom: 0;
        }

        .rzo-connected-device {
          font-weight: 700;
        }

        .rzo-connected-note {
          display: block;
          margin-top: 10px;
          opacity: .62;
          font-size: 12px;
        }
      </style>

      <article
        id="rzo-connected-miners-panel"
        class="rzo-v2-list rzo-connected-miners-panel"
        ${isMiner ? "hidden" : ""}
      >
        <div class="rzo-list-title">
          <div>
            <span class="rzo-list-kicker">
              LIVE · STRATUM
            </span>
            <h3>Connected Miners</h3>
          </div>

          <span
            id="rzo-connected-miners-count"
            class="rzo-list-badge"
          >– WORKING</span>
        </div>

        <div class="rzo-connected-miners-wrap">
          <table class="rzo-connected-miners-table">
            <thead>
              <tr>
                <th>Gerätetyp</th>
                <th>Working</th>
                <th>Hashrate</th>
                <th>Pool-Anteil</th>
                <th>Aktuelle Best Diff</th>
              </tr>
            </thead>

            <tbody id="rzo-connected-miners-body">
              <tr>
                <td colspan="5">
                  Gerätedaten werden geladen …
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <small
          id="rzo-connected-miners-note"
          class="rzo-connected-note"
        ></small>
      </article>

      <div class="rzo-v2-columns rzo-v32-lists">
        <article class="rzo-v2-list rzo-topshare-panel">
          <div class="rzo-list-title">
            <div>
              <span class="rzo-list-kicker">${isMiner ? "PERSÖNLICH" : "POOLWEIT"}</span>
              <h3>${isMiner ? "Meine Top 20 Share Difficulty" : "Top 20 Share Difficulty"}</h3>
            </div>
            <span class="rzo-list-badge">ALL-TIME</span>
          </div>
          <div id="rzo-top-share-list">
            <p class="rzo-muted">Bestenliste wird geladen …</p>
          </div>
        </article>

        <article class="rzo-v2-list">
          <div class="rzo-list-title">
            <div>
              <span class="rzo-list-kicker">REKORDE</span>
              <h3>RZO Rekordzentrum</h3>
            </div>
          </div>
          <div id="rzo-record-list"></div>
        </article>
      </div>

      <article class="rzo-v2-list rzo-block-hit-panel">
        <div class="rzo-list-title">
          <div>
            <span class="rzo-list-kicker">BITCOIN</span>
            <h3>RZO Blocktreffer</h3>
          </div>
          <span id="rzo-block-hit-count" class="rzo-list-badge">0 BLÖCKE</span>
        </div>
        <div id="rzo-block-hit-list">
          <div class="rzo-block-empty">
            <strong>Noch kein Block gefunden</strong>
            <span>Sobald RZO einen gültigen Bitcoin-Block findet, erscheint er hier.</span>
          </div>
        </div>
      </article>`;
    main.insertBefore(section, main.firstElementChild);
    if ($("rzo-notify")) $("rzo-notify").onclick=async()=>{ if(!("Notification" in window)) return alert("Dieser Browser unterstützt keine Desktop-Benachrichtigungen."); const p=await Notification.requestPermission(); $("rzo-notify").textContent=p==="granted"?"Benachrichtigungen aktiv":"Nicht erlaubt"; };
    if ($("rzo-theme")) $("rzo-theme").onclick=()=>{document.documentElement.classList.toggle("rzo-light");localStorage.setItem("rzo-theme",document.documentElement.classList.contains("rzo-light")?"light":"dark");};
    if ($("rzo-export")) $("rzo-export").onclick=exportCsv;
    document.querySelectorAll("[data-range]").forEach(b=>b.onclick=()=>{document.querySelectorAll("[data-range]").forEach(x=>x.classList.remove("is-active"));b.classList.add("is-active");drawChart(number(b.dataset.range));});
  }

  function setHealth(id, status, text) {
    const dot=$(id), label=$(`${id}-text`); if(!dot || !label) return;
    dot.className=status; label.textContent=text;
  }


  function showBlockCelebration(blocks, height) {
    let overlay=$("rzo-block-celebration");
    if(!overlay){ overlay=document.createElement("div"); overlay.id="rzo-block-celebration"; overlay.className="rzo-block-celebration"; document.body.appendChild(overlay); }
    overlay.innerHTML=`<div class="rzo-block-modal"><div class="rzo-bitcoin-burst">₿</div><span>RZO · RechenZauberOnline</span><h2>BLOCK GEFUNDEN!</h2><p>${height ? `Blockhöhe ${fmt(height,0)}` : `Gefundene Blöcke: ${fmt(blocks,0)}`}</p><button type="button">Mining fortsetzen</button></div>`;
    overlay.classList.add("is-visible");
    overlay.querySelector("button").onclick=()=>overlay.classList.remove("is-visible");
    setTimeout(()=>overlay.classList.remove("is-visible"),20000);
  }

  function addMinerTools() {
    if(!isMiner) return;
    const heading=document.querySelector(".rzo-worker-toolbar"); if(!heading || $("rzo-favorites-only")) return;
    const b=document.createElement("button"); b.id="rzo-favorites-only"; b.type="button"; b.textContent="★ Favoriten"; b.className="rzo-favorite-filter"; heading.appendChild(b);
    b.onclick=()=>{b.classList.toggle("is-active");applyFavoritesFilter();};
    const list=$("worker-list"); if(list) new MutationObserver(enhanceWorkers).observe(list,{childList:true,subtree:true});
  }

  function minerType(name) {
    const n=name.toLowerCase();
    if(n.includes("nerdq") || n.includes("axe++")) return ["NQ","NerdQAxe"];
    if(n.includes("bitaxe") || n.includes("gamma")) return ["BA","Bitaxe"];
    if(n.includes("avalon")) return ["AV","Avalon"];
    if(n.includes("lucky") || n.includes("lv08")) return ["LM","Lucky Miner"];
    if(n.includes("antminer") || n.includes("s19") || n.includes("s21")) return ["AM","Antminer"];
    return ["⛏","Miner"];
  }

  function enhanceWorkers(){
    const favorites=new Set(JSON.parse(localStorage.getItem("rzo-favorites")||"[]"));
    document.querySelectorAll("#worker-list > *").forEach(card=>{
      if(card.dataset.v2) return; card.dataset.v2="1";
      const name=card.querySelector("h3,strong")?.textContent?.trim()||"Worker";
      const [icon,type]=minerType(name);
      const typeBadge=document.createElement("span"); typeBadge.className="rzo-miner-type"; typeBadge.innerHTML=`<b>${icon}</b>${type}`; card.prepend(typeBadge);
      const star=document.createElement("button"); star.className="rzo-star"; star.type="button"; star.title="Worker anheften"; star.textContent=favorites.has(name)?"★":"☆";
      star.onclick=()=>{const f=new Set(JSON.parse(localStorage.getItem("rzo-favorites")||"[]"));if(f.has(name))f.delete(name);else f.add(name);localStorage.setItem("rzo-favorites",JSON.stringify([...f]));star.textContent=f.has(name)?"★":"☆";applyFavoritesFilter();}; card.prepend(star);
      const m=card.textContent.match(/Reject-Quote\s*([\d,.]+)\s*%/i); const rate=m?number(m[1].replace(",",".")):0;
      const badge=document.createElement("span");badge.className=`rzo-quality ${rate>1?"bad":rate>.2?"warn":"good"}`;badge.textContent=rate>1?"Prüfen":rate>.2?"Gut":"Perfekt";card.appendChild(badge);
    }); applyFavoritesFilter();
  }
  function applyFavoritesFilter(){const only=$("rzo-favorites-only")?.classList.contains("is-active");const f=new Set(JSON.parse(localStorage.getItem("rzo-favorites")||"[]"));document.querySelectorAll("#worker-list > *").forEach(c=>{const n=c.querySelector("h3,strong")?.textContent?.trim()||"";c.classList.toggle("rzo-hidden-favorite",only&&!f.has(n));});}

  function recordPoint(hashrate, accepted, best, blocks, difficulty, height){
    const now=Date.now(); const last=state.history.at(-1);
    if(!last || now-last.t>25000) state.history.push({t:now,h:hashrate,a:accepted,b:best,d:difficulty});
    if(state.history.length>MAX_POINTS*4) state.history=state.history.filter((_,i)=>i%2===0);
    state.history=state.history.filter(p=>now-p.t<604800000);
    state.records.hash=Math.max(number(state.records.hash),hashrate);
    state.records.best=Math.max(number(state.records.best),best);
    localStorage.setItem("rzo-pool-best-diff", String(state.records.best));
    state.records.blocks=Math.max(number(state.records.blocks),blocks);
    state.records.maxAccepted=Math.max(number(state.records.maxAccepted),accepted);
    state.records.lastHeight=Math.max(number(state.records.lastHeight),number(height));
    if(state.baseline.blocks == null) state.baseline.blocks=blocks;
    if(lastAccepted!==null && accepted>lastAccepted){const delta=accepted-lastAccepted;state.events.unshift({t:now,text:`${fmt(delta,0)} neue gültige Share${delta===1?"":"s"}`});}
    if(best>lastBest){state.events.unshift({t:now,text:`Neuer Best Share: ${diff(best)}`});notify("RZO: Neuer Best Share",diff(best));lastBest=best;}
    if(blocks>lastBlocks){state.events.unshift({t:now,text:`BLOCK GEFUNDEN! Gesamt: ${blocks}`});notify("RZO: BLOCK GEFUNDEN!",`Blockanzahl: ${blocks}`);showBlockCelebration(blocks,height);lastBlocks=blocks;}
    state.events=state.events.slice(0,20); lastAccepted=accepted; save();
  }

  function drawChart(range=86400000){
    const c=$("rzo-history-chart");
    if(!c) return;

    const wrap=c.parentElement;
    const cssWidth=Math.floor(wrap?.getBoundingClientRect().width||0);
    if(cssWidth<80) return;

    const dpr=Math.min(window.devicePixelRatio||1,2);
    const w=cssWidth;
    const h=300;
    const pad={l:76,r:18,t:20,b:42};

    c.style.width=`${w}px`;
    c.style.height=`${h}px`;
    c.width=Math.floor(w*dpr);
    c.height=Math.floor(h*dpr);

    const ctx=c.getContext("2d");
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,w,h);

    const now=Date.now();
    const pts=state.history.filter(p=>now-p.t<=range && number(p.h)>0);

    const setStat=(id,value)=>{const el=$(id);if(el)el.textContent=value;};

    if(!pts.length){
      setStat("rzo-chart-current","–");
      setStat("rzo-chart-average","–");
      setStat("rzo-chart-min","–");
      setStat("rzo-chart-max","–");
      ctx.fillStyle=getComputedStyle(document.body).color;
      ctx.globalAlpha=.72;
      ctx.font="13px system-ui";
      ctx.fillText("Der Verlauf wird aufgebaut …",pad.l,pad.t+24);
      ctx.globalAlpha=1;
      return;
    }

    const values=pts.map(p=>number(p.h));
    const rawMin=Math.min(...values);
    const rawMax=Math.max(...values);
    const avg=values.reduce((a,b)=>a+b,0)/values.length;
    const current=values.at(-1);

    setStat("rzo-chart-current",hr(current));
    setStat("rzo-chart-average",hr(avg));
    setStat("rzo-chart-min",hr(rawMin));
    setStat("rzo-chart-max",hr(rawMax));

    let min=rawMin;
    let max=rawMax;
    let span=max-min;

    if(span<=0){
      span=Math.max(max*.08,1);
      min=Math.max(0,min-span/2);
      max=max+span/2;
    }else{
      const margin=span*.12;
      min=Math.max(0,min-margin);
      max=max+margin;
      span=max-min;
    }

    const plotW=w-pad.l-pad.r;
    const plotH=h-pad.t-pad.b;

    const accent=getComputedStyle(document.documentElement)
      .getPropertyValue("--rzo-accent").trim()||"#69d2ff";
    const bodyColor=getComputedStyle(document.body).color;

    ctx.font="11px system-ui";
    ctx.textBaseline="middle";

    for(let i=0;i<=4;i++){
      const y=pad.t+(plotH/4)*i;
      const value=max-(span/4)*i;

      ctx.beginPath();
      ctx.strokeStyle="rgba(148,163,184,.14)";
      ctx.lineWidth=1;
      ctx.moveTo(pad.l,y);
      ctx.lineTo(w-pad.r,y);
      ctx.stroke();

      ctx.fillStyle=bodyColor;
      ctx.globalAlpha=.62;
      ctx.textAlign="right";
      ctx.fillText(hr(value),pad.l-10,y);
      ctx.globalAlpha=1;
    }

    const firstT=pts[0].t;
    const lastT=pts.at(-1).t;
    const timeSpan=Math.max(lastT-firstT,1);

    const pxFor=p=>pad.l+((p.t-firstT)/timeSpan)*plotW;
    const pyFor=p=>pad.t+plotH-((number(p.h)-min)/span)*plotH;

    ctx.textAlign="center";
    ctx.textBaseline="top";

    for(let i=0;i<=4;i++){
      const ratio=i/4;
      const x=pad.l+plotW*ratio;
      const t=firstT+timeSpan*ratio;
      const d=new Date(t);
      const label=range>=604800000
        ? d.toLocaleDateString("de-DE",{day:"2-digit",month:"2-digit"})
        : d.toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit"});

      ctx.fillStyle=bodyColor;
      ctx.globalAlpha=.58;
      ctx.fillText(label,x,h-pad.b+12);
      ctx.globalAlpha=1;
    }

    const gradient=ctx.createLinearGradient(0,pad.t,0,pad.t+plotH);
    gradient.addColorStop(0,"rgba(105,210,255,.24)");
    gradient.addColorStop(1,"rgba(105,210,255,.015)");

    ctx.beginPath();
    pts.forEach((p,i)=>{
      const x=pxFor(p), y=pyFor(p);
      if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    });
    ctx.lineTo(pxFor(pts.at(-1)),pad.t+plotH);
    ctx.lineTo(pxFor(pts[0]),pad.t+plotH);
    ctx.closePath();
    ctx.fillStyle=gradient;
    ctx.fill();

    ctx.beginPath();
    pts.forEach((p,i)=>{
      const x=pxFor(p), y=pyFor(p);
      if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    });
    ctx.strokeStyle=accent;
    ctx.lineWidth=2.4;
    ctx.lineJoin="round";
    ctx.lineCap="round";
    ctx.stroke();

    const last=pts.at(-1);
    ctx.beginPath();
    ctx.arc(pxFor(last),pyFor(last),3.6,0,Math.PI*2);
    ctx.fillStyle=accent;
    ctx.fill();
  }

  function localExpectedBlocks(){
    let expected=0;
    for(let i=1;i<state.history.length;i++){const a=state.history[i-1],b=state.history[i],dt=Math.min((b.t-a.t)/1000,300),d=number(a.d||b.d);if(d>0&&dt>0)expected+=(number(a.h)*dt)/(d*Math.pow(2,32));}
    return expected;
  }

  function maskAddress(address){
    const s=String(address||"").trim();
    if(!s) return "–";
    if(s.length<=18) return `${s.slice(0,5)}••••${s.slice(-4)}`;
    return `${s.slice(0,10)}••••••••••${s.slice(-6)}`;
  }

  function personalTopShares(mine){
    if(!mine || !Array.isArray(mine.workers)) return {rows:[]};

    const address=maskAddress(mine.address||activeAddressFromPage());

    const rows=mine.workers
      .map(worker=>({
        worker: worker.name || worker.worker_name || "Miner",
        best_share: number(
          worker.all_time_best_share ??
          worker.best_share ??
          0
        ),
        address
      }))
      .filter(row=>row.best_share>0)
      .sort((a,b)=>b.best_share-a.best_share)
      .slice(0,20);

    return {scope:"user",rows};
  }

  function renderConnectedMiners(payload){
    const body=$("rzo-connected-miners-body");
    const badge=$("rzo-connected-miners-count");
    const note=$("rzo-connected-miners-note");

    if(!body) return;

    const rows=Array.isArray(payload?.rows)
      ? payload.rows
      : [];

    const working=number(payload?.working);
    const watcher=number(payload?.watcher_identified);
    const fallback=number(payload?.fallback_identified);
    const unknown=number(payload?.unknown);

    if(badge){
      badge.textContent=`${fmt(working,0)} WORKING`;
    }

    if(!rows.length){
      body.innerHTML=`
        <tr>
          <td colspan="5">
            Noch keine aktiven Miner gefunden.
          </td>
        </tr>`;

      if(note){
        note.textContent=
          "Gerätetypen werden bei Stratum-Neuverbindungen automatisch gelernt.";
      }

      return;
    }

    body.innerHTML=rows.map(row=>`
      <tr>
        <td>
          <span class="rzo-connected-device">
            ${escapeHtml(row.type||"Unbekannt")}
          </span>
        </td>

        <td>
          ${fmt(number(row.working),0)}
        </td>

        <td>
          ${hr(number(row.hashrate_5m))}
        </td>

        <td>
          ${fmt(number(row.pool_share_pct),2)} %
        </td>

        <td>
          ${diff(number(row.best_share))}
        </td>
      </tr>
    `).join("");

    if(note){
      const bits=[];

      if(watcher){
        bits.push(
          `${fmt(watcher,0)} direkt über Stratum erkannt`
        );
      }

      if(fallback){
        bits.push(
          `${fmt(fallback,0)} vorübergehend über Workername`
        );
      }

      if(unknown){
        bits.push(
          `${fmt(unknown,0)} noch unbekannt`
        );
      }

      note.textContent=
        bits.length
          ? bits.join(" · ")
          : "Stratum Device Watcher aktiv.";
    }
  }


  function renderTopShares(payload){
    const root=$("rzo-top-share-list");
    if(!root) return;

    const rows=Array.isArray(payload?.rows)?payload.rows.slice(0,20):[];

    if(!rows.length){
      root.innerHTML=`<div class="rzo-block-empty"><strong>Noch keine Share-Rekorde verfügbar</strong><span>Sobald Worker Best-Difficulty-Werte liefern, erscheinen sie hier.</span></div>`;
      return;
    }

    const medals=["🥇","🥈","🥉"];

    root.innerHTML=rows.map((row,index)=>{
      const rank=medals[index]||`${index+1}.`;
      return `<div class="rzo-topshare-row">
        <span class="rzo-topshare-rank">${rank}</span>
        <div class="rzo-topshare-miner">
          <strong>${escapeHtml(row.worker||"Miner")}</strong>
          <small>${escapeHtml(row.address||"–")}</small>
        </div>
        <strong class="rzo-topshare-diff">${diff(row.best_share)}</strong>
      </div>`;
    }).join("");
  }

  function formatBlockTime(value){
    if(value==null || value==="") return "Zeit nicht gemeldet";

    let date;

    if(typeof value==="number" || /^\d+(\.\d+)?$/.test(String(value))){
      let n=number(value);
      if(n<1e12) n*=1000;
      date=new Date(n);
    }else{
      date=new Date(value);
    }

    if(Number.isNaN(date.getTime())) return String(value);

    return date.toLocaleString("de-DE",{
      day:"2-digit",
      month:"2-digit",
      year:"numeric",
      hour:"2-digit",
      minute:"2-digit",
      second:"2-digit"
    });
  }

  function renderBlockHits(payload){
    const root=$("rzo-block-hit-list");
    const count=$("rzo-block-hit-count");
    if(!root) return;

    const rows=Array.isArray(payload?.blocks)?payload.blocks:[];
    const blockCount=number(payload?.block_count,rows.length);

    if(count) count.textContent=`${fmt(blockCount,0)} ${blockCount===1?"BLOCK":"BLÖCKE"}`;

    if(!rows.length){
      root.innerHTML=`<div class="rzo-block-empty">
        <strong>Noch kein Block gefunden</strong>
        <span>Sobald RZO einen gültigen Bitcoin-Block findet, erscheint er hier automatisch.</span>
      </div>`;
      return;
    }

    root.innerHTML=rows.map((row,index)=>{
      const height=number(row.height);
      const hash=String(row.hash||"").trim();
      const hashText=hash
        ? `${hash.slice(0,14)}${hash.length>26?"…":""}${hash.length>26?hash.slice(-10):""}`
        : "Blockhash nicht gemeldet";

      return `<div class="rzo-block-hit-row">
        <div class="rzo-block-hit-rank">#${index+1}</div>
        <div class="rzo-block-hit-main">
          <strong>${height?`Block ${fmt(height,0)}`:"Bitcoin-Block"}</strong>
          <span>${escapeHtml(formatBlockTime(row.found_at))}</span>
        </div>
        <div class="rzo-block-hit-miner">
          <strong>${escapeHtml(row.worker||"Unbekannter Miner")}</strong>
          <span>${escapeHtml(row.address||"–")}</span>
        </div>
        <div class="rzo-block-hit-hash">
          <code>${escapeHtml(hashText)}</code>
          ${number(row.share_difficulty)>0?`<small>Share Diff ${diff(row.share_difficulty)}</small>`:""}
        </div>
      </div>`;
    }).join("");
  }

  function renderExtras(hashrate,best,difficulty,meta={}){
    const ratio=difficulty>0?best/difficulty:0;

    state.records.maxWorkers=Math.max(number(state.records.maxWorkers),number(meta.workers));
    state.records.maxSessions=Math.max(number(state.records.maxSessions),number(meta.sessions));

    $("rzo-mission-hash").textContent=hr(hashrate);
    $("rzo-mission-workers").textContent=`${fmt(meta.workers,0)} Worker · ${fmt(meta.sessions,0)} Sessions`;

    $("rzo-best-ratio").textContent=difficulty?`${fmt(ratio*100,8)} %`:"–";
    $("rzo-best-factor").textContent=ratio>0
      ? `Noch Faktor ${fmt(1/ratio,0)} bis zum Blockziel`
      : "Noch kein Vergleich möglich";

    $("rzo-record-hash").textContent=hr(state.records.hash);

    if(hashrate>0&&difficulty>0){
      const hashes=difficulty*Math.pow(2,32);
      const sec=hashes/hashrate;

      const chanceForSeconds=seconds =>
        1-Math.exp(-(hashrate*seconds)/hashes);

      const hour=chanceForSeconds(3600);
      const day=chanceForSeconds(86400);
      const week=chanceForSeconds(604800);

      $("rzo-block-time").textContent=formatYears(sec);

      $("rzo-chance-hour").textContent=`${fmt(hour*100,10)} %`;
      $("rzo-chance-day").textContent=`${fmt(day*100,9)} %`;
      $("rzo-chance-week").textContent=`${fmt(week*100,8)} %`;

      $("rzo-chance-hour-detail").textContent=
        hour>0 ? `etwa 1 zu ${fmt(1/hour,0)}` : "Unterhalb der Anzeigegrenze";

      $("rzo-chance-day-detail").textContent=
        day>0 ? `etwa 1 zu ${fmt(1/day,0)}` : "Unterhalb der Anzeigegrenze";

      $("rzo-chance-week-detail").textContent=
        week>0 ? `etwa 1 zu ${fmt(1/week,0)}` : "Unterhalb der Anzeigegrenze";
    }else{
      $("rzo-block-time").textContent="–";
      $("rzo-chance-hour").textContent="–";
      $("rzo-chance-day").textContent="–";
      $("rzo-chance-week").textContent="–";
    }

    const expected=localExpectedBlocks();
    const found=Math.max(
      0,
      number(state.records.blocks)-number(state.baseline.blocks)
    );

    $("rzo-luck").textContent=expected>0
      ? found>0
        ? `${fmt((found/expected)*100,2)} %`
        : `${fmt(expected*100,6)} %`
      : "–";

    $("rzo-luck-detail").textContent=found>0
      ? `${found} Block${found===1?"":"s"} bei ${fmt(expected,6)} statistisch erwartet`
      : expected>0
        ? `${fmt(expected,8)} statistisch erwartete Blöcke`
        : "Die lokale Erfassung wird aufgebaut";

    if(expected>0){
      const factor=1/expected;

      $("rzo-expected-factor").textContent=
        expected>=1 ? "Erwartungswert erreicht" : `1 / ${fmt(factor,0)}`;

      $("rzo-expected-factor-detail").textContent=
        expected>=1
          ? `${fmt(expected*100,2)} % des Erwartungswertes gesammelt`
          : `Noch Faktor ${fmt(factor,0)} bis 1,0 erwartetem Block`;
    }else{
      $("rzo-expected-factor").textContent="–";
      $("rzo-expected-factor-detail").textContent=
        "Noch keine ausreichenden Verlaufsdaten";
    }
    $("rzo-network-diff").textContent=difficulty?diff(difficulty):"–"; $("rzo-block-height").textContent=meta.height?`Blockhöhe ${fmt(meta.height,0)}`:"Blockhöhe nicht gemeldet";
    $("rzo-network-hash").textContent=meta.networkHash?hr(meta.networkHash):"–"; $("rzo-diff-change").textContent=meta.diffChange!=null?`Difficulty-Prognose: ${fmt(meta.diffChange,2)} %`:meta.networkHash?"Live von der lokalen RZO-Node":"Nicht gemeldet";
    $("rzo-mempool").textContent=meta.mempoolCount?`${fmt(meta.mempoolCount,0)} TX`:meta.mempoolBytes?`${fmt(meta.mempoolBytes/1e6,2)} MB`:"–";
    const mempoolBits=[]; if(meta.mempoolBytes)mempoolBits.push(`${fmt(meta.mempoolBytes/1024,0)} kB`); if(meta.fee)mempoolBits.push(`Fee ${fmt(meta.fee,1)} sat/vB`); if(!mempoolBits.length&&meta.mempoolCount)mempoolBits.push("Live von der lokalen RZO-Node"); $("rzo-fee").textContent=mempoolBits.length?mempoolBits.join(" · "):"Keine Detaildaten gemeldet";
    const recordedFor=Math.max(
      0,
      Date.now()-number(state.records.firstSeen,Date.now())
    );

    $("rzo-record-list").innerHTML=`
      <div class="rzo-record">
        <span>Höchste gemessene Hashrate</span>
        <strong>${hr(state.records.hash)}</strong>
      </div>
      <div class="rzo-record">
        <span>Größter Best Share</span>
        <strong>${diff(state.records.best)}</strong>
      </div>
      <div class="rzo-record">
        <span>Höchste Workeranzahl</span>
        <strong>${fmt(state.records.maxWorkers,0)}</strong>
      </div>
      <div class="rzo-record">
        <span>Höchste Sessionanzahl</span>
        <strong>${fmt(state.records.maxSessions,0)}</strong>
      </div>
      <div class="rzo-record">
        <span>Meiste gültige Shares</span>
        <strong>${fmt(state.records.maxAccepted,0)}</strong>
      </div>
      <div class="rzo-record">
        <span>Browserlokale Erfassungsdauer</span>
        <strong>${formatDuration(recordedFor)}</strong>
      </div>
      <div class="rzo-record">
        <span>Gefundene Blöcke</span>
        <strong>${fmt(state.records.blocks,0)}</strong>
      </div>
      <div class="rzo-record">
        <span>Coinbase-Tag</span>
        <strong>|RZO|</strong>
      </div>`;

    save();
    drawChart(
      number(
        document.querySelector("[data-range].is-active")?.dataset.range,
        86400000
      )
    );
  }

  function formatYears(sec){
    if(sec<3600)return `${fmt(sec/60,1)} Minuten`;
    if(sec<86400)return `${fmt(sec/3600,1)} Stunden`;
    if(sec<31557600)return `${fmt(sec/86400,1)} Tage`;
    return `≈ ${fmt(sec/31557600,1)} Jahre`;
  }

  function formatDuration(ms){
    const seconds=Math.max(0,ms/1000);
    if(seconds<3600)return `${fmt(seconds/60,0)} Min.`;
    if(seconds<86400)return `${fmt(seconds/3600,1)} Std.`;
    if(seconds<604800)return `${fmt(seconds/86400,1)} Tage`;
    return `${fmt(seconds/604800,1)} Wochen`;
  }

  async function getJson(url){const r=await fetch(url,{cache:"no-store"});if(!r.ok)throw new Error(`${url}: ${r.status}`);return r.json();}

  async function poll(){
    let poolOk=false,btcOk=false,systemOk=false;

    try{
      const results=await Promise.allSettled([
        getJson("/api/pool/status"),
        getJson("/api/bitcoin/status"),
        getJson("/api/system/status"),
        getJson("/api/node/diagnostics"),
        getJson("/api/pool/live-counts"),
        getJson("/api/pool/top-shares"),
        getJson("/api/pool/blocks"),
        getJson("/api/pool/connected-miners")
      ]);

      const pool=results[0].status==="fulfilled"?results[0].value:{};
      const btc=results[1].status==="fulfilled"?results[1].value:{};
      const sys=results[2].status==="fulfilled"?results[2].value:{};
      const node=results[3].status==="fulfilled"?results[3].value:{};
      const liveCounts=results[4].status==="fulfilled"?results[4].value:null;
      const poolTopShares=results[5].status==="fulfilled"?results[5].value:{rows:[]};
      const blockHits=results[6].status==="fulfilled"?results[6].value:{
        block_count:number(pool.block_count),
        blocks:Array.isArray(pool.recent_blocks)?pool.recent_blocks:[]
      };

      const connectedMiners=
        results[7].status==="fulfilled"
          ? results[7].value
          : {
              rows:[],
              working:0
            };

      if(!isMiner){
        renderConnectedMiners(
          connectedMiners
        );
      }

      poolOk=results[0].status==="fulfilled";
      btcOk=results[1].status==="fulfilled";
      systemOk=results[2].status==="fulfilled";

      const downstream=pool.downstream||{};
      const nestedStats=downstream.stats||{};

      let stats={
        ...downstream,
        ...nestedStats,
        best_share:
          downstream.totals?.best_share ??
          nestedStats.best_share ??
          downstream.best_share,
        last_share:
          downstream.totals?.last_share ??
          nestedStats.last_share ??
          downstream.last_share,
        delivered_hash_days:
          downstream.totals?.delivered_hash_days ??
          nestedStats.delivered_hash_days ??
          downstream.delivered_hash_days
      };

      let hash=number(pick(stats,["hashrate_5m","hashrate_1m"]));
      let accepted=number(stats.accepted_shares);
      let best=number(stats.best_share);
      const blocks=number(pool.block_count);
      let mine=null;

      if(isMiner&&activeAddressFromPage()){
        mine=await getJson(
          `/api/my-miners?address=${encodeURIComponent(activeAddressFromPage())}`
        ).catch(()=>null);

        if(mine){
          hash=number(mine.hashrate_5m||mine.hashrate);
          accepted=number(mine.accepted_shares);
          best=number(mine.all_time_best_share ?? mine.best_share);
        }
      }

      let difficulty=number(
        pick(btc,["difficulty","network_difficulty"])
      );

      if(!difficulty) difficulty=parseDisplayedDifficulty();

      const height=number(
        pick(btc,["blocks","block_height","height","chain_height"])
      );

      const networkHash=number(
        pick(btc,["network_hashrate","networkhashps","network_hash_ps","hashrate"])
      );

      const mempoolCount=number(
        pick(btc,["mempool_txs","mempool_size","mempool_count","tx_count"])
      );

      const directMempool=
        node?.mempool&&typeof node.mempool==="object"
          ? node.mempool
          : {};

      const mempoolBytes=number(
        pick(btc,["mempool_bytes","bytes"])
      );

      const mempoolDirectCount=number(
        pick(directMempool,["size"])
      );

      const fee=number(
        pick(btc,["recommended_fee","fastest_fee","fee_rate"])
      );

      const diffChangeRaw=pick(
        btc,
        ["difficulty_change","difficulty_adjustment","difficulty_change_percent"],
        null
      );

      const diffChange=
        diffChangeRaw==null ? null : number(diffChangeRaw);

      const sessions=number(
        liveCounts?.active_sessions ??
        downstream.session_count ??
        downstream.sessions ??
        pool.session_count
      );

      const workers=number(
        liveCounts?.active_workers ??
        sessions
      );

      const zmqInfo=
        node?.zmq&&typeof node.zmq==="object"
          ? node.zmq
          : null;

      const zmqValue=zmqInfo?zmqInfo.active:null;
      const zmqCount=zmqInfo?number(zmqInfo.count):0;
      const zmqConfigured=zmqInfo?number(zmqInfo.configured_count):0;
      const stratumReachable=node?.stratum?.reachable;
      const rpcReachable=node?.bitcoin_rpc?.reachable;

      setHealth(
        "health-pool",
        poolOk?"ok":"bad",
        poolOk?"Online":"Fehler"
      );

      setHealth(
        "health-node",
        btcOk&&rpcReachable!==false?"ok":"bad",
        btcOk
          ? (rpcReachable===true?"API + RPC erreichbar":"API verbunden")
          : "Nicht erreichbar"
      );

      setHealth(
        "health-api",
        systemOk||poolOk?"ok":"bad",
        systemOk||poolOk?"Online":"Fehler"
      );

      setHealth(
        "health-stratum",
        stratumReachable===true?"ok":poolOk?"unknown":"bad",
        stratumReachable===true
          ? `${fmt(sessions,0)} Sessions · Port offen`
          : poolOk
            ? `${fmt(sessions,0)} Sessions`
            : "Nicht erreichbar"
      );

      setHealth(
        "health-zmq",
        zmqValue===true?"ok":zmqValue===false?"bad":"unknown",
        zmqValue===true
          ? `${fmt(zmqCount,0)}/${fmt(zmqConfigured,0)} Endpunkte erreichbar`
          : zmqValue===false
            ? "Nicht erreichbar"
            : "nicht prüfbar"
      );

      recordPoint(
        hash,
        accepted,
        best,
        blocks,
        difficulty,
        height
      );

      renderExtras(
        hash,
        best,
        difficulty,
        {
          height,
          networkHash,
          mempoolCount:mempoolDirectCount||mempoolCount,
          mempoolBytes,
          fee,
          diffChange,
          workers,
          sessions,
          sys,
          zmqCount
        }
      );

      renderTopShares(
        isMiner
          ? personalTopShares(mine)
          : poolTopShares
      );

      renderBlockHits(blockHits);
      enhanceWorkers();

    }catch(e){
      setHealth("health-pool","bad","Fehler");
      setHealth("health-api","bad","Fehler");
      console.debug("RZO v3.2 poll:",e);
    }finally{
      setTimeout(poll,30000);
    }
  }

  function activeAddressFromPage(){return $("address-display")?.textContent?.trim().startsWith("bc1")?$("address-display").textContent.trim():new URLSearchParams(location.search).get("address")||"";}
  function parseDisplayedDifficulty(){const s=$("network-difficulty")?.textContent||"";const m=s.replace(/\./g,"").replace(",",".").match(/[\d.]+/);let n=m?number(m[0]):0;if(/T/i.test(s))n*=1e12;if(/G/i.test(s))n*=1e9;return n;}
  function exportCsv(){const rows=[["Zeit","Hashrate_Hs","Accepted","Best_Diff","Network_Diff"],...state.history.map(p=>[new Date(p.t).toISOString(),p.h,p.a,p.b,p.d])];const blob=new Blob([rows.map(r=>r.join(";")).join("\n")],{type:"text/csv;charset=utf-8"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`rzo-history-${new Date().toISOString().slice(0,10)}.csv`;a.click();URL.revokeObjectURL(a.href);}
  function installPwa(){const link=document.createElement("link");link.rel="manifest";link.href="/manifest.webmanifest";document.head.appendChild(link);}
  function init(){if(localStorage.getItem("rzo-theme")==="light")document.documentElement.classList.add("rzo-light");installCopyFix();addShell();addMinerTools();installPwa();enhanceWorkers();poll();let timer;const redraw=()=>{clearTimeout(timer);timer=setTimeout(()=>drawChart(number(document.querySelector("[data-range].is-active")?.dataset.range,86400000)),80);};window.addEventListener("resize",redraw);const wrap=document.querySelector(".rzo-chart-canvas-wrap");if(wrap&&"ResizeObserver"in window)new ResizeObserver(redraw).observe(wrap);}
  document.readyState==="loading"?document.addEventListener("DOMContentLoaded",init):init();
})();
