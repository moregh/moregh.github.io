/*
    War Target Finder - ESI Client
    
    Copyright (C) 2025 moregh (https://github.com/moregh/)
    Licensed under AGPL License.
*/

import { ESI_BASE, ESI_HEADERS, USER_AGENT } from './config.js';
import { showError, showWarning } from './ui.js';

/**
 * ESI Error types for better error handling
 */
class ESIError extends Error {
    constructor(message, status, response, retryAfter = null) {
        super(message);
        this.name = 'ESIError';
        this.status = status;
        this.response = response;
        this.retryAfter = retryAfter;
    }
}

class ESIRateLimitError extends ESIError {
    constructor(message, retryAfter, response) {
        super(message, 429, response, retryAfter);
        this.name = 'ESIRateLimitError';
    }
}

class ESIServerError extends ESIError {
    constructor(message, status, response) {
        super(message, status, response);
        this.name = 'ESIServerError';
    }
}

/**
 * Sophisticated ESI HTTP Client with proper caching and error handling
 */
export class ESIClient {
    constructor() {
        this.requestCount = 0;
        this.cacheHeaders = new Map(); // Store cache headers by endpoint
        this.rateLimitState = {
            remaining: null,
            reset: null,
            lastUpdate: null
        };
    }

    /**
     * Get current request statistics
     */
    getStats() {
        return {
            requests: this.requestCount,
            rateLimitRemaining: this.rateLimitState.remaining,
            rateLimitReset: this.rateLimitState.reset
        };
    }

    /**
     * Reset request counter
     */
    resetStats() {
        this.requestCount = 0;
    }

    /**
     * Parse ESI cache headers for intelligent caching
     */
    parseCacheHeaders(response, endpoint) {
        const cacheControl = response.headers.get('cache-control');
        const expires = response.headers.get('expires');
        const etag = response.headers.get('etag');
        const lastModified = response.headers.get('last-modified');

        let maxAge = null;
        if (cacheControl) {
            const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
            if (maxAgeMatch) {
                maxAge = parseInt(maxAgeMatch[1]);
            }
        }

        const cacheInfo = {
            maxAge,
            expires: expires ? new Date(expires) : null,
            etag,
            lastModified: lastModified ? new Date(lastModified) : null,
            cachedAt: new Date(),
            endpoint
        };

        this.cacheHeaders.set(endpoint, cacheInfo);
        return cacheInfo;
    }

    /**
     * Check if cached response is still valid
     */
    isCacheValid(endpoint) {
        const cacheInfo = this.cacheHeaders.get(endpoint);
        if (!cacheInfo) return false;

        const now = new Date();
        
        // Check max-age first (most reliable)
        if (cacheInfo.maxAge !== null) {
            const expiresAt = new Date(cacheInfo.cachedAt.getTime() + (cacheInfo.maxAge * 1000));
            return now < expiresAt;
        }

        // Fallback to expires header
        if (cacheInfo.expires) {
            return now < cacheInfo.expires;
        }

        // No cache info, assume invalid
        return false;
    }

    /**
     * Update rate limit state from response headers
     */
    updateRateLimitState(response) {
        const remaining = response.headers.get('x-esi-error-limit-remain');
        const reset = response.headers.get('x-esi-error-limit-reset');

        if (remaining !== null) {
            this.rateLimitState.remaining = parseInt(remaining);
        }
        if (reset !== null) {
            this.rateLimitState.reset = parseInt(reset);
        }
        this.rateLimitState.lastUpdate = Date.now();
    }

    /**
     * Check if we should wait due to rate limiting
     */
    shouldWaitForRateLimit() {
        const { remaining, reset, lastUpdate } = this.rateLimitState;
        
        if (remaining === null || reset === null || lastUpdate === null) {
            return { shouldWait: false };
        }

        // If we have very few requests remaining, be cautious
        if (remaining < 10) {
            const now = Date.now();
            const resetTime = lastUpdate + (reset * 1000);
            
            if (now < resetTime) {
                const waitTime = resetTime - now;
                return { shouldWait: true, waitTime };
            }
        }

        return { shouldWait: false };
    }

    /**
     * Handle ESI response and extract relevant data
     */
    async handleResponse(response, endpoint) {
        // Update rate limit tracking
        this.updateRateLimitState(response);

        // Parse cache headers for future requests
        this.parseCacheHeaders(response, endpoint);

        // Handle different status codes
        if (response.ok) {
            // Success - return parsed JSON
            try {
                const data = await response.json();
                return data;
            } catch (e) {
                throw new ESIError(`Failed to parse JSON response from ${endpoint}`, response.status, response);
            }
        }

        // Handle error responses
        let errorBody;
        try {
            errorBody = await response.json();
        } catch (e) {
            errorBody = { error: 'Unknown error', message: 'Failed to parse error response' };
        }

        const errorMessage = errorBody.error || `HTTP ${response.status}`;
        const fullMessage = `ESI Error: ${errorMessage}`;

        switch (response.status) {
            case 400:
                throw new ESIError(`Bad Request: ${errorMessage}`, 400, response);
            
            case 404:
                // For 404s, we often want to continue (character not found, etc.)
                console.warn(`ESI 404 for ${endpoint}:`, errorMessage);
                return null;
            
            case 420:
                // Error limited
                const retryAfter = parseInt(response.headers.get('retry-after') || '60');
                throw new ESIRateLimitError(
                    `Rate limited: ${errorMessage}. Retry after ${retryAfter}s`,
                    retryAfter,
                    response
                );
            
            case 429:
                // Too many requests
                const retryAfterTooMany = parseInt(response.headers.get('retry-after') || '60');
                throw new ESIRateLimitError(
                    `Too many requests: ${errorMessage}. Retry after ${retryAfterTooMany}s`,
                    retryAfterTooMany,
                    response
                );
            
            case 500:
            case 502:
            case 503:
            case 504:
                throw new ESIServerError(
                    `Server error (${response.status}): ${errorMessage}. ESI may be experiencing issues.`,
                    response.status,
                    response
                );
            
            default:
                throw new ESIError(fullMessage, response.status, response);
        }
    }

    /**
     * Execute HTTP request with retry logic and rate limiting
     */
    async executeRequest(url, options = {}, retryCount = 0, maxRetries = 3) {
        const endpoint = url.replace(ESI_BASE, '');

        // Check rate limiting
        const rateLimitCheck = this.shouldWaitForRateLimit();
        if (rateLimitCheck.shouldWait && retryCount === 0) {
            showWarning(`Rate limit approaching, waiting ${rateLimitCheck.waitTime}ms`);
            console.warn(`Rate limit approaching, waiting ${rateLimitCheck.waitTime}ms`);
            await new Promise(resolve => setTimeout(resolve, rateLimitCheck.waitTime));
        }

        try {
            this.requestCount++;
            
            const response = await fetch(url, {
                ...options,
                headers: {
                    ...ESI_HEADERS,
                    ...options.headers
                }
            });

            return await this.handleResponse(response, endpoint);

        } catch (error) {
            // Handle retryable errors
            if (error instanceof ESIRateLimitError || error instanceof ESIServerError) {
                if (retryCount < maxRetries) {
                    const baseDelay = error instanceof ESIRateLimitError ? 
                        (error.retryAfter * 1000) : 
                        (1000 * Math.pow(2, retryCount)); // Exponential backoff for server errors
                    
                    const jitter = Math.random() * 1000; // Add jitter
                    const delay = baseDelay + jitter;


                    showWarning(`ESI request failed, retrying in ${Math.round(delay)}ms (attempt ${retryCount + 1}/${maxRetries})`);
                    console.warn(`ESI request failed, retrying in ${Math.round(delay)}ms (attempt ${retryCount + 1}/${maxRetries})`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    
                    return this.executeRequest(url, options, retryCount + 1, maxRetries);
                }
            }

            // Re-throw for non-retryable errors or exhausted retries
            throw error;
        }
    }

    /**
     * Perform GET request to ESI
     */
    async get(endpoint, options = {}) {
        const url = `${ESI_BASE}${endpoint}`;
        
        try {
            return await this.executeRequest(url, {
                method: 'GET',
                ...options
            });
        } catch (error) {
            const contextMessage = `GET ${endpoint}`;
            this.handleError(error, contextMessage);
            throw error;
        }
    }

    /**
     * Perform POST request to ESI
     */
    async post(endpoint, data, options = {}) {
        const url = `${ESI_BASE}${endpoint}`;
        
        try {
            return await this.executeRequest(url, {
                method: 'POST',
                body: JSON.stringify(data),
                ...options
            });
        } catch (error) {
            const contextMessage = `POST ${endpoint}`;
            this.handleError(error, contextMessage);
            throw error;
        }
    }

    /**
     * Handle and log errors appropriately
     */
    handleError(error, context) {
        if (error instanceof ESIRateLimitError) {
            showWarning(`ESI Rate Limited: ${context}. Please wait ${error.retryAfter}s before retrying.`);
        } else if (error instanceof ESIServerError) {
            showError(`ESI Server Error: ${context}. ${error.message}`);
        } else if (error instanceof ESIError) {
            if (error.status !== 404) { // Don't show errors for expected 404s
                showError(`ESI Error: ${context}. ${error.message}`);
            }
        } else {
            showError(`Network Error: ${context}. ${error.message}`);
        }
        
        console.error(`ESI Client Error [${context}]:`, error);
    }

    /**
     * Batch multiple requests with intelligent chunking and concurrency control
     */
    async batchRequests(requests, { 
        maxConcurrency = 10, 
        chunkDelay = 50,
        onProgress = null 
    } = {}) {
        const results = [];
        
        for (let i = 0; i < requests.length; i += maxConcurrency) {
            const chunk = requests.slice(i, i + maxConcurrency);
            
            try {
                const chunkPromises = chunk.map(async (request, index) => {
                    try {
                        if (request.method === 'POST') {
                            return await this.post(request.endpoint, request.data, request.options);
                        } else {
                            return await this.get(request.endpoint, request.options);
                        }
                    } catch (error) {
                        console.warn(`Batch request failed:`, error);
                        return null; // Return null for failed requests
                    }
                });

                const chunkResults = await Promise.all(chunkPromises);
                results.push(...chunkResults);

                // Progress callback
                if (onProgress) {
                    onProgress(i + chunk.length, requests.length);
                }

                // Delay between chunks to be nice to ESI
                if (i + maxConcurrency < requests.length && chunkDelay > 0) {
                    await new Promise(resolve => setTimeout(resolve, chunkDelay));
                }

            } catch (error) {
                console.error('Batch chunk failed completely:', error);
                // Fill with nulls for this chunk
                results.push(...new Array(chunk.length).fill(null));
            }
        }

        return results;
    }
}

// Export singleton instance
export const esiClient = new ESIClient();