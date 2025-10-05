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

    const inputs = [
        'setting-max-killmails',
        'setting-min-killmails',
        'setting-target-days',
        'setting-max-pages'
    ];
    inputs.forEach(id => {
        const input = document.getElementById(id);
        if (input) {
            input.addEventListener('input', () => clearFieldError(id));
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
    clearAllErrors();

    const settings = [
        { id: 'setting-max-killmails', key: 'MAX_KILLMAILS_TO_FETCH' },
        { id: 'setting-min-killmails', key: 'ZKILL_MIN_KILLMAILS' },
        { id: 'setting-target-days', key: 'ZKILL_TARGET_DAYS' },
        { id: 'setting-max-pages', key: 'ZKILL_MAX_PAGES' }
    ];

    let hasErrors = false;

    for (const setting of settings) {
        const value = parseInt(document.getElementById(setting.id).value);
        const result = await setUserSetting(setting.key, value);

        if (!result.success) {
            showFieldError(setting.id, result.error);
            hasErrors = true;
        }
    }

    if (hasErrors) {
        return;
    }

    showSuccess('Settings saved successfully');
    closeSettingsModal();
}

function showFieldError(inputId, message) {
    const input = document.getElementById(inputId);
    if (!input) return;

    const item = input.closest('.setting-item');
    if (!item) return;

    input.classList.add('setting-input-error');

    let errorDiv = item.querySelector('.setting-error');
    if (!errorDiv) {
        errorDiv = document.createElement('div');
        errorDiv.className = 'setting-error';
        const helpDiv = item.querySelector('.setting-help');
        if (helpDiv) {
            helpDiv.after(errorDiv);
        } else {
            input.after(errorDiv);
        }
    }
    errorDiv.textContent = message;
}

function clearFieldError(inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;

    input.classList.remove('setting-input-error');

    const item = input.closest('.setting-item');
    if (!item) return;

    const errorDiv = item.querySelector('.setting-error');
    if (errorDiv) {
        errorDiv.remove();
    }
}

function clearAllErrors() {
    const inputs = document.querySelectorAll('.setting-input-error');
    inputs.forEach(input => {
        input.classList.remove('setting-input-error');
    });

    const errors = document.querySelectorAll('.setting-error');
    errors.forEach(error => error.remove());
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
