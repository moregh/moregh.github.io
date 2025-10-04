/*
    EVE Target Intel - Tree Navigation Module

    Copyright (C) 2025 moregh (https://github.com/moregh/)
    Licensed under AGPL License.
*/

import { getEntityMaps } from './rendering.js';
import { showEntityDetail } from './detail-panel.js';
import { sanitizeId, sanitizeAttribute } from './xss-protection.js';

let currentTreeData = null;
let selectedEntityId = null;
let selectedEntityType = null;

export function buildTreeStructure(results) {
    const { corpToCharactersMap, allianceToCorpsMap } = getEntityMaps();

    const allianceMap = new Map();
    const noAllianceCorps = new Map();
    const noCorpCharacters = [];

    results.forEach(result => {
        if (!result.character_name) {
            return;
        }

        const allianceId = result.alliance_id;
        const corpId = result.corporation_id;

        if (allianceId) {
            if (!allianceMap.has(allianceId)) {
                allianceMap.set(allianceId, {
                    id: allianceId,
                    name: result.alliance_name,
                    type: 'alliance',
                    war_eligible: false,
                    corps: new Map()
                });
            }

            const alliance = allianceMap.get(allianceId);
            if (result.war_eligible) {
                alliance.war_eligible = true;
            }

            if (corpId && !alliance.corps.has(corpId)) {
                alliance.corps.set(corpId, {
                    id: corpId,
                    name: result.corporation_name,
                    type: 'corporation',
                    war_eligible: result.war_eligible || false,
                    characters: []
                });
            }
        } else if (corpId) {
            if (!noAllianceCorps.has(corpId)) {
                noAllianceCorps.set(corpId, {
                    id: corpId,
                    name: result.corporation_name,
                    type: 'corporation',
                    war_eligible: result.war_eligible || false,
                    characters: []
                });
            }
            const corp = noAllianceCorps.get(corpId);
            if (result.war_eligible) {
                corp.war_eligible = true;
            }
        } else {
            noCorpCharacters.push(result);
        }
    });

    corpToCharactersMap.forEach((characters, corpId) => {
        characters.forEach(character => {
            const allianceId = character.alliance_id;

            if (allianceId && allianceMap.has(allianceId)) {
                const alliance = allianceMap.get(allianceId);
                if (alliance.corps.has(corpId)) {
                    alliance.corps.get(corpId).characters.push(character);
                }
            } else if (noAllianceCorps.has(corpId)) {
                noAllianceCorps.get(corpId).characters.push(character);
            }
        });
    });

    currentTreeData = {
        alliances: Array.from(allianceMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
        noAllianceCorps: Array.from(noAllianceCorps.values()).sort((a, b) => a.name.localeCompare(b.name)),
        noCorpCharacters: noCorpCharacters.sort((a, b) => a.character_name.localeCompare(b.character_name))
    };

    return currentTreeData;
}

export function renderTree(treeData) {
    const container = document.getElementById('tree-container');
    if (!container) return;

    container.innerHTML = '';

    if (!treeData) {
        container.innerHTML = '<div class="empty-state"><div class="empty-state-text">No results to display</div></div>';
        return;
    }

    const fragment = document.createDocumentFragment();

    treeData.alliances.forEach(alliance => {
        const allianceNode = createAllianceNode(alliance);
        fragment.appendChild(allianceNode);
    });

    treeData.noAllianceCorps.forEach(corp => {
        const corpNode = createCorporationNode(corp);
        fragment.appendChild(corpNode);
    });

    treeData.noCorpCharacters.forEach(character => {
        const charNode = createCharacterNode(character);
        fragment.appendChild(charNode);
    });

    container.appendChild(fragment);

    setupTreeEventListeners();
}

function createAllianceNode(alliance) {
    const node = document.createElement('div');
    node.className = 'tree-node';

    const corpCount = alliance.corps.size;
    let totalCharacters = 0;
    alliance.corps.forEach(corp => {
        totalCharacters += corp.characters.length;
    });

    const warClass = alliance.war_eligible ? 'war-eligible' : '';

    node.innerHTML = `
        <div class="tree-item alliance ${warClass}" data-entity-type="alliance" data-entity-id="${sanitizeAttribute(alliance.id.toString())}">
            <span class="tree-toggle">▶</span>
            <img class="tree-icon" src="https://images.evetech.net/alliances/${alliance.id}/logo?size=32" alt="">
            <span class="tree-label">${alliance.name}</span>
            <span class="tree-count">${totalCharacters}</span>
        </div>
        <div class="tree-children">
            ${Array.from(alliance.corps.values()).map(corp => createCorporationNodeHTML(corp)).join('')}
        </div>
    `;

    return node;
}

function createCorporationNode(corp) {
    const node = document.createElement('div');
    node.className = 'tree-node';
    node.innerHTML = createCorporationNodeHTML(corp);
    return node;
}

function createCorporationNodeHTML(corp) {
    const warClass = corp.war_eligible ? 'war-eligible' : '';
    const charactersHTML = corp.characters.map(char => createCharacterNodeHTML(char)).join('');

    return `
        <div class="tree-node">
            <div class="tree-item corporation ${warClass}" data-entity-type="corporation" data-entity-id="${sanitizeAttribute(corp.id.toString())}">
                <span class="tree-toggle">▶</span>
                <img class="tree-icon" src="https://images.evetech.net/corporations/${corp.id}/logo?size=32" alt="">
                <span class="tree-label">${corp.name}</span>
                <span class="tree-count">${corp.characters.length}</span>
            </div>
            <div class="tree-children">
                ${charactersHTML}
            </div>
        </div>
    `;
}

function createCharacterNode(character) {
    const node = document.createElement('div');
    node.className = 'tree-node';
    node.innerHTML = createCharacterNodeHTML(character);
    return node;
}

function createCharacterNodeHTML(character) {
    const warClass = character.war_eligible ? 'war-eligible' : '';

    return `
        <div class="tree-node">
            <div class="tree-item character ${warClass}" data-entity-type="character" data-entity-id="${sanitizeAttribute(character.character_id.toString())}">
                <span class="tree-toggle"></span>
                <img class="tree-icon" src="https://images.evetech.net/characters/${character.character_id}/portrait?size=32" alt="">
                <span class="tree-label">${character.character_name}</span>
            </div>
        </div>
    `;
}

let treeEventListenerAdded = false;
let expandButtonListenersAdded = false;

function setupTreeEventListeners() {
    const container = document.getElementById('tree-container');
    if (!container) return;

    if (!treeEventListenerAdded) {
        container.addEventListener('click', (event) => {
            const treeItem = event.target.closest('.tree-item');
            if (!treeItem) return;

            const toggle = event.target.closest('.tree-toggle');
            if (toggle && toggle.textContent.trim()) {
                event.stopPropagation();
                toggleNode(treeItem);
                return;
            }

            selectEntity(treeItem);
        });
        treeEventListenerAdded = true;
    }

    if (!expandButtonListenersAdded) {
        const expandAllBtn = document.getElementById('expand-all-btn');
        const collapseAllBtn = document.getElementById('collapse-all-btn');

        if (expandAllBtn) {
            expandAllBtn.addEventListener('click', expandAll);
        }

        if (collapseAllBtn) {
            collapseAllBtn.addEventListener('click', collapseAll);
        }
        expandButtonListenersAdded = true;
    }
}

function toggleNode(treeItem) {
    const node = treeItem.closest('.tree-node');
    if (!node) return;

    const children = node.querySelector('.tree-children');
    const toggle = treeItem.querySelector('.tree-toggle');

    if (children && toggle) {
        children.classList.toggle('expanded');
        toggle.classList.toggle('expanded');
    }
}

function selectEntity(treeItem) {
    const entityType = treeItem.dataset.entityType;
    const entityId = treeItem.dataset.entityId;
    const entityName = treeItem.querySelector('.tree-label')?.textContent || '';

    if (!entityType || !entityId) return;

    document.querySelectorAll('.tree-item.selected').forEach(item => {
        item.classList.remove('selected');
    });

    treeItem.classList.add('selected');

    selectedEntityType = entityType;
    selectedEntityId = entityId;

    showEntityDetail(entityType, entityId, entityName);
}

export function expandAll() {
    document.querySelectorAll('.tree-children').forEach(node => {
        node.classList.add('expanded');
    });
    document.querySelectorAll('.tree-toggle').forEach(toggle => {
        if (toggle.textContent.trim() === '▶') {
            toggle.classList.add('expanded');
        }
    });
}

export function collapseAll() {
    document.querySelectorAll('.tree-children').forEach(node => {
        node.classList.remove('expanded');
    });
    document.querySelectorAll('.tree-toggle').forEach(toggle => {
        toggle.classList.remove('expanded');
    });
}

export function getSelectedEntity() {
    return {
        type: selectedEntityType,
        id: selectedEntityId
    };
}

export function getCurrentTreeData() {
    return currentTreeData;
}

export function filterTreeNodes(filterFn) {
    if (!currentTreeData) return;

    const container = document.getElementById('tree-container');
    if (!container) return;

    const allTreeItems = container.querySelectorAll('.tree-item');

    allTreeItems.forEach(item => {
        const entityType = item.dataset.entityType;
        const entityId = parseInt(item.dataset.entityId);

        const shouldShow = filterFn(entityType, entityId);

        const node = item.closest('.tree-node');
        if (node) {
            node.style.display = shouldShow ? '' : 'none';
        }
    });

    updateTreeVisibility();
}

function updateTreeVisibility() {
    document.querySelectorAll('.tree-node').forEach(node => {
        const treeItem = node.querySelector('.tree-item.alliance, .tree-item.corporation');
        if (!treeItem) return;

        const children = node.querySelector('.tree-children');
        if (!children) return;

        const visibleChildren = Array.from(children.querySelectorAll(':scope > .tree-node')).filter(child => {
            return child.style.display !== 'none';
        });

        if (visibleChildren.length === 0 && node.style.display !== 'none') {
            const parentHasDirectMatch = node.style.display !== 'none';
            if (!parentHasDirectMatch) {
                node.style.display = 'none';
            }
        }
    });
}

export function resetTreeFilter() {
    const container = document.getElementById('tree-container');
    if (!container) return;

    container.querySelectorAll('.tree-node').forEach(node => {
        node.style.display = '';
    });
}
