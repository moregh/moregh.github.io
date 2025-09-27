/*
    EVE Target Intel - Results Filtering System

    Copyright (C) 2025 moregh (https://github.com/moregh/)
    Licensed under AGPL License.
*/

// Filter state
let filterState = {
    warEligibleOnly: false,
    nameSearch: '',
    minCorpSize: 1,
    minAllianceSize: 1,
    selectedCorporation: '',
    selectedAlliance: '',
    isCollapsed: true
};

// Cached references to avoid repeated DOM queries
let filterElements = null;
let allResults = [];
let filteredResults = [];

// Callback for when filters change
let onFiltersChangeCallback = null;

/**
 * Initialize filter system
 */
export function initializeFilters(onChangeCallback) {
    onFiltersChangeCallback = onChangeCallback;
    cacheFilterElements();
    setupEventListeners();
    updateRangeValues();
    collapseFilters(); // Start collapsed
}

/**
 * Cache DOM elements for performance
 */
function cacheFilterElements() {
    filterElements = {
        section: document.getElementById('filters-section'),
        content: document.getElementById('filters-content'),
        toggleBtn: document.getElementById('filter-toggle'),
        toggleText: document.querySelector('#filter-toggle .toggle-text'),
        toggleIcon: document.querySelector('#filter-toggle .toggle-icon'),
        clearBtn: document.getElementById('filter-clear'),

        // Filter inputs
        warEligibleOnly: document.getElementById('filter-war-eligible-only'),
        nameSearch: document.getElementById('filter-name'),
        minCorpSize: document.getElementById('filter-min-corp-size'),
        minAllianceSize: document.getElementById('filter-min-alliance-size'),
        corporationSelect: document.getElementById('filter-corporation'),
        allianceSelect: document.getElementById('filter-alliance'),

        // Value displays
        corpSizeValue: document.getElementById('corp-size-value'),
        allianceSizeValue: document.getElementById('alliance-size-value'),
        resultsCount: document.getElementById('filter-results-count'),
    };
}

/**
 * Setup all event listeners
 */
function setupEventListeners() {
    if (!filterElements) return;

    // Toggle filters
    filterElements.toggleBtn?.addEventListener('click', toggleFilters);
    filterElements.clearBtn?.addEventListener('click', clearAllFilters);

    // War eligibility toggle
    filterElements.warEligibleOnly?.addEventListener('change', handleFilterChange);

    // Text search with debouncing
    filterElements.nameSearch?.addEventListener('input', debounce(handleFilterChange, 300));

    // Range sliders
    filterElements.minCorpSize?.addEventListener('input', handleRangeChange);
    filterElements.minAllianceSize?.addEventListener('input', handleRangeChange);

    // Dropdown filters
    filterElements.corporationSelect?.addEventListener('change', handleFilterChange);
    filterElements.allianceSelect?.addEventListener('change', handleFilterChange);
}

/**
 * Handle filter changes
 */
function handleFilterChange() {
    updateFilterState();
    applyFilters();
    updateResultsDisplay();

    // Notify app that filters have changed
    if (onFiltersChangeCallback) {
        onFiltersChangeCallback();
    }
}

/**
 * Handle range slider changes
 */
function handleRangeChange(event) {
    updateRangeValues();
    handleFilterChange();
}

/**
 * Update filter state from UI
 */
function updateFilterState() {
    if (!filterElements) return;

    filterState = {
        warEligibleOnly: filterElements.warEligibleOnly?.checked ?? false,
        nameSearch: filterElements.nameSearch?.value.toLowerCase().trim() ?? '',
        minCorpSize: parseInt(filterElements.minCorpSize?.value) ?? 1,
        minAllianceSize: parseInt(filterElements.minAllianceSize?.value) ?? 1,
        selectedCorporation: filterElements.corporationSelect?.value ?? '',
        selectedAlliance: filterElements.allianceSelect?.value ?? '',
        isCollapsed: filterState.isCollapsed
    };
}

/**
 * Apply filters to results
 */
function applyFilters() {
    if (!allResults.length) {
        filteredResults = [];
        return;
    }

    filteredResults = allResults.filter(character => {
        // War eligibility filter
        if (filterState.warEligibleOnly && !character.war_eligible) return false;

        // Name search filter
        if (filterState.nameSearch) {
            const searchLower = filterState.nameSearch;
            const nameMatch = character.character_name?.toLowerCase().includes(searchLower) ||
                            character.corporation_name?.toLowerCase().includes(searchLower) ||
                            character.alliance_name?.toLowerCase().includes(searchLower);
            if (!nameMatch) return false;
        }

        // Corporation filter
        if (filterState.selectedCorporation && character.corporation_id.toString() !== filterState.selectedCorporation) {
            return false;
        }

        // Alliance filter
        if (filterState.selectedAlliance && character.alliance_id?.toString() !== filterState.selectedAlliance) {
            return false;
        }

        // Corporation size filter
        const corpSize = getCorpSize(character.corporation_id);
        if (corpSize < filterState.minCorpSize) return false;

        // Alliance size filter (number of corporations in alliance)
        if (character.alliance_id) {
            const allianceSize = getAllianceSize(character.alliance_id);
            if (allianceSize < filterState.minAllianceSize) return false;
        }

        return true;
    });
}

/**
 * Get corporation size from our results data
 */
function getCorpSize(corporationId) {
    if (!allResults.length) return 1;

    const corpMembers = allResults.filter(char => char.corporation_id === corporationId);
    return corpMembers.length;
}

/**
 * Get alliance size (number of corporations) from our results data
 */
function getAllianceSize(allianceId) {
    if (!allResults.length) return 1;

    const uniqueCorps = new Set();
    allResults
        .filter(char => char.alliance_id === allianceId)
        .forEach(char => uniqueCorps.add(char.corporation_id));

    return uniqueCorps.size;
}


/**
 * Update range value displays
 */
function updateRangeValues() {
    if (!filterElements) return;

    if (filterElements.corpSizeValue && filterElements.minCorpSize) {
        const value = filterElements.minCorpSize.value;
        filterElements.corpSizeValue.textContent = value;
    }

    if (filterElements.allianceSizeValue && filterElements.minAllianceSize) {
        const value = filterElements.minAllianceSize.value;
        filterElements.allianceSizeValue.textContent = `${value} corps`;
    }
}

/**
 * Update results display with filter information
 */
function updateResultsDisplay() {
    if (!filterElements) return;

    const totalResults = allResults.length;
    const filteredCount = filteredResults.length;

    // Update filter results count
    if (filterElements.resultsCount) {
        if (filteredCount === totalResults) {
            filterElements.resultsCount.textContent = 'Showing all results';
        } else {
            filterElements.resultsCount.textContent = `Showing ${filteredCount} of ${totalResults} results`;
        }
    }

}

/**
 * Toggle filters section
 */
function toggleFilters() {
    if (!filterElements?.section) return;

    filterState.isCollapsed = !filterState.isCollapsed;

    if (filterState.isCollapsed) {
        collapseFilters();
    } else {
        expandFilters();
    }
}

/**
 * Collapse filters section
 */
function collapseFilters() {
    if (!filterElements) return;

    filterElements.section?.classList.add('collapsed');
    if (filterElements.toggleText) {
        filterElements.toggleText.textContent = 'Show Filters';
    }
}

/**
 * Expand filters section
 */
function expandFilters() {
    if (!filterElements) return;

    filterElements.section?.classList.remove('collapsed');
    if (filterElements.toggleText) {
        filterElements.toggleText.textContent = 'Hide Filters';
    }
}

/**
 * Clear all filters
 */
function clearAllFilters() {
    if (!filterElements) return;

    // Reset war eligibility toggle
    filterElements.warEligibleOnly.checked = false;

    // Clear text search
    filterElements.nameSearch.value = '';

    // Reset sliders to minimum values
    filterElements.minCorpSize.value = 1;
    filterElements.minAllianceSize.value = 1;

    // Reset dropdowns to "All" options
    filterElements.corporationSelect.value = '';
    filterElements.allianceSelect.value = '';

    // Update displays and apply filters
    updateRangeValues();
    handleFilterChange();
}

/**
 * Set results data for filtering
 */
export function setResultsData(results) {
    allResults = results || [];
    populateDropdowns(results);
    applyFilters();
    updateResultsDisplay();
}

/**
 * Populate corporation and alliance dropdowns
 */
function populateDropdowns(results) {
    if (!filterElements || !results.length) return;

    // Get unique corporations and alliances
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

    // Populate corporation dropdown
    if (filterElements.corporationSelect) {
        const corpSelect = filterElements.corporationSelect;

        // Clear existing options except "All Corporations"
        corpSelect.innerHTML = '<option value="">All Corporations</option>';

        // Sort corporations by name and add options
        const sortedCorps = Array.from(corporations.entries()).sort((a, b) => a[1].localeCompare(b[1]));
        sortedCorps.forEach(([id, name]) => {
            const option = document.createElement('option');
            option.value = id.toString();
            option.textContent = name;
            corpSelect.appendChild(option);
        });
    }

    // Populate alliance dropdown
    if (filterElements.allianceSelect) {
        const allianceSelect = filterElements.allianceSelect;

        // Clear existing options except "All Alliances"
        allianceSelect.innerHTML = '<option value="">All Alliances</option>';

        // Sort alliances by name and add options
        const sortedAlliances = Array.from(alliances.entries()).sort((a, b) => a[1].localeCompare(b[1]));
        sortedAlliances.forEach(([id, name]) => {
            const option = document.createElement('option');
            option.value = id.toString();
            option.textContent = name;
            allianceSelect.appendChild(option);
        });
    }
}

/**
 * Get filtered results
 */
export function getFilteredResults() {
    return filteredResults;
}

/**
 * Check if any filters are active
 */
export function hasActiveFilters() {
    return filterState.nameSearch ||
           filterState.warEligibleOnly ||
           filterState.minCorpSize > 1 ||
           filterState.minAllianceSize > 1 ||
           filterState.selectedCorporation ||
           filterState.selectedAlliance;
}

/**
 * Debounce function for performance
 */
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