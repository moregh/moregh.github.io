/*
    War Target Finder - Character Name Validation
    
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