/*
    EVE Target Intel - XSS Protection Utilities

    Copyright (C) 2025 moregh (https://github.com/moregh/)
    Licensed under AGPL License.
*/

/**
 * Comprehensive XSS protection utilities for sanitizing untrusted data
 * from ESI and zKillboard APIs
 */

/**
 * HTML entity encoding map for XSS prevention
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

/**
 * Regular expression to match HTML entities that need encoding
 */
const HTML_ENTITY_REGEX = /[&<>"'`=\/]/g;

/**
 * Escapes HTML entities in a string to prevent XSS attacks
 * @param {string} str - The string to escape
 * @returns {string} - The escaped string safe for HTML insertion
 */
export function escapeHtml(str) {
    if (typeof str !== 'string') {
        return '';
    }
    return str.replace(HTML_ENTITY_REGEX, (match) => HTML_ENTITIES[match]);
}

/**
 * Sanitizes a character name from ESI API
 * @param {string} name - Character name from ESI
 * @returns {string} - Sanitized character name
 */
export function sanitizeCharacterName(name) {
    if (!name || typeof name !== 'string') {
        return 'Unknown Character';
    }

    // Trim whitespace and limit length
    const trimmed = name.trim().substring(0, 37); // EVE character name max length

    // Escape HTML entities
    return escapeHtml(trimmed);
}

/**
 * Sanitizes a corporation name from ESI API
 * @param {string} name - Corporation name from ESI
 * @returns {string} - Sanitized corporation name
 */
export function sanitizeCorporationName(name) {
    if (!name || typeof name !== 'string') {
        return 'Unknown Corporation';
    }

    // Trim whitespace and limit length
    const trimmed = name.trim().substring(0, 50); // EVE corp name max length

    // Escape HTML entities
    return escapeHtml(trimmed);
}

/**
 * Sanitizes an alliance name from ESI API
 * @param {string} name - Alliance name from ESI
 * @returns {string} - Sanitized alliance name
 */
export function sanitizeAllianceName(name) {
    if (!name || typeof name !== 'string') {
        return 'Unknown Alliance';
    }

    // Trim whitespace and limit length
    const trimmed = name.trim().substring(0, 50); // EVE alliance name max length

    // Escape HTML entities
    return escapeHtml(trimmed);
}

/**
 * Sanitizes numeric IDs from ESI API
 * @param {number|string} id - ID from ESI
 * @returns {number} - Sanitized numeric ID
 */
export function sanitizeId(id) {
    const numId = parseInt(id, 10);
    if (isNaN(numId) || numId <= 0) {
        return 0;
    }
    // EVE IDs are typically 32-bit integers
    return Math.min(numId, 2147483647);
}

/**
 * Sanitizes a generic text field that may contain user-controllable content
 * @param {string} text - Text to sanitize
 * @param {number} maxLength - Maximum allowed length (default: 255)
 * @returns {string} - Sanitized text
 */
export function sanitizeText(text, maxLength = 255) {
    if (!text || typeof text !== 'string') {
        return '';
    }

    // Trim whitespace and limit length
    const trimmed = text.trim().substring(0, maxLength);

    // Escape HTML entities
    return escapeHtml(trimmed);
}

/**
 * Sanitizes an entire character object from ESI API
 * @param {Object} character - Character data from ESI
 * @returns {Object} - Sanitized character object
 */
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

/**
 * Sanitizes corporation data from ESI API
 * @param {Object} corp - Corporation data from ESI
 * @returns {Object} - Sanitized corporation object
 */
export function sanitizeCorporationData(corp) {
    if (!corp || typeof corp !== 'object') {
        return {};
    }

    return {
        corporation_id: sanitizeId(corp.corporation_id),
        name: sanitizeCorporationName(corp.name),
        ticker: sanitizeText(corp.ticker, 5), // EVE corp tickers are max 5 chars
        alliance_id: corp.alliance_id ? sanitizeId(corp.alliance_id) : null,
        war_eligible: Boolean(corp.war_eligible)
    };
}

/**
 * Sanitizes alliance data from ESI API
 * @param {Object} alliance - Alliance data from ESI
 * @returns {Object} - Sanitized alliance object
 */
export function sanitizeAllianceData(alliance) {
    if (!alliance || typeof alliance !== 'object') {
        return {};
    }

    return {
        alliance_id: sanitizeId(alliance.alliance_id),
        name: sanitizeAllianceName(alliance.name),
        ticker: sanitizeText(alliance.ticker, 5), // EVE alliance tickers are max 5 chars
        war_eligible: Boolean(alliance.war_eligible)
    };
}

/**
 * Sanitizes zKillboard statistics data
 * @param {Object} stats - Stats data from zKillboard API
 * @returns {Object} - Sanitized stats object
 */
export function sanitizeZkillStats(stats) {
    if (!stats || typeof stats !== 'object') {
        return {};
    }

    const sanitized = {};

    // Sanitize numeric stats
    ['kills', 'losses', 'soloKills', 'iskDestroyed', 'iskLost', 'pointsDestroyed', 'pointsLost'].forEach(key => {
        if (typeof stats[key] === 'number') {
            sanitized[key] = Math.max(0, Math.floor(stats[key]));
        } else {
            sanitized[key] = 0;
        }
    });

    // Sanitize arrays of objects (top killers, etc.)
    ['topKillers', 'topVictims', 'topShips', 'topSystems'].forEach(key => {
        if (Array.isArray(stats[key])) {
            sanitized[key] = stats[key].slice(0, 10).map(item => ({
                id: sanitizeId(item.id),
                name: sanitizeText(item.name, 50),
                count: Math.max(0, Math.floor(item.count || 0))
            }));
        } else {
            sanitized[key] = [];
        }
    });

    return sanitized;
}

/**
 * Sanitizes URL parameters for zkillboard links
 * @param {string|number} id - Entity ID for zkillboard URL
 * @param {string} type - Entity type (character, corporation, alliance)
 * @returns {Object} - Sanitized URL parameters
 */
export function sanitizeZkillParams(id, type) {
    const sanitizedId = sanitizeId(id);
    const allowedTypes = ['character', 'corporation', 'alliance'];
    const sanitizedType = allowedTypes.includes(type) ? type : 'character';

    return {
        id: sanitizedId,
        type: sanitizedType
    };
}

/**
 * Creates a safe HTML attribute value
 * @param {string} value - The attribute value to sanitize
 * @returns {string} - Safe attribute value
 */
export function sanitizeAttribute(value) {
    if (typeof value !== 'string') {
        return '';
    }

    // Remove quotes and other potentially dangerous characters from attributes
    return value.replace(/['"<>&]/g, '');
}

/**
 * Validates and sanitizes an EVE image URL from CCP's CDN
 * @param {string} url - Image URL to validate
 * @returns {string} - Safe image URL or empty string if invalid
 */
export function sanitizeImageUrl(url) {
    if (typeof url !== 'string') {
        return '';
    }

    // Only allow images from CCP's official CDN
    const allowedDomains = [
        'images.evetech.net',
        'imageserver.eveonline.com'
    ];

    try {
        const urlObj = new URL(url);
        if (!allowedDomains.includes(urlObj.hostname)) {
            return '';
        }

        // Ensure HTTPS
        if (urlObj.protocol !== 'https:') {
            return '';
        }

        return url;
    } catch (e) {
        return '';
    }
}

/**
 * Comprehensive sanitization for any untrusted data before DOM insertion
 * @param {any} data - Data to sanitize
 * @param {string} context - Context hint for sanitization ('name', 'id', 'url', etc.)
 * @returns {string} - Sanitized string safe for DOM insertion
 */
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