/*
    War Target Finder - User Interface Components
    
    Copyright (C) 2025 moregh (https://github.com/moregh/)
    Licensed under AGPL License.
*/

import {
    TIMER_UPDATE_INTERVAL_MS,
    TIMER_UPDATE_THROTTLE_MS,
    LOADING_DISPLAY_DELAY_MS,
    LOADING_HIDE_DELAY_MS,
    PROGRESS_UPDATE_THROTTLE_MS,
    VERSION
} from './config.js';
import { getCacheRecordCount } from './database.js';
import { getCounters } from './esi-api.js';

// UI state variables
let timerInterval = null;
let startTime = 0;
let queryStartTime = 0;
let queryEndTime = 0;

// Cache DOM elements to avoid repeated queries
let statsElements = null;
let progressElements = null;
let lastProgressUpdate = 0;
let lastTimerUpdate = 0;

export function collapseInputSection() {
    const inputSection = document.getElementById('input-section');
    inputSection.classList.add('collapsed');
}

export function expandInputSection() {
    const inputSection = document.getElementById('input-section');
    inputSection.classList.remove('collapsed');
}

function getProgressElements() {
    if (!progressElements) {
        progressElements = {
            bar: document.getElementById('progressBar'),
            text: document.getElementById('progressText')
        };
    }
    return progressElements;
}

export function updateProgress(current, total, stage = null) {
    // Throttle progress updates to every 50ms
    const now = Date.now();
    if (now - lastProgressUpdate < PROGRESS_UPDATE_THROTTLE_MS && current < total) return;

    const elements = getProgressElements();
    const p = total > 0 ? (current / total) * 100 : 0;

    if (elements.bar) elements.bar.style.width = p + '%';

    if (elements.text) {
        if (stage) {
            elements.text.textContent = `${stage} (${current} / ${total})`;
        } else {
            elements.text.textContent = `Processed: ${current} / ${total}`;
        }
    }

    lastProgressUpdate = now;
}

function updateTimer() {
    const now = Date.now();
    if (now - lastTimerUpdate < TIMER_UPDATE_THROTTLE_MS) return;

    const elapsed = ((now - startTime) / 1000).toFixed(1);
    document.getElementById("timer").textContent = `Elapsed: ${elapsed}s`;
    lastTimerUpdate = now;
}

export function updateTitle(count, total) {
    document.title = `${count}/${total} targets - War Target Finder`;
}

export function startLoading() {
    const lc = document.getElementById("loading-container");
    const rs = document.getElementById("results-section");
    const cb = document.getElementById("checkButton");
    const ec = document.getElementById("error-container");

    // Collapse input section and disable hover during loading
    const inputSection = document.getElementById('input-section');
    collapseInputSection();
    inputSection.classList.add('loading');

    lc.style.display = 'block';
    lc.offsetHeight; // Force reflow
    lc.classList.add("show");
    rs.classList.remove("show");
    cb.disabled = true;
    ec.innerHTML = "";

    document.getElementById('progressBar').style.width = '0%';
    document.getElementById('progressText').textContent = 'Processed: 0 / 0';

    queryStartTime = performance.now();

    startTime = Date.now();
    timerInterval = setInterval(updateTimer, TIMER_UPDATE_INTERVAL_MS);
}

export function stopLoading() {
    const lc = document.getElementById("loading-container");
    const rs = document.getElementById("results-section");
    const cb = document.getElementById("checkButton");

    queryEndTime = performance.now();

    lc.classList.remove("show");
    cb.disabled = false;

    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }

    setTimeout(() => {
        rs.classList.add("show");
        // Re-enable hover behavior after loading is complete
        const inputSection = document.getElementById('input-section');
        inputSection.classList.remove('loading');

        setTimeout(() => {
            lc.style.display = 'none';
        }, LOADING_HIDE_DELAY_MS);
    }, LOADING_DISPLAY_DELAY_MS);
}

export function showInformation(message) {
    document.getElementById("error-container").innerHTML = `
        <div class="info-message glass-card">
        <div class="information-icon">
        <div class="info-icon">✅</div>
        <div class="info-content">
            <div class="info-title">Info</div>
            <div class="info-text">${message}</div>
        </div>
        </div>
    `;
}

export function showWarning(message) {
    document.getElementById("error-container").innerHTML = `
        <div class="warning-message glass-card">
        <div class="warning-icon">⚠️</div>
        <div class="warning-content">
            <div class="warning-title">Warning</div>
            <div class="warning-text">${message}</div>
        </div>
        </div>
    `;
}

export function showError(message) {
    document.getElementById("error-container").innerHTML = `
    <div class="error-message glass-card">
      <div class="error-icon">⚠️</div>
      <div class="error-content">
        <div class="error-title">Error</div>
        <div class="error-text">${message}</div>
      </div>
    </div>
  `;
}

export function clearErrorMessage() {
    document.getElementById("error-container").innerHTML = "";
}

function getStatsElements() {
    if (!statsElements) {
        statsElements = {
            allianceCount: document.getElementById("alliance-count"),
            corporationCount: document.getElementById("corporation-count"),
            totalCount: document.getElementById("total-count"),
            allianceTotal: document.getElementById("alliance-total"),
            corporationTotal: document.getElementById("corporation-total")
        };
    }
    return statsElements;
}

export function updateStats(allResults) {
    const elements = getStatsElements();

    // Count unique alliances and corporations
    const uniqueAlliances = new Set();
    const uniqueCorporations = new Set();

    allResults.forEach(character => {
        if (character.alliance_id) {
            uniqueAlliances.add(character.alliance_id);
        }
        if (character.corporation_id) {
            uniqueCorporations.add(character.corporation_id);
        }
    });

    const allianceCount = uniqueAlliances.size;
    const corporationCount = uniqueCorporations.size;
    const totalLen = allResults.length;

    if (elements.allianceCount) elements.allianceCount.textContent = allianceCount;
    if (elements.corporationCount) elements.corporationCount.textContent = corporationCount;
    if (elements.totalCount) elements.totalCount.textContent = totalLen;
    if (elements.allianceTotal) elements.allianceTotal.textContent = allianceCount;
    if (elements.corporationTotal) elements.corporationTotal.textContent = corporationCount;
    updateTitle(totalLen, totalLen);
}

export async function updatePerformanceStats() {
    const { esiLookups, localLookups } = getCounters();
    const queryTime = Math.round(queryEndTime - queryStartTime);
    const recordCount = await getCacheRecordCount();

    document.getElementById("query-time").textContent = queryTime;
    document.getElementById("esi-lookups").textContent = esiLookups;
    document.getElementById("cache-info").textContent = localLookups;

    // Update the cache size element to show record count
    const cacheSizeElement = document.getElementById("cache-size");
    if (cacheSizeElement) {
        if (recordCount === 1) {
            cacheSizeElement.textContent = `1 entry`;
        } else {
            cacheSizeElement.textContent = `${recordCount.toLocaleString()} entries`;
        }
    }
}

export function updateVersionDisplay() {
    const versionElement = document.getElementById('version-display');
    if (versionElement) {
        versionElement.textContent = `v${VERSION}`;
    }
}