/*
    EVE Target Intel - ESI Killmail Fetcher

    Copyright (C) 2025 moregh (https://github.com/moregh/)
    Licensed under AGPL License.
*/

import { esiClient } from './esi-client.js';
import { getCachedKillmailsBatch, setCachedKillmailsBatch } from './database.js';

class ESIKillmailError extends Error {
    constructor(message, killmailId, hash) {
        super(message);
        this.name = 'ESIKillmailError';
        this.killmailId = killmailId;
        this.hash = hash;
    }
}

function getEmbeddedKillmail(kill) {
    const mail = kill?.killmail && typeof kill.killmail === 'object' ? kill.killmail : kill;
    if (!mail ||
        !Number.isInteger(mail.killmail_id) || mail.killmail_id <= 0 ||
        typeof mail.killmail_time !== 'string' ||
        !Number.isInteger(mail.solar_system_id) || mail.solar_system_id <= 0 ||
        !mail.victim || typeof mail.victim !== 'object' ||
        !Array.isArray(mail.attackers)) {
        return null;
    }

    // zKill worker records contain the ESI killmail fields plus `zkb` metadata.
    // Keep only the ESI shape so consumers get the same object as the API.
    const killmail = {
        killmail_id: mail.killmail_id,
        killmail_time: mail.killmail_time,
        solar_system_id: mail.solar_system_id,
        victim: mail.victim,
        attackers: mail.attackers
    };

    return {
        killmailId: mail.killmail_id,
        hash: kill?.zkb?.hash || null,
        zkbData: kill?.zkb || null,
        killmail
    };
}

class ESIKillmailFetcher {
    async fetchKillmailsBatch(kills, {
        maxConcurrency = 10,
        batchDelay = 100,
        onProgress = null,
        maxKillmails = 100,
        streaming = false,
        onStreamResult = null
    } = {}) {
        if (!Array.isArray(kills) || kills.length === 0) {
            return [];
        }

        const killsToFetch = kills.slice(0, maxKillmails);
        const killmailIds = killsToFetch.map(k => k.killmail_id).filter(id => id);

        const cachedKillmails = await getCachedKillmailsBatch(killmailIds);
        const cachedMap = new Map();
        cachedKillmails.forEach((cached, index) => {
            if (cached) {
                cachedMap.set(killmailIds[index], cached);
            }
        });

        const killsMissingFromCache = killsToFetch.filter(kill =>
            !cachedMap.has(kill.killmail_id)
        );

        const results = [];
        const fetchedResults = [];
        let successCount = cachedMap.size;
        let failedCount = 0;
        const killsNeedingApiFetch = [];

        for (const originalKill of killsToFetch) {
            const cached = cachedMap.get(originalKill.killmail_id);
            if (!cached) continue;

            const result = {
                killmailId: cached.killmailId,
                hash: cached.hash,
                zkbData: originalKill?.zkb || cached.zkbData,
                killmail: cached.killmail
            };
            results.push(result);
            if (streaming && onStreamResult) {
                onStreamResult(result);
            }
        }

        for (const kill of killsMissingFromCache) {
            const embedded = getEmbeddedKillmail(kill);
            if (!embedded) {
                killsNeedingApiFetch.push(kill);
                continue;
            }

            successCount++;
            results.push(embedded);
            fetchedResults.push(embedded);
            if (streaming && onStreamResult) onStreamResult(embedded);
        }

        const cachedAndEmbeddedCount = cachedMap.size + fetchedResults.length;
        if (onProgress && fetchedResults.length > 0) {
            onProgress(cachedAndEmbeddedCount, killsToFetch.length, successCount, failedCount);
        }

        for (let i = 0; i < killsNeedingApiFetch.length; i += maxConcurrency) {
            const chunk = killsNeedingApiFetch.slice(i, i + maxConcurrency);

            const chunkPromises = chunk.map(async (kill) => {
                try {
                    const killmailId = kill.killmail_id;
                    const hash = kill.zkb?.hash;

                    if (!killmailId || !hash) {
                        console.warn('Kill missing killmail_id or hash:', kill);
                        failedCount++;
                        return null;
                    }

                    const killmail = await esiClient.getKillmail(killmailId, hash);

                    if (killmail) {
                        successCount++;
                        const result = {
                            killmailId,
                            hash,
                            zkbData: kill.zkb,
                            killmail
                        };
                        return result;
                    } else {
                        failedCount++;
                        return null;
                    }

                } catch (error) {
                    if (error.status !== 404 && error.status !== 422) {
                        console.error('Error fetching killmail in batch:', error);
                    }
                    failedCount++;
                    return null;
                }
            });

            const chunkResults = await Promise.all(chunkPromises);
            const validResults = chunkResults.filter(r => r !== null);
            results.push(...validResults);
            fetchedResults.push(...validResults);

            if (streaming && onStreamResult) {
                validResults.forEach(result => onStreamResult(result));
            }

            if (onProgress) {
                const processed = Math.min(i + maxConcurrency, killsNeedingApiFetch.length) + cachedAndEmbeddedCount;
                onProgress(processed, killsToFetch.length, successCount, failedCount);
            }

            if (i + maxConcurrency < killsNeedingApiFetch.length && batchDelay > 0) {
                await new Promise(resolve => setTimeout(resolve, batchDelay));
            }
        }

        // Persist fetched mail in one IndexedDB transaction so the next load
        // can bypass the per-killmail HTTP requests entirely.
        await setCachedKillmailsBatch(fetchedResults);

        return results;
    }
}

const esiKillmailFetcher = new ESIKillmailFetcher();

export async function fetchKillmailsBatch(kills, options = {}) {
    return esiKillmailFetcher.fetchKillmailsBatch(kills, options);
}
