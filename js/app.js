/*
    EVE Target Intel - Main Application Logic
    
    Copyright (C) 2025 moregh (https://github.com/moregh)
    Licensed under AGPL License.
*/

import { STATS_UPDATE_DELAY, CHARACTER_COUNT_DEBOUNCE_MS, INPUT_SECTION_HOVER_DELAY_MS } from './config.js';
import { initDB, clearExpiredCache } from './database.js';
import { showCharacterStats, showCorporationStats, showAllianceStats } from './zkill-card.js';
import { clientValidate, validateEntityName } from './validation.js';
import { mixedValidator } from './esi-api.js';
import { initializeFilters, setResultsData, getFilteredResults, getFilteredAlliances, getFilteredCorporations, applyFiltersToTree } from './filters.js';
import { startLoading, stopLoading, showError, updateStats, updatePerformanceStats, updateVersionDisplay, expandInputSection } from './ui.js';
import { renderGrid, buildEntityMaps, getObserverManager, addScrollStateDetection } from './rendering.js';
import { getZkillCardInstance } from './zkill-card.js';
import { domCache } from './dom-cache.js';
import { buildTreeStructure, renderTree } from './tree-navigation.js';


let currentView = 'grid';
let allResults = [];
let allSummaryData = { alliance: [], corporation: [] };
let currentTab = 'characters';
let completeResults = [];

window.currentView = currentView;

function setupCollapsedIndicatorClick() {
    const inputSection = domCache.get('input-section');

    document.documentElement.style.setProperty('--input-hover-delay', `${INPUT_SECTION_HOVER_DELAY_MS}ms`);
}


document.addEventListener('click', function (event) {
    const zkillCardItem = event.target.closest('.zkill-card-clickable');
    if (zkillCardItem) {
        event.preventDefault();
        event.stopPropagation();
        handleZkillCardLinkClick(zkillCardItem);
        return;
    }

    const clickableElement = event.target.closest('[data-clickable]');
    if (clickableElement) {
        handleZkillStatsClick(clickableElement);
        return;
    }

    const target = event.target.closest('[data-action]');
    if (!target) return;

    const action = target.dataset.action;

    switch (action) {
        case 'reload-page':
            event.preventDefault();
            window.location.reload(true);
            domCache.queryAll('form').forEach(form => form.reset());
            break;
        case 'expand-input':
            expandInputSection();
            setTimeout(() => {
                domCache.get('names').focus();
            }, STATS_UPDATE_DELAY);
            break;
    }
});

function summariseEntities(results) {
    const corpCounts = new Map();
    const allianceCounts = new Map();

    const updateCounts = (map, id, name, type, war_eligible, isDirect) => {
        const existing = map.get(id);
        map.set(id, {
            id,
            name,
            count: (existing?.count || 0) + 1,
            type,
            war_eligible: existing?.war_eligible || war_eligible,
            isDirect: existing?.isDirect || isDirect
        });
    };

    results.forEach(result => {
        if (result.corporation_name && !result.character_name) {
            updateCounts(corpCounts, result.corporation_id, result.corporation_name, 'corporation', result.war_eligible, true);
        }
        else if (result.alliance_name && !result.character_name) {
            updateCounts(allianceCounts, result.alliance_id, result.alliance_name, 'alliance', result.war_eligible, true);
        }
        else if (result.character_name) {
            if (result.corporation_id) {
                updateCounts(corpCounts, result.corporation_id, result.corporation_name, 'corporation', result.war_eligible, false);
            }
            if (result.alliance_id) {
                updateCounts(allianceCounts, result.alliance_id, result.alliance_name, 'alliance', result.war_eligible, false);
            }
        }
    });

    const sortFn = (a, b) => {
        if (a.isDirect !== b.isDirect) return a.isDirect ? -1 : 1;
        return b.count - a.count || a.name.localeCompare(b.name);
    };

    return {
        allCorps: Array.from(corpCounts.values()).sort(sortFn),
        allAlliances: Array.from(allianceCounts.values()).sort(sortFn)
    };
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
    const textarea = domCache.get('names');
    const names = textarea.value.split('\n')
        .map(n => n.trim())
        .filter(n => n && (clientValidate(n) || validateEntityName(n)));


    const uniqueNames = [...new Set(names.map(n => n.toLowerCase()))];
    const count = uniqueNames.length;

    const countElement = domCache.get('character-count');
    if (count === 0) {
        countElement.textContent = "0 entities entered";
    } else if (count === 1) {
        countElement.textContent = "1 entity entered";
    } else {
        countElement.textContent = `${count} entities entered`;
    }

    const button = domCache.get('checkButton');
    const buttonText = button.querySelector('.button-text');
    if (count > 0) {
        buttonText.textContent = `Analyze ${count} Entit${count !== 1 ? 'ies' : 'y'}`;
    } else {
        buttonText.textContent = 'Analyze Entities';
    }
}

export async function validateNames() {
    const rawNames = domCache.get("names").value.split("\n")
        .map(n => n.trim())
        .filter(n => n && (clientValidate(n) || validateEntityName(n)));

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
        showError("No valid names entered. Please check the format of your entity names.");
        return;
    }

    startLoading();

    try {
        const results = await mixedValidator(names);
        completeResults = results;
        buildEntityMaps(results);

        results.sort((a, b) => {
            const nameA = a.character_name || a.corporation_name || a.alliance_name || '';
            const nameB = b.character_name || b.corporation_name || b.alliance_name || '';
            return nameA.localeCompare(nameB);
        });

        allResults = results;
        setResultsData(results);
        const { allCorps, allAlliances } = summariseEntities(results);
        allSummaryData.alliance = allAlliances;
        allSummaryData.corporation = allCorps;

        const treeData = buildTreeStructure(results);
        renderTree(treeData);

        const zkillCard = getZkillCardInstance();
        zkillCard.updateEntityMaps();
        zkillCard.setCompleteResults(results);

        const unifiedHeader = domCache.get('unified-header');
        if (unifiedHeader) {
            unifiedHeader.style.display = 'flex';
        }

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

        setTimeout(() => {
            const button = domCache.get("checkButton");
            if (button && button.disabled) {
                button.disabled = false;
                button.removeAttribute('disabled');
            }
        }, 250);
    }
}

function handleZkillStatsClick(element) {
    const clickableType = element.dataset.clickable;
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


document.addEventListener('DOMContentLoaded', function () {
    initDB().then(() => {
        clearExpiredCache();
    }).catch(err => {
        showError(`Failed to initialize IndexedDB: ${err}`);
        console.error('Failed to initialize IndexedDB:', err);
    });

    initializeFilters(() => {
        applyFiltersToTree();
    });

    const textarea = domCache.get('names');
    textarea.addEventListener('input', debouncedUpdateCharacterCount);
    textarea.addEventListener('keydown', function (e) {
        if (e.ctrlKey && e.key === 'Enter') {
            validateNames();
        }
    });

    const checkButton = domCache.get('checkButton');
    if (checkButton) {
        checkButton.addEventListener('click', validateNames);
    }

    window.addEventListener('beforeunload', () => {
        getObserverManager().cleanup();
    });

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            getObserverManager().cleanupDeadElements();
        }
    });

    updateCharacterCount();
    setupCollapsedIndicatorClick();
    updateVersionDisplay();
    addScrollStateDetection();
});