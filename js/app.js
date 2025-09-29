/*
    EVE Target Intel - Main Application Logic
    
    Copyright (C) 2025 moregh (https://github.com/moregh/)
    Licensed under AGPL License.
*/

import {
    STATS_UPDATE_DELAY,
    CHARACTER_COUNT_DEBOUNCE_MS
} from './config.js';
import { initDB, clearExpiredCache } from './database.js';
import { showCharacterStats, showCorporationStats, showAllianceStats } from './zkill-card.js';
import { clientValidate } from './validation.js';
import { validator } from './esi-api.js';
import { initializeFilters, setResultsData, getFilteredResults, getFilteredAlliances, getFilteredCorporations } from './filters.js';
import {
    startLoading,
    stopLoading,
    showError,
    updateStats,
    updatePerformanceStats,
    updateVersionDisplay,
    expandInputSection
} from './ui.js';
import {
    renderGrid,
    buildEntityMaps,
    getObserverManager,
    addScrollStateDetection
} from './rendering.js';
import { getZkillCardInstance } from './zkill-card.js'

// Application state
let currentView = 'grid'; // Fixed to grid view only
let allResults = [];

// Summary data and display tracking
let allSummaryData = { alliance: [], corporation: [] };

// Tabbed interface state
let currentTab = 'characters';

// Store complete results
let completeResults = [];

// Make currentView available to rendering module
window.currentView = currentView;

function setupCollapsedIndicatorClick() {
    const inputSection = document.getElementById('input-section');

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
    // Check for zkill card items FIRST (prevent event bubbling)
    const zkillCardItem = event.target.closest('.zkill-card-clickable');
    if (zkillCardItem) {
        event.preventDefault();
        event.stopPropagation();
        handleZkillCardLinkClick(zkillCardItem);
        return;
    }

    // Check for zkill stats clicks SECOND (before checking for data-action)
    const clickableElement = event.target.closest('[data-clickable]');
    if (clickableElement) {
        handleZkillStatsClick(clickableElement);
        return;
    }

    // Check for tab button clicks
    const tabButton = event.target.closest('.tab-btn');
    if (tabButton) {
        const tabName = tabButton.dataset.tab;
        switchTab(tabName);
        return;
    }

    // Existing logic for data-action elements
    const target = event.target.closest('[data-action]');
    if (!target) return;

    const action = target.dataset.action;

    switch (action) {
        case 'toggle-expanded':
            // No longer needed - always show all
            break;
        case 'load-more':
            // No longer needed - always show all
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
        if (result.corporation_id) {
            const existing = corpCounts.get(result.corporation_id);
            corpCounts.set(result.corporation_id, {
                id: result.corporation_id,
                name: result.corporation_name,
                count: (existing?.count || 0) + 1,
                type: 'corporation',
                war_eligible: existing?.war_eligible || result.war_eligible
            });
        }
        if (result.alliance_id) {
            const existing = allianceCounts.get(result.alliance_id);
            allianceCounts.set(result.alliance_id, {
                id: result.alliance_id,
                name: result.alliance_name,
                count: (existing?.count || 0) + 1,
                type: 'alliance',
                war_eligible: existing?.war_eligible || result.war_eligible
            });
        }
    });

    const allCorps = Array.from(corpCounts.values())
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    const allAlliances = Array.from(allianceCounts.values())
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

    return { allCorps, allAlliances };
}


// Tab functionality
function switchTab(tabName) {
    // Update active tab
    currentTab = tabName;

    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    document.getElementById(`${tabName}-tab`).classList.add('active');

    // Update the tab counts
    updateTabCounts();

    // Update the display for the current tab
    updateTabDisplay();
}

// Load more functionality removed - always show all results

function updateTabDisplay() {
    if (currentTab === 'characters') {
        // Clean up previous results first
        getObserverManager().cleanupDeadElements();

        const filteredResults = getFilteredResults();
        renderGrid("characters-grid", filteredResults, 'character');

    } else if (currentTab === 'alliances') {
        const filteredAlliances = getFilteredAlliances(allSummaryData.alliance);
        renderGrid("alliances-grid", filteredAlliances, 'alliance');

    } else if (currentTab === 'corporations') {
        const filteredCorporations = getFilteredCorporations(allSummaryData.corporation);
        renderGrid("corporations-grid", filteredCorporations, 'corporation');
    }
}

function updateTabCounts() {
    const charactersCount = document.getElementById('characters-tab-count');
    const alliancesCount = document.getElementById('alliances-tab-count');
    const corporationsCount = document.getElementById('corporations-tab-count');

    if (charactersCount) {
        const filteredResults = getFilteredResults();
        charactersCount.textContent = filteredResults.length;
    }

    if (alliancesCount) {
        const filteredAlliances = getFilteredAlliances(allSummaryData.alliance);
        alliancesCount.textContent = filteredAlliances.length;
    }

    if (corporationsCount) {
        const filteredCorporations = getFilteredCorporations(allSummaryData.corporation);
        corporationsCount.textContent = filteredCorporations.length;
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
        buttonText.textContent = `Analyze ${count} Character${count !== 1 ? 's' : ''}`;
    } else {
        buttonText.textContent = 'Analyze Characters';
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

        results.sort((a, b) => (a.character_name || '').localeCompare(b.character_name || ''));

        allResults = results;

        // Update filters with new results data
        setResultsData(results);

        const { allCorps, allAlliances } = summarizeEntities(results);

        // Store all summary data
        allSummaryData.alliance = allAlliances;
        allSummaryData.corporation = allCorps;

        // No state initialization needed - always show all results

        // Update tab counts
        updateTabCounts();
    
        // Update the display for the current tab
        updateTabDisplay();

        // Wait for results section to be shown before updating stats
        setTimeout(() => {
            updateStats(allResults);
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

    // Update entity maps and complete results before showing zkill cards
    const zkillCard = getZkillCardInstance();
    zkillCard.updateEntityMaps();
    zkillCard.setCompleteResults(completeResults);

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

function handleZkillCardLinkClick(element) {
    const entityType = element.dataset.entityType;
    const entityId = element.dataset.entityId;
    const entityName = element.dataset.entityName;

    // Update entity maps and complete results before showing zkill cards
    const zkillCard = getZkillCardInstance();
    zkillCard.updateEntityMaps();
    zkillCard.setCompleteResults(completeResults);

    if (entityType === 'character') {
        showCharacterStats(entityId, entityName);
    } else if (entityType === 'corporation') {
        showCorporationStats(entityId, entityName);
    } else if (entityType === 'alliance') {
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

    // Initialize filters system
    initializeFilters(() => {
            updateTabDisplay();
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