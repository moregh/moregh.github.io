/*
    EVE Target Intel - IndexedDB Management
    
    Copyright (C) 2025 moregh (https://github.com/moregh/)
    Licensed under AGPL License.
*/

import { DB_NAME, DB_VERSION, CACHE_EXPIRY_HOURS, LONG_CACHE_EXPIRY_HOURS } from './config.js';
import { showError } from './ui.js';

let dbInstance = null;

export async function initDB() {
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

            if (!db.objectStoreNames.contains('character_names')) {
                const nameStore = db.createObjectStore('character_names', { keyPath: 'name_lower' });
                nameStore.createIndex('timestamp', 'timestamp');
            }

            if (!db.objectStoreNames.contains('entity_names')) {
                const entityStore = db.createObjectStore('entity_names', { keyPath: 'name_lower' });
                entityStore.createIndex('timestamp', 'timestamp');
                entityStore.createIndex('entity_type', 'entity_type');
            }

            if (!db.objectStoreNames.contains('character_affiliations')) {
                const affiliationStore = db.createObjectStore('character_affiliations', { keyPath: 'character_id' });
                affiliationStore.createIndex('timestamp', 'timestamp');
            }

            if (!db.objectStoreNames.contains('corporations')) {
                const corpStore = db.createObjectStore('corporations', { keyPath: 'corporation_id' });
                corpStore.createIndex('timestamp', 'timestamp');
            }

            if (!db.objectStoreNames.contains('alliances')) {
                const allianceStore = db.createObjectStore('alliances', { keyPath: 'alliance_id' });
                allianceStore.createIndex('timestamp', 'timestamp');
            }
        };
    });
}

export function isExpired(timestamp) {
    const now = Date.now();
    const expiryTime = timestamp + (CACHE_EXPIRY_HOURS * 60 * 60 * 1000);
    return now > expiryTime;
}

async function getCachedData(storeName, key, processResult) {
    try {
        const db = await initDB();
        const transaction = db.transaction([storeName], 'readonly');
        const store = transaction.objectStore(storeName);

        return new Promise((resolve) => {
            const request = store.get(key);

            request.onsuccess = () => {
                const result = request.result;
                if (!result || isExpired(result.timestamp)) {
                    resolve(null);
                    return;
                }
                resolve(processResult ? processResult(result) : result);
            };

            request.onerror = () => {
                console.warn(`Error reading ${storeName} cache for ${key}:`, request.error);
                resolve(null);
            };
        });
    } catch (e) {
        console.warn(`Error accessing ${storeName} cache for ${key}:`, e);
        return null;
    }
}

async function setCachedData(storeName, cacheData) {
    try {
        const db = await initDB();
        const transaction = db.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);
        store.put({ ...cacheData, timestamp: Date.now() });
    } catch (e) {
        console.warn(`Error writing ${storeName} cache:`, e);
    }
}

export async function getCachedNameToId(name) {
    return getCachedData('character_names', name.toLowerCase(), result => ({
        id: result.character_id,
        name: result.character_name
    }));
}

export async function getCachedAffiliation(characterId) {
    return getCachedData('character_affiliations', characterId, result => ({
        character_id: result.character_id,
        corporation_id: result.corporation_id,
        alliance_id: result.alliance_id
    }));
}

export async function setCachedNameToId(name, characterData) {
    return setCachedData('character_names', {
        name_lower: name.toLowerCase(),
        character_id: characterData.id,
        character_name: characterData.name
    });
}

export async function setCachedAffiliation(characterId, affiliationData) {
    return setCachedData('character_affiliations', {
        character_id: characterId,
        corporation_id: affiliationData.corporation_id,
        alliance_id: affiliationData.alliance_id || null
    });
}

export async function getCachedCorporationInfo(corporationId) {
    return getCachedData('corporations', corporationId, result => ({
        name: result.name,
        war_eligible: result.war_eligible
    }));
}

export async function setCachedCorporationInfo(corporationId, corporationData) {
    return setCachedData('corporations', {
        corporation_id: corporationId,
        name: corporationData.name,
        war_eligible: corporationData.war_eligible
    });
}

export async function getCachedAllianceInfo(allianceId) {
    return getCachedData('alliances', allianceId, result => ({
        name: result.name
    }));
}

export async function setCachedAllianceInfo(allianceId, allianceData) {
    return setCachedData('alliances', {
        alliance_id: allianceId,
        name: allianceData.name
    });
}

export async function getCachedEntityName(name) {
    return getCachedData('entity_names', name.toLowerCase(), result => ({
        id: result.entity_id,
        name: result.entity_name,
        type: result.entity_type
    }));
}

export async function setCachedEntityName(name, entityData) {
    return setCachedData('entity_names', {
        name_lower: name.toLowerCase(),
        entity_id: entityData.id,
        entity_name: entityData.name,
        entity_type: entityData.type
    });
}

export async function getCacheRecordCount() {
    try {
        const db = await initDB();
        const stores = ['character_names', 'entity_names', 'character_affiliations', 'corporations', 'alliances'];
        let totalCount = 0;

        const countPromises = stores.map(storeName => {
            return new Promise((resolve) => {
                const transaction = db.transaction([storeName], 'readonly');
                const store = transaction.objectStore(storeName);
                const countRequest = store.count();

                countRequest.onsuccess = () => {
                    resolve(countRequest.result);
                };

                countRequest.onerror = () => {
                    console.warn(`Error counting records in ${storeName}:`, countRequest.error);
                    resolve(0);
                };
            });
        });

        const counts = await Promise.all(countPromises);
        totalCount = counts.reduce((sum, count) => sum + count, 0);

        return totalCount;
    } catch (e) {
        console.warn('Error getting cache record count:', e);
        return 0;
    }
}

export async function clearExpiredCache() {
    try {
        const db = await initDB();
        if (!db) {
            console.warn('IndexedDB not available, skipping cache cleanup');
            return;
        }

        const now = Date.now();
        const shortExpiryMs = CACHE_EXPIRY_HOURS * 60 * 60 * 1000;
        const longExpiryMs = LONG_CACHE_EXPIRY_HOURS * 60 * 60 * 1000;

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
                            cursor.delete();
                    } else if (warExpired && record.war_eligible_timestamp) {
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