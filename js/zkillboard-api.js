/*
    EVE Target Intel - zKillboard API Integration
    
    Copyright (C) 2025 moregh (https://github.com/moregh/)
    Licensed under AGPL License.
*/

import { USER_AGENT } from './config.js';
import { showWarning } from './ui.js';

/**
 * zKillboard API Configuration
 */
const ZKILL_CONFIG = {
    // PROXY_URLS: [
    //     'https://zkillproxy.zkillproxy.workers.dev/',
    //     'https://your-project-name.vercel.app/api/zkill',
    // ],

    // PROXY_BASE_URL: 'https://zkill-proxy.vercel.app/api/zkill',
    PROXY_BASE_URL: 'https://zkill2.zkillproxy.workers.dev/',
    POW_DIFFICULTY: 12, // bitsize, 16 = 4 zeros, 12 = 3 zeros
    USER_AGENT: USER_AGENT,
    // Reduced intervals since we're using our own proxy
    REQUEST_INTERVAL_MS: 2000, // 2 seconds between requests
    CACHE_DURATION_MS: 30 * 60 * 1000, // 30 minutes
    REQUEST_TIMEOUT_MS: 15000,
    MAX_RETRIES: 3,
    MAX_CONCURRENT_REQUESTS: 1,
    BATCH_DELAY_MS: 2500
};

/**
 * zKillboard Error types for better error handling
 */
class ZKillError extends Error {
    constructor(message, status, entityType, entityId) {
        super(message);
        this.name = 'ZKillError';
        this.status = status;
        this.entityType = entityType;
        this.entityId = entityId;
    }
}

/**
 * Rate limiting and request queue management
 */
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
                    console.log(`Rate limiting: waiting ${delayNeeded}ms`);
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

/**
 * In-memory cache for zKillboard stats
 */
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

        // Check if cache is expired
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

    clear() {
        this.cache.clear();
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

/**
 * Main zKillboard API Client
 */
class ZKillboardClient {
    constructor() {
        this.rateLimiter = new ZKillRateLimiter();
        this.cache = new ZKillStatsCache();
        this.requestCount = 0;
    }

    /**
     * Execute HTTP request with timeout and retry logic
     */
    /**
     * Execute HTTP request with CORS proxy and retry logic
     */
    /**
     * Compute proof-of-work for the proxy authentication
     */
    async computePoW(id, difficulty = ZKILL_CONFIG.POW_DIFFICULTY) {
        const ts = Math.floor(Date.now() / 1000);
        let nonce = 0;
        const targetPrefix = '0'.repeat(difficulty / 4); // 16 bits = 4 hex chars

        while (true) {
            const input = `${id}|${nonce}|${ts}`;
            const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
            const hashHex = [...new Uint8Array(buf)]
                .map(x => x.toString(16).padStart(2, "0"))
                .join("");

            if (hashHex.startsWith(targetPrefix)) {
                return { nonce, ts, hash: hashHex };
            }
            nonce++;

            // Prevent infinite loops - if we haven't found a solution after 1M attempts, something's wrong
            if (nonce > 1000000) {
                throw new ZKillError('Proof-of-work computation failed - too many iterations', 500);
            }
        }
    }
    /**
 * Execute HTTP request using custom proxy with proof-of-work
 */
    /**
     * Execute HTTP request using custom proxy with proof-of-work
     */
    async executeRequest(entityType, entityId, retryCount = 0) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), ZKILL_CONFIG.REQUEST_TIMEOUT_MS);

        try {
            // Map entity types to proxy parameters
            const entityTypeMap = {
                'characterID': 'character',
                'corporationID': 'corporation',
                'allianceID': 'alliance'
            };

            const proxyParam = entityTypeMap[entityType];
            if (!proxyParam) {
                throw new ZKillError(`Unsupported entity type: ${entityType}`, 400);
            }

            // Compute proof-of-work
            // console.log(`Computing proof-of-work for ${entityType} ${entityId}...`);
            // const powStart = performance.now();
            const { nonce, ts, hash } = await this.computePoW(entityId);
            // const powTime = Math.round(performance.now() - powStart);
            // console.log(`Proof-of-work computed in ${powTime}ms: nonce=${nonce}, hash=${hash.substring(0, 8)}...`);

            // Build proxy URL
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
                    // Entity not found or no data
                    return null;
                } else if (response.status === 429 || response.status === 420) {
                    throw new ZKillError('Rate limited by proxy. Please try again later.', 429);
                } else if (response.status >= 500) {
                    throw new ZKillError(`Proxy server error (${response.status})`, response.status);
                } else if (response.status === 400) {
                    throw new ZKillError('Invalid proof-of-work or request format', 400);
                } else {
                    throw new ZKillError(`Proxy request failed: ${response.status} ${response.statusText}`, response.status);
                }
            }

            const text = await response.text();

            try {
                const data = JSON.parse(text);
                return data;
            } catch (parseError) {
                console.warn('Failed to parse JSON response:', text.substring(0, 200));
                throw new ZKillError('Invalid JSON response from proxy', 422);
            }

        } catch (error) {
            clearTimeout(timeoutId);

            if (error.name === 'AbortError') {
                throw new ZKillError('Request timed out. Please try again.', 408);
            }

            // Retry logic for certain errors
            if (retryCount < ZKILL_CONFIG.MAX_RETRIES &&
                (error.status >= 500 || error.status === 408 || error.status === 429)) {

                const backoffDelay = Math.min(1000 * Math.pow(2, retryCount), 10000);
                console.warn(`Proxy request failed, retrying in ${backoffDelay}ms (attempt ${retryCount + 1}/${ZKILL_CONFIG.MAX_RETRIES})`);

                await new Promise(resolve => setTimeout(resolve, backoffDelay));
                return this.executeRequest(entityType, entityId, retryCount + 1);
            }

            throw error;
        }
    }

    /**
     * Build proxy URL for CORS bypass
     */
    buildProxyUrl(originalUrl) {
        const currentProxy = ZKILL_CONFIG.CORS_PROXIES[ZKILL_CONFIG.CURRENT_PROXY_INDEX];
        return currentProxy + encodeURIComponent(originalUrl);
    }

    /**
     * Switch to next available CORS proxy
     */
    switchToNextProxy() {
        ZKILL_CONFIG.CURRENT_PROXY_INDEX =
            (ZKILL_CONFIG.CURRENT_PROXY_INDEX + 1) % ZKILL_CONFIG.CORS_PROXIES.length;

        const newProxy = ZKILL_CONFIG.CORS_PROXIES[ZKILL_CONFIG.CURRENT_PROXY_INDEX];
        console.log(`Switching to CORS proxy: ${newProxy}`);
    }

    /**
     * Get current proxy info for debugging
     */
    getCurrentProxyInfo() {
        return {
            currentIndex: ZKILL_CONFIG.CURRENT_PROXY_INDEX,
            currentProxy: ZKILL_CONFIG.CORS_PROXIES[ZKILL_CONFIG.CURRENT_PROXY_INDEX],
            availableProxies: ZKILL_CONFIG.CORS_PROXIES.length
        };
    }
    /**
    * Get performance statistics
     */
    /**
 * Get performance statistics
 */
    getStats() {
        return {
            requests: this.requestCount,
            cache: this.cache.getStats(),
            queueSize: this.rateLimiter.requestQueue.length,
            proxy: 'Custom zKillboard Proxy'
        };
    }

    /**
     * Get stats for any entity type
     */
    async getEntityStats(entityType, entityId) {
        // Validate inputs
        if (!entityType || !['characterID', 'corporationID', 'allianceID'].includes(entityType)) {
            throw new ZKillError('Invalid entity type. Must be characterID, corporationID, or allianceID', 400, entityType, entityId);
        }

        if (!entityId || isNaN(entityId)) {
            throw new ZKillError('Invalid entity ID. Must be a number', 400, entityType, entityId);
        }

        entityId = parseInt(entityId);

        // Check cache first
        const cached = this.cache.get(entityType, entityId);
        if (cached) {
            return cached;
        }

        try {
            // Use rate limiter to ensure proper spacing between requests
            const rawData = await this.rateLimiter.scheduleRequest(() =>
                this.executeRequest(entityType, entityId)
            );

            // Handle case where entity has no data
            if (!rawData) {
                const emptyResult = this.createEmptyStats(entityType, entityId);
                this.cache.set(entityType, entityId, emptyResult);
                return emptyResult;
            }

            // Process and normalize the data
            const processedData = this.processStatsData(rawData, entityType, entityId);

            // Cache the result
            this.cache.set(entityType, entityId, processedData);

            return processedData;

        } catch (error) {
            if (error instanceof ZKillError) {
                throw error;
            }

            // Wrap unexpected errors
            throw new ZKillError(
                `Failed to fetch zKillboard stats for ${entityType} ${entityId}: ${error.message}`,
                500,
                entityType,
                entityId
            );
        }
    }

    /**
     * Process raw zKillboard data into normalized format
     */
    processStatsData(rawData, entityType, entityId) {
        const stats = {
            entityType: entityType,
            entityId: parseInt(entityId),
            totalKills: this.safeGet(rawData, 'shipsDestroyed', 0),
            totalLosses: this.safeGet(rawData, 'shipsLost', 0), // This is correct
            soloKills: this.safeGet(rawData, 'soloKills', 0),
            soloLosses: this.safeGet(rawData, 'soloLosses', 0), // Add solo losses
            iskDestroyed: this.safeGet(rawData, 'iskDestroyed', 0),
            iskLost: this.safeGet(rawData, 'iskLost', 0),
            efficiency: this.calculateEfficiency(rawData),
            dangerRatio: this.calculateDangerRatio(rawData),
            gangRatio: this.calculateGangRatio(rawData),
            recentActivity: this.extractRecentActivity(rawData),
            topLocations: this.extractTopLocations(rawData),
            topShips: this.extractTopShips(rawData),
            shipAnalysis: this.analyzeShipUsage(rawData),
            combatStyle: this.analyzeCombatStyle(rawData),
            activityInsights: this.analyzeActivityInsights(rawData),
            securityPreference: this.analyzeSecurityPreference(rawData),
            activePeriods: this.extractActivePeriods(rawData),
            activityData: this.extractActivityData(rawData),
            lastUpdated: Date.now()
        };

        return stats;
    }

    /**
     * Create empty stats object for entities with no data
     */
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
            shipAnalysis: null,
            combatStyle: null,
            activityInsights: null,
            securityPreference: null,
            activePeriods: [],
            activityData: { hourlyData: [], dailyData: [], hasData: false },
            lastUpdated: Date.now()
        };
    }

    /**
     * Safe getter with default values
     */
    safeGet(obj, path, defaultValue = 0) {
        try {
            return obj[path] !== undefined ? obj[path] : defaultValue;
        } catch {
            return defaultValue;
        }
    }

    /**
     * Calculate ISK efficiency percentage
     */
    calculateEfficiency(data) {
        const destroyed = this.safeGet(data, 'iskDestroyed', 0);
        const lost = this.safeGet(data, 'iskLost', 0);

        if (destroyed === 0 && lost === 0) return 0.00;
        if (lost === 0) return 100.00;

        const efficiency = (destroyed / (destroyed + lost)) * 100;
        return Math.round(efficiency * 100) / 100; // 2 decimal places
    }

    /**
     * Calculate danger ratio (losses per kill)
     */
    calculateDangerRatio(data) {
        const kills = this.safeGet(data, 'shipsDestroyed', 0);
        const losses = this.safeGet(data, 'shipsLost', 0);

        // Avoid division by zero
        const ratio = losses === 0 ? kills : kills / losses;

        // Round to 2 decimal places
        return parseFloat(ratio.toFixed(2));
    }

    /**
     * Calculate gang ratio (group kills vs solo kills)
     */
    calculateGangRatio(data) {
        const totalKills = this.safeGet(data, 'shipsDestroyed', 0);
        const soloKills = this.safeGet(data, 'soloKills', 0);

        if (totalKills === 0) return 0;
        return Math.round(((totalKills - soloKills) / totalKills) * 100);
    }

    /**
     * Extract recent activity data from months array
     */
    /**
     * Extract recent activity data from months array
     */
    extractRecentActivity(data) {
        const activepvp = data.activepvp || {};

        // Extract data from activepvp section
        const characters = activepvp.characters?.count || 1;  // default to 1 in case it's a character lookup
        const ships = activepvp.ships?.count || 0;
        const systems = activepvp.systems?.count || 0;
        const regions = activepvp.regions?.count || 0;
        const totalKills = activepvp.kills?.count || 0;

        // Since activepvp only gives us recent activity totals, we'll display this differently
        return {
            activePvPData: {
                ships,
                systems,
                regions,
                totalKills,
                characters
            },
            // Keep these for compatibility but mark as unavailable from this data source
            last7Days: { kills: 'N/A', losses: 'N/A' },
            last30Days: { kills: 'N/A', losses: 'N/A' },
            last90Days: { kills: 'N/A', losses: 'N/A' }
        };
    }

    /**
     * Extract top 3 most active locations
     */
    /**
     * Extract top 3 most active locations
     */
    extractTopLocations(data) {
        // Look for system data in topLists array
        const topLists = data.topLists || [];
        const systemList = topLists.find(list => list.type === 'solarSystem' || list.type === 'system');

        if (!systemList || !systemList.values) {
            return [];
        }

        // Return all systems, not just top 3
        return systemList.values.map(system => ({
            systemId: system.solarSystemID || system.id,
            systemName: system.solarSystemName || system.name || 'Unknown System',
            kills: system.kills || 0,
            // Remove losses since they're always 0
            securityStatus: system.solarSystemSecurity !== undefined
                ? parseFloat(system.solarSystemSecurity)
                : null
        }));
    }

    /**
     * Extract and analyze ship usage data
     */
    extractTopShips(data) {
        // Look for ship data in topLists array
        const topLists = data.topLists || [];
        const shipList = topLists.find(list => list.type === 'shipType');

        if (!shipList || !shipList.values) {
            return [];
        }

        // Get ship data with enhanced classification
        const ships = shipList.values.map(ship => {
            const shipData = {
                shipTypeID: ship.shipTypeID || ship.id,
                shipName: ship.shipName || ship.name || 'Unknown Ship',
                kills: ship.kills || 0,
                pip: ship.pip || 'pip_tech1.png',
                groupID: ship.groupID,
                groupName: ship.groupName || 'Unknown'
            };

            // Add ship classification
            shipData.classification = this.classifyShip(shipData);

            return shipData;
        });

        return ships;
    }

    /**
     * Classify ship by size, tech level, and role
     */
    classifyShip(ship) {
        const shipName = ship.shipName.toLowerCase();
        const groupName = ship.groupName.toLowerCase();

        // Determine tech level from pip or name
        let techLevel = 'T1';
        if (ship.pip && ship.pip.includes('tech2')) techLevel = 'T2';
        else if (ship.pip && ship.pip.includes('faction')) techLevel = 'Faction';
        else if (ship.pip && ship.pip.includes('tech3')) techLevel = 'T3';

        // Determine ship size using comprehensive EVE ship classification
        let size = 'Unknown';

        // Small ships (Frigates, Destroyers, and their variants)
        if (groupName.includes('frigate') || groupName.includes('destroyer') ||
            groupName.includes('interceptor') || groupName.includes('assault frigate') ||
            groupName.includes('covert ops') || groupName.includes('electronic attack ship') ||
            groupName.includes('stealth bomber') || groupName.includes('expedition frigate') ||
            groupName.includes('tactical destroyer')) {
            size = 'Small';
        }
        // Medium ships (Cruisers, Battlecruisers, and their variants)
        else if (groupName.includes('cruiser') || groupName.includes('battlecruiser') ||
                 groupName.includes('heavy assault cruiser') || groupName.includes('heavy interdiction cruiser') ||
                 groupName.includes('logistics cruiser') || groupName.includes('recon ship') ||
                 groupName.includes('command ship') || groupName.includes('strategic cruiser') ||
                 groupName.includes('combat recon ship') || groupName.includes('force recon ship')) {
            size = 'Medium';
        }
        // Large ships (Battleships and their variants)
        else if (groupName.includes('battleship') || groupName.includes('black ops') ||
                 groupName.includes('marauder') || groupName.includes('attack battlecruiser')) {
            size = 'Large';
        }
        // Capital ships
        else if (groupName.includes('dreadnought') || groupName.includes('carrier') ||
                 groupName.includes('supercarrier') || groupName.includes('titan') ||
                 groupName.includes('capital') || groupName.includes('force auxiliary') ||
                 groupName.includes('mothership')) {
            size = 'Capital';
        }
        // Industrial and Support
        else if (groupName.includes('industrial') || groupName.includes('hauler') ||
                 groupName.includes('transport') || groupName.includes('mining') ||
                 groupName.includes('exhumer') || groupName.includes('venture')) {
            size = 'Industrial';
        }
        // Special cases
        else if (groupName.includes('capsule') || groupName.includes('pod')) {
            size = 'Pod';
        }

        // Determine role
        let role = 'Combat';
        if (groupName.includes('logistics') || groupName.includes('support')) role = 'Support';
        else if (groupName.includes('interceptor') || groupName.includes('covert')) role = 'Specialist';
        else if (groupName.includes('hauler') || groupName.includes('transport')) role = 'Industrial';

        return { techLevel, size, role };
    }

    /**
     * Analyze ship usage patterns and preferences
     */
    analyzeShipUsage(data) {
        const ships = this.extractTopShips(data);
        if (!ships.length) return null;

        const totalKills = ships.reduce((sum, ship) => sum + ship.kills, 0);

        // Calculate diversity index (Shannon entropy)
        const diversity = this.calculateShipDiversity(ships);

        // Analyze by size, tech level, and role
        const sizeBreakdown = this.analyzeByCategory(ships, 'size');
        const techBreakdown = this.analyzeByCategory(ships, 'techLevel');
        const roleBreakdown = this.analyzeByCategory(ships, 'role');

        // Find specialization
        const specialization = this.findSpecialization(ships, totalKills);

        return {
            diversity,
            sizeBreakdown,
            techBreakdown,
            roleBreakdown,
            specialization,
            totalShipTypes: ships.length,
            topShips: ships.slice(0, 8) // Limit to top 8 for display
        };
    }

    /**
     * Calculate Shannon diversity index for ship usage
     */
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

        // Normalize to 0-100 scale
        const maxPossibleEntropy = Math.log2(ships.length);
        return maxPossibleEntropy > 0 ? (entropy / maxPossibleEntropy) * 100 : 0;
    }

    /**
     * Analyze ships by a specific category
     */
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

        return Array.from(categoryMap.entries()).map(([category, data]) => ({
            category,
            count: data.count,
            kills: data.kills,
            percentage: totalKills > 0 ? Math.round((data.kills / totalKills) * 100) : 0,
            ships: data.ships
        })).sort((a, b) => b.kills - a.kills);
    }

    /**
     * Find pilot's ship specialization
     */
    findSpecialization(ships, totalKills) {
        if (!ships.length || totalKills === 0) return null;

        // Check if they heavily favor one ship
        const topShip = ships[0];
        const topShipPercentage = Math.round((topShip.kills / totalKills) * 100);

        if (topShipPercentage >= 40) {
            return {
                type: 'Ship Specialist',
                focus: topShip.shipName,
                percentage: topShipPercentage,
                description: `Heavily specializes in ${topShip.shipName}`
            };
        }

        // Check for size specialization
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

        // Check for role specialization
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

    /**
     * Analyze combat style based on ships and locations
     */
    analyzeCombatStyle(data) {
        const ships = this.extractTopShips(data);
        const groups = data.groups || {};

        if (!ships.length) return null;

        // Analyze engagement range preference
        let longRangeShips = 0;
        let brawlingShips = 0;
        let totalKills = 0;

        ships.forEach(ship => {
            const groupName = ship.groupName.toLowerCase();
            totalKills += ship.kills;

            // Categorize by typical engagement range
            if (groupName.includes('interceptor') || groupName.includes('assault') ||
                groupName.includes('destroyer') || groupName.includes('covert')) {
                brawlingShips += ship.kills;
            } else if (groupName.includes('cruiser') || groupName.includes('battleship') ||
                      groupName.includes('battlecruiser')) {
                longRangeShips += ship.kills;
            }
        });

        const engagementStyle = brawlingShips > longRangeShips ? 'Close-range Brawler' :
                              longRangeShips > brawlingShips ? 'Long-range Kiter' : 'Versatile';

        // Analyze fleet preference
        const soloKills = this.safeGet(data, 'soloKills', 0);
        const totalKillsData = this.safeGet(data, 'shipsDestroyed', 0);
        const gangPreference = totalKillsData > 0 ?
            Math.round(((totalKillsData - soloKills) / totalKillsData) * 100) : 0;

        const fleetRole = gangPreference > 70 ? 'Fleet Fighter' :
                         gangPreference < 30 ? 'Solo Hunter' : 'Flexible';

        // Risk assessment based on ship values and security space
        const avgGangSize = this.safeGet(data, 'avgGangSize', 1);
        const riskTolerance = avgGangSize > 5 ? 'Conservative' :
                             avgGangSize < 3 ? 'High Risk' : 'Moderate';

        return {
            engagementStyle,
            fleetRole,
            riskTolerance,
            gangPreference,
            avgGangSize: Math.round(avgGangSize * 10) / 10
        };
    }

    /**
     * Analyze activity patterns and insights
     */
    analyzeActivityInsights(data) {
        const months = data.months || {};
        const activity = data.activity || {};

        // Calculate activity trend
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

        // Analyze activity consistency
        const activeMonths = monthEntries.length;
        const consistency = activeMonths >= 6 ? 'Very Consistent' :
                           activeMonths >= 3 ? 'Moderately Active' :
                           activeMonths >= 1 ? 'Sporadic' : 'Inactive';

        // Find prime time
        let primeTime = 'Unknown';
        if (activity.max) {
            // Find the hour with most activity across all days
            const hourlyTotals = new Array(24).fill(0);
            for (let day = 0; day < 7; day++) {
                const dayData = activity[day.toString()];
                if (dayData && typeof dayData === 'object') {
                    for (let hour = 0; hour < 24; hour++) {
                        hourlyTotals[hour] += dayData[hour.toString()] || 0;
                    }
                }
            }

            const maxHour = hourlyTotals.indexOf(Math.max(...hourlyTotals));
            primeTime = `${maxHour.toString().padStart(2, '0')}:00 EVE Time`;
        }

        return {
            trend,
            consistency,
            primeTime,
            activeMonths,
            recentActivity: monthEntries.slice(0, 3).reduce((sum, [, data]) => sum + (data.shipsDestroyed || 0), 0)
        };
    }

    /**
     * Analyze security space preferences
     */
    analyzeSecurityPreference(data) {
        const labels = data.labels || {};

        const highsec = labels['loc:highsec'] || {};
        const lowsec = labels['loc:lowsec'] || {};
        const nullsec = labels['loc:nullsec'] || {};
        const wspace = labels['loc:w-space'] || {};

        const highsecKills = this.safeGet(highsec, 'shipsDestroyed', 0);
        const lowsecKills = this.safeGet(lowsec, 'shipsDestroyed', 0);
        const nullsecKills = this.safeGet(nullsec, 'shipsDestroyed', 0);
        const wspaceKills = this.safeGet(wspace, 'shipsDestroyed', 0);

        const total = highsecKills + lowsecKills + nullsecKills + wspaceKills;

        if (total === 0) {
            return {
                primary: 'Unknown',
                breakdown: [],
                riskProfile: 'Unknown'
            };
        }

        const breakdown = [
            { space: 'Highsec', kills: highsecKills, percentage: Math.round((highsecKills / total) * 100) },
            { space: 'Lowsec', kills: lowsecKills, percentage: Math.round((lowsecKills / total) * 100) },
            { space: 'Nullsec', kills: nullsecKills, percentage: Math.round((nullsecKills / total) * 100) },
            { space: 'W-Space', kills: wspaceKills, percentage: Math.round((wspaceKills / total) * 100) }
        ].filter(item => item.kills > 0).sort((a, b) => b.kills - a.kills);

        const primary = breakdown[0]?.space || 'Unknown';

        let riskProfile = 'Moderate';
        if (highsecKills > total * 0.6) riskProfile = 'Risk Averse';
        else if (nullsecKills > total * 0.5 || wspaceKills > total * 0.3) riskProfile = 'High Risk';

        return {
            primary,
            breakdown,
            riskProfile
        };
    }

    /**
     * Extract active time periods (if available)
     */
    /**
 * Extract active time periods (if available)
 */
    extractActivePeriods(data) {
        const months = data.months || {};

        return Object.entries(months)
            .filter(([, monthData]) =>
                (monthData.shipsDestroyed || 0) > 0 || (monthData.shipsLost || 0) > 0
            )
            .sort(([a], [b]) => b.localeCompare(a)) // Sort by YYYYMM desc
            .slice(0, 6) // Last 6 active months
            .map(([monthKey, monthData]) => {
                // Convert YYYYMM to readable format
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
    /**
 * Extract and process activity data for histograms
 */
    /**
     * Extract and process activity data for histograms
     */
    /**
     * Extract and process activity data for histograms
     */
    extractActivityData(data) {
        const activity = data.activity;

        if (!activity || typeof activity !== 'object') {
            return {
                hourlyData: [],
                dailyData: [],
                hasData: false
            };
        }

        // Extract hourly data - handle sparse objects (only hours with activity are present)
        const hourlyTotals = new Array(24).fill(0);
        const dailyTotals = new Array(7).fill(0);
        const dayLabels = activity.days || ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

        let hasValidData = false;

        // Process hourly data for each day (0-6)
        for (let day = 0; day < 7; day++) {
            const dayData = activity[day.toString()];

            if (dayData && typeof dayData === 'object') {
                // Handle sparse object format: { "0": 1, "1": 2, "13": 9, "14": 7, ... }
                // Convert sparse object to full 24-hour array
                for (let hour = 0; hour < 24; hour++) {
                    const kills = dayData[hour.toString()] || 0;
                    hourlyTotals[hour] += kills;
                    dailyTotals[day] += kills;
                    if (kills > 0) hasValidData = true;
                }
            } else if (Array.isArray(dayData) && dayData.length === 24) {
                // Handle array format (fallback for different data structures)
                dayData.forEach((kills, hour) => {
                    const killCount = kills || 0;
                    hourlyTotals[hour] += killCount;
                    dailyTotals[day] += killCount;
                    if (killCount > 0) hasValidData = true;
                });
            }
        }

        // Create formatted data for charts
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
    /**
     * Get performance statistics
     */
    getStats() {
        return {
            requests: this.requestCount,
            cache: this.cache.getStats(),
            queueSize: this.rateLimiter.requestQueue.length
        };
    }

    /**
     * Clear all cached data
     */
    clearCache() {
        this.cache.clear();
    }
}

// Create singleton instance
const zkillClient = new ZKillboardClient();

/**
 * Public API Functions
 */

/**
 * Get zKillboard stats for a character
 * @param {number|string} charId - Character ID
 * @returns {Promise<Object>} Character stats object
 */
export async function get_zkill_character_stats(charId) {
    try {
        return await zkillClient.getEntityStats('characterID', charId);
    } catch (error) {
        console.error(`Failed to get character stats for ${charId}:`, error);

        if (error instanceof ZKillError) {
            // Show user-friendly warning for expected errors
            if (error.status !== 404) {
                showWarning(`zKillboard: ${error.message}`);
            }
        }

        // Return empty stats object on error so the app can continue
        return zkillClient.createEmptyStats('characterID', charId);
    }
}

/**
 * Get zKillboard stats for a corporation
 * @param {number|string} corpId - Corporation ID
 * @returns {Promise<Object>} Corporation stats object
 */
export async function get_zkill_corporation_stats(corpId) {
    try {
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

/**
 * Get zKillboard stats for an alliance
 * @param {number|string} allianceId - Alliance ID
 * @returns {Promise<Object>} Alliance stats object
 */
export async function get_zkill_alliance_stats(allianceId) {
    try {
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

/**
 * Batch get stats for multiple entities of the same type
 * @param {string} entityType - 'characterID', 'corporationID', or 'allianceID'
 * @param {Array<number|string>} entityIds - Array of entity IDs
 * @param {Function} onProgress - Optional progress callback
 * @returns {Promise<Array<Object>>} Array of stats objects
 */
export async function get_zkill_batch_stats(entityType, entityIds, onProgress = null) {
    const results = [];

    for (let i = 0; i < entityIds.length; i++) {
        const entityId = entityIds[i];

        try {
            const stats = await zkillClient.getEntityStats(entityType, entityId);
            results.push(stats);

            if (onProgress) {
                onProgress(i + 1, entityIds.length, `Getting ${entityType} stats...`);
            }

        } catch (error) {
            console.error(`Failed to get stats for ${entityType} ${entityId}:`, error);
            results.push(zkillClient.createEmptyStats(entityType, entityId));
        }
    }

    return results;
}

/**
 * Get client statistics and performance info
 * @returns {Object} Performance statistics
 */
export function get_zkill_stats() {
    return zkillClient.getStats();
}

/**
 * Clear zKillboard cache
 */
export function clear_zkill_cache() {
    zkillClient.clearCache();
}