/*
    EVE Target Intel - DOM Rendering and Virtual Scrolling
    
    Copyright (C) 2025 moregh (https://github.com/moregh/)
    Licensed under AGPL License.
*/

import {
    CHARACTER_PORTRAIT_SIZE_PX, CORP_LOGO_SIZE_PX, ALLIANCE_LOGO_SIZE_PX,
    SCROLL_STATE_TIMEOUT_MS, SCROLL_THROTTLE_MS, ANIMATION_FRAME_THROTTLE_FPS,
    POPUP_SHOW_DELAY, VIRTUAL_SCROLL_CONFIG, VIEW_DIMENSIONS, PERFORMANCE_CONFIG,
    IMAGE_PLACEHOLDER_SIZE_PX, ENTITY_MIN_WIDTH_PX, ENTITY_CARD_MIN_WIDTH_PX, CONTAINER_PADDING_PX,
    ENTITY_LOGO_SIZE_PX, CLEANUP_ELEMENT_BATCH_SIZE
} from './config.js';
import { ManagedObservers, setImageObserverEnabled } from './observers.js';
import { sanitizeId, sanitizeAttribute } from './xss-protection.js';

const observerManager = new ManagedObservers();

class ElementPool {
    constructor(createFn, resetFn, maxSize = PERFORMANCE_CONFIG.MAX_ELEMENT_POOL_SIZE) {
        this.pool = [];
        this.createFn = createFn;
        this.resetFn = resetFn;
        this.maxSize = maxSize;
        this.created = 0;
        this.reused = 0;
    }

    acquire() {
        if (this.pool.length > 0) {
            this.reused++;
            return this.pool.pop();
        }
        this.created++;
        return this.createFn();
    }

    release(element) {
        if (this.pool.length < this.maxSize && element && element.parentNode) {
            element.parentNode.removeChild(element);
            this.resetFn(element);
            this.pool.push(element);
        }
    }
}

let characterElementPool;
let entityCardPool;

function initializeElementPools() {
    characterElementPool = new ElementPool(
        () => createBaseCharacterElement(),
        (element) => resetCharacterElement(element)
    );

    entityCardPool = new ElementPool(
        () => createBaseEntityCardElement(),
        (element) => resetEntityCardElement(element)
    );
}

let corpToCharactersMap = new Map();
let allianceToCorpsMap = new Map();

function unobserveElement(element) {
    const images = element.querySelectorAll('img[data-src]');
    images.forEach(img => {
        if (observerManager.observedImages.has(img)) {
            observerManager.imageObserver?.unobserve(img);
            observerManager.observedImages.delete(img);
        }
    });

    if (observerManager.observedAnimations.has(element)) {
        observerManager.animationObserver?.unobserve(element);
        observerManager.observedAnimations.delete(element);
    }
}

export function buildEntityMaps(results) {
    corpToCharactersMap.clear();
    allianceToCorpsMap.clear();

    const characterResults = results.filter(result => result.character_name);

    characterResults.forEach(character => {
        if (character.corporation_id) {
            if (!corpToCharactersMap.has(character.corporation_id)) {
                corpToCharactersMap.set(character.corporation_id, []);
            }
            corpToCharactersMap.get(character.corporation_id).push(character);
        }
    });

    const corpsByAlliance = new Map();
    characterResults.forEach(character => {
        if (character.alliance_id && character.corporation_id) {
            if (!corpsByAlliance.has(character.alliance_id)) {
                corpsByAlliance.set(character.alliance_id, new Set());
            }
            corpsByAlliance.get(character.alliance_id).add(character.corporation_id);
        }
    });

    corpsByAlliance.forEach((corpIds, allianceId) => {
        const corps = [];
        corpIds.forEach(corpId => {
            const characters = corpToCharactersMap.get(corpId) || [];
            if (characters.length > 0) {
                corps.push({
                    id: corpId,
                    name: characters[0].corporation_name,
                    count: characters.length
                });
            }
        });
        allianceToCorpsMap.set(allianceId, corps.sort((a, b) => b.count - a.count));
    });
}

function createBaseCharacterElement() {
    const template = document.createElement('template');
    const placeholder = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${IMAGE_PLACEHOLDER_SIZE_PX}' height='${IMAGE_PLACEHOLDER_SIZE_PX}'%3E%3C/svg%3E`;

    template.innerHTML = `
        <div class="result-item grid-view animate-ready" data-clickable="character" style="cursor: pointer;">
            <div class="character-header">
                <img src="${placeholder}" class="character-avatar" loading="lazy" decoding="async">
                <div class="character-name">
                    <a href="#" target="_blank" class="character-link"></a>
                </div>
            </div>
            <div class="character-details">
                <div class="corp-alliance-info">
                    <div class="org-item corp-item">
                        <img src="${placeholder}" class="org-logo" loading="lazy" decoding="async">
                        <a href="#" target="_blank" class="character-link"></a>
                    </div>
                </div>
            </div>
        </div>
    `;
    return template.content.firstElementChild;
}

function createBaseEntityCardElement() {
    const template = document.createElement('template');
    const placeholder = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${ENTITY_LOGO_SIZE_PX}' height='${ENTITY_LOGO_SIZE_PX}'%3E%3C/svg%3E`;

    template.innerHTML = `
        <div class="result-item entity-card" data-clickable="" style="cursor: pointer;">
            <div class="entity-header">
                <img src="${placeholder}" class="entity-logo" loading="lazy" decoding="async">
                <div class="entity-info">
                    <div class="entity-name">
                        <span class="entity-type-icon"></span>
                        <a href="#" target="_blank" class="character-link"></a>
                    </div>
                    <div class="entity-details">
                        <div class="entity-count">
                            <span class="count-number"></span>
                            <span class="count-label"></span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
    return template.content.firstElementChild;
}

function resetElementCore(element, placeholderSize) {
    element.style.cssText = "cursor: pointer;";

    const images = element.querySelectorAll('img');
    images.forEach(img => {
        img.src = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${placeholderSize}' height='${placeholderSize}'%3E%3C/svg%3E`;
        img.dataset.src = "";
        img.alt = "";
    });

    const links = element.querySelectorAll('a');
    links.forEach(link => {
        link.href = "#";
        link.textContent = "";
    });
}

function resetCharacterElement(element) {
    if (!element) return;

    element.className = "result-item grid-view animate-ready";
    element.dataset.characterId = "";

    resetElementCore(element, IMAGE_PLACEHOLDER_SIZE_PX);

    const allianceItem = element.querySelector('.corp-alliance-info .org-item:last-child');
    if (allianceItem && allianceItem.querySelector('a[href*="/alliance/"]')) {
        allianceItem.remove();
    }
}

function resetEntityCardElement(element) {
    if (!element) return;

    element.className = "result-item entity-card";
    element.dataset.clickable = "";
    element.dataset.entityId = "";
    element.dataset.entityName = "";

    resetElementCore(element, ENTITY_LOGO_SIZE_PX);

    const typeIcon = element.querySelector('.entity-type-icon');
    const countNumber = element.querySelector('.count-number');
    const countLabel = element.querySelector('.count-label');

    if (typeIcon) typeIcon.textContent = "";
    if (countNumber) countNumber.textContent = "";
    if (countLabel) countLabel.textContent = "";
}

function updateImageSrc(imgElement, newSrc) {
    if (!imgElement) return;
    if (imgElement.dataset.src !== newSrc) {
        imgElement.dataset.src = newSrc;
        if (document.contains(imgElement)) {
            observerManager.observeImage(imgElement);
        }
    }
}

function updateOrgSection(element, character, orgType) {
    const corpAllianceInfo = element.querySelector('.corp-alliance-info');
    let orgSection = element.querySelector('.org-item:last-child');
    const isOrgSection = orgSection && orgSection.querySelector(`a[href*="/${orgType}/"]`);

    const orgName = character[`${orgType}_name`];
    const orgId = character[`${orgType}_id`];
    const logoSize = orgType === 'alliance' ? ALLIANCE_LOGO_SIZE_PX : CORP_LOGO_SIZE_PX;

    if (orgName && orgId) {
        if (!isOrgSection) {
            const fragment = document.createDocumentFragment();
            const newOrgSection = document.createElement('div');
            newOrgSection.className = 'org-item';
            newOrgSection.innerHTML = `
                <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${IMAGE_PLACEHOLDER_SIZE_PX}' height='${IMAGE_PLACEHOLDER_SIZE_PX}'%3E%3C/svg%3E"
                     data-src="https://images.evetech.net/${orgType}s/${orgId}/logo?size=${logoSize}"
                     alt="${orgName}"
                     class="org-logo"
                     loading="lazy"
                     decoding="async">
                <a href="https://zkillboard.com/${orgType}/${orgId}/"
                   target="_blank"
                   class="character-link">${orgName}</a>
            `;
            fragment.appendChild(newOrgSection);
            corpAllianceInfo.appendChild(fragment);

            const orgLogo = newOrgSection.querySelector('.org-logo');
            if (document.contains(orgLogo)) {
                observerManager.observeImage(orgLogo);
            }
        } else {
            const orgLogo = orgSection.querySelector('.org-logo');
            const orgLink = orgSection.querySelector('.character-link');

            if (orgLogo) {
                orgLogo.alt = orgName;
                updateImageSrc(orgLogo, `https://images.evetech.net/${orgType}s/${orgId}/logo?size=${logoSize}`);
            }

            if (orgLink) {
                orgLink.textContent = orgName;
                orgLink.href = `https://zkillboard.com/${orgType}/${orgId}/`;
            }
        }
    } else {
        if (isOrgSection) {
            orgSection.remove();
        }
    }
}

function createEmptyStateHTML(icon, text, className) {
    return `
        <div class="${className}">
            <div class="no-results-icon">${icon}</div>
            <div class="no-results-text">${text}</div>
        </div>
    `;
}

export function updateElementContent(element, character) {
    const avatar = element.querySelector('.character-avatar');
    const characterLink = element.querySelector('.character-name a');
    const corpLogo = element.querySelector('.corp-alliance-info .org-logo');
    const corpLink = element.querySelector('.corp-alliance-info .character-link');

    if (avatar) {
        avatar.alt = character.character_name;
        updateImageSrc(avatar, `https://images.evetech.net/characters/${character.character_id}/portrait?size=${CHARACTER_PORTRAIT_SIZE_PX}`);
    }

    if (characterLink) {
        characterLink.textContent = character.character_name;
        characterLink.href = `https://zkillboard.com/character/${character.character_id}/`;
    }

    if (corpLogo) {
        corpLogo.alt = character.corporation_name;
        updateImageSrc(corpLogo, `https://images.evetech.net/corporations/${character.corporation_id}/logo?size=${CORP_LOGO_SIZE_PX}`);
    }

    if (corpLink) {
        corpLink.textContent = character.corporation_name;
        corpLink.href = `https://zkillboard.com/corporation/${character.corporation_id}/`;
    }

    updateOrgSection(element, character, 'alliance');
}

export function createCharacterItem(character, viewType = 'grid') {
    if (!characterElementPool) {
        initializeElementPools();
    }

    const element = characterElementPool.acquire();
    const characterId = sanitizeId(character.character_id);
    const characterName = character.character_name;
    const corporationId = sanitizeId(character.corporation_id);
    const corporationName = character.corporation_name;
    const allianceId = character.alliance_id ? sanitizeId(character.alliance_id) : null;
    const allianceName = character.alliance_name;
    element.className = `result-item ${viewType}-view animate-ready ${character.war_eligible ? 'war-eligible' : ''}`;
    element.dataset.characterId = sanitizeAttribute(characterId.toString());
    const avatar = element.querySelector('.character-avatar');
    const characterLink = element.querySelector('.character-name .character-link');

    if (avatar) {
        avatar.dataset.src = `https://images.evetech.net/characters/${characterId}/portrait?size=${CHARACTER_PORTRAIT_SIZE_PX}`;
        avatar.alt = sanitizeAttribute(characterName);
    }

    if (characterLink) {
        characterLink.href = `https://zkillboard.com/character/${characterId}/`;
        characterLink.textContent = characterName;
    }

    const nameDiv = element.querySelector('.character-name');
    let existingBadge = nameDiv.querySelector('.war-eligible-badge');
    if (character.war_eligible && !existingBadge) {
        const badge = document.createElement('span');
        badge.className = 'war-eligible-badge';
        badge.textContent = 'WAR';
        nameDiv.appendChild(badge);
    } else if (!character.war_eligible && existingBadge) {
        existingBadge.remove();
    }

    const corpLogo = element.querySelector('.corp-item .org-logo');
    const corpLink = element.querySelector('.corp-item .character-link');

    if (corpLogo) {
        corpLogo.dataset.src = `https://images.evetech.net/corporations/${corporationId}/logo?size=${CORP_LOGO_SIZE_PX}`;
        corpLogo.alt = sanitizeAttribute(corporationName);
    }

    if (corpLink) {
        corpLink.href = `https://zkillboard.com/corporation/${corporationId}/`;
        corpLink.textContent = corporationName;
    }

    const corpAllianceInfo = element.querySelector('.corp-alliance-info');
    let allianceItem = corpAllianceInfo.querySelector('.org-item:last-child');
    const isAllianceItem = allianceItem && allianceItem !== corpAllianceInfo.querySelector('.corp-item');

    if (allianceName && allianceId) {
        if (!isAllianceItem) {
            const newAllianceItem = document.createElement('div');
            newAllianceItem.className = 'org-item';
            newAllianceItem.innerHTML = `
                <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${IMAGE_PLACEHOLDER_SIZE_PX}' height='${IMAGE_PLACEHOLDER_SIZE_PX}'%3E%3C/svg%3E"
                     data-src="https://images.evetech.net/alliances/${allianceId}/logo?size=${ALLIANCE_LOGO_SIZE_PX}"
                     alt="${sanitizeAttribute(allianceName)}"
                     class="org-logo"
                     loading="lazy"
                     decoding="async">
                <a href="https://zkillboard.com/alliance/${allianceId}/"
                   target="_blank"
                   class="character-link">${allianceName}</a>
            `;
            corpAllianceInfo.appendChild(newAllianceItem);
        } else {
            const allianceLogo = allianceItem.querySelector('.org-logo');
            const allianceLink = allianceItem.querySelector('.character-link');

            if (allianceLogo) {
                allianceLogo.dataset.src = `https://images.evetech.net/alliances/${allianceId}/logo?size=${ALLIANCE_LOGO_SIZE_PX}`;
                allianceLogo.alt = sanitizeAttribute(allianceName);
            }

            if (allianceLink) {
                allianceLink.href = `https://zkillboard.com/alliance/${allianceId}/`;
                allianceLink.textContent = allianceName;
            }
        }
    } else if (isAllianceItem) {
        allianceItem.remove();
    }

    return element;
}

export function releaseElementToPool(element) {
    if (!element) return;

    const isCharacterElement = element.classList.contains('result-item') && element.querySelector('.character-avatar');
    const isEntityCard = element.classList.contains('entity-card');

    if (isCharacterElement && characterElementPool) {
        characterElementPool.release(element);
    } else if (isEntityCard && entityCardPool) {
        entityCardPool.release(element);
    }
}

export function createEntityCard({ id, name, count, type, war_eligible, isDirect }) {
    const sanitizedId = sanitizeId(id);
    const sanitizedName = name;
    const sanitizedCount = Math.max(0, Math.floor(count || 0));
    const allowedTypes = ['corporation', 'alliance'];
    const sanitizedType = allowedTypes.includes(type) ? type : 'corporation';
    const template = document.createElement('template');
    const placeholder = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${ENTITY_LOGO_SIZE_PX}' height='${ENTITY_LOGO_SIZE_PX}'%3E%3C/svg%3E`;
    const warEligibleBadge = war_eligible ? '<span class="war-eligible-badge">WAR</span>' : '';
    const entityIcon = sanitizedType === 'alliance' ? '🏛️' : '🏢';
    const logoSize = ENTITY_LOGO_SIZE_PX;

    template.innerHTML = `
        <div class="result-item entity-card ${sanitizedType}-card ${war_eligible ? 'war-eligible' : ''}"
             data-clickable="${sanitizedType}"
             data-entity-id="${sanitizeAttribute(sanitizedId.toString())}"
             data-entity-name="${sanitizeAttribute(sanitizedName)}"
             style="cursor: pointer;">
            <div class="entity-header">
                <img src="${placeholder}"
                     data-src="https://images.evetech.net/${sanitizedType}s/${sanitizedId}/logo?size=${logoSize}"
                     alt="${sanitizeAttribute(sanitizedName)}"
                     class="entity-logo"
                     loading="lazy"
                     decoding="async">
                <div class="entity-info">
                    <div class="entity-name">
                        <span class="entity-type-icon">${entityIcon}</span>
                        <a href="https://zkillboard.com/${sanitizedType}/${sanitizedId}/"
                           target="_blank"
                           class="character-link"></a>
                        ${warEligibleBadge}
                    </div>
                    <div class="entity-details">
                        <div class="entity-count">
                            ${isDirect && sanitizedCount === 1 ?
            '<span class="count-label direct-entity">Direct Search</span>' :
            `<span class="count-number">${sanitizedCount}</span>
                                 <span class="count-label">${sanitizedCount === 1 ? 'Member' : 'Members'}</span>`
        }
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    const item = template.content.firstElementChild;
    const nameLink = item.querySelector('.character-link');

    if (nameLink) {
        nameLink.textContent = name;
    }

    requestAnimationFrame(() => {
        const entityLogo = item.querySelector('.entity-logo');
        if (entityLogo) {
            observerManager.observeImage(entityLogo);
        }
    });

    return item;
}

export function setupEntityScrolling(containerId, items, type) {
    const container = document.getElementById(containerId);
    if (!validateScrollingPreconditions(container, items, containerId)) {
        return;
    }

    getObserverManager().cleanupDeadElements();

    const parentGrid = container.closest('.result-grid') || container.parentElement;
    if (parentGrid) {
        parentGrid.classList.add('virtual-enabled');
    }

    Object.assign(container.style, {
        height: VIRTUAL_SCROLL_CONFIG.CONTAINER_HEIGHT,
        minHeight: VIRTUAL_SCROLL_CONFIG.MIN_HEIGHT,
        maxHeight: VIRTUAL_SCROLL_CONFIG.MAX_HEIGHT,
        overflowY: 'auto',
        position: 'relative'
    });

    container.className = 'virtual-scroll-container';
    const spacer = document.createElement('div');
    spacer.className = 'virtual-scroll-spacer';
    const content = document.createElement('div');
    content.className = 'virtual-scroll-content';
    const minWidth = type === 'alliance' || type === 'corporation' ? `${ENTITY_CARD_MIN_WIDTH_PX}px` : `${ENTITY_MIN_WIDTH_PX}px`;

    Object.assign(content.style, {
        position: 'absolute',
        top: '0',
        left: '0',
        right: '0',
        display: 'grid',
        gap: VIRTUAL_SCROLL_CONFIG.GRID_GAP,
        padding: VIRTUAL_SCROLL_CONFIG.CONTENT_PADDING,
        gridTemplateColumns: `repeat(auto-fill, minmax(${minWidth}, 1fr))`
    });

    const elements = items.map(item => createEntityCard(item));
    elements.forEach(element => content.appendChild(element));
    const itemHeight = VIEW_DIMENSIONS.grid.height;
    const itemsPerRow = Math.max(1, Math.floor((container.clientWidth - CONTAINER_PADDING_PX) / ENTITY_CARD_MIN_WIDTH_PX));
    const totalRows = Math.ceil(elements.length / itemsPerRow);
    spacer.style.height = `${totalRows * itemHeight}px`;
    spacer.appendChild(content);
    container.innerHTML = "";
    container.appendChild(spacer);

    requestAnimationFrame(() => {
        const images = container.querySelectorAll('img[data-src]');
        images.forEach(img => getObserverManager().observeImage(img));

        elements.forEach(element => {
            getObserverManager().observeAnimation(element);
        });
    });
}

export function setupVirtualScrolling(containerId, items) {
    const container = document.getElementById(containerId);
    if (!validateScrollingPreconditions(container, items, containerId)) {
        return;
    }

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            const scrollInstance = new VirtualScrollManager(container, items);
            scrollInstance.initialize();
        });
    });
}

function validateScrollingPreconditions(container, items, containerId) {
    if (!container) {
        console.warn(`Cannot setup virtual scrolling: container "${containerId}" not found`);
        return false;
    }

    if (!items || items.length === 0) {
        console.warn(`Cannot setup virtual scrolling: no items provided for "${containerId}"`);
        return false;
    }

    return true;
}

class VirtualScrollManager {
    constructor(container, items) {
        this.container = container;
        this.items = items;
        this.parentGrid = this.findParentGrid();
        this.viewConfig = this.calculateViewConfig();
        this.dimensions = this.calculateDimensions();
        this.renderedElements = new Map();
        this.visibleRange = { start: -1, end: -1 };
        this.isUpdating = false;
        this.animationFrame = null;
        this.scrollTimeout = null;
        this.lastScrollTime = 0;
        this.spacer = null;
        this.content = null;
        this.scrollListener = null;
    }

    findParentGrid() {
        return this.container.closest('.result-grid') ||
            (this.container.parentElement?.classList?.contains('result-grid')
                ? this.container.parentElement
                : this.container);
    }

    calculateViewConfig() {
        const baseConfig = VIEW_DIMENSIONS.grid;

        let parentWidth = this.parentGrid.clientWidth;
        if (parentWidth === 0) {
            const computedStyle = window.getComputedStyle(this.parentGrid);
            parentWidth = parseInt(computedStyle.width) || 800;
        }

        const containerWidth = Math.max(
            VIRTUAL_SCROLL_CONFIG.CONTAINER_MIN_WIDTH,
            parentWidth - VIRTUAL_SCROLL_CONFIG.CONTAINER_PADDING
        );

        return {
            ...baseConfig,
            itemsPerRow: Math.max(1, Math.floor(containerWidth / VIRTUAL_SCROLL_CONFIG.MIN_ITEM_WIDTH))
        };
    }

    calculateDimensions() {
        const totalRows = Math.ceil(this.items.length / this.viewConfig.itemsPerRow);
        return {
            itemHeight: this.viewConfig.height,
            itemsPerRow: this.viewConfig.itemsPerRow,
            totalRows,
            totalHeight: totalRows * this.viewConfig.height
        };
    }

    initialize() {
        this.cleanup();
        this.setupContainer();
        this.createDOMStructure();
        this.attachEventListeners();
        this.performInitialRender();
    }

    cleanup() {
        if (this.container._cleanup) {
            this.container._cleanup();
        }
    }

    setupContainer() {
        this.parentGrid.classList.add('virtual-enabled');

        Object.assign(this.container.style, {
            height: VIRTUAL_SCROLL_CONFIG.CONTAINER_HEIGHT,
            minHeight: VIRTUAL_SCROLL_CONFIG.MIN_HEIGHT,
            maxHeight: VIRTUAL_SCROLL_CONFIG.MAX_HEIGHT,
            overflowY: 'auto',
            position: 'relative'
        });

        this.container.className = 'virtual-scroll-container';
    }

    createDOMStructure() {
        this.spacer = this.createSpacer();
        this.content = this.createContentContainer();

        this.spacer.appendChild(this.content);
        this.container.innerHTML = '';
        this.container.appendChild(this.spacer);
    }

    createSpacer() {
        const spacer = document.createElement('div');
        spacer.className = 'virtual-scroll-spacer';
        Object.assign(spacer.style, {
            height: this.dimensions.totalHeight + 'px',
            position: 'relative'
        });
        return spacer;
    }

    createContentContainer() {
        const content = document.createElement('div');
        content.className = 'virtual-scroll-content';

        Object.assign(content.style, {
            position: 'absolute',
            top: '0',
            left: '0',
            right: '0',
            display: 'grid',
            gap: VIRTUAL_SCROLL_CONFIG.GRID_GAP,
            padding: VIRTUAL_SCROLL_CONFIG.CONTENT_PADDING,
            gridTemplateColumns: `repeat(auto-fill, minmax(${VIRTUAL_SCROLL_CONFIG.MIN_ITEM_WIDTH}px, 1fr))`
        });

        return content;
    }

    attachEventListeners() {
        this.scrollListener = this.createScrollHandler();
        this.container.addEventListener('scroll', this.scrollListener, { passive: true });
        this.container._scrollListener = this.scrollListener;

        this.resizeListener = () => {
            const newViewConfig = this.calculateViewConfig();
            if (newViewConfig.itemsPerRow !== this.viewConfig.itemsPerRow) {
                this.viewConfig = newViewConfig;
                this.dimensions = this.calculateDimensions();
                this.updateVisibleItems();
            }
        };
        window.addEventListener('resize', this.resizeListener, { passive: true });
        this.container._resizeListener = this.resizeListener;
    }

    createScrollHandler() {
        return () => {
            const now = performance.now();

            if (now - this.lastScrollTime > ANIMATION_FRAME_THROTTLE_FPS) {
                this.updateVisibleItems();
                this.lastScrollTime = now;
            } else {
                this.scheduleUpdate();
            }
        };
    }

    scheduleUpdate() {
        if (this.scrollTimeout) clearTimeout(this.scrollTimeout);

        this.scrollTimeout = setTimeout(() => {
            this.updateVisibleItems();
            this.scrollTimeout = null;
        }, SCROLL_THROTTLE_MS);
    }

    performInitialRender() {
        this.updateVisibleItems();
        this.attachCleanupFunction();
    }

    updateVisibleItems() {
        if (this.isUpdating || !document.contains(this.container)) return;

        this.isUpdating = true;

        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
        }

        const visibleIndices = this.calculateVisibleIndices();

        if (this.hasRangeChanged(visibleIndices)) {
            this.animationFrame = requestAnimationFrame(() => this.renderVisibleItems(visibleIndices));
        } else {
            this.isUpdating = false;
        }
    }

    calculateVisibleIndices() {
        const scrollTop = this.container.scrollTop;
        const containerHeight = this.container.clientHeight;

        const startRow = Math.max(0,
            Math.floor(scrollTop / this.dimensions.itemHeight) - VIRTUAL_SCROLL_CONFIG.BUFFER_SIZE);
        let endRow = Math.min(this.dimensions.totalRows,
            Math.ceil((scrollTop + containerHeight) / this.dimensions.itemHeight) + VIRTUAL_SCROLL_CONFIG.BUFFER_SIZE);

        if (scrollTop === 0) {
            endRow = Math.max(endRow, VIRTUAL_SCROLL_CONFIG.MIN_INITIAL_ROWS);
            endRow = Math.min(endRow, this.dimensions.totalRows);
        }

        return {
            startIndex: startRow * this.dimensions.itemsPerRow,
            endIndex: Math.min(this.items.length, endRow * this.dimensions.itemsPerRow),
            startRow
        };
    }

    hasRangeChanged({ startIndex, endIndex }) {
        return startIndex !== this.visibleRange.start || endIndex !== this.visibleRange.end;
    }

    renderVisibleItems({ startIndex, endIndex, startRow }) {
        if (!document.contains(this.container)) {
            this.isUpdating = false;
            return;
        }

        this.hideInvisibleElements(startIndex, endIndex);
        this.showVisibleElements(startIndex, endIndex);
        this.updateContentPosition(startRow);
        this.updateVisibleRange(startIndex, endIndex);

        this.isUpdating = false;
        this.animationFrame = null;
    }

    hideInvisibleElements(startIndex, endIndex) {
        for (const [index, element] of this.renderedElements) {
            if (index < startIndex || index >= endIndex) {
                if (element.parentNode) {
                    element.style.display = 'none';
                }
            }
        }
    }

    showVisibleElements(startIndex, endIndex) {
        for (let i = startIndex; i < endIndex; i++) {
            if (!this.items[i]) continue;

            this.renderSingleItem(i);
        }
    }

    renderSingleItem(index) {
        let element = this.renderedElements.get(index);

        if (!element) {
            if (this.renderedElements.size >= VIRTUAL_SCROLL_CONFIG.MAX_RENDERED_ELEMENTS) {
                this.cleanupOldElements();
            }

            element = this.createElement(index);
            this.renderedElements.set(index, element);
            this.content.appendChild(element);
            this.observeElement(element);
        } else {
            this.showExistingElement(element);
        }
    }

    cleanupOldElements() {
        const scrollTop = this.container.scrollTop;
        const containerHeight = this.container.clientHeight;
        const currentCenterRow = Math.floor((scrollTop + containerHeight / 2) / this.dimensions.itemHeight);
        const keepDistance = VIRTUAL_SCROLL_CONFIG.BUFFER_SIZE * 3;

        const elementsToRemove = [];
        for (const [index] of this.renderedElements) {
            const elementRow = Math.floor(index / this.dimensions.itemsPerRow);
            if (Math.abs(elementRow - currentCenterRow) > keepDistance) {
                elementsToRemove.push(index);
            }
        }

        elementsToRemove.slice(0, Math.max(CLEANUP_ELEMENT_BATCH_SIZE, elementsToRemove.length / 4)).forEach(index => {
            const element = this.renderedElements.get(index);
            if (element) {
                unobserveElement(element);
                releaseElementToPool(element);
                this.renderedElements.delete(index);
            }
        });
    }

    createElement(index) {
        const element = createCharacterItem(this.items[index], 'grid');
        element.style.position = 'relative';
        element.dataset.index = index;

        return element;
    }

    observeElement(element) {
        requestAnimationFrame(() => {
            if (document.contains(element)) {
                const images = element.querySelectorAll('img[data-src]');
                images.forEach(img => observerManager.observeImage(img));
                observerManager.observeAnimation(element);
            }
        });
    }

    showExistingElement(element) {
        element.style.display = '';
        if (!element.parentNode) {
            this.content.appendChild(element);
        }
    }

    updateContentPosition(startRow) {
        const translateY = startRow * this.dimensions.itemHeight;
        this.content.style.transform = `translateY(${translateY}px)`;
    }

    updateVisibleRange(startIndex, endIndex) {
        this.visibleRange.start = startIndex;
        this.visibleRange.end = endIndex;
    }

    attachCleanupFunction() {
        this.container._cleanup = () => this.destroy();
    }

    destroy() {
        this.cancelPendingOperations();
        this.removeEventListeners();
        this.cleanupObservers();
        this.resetContainerState();
        this.clearReferences();
    }

    cancelPendingOperations() {
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }

        if (this.scrollTimeout) {
            clearTimeout(this.scrollTimeout);
            this.scrollTimeout = null;
        }
    }

    removeEventListeners() {
        if (this.container._scrollListener) {
            this.container.removeEventListener('scroll', this.container._scrollListener);
            delete this.container._scrollListener;
        }
        if (this.container._resizeListener) {
            window.removeEventListener('resize', this.container._resizeListener);
            delete this.container._resizeListener;
        }
    }

    cleanupObservers() {
        this.renderedElements.forEach(element => {
            unobserveElement(element);
            releaseElementToPool(element);
        });
    }

    resetContainerState() {
        this.parentGrid?.classList?.remove('virtual-enabled');

        if (this.container) {
            this.container.className = this.container.className
                .replace('virtual-scroll-container', '').trim() || 'result-grid';

            Object.assign(this.container.style, {
                height: '',
                minHeight: '',
                maxHeight: '',
                overflowY: '',
                position: ''
            });
        }
    }

    clearReferences() {
        this.renderedElements.clear();

        delete this.container._cleanup;

        this.container = null;
        this.items = null;
        this.parentGrid = null;
        this.spacer = null;
        this.content = null;
    }
}

export function addScrollStateDetection() {
    let scrollTimeout;

    document.addEventListener('scroll', (e) => {
        if (e.target && e.target.classList && e.target.classList.contains('virtual-scroll-container')) {
            e.target.classList.add('scrolling');
            setImageObserverEnabled(false);
            clearTimeout(scrollTimeout);

            scrollTimeout = setTimeout(() => {
                e.target.classList.remove('scrolling');
                setImageObserverEnabled(true);
            }, SCROLL_STATE_TIMEOUT_MS);
        }
    }, { passive: true, capture: true });
}

export function getObserverManager() {
    return observerManager;
}

export function getEntityMaps() {
    return {
        corpToCharactersMap,
        allianceToCorpsMap
    };
}