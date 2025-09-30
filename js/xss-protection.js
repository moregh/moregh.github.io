/*
    EVE Target Intel - XSS Protection Utilities

    Copyright (C) 2025 moregh (https://github.com/moregh/)
    Licensed under AGPL License.
*/
import { ALLOWED_IMAGE_URLS } from './config.js';

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

export function sanitizeText(text, maxLength = 255) {
    if (!text || typeof text !== 'string') {
        return '';
    }
    const trimmed = text.trim().substring(0, maxLength);
    return escapeHtml(trimmed);
}

export function sanitizeCharacterData(character) {
    if (!character || typeof character !== 'object') {
        return {};
    }
    return {
        character_id: sanitizeId(character.character_id),
        character_name: sanitizeCharacterName(character.character_name),
        corporation_id: sanitizeId(character.corporation_id),
        corporation_name: sanitizeCorporationName(character.corporation_name),
        alliance_id: character.alliance_id ? sanitizeId(character.alliance_id) : null,
        alliance_name: character.alliance_name ? sanitizeAllianceName(character.alliance_name) : null,
        war_eligible: Boolean(character.war_eligible)
    };
}

export function sanitizeCorporationData(corp) {
    if (!corp || typeof corp !== 'object') {
        return {};
    }
    return {
        corporation_id: sanitizeId(corp.corporation_id),
        name: sanitizeCorporationName(corp.name),
        ticker: sanitizeText(corp.ticker, 5),
        alliance_id: corp.alliance_id ? sanitizeId(corp.alliance_id) : null,
        war_eligible: Boolean(corp.war_eligible)
    };
}

export function sanitizeAllianceData(alliance) {
    if (!alliance || typeof alliance !== 'object') {
        return {};
    }
    return {
        alliance_id: sanitizeId(alliance.alliance_id),
        name: sanitizeAllianceName(alliance.name),
        ticker: sanitizeText(alliance.ticker, 5),
        war_eligible: Boolean(alliance.war_eligible)
    };
}

export function sanitizeZkillParams(id, type) {
    const sanitizedId = sanitizeId(id);
    const allowedTypes = ['character', 'corporation', 'alliance'];
    const sanitizedType = allowedTypes.includes(type) ? type : 'character';

    return {
        id: sanitizedId,
        type: sanitizedType
    };
}

export function sanitizeAttribute(value) {
    if (typeof value !== 'string') {
        return '';
    }
    return value.replace(/['"<>&]/g, '');
}

export function decodeHtmlEntities(str) {
    if (typeof str !== 'string') {
        return '';
    }
    let decoded = str;
    decoded = decoded.replace(/&amp;/g, '&');
    const textarea = document.createElement('textarea');
    textarea.innerHTML = decoded;
    return textarea.value;
}

export function sanitizeImageUrl(url) {
    if (typeof url !== 'string') {
        return '';
    }

    try {
        const urlObj = new URL(url);
        if (!ALLOWED_IMAGE_URLS.includes(urlObj.hostname)) {
            return '';
        }

        if (urlObj.protocol !== 'https:') {
            return '';
        }

        return url;
    } catch (e) {
        console.warn(`Unable to sanitize image URL: ${e}`);
        return '';
    }
}

export function sanitizeForDOM(data, context = 'text') {
    switch (context) {
        case 'character_name':
            return sanitizeCharacterName(data);
        case 'corporation_name':
            return sanitizeCorporationName(data);
        case 'alliance_name':
            return sanitizeAllianceName(data);
        case 'id':
            return sanitizeId(data).toString();
        case 'url':
            return sanitizeImageUrl(data);
        case 'attribute':
            return sanitizeAttribute(data);
        default:
            return sanitizeText(data);
    }
}