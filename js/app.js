/*
    War Target Finder - Main Application Logic
    
    Copyright (C) 2025 moregh (https://github.com/moregh/)
    Licensed under AGPL License.
*/

import {
    INITIAL_USER_RESULTS_COUNT,
    INITIAL_CORP_ALLIANCE_COUNT,
    LOAD_MORE_COUNT,
    STATS_UPDATE_DELAY,
    CHARACTER_COUNT_DEBOUNCE_MS,
    USER_NOTIFICATION_DISPLAY_MS
} from './config.js';
import { initDB, clearExpiredCache } from './database.js';
import { showCharacterStats, showCorporationStats, showAllianceStats } from './zkill-card.js';
import { clientValidate } from './validation.js';
import { validator, resetCounters } from './esi-api.js';
import {
    startLoading,
    stopLoading,
    showError,
    updateStats,
    updatePerformanceStats,
    updateVersionDisplay,
    collapseInputSection,
    expandInputSection
} from './ui.js';
import {
    renderGrid,
    buildEntityMaps,
    getObserverManager,
    addScrollStateDetection,
    setupVirtualScrolling
} from './rendering.js';
import { getZkillCardInstance } from './zkill-card.js'

// Application state
let currentView = 'grid';
let allResults = { eligible: [], ineligible: [] };
let displayedResults = { eligible: 0, ineligible: 0 };
let expandedSections = { eligible: false, ineligible: false };

// Summary data and display tracking
let allSummaryData = { alliance: [], corporation: [] };
let displayedSummaryResults = { alliance: 0, corporation: 0 };
let expandedSummarySections = { alliance: false, corporation: false };

// Store complete results
let completeResults = [];

// Make currentView available to rendering module
window.currentView = currentView;

function setupCollapsedIndicatorClick() {
    const inputSection = document.getElementById('input-section');
    const collapsedIndicator = inputSection.querySelector('.collapsed-indicator');

    // The click is already handled by event delegation, just add hover behavior
    let hoverTimeout;

    inputSection.addEventListener('mouseenter', () => {
        if (inputSection.classList.contains('collapsed')) {
            clearTimeout(hoverTimeout);
            hoverTimeout = setTimeout(() => {
                if (inputSection.classList.contains('collapsed')) {
                    inputSection.style.maxHeight = 'none';
                }
            }, 200);
        }
    });

    inputSection.addEventListener('mouseleave', () => {
        clearTimeout(hoverTimeout);
        if (inputSection.classList.contains('collapsed') && !inputSection.matches(':hover')) {
            inputSection.style.maxHeight = '';
        }
    });
}

// Event delegation handler
document.addEventListener('click', function (event) {
    // Check for zkill stats clicks FIRST (before checking for data-action)
    const clickableElement = event.target.closest('[data-clickable]');
    if (clickableElement) {
        handleZkillStatsClick(clickableElement);
        return;
    }

    // Existing logic for data-action elements
    const target = event.target.closest('[data-action]');
    if (!target) return;

    const action = target.dataset.action;
    const type = target.dataset.type;
    const viewType = target.dataset.viewType;

    switch (action) {
        case 'toggle-view':
            toggleView(viewType);
            break;
        case 'toggle-expanded':
            toggleExpanded(type);
            break;
        case 'load-more':
            loadMoreResults(type);
            break;
        case 'toggle-summary-expanded':
            toggleSummaryExpanded(type);
            break;
        case 'load-more-summary':
            loadMoreSummary(type);
            break;
        case 'reload-page':
            event.preventDefault();
            window.location.reload(true);
            document.querySelectorAll('form').forEach(form => form.reset());
            break;
        case 'expand-input':
            expandInputSection();
            setTimeout(() => {
                document.getElementById('names').focus();
            }, STATS_UPDATE_DELAY);
            break;
    }
});

function summarizeEntities(results) {
    const corpCounts = new Map();
    const allianceCounts = new Map();

    results.forEach(result => {
        if (result.war_eligible) {
            if (result.corporation_id) {
                corpCounts.set(result.corporation_id, {
                    id: result.corporation_id,
                    name: result.corporation_name,
                    count: (corpCounts.get(result.corporation_id)?.count || 0) + 1,
                    type: 'corporation'
                });
            }
            if (result.alliance_id) {
                allianceCounts.set(result.alliance_id, {
                    id: result.alliance_id,
                    name: result.alliance_name,
                    count: (allianceCounts.get(result.alliance_id)?.count || 0) + 1,
                    type: 'alliance'
                });
            }
        }
    });

    const allCorps = Array.from(corpCounts.values())
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    const allAlliances = Array.from(allianceCounts.values())
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

    return { allCorps, allAlliances };
}

function toggleView(viewType) {
    currentView = viewType;
    window.currentView = currentView; // Update global reference

    // Update button states
    document.getElementById('grid-view-btn').classList.toggle('active', viewType === 'grid');
    document.getElementById('list-view-btn').classList.toggle('active', viewType === 'list');

    // Update grid classes
    const grids = document.querySelectorAll('.result-grid');
    grids.forEach(grid => {
        grid.classList.toggle('list-view', viewType === 'list');
    });

    // Clean up existing virtual scrolling
    const eligibleContainer = document.getElementById('eligible-grid');
    const ineligibleContainer = document.getElementById('ineligible-grid');

    if (eligibleContainer._cleanup) {
        eligibleContainer._cleanup();
    }
    if (ineligibleContainer._cleanup) {
        ineligibleContainer._cleanup();
    }

    // Re-render with new view type
    const eligibleToShow = expandedSections.eligible
        ? allResults.eligible
        : allResults.eligible.slice(0, displayedResults.eligible);
    const ineligibleToShow = expandedSections.ineligible
        ? allResults.ineligible
        : allResults.ineligible.slice(0, displayedResults.ineligible);

    // Recreate virtual scrolling with new settings
    if (eligibleToShow.length > 0) {
        setupVirtualScrolling('eligible-grid', eligibleToShow);
    }
    if (ineligibleToShow.length > 0) {
        setupVirtualScrolling('ineligible-grid', ineligibleToShow);
    }
}

function toggleExpanded(type) {
    expandedSections[type] = !expandedSections[type];
    updateResultsDisplay();

    const button = document.getElementById(`${type}-expand`);
    button.textContent = expandedSections[type]
        ? `Show Less (${allResults[type].length})`
        : `Show All (${allResults[type].length})`;
}

function toggleSummaryExpanded(type) {
    expandedSummarySections[type] = !expandedSummarySections[type];
    updateSummaryDisplay();

    const button = document.getElementById(`${type}-expand`);
    button.textContent = expandedSummarySections[type]
        ? `Show Less (${allSummaryData[type].length})`
        : `Show All (${allSummaryData[type].length})`;
}

function loadMoreResults(type) {
    const currentCount = displayedResults[type];
    const newCount = Math.min(currentCount + LOAD_MORE_COUNT, allResults[type].length);
    displayedResults[type] = newCount;

    updateResultsDisplay();
}

function loadMoreSummary(type) {
    const currentCount = displayedSummaryResults[type];
    const newCount = Math.min(currentCount + LOAD_MORE_COUNT, allSummaryData[type].length);
    displayedSummaryResults[type] = newCount;

    updateSummaryDisplay();
}

function updateResultsDisplay() {
    // Clean up previous results first
    getObserverManager().cleanupDeadElements();

    const eligibleToShow = expandedSections.eligible
        ? allResults.eligible
        : allResults.eligible.slice(0, displayedResults.eligible);

    const ineligibleToShow = expandedSections.ineligible
        ? allResults.ineligible
        : allResults.ineligible.slice(0, displayedResults.ineligible);

    renderGrid("eligible-grid", eligibleToShow, 'character');
    renderGrid("ineligible-grid", ineligibleToShow, 'character');

    updateLoadMoreButtons();
    updateShowingCount();
}

function updateSummaryDisplay() {
    const alliancesToShow = expandedSummarySections.alliance
        ? allSummaryData.alliance
        : allSummaryData.alliance.slice(0, displayedSummaryResults.alliance);

    const corporationsToShow = expandedSummarySections.corporation
        ? allSummaryData.corporation
        : allSummaryData.corporation.slice(0, displayedSummaryResults.corporation);

    renderGrid("top-alliance-grid", alliancesToShow, 'alliance');
    renderGrid("top-corp-grid", corporationsToShow, 'corporation');

    // Update load more buttons for summaries
    updateSummaryLoadMoreButtons();
}

function updateLoadMoreButtons() {
    const eligibleLoadMore = document.getElementById("eligible-load-more");
    const ineligibleLoadMore = document.getElementById("ineligible-load-more");

    // Show/hide load more buttons
    eligibleLoadMore.style.display =
        !expandedSections.eligible && displayedResults.eligible < allResults.eligible.length
            ? 'block' : 'none';

    ineligibleLoadMore.style.display =
        !expandedSections.ineligible && displayedResults.ineligible < allResults.ineligible.length
            ? 'block' : 'none';
}

function updateSummaryLoadMoreButtons() {
    const allianceLoadMore = document.getElementById("alliance-load-more");
    const corporationLoadMore = document.getElementById("corporation-load-more");

    // Show/hide load more buttons for summaries
    allianceLoadMore.style.display =
        !expandedSummarySections.alliance && displayedSummaryResults.alliance < allSummaryData.alliance.length
            ? 'block' : 'none';

    corporationLoadMore.style.display =
        !expandedSummarySections.corporation && displayedSummaryResults.corporation < allSummaryData.corporation.length
            ? 'block' : 'none';
}

function updateShowingCount() {
    const totalShowing =
        (expandedSections.eligible ? allResults.eligible.length : displayedResults.eligible) +
        (expandedSections.ineligible ? allResults.ineligible.length : displayedResults.ineligible);
    const totalResults = allResults.eligible.length + allResults.ineligible.length;

    const showingElement = document.getElementById("showing-count");
    if (totalShowing === totalResults) {
        showingElement.textContent = "Showing all results";
    } else {
        showingElement.textContent = `Showing ${totalShowing} of ${totalResults} results`;
    }
}

let characterCountTimeout = null;

function debouncedUpdateCharacterCount() {
    if (characterCountTimeout) {
        clearTimeout(characterCountTimeout);
    }

    characterCountTimeout = setTimeout(() => {
        updateCharacterCount();
    }, CHARACTER_COUNT_DEBOUNCE_MS);
}

function updateCharacterCount() {
    const textarea = document.getElementById('names');
    const names = textarea.value.split('\n')
        .map(n => n.trim())
        .filter(n => n && clientValidate(n));

    // Deduplicate
    const uniqueNames = [...new Set(names.map(n => n.toLowerCase()))];
    const count = uniqueNames.length;

    const countElement = document.getElementById('character-count');
    if (count === 0) {
        countElement.textContent = "0 characters entered";
    } else if (count === 1) {
        countElement.textContent = "1 character entered";
    } else {
        countElement.textContent = `${count} characters entered`;
    }

    // Update button text
    const button = document.getElementById('checkButton');
    const buttonText = button.querySelector('.button-text');
    if (count > 0) {
        buttonText.textContent = `Check ${count} Character${count !== 1 ? 's' : ''}`;
    } else {
        buttonText.textContent = 'Check War Eligibility';
    }
}

export async function validateNames() {
    const rawNames = document.getElementById("names").value.split("\n")
        .map(n => n.trim())
        .filter(n => n && clientValidate(n));

    // Deduplicate names (case-insensitive)
    const seenNames = new Set();
    const names = rawNames.filter(name => {
        const lowerName = name.toLowerCase();
        if (seenNames.has(lowerName)) {
            return false;
        }
        seenNames.add(lowerName);
        return true;
    });

    if (names.length === 0) {
        showError("No valid names entered. Please check the format of your character names.");
        return;
    }

    startLoading();

    try {
        const results = await validator(names);

        // Store complete results and build entity maps
        completeResults = results;
        buildEntityMaps(results);

        results.sort((a, b) => b.war_eligible - a.war_eligible);

        allResults.eligible = results.filter(r => r.war_eligible);
        allResults.ineligible = results.filter(r => !r.war_eligible);

        // Reset display counters
        displayedResults.eligible = Math.min(INITIAL_USER_RESULTS_COUNT, allResults.eligible.length);
        displayedResults.ineligible = Math.min(INITIAL_USER_RESULTS_COUNT, allResults.ineligible.length);
        expandedSections.eligible = false;
        expandedSections.ineligible = false;

        // Reset main result section button states
        const eligibleButton = document.getElementById('eligible-expand');
        const ineligibleButton = document.getElementById('ineligible-expand');
        if (eligibleButton) {
            eligibleButton.textContent = `Show All (${allResults.eligible.length})`;
        }
        if (ineligibleButton) {
            ineligibleButton.textContent = `Show All (${allResults.ineligible.length})`;
        }

        const { allCorps, allAlliances } = summarizeEntities(results);

        // Store all summary data
        allSummaryData.alliance = allAlliances;
        allSummaryData.corporation = allCorps;

        // Reset summary display counters
        displayedSummaryResults.alliance = Math.min(INITIAL_CORP_ALLIANCE_COUNT, allAlliances.length);
        displayedSummaryResults.corporation = Math.min(INITIAL_CORP_ALLIANCE_COUNT, allCorps.length);
        expandedSummarySections.alliance = false;
        expandedSummarySections.corporation = false;

        // Reset summary button states  
        const allianceButton = document.getElementById('alliance-expand');
        const corporationButton = document.getElementById('corporation-expand');
        if (allianceButton) {
            allianceButton.textContent = `Show All (${allAlliances.length})`;
        }
        if (corporationButton) {
            corporationButton.textContent = `Show All (${allCorps.length})`;
        }

        // Update summary totals in buttons - with null checks
        const allianceTotal = document.getElementById("alliance-total");
        const corporationTotal = document.getElementById("corporation-total");
        if (allianceTotal) {
            allianceTotal.textContent = allAlliances.length;
        }
        if (corporationTotal) {
            corporationTotal.textContent = allCorps.length;
        }

        updateResultsDisplay();
        updateSummaryDisplay();

        // Wait for results section to be shown before updating stats
        setTimeout(() => {
            updateStats(allResults.eligible, allResults.ineligible);
            updatePerformanceStats();
        }, STATS_UPDATE_DELAY);

    } catch (err) {
        if (err.message.includes("504")) {
            showError("The request timed out. EVE ESI servers may be busy. Please try again later.");
            console.error("Timeout error:", err);
        }
        else if (err.message.includes("429")) {
            showError("Rate limit exceeded. Please wait a moment before trying again.");
            console.error("Rate limit error:", err);
        }
        else if (err.message.includes("400")) {
            showError("Invalid request, probably too many characters simultaneously. Limit is 500.");
            console.error("Invalid request error:", err);
        }
        else {
            showError("Unexpected error contacting EVE ESI servers. Check console log for more details.");
            console.error("Unhandled ESI error:", err);
        }
    } finally {
        stopLoading();
    }
}

function handleZkillStatsClick(element) {
    const clickableType = element.dataset.clickable;
    
    // Update entity maps before showing zkill cards
    const zkillCard = getZkillCardInstance(); // You'll need to export this from zkill-card.js
    zkillCard.updateEntityMaps();

    if (clickableType === 'character') {
        const characterId = element.dataset.characterId;
        const characterName = element.querySelector('.character-name a')?.textContent || 'Unknown Character';
        showCharacterStats(characterId, characterName);
    } else if (clickableType === 'corporation') {
        const entityId = element.dataset.entityId;
        const entityName = element.dataset.entityName;
        showCorporationStats(entityId, entityName);
    } else if (clickableType === 'alliance') {
        const entityId = element.dataset.entityId;
        const entityName = element.dataset.entityName;
        showAllianceStats(entityId, entityName);
    }
}

// Event listeners
document.addEventListener('DOMContentLoaded', function () {
    // Initialize IndexedDB
    initDB().then(() => {
        clearExpiredCache();
    }).catch(err => {
        showError(`Failed to initialize IndexedDB: ${err}`);
        console.error('Failed to initialize IndexedDB:', err);
    });

    const textarea = document.getElementById('names');
    textarea.addEventListener('input', debouncedUpdateCharacterCount);
    textarea.addEventListener('keydown', function (e) {
        if (e.ctrlKey && e.key === 'Enter') {
            validateNames();
        }
    });

    // Make validateNames available globally for the HTML onclick handler
    window.validateNames = validateNames;

    window.addEventListener('beforeunload', () => {
        getObserverManager().cleanup();
    });

    // Cleanup on page visibility change (mobile optimization)
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            getObserverManager().cleanupDeadElements();
        }
    });

    // Initialize character count
    updateCharacterCount();

    // Setup collapsed indicator click functionality
    setupCollapsedIndicatorClick();

    // update version
    updateVersionDisplay();

    // Scroll state detection
    addScrollStateDetection();
});