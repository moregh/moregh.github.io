/*
    EVE Target Intel - Detail Panel Module

    Copyright (C) 2025 moregh (https://github.com/moregh/)
    Licensed under AGPL License.
*/

import { getZkillCardInstance } from './zkill-card.js';

let currentEntityType = null;
let currentEntityId = null;

export async function showEntityDetail(type, id, name = null) {
    const detailContent = document.getElementById('detail-content');
    if (!detailContent) return;

    currentEntityType = type;
    currentEntityId = id;

    detailContent.innerHTML = `
        <div class="empty-state">
            <div class="loading-spinner"></div>
            <div class="empty-state-text">Loading ${type} information...</div>
        </div>
    `;

    try {
        const zkillCard = getZkillCardInstance();

        if (type === 'character') {
            await zkillCard.showCharacterStatsInline(id, detailContent, name);
        } else if (type === 'corporation') {
            await zkillCard.showCorporationStatsInline(id, detailContent, name);
        } else if (type === 'alliance') {
            await zkillCard.showAllianceStatsInline(id, detailContent, name);
        }
    } catch (error) {
        console.error('Error loading entity details:', error);
        detailContent.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">⚠️</div>
                <div class="empty-state-text">Error loading ${type} information</div>
            </div>
        `;
    }
}

export function clearDetailPanel() {
    const detailContent = document.getElementById('detail-content');
    if (!detailContent) return;

    detailContent.innerHTML = `
        <div class="empty-state">
            <div class="empty-state-icon">👈</div>
            <div class="empty-state-text">Select an entity from the tree to view detailed information</div>
        </div>
    `;

    currentEntityType = null;
    currentEntityId = null;
}

export function getCurrentEntity() {
    return {
        type: currentEntityType,
        id: currentEntityId
    };
}
