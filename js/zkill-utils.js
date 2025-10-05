/*
    EVE Target Intel - zKillboard Shared Utilities

    Copyright (C) 2025 moregh (https://github.com/moregh/)
    Licensed under AGPL License.
*/

import { ZKILL_CONFIG } from './config.js';
import { APIError } from './errors.js';

export class ZKillError extends APIError {
    constructor(message, status, entityType = null, entityId = null) {
        super(message, status, null, { entityType, entityId });
        this.name = 'ZKillError';
        this.entityType = entityType;
        this.entityId = entityId;
    }
}

export const ENTITY_TYPE_MAP = {
    'characterID': 'character',
    'corporationID': 'corporation',
    'allianceID': 'alliance'
};

export async function computePoW(id, difficulty = ZKILL_CONFIG.POW_DIFFICULTY) {
    const ts = Math.floor(Date.now() / 1000);
    let nonce = 0;
    const targetPrefix = '0'.repeat(difficulty / 4);

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

        if (nonce > 1000000) {
            throw new ZKillError('Proof-of-work computation failed - too many iterations', 500);
        }
    }
}

export async function executeWithRetry(requestFn, entityType, entityId, retryCount = 0, maxRetries = ZKILL_CONFIG.MAX_RETRIES) {
    try {
        return await requestFn();
    } catch (error) {
        if (retryCount < maxRetries &&
            (error.status >= 500 || error.status === 408 || error.status === 429)) {

            const backoffDelay = Math.min(1000 * Math.pow(2, retryCount), 10000);
            console.warn(`Request failed, retrying in ${backoffDelay}ms (attempt ${retryCount + 1}/${maxRetries})`);

            await new Promise(resolve => setTimeout(resolve, backoffDelay));
            return executeWithRetry(requestFn, entityType, entityId, retryCount + 1, maxRetries);
        }

        throw error;
    }
}

export function getProxyParam(entityType) {
    const proxyParam = ENTITY_TYPE_MAP[entityType];
    if (!proxyParam) {
        throw new ZKillError(`Unsupported entity type: ${entityType}`, 400);
    }
    return proxyParam;
}
