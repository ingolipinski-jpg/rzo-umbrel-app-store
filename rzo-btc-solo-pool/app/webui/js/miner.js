"use strict";

const REFRESH_INTERVAL = 5000;
const HASHRATE_HISTORY_LIMIT = 120;

const elements = {
  addressInput: document.getElementById("address-input"),
  addressButton: document.getElementById("address-button"),
  addressMessage: document.getElementById("address-message"),
  copyAddressButton: document.getElementById("copy-address-button"),

  dashboard: document.getElementById("miner-dashboard"),
  addressDisplay: document.getElementById("address-display"),

  hashrate: document.getElementById("user-hashrate"),
  workers: document.getElementById("user-workers"),
  sessions: document.getElementById("user-sessions"),
  bestShare: document.getElementById("user-best-share"),
  lastShare: document.getElementById("user-last-share"),
  lastShareDate: document.getElementById("user-last-share-date"),
  hashDays: document.getElementById("user-hash-days"),

  acceptedShares: document.getElementById("user-accepted-shares"),
  rejectedShares: document.getElementById("user-rejected-shares"),
  rejectRate: document.getElementById("user-reject-rate"),
  averageWorkerHashrate: document.getElementById(
    "average-worker-hashrate",
  ),

  workerList: document.getElementById("worker-list"),
  workerFallback: document.getElementById("worker-fallback"),
  workerNoResults: document.getElementById("worker-no-results"),
  workerSummary: document.getElementById("worker-summary"),
  workerSearch: document.getElementById("worker-search"),
  workerFilters: document.getElementById("worker-filters"),
  workerStatusSummary: document.getElementById(
    "worker-status-summary",
  ),

  connectionStatus: document.getElementById("connection-status"),
  updatedAt: document.getElementById("updated-at"),
  liveDot: document.getElementById("live-dot"),

  bitcoinHeight: document.getElementById("bitcoin-height"),
  networkDifficulty: document.getElementById("network-difficulty"),
  networkHashrate: document.getElementById("network-hashrate"),
  mempoolTransactions: document.getElementById(
    "mempool-transactions",
  ),

  bestDiffPercentage: document.getElementById(
    "best-diff-percentage",
  ),
  bestDiffProgress: document.getElementById("best-diff-progress"),

  userSparklineLine: document.getElementById("user-sparkline-line"),
  hashrateTrend: document.getElementById("hashrate-trend"),

  poolUptime: document.getElementById("pool-uptime"),
  poolBlockCount: document.getElementById("pool-block-count"),
  poolBestDiff: document.getElementById("pool-best-diff"),

  systemUptime: document.getElementById("system-uptime"),
  systemCpu: document.getElementById("system-cpu"),
  systemMemory: document.getElementById("system-memory"),
  systemDisk: document.getElementById("system-disk"),
};

let activeAddress = "";
let refreshTimer = null;
let activeWorkerFilter = "all";
let latestWorkers = [];
let latestNetworkDifficulty = 0;
let previousWorkerShares = new Map();
let hashrateHistory = [];

function toFiniteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function formatNumber(value, maximumFractionDigits = 2) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "–";
  }

  return new Intl.NumberFormat("de-DE", {
    maximumFractionDigits,
  }).format(number);
}

function formatPercent(value, maximumFractionDigits = 3) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "–";
  }

  return `${formatNumber(number, maximumFractionDigits)} %`;
}

function formatHashrate(value) {
  const number = Number(value);

  if (!Number.isFinite(number) || number < 0) {
    return "–";
  }

  const units = [
    ["EH/s", 1e18],
    ["PH/s", 1e15],
    ["TH/s", 1e12],
    ["GH/s", 1e9],
    ["MH/s", 1e6],
    ["kH/s", 1e3],
    ["H/s", 1],
  ];

  for (const [unit, divisor] of units) {
    if (number >= divisor) {
      return `${formatNumber(number / divisor, 2)} ${unit}`;
    }
  }

  return "0 H/s";
}

function formatHashDays(value) {
  const number = Number(value);

  if (!Number.isFinite(number) || number < 0) {
    return "–";
  }

  const units = [
    ["EH·Tage", 1e18],
    ["PH·Tage", 1e15],
    ["TH·Tage", 1e12],
    ["GH·Tage", 1e9],
    ["MH·Tage", 1e6],
    ["kH·Tage", 1e3],
    ["H·Tage", 1],
  ];

  for (const [unit, divisor] of units) {
    if (number >= divisor) {
      return `${formatNumber(number / divisor, 2)} ${unit}`;
    }
  }

  return "0 H·Tage";
}

function formatDifficulty(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "–";
  }

  const absolute = Math.abs(number);

  const units = [
    [1e18, "E"],
    [1e15, "P"],
    [1e12, "T"],
    [1e9, "G"],
    [1e6, "M"],
    [1e3, "K"],
  ];

  for (const [divisor, suffix] of units) {
    if (absolute >= divisor) {
      return `${formatNumber(number / divisor, 2)} ${suffix}`;
    }
  }

  return formatNumber(number, 2);
}

function formatDuration(value) {
  let seconds = Math.floor(toFiniteNumber(value));

  if (seconds < 0) {
    return "–";
  }

  const days = Math.floor(seconds / 86400);
  seconds %= 86400;

  const hours = Math.floor(seconds / 3600);
  seconds %= 3600;

  const minutes = Math.floor(seconds / 60);

  const parts = [];

  if (days > 0) {
    parts.push(`${days} T`);
  }

  if (hours > 0 || days > 0) {
    parts.push(`${hours} Std`);
  }

  parts.push(`${minutes} Min`);

  return parts.join(" ");
}

function formatSessionRuntime(value) {
  const timestamp = normalizeTimestamp(value);
  if (!timestamp) return "–";

  let seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (!Number.isFinite(seconds)) return "–";
  seconds = Math.max(0, seconds);

  const minute = 60;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;
  const month = 30 * day;

  if (seconds < hour) {
    return `${Math.floor(seconds / minute)} Min.`;
  }

  if (seconds < day) {
    const hours = Math.floor(seconds / hour);
    const minutes = Math.floor((seconds % hour) / minute);
    return minutes > 0 ? `${hours} Std. ${minutes} Min.` : `${hours} Std.`;
  }

  if (seconds < week) {
    const days = Math.floor(seconds / day);
    const hours = Math.floor((seconds % day) / hour);
    const label = days === 1 ? "Tag" : "Tage";
    return hours > 0 ? `${days} ${label} ${hours} Std.` : `${days} ${label}`;
  }

  if (seconds < month) {
    const weeks = Math.floor(seconds / week);
    const days = Math.floor((seconds % week) / day);
    const w = weeks === 1 ? "Woche" : "Wochen";
    const d = days === 1 ? "Tag" : "Tage";
    return days > 0 ? `${weeks} ${w} ${days} ${d}` : `${weeks} ${w}`;
  }

  const months = Math.floor(seconds / month);
  const weeks = Math.floor((seconds % month) / week);
  const m = months === 1 ? "Monat" : "Monate";
  const w = weeks === 1 ? "Woche" : "Wochen";
  return weeks > 0 ? `${months} ${m} ${weeks} ${w}` : `${months} ${m}`;
}

function normalizeTimestamp(value) {
  const number = Number(value);

  if (!Number.isFinite(number) || number <= 0) {
    return null;
  }

  return number < 1e12 ? number * 1000 : number;
}

function formatDate(value) {
  const timestamp = normalizeTimestamp(value);

  if (!timestamp) {
    return "–";
  }

  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(timestamp));
}

function formatRelativeTime(value) {
  const timestamp = normalizeTimestamp(value);

  if (!timestamp) {
    return "–";
  }

  const difference = Date.now() - timestamp;

  if (difference < 0) {
    return "gerade eben";
  }

  const seconds = Math.floor(difference / 1000);

  if (seconds < 5) {
    return "gerade eben";
  }

  if (seconds < 60) {
    return `vor ${seconds} Sekunden`;
  }

  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) {
    return `vor ${minutes} Minuten`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `vor ${hours} Stunden`;
  }

  const days = Math.floor(hours / 24);
  return `vor ${days} Tagen`;
}

function setConnectionState(online, message) {
  elements.connectionStatus.textContent = message;
  elements.liveDot.classList.toggle("is-offline", !online);
  elements.liveDot.classList.toggle("is-online", online);
}

function setAddressMessage(message, type = "") {
  elements.addressMessage.textContent = message;
  elements.addressMessage.className = "rzo-message";

  if (type) {
    elements.addressMessage.classList.add(`is-${type}`);
  }
}

function workerStatusLabel(status) {
  switch (status) {
    case "offline":
      return "Offline";
    case "idle":
      return "Idle";
    default:
      return "Online";
  }
}

function workerStatusClass(status) {
  switch (status) {
    case "offline":
      return "is-offline";
    case "idle":
      return "is-idle";
    default:
      return "is-online";
  }
}

function detectMiner(nameValue) {
  const name = String(nameValue || "").toLowerCase();

  if (name.includes("avalonq")) {
    return {
      family: "Avalon Q",
      manufacturer: "Canaan",
      icon: "⚡",
      className: "is-avalon",
    };
  }

  if (name.includes("avalonnano")) {
    return {
      family: "Avalon Nano 3S",
      manufacturer: "Canaan",
      icon: "🔶",
      className: "is-avalon",
    };
  }

  if (name.includes("nerdqaxe") && name.includes("hydro")) {
    return {
      family: "NerdQAxe++ Hydro",
      manufacturer: "Nerdminer",
      icon: "💧",
      className: "is-hydro",
    };
  }

  if (name.includes("nerdqaxe")) {
    return {
      family: "NerdQAxe++",
      manufacturer: "Nerdminer",
      icon: "🟩",
      className: "is-nerdqaxe",
    };
  }

  if (name.includes("bitaxe") && name.includes("gamma")) {
    return {
      family: "Bitaxe Gamma",
      manufacturer: "Bitaxe",
      icon: "🟪",
      className: "is-bitaxe",
    };
  }

  if (name.includes("luckyminer") || name.includes("lv08")) {
    return {
      family: "Lucky Miner LV08 Pro",
      manufacturer: "Lucky Miner",
      icon: "🟦",
      className: "is-lucky",
    };
  }

  if (name.includes("hydro")) {
    return {
      family: "Hydro Miner",
      manufacturer: "Wasserkühlung",
      icon: "💧",
      className: "is-hydro",
    };
  }

  return {
    family: "Bitcoin Miner",
    manufacturer: "RZO Worker",
    icon: "⛏️",
    className: "is-generic",
  };
}

function calculateRejectRate(accepted, rejected) {
  const acceptedNumber = toFiniteNumber(accepted);
  const rejectedNumber = toFiniteNumber(rejected);
  const total = acceptedNumber + rejectedNumber;

  if (total <= 0) {
    return 0;
  }

  return rejectedNumber / total * 100;
}

function createMetric(labelText, valueText, className = "") {
  const item = document.createElement("div");

  if (className) {
    item.className = className;
  }

  const label = document.createElement("span");
  label.textContent = labelText;

  const value = document.createElement("strong");
  value.textContent = valueText;

  item.append(label, value);
  return item;
}

function workerMatchesFilter(worker) {
  const searchTerm = elements.workerSearch.value
    .trim()
    .toLocaleLowerCase("de-DE");

  const nameMatches =
    !searchTerm ||
    String(worker.name || "")
      .toLocaleLowerCase("de-DE")
      .includes(searchTerm);

  const statusMatches =
    activeWorkerFilter === "all" ||
    worker.status === activeWorkerFilter;

  return nameMatches && statusMatches;
}

function renderWorkers() {
  elements.workerList.replaceChildren();

  const detailedWorkers = Array.isArray(latestWorkers)
    ? latestWorkers.filter(
        (worker) => worker.session_active === true,
      )
    : [];

  if (detailedWorkers.length === 0) {
    elements.workerFallback.hidden = false;
    elements.workerNoResults.hidden = true;
    return;
  }

  elements.workerFallback.hidden = true;

  const filteredWorkers = detailedWorkers.filter(workerMatchesFilter);

  elements.workerNoResults.hidden = filteredWorkers.length !== 0;

  for (const worker of filteredWorkers) {
    const article = document.createElement("article");
    article.className = "rzo-worker-card";

    const miner = detectMiner(worker.name);
    article.classList.add(miner.className);

    const workerName = String(worker.name || "Unbenannter Worker");
    const currentAccepted = toFiniteNumber(worker.accepted_shares);
    const previousAccepted = previousWorkerShares.get(workerName);

    if (
      previousAccepted !== undefined &&
      currentAccepted > previousAccepted
    ) {
      article.classList.add("rzo-new-share");

      window.setTimeout(() => {
        article.classList.remove("rzo-new-share");
      }, 2200);
    }

    previousWorkerShares.set(workerName, currentAccepted);

    const header = document.createElement("div");
    header.className = "rzo-worker-header";

    const identity = document.createElement("div");
    identity.className = "rzo-worker-identity";

    const topLine = document.createElement("div");
    topLine.className = "rzo-worker-title-line";

    const icon = document.createElement("span");
    icon.className = "rzo-miner-icon";
    icon.textContent = miner.icon;

    const name = document.createElement("strong");
    name.textContent = workerName;

    topLine.append(icon, name);

    const subtitle = document.createElement("small");
    subtitle.textContent =
      `${miner.family} · ${miner.manufacturer}`;

    identity.append(topLine, subtitle);

    const status = document.createElement("span");
    status.className =
      `rzo-status-badge ${workerStatusClass(worker.status)}`;
    status.textContent = workerStatusLabel(worker.status);

    header.append(identity, status);

    const primaryMetrics = document.createElement("div");
    primaryMetrics.className =
      "rzo-worker-metrics rzo-worker-metrics-primary";

    primaryMetrics.append(
      createMetric(
        "Hashrate 5 Min",
        formatHashrate(worker.hashrate_5m ?? worker.hashrate),
      ),
      createMetric(
        "Best Diff",
        formatDifficulty(worker.best_share),
        "rzo-worker-best",
      ),
      createMetric(
        "Best Diff Rekord",
        formatDifficulty(worker.all_time_best_share),
        "rzo-worker-best",
      ),
      createMetric(
        "Letzter Share",
        formatRelativeTime(worker.last_share),
      ),
      createMetric(
        "Laufzeit",
        worker.session_active
          ? formatSessionRuntime(worker.session_started_at)
          : "–",
      ),
    );

    const secondaryMetrics = document.createElement("div");
    secondaryMetrics.className =
      "rzo-worker-metrics rzo-worker-metrics-secondary";

    secondaryMetrics.append(
      createMetric(
        "1 Minute",
        formatHashrate(worker.hashrate_1m),
      ),
      createMetric(
        "1 Stunde",
        formatHashrate(worker.hashrate_1hr),
      ),
      createMetric(
        "24 Stunden",
        formatHashrate(worker.hashrate_1d),
      ),
      createMetric(
        "Accepted",
        formatNumber(worker.accepted_shares, 0),
      ),
      createMetric(
        "Rejected",
        formatNumber(worker.rejected_shares, 0),
      ),
      createMetric(
        "Reject-Quote",
        formatPercent(
          calculateRejectRate(
            worker.accepted_shares,
            worker.rejected_shares,
          ),
          3,
        ),
      ),
      createMetric(
        "Shares/s 5 Min",
        formatNumber(worker.sps_5m, 4),
      ),
      createMetric(
        "Sessions",
        formatNumber(worker.session_count, 0),
      ),
      createMetric(
        "Rechenarbeit",
        formatHashDays(worker.hash_days),
      ),
    );

    article.append(header, primaryMetrics, secondaryMetrics);
    elements.workerList.append(article);
  }
}

function updateWorkerSummary(workers) {
  const online = workers.filter(
    (worker) => worker.status === "online",
  ).length;

  const idle = workers.filter(
    (worker) => worker.status === "idle",
  ).length;

  const offline = workers.filter(
    (worker) => worker.status === "offline",
  ).length;

  elements.workerSummary.textContent =
    `${workers.length} Worker`;

  elements.workerStatusSummary.textContent =
    `${online} online · ${idle} idle · ${offline} offline`;
}

function historyStorageKey() {
  return `rzo-hashrate-history:${activeAddress}`;
}

function loadHashrateHistory() {
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(historyStorageKey()) || "[]",
    );

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map(Number)
      .filter(Number.isFinite)
      .slice(-HASHRATE_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

function saveHashrateHistory() {
  try {
    window.localStorage.setItem(
      historyStorageKey(),
      JSON.stringify(hashrateHistory),
    );
  } catch {
    // LocalStorage ist optional.
  }
}

function updateSparkline(value) {
  const hashrate = Number(value);

  if (!Number.isFinite(hashrate) || hashrate < 0) {
    return;
  }

  hashrateHistory.push(hashrate);
  hashrateHistory = hashrateHistory.slice(-HASHRATE_HISTORY_LIMIT);
  saveHashrateHistory();

  if (hashrateHistory.length < 2) {
    elements.userSparklineLine.setAttribute("points", "");
    elements.hashrateTrend.textContent =
      "Verlauf wird aufgebaut";
    return;
  }

  const width = 400;
  const height = 80;
  const padding = 5;

  const minimum = Math.min(...hashrateHistory);
  const maximum = Math.max(...hashrateHistory);
  const range = maximum - minimum || 1;

  const points = hashrateHistory.map((item, index) => {
    const x =
      index / Math.max(hashrateHistory.length - 1, 1) * width;

    const y =
      height -
      padding -
      ((item - minimum) / range) * (height - padding * 2);

    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  elements.userSparklineLine.setAttribute(
    "points",
    points.join(" "),
  );

  const first = hashrateHistory[0];
  const last = hashrateHistory.at(-1);
  const trend = first > 0 ? (last - first) / first * 100 : 0;

  elements.hashrateTrend.textContent =
    `${trend >= 0 ? "▲" : "▼"} ${formatPercent(
      Math.abs(trend),
      2,
    )} im lokalen Verlauf`;

  elements.hashrateTrend.classList.toggle(
    "is-positive",
    trend > 0.1,
  );

  elements.hashrateTrend.classList.toggle(
    "is-negative",
    trend < -0.1,
  );
}

function updateBestDiffProgress(bestShare) {
  const best = toFiniteNumber(bestShare);
  const network = toFiniteNumber(latestNetworkDifficulty);

  if (network <= 0) {
    elements.bestDiffPercentage.textContent =
      "Netzwerk-Difficulty nicht verfügbar";
    elements.bestDiffProgress.style.width = "0%";
    return;
  }

  const percentage = best / network * 100;
  const visualPercentage = Math.min(Math.max(percentage, 0), 100);

  elements.bestDiffPercentage.textContent =
    `${formatPercent(percentage, 8)} der Netzwerk-Difficulty`;

  elements.bestDiffProgress.style.width =
    `${visualPercentage}%`;
}

function renderDashboard(data) {
  elements.dashboard.hidden = false;

  const workerCount = toFiniteNumber(data.worker_count);
  const totalHashrate = toFiniteNumber(data.hashrate);
  const accepted = toFiniteNumber(data.accepted_shares);
  const rejected = toFiniteNumber(data.rejected_shares);

  elements.addressDisplay.textContent =
    data.address || activeAddress;

  elements.hashrate.textContent = formatHashrate(totalHashrate);
  elements.workers.textContent = formatNumber(workerCount, 0);
  elements.sessions.textContent =
    formatNumber(data.session_count, 0);

  elements.bestShare.textContent =
    formatDifficulty(data.all_time_best_share ?? data.best_share);

  elements.lastShare.textContent =
    formatRelativeTime(data.last_share);

  elements.lastShareDate.textContent =
    formatDate(data.last_share);

  elements.hashDays.textContent =
    formatHashDays(data.received_hash_days);

  elements.acceptedShares.textContent =
    formatNumber(accepted, 0);

  elements.rejectedShares.textContent =
    formatNumber(rejected, 0);

  elements.rejectRate.textContent =
    `Reject-Quote: ${formatPercent(
      calculateRejectRate(accepted, rejected),
      4,
    )}`;

  elements.averageWorkerHashrate.textContent =
    workerCount > 0
      ? formatHashrate(totalHashrate / workerCount)
      : "–";

  latestWorkers = Array.isArray(data.workers)
    ? [...data.workers].sort(
        (left, right) =>
          toFiniteNumber(right.best_share) -
          toFiniteNumber(left.best_share),
      )
    : [];

  updateWorkerSummary(latestWorkers);
  renderWorkers();
  updateSparkline(totalHashrate);
  updateBestDiffProgress(data.all_time_best_share ?? data.best_share);

  elements.updatedAt.textContent =
    `Aktualisiert: ${new Intl.DateTimeFormat("de-DE", {
      timeStyle: "medium",
    }).format(new Date())}`;

  setConnectionState(true, "RZO Pool online");
}

async function fetchJson(url) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data.message || `HTTP-Fehler ${response.status}`,
    );
  }

  return data;
}

async function loadPublicStatus() {
  const results = await Promise.allSettled([
    fetchJson("/api/bitcoin/status"),
    fetchJson("/api/pool/status"),
    fetchJson("/api/system/status"),
  ]);

  const [bitcoinResult, poolResult, systemResult] = results;

  if (bitcoinResult.status === "fulfilled") {
    const bitcoin = bitcoinResult.value;

    latestNetworkDifficulty =
      toFiniteNumber(bitcoin.network_difficulty);

    elements.bitcoinHeight.textContent =
      formatNumber(bitcoin.height, 0);

    elements.networkDifficulty.textContent =
      formatDifficulty(bitcoin.network_difficulty);

    elements.networkHashrate.textContent =
      formatHashrate(bitcoin.network_hashrate);

    elements.mempoolTransactions.textContent =
      formatNumber(bitcoin.mempool_txs, 0);
  }

  if (poolResult.status === "fulfilled") {
    const pool = poolResult.value;
    const downstream = pool?.downstream || {};
    const stats = downstream.stats || {};
    const blockCount = toFiniteNumber(pool.block_count);

    elements.poolUptime.textContent =
      formatDuration(pool.uptime_secs);

    const apiPoolBest =
      toFiniteNumber(downstream?.totals?.best_share) ||
      toFiniteNumber(downstream?.best_share) ||
      toFiniteNumber(stats.best_share) ||
      0;

    const historicPoolBest =
      toFiniteNumber(
        localStorage.getItem("rzo-pool-best-diff")
      ) || 0;

    elements.poolBestDiff.textContent =
      formatDifficulty(
        Math.max(apiPoolBest, historicPoolBest)
      );

    elements.poolBlockCount.textContent =
      `${formatNumber(blockCount, 0)} ${
        blockCount === 1 ? "Block" : "Blöcke"
      }`;
  }

  if (systemResult.status === "fulfilled") {
    const system = systemResult.value;

    elements.systemUptime.textContent =
      formatDuration(system.uptime);

    elements.systemCpu.textContent =
      formatPercent(system.cpu_usage_percent, 2);

    elements.systemMemory.textContent =
      formatPercent(system.memory_usage_percent, 2);

    elements.systemDisk.textContent =
      formatPercent(system.disk_usage_percent, 2);
  }
}

async function loadAddress(address, showLoading = true) {
  activeAddress = address.trim();

  if (!activeAddress) {
    setAddressMessage(
      "Bitte eine Bitcoin-Adresse eingeben.",
      "error",
    );
    return;
  }

  if (showLoading) {
    setAddressMessage("Minerdaten werden geladen …");
    elements.addressButton.disabled = true;
    setConnectionState(false, "Verbindung wird hergestellt");

    hashrateHistory = loadHashrateHistory();
  }

  try {
    const [data] = await Promise.all([
      fetchJson(
        `/api/my-miners?address=${encodeURIComponent(
          activeAddress,
        )}`,
      ),
      loadPublicStatus(),
    ]);

    setAddressMessage("");
    renderDashboard(data);

    const url = new URL(window.location.href);
    url.searchParams.set("address", activeAddress);
    window.history.replaceState({}, "", url);
  } catch (error) {
    setConnectionState(false, "Keine Minerdaten verfügbar");

    if (showLoading) {
      elements.dashboard.hidden = true;
      setAddressMessage(
        error instanceof Error
          ? error.message
          : "Die Minerdaten konnten nicht geladen werden.",
        "error",
      );
    }
  } finally {
    elements.addressButton.disabled = false;
  }
}

function startRefresh() {
  if (refreshTimer) {
    window.clearInterval(refreshTimer);
  }

  refreshTimer = window.setInterval(() => {
    if (activeAddress) {
      loadAddress(activeAddress, false);
    }
  }, REFRESH_INTERVAL);
}

function openAddress() {
  const address = elements.addressInput.value.trim();

  previousWorkerShares = new Map();
  hashrateHistory = [];

  loadAddress(address, true);
  startRefresh();
}

async function copyAddress() {
  const address =
    elements.addressDisplay.textContent.trim() || activeAddress;

  if (!address || address === "–") {
    return;
  }

  try {
    await navigator.clipboard.writeText(address);
    elements.copyAddressButton.textContent = "Kopiert ✓";

    window.setTimeout(() => {
      elements.copyAddressButton.textContent =
        "Adresse kopieren";
    }, 1800);
  } catch {
    elements.copyAddressButton.textContent =
      "Kopieren nicht möglich";
  }
}

elements.addressButton.addEventListener("click", openAddress);

elements.copyAddressButton.addEventListener(
  "click",
  copyAddress,
);

elements.addressInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    openAddress();
  }
});

elements.workerSearch.addEventListener("input", renderWorkers);

elements.workerFilters.addEventListener("click", (event) => {
  const button = event.target.closest("[data-worker-filter]");

  if (!button) {
    return;
  }

  activeWorkerFilter =
    button.dataset.workerFilter || "all";

  for (const candidate of elements.workerFilters.querySelectorAll(
    "[data-worker-filter]",
  )) {
    candidate.classList.toggle(
      "is-active",
      candidate === button,
    );
  }

  renderWorkers();
});

const initialAddress =
  new URLSearchParams(window.location.search).get("address") || "";

if (initialAddress) {
  elements.addressInput.value = initialAddress;
  loadAddress(initialAddress, true);
  startRefresh();
} else {
  setConnectionState(false, "Bitcoin-Adresse eingeben");
  loadPublicStatus().catch(() => {});
}
