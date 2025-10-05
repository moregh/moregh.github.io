/*
    EVE Target Intel - ESI Client
    
    Copyright (C) 2025 moregh (https://github.com/moregh/)
    Licensed under AGPL License.
*/

import { ESI_BASE, ESI_HEADERS } from './config.js';
import { showError, showWarning, clearErrorMessage } from './ui.js';
import { APIError, RateLimitError, ServerError } from './errors.js';

class ESIError extends APIError {
    constructor(message, status, response, retryAfter = null) {
        super(message, status, response);
        this.name = 'ESIError';
        this.retryAfter = retryAfter;
    }
}

class ESIRateLimitError extends RateLimitError {
    constructor(message, retryAfter, response) {
        super(message, retryAfter, response);
        this.name = 'ESIRateLimitError';
    }
}

class ESIServerError extends ServerError {
    constructor(message, status, response) {
        super(message, status, response);
        this.name = 'ESIServerError';
    }
}

export class ESIClient {
    constructor() {
        this.requestCount = 0;
        this.rateLimitState = {
            remaining: null,
            reset: null,
            lastUpdate: null
        };
    }

    getStats() {
        return {
            requests: this.requestCount,
            rateLimitRemaining: this.rateLimitState.remaining,
            rateLimitReset: this.rateLimitState.reset
        };
    }

    resetStats() {
        this.requestCount = 0;
    }

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

    shouldWaitForRateLimit() {
        const { remaining, reset, lastUpdate } = this.rateLimitState;

        if (remaining === null || reset === null || lastUpdate === null) {
            return { shouldWait: false };
        }


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

    async handleResponse(response, endpoint) {
        this.updateRateLimitState(response);

        if (response.ok) {
            try {
                const data = await response.json();
                return data;
            } catch (e) {
                throw new ESIError(`Failed to parse JSON response from ${endpoint}`, response.status, response);
            }
        }


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

                console.warn(`ESI 404 for ${endpoint}:`, errorMessage);
                return null;

            case 420:

                const retryAfter = parseInt(response.headers.get('retry-after') || '60');
                throw new ESIRateLimitError(
                    `Rate limited: ${errorMessage}. Retry after ${retryAfter}s`,
                    retryAfter,
                    response
                );

            case 429:

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

    async executeRequest(url, options = {}, retryCount = 0, maxRetries = 3) {
        const endpoint = url.replace(ESI_BASE, '');


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

            const result = await this.handleResponse(response, endpoint);


            if (retryCount > 0) {
                clearErrorMessage();
            }

            return result;

        } catch (error) {

            if (error instanceof ESIRateLimitError || error instanceof ESIServerError) {
                if (retryCount < maxRetries) {
                    const baseDelay = error instanceof ESIRateLimitError ?
                        (error.retryAfter * 1000) :
                        (1000 * Math.pow(2, retryCount));

                    const jitter = Math.random() * 1000;
                    const delay = baseDelay + jitter;


                    showWarning(`ESI request failed, retrying in ${Math.round(delay)}ms (attempt ${retryCount + 1}/${maxRetries})`);
                    console.warn(`ESI request failed, retrying in ${Math.round(delay)}ms (attempt ${retryCount + 1}/${maxRetries})`);
                    await new Promise(resolve => setTimeout(resolve, delay));

                    return this.executeRequest(url, options, retryCount + 1, maxRetries);
                }
            }


            throw error;
        }
    }

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

    handleError(error, context) {
        if (error instanceof ESIRateLimitError) {
            showWarning(`ESI Rate Limited: ${context}. Please wait ${error.retryAfter}s before retrying.`);
        } else if (error instanceof ESIServerError) {
            showError(`ESI Server Error: ${context}. ${error.message}`);
        } else if (error instanceof ESIError) {
            if (error.status !== 404) {
                showError(`ESI Error: ${context}. ${error.message}`);
            }
        } else {
            showError(`Network Error: ${context}. ${error.message}`);
        }

        console.error(`ESI Client Error [${context}]:`, error);
    }

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
                        return null;
                    }
                });

                const chunkResults = await Promise.all(chunkPromises);
                results.push(...chunkResults);


                if (onProgress) {
                    onProgress(i + chunk.length, requests.length);
                }


                if (i + maxConcurrency < requests.length && chunkDelay > 0) {
                    await new Promise(resolve => setTimeout(resolve, chunkDelay));
                }

            } catch (error) {
                console.error('Batch chunk failed completely:', error);

                results.push(...new Array(chunk.length).fill(null));
            }
        }

        return results;
    }
}


export const esiClient = new ESIClient();