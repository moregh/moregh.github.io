/*
    War Target Finder - zKillboard API Integration
    
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
  
    PROXY_BASE_URL: 'https://zkill-proxy.vercel.app/api/zkill',
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
            totalLosses: this.safeGet(rawData, 'shipsLost', 0),
            soloKills: this.safeGet(rawData, 'soloKills', 0),
            soloLosses: this.safeGet(rawData, 'soloLosses', 0),
            iskDestroyed: this.safeGet(rawData, 'iskDestroyed', 0),
            iskLost: this.safeGet(rawData, 'iskLost', 0),
            efficiency: this.calculateEfficiency(rawData),
            dangerRatio: this.calculateDangerRatio(rawData),
            gangRatio: this.calculateGangRatio(rawData),
            recentActivity: this.extractRecentActivity(rawData),
            topLocations: this.extractTopLocations(rawData),
            activePeriods: this.extractActivePeriods(rawData),
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
                last7Days: { kills: 0, losses: 0 },
                last30Days: { kills: 0, losses: 0 },
                last90Days: { kills: 0, losses: 0 }
            },
            topLocations: [],
            activePeriods: [],
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

        if (destroyed === 0 && lost === 0) return 0;
        if (lost === 0) return 100;

        return Math.round((destroyed / (destroyed + lost)) * 100);
    }

    /**
     * Calculate danger ratio (losses per kill)
     */
    calculateDangerRatio(data) {
        const kills = this.safeGet(data, 'shipsDestroyed', 0);
        const losses = this.safeGet(data, 'shipsLost', 0);

        if (kills === 0) return losses > 0 ? 999 : 0;
        return Math.round((losses / kills) * 100) / 100;
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
        const months = data.months || {};
        const now = new Date();

        let last7Days = { kills: 0, losses: 0 };
        let last30Days = { kills: 0, losses: 0 };
        let last90Days = { kills: 0, losses: 0 };

        // Process recent months data - the months are in YYYYMM format
        Object.entries(months).forEach(([monthKey, monthData]) => {
            // Parse YYYYMM format (e.g., "202509" = September 2025)
            const year = parseInt(monthKey.substring(0, 4));
            const month = parseInt(monthKey.substring(4, 6));
            const monthDate = new Date(year, month - 1, 1); // month - 1 because JS months are 0-indexed

            const daysDiff = Math.floor((now - monthDate) / (1000 * 60 * 60 * 24));

            if (daysDiff <= 7) {
                last7Days.kills += this.safeGet(monthData, 'shipsDestroyed', 0);
                last7Days.losses += this.safeGet(monthData, 'shipsLost', 0);
            }
            if (daysDiff <= 30) {
                last30Days.kills += this.safeGet(monthData, 'shipsDestroyed', 0);
                last30Days.losses += this.safeGet(monthData, 'shipsLost', 0);
            }
            if (daysDiff <= 90) {
                last90Days.kills += this.safeGet(monthData, 'shipsDestroyed', 0);
                last90Days.losses += this.safeGet(monthData, 'shipsLost', 0);
            }
        });

        return { last7Days, last30Days, last90Days };
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

        return systemList.values
            .slice(0, 3)
            .map(system => ({
                systemId: system.solarSystemID || system.id,
                systemName: system.solarSystemName || system.name || 'Unknown System',
                kills: system.kills || 0,
                losses: system.losses || 0,
                securityStatus: system.solarSystemSecurity !== undefined
                    ? parseFloat(system.solarSystemSecurity)
                    : null
            }));
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