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
        if (character.war_eligible && character.corporation_id) {
            if (!corpToCharactersMap.has(character.corporation_id)) {
                corpToCharactersMap.set(character.corporation_id, []);
            }
            corpToCharactersMap.get(character.corporation_id).push(character);
        }
    });

    // Build alliance to corps map
    const corpsByAlliance = new Map();
    results.forEach(character => {
        if (character.war_eligible && character.alliance_id && character.corporation_id) {
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
          <div class="mouseover-card-item">
            <img src="https://images.evetech.net/corporations/${corp.id}/logo?size=${CORP_LOGO_SIZE_PX}" 
                 alt="${corp.name}" class="mouseover-card-avatar" loading="lazy">
            <div class="mouseover-card-name">
              <a href="https://zkillboard.com/corporation/${corp.id}/" target="_blank">${corp.name}</a>
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
          <div class="mouseover-card-item">
            <img src="https://images.evetech.net/characters/${char.character_id}/portrait?size=${MOUSEOVER_CARD_AVATAR_SIZE_PX}" 
                 alt="${char.character_name}" class="mouseover-card-avatar" loading="lazy">
            <div class="mouseover-card-name">
              <a href="https://zkillboard.com/character/${char.character_id}/" target="_blank">${char.character_name}</a>
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

    const allianceSection = character.alliance_name && character.alliance_id ? `
        <div class="org-item">
            <img src="${placeholder}" 
                 data-src="https://images.evetech.net/alliances/${character.alliance_id}/logo?size=${ALLIANCE_LOGO_SIZE_PX}"
                 alt="${character.alliance_name}" 
                 class="org-logo" 
                 loading="lazy" 
                 decoding="async">
            <a href="https://zkillboard.com/alliance/${character.alliance_id}/" 
               target="_blank" 
               class="character-link">${character.alliance_name}</a>
        </div>
    ` : '';

    template.innerHTML = `
        <div class="result-item ${viewType}-view animate-ready" data-character-id="${character.character_id}">
            <img src="${placeholder}" 
                 data-src="https://images.evetech.net/characters/${character.character_id}/portrait?size=${CHARACTER_PORTRAIT_SIZE_PX}"
                 alt="${character.character_name}" 
                 class="character-avatar" 
                 loading="lazy" 
                 decoding="async">
            <div class="character-content">
                <div class="character-name">
                    <a href="https://zkillboard.com/character/${character.character_id}/" 
                       target="_blank" 
                       class="character-link">${character.character_name}</a>
                </div>
                <div class="character-details">
                    <div class="corp-alliance-info">
                        <div class="org-item">
                            <img src="${placeholder}" 
                                 data-src="https://images.evetech.net/corporations/${character.corporation_id}/logo?size=${CORP_LOGO_SIZE_PX}"
                                 alt="${character.corporation_name}" 
                                 class="org-logo" 
                                 loading="lazy" 
                                 decoding="async">
                            <a href="https://zkillboard.com/corporation/${character.corporation_id}/" 
                               target="_blank" 
                               class="character-link">${character.corporation_name}</a>
                        </div>
                        ${allianceSection}
                    </div>
                </div>
            </div>
        </div>
    `;

    return template.content.firstElementChild;
}

export function createSummaryItem({ id, name, count, type }) {
    const item = document.createElement("div");
    item.className = "summary-item";

    const logo = document.createElement("img");
    logo.className = "summary-logo";
    logo.alt = name;
    logo.loading = "lazy";
    logo.decoding = "async";

    const placeholder = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E%3C/svg%3E";
    logo.src = placeholder;
    logo.dataset.src = `https://images.evetech.net/${type}s/${id}/logo?size=32`;

    item.appendChild(logo);

    const content = document.createElement("div");
    content.className = "summary-content";

    const nameDiv = document.createElement("div");
    nameDiv.className = "summary-name";
    nameDiv.innerHTML = `<a href="https://zkillboard.com/${type}/${id}/" target="_blank" class="character-link">${name}</a>`;
    content.appendChild(nameDiv);

    const countDiv = document.createElement("div");
    countDiv.className = "summary-count";
    countDiv.textContent = count;
    content.appendChild(countDiv);

    item.appendChild(content);
    item.appendChild(createMouseoverCard({ id, name, count }, type));

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
                    <div class="no-results-text">No war-eligible ${type}s found</div>
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

// Enhanced virtual scrolling with document fragments and better performance
export function setupVirtualScrolling(containerId, items) {
    const container = document.getElementById(containerId);
    if (!container || !items || items.length === 0) {
        console.warn(`Cannot setup virtual scrolling: container "${containerId}" not found or no items`);
        return;
    }

    let parentGrid = container.closest('.result-grid');
    if (!parentGrid) {
        parentGrid = container.parentElement?.classList?.contains('result-grid') ? container.parentElement : container;
    }

    // Clean up any existing setup
    if (container._cleanup) {
        container._cleanup();
    }

    parentGrid.classList.add('virtual-enabled');

    const isListView = getCurrentView() === 'list';
    const itemHeight = isListView ? 90 : 150;
    const containerWidth = Math.max(270, parentGrid.clientWidth - 60);
    const itemsPerRow = isListView ? 1 : Math.max(1, Math.floor(containerWidth / 270));
    const totalRows = Math.ceil(items.length / itemsPerRow);
    const totalHeight = totalRows * itemHeight;

    // Set up container structure
    container.className = 'virtual-scroll-container';
    container.style.height = '60vh';
    container.style.minHeight = '300px';
    container.style.maxHeight = '600px';
    container.style.overflowY = 'auto';
    container.style.position = 'relative';

    // Create stable structure
    const spacer = document.createElement('div');
    spacer.className = 'virtual-scroll-spacer';
    spacer.style.height = totalHeight + 'px';
    spacer.style.position = 'relative';

    const content = document.createElement('div');
    content.className = `virtual-scroll-content ${isListView ? 'list-view' : ''}`;
    content.style.position = 'absolute';
    content.style.top = '0';
    content.style.left = '0';
    content.style.right = '0';
    content.style.display = 'grid';
    content.style.gap = '1.35rem';
    content.style.padding = '1.8rem';
    content.style.gridTemplateColumns = isListView ? '1fr' : 'repeat(auto-fill, minmax(252px, 1fr))';

    spacer.appendChild(content);
    container.innerHTML = '';
    container.appendChild(spacer);

    // Stable element management
    const renderedElements = new Map(); // Map of index -> DOM element
    const visibleRange = { start: -1, end: -1 };
    let isUpdating = false;
    let animationFrame = null;

    function updateVisibleItems() {
        if (isUpdating || !document.contains(container)) return;

        isUpdating = true;

        if (animationFrame) {
            cancelAnimationFrame(animationFrame);
        }

        const scrollTop = container.scrollTop;
        const containerHeight = container.clientHeight;
        const buffer = 5; // Smaller buffer for stability

        const startRow = Math.max(0, Math.floor(scrollTop / itemHeight) - buffer);
        const endRow = Math.min(totalRows, Math.ceil((scrollTop + containerHeight) / itemHeight) + buffer);
        const startIndex = startRow * itemsPerRow;
        const endIndex = Math.min(items.length, endRow * itemsPerRow);

        // Only update if range actually changed
        if (startIndex === visibleRange.start && endIndex === visibleRange.end) {
            isUpdating = false;
            return;
        }

        animationFrame = requestAnimationFrame(() => {
            if (!document.contains(container)) {
                isUpdating = false;
                return;
            }

            // Remove elements that are no longer visible
            for (const [index, element] of renderedElements) {
                if (index < startIndex || index >= endIndex) {
                    if (element.parentNode) {
                        element.style.display = 'none';
                        // Don't remove from DOM, just hide for stability
                    }
                }
            }

            // Add or show elements that should be visible
            for (let i = startIndex; i < endIndex; i++) {
                if (!items[i]) continue;

                let element = renderedElements.get(i);
                
                if (!element) {
                    // Create new element only if it doesn't exist
                    element = createCharacterItem(items[i], isListView ? 'list' : 'grid');
                    element.style.position = 'relative';
                    element.dataset.index = i;
                    renderedElements.set(i, element);
                    content.appendChild(element);
                    
                    // Observe images in next frame
                    requestAnimationFrame(() => {
                        if (document.contains(element)) {
                            const images = element.querySelectorAll('img[data-src]');
                            images.forEach(img => observerManager.observeImage(img));
                            observerManager.observeAnimation(element);
                        }
                    });
                } else {
                    // Just show existing element
                    element.style.display = '';
                    if (!element.parentNode) {
                        content.appendChild(element);
                    }
                }
            }

            // Update transform for positioning
            const translateY = startRow * itemHeight;
            content.style.transform = `translateY(${translateY}px)`;

            visibleRange.start = startIndex;
            visibleRange.end = endIndex;
            isUpdating = false;
            animationFrame = null;
        });
    }

    // Optimized scroll handler with better throttling
    let scrollTimeout = null;
    let lastScrollTime = 0;

    function onScroll() {
        const now = performance.now();
        
        // Immediate update for smooth scrolling
        if (now - lastScrollTime > ANIMATION_FRAME_THROTTLE_FPS) {
            updateVisibleItems();
            lastScrollTime = now;
        } else {
            // Fallback throttled update
            if (scrollTimeout) clearTimeout(scrollTimeout);
            scrollTimeout = setTimeout(() => {
                updateVisibleItems();
                scrollTimeout = null;
            }, SCROLL_THROTTLE_MS);
        }
    }

    container.addEventListener('scroll', onScroll, { passive: true });
    container._scrollListener = onScroll;

    // Initial render
    updateVisibleItems();

    // Cleanup function
    container._cleanup = () => {
        if (animationFrame) {
            cancelAnimationFrame(animationFrame);
        }
        if (scrollTimeout) {
            clearTimeout(scrollTimeout);
        }
        if (container._scrollListener) {
            container.removeEventListener('scroll', container._scrollListener);
            delete container._scrollListener;
        }

        // Clean up observers
        renderedElements.forEach(element => {
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

        renderedElements.clear();
        parentGrid?.classList?.remove('virtual-enabled');
        
        if (container) {
            container.className = container.className.replace('virtual-scroll-container', '').trim() || 'result-grid';
            container.style.height = '';
            container.style.minHeight = '';
            container.style.maxHeight = '';
            container.style.overflowY = '';
            container.style.position = '';
        }

        delete container._cleanup;
    };
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