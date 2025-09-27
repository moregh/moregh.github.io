/*
    War Target Finder - EVE ESI API Integration
    
    Copyright (C) 2025 moregh (https://github.com/moregh/)
    Licensed under AGPL License.
*/

import { MAX_ESI_CALL_SIZE, CHUNK_SIZE, CHUNK_DELAY } from './config.js';
import { sanitizeCharacterData, sanitizeCorporationData, sanitizeAllianceData, sanitizeId, sanitizeCharacterName, sanitizeCorporationName, sanitizeAllianceName } from './xss-protection.js';
import {
    getCachedNameToId,
    setCachedNameToId,
    getCachedAffiliation,
    setCachedAffiliation,
    getCachedCorporationInfo,
    setCachedCorporationInfo,
    getCachedAllianceInfo,
    setCachedAllianceInfo
} from './database.js';
import { updateProgress, showWarning, showError } from './ui.js';
import { esiClient } from './esi-client.js';

// Program caches
const corporationInfoCache = new Map();
const allianceInfoCache = new Map();
const characterNameToIdCache = new Map();
const characterAffiliationCache = new Map();

// Local cache hit tracking
let localCacheHits = 0;

function incrementLocalCacheHits() {
    localCacheHits++;
}

function getLocalCacheHits() {
    return localCacheHits;
}

function resetLocalCacheHits() {
    localCacheHits = 0;
}

export function getCounters() {
    const stats = esiClient.getStats();
    return {
        esiLookups: stats.requests,
        localLookups: getLocalCacheHits()
    };
}

export function resetCounters() {
    esiClient.resetStats();
    resetLocalCacheHits();
}

export function chunkArray(array, chunkSize) {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
        chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
}

export async function processInChunks(items, processFn, chunkSize = CHUNK_SIZE, delay = CHUNK_DELAY) {
    const results = [];
    const totalChunks = items.length;

    for (let i = 0; i < items.length; i++) {
        const item = items[i];

        try {
            const result = await processFn(item, i, totalChunks);
            if (result !== null && result !== undefined) {
                if (Array.isArray(result)) {
                    results.push(...result);
                } else {
                    results.push(result);
                }
            }
        } catch (e) {
            showWarning(`Error processing chunk ${i + 1}/${totalChunks}: ${e.message}`);
            console.error(`Error processing chunk ${i + 1}/${totalChunks}:`, e);

            // Handle different error types appropriately
            if (e.message.includes('character IDs') || e.message.includes('character names')) {
                results.push([]); // Empty array for failed character lookups
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

export async function getCharacterIds(names) {
    const cachedCharacters = [];
    const uncachedNames = [];

    // First, check cache for all names
    for (const name of names) {
        const lowerName = name.toLowerCase();
        if (characterNameToIdCache.has(lowerName)) {
            cachedCharacters.push(characterNameToIdCache.get(lowerName));
            incrementLocalCacheHits();
            continue;
        }

        const cached = await getCachedNameToId(name);
        if (cached) {
            characterNameToIdCache.set(lowerName, cached);
            cachedCharacters.push(cached);
            incrementLocalCacheHits();
            continue;
        }

        uncachedNames.push(name);
    }

    let fetchedCharacters = [];

    if (uncachedNames.length > 0) {
        updateProgress(0, uncachedNames.length, `Looking up ${uncachedNames.length} character names...`);

        fetchedCharacters = await processInChunks(
            chunkArray(uncachedNames, MAX_ESI_CALL_SIZE),
            async (nameChunk, index, totalChunks) => {
                updateProgress(index * MAX_ESI_CALL_SIZE, uncachedNames.length,
                    `Looking up character names (batch ${index + 1}/${totalChunks})...`);

                try {
                    const data = await esiClient.post('/universe/ids/', nameChunk);
                    const characters = data?.characters || [];

                    // Cache each character immediately
                    for (const char of characters) {
                        await setCachedNameToId(char.name, char);
                        // Also update in-memory cache
                        characterNameToIdCache.set(char.name.toLowerCase(), char);
                    }

                    return characters;
                } catch (error) {
                    console.error(`Failed to get character IDs for batch ${index + 1}:`, error);
                    throw new Error(`Failed to get character IDs for batch ${index + 1}: ${error.message}`);
                }
            },
            MAX_ESI_CALL_SIZE,
            CHUNK_DELAY
        );

        // Flatten the results (each chunk returns an array of characters)
        fetchedCharacters = fetchedCharacters.flat().filter(char => char !== null);
    }

    return [...cachedCharacters, ...fetchedCharacters];
}

export async function getCharacterAffiliations(characterIds) {
    const cachedAffiliations = [];
    const uncachedIds = [];

    // Check cache first
    for (const id of characterIds) {
        if (characterAffiliationCache.has(id)) {
            cachedAffiliations.push(characterAffiliationCache.get(id));
            incrementLocalCacheHits();
            continue;
        }

        const cached = await getCachedAffiliation(id);
        if (cached) {
            characterAffiliationCache.set(id, cached);
            cachedAffiliations.push(cached);
            incrementLocalCacheHits();
            continue;
        }

        uncachedIds.push(id);
    }

    let fetchedAffiliations = [];

    if (uncachedIds.length > 0) {
        updateProgress(0, uncachedIds.length, `Getting character affiliations...`);

        fetchedAffiliations = await processInChunks(
            chunkArray(uncachedIds, MAX_ESI_CALL_SIZE),
            async (idChunk, index, totalChunks) => {
                updateProgress(index * MAX_ESI_CALL_SIZE, uncachedIds.length,
                    `Getting character affiliations (batch ${index + 1}/${totalChunks})...`);

                try {
                    const affiliations = await esiClient.post('/characters/affiliation/', idChunk);

                    if (!Array.isArray(affiliations)) {
                        throw new Error('Invalid response format from affiliations endpoint');
                    }

                    // Cache each affiliation immediately
                    for (const affiliation of affiliations) {
                        await setCachedAffiliation(affiliation.character_id, affiliation);
                        // Also update in-memory cache
                        characterAffiliationCache.set(affiliation.character_id, affiliation);
                    }

                    return affiliations;
                } catch (error) {
                    console.error(`Failed to get character affiliations for batch ${index + 1}:`, error);
                    throw new Error(`Failed to get character affiliations for batch ${index + 1}: ${error.message}`);
                }
            },
            MAX_ESI_CALL_SIZE,
            CHUNK_DELAY
        );

        // Flatten the results (each chunk returns an array of affiliations)
        fetchedAffiliations = fetchedAffiliations.flat().filter(affiliation => affiliation !== null);
    }

    return [...cachedAffiliations, ...fetchedAffiliations];
}

// Function to get corporation information with smart caching
export async function getCorporationInfoWithCaching(uniqueCorpIds) {
    updateProgress(0, uniqueCorpIds.length, "Getting corporation information...");

    // Step 1: Check which corps need API calls vs cache
    const cachedCorps = [];
    const uncachedCorpIds = [];

    uniqueCorpIds.forEach(corpId => {
        if (corporationInfoCache.has(corpId)) {
            cachedCorps.push(corpId);
            incrementLocalCacheHits();
        } else {
            uncachedCorpIds.push(corpId);
        }
    });

    const corpMap = new Map();
    let processedCorps = 0;

    // Step 2: Process cached corps instantly
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

    // Step 3: Check IndexedDB cache for uncached corps
    const uncachedFromDB = await checkIndexedDBCache(uncachedCorpIds, corpMap, 'corporation');
    processedCorps += (uncachedCorpIds.length - uncachedFromDB.length);

    if (processedCorps > cachedCorps.length) {
        updateProgress(processedCorps, uniqueCorpIds.length,
            `Getting corporation information (${processedCorps}/${uniqueCorpIds.length})...`);
    }

    // Step 4: Process uncached corps with API calls
    if (uncachedFromDB.length > 0) {
        await processUncachedCorporations(uncachedFromDB, corpMap, processedCorps, uniqueCorpIds.length);
    }

    return corpMap;
}

// Function to get alliance information with smart caching
export async function getAllianceInfoWithCaching(uniqueAllianceIds) {
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
            incrementLocalCacheHits();
        } else {
            uncachedAllianceIds.push(allianceId);
        }
    });

    const allianceMap = new Map();
    let processedAlliances = 0;

    // Step 2: Process cached alliances instantly
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

    // Step 3: Check IndexedDB cache for uncached alliances
    const uncachedFromDB = await checkIndexedDBCache(uncachedAllianceIds, allianceMap, 'alliance');
    processedAlliances += (uncachedAllianceIds.length - uncachedFromDB.length);

    if (processedAlliances > cachedAlliances.length) {
        updateProgress(processedAlliances, uniqueAllianceIds.length,
            `Getting alliance information (${processedAlliances}/${uniqueAllianceIds.length})...`);
    }

    // Step 4: Process uncached alliances with API calls
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
            incrementLocalCacheHits();
        } else {
            stillUncached.push(result.id);
        }
    });

    return stillUncached;
}

// Function to process uncached corporations via API using batch requests
async function processUncachedCorporations(uncachedIds, corpMap, startingCount, totalCount) {
    const corpChunks = chunkArray(uncachedIds, CHUNK_SIZE);
    let processedCorps = startingCount;

    for (let i = 0; i < corpChunks.length; i++) {
        const chunk = corpChunks[i];

        // Create batch requests for this chunk
        const batchRequests = chunk.map(corpId => ({
            method: 'GET',
            endpoint: `/corporations/${corpId}/`,
            corpId // Add corpId for reference in results
        }));

        try {
            // Use ESI client's batch functionality
            const chunkResults = await esiClient.batchRequests(batchRequests, {
                maxConcurrency: 8, // Conservative concurrency for corporation requests
                chunkDelay: CHUNK_DELAY,
                onProgress: (completed, total) => {
                    const overallCompleted = processedCorps + completed;
                    updateProgress(overallCompleted, totalCount,
                        `Getting corporation information (${overallCompleted}/${totalCount})...`);
                }
            });

            // Process results and cache them
            for (let j = 0; j < chunkResults.length; j++) {
                const result = chunkResults[j];
                const request = batchRequests[j];
                const corpId = request.corpId;

                let corporationInfo;

                if (result && result.name !== undefined) {
                    // Successful response - sanitize the data
                    corporationInfo = {
                        name: sanitizeCorporationName(result.name),
                        war_eligible: Boolean(result.war_eligible)
                    };
                } else {
                    // Failed response or null
                    console.warn(`Failed to get corporation info for ${corpId}`);
                    corporationInfo = {
                        name: 'Unknown Corporation',
                        war_eligible: false
                    };
                }

                // Cache in memory and IndexedDB
                corporationInfoCache.set(corpId, corporationInfo);
                await setCachedCorporationInfo(corpId, corporationInfo);
                corpMap.set(corpId, corporationInfo);
            }

        } catch (error) {
            console.error(`Failed to process corporation chunk ${i + 1}:`, error);

            // Fallback: create entries for all corps in this chunk
            chunk.forEach(corpId => {
                const fallbackInfo = { name: 'Unknown Corporation', war_eligible: false };
                corporationInfoCache.set(corpId, fallbackInfo);
                corpMap.set(corpId, fallbackInfo);
            });
        }

        processedCorps += chunk.length;
        updateProgress(processedCorps, totalCount,
            `Getting corporation information (${processedCorps}/${totalCount})...`);

        // Small delay between chunks
        if (i + 1 < corpChunks.length) {
            await new Promise(resolve => setTimeout(resolve, CHUNK_DELAY));
        }
    }
}

// Function to process uncached alliances via API using batch requests
async function processUncachedAlliances(uncachedIds, allianceMap, startingCount, totalCount) {
    const allianceChunks = chunkArray(uncachedIds, CHUNK_SIZE);
    let processedAlliances = startingCount;

    for (let i = 0; i < allianceChunks.length; i++) {
        const chunk = allianceChunks[i];

        // Create batch requests for this chunk
        const batchRequests = chunk.map(allianceId => ({
            method: 'GET',
            endpoint: `/alliances/${allianceId}/`,
            allianceId // Add allianceId for reference in results
        }));

        try {
            // Use ESI client's batch functionality
            const chunkResults = await esiClient.batchRequests(batchRequests, {
                maxConcurrency: 8, // Conservative concurrency for alliance requests
                chunkDelay: CHUNK_DELAY,
                onProgress: (completed, total) => {
                    const overallCompleted = processedAlliances + completed;
                    updateProgress(overallCompleted, totalCount,
                        `Getting alliance information (${overallCompleted}/${totalCount})...`);
                }
            });

            // Process results and cache them
            for (let j = 0; j < chunkResults.length; j++) {
                const result = chunkResults[j];
                const request = batchRequests[j];
                const allianceId = request.allianceId;

                let allianceInfo;

                if (result && result.name !== undefined) {
                    // Successful response - sanitize the data
                    allianceInfo = {
                        name: sanitizeAllianceName(result.name)
                    };
                } else {
                    // Failed response or null
                    console.warn(`Failed to get alliance info for ${allianceId}`);
                    allianceInfo = {
                        name: 'Unknown Alliance'
                    };
                }

                // Cache in memory and IndexedDB
                allianceInfoCache.set(allianceId, allianceInfo);
                await setCachedAllianceInfo(allianceId, allianceInfo);
                allianceMap.set(allianceId, allianceInfo);
            }

        } catch (error) {
            console.error(`Failed to process alliance chunk ${i + 1}:`, error);

            // Fallback: create entries for all alliances in this chunk
            chunk.forEach(allianceId => {
                const fallbackInfo = { name: 'Unknown Alliance' };
                allianceInfoCache.set(allianceId, fallbackInfo);
                allianceMap.set(allianceId, fallbackInfo);
            });
        }

        processedAlliances += chunk.length;
        updateProgress(processedAlliances, totalCount,
            `Getting alliance information (${processedAlliances}/${totalCount})...`);

        // Small delay between chunks
        if (i + 1 < allianceChunks.length) {
            await new Promise(resolve => setTimeout(resolve, CHUNK_DELAY));
        }
    }
}

// Function to build final character results
export function buildCharacterResults(characters, affiliationMap, corpMap, allianceMap) {
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
                character_name: sanitizeCharacterName(char.name),
                character_id: sanitizeId(char.id),
                corporation_name: sanitizeCorporationName(corpInfo.name),
                corporation_id: sanitizeId(affiliation.corporation_id),
                alliance_name: null,
                alliance_id: null,
                war_eligible: false
            };

            if (affiliation.alliance_id) {
                const allianceInfo = allianceMap.get(affiliation.alliance_id);
                if (allianceInfo) {
                    result.alliance_name = sanitizeAllianceName(allianceInfo.name);
                    result.alliance_id = sanitizeId(affiliation.alliance_id);
                }
            }

            if (corpInfo.war_eligible !== undefined) result.war_eligible = Boolean(corpInfo.war_eligible);
            results.push(result);
        } catch (e) {
            showError(`Error processing character ${char.name}: ${e}`);
            console.error(`Error processing character ${char.name}:`, e);
            results.push({
                character_name: sanitizeCharacterName(char.name),
                character_id: sanitizeId(char.id),
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

// Function to handle missing character warnings
export async function handleMissingCharacters(characters, originalNames) {
    if (characters.length !== originalNames.length) {
        const foundNames = new Set(characters.map(c => c.name.toLowerCase()));
        const missingNames = originalNames.filter(name => !foundNames.has(name.toLowerCase()));
        console.warn(`Could not find ${missingNames.length} character(s):`, missingNames);

        if (missingNames.length > 0) {
            updateProgress(0, 0, `Warning: ${missingNames.length} character names not found`);
            await new Promise(resolve => setTimeout(resolve, 1500));
        }
    }
}

// Main validator function - now much cleaner and focused
export async function validator(names) {
    // Reset counters at start
    resetCounters();

    try {
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

    } catch (error) {
        // Enhanced error handling with ESI-specific error types
        if (error.name === 'ESIRateLimitError') {
            throw new Error(`Rate limit exceeded. Please wait ${error.retryAfter} seconds before trying again.`);
        } else if (error.name === 'ESIServerError') {
            throw new Error(`EVE ESI servers are experiencing issues (${error.status}). Please try again later.`);
        } else if (error.name === 'ESIError') {
            throw new Error(`ESI API error: ${error.message}`);
        } else {
            // Re-throw other errors as-is
            throw error;
        }
    }
}