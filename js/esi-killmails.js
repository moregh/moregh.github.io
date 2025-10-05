/*
    EVE Target Intel - ESI Killmail Fetcher

    Copyright (C) 2025 moregh (https://github.com/moregh/)
    Licensed under AGPL License.
*/

import { esiClient } from './esi-client.js';
import { getCachedKillmail, setCachedKillmail, getCachedKillmailsBatch, setCachedKillmailsBatch } from './database.js';

class ESIKillmailError extends Error {
    constructor(message, killmailId, hash) {
        super(message);
        this.name = 'ESIKillmailError';
        this.killmailId = killmailId;
        this.hash = hash;
    }
}

class ESIKillmailFetcher {
    constructor() {
        this.fetchCount = 0;
        this.errorCount = 0;
        this.cacheHits = 0;
    }

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
                this.cacheHits++;
            }
        });

        const killsNeedingFetch = killsToFetch.filter(kill =>
            !cachedMap.has(kill.killmail_id)
        );

        const results = [];
        let successCount = cachedMap.size;
        let failedCount = 0;

        cachedMap.forEach((cached, killmailId) => {
            const originalKill = killsToFetch.find(k => k.killmail_id === killmailId);
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
        });

        for (let i = 0; i < killsNeedingFetch.length; i += maxConcurrency) {
            const chunk = killsNeedingFetch.slice(i, i + maxConcurrency);

            const chunkPromises = chunk.map(async (kill) => {
                try {
                    const killmailId = kill.killmail_id;
                    const hash = kill.zkb?.hash;

                    if (!killmailId || !hash) {
                        console.warn('Kill missing killmail_id or hash:', kill);
                        failedCount++;
                        return null;
                    }

                    this.fetchCount++;
                    const killmail = await esiClient.get(`/killmails/${killmailId}/${hash}/`);

                    if (killmail) {
                        successCount++;
                        const result = {
                            killmailId,
                            hash,
                            zkbData: kill.zkb,
                            killmail
                        };
                        await setCachedKillmail(killmailId, hash, kill.zkb, killmail);
                        return result;
                    } else {
                        failedCount++;
                        return null;
                    }

                } catch (error) {
                    this.errorCount++;
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

            if (streaming && onStreamResult) {
                validResults.forEach(result => onStreamResult(result));
            }

            if (onProgress) {
                const processed = Math.min(i + maxConcurrency, killsNeedingFetch.length) + cachedMap.size;
                onProgress(processed, killsToFetch.length, successCount, failedCount);
            }

            if (i + maxConcurrency < killsNeedingFetch.length && batchDelay > 0) {
                await new Promise(resolve => setTimeout(resolve, batchDelay));
            }
        }

        return results;
    }
}

const esiKillmailFetcher = new ESIKillmailFetcher();

export async function fetchKillmailsBatch(kills, options = {}) {
    return esiKillmailFetcher.fetchKillmailsBatch(kills, options);
}