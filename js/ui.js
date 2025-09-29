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
let uiElements = null;
let loadingElements = null;
let lastProgressUpdate = 0;
let lastTimerUpdate = 0;

// Comprehensive element caching
function getUIElements() {
    if (!uiElements) {
        uiElements = {
            timer: document.getElementById("timer"),
            headerStats: document.getElementById('header-stats'),
            inputSection: document.getElementById('input-section'),
            errorContainer: document.getElementById('error-container'),
            versionDisplay: document.getElementById('version-display')
        };
    }
    return uiElements;
}

function getLoadingElements() {
    if (!loadingElements) {
        loadingElements = {
            container: document.getElementById("loading-container"),
            resultsSection: document.getElementById("results-section"),
            checkButton: document.getElementById("checkButton")
        };
    }
    return loadingElements;
}

export function collapseInputSection() {
    const elements = getUIElements();
    elements.inputSection?.classList.add('collapsed');
}

export function expandInputSection() {
    const elements = getUIElements();
    elements.inputSection?.classList.remove('collapsed');
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
    const elements = getUIElements();
    if (elements.timer) {
        elements.timer.textContent = `Elapsed: ${elapsed}s`;
    }
    lastTimerUpdate = now;
}

export function updateTitle(count, total) {
    document.title = `${count}/${total} targets - War Target Finder`;
}

export function startLoading() {
    const loadingElements = getLoadingElements();
    const uiElements = getUIElements();
    const progressElements = getProgressElements();

    // Batch DOM updates using requestAnimationFrame
    requestAnimationFrame(() => {
        // Collapse input section and disable hover during loading
        collapseInputSection();
        if (uiElements.inputSection) {
            uiElements.inputSection.classList.add('loading');
        }

        // Update loading UI elements
        if (loadingElements.container) {
            loadingElements.container.style.display = 'block';
            loadingElements.container.offsetHeight; // Force reflow
            loadingElements.container.classList.add("show");
        }

        if (loadingElements.resultsSection) {
            loadingElements.resultsSection.classList.remove("show");
        }

        if (loadingElements.checkButton) {
            loadingElements.checkButton.disabled = true;
        }

        if (uiElements.errorContainer) {
            uiElements.errorContainer.innerHTML = "";
        }

        // Reset progress indicators
        if (progressElements.bar) {
            progressElements.bar.style.width = '0%';
        }
        if (progressElements.text) {
            progressElements.text.textContent = 'Processed: 0 / 0';
        }
    });

    queryStartTime = performance.now();
    startTime = Date.now();
    timerInterval = setInterval(updateTimer, TIMER_UPDATE_INTERVAL_MS);
}

export function stopLoading() {
    const loadingElements = getLoadingElements();
    const uiElements = getUIElements();

    queryEndTime = performance.now();

    // Immediate updates
    if (loadingElements.container) {
        loadingElements.container.classList.remove("show");
    }
    if (loadingElements.checkButton) {
        loadingElements.checkButton.disabled = false;
    }

    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }

    // Batch delayed updates
    setTimeout(() => {
        requestAnimationFrame(() => {
            if (loadingElements.resultsSection) {
                loadingElements.resultsSection.classList.add("show");
            }

            // Show header stats after first query
            if (uiElements.headerStats) {
                uiElements.headerStats.style.display = 'flex';
            }

            // Re-enable hover behavior after loading is complete
            if (uiElements.inputSection) {
                uiElements.inputSection.classList.remove('loading');
            }
        });

        setTimeout(() => {
            if (loadingElements.container) {
                loadingElements.container.style.display = 'none';
            }
        }, LOADING_HIDE_DELAY_MS);
    }, LOADING_DISPLAY_DELAY_MS);
}

export function showInformation(message) {
    const elements = getUIElements();
    if (elements.errorContainer) {
        elements.errorContainer.innerHTML = `
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
}

export function showWarning(message) {
    const elements = getUIElements();
    if (elements.errorContainer) {
        elements.errorContainer.innerHTML = `
            <div class="warning-message glass-card">
            <div class="warning-icon">⚠️</div>
            <div class="warning-content">
                <div class="warning-title">Warning</div>
                <div class="warning-text">${message}</div>
            </div>
            </div>
        `;
    }
}

export function showError(message) {
    const elements = getUIElements();
    if (elements.errorContainer) {
        elements.errorContainer.innerHTML = `
        <div class="error-message glass-card">
          <div class="error-icon">⚠️</div>
          <div class="error-content">
            <div class="error-title">Error</div>
            <div class="error-text">${message}</div>
          </div>
        </div>
      `;
    }
}

export function clearErrorMessage() {
    const elements = getUIElements();
    if (elements.errorContainer) {
        elements.errorContainer.innerHTML = "";
    }
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

    // Cache performance stat elements
    if (!uiElements) getUIElements();
    const performanceElements = {
        queryTime: document.getElementById("query-time"),
        esiLookups: document.getElementById("esi-lookups"),
        cacheInfo: document.getElementById("cache-info"),
        cacheSize: document.getElementById("cache-size")
    };

    // Batch DOM updates
    requestAnimationFrame(() => {
        if (performanceElements.queryTime) {
            performanceElements.queryTime.textContent = queryTime;
        }
        if (performanceElements.esiLookups) {
            performanceElements.esiLookups.textContent = esiLookups;
        }
        if (performanceElements.cacheInfo) {
            performanceElements.cacheInfo.textContent = localLookups;
        }

        // Update the cache size element to show record count
        if (performanceElements.cacheSize) {
            if (recordCount === 1) {
                performanceElements.cacheSize.textContent = `1 entry`;
            } else {
                performanceElements.cacheSize.textContent = `${recordCount.toLocaleString()} entries`;
            }
        }
    });
}

export function updateVersionDisplay() {
    const elements = getUIElements();
    if (elements.versionDisplay) {
        elements.versionDisplay.textContent = `v${VERSION}`;
    }
}