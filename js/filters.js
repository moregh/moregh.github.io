/*
    EVE Target Intel - Results Filtering System

    Copyright (C) 2025 moregh (https://github.com/moregh/)
    Licensed under AGPL License.
*/

let filterState = {
    warEligibleOnly: false,
    nameSearch: '',
    minCorpSize: 1,
    maxCorpSize: 500,
    minAllianceSize: 1,
    maxAllianceSize: 10000,
    selectedCorporation: '',
    selectedAlliance: '',
    isCollapsed: true
};

let filterElements = null;
let allResults = [];
let filteredResults = [];
let onFiltersChangeCallback = null;
let corpSizeCache = new Map();
let allianceSizeCache = new Map();
let characterSearchCache = new Map();
let lastFilterHash = '';
let filteredResultsCache = new Map();

function createFilterHash(state) {
    return JSON.stringify({
        warEligibleOnly: state.warEligibleOnly,
        nameSearch: state.nameSearch,
        minCorpSize: state.minCorpSize,
        maxCorpSize: state.maxCorpSize,
        minAllianceSize: state.minAllianceSize,
        maxAllianceSize: state.maxAllianceSize,
        selectedCorporation: state.selectedCorporation,
        selectedAlliance: state.selectedAlliance
    });
}

function buildSizeCaches() {
    corpSizeCache.clear();
    allianceSizeCache.clear();

    allResults.forEach(character => {
        const corpId = character.corporation_id;
        corpSizeCache.set(corpId, (corpSizeCache.get(corpId) || 0) + 1);
    });

    allResults.forEach(character => {
        if (character.alliance_id) {
            const allianceId = character.alliance_id;
            allianceSizeCache.set(allianceId, (allianceSizeCache.get(allianceId) || 0) + 1);
        }
    });
}

function buildSearchCache() {
    characterSearchCache.clear();
    allResults.forEach(character => {
        const searchableText = [
            character.character_name?.toLowerCase() || '',
            character.corporation_name?.toLowerCase() || '',
            character.alliance_name?.toLowerCase() || ''
        ].join(' ');
        characterSearchCache.set(character.character_id, searchableText);
    });
}

export function initializeFilters(onChangeCallback) {
    onFiltersChangeCallback = onChangeCallback;
    cacheFilterElements();
    setupEventListeners();
    updateRangeValues();
    collapseFilters();
}

function cacheFilterElements() {
    filterElements = {
        section: document.getElementById('filters-section'),
        content: document.getElementById('filters-content'),
        toggleBtn: document.getElementById('filter-toggle'),
        toggleText: document.querySelector('#filter-toggle .toggle-text'),
        toggleIcon: document.querySelector('#filter-toggle .toggle-icon'),
        clearBtn: document.getElementById('filter-clear'),
        warEligibleOnly: document.getElementById('filter-war-eligible-only'),
        nameSearch: document.getElementById('filter-name'),
        minCorpSize: document.getElementById('filter-min-corp-size'),
        maxCorpSize: document.getElementById('filter-max-corp-size'),
        minAllianceSize: document.getElementById('filter-min-alliance-size'),
        maxAllianceSize: document.getElementById('filter-max-alliance-size'),
        corporationSelect: document.getElementById('filter-corporation'),
        allianceSelect: document.getElementById('filter-alliance'),
        minCorpSizeValue: document.getElementById('min-corp-size-value'),
        maxCorpSizeValue: document.getElementById('max-corp-size-value'),
        minAllianceSizeValue: document.getElementById('min-alliance-size-value'),
        maxAllianceSizeValue: document.getElementById('max-alliance-size-value'),
        resultsCount: document.getElementById('filter-results-count'),
    };
}

function setupEventListeners() {
    if (!filterElements) return;

    filterElements.toggleBtn?.addEventListener('click', toggleFilters);
    filterElements.clearBtn?.addEventListener('click', clearAllFilters);
    filterElements.warEligibleOnly?.addEventListener('change', handleFilterChange);
    filterElements.nameSearch?.addEventListener('input', debounce(handleFilterChange, 300));
    filterElements.minCorpSize?.addEventListener('input', handleMinCorpSizeChange);
    filterElements.maxCorpSize?.addEventListener('input', handleMaxCorpSizeChange);
    filterElements.minAllianceSize?.addEventListener('input', handleMinAllianceSizeChange);
    filterElements.maxAllianceSize?.addEventListener('input', handleMaxAllianceSizeChange);
    filterElements.corporationSelect?.addEventListener('change', handleFilterChange);
    filterElements.allianceSelect?.addEventListener('change', handleAllianceChange);
}

function handleFilterChange() {
    updateFilterState();
    applyFilters();
    updateResultsDisplay();

    if (onFiltersChangeCallback) {
        onFiltersChangeCallback();
    }
}

function handleMinCorpSizeChange() {
    filterState.minCorpSize = parseInt(filterElements.minCorpSize.value);
    filterElements.minCorpSizeValue.textContent = filterState.minCorpSize;

    if (filterState.minCorpSize > filterState.maxCorpSize) {
        filterState.maxCorpSize = filterState.minCorpSize;
        filterElements.maxCorpSize.value = filterState.maxCorpSize;
        filterElements.maxCorpSizeValue.textContent = filterState.maxCorpSize;
    }

    applyFilters();
    updateResultsDisplay();
    if (onFiltersChangeCallback) {
        onFiltersChangeCallback();
    }
}

function handleMaxCorpSizeChange() {
    filterState.maxCorpSize = parseInt(filterElements.maxCorpSize.value);
    filterElements.maxCorpSizeValue.textContent = filterState.maxCorpSize;

    if (filterState.maxCorpSize < filterState.minCorpSize) {
        filterState.minCorpSize = filterState.maxCorpSize;
        filterElements.minCorpSize.value = filterState.minCorpSize;
        filterElements.minCorpSizeValue.textContent = filterState.minCorpSize;
    }

    applyFilters();
    updateResultsDisplay();
    if (onFiltersChangeCallback) {
        onFiltersChangeCallback();
    }
}

function handleMinAllianceSizeChange() {
    filterState.minAllianceSize = parseInt(filterElements.minAllianceSize.value);
    filterElements.minAllianceSizeValue.textContent = filterState.minAllianceSize;

    if (filterState.minAllianceSize > filterState.maxAllianceSize) {
        filterState.maxAllianceSize = filterState.minAllianceSize;
        filterElements.maxAllianceSize.value = filterState.maxAllianceSize;
        filterElements.maxAllianceSizeValue.textContent = filterState.maxAllianceSize;
    }

    applyFilters();
    updateResultsDisplay();
    if (onFiltersChangeCallback) {
        onFiltersChangeCallback();
    }
}

function handleMaxAllianceSizeChange() {
    filterState.maxAllianceSize = parseInt(filterElements.maxAllianceSize.value);
    filterElements.maxAllianceSizeValue.textContent = filterState.maxAllianceSize;

    if (filterState.maxAllianceSize < filterState.minAllianceSize) {
        filterState.minAllianceSize = filterState.maxAllianceSize;
        filterElements.minAllianceSize.value = filterState.minAllianceSize;
        filterElements.minAllianceSizeValue.textContent = filterState.minAllianceSize;
    }

    applyFilters();
    updateResultsDisplay();
    if (onFiltersChangeCallback) {
        onFiltersChangeCallback();
    }
}

function handleAllianceChange() {
    const currentCorpSelection = filterElements.corporationSelect.value;

    populateCorporationDropdown();

    const corpOptions = Array.from(filterElements.corporationSelect.options);
    const isCurrentCorpStillAvailable = corpOptions.some(option => option.value === currentCorpSelection);

    if (isCurrentCorpStillAvailable) {
        filterElements.corporationSelect.value = currentCorpSelection;
    } else {
        filterElements.corporationSelect.value = '';
    }

    handleFilterChange();
}

function populateCorporationDropdown() {
    if (!filterElements.corporationSelect || !allResults.length) return;

    const corpSelect = filterElements.corporationSelect;
    const selectedAllianceId = filterElements.allianceSelect?.value;
    corpSelect.innerHTML = '<option value="">All Corporations</option>';
    const corporations = new Map();

    allResults.forEach(character => {
        if (character.corporation_id && character.corporation_name) {
            if (selectedAllianceId) {
                if (character.alliance_id && character.alliance_id.toString() === selectedAllianceId) {
                    corporations.set(character.corporation_id, character.corporation_name);
                }
            } else {
                corporations.set(character.corporation_id, character.corporation_name);
            }
        }
    });

    const sortedCorps = Array.from(corporations.entries()).sort((a, b) => a[1].localeCompare(b[1]));
    sortedCorps.forEach(([id, name]) => {
        const option = document.createElement('option');
        option.value = id.toString();
        option.textContent = name;
        corpSelect.appendChild(option);
    });
}

function updateFilterState() {
    if (!filterElements) return;

    filterState = {
        warEligibleOnly: filterElements.warEligibleOnly?.checked ?? false,
        nameSearch: filterElements.nameSearch?.value.toLowerCase().trim() ?? '',
        minCorpSize: parseInt(filterElements.minCorpSize?.value) ?? 1,
        maxCorpSize: parseInt(filterElements.maxCorpSize?.value) ?? 500,
        minAllianceSize: parseInt(filterElements.minAllianceSize?.value) ?? 1,
        maxAllianceSize: parseInt(filterElements.maxAllianceSize?.value) ?? 10000,
        selectedCorporation: filterElements.corporationSelect?.value ?? '',
        selectedAlliance: filterElements.allianceSelect?.value ?? '',
        isCollapsed: filterState.isCollapsed
    };
}

function applyFilters() {
    if (!allResults.length) {
        filteredResults = [];
        return;
    }

    const currentFilterHash = createFilterHash(filterState);
    if (currentFilterHash === lastFilterHash && filteredResultsCache.has(currentFilterHash)) {
        filteredResults = filteredResultsCache.get(currentFilterHash);
        return;
    }

    const hasNameSearch = !!filterState.nameSearch;
    const searchTerm = filterState.nameSearch;
    const hasCorpFilter = !!filterState.selectedCorporation;
    const corpFilterId = filterState.selectedCorporation;
    const hasAllianceFilter = !!filterState.selectedAlliance;
    const allianceFilterId = filterState.selectedAlliance;
    const characterResults = allResults.filter(result => result.character_name);

    filteredResults = characterResults.filter(character => {
        if (filterState.warEligibleOnly && !character.war_eligible) return false;

        if (hasCorpFilter && character.corporation_id.toString() !== corpFilterId) {
            return false;
        }

        if (hasAllianceFilter && character.alliance_id?.toString() !== allianceFilterId) {
            return false;
        }

        const corpSize = corpSizeCache.get(character.corporation_id) || 0;
        if (corpSize < filterState.minCorpSize || corpSize > filterState.maxCorpSize) return false;

        if (character.alliance_id) {
            const allianceSize = allianceSizeCache.get(character.alliance_id) || 0;
            if (allianceSize < filterState.minAllianceSize || allianceSize > filterState.maxAllianceSize) return false;
        }

        if (hasNameSearch) {
            const searchableText = characterSearchCache.get(character.character_id) || '';
            if (!searchableText.includes(searchTerm)) return false;
        }

        return true;
    });

    filteredResultsCache.set(currentFilterHash, filteredResults);
    lastFilterHash = currentFilterHash;

    if (filteredResultsCache.size > 20) {
        const firstKey = filteredResultsCache.keys().next().value;
        filteredResultsCache.delete(firstKey);
    }
}

function updateRangeValues() {
    if (!filterElements) return;

    if (filterElements.minCorpSizeValue && filterElements.minCorpSize) {
        filterElements.minCorpSizeValue.textContent = filterElements.minCorpSize.value;
    }

    if (filterElements.maxCorpSizeValue && filterElements.maxCorpSize) {
        filterElements.maxCorpSizeValue.textContent = filterElements.maxCorpSize.value;
    }

    if (filterElements.minAllianceSizeValue && filterElements.minAllianceSize) {
        filterElements.minAllianceSizeValue.textContent = filterElements.minAllianceSize.value;
    }

    if (filterElements.maxAllianceSizeValue && filterElements.maxAllianceSize) {
        filterElements.maxAllianceSizeValue.textContent = filterElements.maxAllianceSize.value;
    }
}

function updateResultsDisplay() {
    if (!filterElements) return;

    const totalResults = allResults.length;
    const filteredCount = filteredResults.length;

    if (filterElements.resultsCount) {
        if (filteredCount === totalResults) {
            filterElements.resultsCount.textContent = `Showing ${totalResults} results`;
        } else {
            filterElements.resultsCount.textContent = `Showing ${filteredCount} of ${totalResults} results`;
        }
    }
}

function toggleFilters() {
    if (!filterElements?.section) return;

    filterState.isCollapsed = !filterState.isCollapsed;

    if (filterState.isCollapsed) {
        collapseFilters();
    } else {
        expandFilters();
    }
}

function collapseFilters() {
    if (!filterElements) return;

    filterElements.section?.classList.add('collapsed');
    if (filterElements.toggleText) {
        filterElements.toggleText.textContent = 'Show';
    }
}

function expandFilters() {
    if (!filterElements) return;

    filterElements.section?.classList.remove('collapsed');
    if (filterElements.toggleText) {
        filterElements.toggleText.textContent = 'Hide';
    }
}

function clearAllFilters() {
    if (!filterElements) return;

    filterElements.warEligibleOnly.checked = false;
    filterElements.nameSearch.value = '';
    filterElements.minCorpSize.value = 1;
    filterElements.maxCorpSize.value = filterElements.maxCorpSize.max;
    filterElements.minAllianceSize.value = 1;
    filterElements.maxAllianceSize.value = filterElements.maxAllianceSize.max;
    filterElements.allianceSelect.value = '';
    filterElements.corporationSelect.value = '';

    populateCorporationDropdown();
    updateRangeValues();
    handleFilterChange();
}

export function setResultsData(results) {
    allResults = results || [];
    filteredResultsCache.clear();
    lastFilterHash = '';

    buildSizeCaches();
    buildSearchCache();
    updateSliderMaximums(results);
    populateDropdowns(results);
    applyFilters();
    updateResultsDisplay();
}

function updateSliderMaximums(results) {
    if (!results || !results.length || !filterElements) return;

    const corpSizes = new Map();

    results.forEach(char => {
        const corpId = char.corporation_id;
        corpSizes.set(corpId, (corpSizes.get(corpId) || 0) + 1);
    });

    const maxCorpSize = Math.max(...corpSizes.values());
    const allianceSizes = new Map();

    results.forEach(char => {
        if (char.alliance_id) {
            const allianceId = char.alliance_id;
            allianceSizes.set(allianceId, (allianceSizes.get(allianceId) || 0) + 1);
        }
    });

    const maxAllianceSize = allianceSizes.size > 0 ? Math.max(...allianceSizes.values()) : 1;

    if (filterElements.minCorpSize && filterElements.maxCorpSize) {
        filterElements.minCorpSize.max = maxCorpSize;
        filterElements.maxCorpSize.max = maxCorpSize;
        if (filterState.maxCorpSize > maxCorpSize) {
            filterState.maxCorpSize = maxCorpSize;
            filterElements.maxCorpSize.value = maxCorpSize;
            filterElements.maxCorpSizeValue.textContent = maxCorpSize;
        }
    }

    if (filterElements.minAllianceSize && filterElements.maxAllianceSize) {
        filterElements.minAllianceSize.max = maxAllianceSize;
        filterElements.maxAllianceSize.max = maxAllianceSize;
        if (filterState.maxAllianceSize > maxAllianceSize) {
            filterState.maxAllianceSize = maxAllianceSize;
            filterElements.maxAllianceSize.value = maxAllianceSize;
            filterElements.maxAllianceSizeValue.textContent = maxAllianceSize;
        }
    }
}

function populateDropdowns(results) {
    if (!filterElements || !results.length) return;

    const corporations = new Map();
    const alliances = new Map();

    results.forEach(character => {
        if (character.corporation_id && character.corporation_name) {
            corporations.set(character.corporation_id, character.corporation_name);
        }
        if (character.alliance_id && character.alliance_name) {
            alliances.set(character.alliance_id, character.alliance_name);
        }
    });

    populateCorporationDropdown();

    if (filterElements.allianceSelect) {
        const allianceSelect = filterElements.allianceSelect;
        allianceSelect.innerHTML = '<option value="">All Alliances</option>';
        const sortedAlliances = Array.from(alliances.entries()).sort((a, b) => a[1].localeCompare(b[1]));

        sortedAlliances.forEach(([id, name]) => {
            const option = document.createElement('option');
            option.value = id.toString();
            option.textContent = name;
            allianceSelect.appendChild(option);
        });
    }
}

export function getFilteredResults() {
    return filteredResults;
}

export function getFilteredAlliances(allAlliances) {
    if (!allAlliances || !allAlliances.length) return [];

    return allAlliances.filter(alliance => {
        if (filterState.warEligibleOnly && !alliance.war_eligible) return false;

        if (filterState.nameSearch) {
            const searchLower = filterState.nameSearch;
            const nameMatch = alliance.name?.toLowerCase().includes(searchLower);
            if (!nameMatch) return false;
        }

        if (alliance.count < filterState.minAllianceSize || alliance.count > filterState.maxAllianceSize) return false;

        if (filterState.selectedAlliance && alliance.id.toString() !== filterState.selectedAlliance) {
            return false;
        }

        if (filterState.selectedCorporation) {
            const corpMembers = allResults.filter(char => char.corporation_id.toString() === filterState.selectedCorporation);
            const corpAllianceId = corpMembers.length > 0 ? corpMembers[0].alliance_id : null;

            if (!corpAllianceId) return false;

            if (alliance.id.toString() !== corpAllianceId.toString()) {
                return false;
            }
        }

        return true;
    });
}

export function getFilteredCorporations(allCorporations) {
    if (!allCorporations || !allCorporations.length) return [];

    return allCorporations.filter(corporation => {
        if (filterState.warEligibleOnly && !corporation.war_eligible) return false;

        if (filterState.nameSearch) {
            const searchLower = filterState.nameSearch;
            const nameMatch = corporation.name?.toLowerCase().includes(searchLower);
            if (!nameMatch) return false;
        }

        if (corporation.count < filterState.minCorpSize || corporation.count > filterState.maxCorpSize) return false;

        if (filterState.selectedCorporation && corporation.id.toString() !== filterState.selectedCorporation) {
            return false;
        }

        if (filterState.selectedAlliance) {
            const corpMembers = allResults.filter(char => char.corporation_id === corporation.id);
            const corpAllianceId = corpMembers.length > 0 ? corpMembers[0].alliance_id : null;
            if (corpAllianceId?.toString() !== filterState.selectedAlliance) {
                return false;
            }
        }

        return true;
    });
}

export function hasActiveFilters() {
    return filterState.nameSearch ||
        filterState.warEligibleOnly ||
        filterState.minCorpSize > 1 ||
        filterState.minAllianceSize > 1 ||
        filterState.selectedCorporation ||
        filterState.selectedAlliance;
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}