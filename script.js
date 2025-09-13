/*
    War Target Finder - find highsec war targets in EVE Online
    
    Copyright (C) 2025 moregh (https://github.com/moregh/)

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as
    published by the Free Software Foundation, either version 3 of the
    License, or (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>. 
*/

// configuration
const CACHE_EXPIRY_HOURS = 12;              // cache all data for this long
const LONG_CACHE_EXPIRY_HOURS = 168;        // cache 'static' data for this long
const INITIAL_USER_RESULTS_COUNT = 6;       // initial number of user results to show
const INITIAL_CORP_ALLIANCE_COUNT = 5;      // initial number of corps/alliances to show
const LOAD_MORE_COUNT = 12;                 // number of results to load when "Load More" is clicked
const MAX_ESI_CALL_SIZE = 100;              // max number of names/IDs per ESI call
const MAX_CONCURRENT_IMAGES = 8;            // max concurrent image loads
const CHUNK_SIZE = 50;                      // Process corporations/alliances in chunks of 50
const CHUNK_DELAY = 25;                     // 25ms delay between chunks to be nice to ESI
const STATS_UPDATE_DELAY = 100;             // Delay stats update until results are available
const DB_NAME = 'EVEWarTargetCache';        // IndexedDB name
const DB_VERSION = 1;                       // Track DB version for upgrades
const VERSION = "0.3.2";                    // Current version


// ========== TIME AND THROTTLING ==========
const PROGRESS_UPDATE_THROTTLE_MS = 50;           // Line: lastProgressUpdate < 50
const TIMER_UPDATE_INTERVAL_MS = 100;             // Line: setInterval(updateTimer, 100)
const TIMER_UPDATE_THROTTLE_MS = 100;             // Line: now - lastTimerUpdate < 100
const LOADING_DISPLAY_DELAY_MS = 300;             // Line: setTimeout(() => { rs.classList.add("show"); }, 300)
const LOADING_HIDE_DELAY_MS = 500;                // Line: setTimeout(() => { lc.style.display = 'none'; }, 500)
const CHARACTER_COUNT_DEBOUNCE_MS = 150;          // Line: setTimeout(() => { updateCharacterCount(); }, 150)
const SCROLL_STATE_TIMEOUT_MS = 150;              // Line: setTimeout(() => { ... }, 150)
const SCROLL_THROTTLE_MS = 8;                     // Line: setTimeout(() => { ... }, 8)
const ANIMATION_FRAME_THROTTLE_FPS = 16;          // Line: now - lastScrollTime > 16

// ========== CHARACTER VALIDATION ==========
const MIN_CHARACTER_NAME_LENGTH = 3;             // Line: name.length < 3
const MAX_CHARACTER_NAME_LENGTH = 37;            // Line: name.length > 37
const MAX_SINGLE_NAME_LENGTH = 24;               // Line: name.length > 24
const MAX_FAMILY_NAME_LENGTH = 12;               // Line: familyName.length > 12
const MAX_FIRST_MIDDLE_NAME_LENGTH = 24;         // Line: firstAndMiddle.length > 24

// ========== UI DIMENSIONS AND LAYOUT ==========
const VIRTUAL_SCROLL_BUFFER_ITEMS = 5;           // Line: const buffer = 5
const GRID_VIEW_ITEM_HEIGHT_PX = 150;            // Line: const itemHeight = isListView ? 90 : 150
const LIST_VIEW_ITEM_HEIGHT_PX = 90;             // Line: const itemHeight = isListView ? 90 : 150
const MIN_CONTAINER_WIDTH_PX = 270;              // Line: Math.max(270, parentGrid.clientWidth - 60)
const CONTAINER_PADDING_PX = 60;                 // Line: parentGrid.clientWidth - 60
const MIN_GRID_ITEM_WIDTH_PX = 270;              // Line: Math.floor(containerWidth / 270)
const VIRTUAL_SCROLL_MIN_HEIGHT_PX = 300;        // Line: container.style.minHeight = '300px'
const VIRTUAL_SCROLL_MAX_HEIGHT_PX = 600;        // Line: container.style.maxHeight = '600px'
const USER_NOTIFICATION_DISPLAY_MS = 1500;

// ========== IMAGE SIZES ==========
const CHARACTER_PORTRAIT_SIZE_PX = 64;           // Line: portrait?size=64
const CORP_LOGO_SIZE_PX = 32;                    // Line: logo?size=32
const ALLIANCE_LOGO_SIZE_PX = 32;                // Line: logo?size=32
const MOUSEOVER_CARD_AVATAR_SIZE_PX = 32;        // Line: portrait?size=32 (in mouseover)
const MOUSEOVER_CARD_MAX_ITEMS = 10;             // Line: const maxItems = 10

// ========== PERFORMANCE CONFIGURATION ==========
const INTERSECTION_OBSERVER_THROTTLE_MS = 50;    // Line: if (now - lastProgressUpdate < 50)
const BATCH_OPERATION_SIZE = 20;                 // Line: BATCH_SIZE: 20
const MAX_ELEMENT_POOL_SIZE = 50;                // Line: MAX_ELEMENT_POOL_SIZE: 50
const VIRTUAL_SCROLL_BUFFER_SIZE = 10;           // Line: VIRTUAL_SCROLL_BUFFER: 10
const OBSERVER_THROTTLE_MS = 50;                 // Line: OBSERVER_THROTTLE: 50



// Performance configuration
const PERFORMANCE_CONFIG = {
    VIRTUAL_SCROLL_BUFFER: 10, // Reduced from 20
    ANIMATION_FRAME_THROTTLE: 8, // Increased frequency
    OBSERVER_THROTTLE: 50,
    MAX_ELEMENT_POOL_SIZE: 50,
    BATCH_SIZE: 20, // For batch DOM operations
    IMAGE_INTERSECTION_MARGIN: '50px', // Reduced margin
    ANIMATION_INTERSECTION_MARGIN: '20px'
};

// program constants
const ESI_BASE = "https://esi.evetech.net/latest";
const USER_AGENT = `WarTargetFinder/${VERSION} (+https://github.com/moregh/moregh.github.io/)`;
const ESI_HEADERS = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'User-Agent': USER_AGENT,
    'X-User-Agent': `WarTargetFinder/${VERSION}`
};

// program caches
const corporationInfoCache = new Map();
const allianceInfoCache = new Map();
const characterNameToIdCache = new Map();
const characterAffiliationCache = new Map();

// program variables
let queryStartTime = 0;
let queryEndTime = 0;
let esiLookups = 0;
let localLookups = 0;
let dbInstance = null;

let timerInterval = null
let startTime = 0;
let currentView = 'grid';
let allResults = { eligible: [], ineligible: [] };
let displayedResults = { eligible: 0, ineligible: 0 };
let expandedSections = { eligible: false, ineligible: false };

// Summary data and display tracking
let allSummaryData = { alliance: [], corporation: [] };
let displayedSummaryResults = { alliance: 0, corporation: 0 };
let expandedSummarySections = { alliance: false, corporation: false };

// Store complete results for mouseover functionality
let completeResults = [];
let corpToCharactersMap = new Map();
let allianceToCorpsMap = new Map();

class ManagedObservers {
    constructor() {
        this.imageObserver = null;
        this.animationObserver = null;
        this.observedImages = new Set();
        this.observedAnimations = new Set();
        this.pendingImageObservations = [];
        this.pendingAnimationObservations = [];
        this.batchTimeout = null;
    }

    getImageObserver() {
        if (!this.imageObserver) {
            this.imageObserver = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const img = entry.target;
                        if (img.dataset.src && !img.src.startsWith('https://') && document.contains(img)) {
                            img.dataset.loading = 'true';
                            imageLoadQueue.push(img);
                            this.imageObserver.unobserve(img);
                            this.observedImages.delete(img);
                            processImageQueue();
                        }
                    }
                });
            }, {
                rootMargin: PERFORMANCE_CONFIG.IMAGE_INTERSECTION_MARGIN,
                threshold: 0.1
            });
        }
        return this.imageObserver;
    }

    getAnimationObserver() {
        if (!this.animationObserver) {
            this.animationObserver = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting && document.contains(entry.target)) {
                        entry.target.classList.add('animate-in');
                        this.animationObserver.unobserve(entry.target);
                        this.observedAnimations.delete(entry.target);
                    }
                });
            }, {
                rootMargin: PERFORMANCE_CONFIG.ANIMATION_INTERSECTION_MARGIN,
                threshold: 0.01
            });
        }
        return this.animationObserver;
    }

    // Batch observe operations for better performance
    observeImage(img) {
        if (!img || this.observedImages.has(img) || !document.contains(img)) return;
        
        this.pendingImageObservations.push(img);
        this.scheduleBatchProcess();
    }

    observeAnimation(element) {
        if (!element || this.observedAnimations.has(element) || !document.contains(element)) return;
        
        this.pendingAnimationObservations.push(element);
        this.scheduleBatchProcess();
    }

    scheduleBatchProcess() {
        if (this.batchTimeout) return;
        
        this.batchTimeout = requestAnimationFrame(() => {
            this.processBatches();
            this.batchTimeout = null;
        });
    }

    processBatches() {
        // Process image observations in batches
        const imageBatches = this.chunkArray(this.pendingImageObservations, PERFORMANCE_CONFIG.BATCH_SIZE);
        imageBatches.forEach(batch => {
            batch.forEach(img => {
                if (document.contains(img) && !this.observedImages.has(img)) {
                    try {
                        this.getImageObserver().observe(img);
                        this.observedImages.add(img);
                    } catch (error) {
                        console.warn('Failed to observe image:', error);
                    }
                }
            });
        });

        // Process animation observations in batches
        const animationBatches = this.chunkArray(this.pendingAnimationObservations, PERFORMANCE_CONFIG.BATCH_SIZE);
        animationBatches.forEach(batch => {
            batch.forEach(element => {
                if (document.contains(element) && !this.observedAnimations.has(element)) {
                    try {
                        this.getAnimationObserver().observe(element);
                        this.observedAnimations.add(element);
                    } catch (error) {
                        console.warn('Failed to observe animation element:', error);
                    }
                }
            });
        });

        // Clear pending arrays
        this.pendingImageObservations = [];
        this.pendingAnimationObservations = [];
    }

    chunkArray(array, chunkSize) {
        const chunks = [];
        for (let i = 0; i < array.length; i += chunkSize) {
            chunks.push(array.slice(i, i + chunkSize));
        }
        return chunks;
    }

    cleanup() {
        if (this.batchTimeout) {
            cancelAnimationFrame(this.batchTimeout);
            this.batchTimeout = null;
        }

        // Clear pending operations
        this.pendingImageObservations = [];
        this.pendingAnimationObservations = [];

        // Existing cleanup code...
        this.observedImages.forEach(img => {
            try { this.imageObserver?.unobserve(img); } catch (e) { }
        });
        this.observedAnimations.forEach(element => {
            try { this.animationObserver?.unobserve(element); } catch (e) { }
        });

        this.imageObserver?.disconnect();
        this.animationObserver?.disconnect();

        this.imageObserver = null;
        this.animationObserver = null;
        this.observedImages.clear();
        this.observedAnimations.clear();
    }

    cleanupDeadElements() {
        for (const img of this.observedImages) {
            if (!document.contains(img)) {
                this.imageObserver?.unobserve(img);
                this.observedImages.delete(img);
            }
        }
        for (const element of this.observedAnimations) {
            if (!document.contains(element)) {
                this.animationObserver?.unobserve(element);
                this.observedAnimations.delete(element);
            }
        }
    }
}

// Create single instance
const observerManager = new ManagedObservers();

async function initDB() {
    if (dbInstance) return dbInstance;

    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => {
            showError(`Failed to open IndexedDB: ${request.error}`);
            console.error('Failed to open IndexedDB:', request.error);
            reject(request.error);
        };

        request.onsuccess = () => {
            dbInstance = request.result;
            resolve(dbInstance);
        };

        request.onupgradeneeded = (event) => {
            const db = event.target.result;

            // Character name to ID mapping table
            if (!db.objectStoreNames.contains('character_names')) {
                const nameStore = db.createObjectStore('character_names', { keyPath: 'name_lower' });
                nameStore.createIndex('timestamp', 'timestamp');
            }

            // Character affiliations table
            if (!db.objectStoreNames.contains('character_affiliations')) {
                const affiliationStore = db.createObjectStore('character_affiliations', { keyPath: 'character_id' });
                affiliationStore.createIndex('timestamp', 'timestamp');
            }

            // Corporation info table
            if (!db.objectStoreNames.contains('corporations')) {
                const corpStore = db.createObjectStore('corporations', { keyPath: 'corporation_id' });
                corpStore.createIndex('timestamp', 'timestamp');
            }

            // Alliance info table
            if (!db.objectStoreNames.contains('alliances')) {
                const allianceStore = db.createObjectStore('alliances', { keyPath: 'alliance_id' });
                allianceStore.createIndex('timestamp', 'timestamp');
            }
        };
    });
}

// Helper function to check if data is expired
function isExpired(timestamp) {
    const now = Date.now();
    const expiryTime = timestamp + (CACHE_EXPIRY_HOURS * 60 * 60 * 1000);
    return now > expiryTime;
}


function collapseInputSection() {
    const inputSection = document.getElementById('input-section');
    inputSection.classList.add('collapsed');
}

function expandInputSection() {
    const inputSection = document.getElementById('input-section');
    inputSection.classList.remove('collapsed');
}


// Event delegation handler
document.addEventListener('click', function (event) {
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
            }, 300);
            break;
    }
});

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

async function getCachedNameToId(name) {
    try {
        const db = await initDB();
        const transaction = db.transaction(['character_names'], 'readonly');
        const store = transaction.objectStore('character_names');

        return new Promise((resolve) => {
            const request = store.get(name.toLowerCase());

            request.onsuccess = () => {
                const result = request.result;
                if (!result || isExpired(result.timestamp)) {
                    resolve(null);
                    return;
                }

                resolve({
                    id: result.character_id,
                    name: result.character_name
                });
            };

            request.onerror = () => {
                console.warn(`Error reading name cache for ${name}:`, request.error);
                resolve(null);
            };
        });
    } catch (e) {
        console.warn(`Error accessing name cache for ${name}:`, e);
        return null;
    }
}

async function getCachedAffiliation(characterId) {
    try {
        const db = await initDB();
        const transaction = db.transaction(['character_affiliations'], 'readonly');
        const store = transaction.objectStore('character_affiliations');

        return new Promise((resolve) => {
            const request = store.get(characterId);

            request.onsuccess = () => {
                const result = request.result;
                if (!result || isExpired(result.timestamp)) {
                    resolve(null);
                    return;
                }

                resolve({
                    character_id: result.character_id,
                    corporation_id: result.corporation_id,
                    alliance_id: result.alliance_id
                });
            };

            request.onerror = () => {
                console.warn(`Error reading affiliation cache for ${characterId}:`, request.error);
                resolve(null);
            };
        });
    } catch (e) {
        console.warn(`Error accessing affiliation cache for ${characterId}:`, e);
        return null;
    }
}

async function setCachedNameToId(name, characterData) {
    try {
        const db = await initDB();
        const transaction = db.transaction(['character_names'], 'readwrite');
        const store = transaction.objectStore('character_names');

        const cacheData = {
            name_lower: name.toLowerCase(),
            character_id: characterData.id,
            character_name: characterData.name,
            timestamp: Date.now()
        };

        store.put(cacheData);

        // Also update in-memory cache
        characterNameToIdCache.set(name.toLowerCase(), {
            id: characterData.id,
            name: characterData.name
        });
    } catch (e) {
        console.warn(`Error writing name cache for ${name}:`, e);
    }
}

async function setCachedAffiliation(characterId, affiliationData) {
    try {
        const db = await initDB();
        const transaction = db.transaction(['character_affiliations'], 'readwrite');
        const store = transaction.objectStore('character_affiliations');

        const cacheData = {
            character_id: characterId,
            corporation_id: affiliationData.corporation_id,
            alliance_id: affiliationData.alliance_id || null,
            timestamp: Date.now()
        };

        store.put(cacheData);

        // Also update in-memory cache
        characterAffiliationCache.set(characterId, affiliationData);
    } catch (e) {
        console.warn(`Error writing affiliation cache for ${characterId}:`, e);
    }
}

async function getCachedCorporationInfo(corporationId) {
    try {
        const db = await initDB();
        const transaction = db.transaction(['corporations'], 'readonly');
        const store = transaction.objectStore('corporations');

        return new Promise((resolve) => {
            const request = store.get(corporationId);

            request.onsuccess = () => {
                const result = request.result;
                if (!result || isExpired(result.timestamp)) {
                    resolve(null);
                    return;
                }

                resolve({
                    name: result.name,
                    war_eligible: result.war_eligible
                });
            };

            request.onerror = () => {
                console.warn(`Error reading corporation cache for ${corporationId}:`, request.error);
                resolve(null);
            };
        });
    } catch (e) {
        console.warn(`Error accessing corporation cache for ${corporationId}:`, e);
        return null;
    }
}

async function setCachedCorporationInfo(corporationId, corporationData) {
    try {
        const db = await initDB();
        const transaction = db.transaction(['corporations'], 'readwrite');
        const store = transaction.objectStore('corporations');

        const cacheData = {
            corporation_id: corporationId,
            name: corporationData.name,
            war_eligible: corporationData.war_eligible,
            timestamp: Date.now()
        };

        store.put(cacheData);

        corporationInfoCache.set(corporationId, corporationData);
    } catch (e) {
        console.warn(`Error writing corporation cache for ${corporationId}:`, e);
    }
}

async function getCachedAllianceInfo(allianceId) {
    try {
        const db = await initDB();
        const transaction = db.transaction(['alliances'], 'readonly');
        const store = transaction.objectStore('alliances');

        return new Promise((resolve) => {
            const request = store.get(allianceId);

            request.onsuccess = () => {
                const result = request.result;
                if (!result || isExpired(result.timestamp)) {
                    resolve(null);
                    return;
                }

                resolve({
                    name: result.name
                });
            };

            request.onerror = () => {
                console.warn(`Error reading alliance cache for ${allianceId}:`, request.error);
                resolve(null);
            };
        });
    } catch (e) {
        console.warn(`Error accessing alliance cache for ${allianceId}:`, e);
        return null;
    }
}


async function setCachedAllianceInfo(allianceId, allianceData) {
    try {
        const db = await initDB();
        const transaction = db.transaction(['alliances'], 'readwrite');
        const store = transaction.objectStore('alliances');

        const cacheData = {
            alliance_id: allianceId,
            name: allianceData.name,
            timestamp: Date.now()
        };

        store.put(cacheData);

        // Also update in-memory cache
        allianceInfoCache.set(allianceId, allianceData);
    } catch (e) {
        console.warn(`Error writing alliance cache for ${allianceId}:`, e);
    }
}



// Fixed cache cleanup function
async function clearExpiredCache() {
    try {
        const db = await initDB();
        if (!db) {
            console.warn('IndexedDB not available, skipping cache cleanup');
            return;
        }

        const now = Date.now();
        const shortExpiryMs = CACHE_EXPIRY_HOURS * 60 * 60 * 1000;
        const longExpiryMs = LONG_CACHE_EXPIRY_HOURS * 60 * 60 * 1000;

        // Clear expired affiliations (short-term)
        try {
            const affiliationTransaction = db.transaction(['character_affiliations'], 'readwrite');
            const affiliationStore = affiliationTransaction.objectStore('character_affiliations');
            const affiliationIndex = affiliationStore.index('timestamp');

            const affiliationRange = IDBKeyRange.upperBound(now - shortExpiryMs);
            const affiliationRequest = affiliationIndex.openCursor(affiliationRange);

            affiliationRequest.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    cursor.delete();
                    cursor.continue();
                }
            };

            affiliationRequest.onerror = () => {
                console.warn('Error clearing expired affiliations:', affiliationRequest.error);
            };
        } catch (e) {
            console.warn('Error setting up affiliation cleanup:', e);
        }

        // Clear expired names (long-term)
        try {
            const nameTransaction = db.transaction(['character_names'], 'readwrite');
            const nameStore = nameTransaction.objectStore('character_names');
            const nameIndex = nameStore.index('timestamp');

            const nameRange = IDBKeyRange.upperBound(now - longExpiryMs);
            const nameRequest = nameIndex.openCursor(nameRange);

            nameRequest.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    cursor.delete();
                    cursor.continue();
                }
            };

            nameRequest.onerror = () => {
                console.warn('Error clearing expired names:', nameRequest.error);
            };
        } catch (e) {
            console.warn('Error setting up name cleanup:', e);
        }

        // Clear expired alliances (long-term)
        try {
            const allianceTransaction = db.transaction(['alliances'], 'readwrite');
            const allianceStore = allianceTransaction.objectStore('alliances');
            const allianceIndex = allianceStore.index('timestamp');

            const allianceRange = IDBKeyRange.upperBound(now - longExpiryMs);
            const allianceRequest = allianceIndex.openCursor(allianceRange);

            allianceRequest.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    cursor.delete();
                    cursor.continue();
                }
            };

            allianceRequest.onerror = () => {
                console.warn('Error clearing expired alliances:', allianceRequest.error);
            };
        } catch (e) {
            console.warn('Error setting up alliance cleanup:', e);
        }

        // Handle corporations with dual timestamps (more complex)
        try {
            const corpTransaction = db.transaction(['corporations'], 'readwrite');
            const corpStore = corpTransaction.objectStore('corporations');
            const corpCursor = corpStore.openCursor();

            corpCursor.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    const record = cursor.value;
                    const nameExpired = isExpired(record.name_timestamp || record.timestamp, true);
                    const warExpired = isExpired(record.war_eligible_timestamp || record.timestamp, false);

                    if (nameExpired) {
                        // If name is expired, delete entire record
                        cursor.delete();
                    } else if (warExpired && record.war_eligible_timestamp) {
                        // If only war eligibility is expired, update record to remove war_eligible
                        const updatedRecord = { ...record };
                        delete updatedRecord.war_eligible;
                        delete updatedRecord.war_eligible_timestamp;
                        cursor.update(updatedRecord);
                    }
                    cursor.continue();
                }
            };

            corpCursor.onerror = () => {
                console.warn('Error clearing expired corporations:', corpCursor.error);
            };
        } catch (e) {
            console.warn('Error setting up corporation cleanup:', e);
        }


    } catch (e) {
        console.warn('Error during cache cleanup:', e);
    }
}
clearExpiredCache();

function clientValidate(name) {
    name = name.trim();
    if (name.length < MIN_CHARACTER_NAME_LENGTH || name.length > MAX_CHARACTER_NAME_LENGTH) return false;
    let pattern = /^[A-Za-z0-9.''-]+( [A-Za-z0-9.''-]+)*$/;
    if (!pattern.test(name)) return false;
    if (/^[ '-]|[ '-]$/.test(name)) return false;
    let parts = name.split(" ");
    if (parts.length === 1 && name.length > MAX_SINGLE_NAME_LENGTH) return false;
    if (parts.length > 1) {
        let firstAndMiddle = parts.slice(0, -1).join(" ");
        let familyName = parts[parts.length - 1];
        if (firstAndMiddle.length > MAX_FIRST_MIDDLE_NAME_LENGTH || familyName.length > MAX_FAMILY_NAME_LENGTH) return false;
    }
    return true;
}

async function getCharacterIds(names) {
    const cachedCharacters = [];
    const uncachedNames = [];

    // First, check cache for all names
    for (const name of names) {
        const lowerName = name.toLowerCase();
        if (characterNameToIdCache.has(lowerName)) {
            cachedCharacters.push(characterNameToIdCache.get(lowerName));
            continue;
        }

        const cached = await getCachedNameToId(name);
        if (cached) {
            characterNameToIdCache.set(lowerName, cached);
            cachedCharacters.push(cached);
            continue;
        }

        uncachedNames.push(name);
    }

    let fetchedCharacters = [];

    if (uncachedNames.length > 0) {
        // Process uncached names in chunks
        updateProgress(0, uncachedNames.length, `Looking up ${uncachedNames.length} character names...`);

        fetchedCharacters = await processInChunks(
            chunkArray(uncachedNames, MAX_ESI_CALL_SIZE),
            async (nameChunk, index, totalChunks) => {
                esiLookups++;
                updateProgress(index * MAX_ESI_CALL_SIZE, uncachedNames.length,
                    `Looking up character names (batch ${index + 1}/${totalChunks})...`);

                const res = await fetch(`${ESI_BASE}/universe/ids/`, {
                    method: 'POST',
                    headers: ESI_HEADERS,
                    body: JSON.stringify(nameChunk)
                });

                if (!res.ok) {
                    throw new Error(`Failed to get character IDs for batch ${index + 1}: ${res.status}`);
                }

                const data = await res.json();
                const characters = data.characters || [];

                // Cache each character immediately
                for (const char of characters) {
                    await setCachedNameToId(char.name, char);
                }

                return characters;
            },
            MAX_ESI_CALL_SIZE,
            CHUNK_DELAY
        );

        // Flatten the results (each chunk returns an array of characters)
        fetchedCharacters = fetchedCharacters.flat().filter(char => char !== null);
    }

    return [...cachedCharacters, ...fetchedCharacters];
}

function chunkArray(array, chunkSize) {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
        chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
}


async function getCharacterAffiliations(characterIds) {
    const cachedAffiliations = [];
    const uncachedIds = [];

    // Check cache first
    for (const id of characterIds) {
        if (characterAffiliationCache.has(id)) {
            cachedAffiliations.push(characterAffiliationCache.get(id));
            continue;
        }

        const cached = await getCachedAffiliation(id);
        if (cached) {
            characterAffiliationCache.set(id, cached);
            cachedAffiliations.push(cached);
            continue;
        }

        uncachedIds.push(id);
    }

    let fetchedAffiliations = [];

    if (uncachedIds.length > 0) {
        // Process uncached IDs in chunks to respect ESI limits
        updateProgress(0, uncachedIds.length, `Getting character affiliations...`);

        fetchedAffiliations = await processInChunks(
            chunkArray(uncachedIds, MAX_ESI_CALL_SIZE),
            async (idChunk, index, totalChunks) => {
                esiLookups++;
                updateProgress(index * MAX_ESI_CALL_SIZE, uncachedIds.length,
                    `Getting character affiliations (batch ${index + 1}/${totalChunks})...`);

                const res = await fetch(`${ESI_BASE}/characters/affiliation/`, {
                    method: 'POST',
                    headers: ESI_HEADERS,
                    body: JSON.stringify(idChunk)
                });

                if (!res.ok) {
                    throw new Error(`Failed to get character affiliations for batch ${index + 1}: ${res.status}`);
                }

                const affiliations = await res.json();

                // Cache each affiliation immediately
                for (const affiliation of affiliations) {
                    await setCachedAffiliation(affiliation.character_id, affiliation);
                }

                return affiliations;
            },
            MAX_ESI_CALL_SIZE,
            CHUNK_DELAY
        );

        // Flatten the results (each chunk returns an array of affiliations)
        fetchedAffiliations = fetchedAffiliations.flat().filter(affiliation => affiliation !== null);
    }

    return [...cachedAffiliations, ...fetchedAffiliations];
}

async function processInChunks(items, processFn, chunkSize = CHUNK_SIZE, delay = CHUNK_DELAY) {
    const results = [];
    const totalChunks = items.length;

    for (let i = 0; i < items.length; i++) {
        const item = items[i];

        try {
            // Pass chunk index and total chunks to the processor function
            const result = await processFn(item, i, totalChunks);
            if (result !== null && result !== undefined) {
                if (Array.isArray(result)) {
                    results.push(...result);
                } else {
                    results.push(result);
                }
            }
        } catch (e) {
            showWarning(`Error processing chunk ${i + 1}/${totalChunks}: ${e}`);
            console.error(`Error processing chunk ${i + 1}/${totalChunks}:`, e);
            // For character ID lookups, we want to continue even if one chunk fails
            // Return empty array for failed chunks
            if (processFn.name === 'getCharacterIdChunk' || e.message.includes('character IDs')) {
                results.push([]);
            } else {
                results.push(null);
            }
        }

        // Small delay between chunks
        if (i + 1 < items.length && delay > 0) {
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    return results;
}

// Function to handle missing character warnings
async function handleMissingCharacters(characters, originalNames) {
    if (characters.length !== originalNames.length) {
        const foundNames = new Set(characters.map(c => c.name.toLowerCase()));
        const missingNames = originalNames.filter(name => !foundNames.has(name.toLowerCase()));
        console.warn(`Could not find ${missingNames.length} character(s):`, missingNames);

        if (missingNames.length > 0) {
            updateProgress(0, 0, `Warning: ${missingNames.length} character names not found`);
            await new Promise(resolve => setTimeout(resolve, USER_NOTIFICATION_DISPLAY_MS));
        }
    }
}

// Function to get corporation information with smart caching
async function getCorporationInfoWithCaching(uniqueCorpIds) {
    updateProgress(0, uniqueCorpIds.length, "Getting corporation information...");

    // Step 1: Check which corps need API calls vs cache
    const cachedCorps = [];
    const uncachedCorpIds = [];

    uniqueCorpIds.forEach(corpId => {
        if (corporationInfoCache.has(corpId)) {
            cachedCorps.push(corpId);
            localLookups++; // Count in-memory cache hit
        } else {
            uncachedCorpIds.push(corpId);
        }
    });

    const corpMap = new Map();
    let processedCorps = 0;

    // Step 2: Process cached corps instantly (no chunks, no delays)
    if (cachedCorps.length > 0) {
        for (const corpId of cachedCorps) {
            try {
                const info = corporationInfoCache.get(corpId);
                corpMap.set(corpId, info);
                processedCorps++;
                updateProgress(processedCorps, uniqueCorpIds.length,
                    `Getting corporation information (${processedCorps}/${uniqueCorpIds.length})...`);
            } catch (e) {
                showError(`Error fetching cached corporation ${corpId}: ${e}`);
                console.error(`Error fetching cached corporation ${corpId}:`, e);
                corpMap.set(corpId, { name: 'Unknown Corporation', war_eligible: false });
                processedCorps++;
            }
        }
    }

    // Step 3: Check IndexedDB cache for uncached corps (batched)
    const uncachedFromDB = await checkIndexedDBCache(uncachedCorpIds, corpMap, 'corporation');
    processedCorps += (uncachedCorpIds.length - uncachedFromDB.length);

    if (processedCorps > cachedCorps.length) {
        updateProgress(processedCorps, uniqueCorpIds.length,
            `Getting corporation information (${processedCorps}/${uniqueCorpIds.length})...`);
    }

    // Step 4: Process uncached corps with API calls (chunked with delays)
    if (uncachedFromDB.length > 0) {
        await processUncachedCorporations(uncachedFromDB, corpMap, processedCorps, uniqueCorpIds.length);
    }

    return corpMap;
}

// Function to get alliance information with smart caching
async function getAllianceInfoWithCaching(uniqueAllianceIds) {
    if (uniqueAllianceIds.length === 0) {
        return new Map();
    }

    updateProgress(0, uniqueAllianceIds.length, "Getting alliance information...");

    // Step 1: Check which alliances need API calls vs cache
    const cachedAlliances = [];
    const uncachedAllianceIds = [];

    uniqueAllianceIds.forEach(allianceId => {
        if (allianceInfoCache.has(allianceId)) {
            cachedAlliances.push(allianceId);
            localLookups++; // Count in-memory cache hit
        } else {
            uncachedAllianceIds.push(allianceId);
        }
    });

    const allianceMap = new Map();
    let processedAlliances = 0;

    // Step 2: Process cached alliances instantly (no chunks, no delays)
    if (cachedAlliances.length > 0) {
        for (const allianceId of cachedAlliances) {
            try {
                const info = allianceInfoCache.get(allianceId);
                allianceMap.set(allianceId, info);
                processedAlliances++;
                updateProgress(processedAlliances, uniqueAllianceIds.length,
                    `Getting alliance information (${processedAlliances}/${uniqueAllianceIds.length})...`);
            } catch (e) {
                showError(`Error fetching cached alliance ${allianceId}: ${e}`);
                console.error(`Error fetching cached alliance ${allianceId}:`, e);
                allianceMap.set(allianceId, { name: 'Unknown Alliance' });
                processedAlliances++;
            }
        }
    }

    // Step 3: Check IndexedDB cache for uncached alliances (batched)
    const uncachedFromDB = await checkIndexedDBCache(uncachedAllianceIds, allianceMap, 'alliance');
    processedAlliances += (uncachedAllianceIds.length - uncachedFromDB.length);

    if (processedAlliances > cachedAlliances.length) {
        updateProgress(processedAlliances, uniqueAllianceIds.length,
            `Getting alliance information (${processedAlliances}/${uniqueAllianceIds.length})...`);
    }

    // Step 4: Process uncached alliances with API calls (chunked with delays)
    if (uncachedFromDB.length > 0) {
        await processUncachedAlliances(uncachedFromDB, allianceMap, processedAlliances, uniqueAllianceIds.length);
    }

    return allianceMap;
}

// Generic function to check IndexedDB cache for multiple IDs
async function checkIndexedDBCache(uncachedIds, resultMap, type) {
    if (uncachedIds.length === 0) return [];

    const getCacheFunction = type === 'corporation' ? getCachedCorporationInfo : getCachedAllianceInfo;
    const inMemoryCache = type === 'corporation' ? corporationInfoCache : allianceInfoCache;

    // Batch check IndexedDB
    const dbCachePromises = uncachedIds.map(async id => {
        const cached = await getCacheFunction(id);
        return { id, cached };
    });

    const dbResults = await Promise.all(dbCachePromises);
    const stillUncached = [];

    dbResults.forEach(result => {
        if (result.cached) {
            resultMap.set(result.id, result.cached);
            inMemoryCache.set(result.id, result.cached);
            localLookups++; // Count IndexedDB cache hit
        } else {
            stillUncached.push(result.id);
        }
    });

    return stillUncached;
}

// Function to process uncached corporations via API
async function processUncachedCorporations(uncachedIds, corpMap, startingCount, totalCount) {
    const corpChunks = chunkArray(uncachedIds, CHUNK_SIZE);
    let processedCorps = startingCount;

    for (let i = 0; i < corpChunks.length; i++) {
        const chunk = corpChunks[i];

        // Process all corps in this chunk concurrently
        const chunkPromises = chunk.map(async (corpId) => {
            try {
                esiLookups++;
                const res = await fetch(`${ESI_BASE}/corporations/${corpId}/`, {
                    headers: { 'User-Agent': USER_AGENT }
                });
                if (!res.ok) {
                    showError(`Failed to get corporation info for ${corpId}: ${res.status}`);
                    throw new Error(`Failed to get corporation info for ${corpId}: ${res.status}`);
                }
                const data = await res.json();

                // Extract only needed data
                const corporationInfo = {
                    name: data.name,
                    war_eligible: data.war_eligible
                };

                // Cache in memory and IndexedDB
                corporationInfoCache.set(corpId, corporationInfo);
                await setCachedCorporationInfo(corpId, corporationInfo);

                return { id: corpId, info: corporationInfo };
            } catch (e) {
                showError(`Error fetching corporation ${corpId}: ${e}`);
                console.error(`Error fetching corporation ${corpId}:`, e);
                const fallbackInfo = { name: 'Unknown Corporation', war_eligible: false };
                corporationInfoCache.set(corpId, fallbackInfo);
                return { id: corpId, info: fallbackInfo };
            }
        });

        const chunkResults = await Promise.all(chunkPromises);

        // Store results in map
        chunkResults.forEach(result => {
            if (result && result.info) {
                corpMap.set(result.id, result.info);
            }
        });

        processedCorps += chunk.length;
        updateProgress(processedCorps, totalCount,
            `Getting corporation information (${processedCorps}/${totalCount})...`);

        // Only delay between chunks if we have more API calls to make
        if (i + 1 < corpChunks.length) {
            await new Promise(resolve => setTimeout(resolve, CHUNK_DELAY));
        }
    }
}

// Function to process uncached alliances via API
async function processUncachedAlliances(uncachedIds, allianceMap, startingCount, totalCount) {
    const allianceChunks = chunkArray(uncachedIds, CHUNK_SIZE);
    let processedAlliances = startingCount;

    for (let i = 0; i < allianceChunks.length; i++) {
        const chunk = allianceChunks[i];

        // Process all alliances in this chunk concurrently
        const chunkPromises = chunk.map(async (allianceId) => {
            try {
                esiLookups++;
                const res = await fetch(`${ESI_BASE}/alliances/${allianceId}/`, {
                    headers: { 'User-Agent': USER_AGENT }
                });
                if (!res.ok) {
                    showError(`Failed to get alliance info for ${allianceId}: ${res.status}`);
                    throw new Error(`Failed to get alliance info for ${allianceId}: ${res.status}`);
                }
                const data = await res.json();

                // Extract only needed data
                const allianceInfo = {
                    name: data.name
                };

                // Cache in memory and IndexedDB
                allianceInfoCache.set(allianceId, allianceInfo);
                await setCachedAllianceInfo(allianceId, allianceInfo);

                return { id: allianceId, info: allianceInfo };
            } catch (e) {
                console.error(`Error fetching alliance ${allianceId}:`, e);
                const fallbackInfo = { name: 'Unknown Alliance' };
                allianceInfoCache.set(allianceId, fallbackInfo);
                return { id: allianceId, info: fallbackInfo };
            }
        });

        const chunkResults = await Promise.all(chunkPromises);

        // Store results in map
        chunkResults.forEach(result => {
            if (result && result.info) {
                allianceMap.set(result.id, result.info);
            }
        });

        processedAlliances += chunk.length;
        updateProgress(processedAlliances, totalCount,
            `Getting alliance information (${processedAlliances}/${totalCount})...`);

        // Only delay between chunks if we have more API calls to make
        if (i + 1 < allianceChunks.length) {
            await new Promise(resolve => setTimeout(resolve, CHUNK_DELAY));
        }
    }
}

// Function to build final character results
function buildCharacterResults(characters, affiliationMap, corpMap, allianceMap) {
    updateProgress(0, characters.length, "Building final results...");
    const results = [];

    for (let i = 0; i < characters.length; i++) {
        const char = characters[i];
        try {
            const affiliation = affiliationMap.get(char.id);
            if (!affiliation) {
                showError(`No affiliation found for character ${char.name}`);
                throw new Error(`No affiliation found for character ${char.name}`);
            }

            const corpInfo = corpMap.get(affiliation.corporation_id);
            if (!corpInfo) {
                showError(`No corporation info found for corporation ${affiliation.corporation_id}`);
                throw new Error(`No corporation info found for corporation ${affiliation.corporation_id}`);
            }

            let result = {
                character_name: char.name,
                character_id: char.id,
                corporation_name: corpInfo.name,
                corporation_id: affiliation.corporation_id,
                alliance_name: null,
                alliance_id: null,
                war_eligible: false
            };

            if (affiliation.alliance_id) {
                const allianceInfo = allianceMap.get(affiliation.alliance_id);
                if (allianceInfo) {
                    result.alliance_name = allianceInfo.name;
                    result.alliance_id = affiliation.alliance_id;
                }
            }

            if (corpInfo.war_eligible !== undefined) result.war_eligible = corpInfo.war_eligible;
            results.push(result);
        } catch (e) {
            showError(`Error processing character ${char.name}: ${e}`);
            console.error(`Error processing character ${char.name}:`, e);
            results.push({
                character_name: char.name,
                character_id: char.id,
                corporation_name: 'Error loading',
                corporation_id: null,
                alliance_name: null,
                alliance_id: null,
                war_eligible: false
            });
        }
        updateProgress(i + 1, characters.length, "Building final results...");
    }

    return results;
}

// Main validator function - now much cleaner and focused
async function validator(names) {
    // Reset counters at start
    localLookups = 0;
    esiLookups = 0;

    // Step 1: Get character IDs
    const characters = await getCharacterIds(names);
    const characterIds = characters.map(char => char.id);

    // Step 2: Handle missing characters
    await handleMissingCharacters(characters, names);

    // Step 3: Get character affiliations
    updateProgress(0, characterIds.length, "Getting character affiliations...");
    const affiliations = await getCharacterAffiliations(characterIds);

    const affiliationMap = new Map();
    affiliations.forEach(affiliation => {
        affiliationMap.set(affiliation.character_id, affiliation);
    });

    // Step 4: Get unique IDs and fetch organization info
    const uniqueCorpIds = Array.from(new Set(affiliations.map(a => a.corporation_id)));
    const uniqueAllianceIds = Array.from(new Set(affiliations.map(a => a.alliance_id).filter(id => id)));

    // Step 5: Get corporation and alliance information
    const [corpMap, allianceMap] = await Promise.all([
        getCorporationInfoWithCaching(uniqueCorpIds),
        getAllianceInfoWithCaching(uniqueAllianceIds)
    ]);

    // Step 6: Build and return final results
    return buildCharacterResults(characters, affiliationMap, corpMap, allianceMap);
}


// Optimized updateElementContent function
function updateElementContent(element, character, viewType) {
    // Cache DOM queries for better performance
    const avatar = element.querySelector('.character-avatar');
    const characterLink = element.querySelector('.character-name a');
    const corpLogo = element.querySelector('.corp-alliance-info .org-logo');
    const corpLink = element.querySelector('.corp-alliance-info .character-link');

    // Batch DOM updates
    if (avatar) {
        avatar.alt = character.character_name;
        const newAvatarSrc = `https://images.evetech.net/characters/${character.character_id}/portrait?size=${CHARACTER_PORTRAIT_SIZE_PX}`;
        if (avatar.dataset.src !== newAvatarSrc) {
            avatar.dataset.src = newAvatarSrc;
            if (document.contains(avatar)) {
                observerManager.observeImage(avatar);
            }
        }
    }

    if (characterLink) {
        characterLink.textContent = character.character_name;
        characterLink.href = `https://zkillboard.com/character/${character.character_id}/`;
    }

    if (corpLogo) {
        corpLogo.alt = character.corporation_name;
        const newCorpSrc = `https://images.evetech.net/corporations/${character.corporation_id}/logo?size=${CORP_LOGO_SIZE_PX}`;
        if (corpLogo.dataset.src !== newCorpSrc) {
            corpLogo.dataset.src = newCorpSrc;
            if (document.contains(corpLogo)) {
                observerManager.observeImage(corpLogo);
            }
        }
    }

    if (corpLink) {
        corpLink.textContent = character.corporation_name;
        corpLink.href = `https://zkillboard.com/corporation/${character.corporation_id}/`;
    }

    // Handle alliance info efficiently
    const corpAllianceInfo = element.querySelector('.corp-alliance-info');
    let allianceSection = element.querySelector('.org-item:last-child');
    const isAllianceSection = allianceSection && allianceSection.querySelector('a[href*="/alliance/"]');

    if (character.alliance_name && character.alliance_id) {
        if (!isAllianceSection) {
            // Create alliance section using document fragment
            const fragment = document.createDocumentFragment();
            const newAllianceSection = document.createElement('div');
            newAllianceSection.className = 'org-item';
            newAllianceSection.innerHTML = `
                <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E%3C/svg%3E" 
                     data-src="https://images.evetech.net/alliances/${character.alliance_id}/logo?size=${ALLIANCE_LOGO_SIZE_PX}"
                     alt="${character.alliance_name}" 
                     class="org-logo" 
                     loading="lazy" 
                     decoding="async">
                <a href="https://zkillboard.com/alliance/${character.alliance_id}/" 
                   target="_blank" 
                   class="character-link">${character.alliance_name}</a>
            `;
            fragment.appendChild(newAllianceSection);
            corpAllianceInfo.appendChild(fragment);
            
            const allianceLogo = newAllianceSection.querySelector('.org-logo');
            if (document.contains(allianceLogo)) {
                observerManager.observeImage(allianceLogo);
            }
        } else {
            // Update existing alliance section
            const allianceLogo = allianceSection.querySelector('.org-logo');
            const allianceLink = allianceSection.querySelector('.character-link');

            if (allianceLogo) {
                allianceLogo.alt = character.alliance_name;
                const newAllianceSrc = `https://images.evetech.net/alliances/${character.alliance_id}/logo?size=${ALLIANCE_LOGO_SIZE_PX}`;
                if (allianceLogo.dataset.src !== newAllianceSrc) {
                    allianceLogo.dataset.src = newAllianceSrc;
                    if (document.contains(allianceLogo)) {
                        observerManager.observeImage(allianceLogo);
                    }
                }
            }

            if (allianceLink) {
                allianceLink.textContent = character.alliance_name;
                allianceLink.href = `https://zkillboard.com/alliance/${character.alliance_id}/`;
            }
        }
    } else {
        // Remove alliance section if character has no alliance
        if (isAllianceSection) {
            allianceSection.remove();
        }
    }
}

async function getCacheRecordCount() {
    try {
        const db = await initDB();
        const stores = ['character_names', 'character_affiliations', 'corporations', 'alliances'];
        let totalCount = 0;

        // Use Promise.all to count all stores concurrently for better performance
        const countPromises = stores.map(storeName => {
            return new Promise((resolve) => {
                const transaction = db.transaction([storeName], 'readonly');
                const store = transaction.objectStore(storeName);
                const countRequest = store.count();

                countRequest.onsuccess = () => {
                    resolve(countRequest.result);
                };

                countRequest.onerror = () => {
                    showWarning(`DB error whilst counting records in ${storeName}`);
                    console.warn(`Error counting records in ${storeName}:`, countRequest.error);
                    resolve(0);
                };
            });
        });

        const counts = await Promise.all(countPromises);
        totalCount = counts.reduce((sum, count) => sum + count, 0);

        return totalCount;
    } catch (e) {
        showWarning('DB error whilst getting cache record count');
        console.warn('Error getting cache record count:', e);
        return 0;
    }
}

async function updatePerformanceStats() {
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

let progressElements = null;
let lastProgressUpdate = 0;

function getProgressElements() {
    if (!progressElements) {
        progressElements = {
            bar: document.getElementById('progressBar'),
            text: document.getElementById('progressText')
        };
    }
    return progressElements;
}

function updateProgress(current, total, stage = null) {
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

function buildEntityMaps(results) {
    corpToCharactersMap.clear();
    allianceToCorpsMap.clear();

    // Build corp to characters map
    results.forEach(character => {
        if (character.war_eligible && character.corporation_id) {
            if (!corpToCharactersMap.has(character.corporation_id)) {
                corpToCharactersMap.set(character.corporation_id, []);
            }
            corpToCharactersMap.get(character.corporation_id).push(character);
        }
    });

    // Build alliance to corps map
    const corpsByAlliance = new Map();
    results.forEach(character => {
        if (character.war_eligible && character.alliance_id && character.corporation_id) {
            if (!corpsByAlliance.has(character.alliance_id)) {
                corpsByAlliance.set(character.alliance_id, new Set());
            }
            corpsByAlliance.get(character.alliance_id).add(character.corporation_id);
        }
    });

    // Convert to array format with corp info
    corpsByAlliance.forEach((corpIds, allianceId) => {
        const corps = [];
        corpIds.forEach(corpId => {
            const characters = corpToCharactersMap.get(corpId) || [];
            if (characters.length > 0) {
                corps.push({
                    id: corpId,
                    name: characters[0].corporation_name,
                    count: characters.length
                });
            }
        });
        allianceToCorpsMap.set(allianceId, corps.sort((a, b) => b.count - a.count));
    });
}

function createMouseoverCard(entity, type) {
    const card = document.createElement("div");
    card.className = "mouseover-card";

    let content = '';
    let items = [];
    const maxItems = MOUSEOVER_CARD_MAX_ITEMS;

    if (type === 'alliance') {
        const corps = allianceToCorpsMap.get(entity.id) || [];
        items = corps.slice(0, maxItems);
        content = `
      <div class="mouseover-card-header">Corporations in ${entity.name}</div>
      <div class="mouseover-card-content">
        ${items.map(corp => `
          <div class="mouseover-card-item">
            <img src="https://images.evetech.net/corporations/${corp.id}/logo?size=${CORP_LOGO_SIZE_PX}" 
                 alt="${corp.name}" class="mouseover-card-avatar" loading="lazy">
            <div class="mouseover-card-name">
              <a href="https://zkillboard.com/corporation/${corp.id}/" target="_blank">${corp.name}</a>
            </div>
            <div class="summary-count">${corp.count}</div>
          </div>
        `).join('')}
        ${corps.length > maxItems ? `<div class="mouseover-card-more">... and ${corps.length - maxItems} more corporations</div>` : ''}
      </div>
    `;
    } else if (type === 'corporation') {
        const characters = corpToCharactersMap.get(entity.id) || [];
        items = characters.slice(0, maxItems);
        content = `
      <div class="mouseover-card-header">Characters in ${entity.name}</div>
      <div class="mouseover-card-content">
        ${items.map(char => `
          <div class="mouseover-card-item">
            <img src="https://images.evetech.net/characters/${char.character_id}/portrait?size=${MOUSEOVER_CARD_AVATAR_SIZE_PX}" 
                 alt="${char.character_name}" class="mouseover-card-avatar" loading="lazy">
            <div class="mouseover-card-name">
              <a href="https://zkillboard.com/character/${char.character_id}/" target="_blank">${char.character_name}</a>
            </div>
          </div>
        `).join('')}
        ${characters.length > maxItems ? `<div class="mouseover-card-more">... and ${characters.length - maxItems} more characters</div>` : ''}
      </div>
    `;
    }

    card.innerHTML = content;
    return card;
}

// Improved image loading queue with better performance
let imageLoadQueue = [];
let currentlyLoading = 0;
let imageObserverEnabled = true;

function processImageQueue() {
    while (imageLoadQueue.length > 0 && currentlyLoading < MAX_CONCURRENT_IMAGES && imageObserverEnabled) {
        const img = imageLoadQueue.shift();
        if (img && img.dataset.src && document.contains(img) && !img.src.startsWith('https://')) {
            loadSingleImage(img);
        }
    }
}

function loadSingleImage(img) {
    const realSrc = img.dataset.src;
    if (!realSrc || img.src === realSrc) return;

    currentlyLoading++;
    img.style.opacity = '0.3'; // Show loading state

    const onLoad = () => {
        currentlyLoading--;
        img.style.opacity = '1'; // Show loaded state
        img.removeEventListener('load', onLoad);
        img.removeEventListener('error', onError);
        delete img.dataset.loading;
        
        // Process next in queue
        requestAnimationFrame(() => processImageQueue());
    };

    const onError = () => {
        currentlyLoading--;
        img.style.opacity = '0.5'; // Show error state
        img.removeEventListener('load', onLoad);
        img.removeEventListener('error', onError);
        delete img.dataset.loading;
        
        // Process next in queue
        requestAnimationFrame(() => processImageQueue());
    };

    img.addEventListener('load', onLoad, { once: true });
    img.addEventListener('error', onError, { once: true });
    img.src = realSrc;
}

// Add scroll state detection to reduce operations during active scrolling
function addScrollStateDetection() {
    let scrollTimeout;
    
    document.addEventListener('scroll', (e) => {
        if (e.target && e.target.classList && e.target.classList.contains('virtual-scroll-container')) {
            e.target.classList.add('scrolling');
            imageObserverEnabled = false; // Pause image loading during scroll
            
            clearTimeout(scrollTimeout);
            scrollTimeout = setTimeout(() => {
                e.target.classList.remove('scrolling');
                imageObserverEnabled = true; // Resume image loading
                processImageQueue(); // Process any queued images
            }, SCROLL_STATE_TIMEOUT_MS);
        }
    }, { passive: true, capture: true });
}

function createCharacterItem(character, viewType = 'grid') {
    // Create element using createDocumentFragment for better performance
    const template = document.createElement('template');
    const placeholder = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E%3C/svg%3E";

    const allianceSection = character.alliance_name && character.alliance_id ? `
        <div class="org-item">
            <img src="${placeholder}" 
                 data-src="https://images.evetech.net/alliances/${character.alliance_id}/logo?size=${ALLIANCE_LOGO_SIZE_PX}"
                 alt="${character.alliance_name}" 
                 class="org-logo" 
                 loading="lazy" 
                 decoding="async">
            <a href="https://zkillboard.com/alliance/${character.alliance_id}/" 
               target="_blank" 
               class="character-link">${character.alliance_name}</a>
        </div>
    ` : '';

    template.innerHTML = `
        <div class="result-item ${viewType}-view animate-ready" data-character-id="${character.character_id}">
            <img src="${placeholder}" 
                 data-src="https://images.evetech.net/characters/${character.character_id}/portrait?size=${CHARACTER_PORTRAIT_SIZE_PX}"
                 alt="${character.character_name}" 
                 class="character-avatar" 
                 loading="lazy" 
                 decoding="async">
            <div class="character-content">
                <div class="character-name">
                    <a href="https://zkillboard.com/character/${character.character_id}/" 
                       target="_blank" 
                       class="character-link">${character.character_name}</a>
                </div>
                <div class="character-details">
                    <div class="corp-alliance-info">
                        <div class="org-item">
                            <img src="${placeholder}" 
                                 data-src="https://images.evetech.net/corporations/${character.corporation_id}/logo?size=${CORP_LOGO_SIZE_PX}"
                                 alt="${character.corporation_name}" 
                                 class="org-logo" 
                                 loading="lazy" 
                                 decoding="async">
                            <a href="https://zkillboard.com/corporation/${character.corporation_id}/" 
                               target="_blank" 
                               class="character-link">${character.corporation_name}</a>
                        </div>
                        ${allianceSection}
                    </div>
                </div>
            </div>
        </div>
    `;

    return template.content.firstElementChild;
}


function createSummaryItem({ id, name, count, type }) {
    const item = document.createElement("div");
    item.className = "summary-item";

    const logo = document.createElement("img");
    logo.className = "summary-logo";
    logo.alt = name;
    logo.loading = "lazy";
    logo.decoding = "async";

    const placeholder = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E%3C/svg%3E";
    logo.src = placeholder;
    logo.dataset.src = `https://images.evetech.net/${type}s/${id}/logo?size=32`;

    item.appendChild(logo);

    const content = document.createElement("div");
    content.className = "summary-content";

    const nameDiv = document.createElement("div");
    nameDiv.className = "summary-name";
    nameDiv.innerHTML = `<a href="https://zkillboard.com/${type}/${id}/" target="_blank" class="character-link">${name}</a>`;
    content.appendChild(nameDiv);

    const countDiv = document.createElement("div");
    countDiv.className = "summary-count";
    countDiv.textContent = count;
    content.appendChild(countDiv);

    item.appendChild(content);
    item.appendChild(createMouseoverCard({ id, name, count }, type));

    // FIXED: Observe the logo image after it's in the DOM structure
    requestAnimationFrame(() => {
        observerManager.observeImage(logo);
    });

    return item;
}

// Optimized renderGrid function using document fragments
function renderGrid(containerId, items, type = 'character', limit = null) {
    const container = document.getElementById(containerId);

    if (type === 'character') {
        const itemsToShow = limit ? items.slice(0, limit) : items;

        if (itemsToShow.length === 0) {
            container.innerHTML = `
                <div class="no-results">
                    <div class="no-results-icon">🔍</div>
                    <div class="no-results-text">No results found</div>
                </div>
            `;
            return;
        }

        // Use virtual scrolling for better performance
        setupVirtualScrolling(containerId, itemsToShow);

    } else {
        if (items.length === 0) {
            container.innerHTML = `
                <div class="no-summary">
                    <div class="no-results-icon">📊</div>
                    <div class="no-results-text">No war-eligible ${type}s found</div>
                </div>
            `;
            return;
        }

        // Use document fragment for batch DOM operations
        const fragment = document.createDocumentFragment();
        
        // Create all items in memory first
        const elements = items.map(item => createSummaryItem(item));
        
        // Add all elements to fragment
        elements.forEach(element => fragment.appendChild(element));

        // Single DOM update
        container.innerHTML = "";
        container.appendChild(fragment);
    }
}

// Enhanced virtual scrolling with document fragments and better performance
function setupVirtualScrolling(containerId, items) {
    const container = document.getElementById(containerId);
    if (!container || !items || items.length === 0) {
        console.warn(`Cannot setup virtual scrolling: container "${containerId}" not found or no items`);
        return;
    }

    let parentGrid = container.closest('.result-grid');
    if (!parentGrid) {
        parentGrid = container.parentElement?.classList?.contains('result-grid') ? container.parentElement : container;
    }

    // Clean up any existing setup
    if (container._cleanup) {
        container._cleanup();
    }

    parentGrid.classList.add('virtual-enabled');

    const isListView = currentView === 'list';
    const itemHeight = isListView ? 90 : 150;
    const containerWidth = Math.max(270, parentGrid.clientWidth - 60);
    const itemsPerRow = isListView ? 1 : Math.max(1, Math.floor(containerWidth / 270));
    const totalRows = Math.ceil(items.length / itemsPerRow);
    const totalHeight = totalRows * itemHeight;

    // Set up container structure
    container.className = 'virtual-scroll-container';
    container.style.height = '60vh';
    container.style.minHeight = '300px';
    container.style.maxHeight = '600px';
    container.style.overflowY = 'auto';
    container.style.position = 'relative';

    // Create stable structure
    const spacer = document.createElement('div');
    spacer.className = 'virtual-scroll-spacer';
    spacer.style.height = totalHeight + 'px';
    spacer.style.position = 'relative';

    const content = document.createElement('div');
    content.className = `virtual-scroll-content ${isListView ? 'list-view' : ''}`;
    content.style.position = 'absolute';
    content.style.top = '0';
    content.style.left = '0';
    content.style.right = '0';
    content.style.display = 'grid';
    content.style.gap = '1.35rem';
    content.style.padding = '1.8rem';
    content.style.gridTemplateColumns = isListView ? '1fr' : 'repeat(auto-fill, minmax(252px, 1fr))';

    spacer.appendChild(content);
    container.innerHTML = '';
    container.appendChild(spacer);

    // Stable element management
    const renderedElements = new Map(); // Map of index -> DOM element
    const visibleRange = { start: -1, end: -1 };
    let isUpdating = false;
    let animationFrame = null;

    function updateVisibleItems() {
        if (isUpdating || !document.contains(container)) return;

        isUpdating = true;

        if (animationFrame) {
            cancelAnimationFrame(animationFrame);
        }

        const scrollTop = container.scrollTop;
        const containerHeight = container.clientHeight;
        const buffer = 5; // Smaller buffer for stability

        const startRow = Math.max(0, Math.floor(scrollTop / itemHeight) - buffer);
        const endRow = Math.min(totalRows, Math.ceil((scrollTop + containerHeight) / itemHeight) + buffer);
        const startIndex = startRow * itemsPerRow;
        const endIndex = Math.min(items.length, endRow * itemsPerRow);

        // Only update if range actually changed
        if (startIndex === visibleRange.start && endIndex === visibleRange.end) {
            isUpdating = false;
            return;
        }

        animationFrame = requestAnimationFrame(() => {
            if (!document.contains(container)) {
                isUpdating = false;
                return;
            }

            // Remove elements that are no longer visible
            for (const [index, element] of renderedElements) {
                if (index < startIndex || index >= endIndex) {
                    if (element.parentNode) {
                        element.style.display = 'none';
                        // Don't remove from DOM, just hide for stability
                    }
                }
            }

            // Add or show elements that should be visible
            for (let i = startIndex; i < endIndex; i++) {
                if (!items[i]) continue;

                let element = renderedElements.get(i);
                
                if (!element) {
                    // Create new element only if it doesn't exist
                    element = createCharacterItem(items[i], isListView ? 'list' : 'grid');
                    element.style.position = 'relative';
                    element.dataset.index = i;
                    renderedElements.set(i, element);
                    content.appendChild(element);
                    
                    // Observe images in next frame
                    requestAnimationFrame(() => {
                        if (document.contains(element)) {
                            const images = element.querySelectorAll('img[data-src]');
                            images.forEach(img => observerManager.observeImage(img));
                            observerManager.observeAnimation(element);
                        }
                    });
                } else {
                    // Just show existing element
                    element.style.display = '';
                    if (!element.parentNode) {
                        content.appendChild(element);
                    }
                }
            }

            // Update transform for positioning
            const translateY = startRow * itemHeight;
            content.style.transform = `translateY(${translateY}px)`;

            visibleRange.start = startIndex;
            visibleRange.end = endIndex;
            isUpdating = false;
            animationFrame = null;
        });
    }

    // Optimized scroll handler with better throttling
    let scrollTimeout = null;
    let lastScrollTime = 0;

    function onScroll() {
        const now = performance.now();
        
        // Immediate update for smooth scrolling
        if (now - lastScrollTime > ANIMATION_FRAME_THROTTLE_FPS) {
            updateVisibleItems();
            lastScrollTime = now;
        } else {
            // Fallback throttled update
            if (scrollTimeout) clearTimeout(scrollTimeout);
            scrollTimeout = setTimeout(() => {
                updateVisibleItems();
                scrollTimeout = null;
            }, SCROLL_THROTTLE_MS);
        }
    }

    container.addEventListener('scroll', onScroll, { passive: true });
    container._scrollListener = onScroll;

    // Initial render
    updateVisibleItems();

    // Cleanup function
    container._cleanup = () => {
        if (animationFrame) {
            cancelAnimationFrame(animationFrame);
        }
        if (scrollTimeout) {
            clearTimeout(scrollTimeout);
        }
        if (container._scrollListener) {
            container.removeEventListener('scroll', container._scrollListener);
            delete container._scrollListener;
        }

        // Clean up observers
        renderedElements.forEach(element => {
            const images = element.querySelectorAll('img[data-src]');
            images.forEach(img => {
                if (observerManager.observedImages.has(img)) {
                    observerManager.imageObserver?.unobserve(img);
                    observerManager.observedImages.delete(img);
                }
            });
            
            if (observerManager.observedAnimations.has(element)) {
                observerManager.animationObserver?.unobserve(element);
                observerManager.observedAnimations.delete(element);
            }
        });

        renderedElements.clear();
        parentGrid?.classList?.remove('virtual-enabled');
        
        if (container) {
            container.className = container.className.replace('virtual-scroll-container', '').trim() || 'result-grid';
            container.style.height = '';
            container.style.minHeight = '';
            container.style.maxHeight = '';
            container.style.overflowY = '';
            container.style.position = '';
        }

        delete container._cleanup;
    };
}

let lastTimerUpdate = 0;
function updateTimer() {
    const now = Date.now();
    if (now - lastTimerUpdate < TIMER_UPDATE_THROTTLE_MS) return;

    const elapsed = ((now - startTime) / 1000).toFixed(1);
    document.getElementById("timer").textContent = `Elapsed: ${elapsed}s`;
    lastTimerUpdate = now;
}

function updateTitle(count, total) {
    document.title = `${count}/${total} targets - War Target Finder`;
}


function startLoading() {
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

    esiLookups = 0;
    localLookups = 0;
    queryStartTime = performance.now();

    observerManager.cleanup(); // Clear all observers before new search

    startTime = Date.now();
    timerInterval = setInterval(updateTimer, TIMER_UPDATE_INTERVAL_MS);
}

function stopLoading() {
    const lc = document.getElementById("loading-container");
    const rs = document.getElementById("results-section");
    const cb = document.getElementById("checkButton");

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

function showInformation(message) {
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


function showWarning(message) {
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


function showError(message) {
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

// Cache DOM elements to avoid repeated queries
let statsElements = null;

function getStatsElements() {
    if (!statsElements) {
        statsElements = {
            eligibleCount: document.getElementById("eligible-count"),
            ineligibleCount: document.getElementById("ineligible-count"),
            totalCount: document.getElementById("total-count"),
            eligibleTotal: document.getElementById("eligible-total"),
            ineligibleTotal: document.getElementById("ineligible-total")
        };
    }
    return statsElements;
}

async function getCorporationInfoBatch(corporationIds) {
    const corpMap = new Map();
    let processedCorps = 0;

    // Step 1: Check in-memory cache first
    const cachedCorps = [];
    const uncachedFromMemory = [];

    corporationIds.forEach(corpId => {
        if (corporationInfoCache.has(corpId)) {
            corpMap.set(corpId, corporationInfoCache.get(corpId));
            cachedCorps.push(corpId);
        } else {
            uncachedFromMemory.push(corpId);
        }
    });

    processedCorps = cachedCorps.length;
    if (processedCorps > 0) {
        updateProgress(processedCorps, corporationIds.length,
            `Getting corporation information (${processedCorps}/${corporationIds.length})...`);
    }

    // Step 2: Check IndexedDB cache for remaining IDs
    const cachedFromDB = [];
    const uncachedFromDB = [];

    if (uncachedFromMemory.length > 0) {
        // Batch check IndexedDB
        const dbCachePromises = uncachedFromMemory.map(async corpId => {
            const cached = await getCachedCorporationInfo(corpId);
            return { corpId, cached };
        });

        const dbResults = await Promise.all(dbCachePromises);

        dbResults.forEach(result => {
            if (result.cached) {
                corpMap.set(result.corpId, result.cached);
                corporationInfoCache.set(result.corpId, result.cached);
                cachedFromDB.push(result.corpId);
                processedCorps++;
            } else {
                uncachedFromDB.push(result.corpId);
            }
        });

        if (cachedFromDB.length > 0) {
            updateProgress(processedCorps, corporationIds.length,
                `Getting corporation information (${processedCorps}/${corporationIds.length})...`);
        }
    }

    // Step 3: Fetch remaining corporations from API in chunks with delays
    if (uncachedFromDB.length > 0) {
        const corpChunks = chunkArray(uncachedFromDB, CHUNK_SIZE);

        for (let i = 0; i < corpChunks.length; i++) {
            const chunk = corpChunks[i];

            // Process all corps in this chunk concurrently
            const chunkPromises = chunk.map(async (corpId) => {
                try {
                    esiLookups++;
                    const res = await fetch(`${ESI_BASE}/corporations/${corpId}/`, {
                        headers: { 'User-Agent': USER_AGENT }
                    });
                    if (!res.ok) {
                        showError(`Failed to get corporation info for ${corpId}: ${res.status}`);
                        throw new Error(`Failed to get corporation info for ${corpId}: ${res.status}`);
                    }
                    const data = await res.json();

                    // Extract only needed data
                    const corporationInfo = {
                        name: data.name,
                        war_eligible: data.war_eligible
                    };

                    // Cache in memory and IndexedDB
                    corporationInfoCache.set(corpId, corporationInfo);
                    await setCachedCorporationInfo(corpId, corporationInfo);

                    return { id: corpId, info: corporationInfo };
                } catch (e) {
                    showError(`Error fetching corporation ${corpId}:`, e);
                    console.error(`Error fetching corporation ${corpId}:`, e);
                    const fallbackInfo = { name: 'Unknown Corporation', war_eligible: false };
                    corporationInfoCache.set(corpId, fallbackInfo);
                    return { id: corpId, info: fallbackInfo };
                }
            });

            const chunkResults = await Promise.all(chunkPromises);

            // Store results in map
            chunkResults.forEach(result => {
                if (result && result.info) {
                    corpMap.set(result.id, result.info);
                }
            });

            processedCorps += chunk.length;
            updateProgress(processedCorps, corporationIds.length,
                `Getting corporation information (${processedCorps}/${corporationIds.length})...`);

            // Only delay between chunks if we have more API calls to make
            if (i + 1 < corpChunks.length) {
                await new Promise(resolve => setTimeout(resolve, CHUNK_DELAY));
            }
        }
    }

    return corpMap;
}

async function getAllianceInfoBatch(allianceIds) {
    const allianceMap = new Map();
    let processedAlliances = 0;

    // Step 1: Check in-memory cache first
    const cachedAlliances = [];
    const uncachedFromMemory = [];

    allianceIds.forEach(allianceId => {
        if (allianceInfoCache.has(allianceId)) {
            allianceMap.set(allianceId, allianceInfoCache.get(allianceId));
            cachedAlliances.push(allianceId);
        } else {
            uncachedFromMemory.push(allianceId);
        }
    });

    processedAlliances = cachedAlliances.length;
    if (processedAlliances > 0) {
        updateProgress(processedAlliances, allianceIds.length,
            `Getting alliance information (${processedAlliances}/${allianceIds.length})...`);
    }

    // Step 2: Check IndexedDB cache for remaining IDs
    const cachedFromDB = [];
    const uncachedFromDB = [];

    if (uncachedFromMemory.length > 0) {
        // Batch check IndexedDB
        const dbCachePromises = uncachedFromMemory.map(async allianceId => {
            const cached = await getCachedAllianceInfo(allianceId);
            return { allianceId, cached };
        });

        const dbResults = await Promise.all(dbCachePromises);

        dbResults.forEach(result => {
            if (result.cached) {
                allianceMap.set(result.allianceId, result.cached);
                allianceInfoCache.set(result.allianceId, result.cached);
                cachedFromDB.push(result.allianceId);
                processedAlliances++;
            } else {
                uncachedFromDB.push(result.allianceId);
            }
        });

        if (cachedFromDB.length > 0) {
            updateProgress(processedAlliances, allianceIds.length,
                `Getting alliance information (${processedAlliances}/${allianceIds.length})...`);
        }
    }

    // Step 3: Fetch remaining alliances from API in chunks with delays
    if (uncachedFromDB.length > 0) {
        const allianceChunks = chunkArray(uncachedFromDB, CHUNK_SIZE);

        for (let i = 0; i < allianceChunks.length; i++) {
            const chunk = allianceChunks[i];

            // Process all alliances in this chunk concurrently
            const chunkPromises = chunk.map(async (allianceId) => {
                try {
                    esiLookups++;
                    const res = await fetch(`${ESI_BASE}/alliances/${allianceId}/`, {
                        headers: { 'User-Agent': USER_AGENT }
                    });
                    if (!res.ok) {
                        showError(`Failed to get alliance info for ${allianceId}: ${res.status}`);
                        throw new Error(`Failed to get alliance info for ${allianceId}: ${res.status}`);
                    }
                    const data = await res.json();

                    // Extract only needed data
                    const allianceInfo = {
                        name: data.name
                    };

                    // Cache in memory and IndexedDB
                    allianceInfoCache.set(allianceId, allianceInfo);
                    await setCachedAllianceInfo(allianceId, allianceInfo);

                    return { id: allianceId, info: allianceInfo };
                } catch (e) {
                    showError(`Error fetching alliance ${allianceId}:`, e);
                    console.error(`Error fetching alliance ${allianceId}:`, e);
                    const fallbackInfo = { name: 'Unknown Alliance' };
                    allianceInfoCache.set(allianceId, fallbackInfo);
                    return { id: allianceId, info: fallbackInfo };
                }
            });

            const chunkResults = await Promise.all(chunkPromises);

            // Store results in map
            chunkResults.forEach(result => {
                if (result && result.info) {
                    allianceMap.set(result.id, result.info);
                }
            });

            processedAlliances += chunk.length;
            updateProgress(processedAlliances, allianceIds.length,
                `Getting alliance information (${processedAlliances}/${allianceIds.length})...`);

            // Only delay between chunks if we have more API calls to make
            if (i + 1 < allianceChunks.length) {
                await new Promise(resolve => setTimeout(resolve, CHUNK_DELAY));
            }
        }
    }

    return allianceMap;
}


function updateStats(eligible, ineligible) {
    const elements = getStatsElements();
    const eligibleLen = eligible.length;
    const ineligibleLen = ineligible.length;
    const totalLen = eligibleLen + ineligibleLen;

    if (elements.eligibleCount) elements.eligibleCount.textContent = eligibleLen;
    if (elements.ineligibleCount) elements.ineligibleCount.textContent = ineligibleLen;
    if (elements.totalCount) elements.totalCount.textContent = totalLen;
    if (elements.eligibleTotal) elements.eligibleTotal.textContent = eligibleLen;
    if (elements.ineligibleTotal) elements.ineligibleTotal.textContent = ineligibleLen;
    updateTitle(eligibleLen, totalLen);
}

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
    observerManager.cleanupDeadElements();

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

async function validateNames() {
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
        queryEndTime = performance.now();
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
function updateVersionDisplay() {
    const versionElement = document.getElementById('version-display');
    if (versionElement) {
        versionElement.textContent = `v${VERSION}`;
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

    window.addEventListener('beforeunload', () => {
        observerManager.cleanup();
    });

    // Cleanup on page visibility change (mobile optimization)
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            observerManager.cleanupDeadElements();
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
