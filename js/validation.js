/*
    EVE Target Intel - Character Name Validation
    
    Copyright (C) 2025 moregh (https://github.com/moregh/)
    Licensed under AGPL License.
*/

import {
    MIN_CHARACTER_NAME_LENGTH,
    MAX_CHARACTER_NAME_LENGTH,
    MAX_SINGLE_NAME_LENGTH,
    MAX_FAMILY_NAME_LENGTH,
    MAX_FIRST_MIDDLE_NAME_LENGTH
} from './config.js';

export function clientValidate(name) {
    name = name.trim();
    if (name.length < MIN_CHARACTER_NAME_LENGTH || name.length > MAX_CHARACTER_NAME_LENGTH) return false;
    let pattern = /^[A-Za-z0-9.''-]+( [A-Za-z0-9.''-]+)*$/;
    if (!pattern.test(name)) return false;
    if (/^[ '-]|[ '-]$/.test(name)) return false;
    let parts = name.split(" ");
    if (parts.length === 1 && name.length > MAX_SINGLE_NAME_LENGTH) return false;
    if (parts.length > 1) {
        let firstAndMiddle = parts.slice(0, -1).join(" ");
        let familyName = parts[parts.length - 1];
        if (firstAndMiddle.length > MAX_FIRST_MIDDLE_NAME_LENGTH || familyName.length > MAX_FAMILY_NAME_LENGTH) return false;
    }
    return true;
}

export function validateEntityName(name) {
    name = name.trim();
    if (name.length < 3 || name.length > 50) return false;

    // Allow more flexible patterns for corporations and alliances
    // Corp/alliance names can have more varied formats than character names
    const pattern = /^[A-Za-z0-9.''\-\[\]()&+\s]+$/;
    if (!pattern.test(name)) return false;
    if (/^[\s'-]|[\s'-]$/.test(name)) return false;

    return true;
}

export function classifyEntityType(name) {
    name = name.trim();

    // Character name patterns (stricter validation)
    if (clientValidate(name)) {
        const parts = name.split(" ");
        // Characters typically have 1-2 words, rarely more
        if (parts.length <= 2) {
            return 'character';
        }
    }

    // Corporation patterns
    if (validateEntityName(name)) {
        // Corp indicators - common suffixes/words
        const corpIndicators = [
            /\bcorp\.?\b/i,
            /\bcorporation\b/i,
            /\binc\.?\b/i,
            /\bindustries\b/i,
            /\benterprises\b/i,
            /\bltd\.?\b/i,
            /\bllc\.?\b/i,
            /\bmining\b/i,
            /\btrading\b/i,
            /\bmanufacturing\b/i
        ];

        // Alliance indicators
        const allianceIndicators = [
            /\balliance\b/i,
            /\bcoalition\b/i,
            /\bfederation\b/i,
            /\bunion\b/i,
            /\bempire\b/i,
            /\brepublic\b/i,
            /\bconsortium\b/i
        ];

        // Check for alliance indicators first (they're more specific)
        if (allianceIndicators.some(pattern => pattern.test(name))) {
            return 'alliance';
        }

        // Then check for corp indicators
        if (corpIndicators.some(pattern => pattern.test(name))) {
            return 'corporation';
        }

        // Fallback: if it has 3+ words, more likely to be corp/alliance
        const parts = name.split(/\s+/);
        if (parts.length >= 3) {
            return 'corporation'; // Default to corporation for ambiguous cases
        }
    }

    // Default to character if it passes basic validation
    if (clientValidate(name)) {
        return 'character';
    }

    // If none of the above, try as mixed entity
    if (validateEntityName(name)) {
        return 'unknown';
    }

    return null; // Invalid name
}