/*
    EVE Target Intel - User Settings Management

    Copyright (C) 2025 moregh (https://github.com/moregh/)
    Licensed under AGPL License.
*/

import { MAX_KILLMAILS_TO_FETCH, ZKILL_PAGINATION_CONFIG } from './config.js';

const DEFAULT_SETTINGS = {
    MAX_KILLMAILS_TO_FETCH: MAX_KILLMAILS_TO_FETCH,
    ZKILL_MIN_KILLMAILS: ZKILL_PAGINATION_CONFIG.MIN_KILLMAILS,
    ZKILL_TARGET_DAYS: ZKILL_PAGINATION_CONFIG.TARGET_DAYS,
    ZKILL_MAX_PAGES: ZKILL_PAGINATION_CONFIG.MAX_PAGES
};

const SETTING_CONSTRAINTS = {
    MAX_KILLMAILS_TO_FETCH: { min: 1, max: 4000 },  // zkill max
    ZKILL_MIN_KILLMAILS: { min: 1, max: 4000 },
    ZKILL_TARGET_DAYS: { min: 1, max: 3652 },  // 10 years
    ZKILL_MAX_PAGES: { min: 1, max: 20 }  // zkill max
};

let settingsCache = null;

export async function getUserSetting(key) {
    if (settingsCache && settingsCache[key] !== undefined) {
        return settingsCache[key];
    }

    const { getUserSettingFromDB } = await import('./database.js');
    const value = await getUserSettingFromDB(key);

    if (value !== null) {
        if (!settingsCache) settingsCache = {};
        settingsCache[key] = value;
        return value;
    }

    return DEFAULT_SETTINGS[key];
}

export async function setUserSetting(key, value) {
    if (DEFAULT_SETTINGS[key] === undefined) {
        return { success: false, error: `Unknown setting: ${key}` };
    }

    const constraint = SETTING_CONSTRAINTS[key];
    if (constraint) {
        const numValue = parseInt(value);
        if (isNaN(numValue) || numValue < constraint.min || numValue > constraint.max) {
            return { success: false, error: `Must be between ${constraint.min} and ${constraint.max}` };
        }
        value = numValue;
    }

    const { setUserSettingInDB } = await import('./database.js');
    await setUserSettingInDB(key, value);

    if (!settingsCache) settingsCache = {};
    settingsCache[key] = value;

    return { success: true };
}

export async function getAllUserSettings() {
    const settings = {};
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
        settings[key] = await getUserSetting(key);
    }
    return settings;
}

export async function resetUserSettings() {
    const { clearUserSettings } = await import('./database.js');
    await clearUserSettings();
    settingsCache = null;
}

export function getDefaultSettings() {
    return { ...DEFAULT_SETTINGS };
}

export function getSettingConstraints() {
    return { ...SETTING_CONSTRAINTS };
}

export async function getRuntimePaginationConfig() {
    return {
        MIN_KILLMAILS: await getUserSetting('ZKILL_MIN_KILLMAILS'),
        TARGET_DAYS: await getUserSetting('ZKILL_TARGET_DAYS'),
        MAX_PAGES: await getUserSetting('ZKILL_MAX_PAGES'),
        PAGE_FETCH_DELAY_MS: ZKILL_PAGINATION_CONFIG.PAGE_FETCH_DELAY_MS,
        VERIFY_AFTER_PAGES: ZKILL_PAGINATION_CONFIG.VERIFY_AFTER_PAGES
    };
}

export async function getRuntimeMaxKillmails() {
    return await getUserSetting('MAX_KILLMAILS_TO_FETCH');
}
