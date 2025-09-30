/*
    EVE Target Intel - EVE ESI API Integration
    
    Copyright (C) 2025 moregh (https://github.com/moregh/)
    Licensed under AGPL License.
*/

import { MAX_ESI_CALL_SIZE, CHUNK_SIZE, CHUNK_DELAY } from './config.js';
import { sanitizeId } from './xss-protection.js';
import {
    getCachedNameToId, setCachedNameToId, getCachedAffiliation, setCachedAffiliation, getCachedCorporationInfo,
    setCachedCorporationInfo, getCachedAllianceInfo, setCachedAllianceInfo, getCachedEntityName, setCachedEntityName
} from './database.js';
import { updateProgress, showWarning, showError } from './ui.js';
import { esiClient } from './esi-client.js';
import { validateEntityName } from './validation.js';

const corporationInfoCache = new Map();
const allianceInfoCache = new Map();
const characterNameToIdCache = new Map();
const characterAffiliationCache = new Map();

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

export async function processInChunks(items, processFn, delay = CHUNK_DELAY) {
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

            if (e.message.includes('character IDs') || e.message.includes('character names')) {
                results.push([]);
            } else {
                results.push(null);
            }
        }
        if (i + 1 < items.length && delay > 0) {
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    return results;
}

export async function getCharacterIds(names) {
    const cachedCharacters = [];
    const uncachedNames = [];

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

                    for (const char of characters) {
                        await setCachedNameToId(char.name, char);
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

        fetchedCharacters = fetchedCharacters.flat().filter(char => char !== null);
    }

    return [...cachedCharacters, ...fetchedCharacters];
}

export async function getEntityIds(names) {
    const entityCache = new Map();
    const cachedEntities = { characters: [], corporations: [], alliances: [] };
    const uncachedNames = [];

    for (const name of names) {
        const cached = await getCachedEntityName(name);
        if (cached) {
            if (cached.type === 'character') {
                cachedEntities.characters.push({ id: cached.id, name: cached.name });
            } else if (cached.type === 'corporation') {
                cachedEntities.corporations.push({ id: cached.id, name: cached.name });
            } else if (cached.type === 'alliance') {
                cachedEntities.alliances.push({ id: cached.id, name: cached.name });
            }
            incrementLocalCacheHits();
            continue;
        }

        if (validateEntityName(name)) {
            uncachedNames.push(name);
        } else {
            console.warn(`Invalid entity name: ${name}`);
        }
    }

    let fetchedEntities = { characters: [], corporations: [], alliances: [] };

    if (uncachedNames.length > 0) {
        updateProgress(0, uncachedNames.length, `Looking up ${uncachedNames.length} entity names...`);

        const results = await processInChunks(
            chunkArray(uncachedNames, MAX_ESI_CALL_SIZE),
            async (nameChunk, index, totalChunks) => {
                updateProgress(index * MAX_ESI_CALL_SIZE, uncachedNames.length,
                    `Looking up entity names (batch ${index + 1}/${totalChunks})...`);

                try {
                    const data = await esiClient.post('/universe/ids/', nameChunk);

                    const characters = data?.characters || [];
                    const corporations = data?.corporations || [];
                    const alliances = data?.alliances || [];

                    for (const char of characters) {
                        await setCachedEntityName(char.name, { id: char.id, name: char.name, type: 'character' });
                        await setCachedNameToId(char.name, char);
                        characterNameToIdCache.set(char.name.toLowerCase(), char);
                    }

                    for (const corp of corporations) {
                        await setCachedEntityName(corp.name, { id: corp.id, name: corp.name, type: 'corporation' });
                    }

                    for (const alliance of alliances) {
                        await setCachedEntityName(alliance.name, { id: alliance.id, name: alliance.name, type: 'alliance' });
                    }

                    return { characters, corporations, alliances };
                } catch (error) {
                    console.error(`Failed to get entity IDs for batch ${index + 1}:`, error);
                    throw new Error(`Failed to get entity IDs for batch ${index + 1}: ${error.message}`);
                }
            },
            MAX_ESI_CALL_SIZE,
            CHUNK_DELAY
        );

        results.forEach(batch => {
            fetchedEntities.characters.push(...(batch.characters || []));
            fetchedEntities.corporations.push(...(batch.corporations || []));
            fetchedEntities.alliances.push(...(batch.alliances || []));
        });
    }

    return {
        characters: [...cachedEntities.characters, ...fetchedEntities.characters],
        corporations: [...cachedEntities.corporations, ...fetchedEntities.corporations],
        alliances: [...cachedEntities.alliances, ...fetchedEntities.alliances]
    };
}

export async function getCharacterAffiliations(characterIds) {
    const cachedAffiliations = [];
    const uncachedIds = [];

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

                    for (const affiliation of affiliations) {
                        await setCachedAffiliation(affiliation.character_id, affiliation);
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


        fetchedAffiliations = fetchedAffiliations.flat().filter(affiliation => affiliation !== null);
    }

    return [...cachedAffiliations, ...fetchedAffiliations];
}

export async function getCorporationInfoWithCaching(uniqueCorpIds) {
    updateProgress(0, uniqueCorpIds.length, "Getting corporation information...");

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

    const uncachedFromDB = await checkIndexedDBCache(uncachedCorpIds, corpMap, 'corporation');
    processedCorps += (uncachedCorpIds.length - uncachedFromDB.length);

    if (processedCorps > cachedCorps.length) {
        updateProgress(processedCorps, uniqueCorpIds.length,
            `Getting corporation information (${processedCorps}/${uniqueCorpIds.length})...`);
    }

    if (uncachedFromDB.length > 0) {
        await processUncachedCorporations(uncachedFromDB, corpMap, processedCorps, uniqueCorpIds.length);
    }

    return corpMap;
}

export async function getAllianceInfoWithCaching(uniqueAllianceIds) {
    if (uniqueAllianceIds.length === 0) {
        return new Map();
    }

    updateProgress(0, uniqueAllianceIds.length, "Getting alliance information...");

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

    const uncachedFromDB = await checkIndexedDBCache(uncachedAllianceIds, allianceMap, 'alliance');
    processedAlliances += (uncachedAllianceIds.length - uncachedFromDB.length);

    if (processedAlliances > cachedAlliances.length) {
        updateProgress(processedAlliances, uniqueAllianceIds.length,
            `Getting alliance information (${processedAlliances}/${uniqueAllianceIds.length})...`);
    }

    if (uncachedFromDB.length > 0) {
        await processUncachedAlliances(uncachedFromDB, allianceMap, processedAlliances, uniqueAllianceIds.length);
    }

    return allianceMap;
}

async function checkIndexedDBCache(uncachedIds, resultMap, type) {
    if (uncachedIds.length === 0) return [];

    const getCacheFunction = type === 'corporation' ? getCachedCorporationInfo : getCachedAllianceInfo;
    const inMemoryCache = type === 'corporation' ? corporationInfoCache : allianceInfoCache;

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

async function processUncachedCorporations(uncachedIds, corpMap, startingCount, totalCount) {
    const corpChunks = chunkArray(uncachedIds, CHUNK_SIZE);
    let processedCorps = startingCount;

    for (let i = 0; i < corpChunks.length; i++) {
        const chunk = corpChunks[i];

        const batchRequests = chunk.map(corpId => ({
            method: 'GET',
            endpoint: `/corporations/${corpId}/`,
            corpId
        }));

        try {
            const chunkResults = await esiClient.batchRequests(batchRequests, {
                maxConcurrency: 8,
                chunkDelay: CHUNK_DELAY,
                onProgress: (completed, total) => {
                    const overallCompleted = processedCorps + completed;
                    updateProgress(overallCompleted, totalCount,
                        `Getting corporation information (${overallCompleted}/${totalCount})...`);
                }
            });

            for (let j = 0; j < chunkResults.length; j++) {
                const result = chunkResults[j];
                const request = batchRequests[j];
                const corpId = request.corpId;

                let corporationInfo;

                if (result && result.name !== undefined) {
                    corporationInfo = {
                        name: result.name,
                        war_eligible: Boolean(result.war_eligible)
                    };
                } else {
                    console.warn(`Failed to get corporation info for ${corpId}`);
                    corporationInfo = {
                        name: 'Unknown Corporation',
                        war_eligible: false
                    };
                }

                corporationInfoCache.set(corpId, corporationInfo);
                await setCachedCorporationInfo(corpId, corporationInfo);
                corpMap.set(corpId, corporationInfo);
            }

        } catch (error) {
            console.error(`Failed to process corporation chunk ${i + 1}:`, error);

            chunk.forEach(corpId => {
                const fallbackInfo = { name: 'Unknown Corporation', war_eligible: false };
                corporationInfoCache.set(corpId, fallbackInfo);
                corpMap.set(corpId, fallbackInfo);
            });
        }

        processedCorps += chunk.length;
        updateProgress(processedCorps, totalCount,
            `Getting corporation information (${processedCorps}/${totalCount})...`);

        if (i + 1 < corpChunks.length) {
            await new Promise(resolve => setTimeout(resolve, CHUNK_DELAY));
        }
    }
}

async function processUncachedAlliances(uncachedIds, allianceMap, startingCount, totalCount) {
    const allianceChunks = chunkArray(uncachedIds, CHUNK_SIZE);
    let processedAlliances = startingCount;

    for (let i = 0; i < allianceChunks.length; i++) {
        const chunk = allianceChunks[i];

        const batchRequests = chunk.map(allianceId => ({
            method: 'GET',
            endpoint: `/alliances/${allianceId}/`,
            allianceId
        }));

        try {
            const chunkResults = await esiClient.batchRequests(batchRequests, {
                maxConcurrency: 8,
                chunkDelay: CHUNK_DELAY,
                onProgress: (completed, total) => {
                    const overallCompleted = processedAlliances + completed;
                    updateProgress(overallCompleted, totalCount,
                        `Getting alliance information (${overallCompleted}/${totalCount})...`);
                }
            });

            for (let j = 0; j < chunkResults.length; j++) {
                const result = chunkResults[j];
                const request = batchRequests[j];
                const allianceId = request.allianceId;

                let allianceInfo;

                if (result && result.name !== undefined) {
                    allianceInfo = {
                        name: result.name
                    };
                } else {
                    console.warn(`Failed to get alliance info for ${allianceId}`);
                    allianceInfo = {
                        name: 'Unknown Alliance'
                    };
                }

                allianceInfoCache.set(allianceId, allianceInfo);
                await setCachedAllianceInfo(allianceId, allianceInfo);
                allianceMap.set(allianceId, allianceInfo);
            }

        } catch (error) {
            console.error(`Failed to process alliance chunk ${i + 1}:`, error);


            chunk.forEach(allianceId => {
                const fallbackInfo = { name: 'Unknown Alliance' };
                allianceInfoCache.set(allianceId, fallbackInfo);
                allianceMap.set(allianceId, fallbackInfo);
            });
        }

        processedAlliances += chunk.length;
        updateProgress(processedAlliances, totalCount,
            `Getting alliance information (${processedAlliances}/${totalCount})...`);

        if (i + 1 < allianceChunks.length) {
            await new Promise(resolve => setTimeout(resolve, CHUNK_DELAY));
        }
    }
}

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
                character_name: char.name,
                character_id: sanitizeId(char.id),
                corporation_name: corpInfo.name,
                corporation_id: sanitizeId(affiliation.corporation_id),
                alliance_name: null,
                alliance_id: null,
                war_eligible: false
            };

            if (affiliation.alliance_id) {
                const allianceInfo = allianceMap.get(affiliation.alliance_id);
                if (allianceInfo) {
                    result.alliance_name = allianceInfo.name;
                    result.alliance_id = sanitizeId(affiliation.alliance_id);
                }
            }

            if (corpInfo.war_eligible !== undefined) result.war_eligible = Boolean(corpInfo.war_eligible);
            results.push(result);
        } catch (e) {
            showError(`Error processing character ${char.name}: ${e}`);
            console.error(`Error processing character ${char.name}:`, e);
            results.push({
                character_name: char.name,
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

export async function validator(names) {
    resetCounters();

    try {
        const characters = await getCharacterIds(names);
        const characterIds = characters.map(char => char.id);

        await handleMissingCharacters(characters, names);

        updateProgress(0, characterIds.length, "Getting character affiliations...");
        const affiliations = await getCharacterAffiliations(characterIds);

        const affiliationMap = new Map();
        affiliations.forEach(affiliation => {
            affiliationMap.set(affiliation.character_id, affiliation);
        });

        const uniqueCorpIds = Array.from(new Set(affiliations.map(a => a.corporation_id)));
        const uniqueAllianceIds = Array.from(new Set(affiliations.map(a => a.alliance_id).filter(id => id)));

        const [corpMap, allianceMap] = await Promise.all([
            getCorporationInfoWithCaching(uniqueCorpIds),
            getAllianceInfoWithCaching(uniqueAllianceIds)
        ]);

        return buildCharacterResults(characters, affiliationMap, corpMap, allianceMap);

    } catch (error) {
        if (error.name === 'ESIRateLimitError') {
            throw new Error(`Rate limit exceeded. Please wait ${error.retryAfter} seconds before trying again.`);
        } else if (error.name === 'ESIServerError') {
            throw new Error(`EVE ESI servers are experiencing issues (${error.status}). Please try again later.`);
        } else if (error.name === 'ESIError') {
            throw new Error(`ESI API error: ${error.message}`);
        } else {
            throw error;
        }
    }
}

export async function mixedValidator(names) {
    resetCounters();

    try {
        const entities = await getEntityIds(names);

        const totalFound = entities.characters.length + entities.corporations.length + entities.alliances.length;
        if (totalFound !== names.length) {
            const foundNames = new Set([
                ...entities.characters.map(c => c.name.toLowerCase()),
                ...entities.corporations.map(c => c.name.toLowerCase()),
                ...entities.alliances.map(a => a.name.toLowerCase())
            ]);
            const missingNames = names.filter(name => !foundNames.has(name.toLowerCase()));
            if (missingNames.length > 0) {
                console.warn(`Could not find ${missingNames.length} entity/entities:`, missingNames);
                updateProgress(0, 0, `Warning: ${missingNames.length} entity names not found`);
                await new Promise(resolve => setTimeout(resolve, 1500));
            }
        }

        const results = [];

        if (entities.characters.length > 0) {
            const characterIds = entities.characters.map(char => char.id);
            const affiliations = await getCharacterAffiliations(characterIds);
            const affiliationMap = new Map();
            affiliations.forEach(affiliation => {
                affiliationMap.set(affiliation.character_id, affiliation);
            });

            const uniqueCorpIds = Array.from(new Set(affiliations.map(a => a.corporation_id)));
            const uniqueAllianceIds = Array.from(new Set(affiliations.map(a => a.alliance_id).filter(id => id)));

            const [corpMap, allianceMap] = await Promise.all([
                getCorporationInfoWithCaching(uniqueCorpIds),
                getAllianceInfoWithCaching(uniqueAllianceIds)
            ]);

            const characterResults = buildCharacterResults(entities.characters, affiliationMap, corpMap, allianceMap);
            results.push(...characterResults);
        }

        if (entities.corporations.length > 0) {
            const corpIds = entities.corporations.map(corp => corp.id);
            const corpInfoMap = await getCorporationInfoWithCaching(corpIds);

            for (const corp of entities.corporations) {
                const corpInfo = corpInfoMap.get(corp.id);
                if (corpInfo) {
                    results.push({
                        entity_type: 'corporation',
                        entity_name: corp.name,
                        entity_id: sanitizeId(corp.id),
                        corporation_name: corp.name,
                        corporation_id: sanitizeId(corp.id),
                        alliance_name: null,
                        alliance_id: null,
                        war_eligible: Boolean(corpInfo.war_eligible),
                        character_name: null,
                        character_id: null
                    });
                }
            }
        }

        if (entities.alliances.length > 0) {
            const allianceIds = entities.alliances.map(alliance => alliance.id);
            const allianceInfoMap = await getAllianceInfoWithCaching(allianceIds);

            for (const alliance of entities.alliances) {
                const allianceInfo = allianceInfoMap.get(alliance.id);
                if (allianceInfo) {
                    results.push({
                        entity_type: 'alliance',
                        entity_name: alliance.name,
                        entity_id: sanitizeId(alliance.id),
                        corporation_name: null,
                        corporation_id: null,
                        alliance_name: alliance.name,
                        alliance_id: sanitizeId(alliance.id),
                        war_eligible: true,
                        character_name: null,
                        character_id: null
                    });
                }
            }
        }

        return results;

    } catch (error) {
        if (error.name === 'ESIRateLimitError') {
            throw new Error(`Rate limit exceeded. Please wait ${error.retryAfter} seconds before trying again.`);
        } else if (error.name === 'ESIServerError') {
            throw new Error(`EVE ESI servers are experiencing issues (${error.status}). Please try again later.`);
        } else if (error.name === 'ESIError') {
            throw new Error(`ESI API error: ${error.message}`);
        } else {
            throw error;
        }
    }
}