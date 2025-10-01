/*
    EVE Target Intel - Shared Error Classes

    Copyright (C) 2025 moregh (https://github.com/moregh/)
    Licensed under AGPL License.
*/

export class APIError extends Error {
    constructor(message, status, response = null, context = {}) {
        super(message);
        this.name = 'APIError';
        this.status = status;
        this.response = response;
        this.context = context;
    }
}

export class RateLimitError extends APIError {
    constructor(message, retryAfter, response = null, context = {}) {
        super(message, 429, response, context);
        this.name = 'RateLimitError';
        this.retryAfter = retryAfter;
    }
}

export class ServerError extends APIError {
    constructor(message, status, response = null, context = {}) {
        super(message, status, response, context);
        this.name = 'ServerError';
    }
}

export class NotFoundError extends APIError {
    constructor(message, response = null, context = {}) {
        super(message, 404, response, context);
        this.name = 'NotFoundError';
    }
}

export class ValidationError extends Error {
    constructor(message, field = null, value = null) {
        super(message);
        this.name = 'ValidationError';
        this.field = field;
        this.value = value;
    }
}
