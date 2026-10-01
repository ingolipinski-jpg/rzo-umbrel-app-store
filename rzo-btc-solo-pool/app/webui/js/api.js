"use strict";

const API_BASE = "/api";
const REFRESH_INTERVAL = 5000;
const MAX_HISTORY_POINTS = 60;

const hashrateHistory = [];
let lastSuccessfulUpdate = 0;

async function fetchJson(path) {
    const response = await fetch(`${API_BASE}${path}`, {
        cache: "no-store",
        headers: {
            Accept: "application/json"
        }
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return response.json();
}

function getElement(id) {
    return document.getElementById(id);
}

function setValue(id, value, animate = true) {
    const element = getElement(id);

    if (!element) {
        return;
    }

    const newValue = value ?? "-";

    if (element.textContent === String(newValue)) {
        return;
    }

    element.textContent = newValue;

    if (animate) {
        element.classList.remove("rzo-value-updated");

        void element.offsetWidth;

        element.classList.add("rzo-value-updated");
    }
}

function formatDifficulty(value) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
        return "-";
    }

    const absolute = Math.abs(number);

    const units = [
        [1e18, "E"],
        [1e15, "P"],
        [1e12, "T"],
        [1e9, "G"],
        [1e6, "M"],
        [1e3, "K"]
    ];

    for (const [divisor, suffix] of units) {
        if (absolute >= divisor) {
            return `${(number / divisor).toLocaleString("de-DE", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            })} ${suffix}`;
        }
    }

    return number.toLocaleString("de-DE", {
        maximumFractionDigits: 2
    });
}

function formatHashrate(value) {
    const number = Number(value);

    if (!Number.isFinite(number) || number < 0) {
        return "-";
    }

    const units = [
        [1e18, "EH/s"],
        [1e15, "PH/s"],
        [1e12, "TH/s"],
        [1e9, "GH/s"],
        [1e6, "MH/s"],
        [1e3, "kH/s"],
        [1, "H/s"]
    ];

    for (const [divisor, suffix] of units) {
        if (number >= divisor) {
            return `${(number / divisor).toLocaleString("de-DE", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            })} ${suffix}`;
        }
    }

    return "0 H/s";
}

function formatNumber(value, maximumFractionDigits = 0) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
        return "-";
    }

    return new Intl.NumberFormat("de-DE", {
        maximumFractionDigits
    }).format(number);
}

function formatPercent(value) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
        return "-";
    }

    return `${number.toLocaleString("de-DE", {
        minimumFractionDigits: 3,
        maximumFractionDigits: 3
    })} %`;
}

function formatDuration(seconds) {
    const value = Math.max(0, Number(seconds) || 0);

    const days = Math.floor(value / 86400);
    const hours = Math.floor((value % 86400) / 3600);
    const minutes = Math.floor((value % 3600) / 60);

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

function formatTimestamp(unixTime) {
    const value = Number(unixTime);

    if (!Number.isFinite(value) || value <= 0) {
        return "-";
    }

    return new Date(value * 1000).toLocaleString("de-DE");
}

function shortHash(value) {
    if (!value) {
        return "-";
    }

    const text = String(value);

    if (text.length <= 20) {
        return text;
    }

    return `${text.slice(0, 10)}…${text.slice(-8)}`;
}

function setPoolStatus(state, message) {
    const dot = getElement("pool-status-dot");
    const text = getElement("pool-status-text");

    if (!dot || !text) {
        return;
    }

    dot.classList.remove(
        "is-online",
        "is-warning",
        "is-offline",
        "is-loading"
    );

    dot.classList.add(`is-${state}`);
    text.textContent = message;
}

function addHashrateHistory(value) {
    const number = Number(value);

    if (!Number.isFinite(number) || number < 0) {
        return;
    }

    hashrateHistory.push(number);

    while (hashrateHistory.length > MAX_HISTORY_POINTS) {
        hashrateHistory.shift();
    }

    drawHashrateSparkline();
    updateHashrateTrend();
}

function drawHashrateSparkline() {
    const canvas = getElement("hashrate-sparkline");

    if (!canvas) {
        return;
    }

    const context = canvas.getContext("2d");

    if (!context) {
        return;
    }

    const rect = canvas.getBoundingClientRect();
    const devicePixelRatio = window.devicePixelRatio || 1;

    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));

    if (
        canvas.width !== Math.round(width * devicePixelRatio) ||
        canvas.height !== Math.round(height * devicePixelRatio)
    ) {
        canvas.width = Math.round(width * devicePixelRatio);
        canvas.height = Math.round(height * devicePixelRatio);
    }

    context.setTransform(
        devicePixelRatio,
        0,
        0,
        devicePixelRatio,
        0,
        0
    );

    context.clearRect(0, 0, width, height);

    if (hashrateHistory.length < 2) {
        return;
    }

    const minimum = Math.min(...hashrateHistory);
    const maximum = Math.max(...hashrateHistory);
    const range = maximum - minimum || Math.max(maximum * 0.05, 1);

    const paddingTop = 12;
    const paddingBottom = 10;
    const usableHeight = height - paddingTop - paddingBottom;

    const points = hashrateHistory.map((value, index) => {
        const x =
            hashrateHistory.length === 1
                ? 0
                : index / (hashrateHistory.length - 1) * width;

        const normalized = (value - minimum) / range;
        const y = height - paddingBottom - normalized * usableHeight;

        return { x, y };
    });

    const gradient = context.createLinearGradient(0, 0, width, 0);
    gradient.addColorStop(0, "rgba(247, 147, 26, 0.55)");
    gradient.addColorStop(1, "rgba(255, 183, 77, 1)");

    context.beginPath();
    context.moveTo(points[0].x, points[0].y);

    for (let index = 1; index < points.length; index += 1) {
        context.lineTo(points[index].x, points[index].y);
    }

    context.strokeStyle = gradient;
    context.lineWidth = 3;
    context.lineJoin = "round";
    context.lineCap = "round";
    context.stroke();

    const fillGradient = context.createLinearGradient(0, 0, 0, height);
    fillGradient.addColorStop(0, "rgba(247, 147, 26, 0.24)");
    fillGradient.addColorStop(1, "rgba(247, 147, 26, 0)");

    context.lineTo(width, height);
    context.lineTo(0, height);
    context.closePath();
    context.fillStyle = fillGradient;
    context.fill();

    const lastPoint = points[points.length - 1];

    context.beginPath();
    context.arc(lastPoint.x, lastPoint.y, 4, 0, Math.PI * 2);
    context.fillStyle = "#f7931a";
    context.fill();
}

function updateHashrateTrend() {
    const element = getElement("hashrate-trend");

    if (!element) {
        return;
    }

    element.classList.remove(
        "is-positive",
        "is-negative",
        "is-neutral"
    );

    if (hashrateHistory.length < 2) {
        element.textContent = "Verlauf wird aufgebaut";
        element.classList.add("is-neutral");
        return;
    }

    const current = hashrateHistory[hashrateHistory.length - 1];
    const previous = hashrateHistory[hashrateHistory.length - 2];

    if (previous <= 0) {
        element.textContent = "Live-Verlauf";
        element.classList.add("is-neutral");
        return;
    }

    const change = (current - previous) / previous * 100;

    if (Math.abs(change) < 0.05) {
        element.textContent = "→ stabil";
        element.classList.add("is-neutral");
        return;
    }

    const formattedChange = Math.abs(change).toLocaleString("de-DE", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1
    });

    if (change > 0) {
        element.textContent = `▲ ${formattedChange} %`;
        element.classList.add("is-positive");
    } else {
        element.textContent = `▼ ${formattedChange} %`;
        element.classList.add("is-negative");
    }
}

async function refreshDashboard() {
    try {
        setPoolStatus("warning", "Pool wird aktualisiert");

        const pool = await fetchJson("/pool/status");

        const downstream = pool.downstream ?? {};
        const nestedStats = downstream.stats ?? {};

        const stats = {
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

        const accepted = Number(stats.accepted_shares) || 0;
        const rejected = Number(stats.rejected_shares) || 0;
        const totalShares = accepted + rejected;

        const rejectRate =
            totalShares > 0
                ? rejected / totalShares * 100
                : 0;

        setValue("hashrate", formatHashrate(stats.hashrate_1m));
        setValue("hashrate-5m", formatHashrate(stats.hashrate_5m));
        setValue("hashrate-15m", formatHashrate(stats.hashrate_15m));
        setValue("hashrate-1h", formatHashrate(stats.hashrate_1hr));
        setValue("hashrate-1d", formatHashrate(stats.hashrate_1d));

        let liveCounts = null;

        try {
            liveCounts = await fetchJson("/pool/live-counts");
        } catch (_) {
            liveCounts = null;
        }

        const activeUsers = Number(
            liveCounts?.active_users ??
            downstream.users ??
            downstream.user_count ??
            0
        );

        const activeSessions = Number(
            liveCounts?.active_sessions ??
            downstream.session_count ??
            downstream.sessions ??
            0
        );

        const activeWorkers = Number(
            liveCounts?.active_workers ??
            activeSessions
        );

        setValue("users", formatNumber(activeUsers));
        setValue("workers", formatNumber(activeWorkers));
        setValue("sessions", formatNumber(activeSessions));
        setValue("idle", formatNumber((downstream.idle ?? downstream.idle_count)));

        setValue("accepted-shares", formatNumber(accepted));
        setValue("rejected-shares", formatNumber(rejected));
        setValue("reject-rate", formatPercent(rejectRate));
        setValue("sps", formatNumber(stats.sps_1m, 3));

        setValue("blocks", formatNumber(pool.block_count));
        setValue("best-share", formatDifficulty(stats.best_share));
        setValue("last-share", formatTimestamp(stats.last_share));
        setValue("uptime", formatDuration(pool.uptime_secs));

        setValue("sessions-detail", formatNumber((downstream.sessions ?? downstream.session_count)));
        setValue(
            "disconnected",
            formatNumber((downstream.disconnected ?? downstream.disconnected_count))
        );
        setValue("idle-detail", formatNumber((downstream.idle ?? downstream.idle_count)));
        setValue("last-block-hash", shortHash(pool.last_block_hash));

        addHashrateHistory(stats.hashrate_1m);

        lastSuccessfulUpdate = Date.now();

        setPoolStatus("online", "Pool online");

        setValue(
            "last-updated",
            `Aktualisiert: ${new Date().toLocaleTimeString("de-DE")}`,
            false
        );
    } catch (error) {
        console.error("RZO-API-Fehler:", error);

        const secondsSinceSuccess =
            lastSuccessfulUpdate > 0
                ? Math.floor((Date.now() - lastSuccessfulUpdate) / 1000)
                : null;

        if (
            secondsSinceSuccess !== null &&
            secondsSinceSuccess < 30
        ) {
            setPoolStatus("warning", "Pooldaten verzögert");
        } else {
            setPoolStatus("offline", "Pool nicht erreichbar");
        }

        setValue(
            "last-updated",
            `API-Fehler: ${error.message}`,
            false
        );
    }
}

document.addEventListener("DOMContentLoaded", () => {
    setPoolStatus("loading", "Pool wird geprüft");
    refreshDashboard();

    window.setInterval(refreshDashboard, REFRESH_INTERVAL);
    window.addEventListener("resize", drawHashrateSparkline);
});
