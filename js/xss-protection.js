/*
    EVE Target Intel - XSS Protection Utilities

    Copyright (C) 2025 moregh (https://github.com/moregh/)
    Licensed under AGPL License.
*/
const HTML_ENTITIES = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '/': '&#x2F;',
    '`': '&#x60;',
    '=': '&#x3D;'
};

const HTML_ENTITY_REGEX = /[&<>"'`=\/]/g;

export function escapeHtml(str) {
    if (typeof str !== 'string') {
        return '';
    }
    return str.replace(HTML_ENTITY_REGEX, (match) => HTML_ENTITIES[match]);
}

function sanitizeEntityName(name, entityType, maxLength) {
    if (!name || typeof name !== 'string') {
        const defaults = {
            character: 'Unknown Character',
            corporation: 'Unknown Corporation',
            alliance: 'Unknown Alliance'
        };
        return defaults[entityType] || 'Unknown Entity';
    }

    const trimmed = name.trim().substring(0, maxLength);
    return escapeHtml(trimmed);
}

export function sanitizeCharacterName(name) {
    return sanitizeEntityName(name, 'character', 37);
}

export function sanitizeCorporationName(name) {
    return sanitizeEntityName(name, 'corporation', 50);
}

export function sanitizeAllianceName(name) {
    return sanitizeEntityName(name, 'alliance', 50);
}

export function sanitizeId(id) {
    const numId = parseInt(id, 10);
    if (isNaN(numId) || numId <= 0) {
        return 0;
    }

    return Math.min(numId, 2147483647);
}

export function sanitizeAttribute(value) {
    if (typeof value !== 'string') {
        return '';
    }
    return value.replace(/['"<>&]/g, '');
}