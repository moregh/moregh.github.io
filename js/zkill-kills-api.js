/*
    EVE Target Intel - zKillboard Kills API Integration

    Copyright (C) 2025 moregh (https://github.com/moregh/)
    Licensed under AGPL License.
*/

import { getCachedKills, setCachedKills } from './database.js';
import { getRuntimePaginationConfig } from './user-settings.js';
import { ZKILL_CONFIG } from './config.js';
import { ZKillError, computePoW, getProxyParam, executeWithRetry } from './zkill-utils.js';

class ZKillKillsClient {
    constructor() {
        this.requestCount = 0;
    }

    async executeRequest(entityType, entityId, page = 1) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), ZKILL_CONFIG.REQUEST_TIMEOUT_MS);

        try {
            const proxyParam = getProxyParam(entityType);
            const { nonce, ts, hash } = await computePoW(entityId);

            const proxyUrl = `${ZKILL_CONFIG.PROXY_BASE_URL}?kills=${proxyParam}&id=${entityId}&page=${page}&nonce=${nonce}&ts=${ts}&hash=${hash}`;

            this.requestCount++;

            const response = await fetch(proxyUrl, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json'
                },
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                if (response.status === 404) {
                    return [];
                } else if (response.status === 429 || response.status === 420) {
                    throw new ZKillError('Rate limited by proxy. Please try again later.', 429, entityType, entityId);
                } else if (response.status >= 500) {
                    throw new ZKillError(`Proxy server error (${response.status})`, response.status, entityType, entityId);
                } else if (response.status === 400) {
                    throw new ZKillError('Invalid proof-of-work or request format', 400, entityType, entityId);
                } else {
                    throw new ZKillError(`Proxy request failed: ${response.status} ${response.statusText}`, response.status, entityType, entityId);
                }
            }

            const data = await response.json();

            if (!Array.isArray(data)) {
                console.warn('Expected array from kills endpoint, got:', typeof data);
                return [];
            }

            return data;

        } catch (error) {
            clearTimeout(timeoutId);

            if (error.name === 'AbortError') {
                throw new ZKillError('Request timed out. Please try again.', 408, entityType, entityId);
            }

            throw error;
        }
    }

    async getEntityKillsStreaming(entityType, entityId, onPageReceived, onProgress = null, maxKills = null) {
        if (!entityType || !['characterID', 'corporationID', 'allianceID'].includes(entityType)) {
            throw new ZKillError('Invalid entity type. Must be characterID, corporationID, or allianceID', 400, entityType, entityId);
        }

        if (!entityId || isNaN(entityId)) {
            throw new ZKillError('Invalid entity ID. Must be a number', 400, entityType, entityId);
        }

        entityId = parseInt(entityId);

        const entityTypeShort = entityType.replace('ID', '');
        const cached = await getCachedKills(entityTypeShort, entityId);
        if (cached) {
            const killsToReturn = maxKills ? cached.kills.slice(0, maxKills) : cached.kills;
            if (onPageReceived) {
                await onPageReceived(killsToReturn, true);
            }
            return killsToReturn;
        }

        try {
            const paginationConfig = await getRuntimePaginationConfig();
            const allKills = [];
            let currentPage = 1;
            let shouldContinue = true;
            let actualDailyRate = 14000;
            const TARGET_DAYS = paginationConfig.TARGET_DAYS;
            const MIN_KILLMAILS = paginationConfig.MIN_KILLMAILS;
            const VERIFY_INTERVAL = paginationConfig.VERIFY_AFTER_PAGES || 5;
            let lastVerifiedPage = 0;

            while (shouldContinue && currentPage <= paginationConfig.MAX_PAGES) {
                const pageKills = await executeWithRetry(
                    () => this.executeRequest(entityType, entityId, currentPage),
                    entityType,
                    entityId
                );

                if (!pageKills || pageKills.length === 0) {
                    break;
                }

                allKills.push(...pageKills);

                if (onPageReceived) {
                    await onPageReceived(pageKills, false);
                }

                if (maxKills && allKills.length >= maxKills) {
                    if (onProgress) {
                        onProgress(currentPage, allKills.length, 'N/A', 'limit reached');
                    }
                    shouldContinue = false;
                    break;
                }

                const meetsMinKillmails = allKills.length >= MIN_KILLMAILS;

                if (allKills.length > 0) {
                    const newestKillmailId = allKills[0].killmail_id;
                    const oldestKillmailId = allKills[allKills.length - 1].killmail_id;
                    const killmailIdSpan = newestKillmailId - oldestKillmailId;
                    const estimatedDays = killmailIdSpan / actualDailyRate;

                    if (onProgress) {
                        onProgress(currentPage, allKills.length, estimatedDays.toFixed(1), null);
                    }

                    const shouldVerify = meetsMinKillmails && estimatedDays >= TARGET_DAYS && (currentPage - lastVerifiedPage >= VERIFY_INTERVAL || estimatedDays >= TARGET_DAYS * 1.2);

                    if (shouldVerify) {
                        if (onProgress) {
                            onProgress(currentPage, allKills.length, estimatedDays.toFixed(1), 'verifying');
                        }

                        const verified = await this.verifyTimespan(allKills, TARGET_DAYS);
                        lastVerifiedPage = currentPage;

                        if (verified.meetsRequirement) {
                            if (onProgress) {
                                onProgress(currentPage, allKills.length, verified.actualDays.toFixed(1), 'verified');
                            }
                            shouldContinue = false;
                        } else if (verified.actualDays > 0) {
                            actualDailyRate = killmailIdSpan / verified.actualDays;
                            const daysNeeded = TARGET_DAYS - verified.actualDays;

                            if (onProgress) {
                                onProgress(currentPage, allKills.length, verified.actualDays.toFixed(1), `need ${daysNeeded.toFixed(1)} more days`);
                            }

                            currentPage++;
                            await new Promise(resolve => setTimeout(resolve, paginationConfig.PAGE_FETCH_DELAY_MS));
                        } else {
                            currentPage++;
                            await new Promise(resolve => setTimeout(resolve, paginationConfig.PAGE_FETCH_DELAY_MS));
                        }
                    } else if (currentPage >= paginationConfig.MAX_PAGES) {
                        shouldContinue = false;
                    } else {
                        currentPage++;
                        await new Promise(resolve => setTimeout(resolve, paginationConfig.PAGE_FETCH_DELAY_MS));
                    }
                } else {
                    break;
                }
            }

            const killsToCache = maxKills && allKills.length > maxKills ? allKills.slice(0, maxKills) : allKills;
            await setCachedKills(entityTypeShort, entityId, killsToCache);

            return killsToCache;

        } catch (error) {
            if (error instanceof ZKillError) {
                throw error;
            }

            throw new ZKillError(
                `Failed to fetch kills for ${entityType} ${entityId}: ${error.message}`,
                500,
                entityType,
                entityId
            );
        }
    }

    async getEntityKills(entityType, entityId, onProgress = null, maxKills = null) {
        return this.getEntityKillsStreaming(entityType, entityId, null, onProgress, maxKills);
    }

    async verifyTimespan(kills, targetDays) {
        if (!kills || kills.length === 0) {
            return { meetsRequirement: false, actualDays: 0 };
        }

        try {
            const { esiClient } = await import('./esi-client.js');

            const oldestKill = kills[kills.length - 1];
            const newestKill = kills[0];

            const oldestHash = oldestKill.zkb?.hash;
            const newestHash = newestKill.zkb?.hash;

            if (!oldestHash || !newestHash) {
                console.warn('Missing hash for verification, using estimation');
                return { meetsRequirement: false, actualDays: 0 };
            }

            const [oldestKm, newestKm] = await Promise.all([
                esiClient.get(`/killmails/${oldestKill.killmail_id}/${oldestHash}/`),
                esiClient.get(`/killmails/${newestKill.killmail_id}/${newestHash}/`)
            ]);

            if (!oldestKm?.killmail_time || !newestKm?.killmail_time) {
                console.warn('Missing killmail_time in ESI response');
                return { meetsRequirement: false, actualDays: 0 };
            }

            const oldestTime = new Date(oldestKm.killmail_time).getTime();
            const newestTime = new Date(newestKm.killmail_time).getTime();
            const actualDays = (newestTime - oldestTime) / (1000 * 60 * 60 * 24);

            return {
                meetsRequirement: actualDays >= targetDays,
                actualDays,
                oldestTime: oldestKm.killmail_time,
                newestTime: newestKm.killmail_time
            };

        } catch (error) {
            console.error('Error verifying timespan:', error);
            return { meetsRequirement: false, actualDays: 0 };
        }
    }

    getStats() {
        return {
            requests: this.requestCount
        };
    }
}

const zkillKillsClient = new ZKillKillsClient();

export async function get_zkill_character_kills(charId, onProgress = null, maxKills = null) {
    try {
        return await zkillKillsClient.getEntityKills('characterID', charId, onProgress, maxKills);
    } catch (error) {
        console.error(`Failed to get character kills for ${charId}:`, error);
        return [];
    }
}

export async function get_zkill_corporation_kills(corpId, onProgress = null, maxKills = null) {
    try {
        return await zkillKillsClient.getEntityKills('corporationID', corpId, onProgress, maxKills);
    } catch (error) {
        console.error(`Failed to get corporation kills for ${corpId}:`, error);
        return [];
    }
}

export async function get_zkill_alliance_kills(allianceId, onProgress = null, maxKills = null) {
    try {
        return await zkillKillsClient.getEntityKills('allianceID', allianceId, onProgress, maxKills);
    } catch (error) {
        console.error(`Failed to get alliance kills for ${allianceId}:`, error);
        return [];
    }
}

export async function get_zkill_kills_streaming(entityType, entityId, onPageReceived, onProgress = null, maxKills = null) {
    try {
        return await zkillKillsClient.getEntityKillsStreaming(entityType, entityId, onPageReceived, onProgress, maxKills);
    } catch (error) {
        console.error(`Failed to get streaming kills for ${entityType} ${entityId}:`, error);
        return [];
    }
}

export function get_zkill_kills_stats() {
    return zkillKillsClient.getStats();
}