/*
    War Target Finder - DOM Rendering and Virtual Scrolling
    
    Copyright (C) 2025 moregh (https://github.com/moregh/)
    Licensed under AGPL License.
*/

import {
    CHARACTER_PORTRAIT_SIZE_PX,
    CORP_LOGO_SIZE_PX,
    ALLIANCE_LOGO_SIZE_PX,
    MOUSEOVER_CARD_AVATAR_SIZE_PX,
    MOUSEOVER_CARD_MAX_ITEMS,
    SCROLL_STATE_TIMEOUT_MS,
    SCROLL_THROTTLE_MS,
    ANIMATION_FRAME_THROTTLE_FPS
} from './config.js';
import { ManagedObservers, setImageObserverEnabled } from './observers.js';
import {
    sanitizeCharacterName,
    sanitizeCorporationName,
    sanitizeAllianceName,
    sanitizeId,
    sanitizeAttribute,
    sanitizeForDOM
} from './xss-protection.js';

// Create single observer instance
const observerManager = new ManagedObservers();

// Entity maps for mouseover functionality
let corpToCharactersMap = new Map();
let allianceToCorpsMap = new Map();

export function buildEntityMaps(results) {
    corpToCharactersMap.clear();
    allianceToCorpsMap.clear();

    // Build corp to characters map
    results.forEach(character => {
        if (character.corporation_id) {
            if (!corpToCharactersMap.has(character.corporation_id)) {
                corpToCharactersMap.set(character.corporation_id, []);
            }
            corpToCharactersMap.get(character.corporation_id).push(character);
        }
    });

    // Build alliance to corps map
    const corpsByAlliance = new Map();
    results.forEach(character => {
        if (character.alliance_id && character.corporation_id) {
            if (!corpsByAlliance.has(character.alliance_id)) {
                corpsByAlliance.set(character.alliance_id, new Set());
            }
            corpsByAlliance.get(character.alliance_id).add(character.corporation_id);
        }
    });

    // Convert to array format with corp info
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

export function createMouseoverCard(entity, type) {
    const card = document.createElement("div");
    card.className = "mouseover-card";

    let content = '';
    let items = [];
    const maxItems = MOUSEOVER_CARD_MAX_ITEMS;

    if (type === 'alliance') {
        const corps = allianceToCorpsMap.get(entity.id) || [];
        items = corps.slice(0, maxItems);
        content = `
      <div class="mouseover-card-header">Corporations in ${entity.name}</div>
      <div class="mouseover-card-content">
        ${items.map(corp => `
          <div class="mouseover-card-item zkill-card-clickable" data-entity-type="corporation" data-entity-id="${corp.id}" data-entity-name="${corp.name}">
            <img src="https://images.evetech.net/corporations/${corp.id}/logo?size=${CORP_LOGO_SIZE_PX}"
                 alt="${corp.name}" class="mouseover-card-avatar" loading="lazy">
            <div class="mouseover-card-name">
              <span>${corp.name}</span>
            </div>
            <div class="summary-count">${corp.count}</div>
          </div>
        `).join('')}
        ${corps.length > maxItems ? `<div class="mouseover-card-more">... and ${corps.length - maxItems} more corporations</div>` : ''}
      </div>
    `;
    } else if (type === 'corporation') {
        const characters = corpToCharactersMap.get(entity.id) || [];
        items = characters.slice(0, maxItems);
        content = `
      <div class="mouseover-card-header">Characters in ${entity.name}</div>
      <div class="mouseover-card-content">
        ${items.map(char => `
          <div class="mouseover-card-item zkill-card-clickable" data-entity-type="character" data-entity-id="${char.character_id}" data-entity-name="${char.character_name}">
            <img src="https://images.evetech.net/characters/${char.character_id}/portrait?size=${MOUSEOVER_CARD_AVATAR_SIZE_PX}"
                 alt="${char.character_name}" class="mouseover-card-avatar" loading="lazy">
            <div class="mouseover-card-name">
              <span>${char.character_name}</span>
            </div>
          </div>
        `).join('')}
        ${characters.length > maxItems ? `<div class="mouseover-card-more">... and ${characters.length - maxItems} more characters</div>` : ''}
      </div>
    `;
    }

    card.innerHTML = content;
    return card;
}

// Optimized updateElementContent function
export function updateElementContent(element, character, viewType) {
    // Cache DOM queries for better performance
    const avatar = element.querySelector('.character-avatar');
    const characterLink = element.querySelector('.character-name a');
    const corpLogo = element.querySelector('.corp-alliance-info .org-logo');
    const corpLink = element.querySelector('.corp-alliance-info .character-link');

    // Batch DOM updates
    if (avatar) {
        avatar.alt = character.character_name;
        const newAvatarSrc = `https://images.evetech.net/characters/${character.character_id}/portrait?size=${CHARACTER_PORTRAIT_SIZE_PX}`;
        if (avatar.dataset.src !== newAvatarSrc) {
            avatar.dataset.src = newAvatarSrc;
            if (document.contains(avatar)) {
                observerManager.observeImage(avatar);
            }
        }
    }

    if (characterLink) {
        characterLink.textContent = character.character_name;
        characterLink.href = `https://zkillboard.com/character/${character.character_id}/`;
    }

    if (corpLogo) {
        corpLogo.alt = character.corporation_name;
        const newCorpSrc = `https://images.evetech.net/corporations/${character.corporation_id}/logo?size=${CORP_LOGO_SIZE_PX}`;
        if (corpLogo.dataset.src !== newCorpSrc) {
            corpLogo.dataset.src = newCorpSrc;
            if (document.contains(corpLogo)) {
                observerManager.observeImage(corpLogo);
            }
        }
    }

    if (corpLink) {
        corpLink.textContent = character.corporation_name;
        corpLink.href = `https://zkillboard.com/corporation/${character.corporation_id}/`;
    }

    // Handle alliance info efficiently
    const corpAllianceInfo = element.querySelector('.corp-alliance-info');
    let allianceSection = element.querySelector('.org-item:last-child');
    const isAllianceSection = allianceSection && allianceSection.querySelector('a[href*="/alliance/"]');

    if (character.alliance_name && character.alliance_id) {
        if (!isAllianceSection) {
            // Create alliance section using document fragment
            const fragment = document.createDocumentFragment();
            const newAllianceSection = document.createElement('div');
            newAllianceSection.className = 'org-item';
            newAllianceSection.innerHTML = `
                <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E%3C/svg%3E" 
                     data-src="https://images.evetech.net/alliances/${character.alliance_id}/logo?size=${ALLIANCE_LOGO_SIZE_PX}"
                     alt="${character.alliance_name}" 
                     class="org-logo" 
                     loading="lazy" 
                     decoding="async">
                <a href="https://zkillboard.com/alliance/${character.alliance_id}/" 
                   target="_blank" 
                   class="character-link">${character.alliance_name}</a>
            `;
            fragment.appendChild(newAllianceSection);
            corpAllianceInfo.appendChild(fragment);

            const allianceLogo = newAllianceSection.querySelector('.org-logo');
            if (document.contains(allianceLogo)) {
                observerManager.observeImage(allianceLogo);
            }
        } else {
            // Update existing alliance section
            const allianceLogo = allianceSection.querySelector('.org-logo');
            const allianceLink = allianceSection.querySelector('.character-link');

            if (allianceLogo) {
                allianceLogo.alt = character.alliance_name;
                const newAllianceSrc = `https://images.evetech.net/alliances/${character.alliance_id}/logo?size=${ALLIANCE_LOGO_SIZE_PX}`;
                if (allianceLogo.dataset.src !== newAllianceSrc) {
                    allianceLogo.dataset.src = newAllianceSrc;
                    if (document.contains(allianceLogo)) {
                        observerManager.observeImage(allianceLogo);
                    }
                }
            }

            if (allianceLink) {
                allianceLink.textContent = character.alliance_name;
                allianceLink.href = `https://zkillboard.com/alliance/${character.alliance_id}/`;
            }
        }
    } else {
        // Remove alliance section if character has no alliance
        if (isAllianceSection) {
            allianceSection.remove();
        }
    }
}

export function createCharacterItem(character, viewType = 'grid') {
    // Create element using createDocumentFragment for better performance
    const template = document.createElement('template');
    const placeholder = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E%3C/svg%3E";

    // Sanitize character data
    const characterId = sanitizeId(character.character_id);
    const characterName = sanitizeCharacterName(character.character_name);
    const corporationId = sanitizeId(character.corporation_id);
    const corporationName = sanitizeCorporationName(character.corporation_name);
    const allianceId = character.alliance_id ? sanitizeId(character.alliance_id) : null;
    const allianceName = character.alliance_name ? sanitizeAllianceName(character.alliance_name) : null;

    const allianceSection = allianceName && allianceId ? `
        <div class="org-item">
            <img src="${placeholder}"
                 data-src="https://images.evetech.net/alliances/${allianceId}/logo?size=${ALLIANCE_LOGO_SIZE_PX}"
                 alt="${sanitizeAttribute(allianceName)}"
                 class="org-logo"
                 loading="lazy"
                 decoding="async">
            <a href="https://zkillboard.com/alliance/${allianceId}/"
               target="_blank"
               class="character-link">${allianceName}</a>
        </div>
    ` : '';

    const warEligibleBadge = character.war_eligible ?
        '<span class="war-eligible-badge">WAR</span>' : '';

    template.innerHTML = `
    <div class="result-item ${viewType}-view animate-ready ${character.war_eligible ? 'war-eligible' : ''}"
         data-character-id="${sanitizeAttribute(characterId.toString())}"
         data-clickable="character"
         style="cursor: pointer;">
            <img src="${placeholder}"
                 data-src="https://images.evetech.net/characters/${characterId}/portrait?size=${CHARACTER_PORTRAIT_SIZE_PX}"
                 alt="${sanitizeAttribute(characterName)}"
                 class="character-avatar"
                 loading="lazy"
                 decoding="async">
            <div class="character-content">
                <div class="character-name">
                    <a href="https://zkillboard.com/character/${characterId}/"
                       target="_blank"
                       class="character-link">${characterName}</a>
                    ${warEligibleBadge}
                </div>
                <div class="character-details">
                    <div class="corp-alliance-info">
                        <div class="org-item">
                            <img src="${placeholder}"
                                 data-src="https://images.evetech.net/corporations/${corporationId}/logo?size=${CORP_LOGO_SIZE_PX}"
                                 alt="${sanitizeAttribute(corporationName)}"
                                 class="org-logo"
                                 loading="lazy"
                                 decoding="async">
                            <a href="https://zkillboard.com/corporation/${corporationId}/"
                               target="_blank"
                               class="character-link">${corporationName}</a>
                        </div>
                        ${allianceSection}
                    </div>
                </div>
            </div>
        </div>
    `;

    return template.content.firstElementChild;
}

export function createSummaryItem({ id, name, count, type, war_eligible }) {
    // Sanitize input data
    const sanitizedId = sanitizeId(id);
    const sanitizedName = type === 'corporation' ? sanitizeCorporationName(name) : sanitizeAllianceName(name);
    const sanitizedCount = Math.max(0, Math.floor(count || 0));
    const allowedTypes = ['corporation', 'alliance'];
    const sanitizedType = allowedTypes.includes(type) ? type : 'corporation';

    const item = document.createElement("div");
    item.className = `summary-item ${war_eligible ? 'war-eligible' : ''}`;

    // zkill implementation with sanitized data
    item.dataset.clickable = sanitizedType;
    item.dataset.entityId = sanitizeAttribute(sanitizedId.toString());
    item.dataset.entityName = sanitizeAttribute(sanitizedName);
    item.style.cursor = 'pointer';

    const logo = document.createElement("img");
    logo.className = "summary-logo";
    logo.alt = sanitizeAttribute(sanitizedName);
    logo.loading = "lazy";
    logo.decoding = "async";

    const placeholder = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E%3C/svg%3E";
    logo.src = placeholder;
    logo.dataset.src = `https://images.evetech.net/${sanitizedType}s/${sanitizedId}/logo?size=32`;

    item.appendChild(logo);

    const content = document.createElement("div");
    content.className = "summary-content";

    const nameDiv = document.createElement("div");
    nameDiv.className = "summary-name";
    const warBadge = war_eligible ? '<span class="war-eligible-badge summary-war-badge">WAR</span>' : '';
    nameDiv.innerHTML = `<a href="https://zkillboard.com/${sanitizedType}/${sanitizedId}/" target="_blank" class="character-link">${sanitizedName}</a> ${warBadge}`;
    content.appendChild(nameDiv);

    const countDiv = document.createElement("div");
    countDiv.className = "summary-count";
    countDiv.textContent = sanitizedCount;
    content.appendChild(countDiv);

    item.appendChild(content);
    item.appendChild(createMouseoverCard({ id: sanitizedId, name: sanitizedName, count: sanitizedCount, war_eligible }, sanitizedType));

    // FIXED: Observe the logo image after it's in the DOM structure
    requestAnimationFrame(() => {
        observerManager.observeImage(logo);
    });

    return item;
}

// Optimized renderGrid function using document fragments
export function renderGrid(containerId, items, type = 'character', limit = null) {
    const container = document.getElementById(containerId);

    if (type === 'character') {
        const itemsToShow = limit ? items.slice(0, limit) : items;

        if (itemsToShow.length === 0) {
            container.innerHTML = `
                <div class="no-results">
                    <div class="no-results-icon">🔍</div>
                    <div class="no-results-text">No results found</div>
                </div>
            `;
            return;
        }

        // Use virtual scrolling for better performance
        setupVirtualScrolling(containerId, itemsToShow);

    } else {
        if (items.length === 0) {
            container.innerHTML = `
                <div class="no-summary">
                    <div class="no-results-icon">📊</div>
                    <div class="no-results-text">No ${type}s found</div>
                </div>
            `;
            return;
        }

        // Use document fragment for batch DOM operations
        const fragment = document.createDocumentFragment();

        // Create all items in memory first
        const elements = items.map(item => createSummaryItem(item));

        // Add all elements to fragment
        elements.forEach(element => fragment.appendChild(element));

        // Single DOM update
        container.innerHTML = "";
        container.appendChild(fragment);
    }
}

// Virtual scrolling configuration constants
const VIRTUAL_SCROLL_CONFIG = {
    CONTAINER_HEIGHT: '60vh',
    MIN_HEIGHT: '300px',
    MAX_HEIGHT: '600px',
    BUFFER_SIZE: 5,
    GRID_GAP: '1.35rem',
    CONTENT_PADDING: '1.8rem',
    MIN_ITEM_WIDTH: 252,
    CONTAINER_MIN_WIDTH: 270,
    CONTAINER_PADDING: 60
};

const VIEW_DIMENSIONS = {
    list: { height: 90, itemsPerRow: 1 },
    grid: { height: 150, itemsPerRow: null } // calculated dynamically
};

/**
 * Virtual scrolling implementation for performance with large lists
 */
export function setupVirtualScrolling(containerId, items) {
    const container = document.getElementById(containerId);
    if (!validateScrollingPreconditions(container, items, containerId)) {
        return;
    }

    const scrollInstance = new VirtualScrollManager(container, items);
    scrollInstance.initialize();
}

/**
 * Validates preconditions for virtual scrolling setup
 */
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

/**
 * Manages virtual scrolling for a single container
 */
class VirtualScrollManager {
    constructor(container, items) {
        this.container = container;
        this.items = items;
        this.parentGrid = this.findParentGrid();

        // Calculated properties
        this.viewConfig = this.calculateViewConfig();
        this.dimensions = this.calculateDimensions();

        // State management
        this.renderedElements = new Map();
        this.visibleRange = { start: -1, end: -1 };
        this.isUpdating = false;
        this.animationFrame = null;
        this.scrollTimeout = null;
        this.lastScrollTime = 0;

        // DOM elements (will be created during initialization)
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
        const isListView = getCurrentView() === 'list';
        const baseConfig = VIEW_DIMENSIONS[isListView ? 'list' : 'grid'];

        if (isListView) {
            return baseConfig;
        }

        // Calculate items per row for grid view
        const containerWidth = Math.max(
            VIRTUAL_SCROLL_CONFIG.CONTAINER_MIN_WIDTH,
            this.parentGrid.clientWidth - VIRTUAL_SCROLL_CONFIG.CONTAINER_PADDING
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
        const isListView = getCurrentView() === 'list';

        content.className = `virtual-scroll-content ${isListView ? 'list-view' : ''}`;

        Object.assign(content.style, {
            position: 'absolute',
            top: '0',
            left: '0',
            right: '0',
            display: 'grid',
            gap: VIRTUAL_SCROLL_CONFIG.GRID_GAP,
            padding: VIRTUAL_SCROLL_CONFIG.CONTENT_PADDING,
            gridTemplateColumns: isListView
                ? '1fr'
                : `repeat(auto-fill, minmax(${VIRTUAL_SCROLL_CONFIG.MIN_ITEM_WIDTH}px, 1fr))`
        });

        return content;
    }

    attachEventListeners() {
        this.scrollListener = this.createScrollHandler();
        this.container.addEventListener('scroll', this.scrollListener, { passive: true });
        this.container._scrollListener = this.scrollListener;
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

        // Only update if range actually changed
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
        const endRow = Math.min(this.dimensions.totalRows,
            Math.ceil((scrollTop + containerHeight) / this.dimensions.itemHeight) + VIRTUAL_SCROLL_CONFIG.BUFFER_SIZE);

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
            element = this.createElement(index);
            this.renderedElements.set(index, element);
            this.content.appendChild(element);
            this.observeElement(element);
        } else {
            this.showExistingElement(element);
        }
    }

    createElement(index) {
        const isListView = getCurrentView() === 'list';
        const element = createCharacterItem(this.items[index], isListView ? 'list' : 'grid');

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
    }

    cleanupObservers() {
        this.renderedElements.forEach(element => {
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
        });
    }

    resetContainerState() {
        this.parentGrid?.classList?.remove('virtual-enabled');

        if (this.container) {
            this.container.className = this.container.className
                .replace('virtual-scroll-container', '').trim() || 'result-grid';

            // Reset styles
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

        // Clear object references
        this.container = null;
        this.items = null;
        this.parentGrid = null;
        this.spacer = null;
        this.content = null;
    }
}

// Add scroll state detection to reduce operations during active scrolling
export function addScrollStateDetection() {
    let scrollTimeout;

    document.addEventListener('scroll', (e) => {
        if (e.target && e.target.classList && e.target.classList.contains('virtual-scroll-container')) {
            e.target.classList.add('scrolling');
            setImageObserverEnabled(false); // Pause image loading during scroll

            clearTimeout(scrollTimeout);
            scrollTimeout = setTimeout(() => {
                e.target.classList.remove('scrolling');
                setImageObserverEnabled(true); // Resume image loading
            }, SCROLL_STATE_TIMEOUT_MS);
        }
    }, { passive: true, capture: true });
}

// Export observer manager for cleanup
export function getObserverManager() {
    return observerManager;
}

// Helper function to get current view (needs to be imported from app state)
function getCurrentView() {
    // This will be set by the main app
    return window.currentView || 'grid';
}
export function getEntityMaps() {
    return {
        corpToCharactersMap,
        allianceToCorpsMap
    };
}