const VERSION = "0.1.20";
const ESI_BASE = "https://esi.evetech.net/latest";
const USER_AGENT = `WarTargetFinder/${VERSION} (+https://github.com/moregh/moregh.github.io/)`;
const ESI_HEADERS = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'User-Agent': USER_AGENT,
    'X-User-Agent': `WarTargetFinder/${VERSION}`
};
const CACHE_EXPIRY_HOURS = 12;              // cache all data for this long
const INITIAL_USER_RESULTS_COUNT = 6;       // initial number of user results to show
const INITIAL_CORP_ALLIANCE_COUNT = 5;      // initial number of corps/alliances to show
const LOAD_MORE_COUNT = 12;                 // number of results to load when "Load More" is clicked
const MAX_ESI_CALL_SIZE = 100;              // max number of names/IDs per ESI call
const MAX_CONCURRENT_IMAGES = 8;            // max concurrent image loads
const CHUNK_SIZE = 50;                      // Process corporations/alliances in chunks of 50
const CHUNK_DELAY = 100;                    // 100ms delay between chunks to be nice to ESI
const STATS_UPDATE_DELAY = 100;             // Delay stats update until results are available

const characterInfoCache = new Map();
const corporationInfoCache = new Map();
const allianceInfoCache = new Map();
const characterNameToIdCache = new Map();
const characterAffiliationCache = new Map();

let queryStartTime = 0;
let queryEndTime = 0;
let esiLookups = 0;
let localLookups = 0;

let timerInterval = null, startTime = 0;
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

// Cache management functions
function getCacheKey(type, id) {
    return `eve_${type}_${id}`;
}

function getNameCacheKey(name) {
    return `eve_name_${name.toLowerCase()}`;
}

function getAffiliationCacheKey(id) {
    return `eve_affiliation_${id}`;
}

function getCachedData(type, id) {
    try {
        const cacheKey = getCacheKey(type, id);
        const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
        if (!cached) return null;

        const { data, timestamp } = cached;
        const now = Date.now();
        const expiryTime = timestamp + (CACHE_EXPIRY_HOURS * 60 * 60 * 1000);

        if (now > expiryTime) {
            localStorage.removeItem(cacheKey);
            return null;
        }
        localLookups++;
        return data;
    } catch (e) {
        console.warn(`Error reading cache for ${type}:${id}`, e);
        return null;
    }
}

function getCachedNameToId(name) {
    try {
        const cacheKey = getNameCacheKey(name);
        const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
        if (!cached) return null;

        const { data, timestamp } = cached;
        const now = Date.now();
        const expiryTime = timestamp + (CACHE_EXPIRY_HOURS * 60 * 60 * 1000);

        if (now > expiryTime) {
            localStorage.removeItem(cacheKey);
            return null;
        }
        localLookups++;
        return data;
    } catch (e) {
        console.warn(`Error reading name cache for ${name}`, e);
        return null;
    }
}

function getCachedAffiliation(id) {
    try {
        const cacheKey = getAffiliationCacheKey(id);
        const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
        if (!cached) return null;

        const { data, timestamp } = cached;
        const now = Date.now();
        const expiryTime = timestamp + (CACHE_EXPIRY_HOURS * 60 * 60 * 1000);

        if (now > expiryTime) {
            localStorage.removeItem(cacheKey);
            return null;
        }
        localLookups++;
        return data;
    } catch (e) {
        console.warn(`Error reading affiliation cache for ${id}`, e);
        return null;
    }
}

function setCachedData(type, id, data) {
    try {
        const cacheKey = getCacheKey(type, id);
        const cacheData = {
            data: data,
            timestamp: Date.now()
        };
        localStorage.setItem(cacheKey, JSON.stringify(cacheData));
    } catch (e) {
        console.warn(`Error writing cache for ${type}:${id}`, e);
    }
}

function setCachedNameToId(name, characterData) {
    try {
        const cacheKey = getNameCacheKey(name);
        const cacheData = {
            data: { id: characterData.id, name: characterData.name },
            timestamp: Date.now()
        };
        localStorage.setItem(cacheKey, JSON.stringify(cacheData));
        characterNameToIdCache.set(name.toLowerCase(), { id: characterData.id, name: characterData.name });
    } catch (e) {
        console.warn(`Error writing name cache for ${name}`, e);
    }
}

function setCachedAffiliation(id, affiliationData) {
    try {
        const cacheKey = getAffiliationCacheKey(id);
        const cacheData = {
            data: affiliationData,
            timestamp: Date.now()
        };
        localStorage.setItem(cacheKey, JSON.stringify(cacheData));
        characterAffiliationCache.set(id, affiliationData);
    } catch (e) {
        console.warn(`Error writing affiliation cache for ${id}`, e);
    }
}

function clearExpiredCache() {
    try {
        const keys = Object.keys(localStorage);
        const now = Date.now();
        const expiryMs = CACHE_EXPIRY_HOURS * 60 * 60 * 1000;

        keys.forEach(key => {
            if (key.startsWith('eve_')) {
                try {
                    const cached = JSON.parse(localStorage.getItem(key));
                    if (now > cached.timestamp + expiryMs) {
                        localStorage.removeItem(key);
                    }
                } catch (e) {
                    localStorage.removeItem(key);
                }
            }
        });
    } catch (e) {
        console.warn('Error clearing expired cache', e);
    }
}

clearExpiredCache();

function clientValidate(name) {
    name = name.trim();
    if (name.length < 3 || name.length > 37) return false;
    let pattern = /^[A-Za-z0-9.''-]+( [A-Za-z0-9.''-]+)*$/;
    if (!pattern.test(name)) return false;
    if (/^[ '-]|[ '-]$/.test(name)) return false;
    let parts = name.split(" ");
    if (parts.length === 1 && name.length > 24) return false;
    if (parts.length > 1) {
        let firstAndMiddle = parts.slice(0, -1).join(" ");
        let familyName = parts[parts.length - 1];
        if (firstAndMiddle.length > 24 || familyName.length > 12) return false;
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

        const cached = getCachedNameToId(name);
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
            // Split uncached names into chunks of MAX_ESI_CALL_SIZE
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
                characters.forEach(char => {
                    setCachedNameToId(char.name, char);
                });
                
                return characters;
            },
            MAX_ESI_CALL_SIZE, // chunk size
            CHUNK_DELAY        // chunk delay
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

    for (const id of characterIds) {
        if (characterAffiliationCache.has(id)) {
            cachedAffiliations.push(characterAffiliationCache.get(id));
            continue;
        }

        const cached = getCachedAffiliation(id);
        if (cached) {
            characterAffiliationCache.set(id, cached);
            cachedAffiliations.push(cached);
            continue;
        }

        uncachedIds.push(id);
    }

    let fetchedAffiliations = [];

    if (uncachedIds.length > 0) {
        esiLookups++;
        const res = await fetch(`${ESI_BASE}/characters/affiliation/`, {
            method: 'POST',
            headers: ESI_HEADERS,
            body: JSON.stringify(uncachedIds)
        });
        if (!res.ok) throw new Error(`Failed to get character affiliations: ${res.status}`);
        fetchedAffiliations = await res.json();

        fetchedAffiliations.forEach(affiliation => {
            setCachedAffiliation(affiliation.character_id, affiliation);
        });
    }

    return [...cachedAffiliations, ...fetchedAffiliations];
}

async function getCorporationInfo(id) {
    if (corporationInfoCache.has(id)) return corporationInfoCache.get(id);

    const cached = getCachedData('corporation', id);
    if (cached) {
        corporationInfoCache.set(id, cached);
        return cached;
    }
    esiLookups++;
    const res = await fetch(`${ESI_BASE}/corporations/${id}/`, {
        headers: { 'User-Agent': USER_AGENT }
    });
    if (!res.ok) throw new Error(`Failed to get corporation info for ${id}: ${res.status}`);
    const data = await res.json();

    corporationInfoCache.set(id, data);
    setCachedData('corporation', id, data);
    return data;
}

async function getAllianceInfo(id) {
    if (allianceInfoCache.has(id)) return allianceInfoCache.get(id);

    const cached = getCachedData('alliance', id);
    if (cached) {
        allianceInfoCache.set(id, cached);
        return cached;
    }
    esiLookups++;
    const res = await fetch(`${ESI_BASE}/alliances/${id}/`, {
        headers: { 'User-Agent': USER_AGENT }
    });
    if (!res.ok) throw new Error(`Failed to get alliance info for ${id}: ${res.status}`);
    const data = await res.json();

    allianceInfoCache.set(id, data);
    setCachedData('alliance', id, data);
    return data;
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

// Updated validator function with smart caching delays
async function validator(names) {
    // Step 1: Get character IDs (chunked with progress)
    const characters = await getCharacterIds(names);
    const characterIds = characters.map(char => char.id);

    // Check if we got all the characters we expected
    if (characters.length !== names.length) {
        const foundNames = new Set(characters.map(c => c.name.toLowerCase()));
        const missingNames = names.filter(name => !foundNames.has(name.toLowerCase()));
        console.warn(`Could not find ${missingNames.length} character(s):`, missingNames);
        
        if (missingNames.length > 0) {
            updateProgress(0, 0, `Warning: ${missingNames.length} character names not found`);
            await new Promise(resolve => setTimeout(resolve, 1500));
        }
    }

    // Step 2: Get character affiliations
    updateProgress(0, characterIds.length, "Getting character affiliations...");
    const affiliations = await getCharacterAffiliations(characterIds);

    const affiliationMap = new Map();
    affiliations.forEach(affiliation => {
        affiliationMap.set(affiliation.character_id, affiliation);
    });

    // Step 3: Get unique corp and alliance IDs
    const uniqueCorpIds = Array.from(new Set(affiliations.map(a => a.corporation_id)));
    const uniqueAllianceIds = Array.from(new Set(affiliations.map(a => a.alliance_id).filter(id => id)));

    // Step 4: Get corporation info with smart caching
    updateProgress(0, uniqueCorpIds.length, "Getting corporation information...");
    
    // Check which corps need API calls vs cache
    const cachedCorps = [];
    const uncachedCorpIds = [];
    
    uniqueCorpIds.forEach(corpId => {
        if (corporationInfoCache.has(corpId) || getCachedData('corporation', corpId)) {
            cachedCorps.push(corpId);
        } else {
            uncachedCorpIds.push(corpId);
        }
    });

    const corpMap = new Map();
    let processedCorps = 0;

    // Process cached corps instantly (no chunks, no delays)
    if (cachedCorps.length > 0) {
        for (const corpId of cachedCorps) {
            try {
                const info = await getCorporationInfo(corpId); // This will be instant from cache
                corpMap.set(corpId, info);
                processedCorps++;
                updateProgress(processedCorps, uniqueCorpIds.length, 
                    `Getting corporation information (${processedCorps}/${uniqueCorpIds.length})...`);
            } catch (e) {
                console.error(`Error fetching cached corporation ${corpId}:`, e);
                corpMap.set(corpId, { name: 'Unknown Corporation', war_eligible: false });
                processedCorps++;
            }
        }
    }

    // Process uncached corps in chunks with delays (only if we have API calls to make)
    if (uncachedCorpIds.length > 0) {
        const corpChunks = chunkArray(uncachedCorpIds, CHUNK_SIZE);
        
        for (let i = 0; i < corpChunks.length; i++) {
            const chunk = corpChunks[i];
            
            // Process all corps in this chunk concurrently
            const chunkPromises = chunk.map(async (corpId) => {
                try {
                    const info = await getCorporationInfo(corpId);
                    return { id: corpId, info };
                } catch (e) {
                    console.error(`Error fetching corporation ${corpId}:`, e);
                    return { id: corpId, info: { name: 'Unknown Corporation', war_eligible: false } };
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
            updateProgress(processedCorps, uniqueCorpIds.length, 
                `Getting corporation information (${processedCorps}/${uniqueCorpIds.length})...`);

            // Only delay between chunks if we have more API calls to make
            if (i + 1 < corpChunks.length) {
                await new Promise(resolve => setTimeout(resolve, CHUNK_DELAY));
            }
        }
    }

    // Step 5: Get alliance info with smart caching (if any alliances exist)
    if (uniqueAllianceIds.length > 0) {
        updateProgress(0, uniqueAllianceIds.length, "Getting alliance information...");
        
        // Check which alliances need API calls vs cache
        const cachedAlliances = [];
        const uncachedAllianceIds = [];
        
        uniqueAllianceIds.forEach(allianceId => {
            if (allianceInfoCache.has(allianceId) || getCachedData('alliance', allianceId)) {
                cachedAlliances.push(allianceId);
            } else {
                uncachedAllianceIds.push(allianceId);
            }
        });

        const allianceMap = new Map();
        let processedAlliances = 0;

        // Process cached alliances instantly (no chunks, no delays)
        if (cachedAlliances.length > 0) {
            for (const allianceId of cachedAlliances) {
                try {
                    const info = await getAllianceInfo(allianceId); // This will be instant from cache
                    allianceMap.set(allianceId, info);
                    processedAlliances++;
                    updateProgress(processedAlliances, uniqueAllianceIds.length, 
                        `Getting alliance information (${processedAlliances}/${uniqueAllianceIds.length})...`);
                } catch (e) {
                    console.error(`Error fetching cached alliance ${allianceId}:`, e);
                    allianceMap.set(allianceId, { name: 'Unknown Alliance' });
                    processedAlliances++;
                }
            }
        }

        // Process uncached alliances in chunks with delays (only if we have API calls to make)
        if (uncachedAllianceIds.length > 0) {
            const allianceChunks = chunkArray(uncachedAllianceIds, CHUNK_SIZE);

            for (let i = 0; i < allianceChunks.length; i++) {
                const chunk = allianceChunks[i];
                
                // Process all alliances in this chunk concurrently
                const chunkPromises = chunk.map(async (allianceId) => {
                    try {
                        const info = await getAllianceInfo(allianceId);
                        return { id: allianceId, info };
                    } catch (e) {
                        console.error(`Error fetching alliance ${allianceId}:`, e);
                        return { id: allianceId, info: { name: 'Unknown Alliance' } };
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
                updateProgress(processedAlliances, uniqueAllianceIds.length, 
                    `Getting alliance information (${processedAlliances}/${uniqueAllianceIds.length})...`);

                // Only delay between chunks if we have more API calls to make
                if (i + 1 < allianceChunks.length) {
                    await new Promise(resolve => setTimeout(resolve, CHUNK_DELAY));
                }
            }
        }

        // Step 6: Build final results (with alliances)
        updateProgress(0, characters.length, "Building final results...");
        const results = [];

        for (let i = 0; i < characters.length; i++) {
            const char = characters[i];
            try {
                const affiliation = affiliationMap.get(char.id);
                if (!affiliation) {
                    throw new Error(`No affiliation found for character ${char.name}`);
                }

                const corpInfo = corpMap.get(affiliation.corporation_id);
                if (!corpInfo) {
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
    } else {
        // Step 6: Build final results (no alliances)
        updateProgress(0, characters.length, "Building final results...");
        const results = [];

        for (let i = 0; i < characters.length; i++) {
            const char = characters[i];
            try {
                const affiliation = affiliationMap.get(char.id);
                if (!affiliation) {
                    throw new Error(`No affiliation found for character ${char.name}`);
                }

                const corpInfo = corpMap.get(affiliation.corporation_id);
                if (!corpInfo) {
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

                if (corpInfo.war_eligible !== undefined) result.war_eligible = corpInfo.war_eligible;
                results.push(result);
            } catch (e) {
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
}

function createCharacterItem(character, viewType = 'grid') {
    const item = document.createElement("div");
    item.className = `result-item ${viewType}-view`;
    
    const placeholder = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E%3C/svg%3E";
    
    // FIXED: Only create alliance section if character actually has an alliance
    const allianceSection = character.alliance_name && character.alliance_id ? `
        <div class="org-item">
            <img src="${placeholder}" 
                 data-src="https://images.evetech.net/alliances/${character.alliance_id}/logo?size=32"
                 data-placeholder="${placeholder}"
                 alt="${character.alliance_name}" 
                 class="org-logo" 
                 loading="lazy" 
                 decoding="async">
            <a href="https://zkillboard.com/alliance/${character.alliance_id}/" 
               target="_blank" 
               class="character-link">${character.alliance_name}</a>
        </div>
    ` : '';
    
    item.innerHTML = `
        <img src="${placeholder}" 
             data-src="https://images.evetech.net/characters/${character.character_id}/portrait?size=64"
             data-placeholder="${placeholder}"
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
                             data-src="https://images.evetech.net/corporations/${character.corporation_id}/logo?size=32"
                             data-placeholder="${placeholder}"
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
    `;
    
    // Only observe images and animations for non-virtual scrolling contexts
    const lazyImages = item.querySelectorAll('img[data-src]');
    lazyImages.forEach(img => getImageObserver().observe(img));
    
    return item;
}

function updateElementContent(element, character, viewType) {
    // Update the element's content without recreating it
    const avatar = element.querySelector('.character-avatar');
    const characterLink = element.querySelector('.character-name a');
    const corpLogo = element.querySelector('.corp-alliance-info .org-logo');
    const corpLink = element.querySelector('.corp-alliance-info .character-link');
    
    if (avatar) {
        avatar.alt = character.character_name;
        avatar.dataset.src = `https://images.evetech.net/characters/${character.character_id}/portrait?size=64`;
        if (avatar.dataset.src !== avatar.src) {
            getImageObserver().observe(avatar);
        }
    }
    
    if (characterLink) {
        characterLink.textContent = character.character_name;
        characterLink.href = `https://zkillboard.com/character/${character.character_id}/`;
    }
    
    if (corpLogo) {
        corpLogo.alt = character.corporation_name;
        corpLogo.dataset.src = `https://images.evetech.net/corporations/${character.corporation_id}/logo?size=32`;
        if (corpLogo.dataset.src !== corpLogo.src) {
            getImageObserver().observe(corpLogo);
        }
    }
    
    if (corpLink) {
        corpLink.textContent = character.corporation_name;
        corpLink.href = `https://zkillboard.com/corporation/${character.corporation_id}/`;
    }
    
    // FIXED: Handle alliance info properly
    const corpAllianceInfo = element.querySelector('.corp-alliance-info');
    let allianceSection = element.querySelector('.org-item:last-child');
    
    // Check if the alliance section is actually for alliance (not corp)
    const isAllianceSection = allianceSection && allianceSection.querySelector('a[href*="/alliance/"]');
    
    if (character.alliance_name && character.alliance_id) {
        if (!isAllianceSection) {
            // Need to create alliance section
            const newAllianceSection = document.createElement('div');
            newAllianceSection.className = 'org-item';
            newAllianceSection.innerHTML = `
                <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E%3C/svg%3E" 
                     data-src="https://images.evetech.net/alliances/${character.alliance_id}/logo?size=32"
                     alt="${character.alliance_name}" 
                     class="org-logo" 
                     loading="lazy" 
                     decoding="async">
                <a href="https://zkillboard.com/alliance/${character.alliance_id}/" 
                   target="_blank" 
                   class="character-link">${character.alliance_name}</a>
            `;
            corpAllianceInfo.appendChild(newAllianceSection);
            const allianceLogo = newAllianceSection.querySelector('.org-logo');
            getImageObserver().observe(allianceLogo);
        } else {
            // Update existing alliance section
            const allianceLogo = allianceSection.querySelector('.org-logo');
            const allianceLink = allianceSection.querySelector('.character-link');
            
            if (allianceLogo) {
                allianceLogo.alt = character.alliance_name;
                allianceLogo.dataset.src = `https://images.evetech.net/alliances/${character.alliance_id}/logo?size=32`;
                getImageObserver().observe(allianceLogo);
            }
            
            if (allianceLink) {
                allianceLink.textContent = character.alliance_name;
                allianceLink.href = `https://zkillboard.com/alliance/${character.alliance_id}/`;
            }
        }
    } else {
        // Character has no alliance, remove alliance section if it exists
        if (isAllianceSection) {
            allianceSection.remove();
        }
    }
}

function getLocalStorageSize() {
    let total = 0;
    for (let key in localStorage) {
        if (localStorage.hasOwnProperty(key)) {
            total += localStorage[key].length + key.length;
        }
    }
    return (total / 1024 / 1024).toFixed(1); // Return size in MB
}
function updatePerformanceStats() {
    const queryTime = Math.round(queryEndTime - queryStartTime);
    const storageSize = getLocalStorageSize();

    document.getElementById("query-time").textContent = queryTime;
    document.getElementById("esi-lookups").textContent = esiLookups;
    document.getElementById("cache-info").textContent = localLookups;
    document.getElementById("cache-size").textContent = `Size: ${storageSize} MB`;
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
    if (now - lastProgressUpdate < 50 && current < total) return;

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
    const maxItems = 10;

    if (type === 'alliance') {
        const corps = allianceToCorpsMap.get(entity.id) || [];
        items = corps.slice(0, maxItems);
        content = `
      <div class="mouseover-card-header">Corporations in ${entity.name}</div>
      <div class="mouseover-card-content">
        ${items.map(corp => `
          <div class="mouseover-card-item">
            <img src="https://images.evetech.net/corporations/${corp.id}/logo?size=32" 
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
            <img src="https://images.evetech.net/characters/${char.character_id}/portrait?size=32" 
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

// Global observer for all images to reduce overhead
let globalImageObserver = null;
let imageLoadQueue = [];
let currentlyLoading = 0;


function getImageObserver() {
    if (!globalImageObserver) {
        globalImageObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    if (img.dataset.src && !img.src.startsWith('https://') && document.contains(img)) {
                        img.dataset.loading = 'true';
                        imageLoadQueue.push(img);
                        globalImageObserver.unobserve(img);
                        processImageQueue();
                    }
                }
            });
        }, {
            rootMargin: '50px',
            threshold: 0.1
        });
    }
    return globalImageObserver;
}

// Add this new animation observer
let animationObserver = null;

function getAnimationObserver() {
    if (!animationObserver) {
        animationObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('animate-in');
                    animationObserver.unobserve(entry.target);
                }
            });
        }, {
            rootMargin: '20px 0px',
            threshold: 0.01
        });
    }
    return animationObserver;
}

function processImageQueue() {
    while (imageLoadQueue.length > 0 && currentlyLoading < MAX_CONCURRENT_IMAGES) {
        const img = imageLoadQueue.shift();
        // Check if image is still in DOM and needs loading
        if (img && img.dataset.src && document.contains(img) && !img.src.startsWith('https://')) {
            loadSingleImage(img);
        }
        // If image is not valid, just continue to next one
    }
}

function loadSingleImage(img) {
    const realSrc = img.dataset.src;
    if (!realSrc || img.src === realSrc) return;

    currentlyLoading++;
    
    const onLoad = () => {
        currentlyLoading--;
        img.removeEventListener('load', onLoad);
        img.removeEventListener('error', onError);
        delete img.dataset.loading;
        processImageQueue();
    };
    
    const onError = () => {
        currentlyLoading--;
        img.removeEventListener('load', onLoad);
        img.removeEventListener('error', onError);
        delete img.dataset.loading;
        // Set a fallback image or hide the broken image
        img.style.opacity = '0.3';
        processImageQueue();
    };
    
    img.addEventListener('load', onLoad);
    img.addEventListener('error', onError);
    img.src = realSrc;
}

function cleanupObservers() {
    if (globalImageObserver) {
        globalImageObserver.disconnect();
        globalImageObserver = null;
    }
    if (animationObserver) {
        animationObserver.disconnect();
        animationObserver = null;
    }
}

function createOptimizedImage(src, alt, className) {
    const img = document.createElement("img");
    img.className = className;
    img.alt = alt;
    img.loading = "lazy";
    img.decoding = "async";
    
    const placeholder = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E%3C/svg%3E";
    img.src = placeholder;
    img.dataset.src = src;
    img.dataset.placeholder = placeholder;

    getImageObserver().observe(img);
    return img;
}


function createCharacterItem(character, viewType = 'grid') {
    const item = document.createElement("div");
    item.className = `result-item ${viewType}-view animate-ready`;
    
    const placeholder = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E%3C/svg%3E";
    
    const allianceSection = character.alliance_name && character.alliance_id ? `
        <div class="org-item">
            <img src="${placeholder}" 
                 data-src="https://images.evetech.net/alliances/${character.alliance_id}/logo?size=32"
                 alt="${character.alliance_name}" 
                 class="org-logo" 
                 loading="lazy" 
                 decoding="async">
            <a href="https://zkillboard.com/alliance/${character.alliance_id}/" 
               target="_blank" 
               class="character-link">${character.alliance_name}</a>
        </div>
    ` : '';
    
    item.innerHTML = `
        <img src="${placeholder}" 
             data-src="https://images.evetech.net/characters/${character.character_id}/portrait?size=64"
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
                             data-src="https://images.evetech.net/corporations/${character.corporation_id}/logo?size=32"
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
    `;
    
    // Observe all lazy images immediately - no setTimeout needed
    const lazyImages = item.querySelectorAll('img[data-src]');
    lazyImages.forEach(img => getImageObserver().observe(img));
    
    // Single animation observer
    getAnimationObserver().observe(item);
    
    return item;
}


function createSummaryItem({ id, name, count, type }) {
    const item = document.createElement("div");
    item.className = "summary-item";

    // Use optimized image loading
    const logo = createOptimizedImage(
        `https://images.evetech.net/${type}s/${id}/logo?size=32`,
        name,
        "summary-logo"
    );
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
    return item;
}

// Virtual scrolling implementation
const VIRTUAL_ITEM_HEIGHT = 125; // Approximate height of each item in pixels
const VIRTUAL_BUFFER = 30; // Items to render outside visible area
const ROWS_TO_SHOW = 5;

let virtualScrollStates = {
    'eligible-grid': { scrollTop: 0, containerHeight: 0 },
    'ineligible-grid': { scrollTop: 0, containerHeight: 0 }
};

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

        // Convert to virtual scrolling container
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

        const fragment = document.createDocumentFragment();
        items.forEach(item => fragment.appendChild(createSummaryItem(item)));

        container.innerHTML = "";
        container.appendChild(fragment);
    }
}

// Image preloading and caching system
const imageCache = new Map();

function preloadImage(src) {
    if (imageCache.has(src)) {
        return imageCache.get(src);
    }
    
    const img = new Image();
    const promise = new Promise((resolve, reject) => {
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
    });
    
    imageCache.set(src, promise);
    return promise;
}

function createCharacterItemWithCachedImages(character, viewType = 'grid') {
    const item = document.createElement("div");
    item.className = `result-item ${viewType}-view`;
    
    // Pre-cache the images
    const portraitSrc = `https://images.evetech.net/characters/${character.character_id}/portrait?size=64`;
    const corpSrc = `https://images.evetech.net/corporations/${character.corporation_id}/logo?size=32`;
    
    preloadImage(portraitSrc);
    preloadImage(corpSrc);
    
    if (character.alliance_id) {
        const allianceSrc = `https://images.evetech.net/alliances/${character.alliance_id}/logo?size=32`;
        preloadImage(allianceSrc);
    }
    
    const allianceSection = character.alliance_name && character.alliance_id ? `
        <div class="org-item">
            <img src="https://images.evetech.net/alliances/${character.alliance_id}/logo?size=32"
                 alt="${character.alliance_name}" 
                 class="org-logo" 
                 loading="lazy" 
                 decoding="async">
            <a href="https://zkillboard.com/alliance/${character.alliance_id}/" 
               target="_blank" 
               class="character-link">${character.alliance_name}</a>
        </div>
    ` : '';
    
    item.innerHTML = `
        <img src="${portraitSrc}"
             alt="${character.character_name}" 
             class="character-avatar" 
             loading="eager" 
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
                        <img src="${corpSrc}"
                             alt="${character.corporation_name}" 
                             class="org-logo" 
                             loading="eager" 
                             decoding="async">
                        <a href="https://zkillboard.com/corporation/${character.corporation_id}/" 
                           target="_blank" 
                           class="character-link">${character.corporation_name}</a>
                    </div>
                    ${allianceSection}
                </div>
            </div>
        </div>
    `;
    
    return item;
}


function setupVirtualScrolling(containerId, items) {
    const container = document.getElementById(containerId);

    // handle case where container is not found
    if (!container) {
        console.warn(`Container with id "${containerId}" not found`);
        return;
    }
    
    // Find the parent grid - try different selectors
    let parentGrid = container.closest('.result-grid');
    if (!parentGrid) {
        // If closest doesn't work, try parent element
        parentGrid = container.parentElement;
        // If parent doesn't have result-grid class, the container itself might be the grid
        if (!parentGrid || !parentGrid.classList.contains('result-grid')) {
            parentGrid = container;
        }
    }
    
    if (!parentGrid) {
        console.warn(`Parent grid not found for container "${containerId}"`);
        return;
    }
    
    // Clear any existing virtual scroll setup
    if (container._scrollListener) {
        container.removeEventListener('scroll', container._scrollListener);
        delete container._scrollListener;
    }
    
    // Add CSS classes instead of inline styles
    parentGrid.classList.add('virtual-enabled');
    
    const isListView = parentGrid.classList.contains('list-view');
    const itemHeight = isListView ? 90 : 150;
    const containerWidth = parentGrid.clientWidth - 60;
    const itemsPerRow = isListView ? 1 : Math.max(1, Math.floor(containerWidth / 270));
    const totalRows = Math.ceil(items.length / itemsPerRow);
    const totalHeight = totalRows * itemHeight;
    
    // Apply CSS classes instead of inline styles
    container.className = 'virtual-scroll-container';
    
    // Create structure with CSS classes
    const spacer = document.createElement('div');
    spacer.className = 'virtual-scroll-spacer';
    spacer.style.height = totalHeight + 'px'; // Only dynamic style needed
    
    const content = document.createElement('div');
    content.className = `virtual-scroll-content ${isListView ? 'list-view' : ''}`;
    
    container.innerHTML = '';
    spacer.appendChild(content);
    container.appendChild(spacer);
    
    let isUpdating = false;
    let lastStartIndex = -1;
    let lastEndIndex = -1;
    
    function updateVisibleItems() {
        if (isUpdating) return;
        isUpdating = true;
        
        const scrollTop = container.scrollTop;
        const containerHeight = container.clientHeight;
        const buffer = 20;
        
        const startRow = Math.max(0, Math.floor(scrollTop / itemHeight) - buffer);
        const endRow = Math.min(totalRows, Math.ceil((scrollTop + containerHeight) / itemHeight) + buffer);
        
        const startIndex = startRow * itemsPerRow;
        const endIndex = Math.min(items.length, endRow * itemsPerRow);
        
        if (startIndex === lastStartIndex && endIndex === lastEndIndex) {
            isUpdating = false;
            return;
        }
        
        lastStartIndex = startIndex;
        lastEndIndex = endIndex;
        
        // Only transform is dynamic
        content.style.transform = `translateY(${startRow * itemHeight}px)`;
        
        requestAnimationFrame(() => {
            const fragment = document.createDocumentFragment();
            
            for (let i = startIndex; i < endIndex; i++) {
                if (items[i]) {
                    const element = createCharacterItem(items[i], isListView ? 'list' : 'grid');
                    fragment.appendChild(element);
                }
            }
            
            content.innerHTML = '';
            content.appendChild(fragment);
            isUpdating = false;
        });
    }
    
    let scrollTicking = false;
    function onScroll() {
        if (!scrollTicking) {
            requestAnimationFrame(() => {
                updateVisibleItems();
                scrollTicking = false;
            });
            scrollTicking = true;
        }
    }
    
    container._scrollListener = onScroll;
    container.addEventListener('scroll', onScroll, { passive: true });
    
    updateVisibleItems();
    
    container._cleanup = () => {
        if (container._scrollListener) {
            container.removeEventListener('scroll', container._scrollListener);
            delete container._scrollListener;
        }
        // Remove CSS classes when cleaning up
        if (parentGrid && parentGrid.classList) {
            parentGrid.classList.remove('virtual-enabled');
        }
        // Reset container to original class
        if (container) {
            container.className = container.className.replace('virtual-scroll-container', '').trim() || 'result-grid';
        }
    };
}

let lastTimerUpdate = 0;
function updateTimer() {
    const now = Date.now();
    // 100ms update
    if (now - lastTimerUpdate < 100) return;

    const elapsed = ((now - startTime) / 1000).toFixed(1);
    document.getElementById("timer").textContent = `Elapsed: ${elapsed}s`;
    lastTimerUpdate = now;
}

function startLoading() {
    const lc = document.getElementById("loading-container");
    const rs = document.getElementById("results-section");
    const cb = document.getElementById("checkButton");
    const ec = document.getElementById("error-container");

    // Collapse input section and disable hover during loading
    const inputSection = document.getElementById('input-section');
    collapseInputSection();
    inputSection.classList.add('loading'); // Add class to disable hover

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

    startTime = Date.now();
    timerInterval = setInterval(updateTimer, 100);
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
        }, 500);
    }, 300);
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
        <div class="error-title">Connection Error</div>
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
    const eligibleToShow = expandedSections.eligible
        ? allResults.eligible
        : allResults.eligible.slice(0, displayedResults.eligible);

    const ineligibleToShow = expandedSections.ineligible
        ? allResults.ineligible
        : allResults.ineligible.slice(0, displayedResults.ineligible);

    renderGrid("eligible-grid", eligibleToShow, 'character');
    renderGrid("ineligible-grid", ineligibleToShow, 'character');

    // Update load more buttons
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

// Add this before updateCharacterCount function
let characterCountTimeout = null;

function debouncedUpdateCharacterCount() {
    if (characterCountTimeout) {
        clearTimeout(characterCountTimeout);
    }

    characterCountTimeout = setTimeout(() => {
        updateCharacterCount();
    }, 150); // 150ms debounce
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
            console.error("Too many items error:", err);
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
    const textarea = document.getElementById('names');
    textarea.addEventListener('input', debouncedUpdateCharacterCount);
    textarea.addEventListener('keydown', function (e) {
        if (e.ctrlKey && e.key === 'Enter') {
            validateNames();
        }
    });

    // Initialize character count
    updateCharacterCount();

    // Setup collapsed indicator click functionality
    setupCollapsedIndicatorClick();

    // update version
    updateVersionDisplay();
});
