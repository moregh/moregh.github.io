/*
    EVE Target Intel - zKillboard API Integration
    
    Copyright (C) 2025 moregh (https://github.com/moregh/)
    Licensed under AGPL License.
*/

import { KILLMAIL_BATCH_SIZE, KILLMAIL_FETCH_DELAY_MS, ZKILL_CONFIG } from './config.js';
import { getRuntimeMaxKillmails } from './user-settings.js';
import { showWarning } from './ui.js';
import { getShipClassification, SHIP_TYPE_TO_GROUP } from './eve-ship-data.js';
import { get_zkill_character_kills, get_zkill_corporation_kills, get_zkill_alliance_kills } from './zkill-kills-api.js';
import { fetchKillmailsBatch } from './esi-killmails.js';
import { analyzeKillmails, getRecentKills, getTopValueKills } from './killmail-analysis.js';
import { SecurityClassification } from './zkill-card.js';
import { assessEntityThreat } from './threat-assessment.js';
import { ZKillError, computePoW, getProxyParam, executeWithRetry } from './zkill-utils.js';
import { calculateTimezoneFromHourlyData, calculateTimezoneFromKillmails } from './timezone-utils.js';

function distributePercentages(items, total, getCount) {
    if (total === 0) return items.map(item => ({ ...item, percentage: 0 }));

    const percentages = items.map(item => {
        const count = getCount(item);
        const exact = (count / total) * 100;
        const rounded = Math.round(exact);
        return { item, count, exact, rounded };
    });

    let sum = percentages.reduce((s, p) => s + p.rounded, 0);

    if (sum !== 100) {
        percentages.sort((a, b) => {
            const diffA = Math.abs(a.exact - a.rounded);
            const diffB = Math.abs(b.exact - b.rounded);
            return diffB - diffA;
        });

        const diff = 100 - sum;
        for (let i = 0; i < Math.abs(diff) && i < percentages.length; i++) {
            percentages[i].rounded += diff > 0 ? 1 : -1;
        }
    }

    return percentages.map(p => ({
        ...p.item,
        percentage: p.rounded
    }));
}

class ZKillRateLimiter {
    constructor() {
        this.lastRequestTime = 0;
        this.requestQueue = [];
        this.isProcessing = false;
    }

    async scheduleRequest(requestFn) {
        return new Promise((resolve, reject) => {
            this.requestQueue.push({ requestFn, resolve, reject });
            this.processQueue();
        });
    }

    async processQueue() {
        if (this.isProcessing || this.requestQueue.length === 0) {
            return;
        }

        this.isProcessing = true;

        while (this.requestQueue.length > 0) {
            const { requestFn, resolve, reject } = this.requestQueue.shift();

            try {
                const now = Date.now();
                const timeSinceLastRequest = now - this.lastRequestTime;

                if (timeSinceLastRequest < ZKILL_CONFIG.REQUEST_INTERVAL_MS) {
                    const delayNeeded = ZKILL_CONFIG.REQUEST_INTERVAL_MS - timeSinceLastRequest;
                    await this.sleep(delayNeeded);
                }

                this.lastRequestTime = Date.now();
                const result = await requestFn();
                resolve(result);

            } catch (error) {
                reject(error);
            }
        }

        this.isProcessing = false;
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

class ZKillStatsCache {
    constructor() {
        this.cache = new Map();
    }

    getCacheKey(entityType, entityId) {
        return `${entityType}_${entityId}`;
    }

    get(entityType, entityId) {
        const key = this.getCacheKey(entityType, entityId);
        const cached = this.cache.get(key);

        if (!cached) return null;

        if (Date.now() - cached.timestamp > ZKILL_CONFIG.CACHE_DURATION_MS) {
            this.cache.delete(key);
            return null;
        }

        return cached.data;
    }

    set(entityType, entityId, data) {
        const key = this.getCacheKey(entityType, entityId);
        this.cache.set(key, {
            data,
            timestamp: Date.now()
        });
    }

    getStats() {
        let expired = 0;
        let valid = 0;
        const now = Date.now();

        for (const [key, value] of this.cache) {
            if (now - value.timestamp > ZKILL_CONFIG.CACHE_DURATION_MS) {
                expired++;
            } else {
                valid++;
            }
        }

        return { total: this.cache.size, valid, expired };
    }
}

class ZKillboardClient {
    constructor() {
        this.rateLimiter = new ZKillRateLimiter();
        this.cache = new ZKillStatsCache();
        this.requestCount = 0;
    }

    async executeRequest(entityType, entityId) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), ZKILL_CONFIG.REQUEST_TIMEOUT_MS);

        try {
            const proxyParam = getProxyParam(entityType);
            const { nonce, ts, hash } = await computePoW(entityId);

            const proxyUrl = `${ZKILL_CONFIG.PROXY_BASE_URL}?${proxyParam}=${entityId}&nonce=${nonce}&ts=${ts}&hash=${hash}`;

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
                    return null;
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

            const text = await response.text();

            try {
                const data = JSON.parse(text);
                return data;
            } catch (parseError) {
                console.warn('Failed to parse JSON response:', text.substring(0, 200));
                throw new ZKillError('Invalid JSON response from proxy', 422, entityType, entityId);
            }

        } catch (error) {
            clearTimeout(timeoutId);

            if (error.name === 'AbortError') {
                throw new ZKillError('Request timed out. Please try again.', 408, entityType, entityId);
            }

            throw error;
        }
    }

    getStats() {
        return {
            requests: this.requestCount,
            cache: this.cache.getStats(),
            queueSize: this.rateLimiter.requestQueue.length,
            proxy: 'Custom zKillboard Proxy'
        };
    }

    async getEntityStats(entityType, entityId) {

        if (!entityType || !['characterID', 'corporationID', 'allianceID'].includes(entityType)) {
            throw new ZKillError('Invalid entity type. Must be characterID, corporationID, or allianceID', 400, entityType, entityId);
        }

        if (!entityId || isNaN(entityId)) {
            throw new ZKillError('Invalid entity ID. Must be a number', 400, entityType, entityId);
        }

        entityId = parseInt(entityId);

        const cached = this.cache.get(entityType, entityId);
        if (cached) {
            return cached;
        }

        try {
            const rawData = await this.rateLimiter.scheduleRequest(() =>
                executeWithRetry(
                    () => this.executeRequest(entityType, entityId),
                    entityType,
                    entityId
                )
            );

            if (!rawData) {
                const emptyResult = this.createEmptyStats(entityType, entityId);
                this.cache.set(entityType, entityId, emptyResult);
                return emptyResult;
            }

            const processedData = await this.processStatsData(rawData, entityType, entityId);

            this.cache.set(entityType, entityId, processedData);

            return processedData;

        } catch (error) {
            if (error instanceof ZKillError) {
                throw error;
            }

            throw new ZKillError(
                `Failed to fetch zKillboard stats for ${entityType} ${entityId}: ${error.message}`,
                500,
                entityType,
                entityId
            );
        }
    }

    async getEntityStatsWithKillmails(entityType, entityId, options = {}) {
        const defaultMaxKillmails = await getRuntimeMaxKillmails();
        const {
            maxKillmails = defaultMaxKillmails,
            fetchKillmails = true,
            onProgress = null
        } = options;

        const stats = await this.getEntityStats(entityType, entityId);

        if (!fetchKillmails || stats.totalKills === 0) {
            return stats;
        }

        const zkillRoleAnalysis = this.analyzeZkillStatsForSpecialRoles(stats);

        try {
            if (onProgress) {
                onProgress('zkill', 'Fetching kill IDs from zKillboard...', 0, 0);
            }

            const allKills = [];
            const allKillmails = [];
            const pendingESIKills = [];
            let zkillComplete = false;
            let esiComplete = false;
            let totalZkillKills = 0;

            const zkillProgress = (page, totalKills, estimatedDays, status) => {
                totalZkillKills = totalKills;
                if (onProgress) {
                    let message = `Fetching page ${page} (${totalKills} kills`;
                    if (estimatedDays) {
                        message += `, ~${estimatedDays} days`;
                    }
                    if (status) {
                        message += `, ${status}`;
                    }
                    message += ')';
                    onProgress('zkill', message, 0, 0);
                }
            };

            const processKillsPage = async (pageKills, isCached) => {
                if (isCached) {
                    allKills.push(...pageKills);
                    pendingESIKills.push(...pageKills);
                    return;
                }

                allKills.push(...pageKills);
                pendingESIKills.push(...pageKills);
            };

            const { get_zkill_kills_streaming } = await import('./zkill-kills-api.js');

            const zkillPromise = (async () => {
                try {
                    await get_zkill_kills_streaming(entityType, entityId, processKillsPage, zkillProgress, maxKillmails);
                    zkillComplete = true;
                    if (onProgress) {
                        onProgress('zkill', `Collected ${allKills.length} kill IDs`, 100, 0);
                    }
                } catch (error) {
                    console.error('Error in zkill streaming:', error);
                    zkillComplete = true;
                }
            })();

            const esiPromise = (async () => {
                while (!zkillComplete || pendingESIKills.length > 0) {
                    if (pendingESIKills.length === 0) {
                        await new Promise(resolve => setTimeout(resolve, 100));
                        continue;
                    }

                    const batchSize = Math.min(KILLMAIL_BATCH_SIZE * 2, pendingESIKills.length);
                    const killsToProcess = pendingESIKills.splice(0, batchSize);

                    if (killsToProcess.length > 0) {
                        await fetchKillmailsBatch(killsToProcess, {
                            maxConcurrency: KILLMAIL_BATCH_SIZE,
                            batchDelay: KILLMAIL_FETCH_DELAY_MS,
                            maxKillmails: maxKillmails - allKillmails.length,
                            streaming: true,
                            onStreamResult: (result) => {
                                allKillmails.push(result);
                            },
                            onProgress: (processed, total, successCount, failedCount) => {
                                if (onProgress) {
                                    const totalExpected = zkillComplete ? allKills.length : Math.max(allKills.length, totalZkillKills);
                                    onProgress('esi', `Fetching killmails from ESI (${allKillmails.length}/${totalExpected})...`, allKillmails.length, totalExpected);
                                }
                            }
                        });

                        if (allKillmails.length >= maxKillmails) {
                            break;
                        }
                    }
                }
                esiComplete = true;
            })();

            await Promise.all([zkillPromise, esiPromise]);

            if (!allKills || allKills.length === 0) {
                return stats;
            }

            const killmails = allKillmails;

            if (killmails && killmails.length > 0) {
                const detailedAnalysis = analyzeKillmails(killmails, entityType, entityId);
                const recentKills = await getRecentKills(killmails, 10);
                const topValueKills = getTopValueKills(killmails, 5);

                const mergedAnalysis = this.mergeAnalyses(detailedAnalysis, zkillRoleAnalysis);

                stats.killmailData = {
                    totalFetched: killmails.length,
                    analysis: mergedAnalysis,
                    recentKills,
                    topValueKills,
                    hasData: true,
                    rawKillmails: killmails
                };

                stats.combatStyle = this.enrichCombatStyleWithKillmails(stats.combatStyle, mergedAnalysis, stats);
                stats.securityPreference = await this.analyzeSecurityPreferenceFromKillmails(killmails, stats._rawData);

                if (!stats.activityData.hasData) {
                    stats.activityData = this.extractActivityDataFromKillmails(killmails);
                }

                if (stats.activityInsights && (stats.activityInsights.timezone === 'Unknown' || stats.activityInsights.primeTime === 'Unknown')) {
                    const timezoneData = this.calculateTimezoneFromKillmails(killmails);
                    if (timezoneData.timezone !== 'Unknown') {
                        stats.activityInsights = {
                            ...stats.activityInsights,
                            timezone: timezoneData.timezone,
                            primeTime: timezoneData.primeTime
                        };
                    }
                }

                stats.threatAssessment = assessEntityThreat(stats, stats.killmailData);
            } else {
                const mergedAnalysis = {
                    blopsAnalysis: zkillRoleAnalysis.blopsAnalysis,
                    cynoAnalysis: zkillRoleAnalysis.cynoAnalysis
                };
                stats.combatStyle = this.enrichCombatStyleWithKillmails(stats.combatStyle, mergedAnalysis, stats);
            }

        } catch (error) {
            console.error('Error fetching killmail data:', error);
        }

        return stats;
    }

    async processStatsData(rawData, entityType, entityId) {
        const memberCount = this.safeGet(rawData, 'info.memberCount', null);

        const stats = {
            entityType: entityType,
            entityId: parseInt(entityId),
            totalKills: this.safeGet(rawData, 'shipsDestroyed', 0),
            totalLosses: this.safeGet(rawData, 'shipsLost', 0),
            soloKills: this.safeGet(rawData, 'soloKills', 0),
            soloLosses: this.safeGet(rawData, 'soloLosses', 0),
            iskDestroyed: this.safeGet(rawData, 'iskDestroyed', 0),
            iskLost: this.safeGet(rawData, 'iskLost', 0),
            efficiency: this.calculateEfficiency(rawData),
            dangerRatio: this.calculateDangerRatio(rawData),
            gangRatio: this.calculateGangRatio(rawData),
            memberCount: memberCount,
            recentActivity: this.extractRecentActivity(rawData),
            topLocations: await this.extractTopLocations(rawData),
            topShips: this.extractTopShips(rawData),
            topPlayers: this.extractTopPlayers(rawData),
            shipAnalysis: this.analyzeShipUsage(rawData),
            combatStyle: this.analyzeCombatStyle(rawData, memberCount),
            activityInsights: this.analyzeActivityInsights(rawData),
            securityPreference: this.analyzeSecurityPreference(rawData),
            activePeriods: this.extractActivePeriods(rawData),
            activityData: this.extractActivityData(rawData),
            lastUpdated: Date.now(),
            _rawData: rawData
        };

        return stats;
    }

    createEmptyStats(entityType, entityId) {
        return {
            entityType: entityType,
            entityId: parseInt(entityId),
            totalKills: 0,
            totalLosses: 0,
            soloKills: 0,
            soloLosses: 0,
            iskDestroyed: 0,
            iskLost: 0,
            efficiency: 0,
            dangerRatio: 0,
            gangRatio: 0,
            memberCount: null,
            recentActivity: {
                activePvPData: {
                    ships: 0,
                    systems: 0,
                    regions: 0,
                    totalKills: 0,
                    characters: 1
                },
                last7Days: { kills: 0, losses: 0 },
                last30Days: { kills: 0, losses: 0 },
                last90Days: { kills: 0, losses: 0 }
            },
            topLocations: [],
            topShips: [],
            topPlayers: [],
            shipAnalysis: null,
            combatStyle: null,
            activityInsights: null,
            securityPreference: null,
            activePeriods: [],
            activityData: { hourlyData: [], dailyData: [], hasData: false },
            lastUpdated: Date.now()
        };
    }

    safeGet(obj, path, defaultValue = 0) {
        try {
            if (path.includes('.')) {
                const parts = path.split('.');
                let result = obj;
                for (const part of parts) {
                    if (result === null || result === undefined) {
                        return defaultValue;
                    }
                    result = result[part];
                }
                return result !== undefined ? result : defaultValue;
            }
            return obj[path] !== undefined ? obj[path] : defaultValue;
        } catch {
            return defaultValue;
        }
    }

    calculateEfficiency(data) {
        const destroyed = this.safeGet(data, 'iskDestroyed', 0);
        const lost = this.safeGet(data, 'iskLost', 0);

        if (destroyed === 0 && lost === 0) return 0.00;
        if (lost === 0) return 100.00;

        const efficiency = (destroyed / (destroyed + lost)) * 100;
        return Math.round(efficiency * 100) / 100;
    }

    calculateDangerRatio(data) {
        const kills = this.safeGet(data, 'shipsDestroyed', 0);
        const losses = this.safeGet(data, 'shipsLost', 0);

        const ratio = losses === 0 ? kills : kills / losses;

        return parseFloat(ratio.toFixed(2));
    }

    calculateGangRatio(data) {
        const totalKills = this.safeGet(data, 'shipsDestroyed', 0);
        const soloKills = this.safeGet(data, 'soloKills', 0);

        if (totalKills === 0) return 0;
        return Math.round(((totalKills - soloKills) / totalKills) * 100);
    }

    extractRecentActivity(data) {
        const activepvp = data.activepvp || {};

        const characters = activepvp.characters?.count || 1;
        const ships = activepvp.ships?.count || 0;
        const systems = activepvp.systems?.count || 0;
        const regions = activepvp.regions?.count || 0;
        const totalKills = activepvp.kills?.count || 0;

        return {
            activePvPData: {
                ships,
                systems,
                regions,
                totalKills,
                characters
            },
            last7Days: { kills: 'N/A', losses: 'N/A' },
            last30Days: { kills: 'N/A', losses: 'N/A' },
            last90Days: { kills: 'N/A', losses: 'N/A' }
        };
    }

    async extractTopLocations(data) {
        const topLists = data.topLists || [];
        const systemList = topLists.find(list => list.type === 'solarSystem' || list.type === 'system');

        if (!systemList || !systemList.values) {
            return [];
        }

        const { getCachedUniverseName, setCachedUniverseName } = await import('./database.js');
        const { esiClient } = await import('./esi-client.js');

        const locations = await Promise.all(systemList.values.map(async system => {
            const systemId = system.solarSystemID || system.id;
            const systemName = system.solarSystemName || system.name || 'Unknown System';
            let securityStatus = null;

            if (systemId) {
                try {
                    let cached = await getCachedUniverseName(systemId);

                    if (cached && cached.security !== undefined && cached.security !== null) {
                        securityStatus = cached.security;
                    } else {
                        const esiData = await esiClient.get(`/universe/systems/${systemId}/`);
                        if (esiData && esiData.security_status !== undefined) {
                            securityStatus = esiData.security_status;
                            await setCachedUniverseName(systemId, esiData.name || systemName, esiData.security_status);
                        }
                    }
                } catch (e) {
                    console.error(`Error fetching security for system ${systemId}:`, e);
                }
            }

            return {
                systemId: systemId,
                systemName: systemName,
                kills: system.kills || 0,
                securityStatus: securityStatus
            };
        }));

        return locations;
    }

    extractTopShips(data) {
        const topLists = data.topLists || [];
        const shipList = topLists.find(list => list.type === 'shipType');

        if (!shipList || !shipList.values) {
            return [];
        }

        const ships = shipList.values.map(ship => {
            const shipData = {
                shipTypeID: ship.shipTypeID || ship.id,
                shipName: ship.shipName || ship.name || 'Unknown Ship',
                kills: ship.kills || 0,
                pip: ship.pip || 'pip_tech1.png',
                groupID: ship.groupID,
                groupName: ship.groupName || 'Unknown'
            };

            shipData.classification = this.classifyShip(shipData);

            return shipData;
        });

        return ships;
    }

    extractTopPlayers(data) {
        const topLists = data.topLists || [];
        const characterList = topLists.find(list => list.type === 'character');

        if (!characterList || !characterList.values) {
            return [];
        }

        return characterList.values.slice(0, 10).map(player => ({
            characterId: player.characterID || player.id,
            characterName: player.characterName || player.name || 'Unknown',
            kills: player.kills || 0
        }));
    }

    classifyShip(ship) {
        let techLevel = 'T1';
        if (ship.pip && ship.pip.includes('tech2')) techLevel = 'T2';
        else if (ship.pip && ship.pip.includes('faction')) techLevel = 'Faction';
        else if (ship.pip && ship.pip.includes('tech3')) techLevel = 'T3';

        let groupID = ship.groupID;

        if (!groupID && ship.shipTypeID && SHIP_TYPE_TO_GROUP[ship.shipTypeID]) {
            groupID = SHIP_TYPE_TO_GROUP[ship.shipTypeID];
        }

        const classification = getShipClassification(groupID);

        return {
            techLevel,
            size: classification.size,
            role: classification.role,
            category: classification.category
        };
    }

    analyzeShipUsage(data) {
        const ships = this.extractTopShips(data);
        if (!ships.length) return null;

        const totalKills = ships.reduce((sum, ship) => sum + ship.kills, 0);

        const diversity = this.calculateShipDiversity(ships);

        const sizeBreakdown = this.analyzeByCategory(ships, 'size');
        const techBreakdown = this.analyzeByCategory(ships, 'techLevel');
        const roleBreakdown = this.analyzeByCategory(ships, 'role');

        const specialization = this.findSpecialization(ships, totalKills);

        return {
            diversity,
            sizeBreakdown,
            techBreakdown,
            roleBreakdown,
            specialization,
            totalShipTypes: ships.length,
            topShips: ships.slice(0, 8)
        };
    }

    calculateShipDiversity(ships) {
        const totalKills = ships.reduce((sum, ship) => sum + ship.kills, 0);
        if (totalKills === 0) return 0;

        let entropy = 0;
        for (const ship of ships) {
            if (ship.kills > 0) {
                const probability = ship.kills / totalKills;
                entropy -= probability * Math.log2(probability);
            }
        }

        const maxPossibleEntropy = Math.log2(ships.length);
        return maxPossibleEntropy > 0 ? (entropy / maxPossibleEntropy) * 100 : 0;
    }

    analyzeByCategory(ships, category) {
        const categoryMap = new Map();
        const totalKills = ships.reduce((sum, ship) => sum + ship.kills, 0);

        ships.forEach(ship => {
            const value = ship.classification[category];
            if (!categoryMap.has(value)) {
                categoryMap.set(value, { count: 0, kills: 0, ships: [] });
            }
            const data = categoryMap.get(value);
            data.count++;
            data.kills += ship.kills;
            data.ships.push(ship.shipName);
        });

        const items = Array.from(categoryMap.entries()).map(([category, data]) => ({
            category,
            count: data.count,
            kills: data.kills,
            ships: data.ships
        }));

        const distributed = distributePercentages(items, totalKills, item => item.kills);
        return distributed.sort((a, b) => b.kills - a.kills);
    }

    findSpecialization(ships, totalKills) {
        if (!ships.length || totalKills === 0) return null;

        const topShip = ships[0];
        const topShipPercentage = Math.round((topShip.kills / totalKills) * 100);

        if (topShipPercentage >= 40) {
            return {
                type: 'Ship Specialist',
                focus: topShip.shipName,
                percentage: topShipPercentage,
                description: `Prefers the ${topShip.shipName}`
            };
        }

        const sizeData = this.analyzeByCategory(ships, 'size');
        const topSize = sizeData[0];
        if (topSize && topSize.percentage >= 60) {
            return {
                type: 'Size Specialist',
                focus: topSize.category,
                percentage: topSize.percentage,
                description: `Prefers ${topSize.category.toLowerCase()} ships`
            };
        }

        const roleData = this.analyzeByCategory(ships, 'role');
        const topRole = roleData[0];
        if (topRole && topRole.percentage >= 70) {
            return {
                type: 'Role Specialist',
                focus: topRole.category,
                percentage: topRole.percentage,
                description: `Focuses on ${topRole.category.toLowerCase()} roles`
            };
        }

        return {
            type: 'Generalist',
            focus: 'Diverse',
            percentage: Math.round(100 - this.calculateShipDiversity(ships)),
            description: 'Uses a variety of different ships'
        };
    }

    analyzeCombatStyle(data, memberCount) {
        const ships = this.extractTopShips(data);
        if (!ships.length) return null;

        const totalKills = ships.reduce((sum, ship) => sum + ship.kills, 0);
        if (totalKills === 0) return null;

        const roleKills = {
            dps: 0,
            tackle: 0,
            support: 0,
            logistics: 0,
            ewar: 0,
            scout: 0
        };

        ships.forEach(ship => {
            const category = ship.classification.category.toLowerCase();
            const groupName = ship.groupName.toLowerCase();
            const kills = ship.kills;

            if (category.includes('logistics') || groupName.includes('logistics')) {
                roleKills.logistics += kills;
            } else if (category.includes('interceptor')) {
                roleKills.tackle += kills;
            } else if (category.includes('electronic attack') || category.includes('recon') ||
                groupName.includes('electronic') || groupName.includes('recon')) {
                roleKills.ewar += kills;
            } else if (category.includes('covert ops') || category.includes('stealth bomber')) {
                roleKills.scout += kills;
            } else if (category.includes('command') || groupName.includes('command') ||
                category.includes('carrier') || category.includes('force auxiliary')) {
                roleKills.support += kills;
            } else if (ship.classification.role === 'Combat') {
                roleKills.dps += kills;
            }
        });

        const roleItems = Object.entries(roleKills).map(([role, kills]) => ({
            role,
            kills
        }));

        const rolePercentages = distributePercentages(roleItems, totalKills, item => item.kills)
            .sort((a, b) => b.kills - a.kills);

        const primaryRole = rolePercentages[0].percentage > 0 ? rolePercentages[0] : null;
        const secondaryRole = rolePercentages[1]?.percentage >= 15 ? rolePercentages[1] : null;

        const soloKills = this.safeGet(data, 'soloKills', 0);
        const totalKillsData = this.safeGet(data, 'shipsDestroyed', 0);
        const gangPreference = totalKillsData > 0 ?
            Math.round(((totalKillsData - soloKills) / totalKillsData) * 100) : 0;

        const fleetRole = gangPreference > 70 ? 'Fleet Fighter' :
            gangPreference < 30 ? 'Solo Hunter' : 'Flexible';

        const activepvp = data.activepvp || {};
        const activePlayerCount = activepvp.characters?.count || null;

        return {
            primaryRole: primaryRole ? {
                role: this.getRoleLabel(primaryRole.role),
                percentage: primaryRole.percentage
            } : null,
            secondaryRole: secondaryRole ? {
                role: this.getRoleLabel(secondaryRole.role),
                percentage: secondaryRole.percentage
            } : null,
            fleetRole,
            gangPreference,
            roleBreakdown: rolePercentages.filter(r => r.percentage > 0),
            memberCount,
            activePlayerCount
        };
    }

    getRoleLabel(role) {
        const labels = {
            'dps': 'DPS',
            'tackle': 'Tackle',
            'support': 'Fleet Support',
            'logistics': 'Logistics',
            'ewar': 'Cyno/e-war',
            'scout': 'Scout/Bomber'
        };
        return labels[role] || role;
    }

    mergeAnalyses(detailedAnalysis, zkillRoleAnalysis) {
        if (!detailedAnalysis) {
            return {
                blopsAnalysis: zkillRoleAnalysis.blopsAnalysis,
                cynoAnalysis: zkillRoleAnalysis.cynoAnalysis
            };
        }

        const mergedBlops = this.mergeSingleAnalysis(
            detailedAnalysis.blopsAnalysis,
            zkillRoleAnalysis.blopsAnalysis,
            'isBlopsUser'
        );

        const mergedCyno = this.mergeSingleAnalysis(
            detailedAnalysis.cynoAnalysis,
            zkillRoleAnalysis.cynoAnalysis,
            'isCynoPilot'
        );

        return {
            ...detailedAnalysis,
            blopsAnalysis: mergedBlops,
            cynoAnalysis: mergedCyno
        };
    }

    mergeSingleAnalysis(detailedAnalysis, zkillAnalysis, flagField) {
        if (!zkillAnalysis) return detailedAnalysis;
        if (!detailedAnalysis) return zkillAnalysis;

        const zkillFlag = zkillAnalysis[flagField];
        const detailedFlag = detailedAnalysis[flagField];

        if (zkillFlag && !detailedFlag) {
            return {
                ...detailedAnalysis,
                [flagField]: true,
                zkillStatsFlag: true,
                zkillData: zkillAnalysis
            };
        }

        return detailedAnalysis;
    }

    analyzeZkillStatsForSpecialRoles(stats) {
        const rawData = stats._rawData;
        const totalKills = stats.totalKills || 0;

        if (!rawData || !rawData.topAllTime || totalKills === 0) {
            return { cynoAnalysis: null, blopsAnalysis: null };
        }

        const topAllTime = rawData.topAllTime || [];
        const shipData = topAllTime.find(entry => entry.type === 'ship');

        if (!shipData || !shipData.data || !shipData.data.length) {
            return { cynoAnalysis: null, blopsAnalysis: null };
        }

        const CYNO_SHIP_IDS = [670, 33328, 33816, 11129, 11176, 28710, 33470, 11172];
        const FORCE_RECON_GROUP_ID = 833;
        const BLACK_OPS_GROUP_ID = 898;

        let cynoKills = 0;
        let cynoShips = [];
        let blopsKills = 0;
        let blopsShips = [];

        shipData.data.forEach(ship => {
            const shipTypeID = ship.shipTypeID;
            const kills = ship.kills || 0;

            const groupID = SHIP_TYPE_TO_GROUP[shipTypeID];

            const isCynoShip = CYNO_SHIP_IDS.includes(shipTypeID) || groupID === FORCE_RECON_GROUP_ID;
            const isBlopsShip = groupID === BLACK_OPS_GROUP_ID;

            if (isCynoShip) {
                cynoKills += kills;
                cynoShips.push({ shipTypeID: shipTypeID, kills: kills });
            }

            if (isBlopsShip) {
                blopsKills += kills;
                blopsShips.push({ shipTypeID: shipTypeID, kills: kills });
            }
        });

        const cynoFrequency = cynoKills / totalKills;
        const blopsFrequency = blopsKills / totalKills;

        const cynoAnalysis = {
            isCynoPilot: cynoKills >= 10 && cynoFrequency >= 0.15,
            cynoShipCount: cynoKills,
            cynoFrequency: Math.round(cynoFrequency * 100),
            confidence: cynoKills >= 30 ? 'high' : cynoKills >= 10 ? 'medium' : 'low',
            cynoShips: cynoShips,
            source: 'zkill_stats'
        };

        const blopsAnalysis = {
            isBlopsUser: blopsKills >= 5 && blopsFrequency >= 0.10,
            blopsCount: blopsKills,
            blopsFrequency: Math.round(blopsFrequency * 100),
            confidence: blopsKills >= 20 ? 'high' : blopsKills >= 5 ? 'medium' : 'low',
            blopsShips: blopsShips,
            source: 'zkill_stats'
        };

        return { cynoAnalysis, blopsAnalysis };
    }

    checkForCapitalShip(stats) {
        const rawData = stats._rawData;
        if (!rawData || !rawData.topAllTime) {
            return false;
        }

        const topAllTime = rawData.topAllTime || [];
        const shipData = topAllTime.find(entry => entry.type === 'ship');

        if (!shipData || !shipData.data || !shipData.data.length) {
            return false;
        }

        const CAPITAL_GROUP_IDS = [485, 547, 659, 30, 1538, 4594, 883];

        for (const ship of shipData.data) {
            const shipTypeID = ship.shipTypeID;
            const groupID = SHIP_TYPE_TO_GROUP[shipTypeID];

            if (groupID && CAPITAL_GROUP_IDS.includes(groupID)) {
                return true;
            }
        }

        return false;
    }

    enrichCombatStyleWithKillmails(existingStyle, killmailAnalysis, stats = null) {
        if (!killmailAnalysis || !existingStyle) {
            return existingStyle;
        }

        const fleetSize = killmailAnalysis.fleetSizeAnalysis;
        const soloVsFleet = killmailAnalysis.soloVsFleet;
        const shipComp = killmailAnalysis.shipComposition;
        const hvtAnalysis = killmailAnalysis.hvtAnalysis;
        const targetPrefs = killmailAnalysis.targetPreferences;
        const engagement = killmailAnalysis.engagementPatterns;
        const blopsAnalysis = killmailAnalysis.blopsAnalysis;
        const cynoAnalysis = killmailAnalysis.cynoAnalysis;

        let enhancedFleetRole = existingStyle.fleetRole;
        let playstyleDetails = [];
        let tagScores = {};

        if (blopsAnalysis && blopsAnalysis.isBlopsUser) {
            playstyleDetails.push('Blops');
        }

        if (cynoAnalysis && cynoAnalysis.isCynoPilot) {
            playstyleDetails.push('Cyno');
        }

        const hasCapitalShip = this.checkForCapitalShip(stats);
        if (hasCapitalShip) {
            playstyleDetails.push('Capital');
        }

        
        if (soloVsFleet.smallGang.percentage > 50) {
            enhancedFleetRole = 'Small Gang Specialist';
            playstyleDetails.push('Small Gang');
        } else if (soloVsFleet.fleet.percentage > 60 && fleetSize.average > 30) {
            enhancedFleetRole = 'Blobber';
        } else if (soloVsFleet.fleet.percentage > 50) {
            enhancedFleetRole = 'Fleet Fighter';
        } else if (soloVsFleet.solo.percentage > 50) {
            enhancedFleetRole = 'Lone Wolf';
            playstyleDetails.push('Solo');
        } else {
            enhancedFleetRole = 'Adaptable';
        }

        const blobEngagements = soloVsFleet.fleet.count;
        const totalEngagements = killmailAnalysis.totalKillmails;
        tagScores.blob = (fleetSize.average > 30 && fleetSize.max > 50) ? (blobEngagements / totalEngagements) : 0;
        if (tagScores.blob > 0.5 && fleetSize.average > 30) {
            playstyleDetails.push('Blob');
        }

        if (hvtAnalysis && hvtAnalysis.isHVTHunter) {
            tagScores.hvtHunter = hvtAnalysis.hvtFrequency / 100;
            playstyleDetails.push('HVT Hunter');
        }

        if (targetPrefs) {
            if (targetPrefs.industrialHunter) {
                playstyleDetails.push('Industrial Hunter');
            }
            if (targetPrefs.capitalHunter) {
                playstyleDetails.push('Capital Hunter');
            }
        }

        if (engagement) {
            if (engagement.huntingStyle === 'Gate Camp') {
                playstyleDetails.push('Gate Camper');
            }
        }

        if (shipComp.uniqueShips < 5) {
            playstyleDetails.push('Specialist');
        }

        return {
            ...existingStyle,
            fleetRole: enhancedFleetRole,
            playstyleDetails: playstyleDetails.slice(0, 3),
            enrichedWithKillmails: true,
            fleetSizeRange: {
                min: fleetSize.min,
                max: fleetSize.max,
                avg: fleetSize.average
            },
            tagScores,
            hvtAnalysis,
            targetPreferences: targetPrefs,
            engagementPatterns: engagement,
            blopsAnalysis,
            cynoAnalysis
        };
    }

    analyzeActivityInsights(data) {
        const months = data.months || {};
        const activity = data.activity || {};

        const monthEntries = Object.entries(months)
            .filter(([, monthData]) => (monthData.shipsDestroyed || 0) > 0)
            .sort(([a], [b]) => b.localeCompare(a))
            .slice(0, 6);

        let trend = 'Stable';
        if (monthEntries.length >= 3) {
            const recent = monthEntries.slice(0, 3).reduce((sum, [, data]) => sum + (data.shipsDestroyed || 0), 0);
            const older = monthEntries.slice(3, 6).reduce((sum, [, data]) => sum + (data.shipsDestroyed || 0), 0);

            if (recent > older * 1.5) trend = 'Increasing';
            else if (recent < older * 0.5) trend = 'Decreasing';
        }

        const activeMonths = monthEntries.length;
        const consistency = activeMonths >= 6 ? 'High' :
            activeMonths >= 3 ? 'Moderate' :
                activeMonths >= 1 ? 'Sporadic' : 'Inactive';
        let primeTime = 'Unknown';
        let timezone = 'Unknown';
        const hasActivityData = activity && activity.max && Object.keys(activity).length > 1;
        if (hasActivityData) {
            const hourlyTotals = new Array(24).fill(0);
            for (let day = 0; day < 7; day++) {
                const dayData = activity[day.toString()];
                if (dayData && typeof dayData === 'object') {
                    for (let hour = 0; hour < 24; hour++) {
                        hourlyTotals[hour] += dayData[hour.toString()] || 0;
                    }
                }
            }

            const timezoneResult = calculateTimezoneFromHourlyData(hourlyTotals);
            primeTime = timezoneResult.primeTime.replace(' EVE Time', ' EVE');
            timezone = timezoneResult.timezone;
        }

        return {
            trend,
            consistency,
            primeTime,
            timezone,
            activeMonths,
            recentActivity: monthEntries.slice(0, 3).reduce((sum, [, data]) => sum + (data.shipsDestroyed || 0), 0)
        };
    }

    calculateTimezoneFromKillmails(killmails) {
        return calculateTimezoneFromKillmails(killmails);
    }

    async analyzeSecurityPreferenceFromKillmails(killmails, fallbackData) {
        const { getCachedUniverseName, setCachedUniverseName } = await import('./database.js');
        const { esiClient } = await import('./esi-client.js');

        const uniqueSystemIds = [...new Set(killmails.map(km => km.killmail?.solar_system_id).filter(id => id))];
        const systemInfoMap = new Map();

        for (let i = 0; i < uniqueSystemIds.length; i += 20) {
            const batch = uniqueSystemIds.slice(i, i + 20);
            await Promise.all(batch.map(async (systemId) => {
                try {
                    let cached = await getCachedUniverseName(systemId);

                    if (cached && cached.name && cached.security !== undefined && cached.security !== null) {
                        systemInfoMap.set(systemId, {
                            name: cached.name,
                            security: cached.security
                        });
                    } else {
                        const data = await esiClient.get(`/universe/systems/${systemId}/`);
                        if (data && data.name && data.security_status !== undefined) {
                            systemInfoMap.set(systemId, {
                                name: data.name,
                                security: data.security_status
                            });
                            await setCachedUniverseName(systemId, data.name, data.security_status);
                        }
                    }
                } catch (e) {
                    console.error(`Error fetching system ${systemId}:`, e);
                }
            }));
        }

        let highsecKills = 0;
        let lowsecKills = 0;
        let nullsecKills = 0;
        let pochvenKills = 0;
        let wspaceKills = 0;

        killmails.forEach(km => {
            const systemId = km.killmail?.solar_system_id;
            if (!systemId) return;

            const systemInfo = systemInfoMap.get(systemId);
            if (!systemInfo || systemInfo.security === undefined || systemInfo.security === null) {
                return;
            }

            const sec = systemInfo.security;
            const systemName = systemInfo.name;
            const classification = SecurityClassification.classify(sec, systemName);

            if (classification.cssClass === 'sec-high') {
                highsecKills += 1;
            } else if (classification.cssClass === 'sec-low') {
                lowsecKills += 1;
            } else if (classification.cssClass === 'sec-null') {
                nullsecKills += 1;
            } else if (classification.cssClass === 'sec-pochven') {
                pochvenKills += 1;
            } else if (classification.cssClass === 'sec-wspace') {
                wspaceKills += 1;
            }
        });

        let total = highsecKills + lowsecKills + nullsecKills + pochvenKills + wspaceKills;

        if (total === 0) {
            return this.analyzeSecurityPreference(fallbackData, null);
        }

        const rawBreakdown = [
            { space: 'Highsec', kills: highsecKills },
            { space: 'Lowsec', kills: lowsecKills },
            { space: 'Nullsec', kills: nullsecKills },
            { space: 'Pochven', kills: pochvenKills },
            { space: 'W-Space', kills: wspaceKills }
        ].filter(item => item.kills > 0);

        const breakdown = distributePercentages(rawBreakdown, total, item => item.kills)
            .sort((a, b) => b.kills - a.kills);

        const primary = breakdown[0]?.space || 'Unknown';
        const riskProfile = this.calculateRiskProfile(fallbackData, breakdown, { rawKillmails: killmails });

        return {
            primary,
            breakdown,
            riskProfile
        };
    }

    analyzeSecurityPreference(data, killmailData = null) {
        let highsecKills = 0;
        let lowsecKills = 0;
        let nullsecKills = 0;
        let pochvenKills = 0;
        let wspaceKills = 0;

        const killsToAnalyze = killmailData?.allKills || killmailData?.recentKills;

        if (killmailData && killsToAnalyze && killsToAnalyze.length > 0) {
            killsToAnalyze.forEach(kill => {
                const sec = kill.systemSecurity;
                const systemName = kill.systemName || '';

                if (sec === undefined || sec === null) {
                    return;
                }

                const classification = SecurityClassification.classify(sec, systemName);

                if (classification.cssClass === 'sec-high') {
                    highsecKills += 1;
                } else if (classification.cssClass === 'sec-low') {
                    lowsecKills += 1;
                } else if (classification.cssClass === 'sec-null') {
                    nullsecKills += 1;
                } else if (classification.cssClass === 'sec-pochven') {
                    pochvenKills += 1;
                } else if (classification.cssClass === 'sec-wspace') {
                    wspaceKills += 1;
                }
            });
        } else {
            const topLists = data.topLists || [];
            const systemList = topLists.find(list => list.type === 'solarSystem' || list.type === 'system');

            if (systemList && systemList.values && systemList.values.length > 0) {
                systemList.values.forEach(system => {
                    const kills = system.kills || 0;
                    const sec = system.solarSystemSecurity;
                    const systemName = system.solarSystemName || system.name || '';

                    if (sec === undefined || sec === null) {
                        return;
                    }

                    const classification = SecurityClassification.classify(sec, systemName);

                    if (classification.cssClass === 'sec-high') {
                        highsecKills += kills;
                    } else if (classification.cssClass === 'sec-low') {
                        lowsecKills += kills;
                    } else if (classification.cssClass === 'sec-null') {
                        nullsecKills += kills;
                    } else if (classification.cssClass === 'sec-pochven') {
                        pochvenKills += kills;
                    } else if (classification.cssClass === 'sec-wspace') {
                        wspaceKills += kills;
                    }
                });
            }
        }

        let total = highsecKills + lowsecKills + nullsecKills + pochvenKills + wspaceKills;

        if (total === 0) {
            const labels = data.labels || {};
            const highsec = labels['loc:highsec'] || {};
            const lowsec = labels['loc:lowsec'] || {};
            const nullsec = labels['loc:nullsec'] || {};
            const wspace = labels['loc:w-space'] || {};
            const pochven = labels['loc:pochven'] || {};

            highsecKills = this.safeGet(highsec, 'shipsDestroyed', 0);
            lowsecKills = this.safeGet(lowsec, 'shipsDestroyed', 0);
            nullsecKills = this.safeGet(nullsec, 'shipsDestroyed', 0);
            wspaceKills = this.safeGet(wspace, 'shipsDestroyed', 0);
            pochvenKills = this.safeGet(pochven, 'shipsDestroyed', 0);

            total = highsecKills + lowsecKills + nullsecKills + pochvenKills + wspaceKills;
        }

        if (total === 0) {
            return {
                primary: 'Unknown',
                breakdown: [],
                riskProfile: 'Unknown'
            };
        }

        const rawBreakdown = [
            { space: 'Highsec', kills: highsecKills },
            { space: 'Lowsec', kills: lowsecKills },
            { space: 'Nullsec', kills: nullsecKills },
            { space: 'Pochven', kills: pochvenKills },
            { space: 'W-Space', kills: wspaceKills }
        ].filter(item => item.kills > 0);

        const breakdown = distributePercentages(rawBreakdown, total, item => item.kills)
            .sort((a, b) => b.kills - a.kills);

        const primary = breakdown[0]?.space || 'Unknown';

        const riskProfile = this.calculateRiskProfile(data, breakdown, killmailData);

        return {
            primary,
            breakdown,
            riskProfile
        };
    }

    calculateRiskProfile(data, secBreakdown, killmailData = null) {
        let riskScore = 0;

        const totalKills = this.safeGet(data, 'shipsDestroyed', 0);
        const soloKills = this.safeGet(data, 'soloKills', 0);

        const lowsecPct = secBreakdown.find(b => b.space === 'Lowsec')?.percentage || 0;
        const nullsecPct = secBreakdown.find(b => b.space === 'Nullsec')?.percentage || 0;
        const wspacePct = secBreakdown.find(b => b.space === 'W-Space')?.percentage || 0;
        const highsecPct = secBreakdown.find(b => b.space === 'Highsec')?.percentage || 0;

        riskScore += highsecPct * 0.4;
        riskScore += lowsecPct * 0.45;
        riskScore += nullsecPct * 0.45;
        riskScore += wspacePct * 0.5;

        if (killmailData?.recentKills && killmailData.recentKills.length > 0) {
            const activityScore = this.analyzeActivityPattern(killmailData.recentKills, totalKills);
            riskScore += activityScore;
        } else {
            const fallbackActivityScore = this.estimateActivityFromStats(data, totalKills);
            riskScore += fallbackActivityScore;
        }

        if (killmailData?.analysis) {
            const analysis = killmailData.analysis;
            const avgValue = analysis.avgValue || 0;

            if (analysis.hvtAnalysis?.isHVTHunter) {
                const confidence = analysis.hvtAnalysis.confidence;
                if (confidence === 'very high') riskScore += 15;
                else if (confidence === 'high') riskScore += 12;
                else riskScore += 8;
            }

            if (analysis.targetPreferences?.capitalHunter) {
                riskScore += 10;
            }

            if (avgValue > 1000000000) {
                riskScore += 12;
            } else if (avgValue > 500000000) {
                riskScore += 6;
            } else if (avgValue > 250000000) {
                riskScore += 3;
            }

            const soloVsFleet = analysis.soloVsFleet;
            if (soloVsFleet?.solo?.percentage > 50) {
                riskScore += 12;
            }

            if (analysis.engagementPatterns?.huntingStyle === 'Roaming Hunter') {
                riskScore += 6;
            }

            if (analysis.shipComposition?.uniqueShips > 20) {
                riskScore += 4;
            } else if (analysis.shipComposition?.uniqueShips > 15) {
                riskScore += 2;
            }

            if (analysis.cynoAnalysis?.isCynoPilot) {
                const confidence = analysis.cynoAnalysis.confidence;
                if (confidence === 'very high') riskScore += 20;
                else if (confidence === 'high') riskScore += 15;
                else riskScore += 10;
            }

            if (analysis.blopsAnalysis?.isBlopsUser) {
                const confidence = analysis.blopsAnalysis.confidence;
                if (confidence === 'very high') riskScore += 18;
                else if (confidence === 'high') riskScore += 14;
                else riskScore += 10;
            }
        }

        const soloRatio = totalKills > 0 ? soloKills / totalKills : 0;
        if (soloRatio > 0.5) {
            riskScore += 20;
        } else if (soloRatio > 0.3) {
            riskScore += 15;
        }

        riskScore = Math.round(riskScore);

        if (riskScore >= 110) return `Extreme ${riskScore}`;
        if (riskScore >= 90) return `Very High ${riskScore}`;
        if (riskScore >= 70) return `High ${riskScore}`;
        if (riskScore >= 50) return `Moderate ${riskScore}`;
        if (riskScore >= 20) return `Low ${riskScore}`;
        return `Minimal Risk`;
    }

    analyzeActivityPattern(recentKills, totalKills) {
        if (!recentKills || recentKills.length === 0) return 0;

        const now = Date.now();
        const oneDayMs = 24 * 60 * 60 * 1000;

        const killsLast7d = recentKills.filter(k => {
            const killTime = new Date(k.time).getTime();
            return (now - killTime) < (7 * oneDayMs);
        }).length;

        const killsLast14d = recentKills.filter(k => {
            const killTime = new Date(k.time).getTime();
            return (now - killTime) < (14 * oneDayMs);
        }).length;

        const killsLast30d = recentKills.filter(k => {
            const killTime = new Date(k.time).getTime();
            return (now - killTime) < (30 * oneDayMs);
        }).length;

        const killsByDay = new Map();
        const uniqueSystems = new Set();
        const fleetSizes = [];

        recentKills.forEach(kill => {
            const killTime = new Date(kill.time).getTime();
            if ((now - killTime) < (30 * oneDayMs)) {
                const day = new Date(kill.time).toISOString().split('T')[0];
                if (!killsByDay.has(day)) {
                    killsByDay.set(day, []);
                }
                killsByDay.get(day).push(kill);
                if (kill.systemId) uniqueSystems.add(kill.systemId);
                if (kill.attackers) fleetSizes.push(kill.attackers);
            }
        });

        const activityDays = killsByDay.size;
        const systemDiversity = uniqueSystems.size;
        const fleetVariance = this.calculateVariance(fleetSizes);

        const isFleetFightSpike = this.detectFleetFightSpike(killsByDay, totalKills);

        let activityScore = 0;

        if (isFleetFightSpike) {
            activityScore += 8;
        } else {
            if (killsLast7d >= 15) {
                activityScore += 28;
            } else if (killsLast7d >= 10) {
                activityScore += 25;
            } else if (killsLast7d >= 5) {
                activityScore += 20;
            } else if (killsLast7d >= 3) {
                activityScore += 15;
            } else if (killsLast7d >= 1) {
                activityScore += 10;
            }
        }

        if (activityDays >= 20) {
            activityScore += 30;
        } else if (activityDays >= 15) {
            activityScore += 25;
        } else if (activityDays >= 10) {
            activityScore += 20;
        } else if (activityDays >= 7) {
            activityScore += 15;
        } else if (activityDays >= 5) {
            activityScore += 10;
        } else if (activityDays >= 3) {
            activityScore += 6;
        }

        if (systemDiversity >= 15) {
            activityScore += 12;
        } else if (systemDiversity >= 10) {
            activityScore += 8;
        } else if (systemDiversity >= 5) {
            activityScore += 4;
        }

        if (fleetVariance > 50) {
            activityScore += 8;
        } else if (fleetVariance > 20) {
            activityScore += 4;
        }

        const recencyRatio = killsLast14d / Math.max(totalKills, 1);
        if (recencyRatio < 0.08 && totalKills > 30) {
            activityScore *= 0.35;
        } else if (recencyRatio < 0.15 && totalKills > 50) {
            activityScore *= 0.55;
        } else if (recencyRatio < 0.25 && totalKills > 100) {
            activityScore *= 0.7;
        }

        if (totalKills > 150 && killsLast30d < 8) {
            activityScore *= 0.4;
        } else if (totalKills > 80 && killsLast30d < 5) {
            activityScore *= 0.5;
        }

        return Math.min(activityScore, 60);
    }

    detectFleetFightSpike(killsByDay, totalKills) {
        if (killsByDay.size === 0) return false;

        const killsPerDay = Array.from(killsByDay.values()).map(kills => kills.length);
        const maxKillsInDay = Math.max(...killsPerDay);
        const avgKillsPerDay = killsPerDay.reduce((a, b) => a + b, 0) / killsPerDay.length;

        if (maxKillsInDay < 15) return false;

        const daysWithSignificantActivity = killsPerDay.filter(count => count >= 8).length;

        if (maxKillsInDay >= 40 && maxKillsInDay > (avgKillsPerDay * 4) && daysWithSignificantActivity <= 2) {
            return true;
        }

        if (maxKillsInDay >= 25 && maxKillsInDay > (avgKillsPerDay * 5) && daysWithSignificantActivity <= 1) {
            return true;
        }

        const topDay = Array.from(killsByDay.entries())
            .sort((a, b) => b[1].length - a[1].length)[0];

        if (!topDay) return false;

        const topDayKills = topDay[1];
        const topDayRatio = topDayKills.length / totalKills;

        if (topDayRatio > 0.6 && totalKills > 20) {
            const uniqueSystems = new Set(topDayKills.map(k => k.systemId).filter(Boolean));
            const avgFleetSize = topDayKills
                .map(k => k.attackers || 0)
                .reduce((a, b) => a + b, 0) / topDayKills.length;

            if (uniqueSystems.size <= 2 && avgFleetSize > 20) {
                return true;
            }
        }

        return false;
    }

    estimateActivityFromStats(data, totalKills) {
        const months = data.months || {};
        const monthEntries = Object.entries(months)
            .filter(([, monthData]) => (monthData.shipsDestroyed || 0) > 0)
            .sort(([a], [b]) => b.localeCompare(a));

        if (monthEntries.length === 0) return 0;

        const currentMonth = monthEntries[0]?.[1]?.shipsDestroyed || 0;
        const lastMonth = monthEntries[1]?.[1]?.shipsDestroyed || 0;

        const activeMonths = monthEntries.slice(0, 6).filter(([, data]) =>
            (data.shipsDestroyed || 0) > 5
        ).length;

        let activityScore = 0;

        if (currentMonth >= 20) {
            activityScore += 15;
        } else if (currentMonth >= 10) {
            activityScore += 10;
        } else if (currentMonth >= 5) {
            activityScore += 8;
        } else if (currentMonth >= 2) {
            activityScore += 5;
        }

        if (activeMonths >= 5) {
            activityScore += 10;
        } else if (activeMonths >= 3) {
            activityScore += 8;
        } else if (activeMonths === 1) {
            activityScore *= 0.7;
        }

        const monthlyConsistency = lastMonth > 0 ? Math.min(currentMonth / lastMonth, 2) : 1;
        if (monthlyConsistency > 0.8 && monthlyConsistency < 1.3) {
            activityScore += 8;
        }

        return Math.min(activityScore, 30);
    }

    calculateVariance(numbers) {
        if (numbers.length < 2) return 0;
        const mean = numbers.reduce((a, b) => a + b, 0) / numbers.length;
        const squareDiffs = numbers.map(value => Math.pow(value - mean, 2));
        return Math.sqrt(squareDiffs.reduce((a, b) => a + b, 0) / numbers.length);
    }

    extractActivePeriods(data) {
        const months = data.months || {};

        return Object.entries(months)
            .filter(([, monthData]) =>
                (monthData.shipsDestroyed || 0) > 0 || (monthData.shipsLost || 0) > 0
            )
            .sort(([a], [b]) => b.localeCompare(a))
            .slice(0, 6)
            .map(([monthKey, monthData]) => {
                const year = monthKey.substring(0, 4);
                const month = monthKey.substring(4, 6);
                const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                const readableMonth = `${monthNames[parseInt(month) - 1]} ${year}`;

                return {
                    period: readableMonth,
                    kills: monthData.shipsDestroyed || 0,
                    losses: monthData.shipsLost || 0,
                    iskDestroyed: monthData.iskDestroyed || 0,
                    iskLost: monthData.iskLost || 0
                };
            });
    }

    buildActivityDataFromTotals(hourlyTotals, dailyTotals, dayLabels, hasValidData) {
        const hourlyData = hourlyTotals.map((kills, hour) => ({
            label: `${hour.toString().padStart(2, '0')}`,
            value: kills,
            hour: hour
        }));

        const dailyData = dailyTotals.map((kills, day) => ({
            label: dayLabels[day] || `Day ${day}`,
            value: kills,
            day: day
        }));

        return {
            hourlyData,
            dailyData,
            hasData: hasValidData,
            maxHourly: Math.max(...hourlyTotals),
            maxDaily: Math.max(...dailyTotals)
        };
    }

    extractActivityDataFromKillmails(killmails) {
        if (!killmails || killmails.length === 0) {
            return {
                hourlyData: [],
                dailyData: [],
                hasData: false
            };
        }

        const hourlyTotals = new Array(24).fill(0);
        const dailyTotals = new Array(7).fill(0);
        const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

        killmails.forEach(km => {
            const killTime = km.killmail?.killmail_time;
            if (!killTime) return;

            const date = new Date(killTime);
            const hour = date.getUTCHours();
            const day = date.getUTCDay();

            hourlyTotals[hour]++;
            dailyTotals[day]++;
        });

        return this.buildActivityDataFromTotals(hourlyTotals, dailyTotals, dayLabels, killmails.length > 0);
    }

    extractActivityData(data) {
        const activity = data.activity;

        if (!activity || typeof activity !== 'object') {
            return {
                hourlyData: [],
                dailyData: [],
                hasData: false
            };
        }

        const hourlyTotals = new Array(24).fill(0);
        const dailyTotals = new Array(7).fill(0);
        const dayLabels = activity.days || ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

        let hasValidData = false;

        for (let day = 0; day < 7; day++) {
            const dayData = activity[day.toString()];

            if (dayData && typeof dayData === 'object') {
                for (let hour = 0; hour < 24; hour++) {
                    const kills = dayData[hour.toString()] || 0;
                    hourlyTotals[hour] += kills;
                    dailyTotals[day] += kills;
                    if (kills > 0) hasValidData = true;
                }
            } else if (Array.isArray(dayData) && dayData.length === 24) {
                dayData.forEach((kills, hour) => {
                    const killCount = kills || 0;
                    hourlyTotals[hour] += killCount;
                    dailyTotals[day] += killCount;
                    if (killCount > 0) hasValidData = true;
                });
            }
        }

        return this.buildActivityDataFromTotals(hourlyTotals, dailyTotals, dayLabels, hasValidData);
    }
    getStats() {
        return {
            requests: this.requestCount,
            cache: this.cache.getStats(),
            queueSize: this.rateLimiter.requestQueue.length
        };
    }

}

const zkillClient = new ZKillboardClient();


export async function get_zkill_character_stats(charId, options = {}) {
    try {
        if (options.includeKillmails) {
            return await zkillClient.getEntityStatsWithKillmails('characterID', charId, options);
        }
        return await zkillClient.getEntityStats('characterID', charId);
    } catch (error) {
        console.error(`Failed to get character stats for ${charId}:`, error);

        if (error instanceof ZKillError) {
            if (error.status !== 404) {
                showWarning(`zKillboard: ${error.message}`);
            }
        }

        return zkillClient.createEmptyStats('characterID', charId);
    }
}

export async function get_zkill_corporation_stats(corpId, options = {}) {
    try {
        if (options.includeKillmails) {
            return await zkillClient.getEntityStatsWithKillmails('corporationID', corpId, options);
        }
        return await zkillClient.getEntityStats('corporationID', corpId);
    } catch (error) {
        console.error(`Failed to get corporation stats for ${corpId}:`, error);

        if (error instanceof ZKillError) {
            if (error.status !== 404) {
                showWarning(`zKillboard: ${error.message}`);
            }
        }

        return zkillClient.createEmptyStats('corporationID', corpId);
    }
}

export async function get_zkill_alliance_stats(allianceId, options = {}) {
    try {
        if (options.includeKillmails) {
            return await zkillClient.getEntityStatsWithKillmails('allianceID', allianceId, options);
        }
        return await zkillClient.getEntityStats('allianceID', allianceId);
    } catch (error) {
        console.error(`Failed to get alliance stats for ${allianceId}:`, error);

        if (error instanceof ZKillError) {
            if (error.status !== 404) {
                showWarning(`zKillboard: ${error.message}`);
            }
        }

        return zkillClient.createEmptyStats('allianceID', allianceId);
    }
}