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
    maxCorpSize: 500, // Will be updated from actual data
    minAllianceSize: 1,
    maxAllianceSize: 10000, // Will be updated from actual data
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
        maxCorpSize: document.getElementById('filter-max-corp-size'),
        minAllianceSize: document.getElementById('filter-min-alliance-size'),
        maxAllianceSize: document.getElementById('filter-max-alliance-size'),
        corporationSelect: document.getElementById('filter-corporation'),
        allianceSelect: document.getElementById('filter-alliance'),

        // Value displays
        minCorpSizeValue: document.getElementById('min-corp-size-value'),
        maxCorpSizeValue: document.getElementById('max-corp-size-value'),
        minAllianceSizeValue: document.getElementById('min-alliance-size-value'),
        maxAllianceSizeValue: document.getElementById('max-alliance-size-value'),
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
    filterElements.minCorpSize?.addEventListener('input', handleMinCorpSizeChange);
    filterElements.maxCorpSize?.addEventListener('input', handleMaxCorpSizeChange);
    filterElements.minAllianceSize?.addEventListener('input', handleMinAllianceSizeChange);
    filterElements.maxAllianceSize?.addEventListener('input', handleMaxAllianceSizeChange);

    // Dropdown filters
    filterElements.corporationSelect?.addEventListener('change', handleFilterChange);
    filterElements.allianceSelect?.addEventListener('change', handleAllianceChange);
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
 * Handle min corp size change with validation
 */
function handleMinCorpSizeChange() {
    filterState.minCorpSize = parseInt(filterElements.minCorpSize.value);
    filterElements.minCorpSizeValue.textContent = filterState.minCorpSize;

    // Ensure min doesn't exceed max
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

/**
 * Handle max corp size change with validation
 */
function handleMaxCorpSizeChange() {
    filterState.maxCorpSize = parseInt(filterElements.maxCorpSize.value);
    filterElements.maxCorpSizeValue.textContent = filterState.maxCorpSize;

    // Ensure max doesn't go below min
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

/**
 * Handle min alliance size change with validation
 */
function handleMinAllianceSizeChange() {
    filterState.minAllianceSize = parseInt(filterElements.minAllianceSize.value);
    filterElements.minAllianceSizeValue.textContent = filterState.minAllianceSize;

    // Ensure min doesn't exceed max
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

/**
 * Handle max alliance size change with validation
 */
function handleMaxAllianceSizeChange() {
    filterState.maxAllianceSize = parseInt(filterElements.maxAllianceSize.value);
    filterElements.maxAllianceSizeValue.textContent = filterState.maxAllianceSize;

    // Ensure max doesn't go below min
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

/**
 * Handle alliance change and update corporation dropdown
 */
function handleAllianceChange() {
    // Store current corporation selection
    const currentCorpSelection = filterElements.corporationSelect.value;

    // Update corporation dropdown based on selected alliance
    populateCorporationDropdown();

    // Check if the currently selected corporation is still available in the new dropdown
    const corpOptions = Array.from(filterElements.corporationSelect.options);
    const isCurrentCorpStillAvailable = corpOptions.some(option => option.value === currentCorpSelection);

    if (isCurrentCorpStillAvailable) {
        // Keep the corporation selection if it's still valid
        filterElements.corporationSelect.value = currentCorpSelection;
    } else {
        // Only reset if the corporation is not available in the new alliance
        filterElements.corporationSelect.value = '';
    }

    // Apply filters
    handleFilterChange();
}

/**
 * Populate corporation dropdown based on selected alliance
 */
function populateCorporationDropdown() {
    if (!filterElements.corporationSelect || !allResults.length) return;

    const corpSelect = filterElements.corporationSelect;
    const selectedAllianceId = filterElements.allianceSelect?.value;

    // Clear existing options
    corpSelect.innerHTML = '<option value="">All Corporations</option>';

    // Get corporations data
    const corporations = new Map();
    allResults.forEach(character => {
        if (character.corporation_id && character.corporation_name) {
            // If an alliance is selected, only include corps from that alliance
            if (selectedAllianceId) {
                if (character.alliance_id && character.alliance_id.toString() === selectedAllianceId) {
                    corporations.set(character.corporation_id, character.corporation_name);
                }
            } else {
                // If no alliance selected, include all corporations
                corporations.set(character.corporation_id, character.corporation_name);
            }
        }
    });

    // Sort corporations by name and add options
    const sortedCorps = Array.from(corporations.entries()).sort((a, b) => a[1].localeCompare(b[1]));
    sortedCorps.forEach(([id, name]) => {
        const option = document.createElement('option');
        option.value = id.toString();
        option.textContent = name;
        corpSelect.appendChild(option);
    });
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
        maxCorpSize: parseInt(filterElements.maxCorpSize?.value) ?? 500,
        minAllianceSize: parseInt(filterElements.minAllianceSize?.value) ?? 1,
        maxAllianceSize: parseInt(filterElements.maxAllianceSize?.value) ?? 10000,
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
        if (corpSize < filterState.minCorpSize || corpSize > filterState.maxCorpSize) return false;

        // Alliance size filter (total members in alliance)
        if (character.alliance_id) {
            const allianceSize = getAllianceMemberCount(character.alliance_id);
            if (allianceSize < filterState.minAllianceSize || allianceSize > filterState.maxAllianceSize) return false;
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
 * Get alliance size (total member count) from our results data
 */
function getAllianceMemberCount(allianceId) {
    if (!allResults.length) return 1;

    const allianceMembers = allResults.filter(char => char.alliance_id === allianceId);
    return allianceMembers.length;
}


/**
 * Update range value displays
 */
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
        filterElements.toggleText.textContent = 'Show';
    }
}

/**
 * Expand filters section
 */
function expandFilters() {
    if (!filterElements) return;

    filterElements.section?.classList.remove('collapsed');
    if (filterElements.toggleText) {
        filterElements.toggleText.textContent = 'Hide';
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

    // Reset sliders to minimum/maximum values
    filterElements.minCorpSize.value = 1;
    filterElements.maxCorpSize.value = filterElements.maxCorpSize.max;
    filterElements.minAllianceSize.value = 1;
    filterElements.maxAllianceSize.value = filterElements.maxAllianceSize.max;

    // Reset dropdowns to "All" options
    filterElements.allianceSelect.value = '';
    filterElements.corporationSelect.value = '';

    // Repopulate corporation dropdown (since alliance selection was cleared)
    populateCorporationDropdown();

    // Update displays and apply filters
    updateRangeValues();
    handleFilterChange();
}

/**
 * Set results data for filtering
 */
export function setResultsData(results) {
    allResults = results || [];
    updateSliderMaximums(results);
    populateDropdowns(results);
    applyFilters();
    updateResultsDisplay();
}

/**
 * Update slider maximum values based on actual data
 */
function updateSliderMaximums(results) {
    if (!results || !results.length || !filterElements) return;

    // Calculate max corporation size
    const corpSizes = new Map();
    results.forEach(char => {
        const corpId = char.corporation_id;
        corpSizes.set(corpId, (corpSizes.get(corpId) || 0) + 1);
    });
    const maxCorpSize = Math.max(...corpSizes.values());

    // Calculate max alliance size (total members)
    const allianceSizes = new Map();
    results.forEach(char => {
        if (char.alliance_id) {
            const allianceId = char.alliance_id;
            allianceSizes.set(allianceId, (allianceSizes.get(allianceId) || 0) + 1);
        }
    });
    const maxAllianceSize = allianceSizes.size > 0 ? Math.max(...allianceSizes.values()) : 1;

    // Update slider max attributes
    if (filterElements.minCorpSize && filterElements.maxCorpSize) {
        filterElements.minCorpSize.max = maxCorpSize;
        filterElements.maxCorpSize.max = maxCorpSize;
        // Update max corp size value if it exceeds new maximum
        if (filterState.maxCorpSize > maxCorpSize) {
            filterState.maxCorpSize = maxCorpSize;
            filterElements.maxCorpSize.value = maxCorpSize;
            filterElements.maxCorpSizeValue.textContent = maxCorpSize;
        }
    }

    if (filterElements.minAllianceSize && filterElements.maxAllianceSize) {
        filterElements.minAllianceSize.max = maxAllianceSize;
        filterElements.maxAllianceSize.max = maxAllianceSize;
        // Update max alliance size value if it exceeds new maximum
        if (filterState.maxAllianceSize > maxAllianceSize) {
            filterState.maxAllianceSize = maxAllianceSize;
            filterElements.maxAllianceSize.value = maxAllianceSize;
            filterElements.maxAllianceSizeValue.textContent = maxAllianceSize;
        }
    }
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

    // Populate corporation dropdown (initially with all corporations)
    populateCorporationDropdown();

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
 * Get filtered alliance results
 */
export function getFilteredAlliances(allAlliances) {
    if (!allAlliances || !allAlliances.length) return [];

    return allAlliances.filter(alliance => {
        // War eligibility filter
        if (filterState.warEligibleOnly && !alliance.war_eligible) return false;

        // Name search filter
        if (filterState.nameSearch) {
            const searchLower = filterState.nameSearch;
            const nameMatch = alliance.name?.toLowerCase().includes(searchLower);
            if (!nameMatch) return false;
        }

        // Alliance size filter
        if (alliance.count < filterState.minAllianceSize || alliance.count > filterState.maxAllianceSize) return false;

        // Specific alliance filter (if a specific alliance is selected, only show that one)
        if (filterState.selectedAlliance && alliance.id.toString() !== filterState.selectedAlliance) {
            return false;
        }

        // Corporation filter (if a corporation is selected, only show the alliance that corporation belongs to)
        if (filterState.selectedCorporation) {
            // Find the alliance ID for the selected corporation by checking character data
            const corpMembers = allResults.filter(char => char.corporation_id.toString() === filterState.selectedCorporation);
            const corpAllianceId = corpMembers.length > 0 ? corpMembers[0].alliance_id : null;

            // If the corporation has no alliance, don't show any alliances
            if (!corpAllianceId) return false;

            // Only show the alliance that this corporation belongs to
            if (alliance.id.toString() !== corpAllianceId.toString()) {
                return false;
            }
        }

        return true;
    });
}

/**
 * Get filtered corporation results
 */
export function getFilteredCorporations(allCorporations) {
    if (!allCorporations || !allCorporations.length) return [];

    return allCorporations.filter(corporation => {
        // War eligibility filter
        if (filterState.warEligibleOnly && !corporation.war_eligible) return false;

        // Name search filter
        if (filterState.nameSearch) {
            const searchLower = filterState.nameSearch;
            const nameMatch = corporation.name?.toLowerCase().includes(searchLower);
            if (!nameMatch) return false;
        }

        // Corporation size filter
        if (corporation.count < filterState.minCorpSize || corporation.count > filterState.maxCorpSize) return false;

        // Specific corporation filter (if a specific corporation is selected, only show that one)
        if (filterState.selectedCorporation && corporation.id.toString() !== filterState.selectedCorporation) {
            return false;
        }

        // Alliance filter (if an alliance is selected, only show corporations from that alliance)
        if (filterState.selectedAlliance) {
            // Find the alliance ID for this corporation by checking character data
            const corpMembers = allResults.filter(char => char.corporation_id === corporation.id);
            const corpAllianceId = corpMembers.length > 0 ? corpMembers[0].alliance_id : null;
            if (corpAllianceId?.toString() !== filterState.selectedAlliance) {
                return false;
            }
        }

        return true;
    });
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