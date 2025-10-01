/*
    EVE Target Intel - ESI Killmail Fetcher

    Copyright (C) 2025 moregh (https://github.com/moregh/)
    Licensed under AGPL License.
*/

import { esiClient } from './esi-client.js';
import { showWarning } from './ui.js';
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

    async fetchKillmailDetails(killmailId, hash) {
        if (!killmailId || !hash) {
            throw new ESIKillmailError('Killmail ID and hash are required', killmailId, hash);
        }

        const cached = await getCachedKillmail(killmailId);
        if (cached) {
            this.cacheHits++;
            return cached.killmail;
        }

        const endpoint = `/killmails/${killmailId}/${hash}/`;

        try {
            this.fetchCount++;
            const data = await esiClient.get(endpoint);

            if (!data) {
                throw new ESIKillmailError('ESI returned null data', killmailId, hash);
            }

            await setCachedKillmail(killmailId, hash, null, data);

            return data;

        } catch (error) {
            this.errorCount++;
            console.error(`Failed to fetch killmail ${killmailId}:`, error);

            if (error.status === 404) {
                console.warn(`Killmail ${killmailId} not found (404)`);
                return null;
            }

            if (error.status === 422) {
                console.warn(`Invalid killmail hash for ${killmailId} (422)`);
                return null;
            }

            throw new ESIKillmailError(
                `Failed to fetch killmail: ${error.message}`,
                killmailId,
                hash
            );
        }
    }

    async fetchKillmailsBatch(kills, {
        maxConcurrency = 10,
        batchDelay = 100,
        onProgress = null,
        maxKillmails = 100
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
            results.push({
                killmailId: cached.killmailId,
                hash: cached.hash,
                zkbData: originalKill?.zkb || cached.zkbData,
                killmail: cached.killmail
            });
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
            results.push(...chunkResults.filter(r => r !== null));

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

    getStats() {
        return {
            fetched: this.fetchCount,
            errors: this.errorCount,
            cacheHits: this.cacheHits,
            successRate: this.fetchCount > 0
                ? ((this.fetchCount - this.errorCount) / this.fetchCount * 100).toFixed(1) + '%'
                : '0%'
        };
    }

    resetStats() {
        this.fetchCount = 0;
        this.errorCount = 0;
        this.cacheHits = 0;
    }
}

const esiKillmailFetcher = new ESIKillmailFetcher();

export async function fetchKillmailsBatch(kills, options = {}) {
    return esiKillmailFetcher.fetchKillmailsBatch(kills, options);
}