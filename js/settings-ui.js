/*
    EVE Target Intel - Settings UI Component

    Copyright (C) 2025 moregh (https://github.com/moregh/)
    Licensed under AGPL License.
*/

import { getAllUserSettings, setUserSetting, resetUserSettings, getDefaultSettings, getSettingConstraints } from './user-settings.js';
import { showSuccess, showError } from './ui.js';

let settingsModal = null;
let settingsForm = null;

export function initializeSettingsUI() {
    const settingsButton = document.getElementById('settings-button');
    settingsModal = document.getElementById('settings-modal');
    settingsForm = document.getElementById('settings-form');

    if (!settingsButton || !settingsModal || !settingsForm) {
        console.warn('Settings UI elements not found in DOM');
        return;
    }

    settingsButton.addEventListener('click', openSettingsModal);

    const closeButton = settingsModal.querySelector('.settings-close');
    const cancelButton = settingsModal.querySelector('.settings-cancel');
    const saveButton = settingsModal.querySelector('.settings-save');
    const resetButton = settingsModal.querySelector('.settings-reset');

    if (closeButton) closeButton.addEventListener('click', closeSettingsModal);
    if (cancelButton) cancelButton.addEventListener('click', closeSettingsModal);
    if (saveButton) saveButton.addEventListener('click', saveSettings);
    if (resetButton) resetButton.addEventListener('click', resetSettings);

    settingsModal.addEventListener('click', (e) => {
        if (e.target === settingsModal) {
            closeSettingsModal();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && settingsModal.classList.contains('active')) {
            closeSettingsModal();
        }
    });
}

async function openSettingsModal() {
    try {
        const currentSettings = await getAllUserSettings();
        const defaults = getDefaultSettings();
        const constraints = getSettingConstraints();

        document.getElementById('setting-max-killmails').value = currentSettings.MAX_KILLMAILS_TO_FETCH;
        document.getElementById('setting-min-killmails').value = currentSettings.ZKILL_MIN_KILLMAILS;
        document.getElementById('setting-target-days').value = currentSettings.ZKILL_TARGET_DAYS;
        document.getElementById('setting-max-pages').value = currentSettings.ZKILL_MAX_PAGES;

        updateConstraintLabels(constraints);
        updateDefaultLabels(defaults);

        settingsModal.classList.add('active');
        document.body.style.overflow = 'hidden';
    } catch (error) {
        console.error('Error opening settings:', error);
        showError('Failed to load settings');
    }
}

function closeSettingsModal() {
    settingsModal.classList.remove('active');
    document.body.style.overflow = '';
}

async function saveSettings() {
    try {
        const maxKillmails = parseInt(document.getElementById('setting-max-killmails').value);
        const minKillmails = parseInt(document.getElementById('setting-min-killmails').value);
        const targetDays = parseInt(document.getElementById('setting-target-days').value);
        const maxPages = parseInt(document.getElementById('setting-max-pages').value);

        await setUserSetting('MAX_KILLMAILS_TO_FETCH', maxKillmails);
        await setUserSetting('ZKILL_MIN_KILLMAILS', minKillmails);
        await setUserSetting('ZKILL_TARGET_DAYS', targetDays);
        await setUserSetting('ZKILL_MAX_PAGES', maxPages);

        showSuccess('Settings saved successfully');
        closeSettingsModal();
    } catch (error) {
        console.error('Error saving settings:', error);
        showError(error.message || 'Failed to save settings');
    }
}

async function resetSettings() {
    if (!confirm('Reset all settings to defaults?')) {
        return;
    }

    try {
        await resetUserSettings();

        const defaults = getDefaultSettings();
        document.getElementById('setting-max-killmails').value = defaults.MAX_KILLMAILS_TO_FETCH;
        document.getElementById('setting-min-killmails').value = defaults.ZKILL_MIN_KILLMAILS;
        document.getElementById('setting-target-days').value = defaults.ZKILL_TARGET_DAYS;
        document.getElementById('setting-max-pages').value = defaults.ZKILL_MAX_PAGES;

        showSuccess('Settings reset to defaults');
    } catch (error) {
        console.error('Error resetting settings:', error);
        showError('Failed to reset settings');
    }
}

function updateConstraintLabels(constraints) {
    const updateLabel = (id, constraint) => {
        const elem = document.getElementById(id);
        if (elem && constraint) {
            elem.textContent = `(${constraint.min}-${constraint.max})`;
        }
    };

    updateLabel('constraint-max-killmails', constraints.MAX_KILLMAILS_TO_FETCH);
    updateLabel('constraint-min-killmails', constraints.ZKILL_MIN_KILLMAILS);
    updateLabel('constraint-target-days', constraints.ZKILL_TARGET_DAYS);
    updateLabel('constraint-max-pages', constraints.ZKILL_MAX_PAGES);
}

function updateDefaultLabels(defaults) {
    const updateLabel = (id, value) => {
        const elem = document.getElementById(id);
        if (elem) {
            elem.textContent = value;
        }
    };

    updateLabel('default-max-killmails', defaults.MAX_KILLMAILS_TO_FETCH);
    updateLabel('default-min-killmails', defaults.ZKILL_MIN_KILLMAILS);
    updateLabel('default-target-days', defaults.ZKILL_TARGET_DAYS);
    updateLabel('default-max-pages', defaults.ZKILL_MAX_PAGES);
}
