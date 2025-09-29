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
export function isExpired(timestamp) {
    const now = Date.now();
    const expiryTime = timestamp + (CACHE_EXPIRY_HOURS * 60 * 60 * 1000);
    return now > expiryTime;
}

export async function getCachedNameToId(name) {
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

export async function getCachedAffiliation(characterId) {
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

export async function setCachedNameToId(name, characterData) {
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
    } catch (e) {
        console.warn(`Error writing name cache for ${name}:`, e);
    }
}

export async function setCachedAffiliation(characterId, affiliationData) {
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
    } catch (e) {
        console.warn(`Error writing affiliation cache for ${characterId}:`, e);
    }
}

export async function getCachedCorporationInfo(corporationId) {
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

export async function setCachedCorporationInfo(corporationId, corporationData) {
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
    } catch (e) {
        console.warn(`Error writing corporation cache for ${corporationId}:`, e);
    }
}

export async function getCachedAllianceInfo(allianceId) {
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

export async function setCachedAllianceInfo(allianceId, allianceData) {
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
    } catch (e) {
        console.warn(`Error writing alliance cache for ${allianceId}:`, e);
    }
}

export async function getCacheRecordCount() {
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