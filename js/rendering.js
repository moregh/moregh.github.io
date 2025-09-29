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
    ANIMATION_FRAME_THROTTLE_FPS,
    POPUP_SHOW_DELAY
} from './config.js';
import { ManagedObservers, setImageObserverEnabled } from './observers.js';
import {
    sanitizeId,
    sanitizeAttribute
} from './xss-protection.js';

// Create single observer instance
const observerManager = new ManagedObservers();

// Centralized Event Management System
class EventManager {
    constructor() {
        this.delegatedListeners = new Map();
        this.init();
    }

    init() {
        // Use event delegation for mouseover cards
        document.addEventListener('mouseenter', this.handleMouseEnter.bind(this), true);
        document.addEventListener('mouseleave', this.handleMouseLeave.bind(this), true);
    }

    handleMouseEnter(event) {
        const entityCard = event.target.closest('.entity-card, .summary-item');
        if (entityCard && entityCard._mouseoverCard) {
            this.showMouseoverCard(entityCard);
        }

        const mouseoverCard = event.target.closest('.mouseover-card');
        if (mouseoverCard) {
            mouseoverCard.classList.add('visible');
        }
    }

    handleMouseLeave(event) {
        const entityCard = event.target.closest('.entity-card, .summary-item');
        if (entityCard && entityCard._mouseoverCard) {
            this.hideMouseoverCard(entityCard);
        }

        const mouseoverCard = event.target.closest('.mouseover-card');
        if (mouseoverCard) {
            setTimeout(() => {
                if (!mouseoverCard.matches(':hover')) {
                    mouseoverCard.classList.remove('visible');
                }
            }, 10);
        }
    }

    showMouseoverCard(item) {
        const card = item._mouseoverCard;
        if (!card) return;

        // Clear any existing timeout
        if (item._showTimeout) {
            clearTimeout(item._showTimeout);
        }

        // Add delay before showing popup to prevent flashing during scrolling
        item._showTimeout = setTimeout(() => {
            // Check if mouse is still over the item
            if (item.matches(':hover')) {
                // Hide all other visible popup cards first
                const allCards = document.querySelectorAll('.mouseover-card.visible');
                allCards.forEach(otherCard => {
                    if (otherCard !== card) {
                        otherCard.classList.remove('visible');
                    }
                });

                this.positionMouseoverCard(item, card);
                card.classList.add('visible');
            }
            item._showTimeout = null;
        }, POPUP_SHOW_DELAY);
    }

    hideMouseoverCard(item) {
        const card = item._mouseoverCard;

        // Clear the show timeout if mouse leaves before delay completes
        if (item._showTimeout) {
            clearTimeout(item._showTimeout);
            item._showTimeout = null;
        }

        if (card) {
            // Only hide the card if we're not moving to the card itself
            setTimeout(() => {
                if (!card.matches(':hover')) {
                    card.classList.remove('visible');
                }
            }, 10);
        }
    }

    positionMouseoverCard(item, card) {
        const itemRect = item.getBoundingClientRect();
        const parentContainer = item.closest('.summary-column') || item.closest('.tab-content') || item.closest('.result-grid');
        const containerRect = parentContainer.getBoundingClientRect();

        // Position card relative to the parent container (85% from the top)
        const relativeTop = itemRect.top - containerRect.top + (itemRect.height * 0.85);
        const relativeLeft = itemRect.left - containerRect.left + (itemRect.width / 2);

        card.style.position = 'absolute';
        card.style.top = relativeTop + 'px';
        card.style.left = relativeLeft + 'px';
        card.style.transform = 'translateX(-50%)';
    }

    cleanup() {
        // Clear all timeouts
        document.querySelectorAll('.entity-card, .summary-item').forEach(item => {
            if (item._showTimeout) {
                clearTimeout(item._showTimeout);
                item._showTimeout = null;
            }
        });
    }
}

// Create global event manager
const eventManager = new EventManager();

// DOM Element Pooling System for Performance
class ElementPool {
    constructor(createFn, resetFn, maxSize = 50) {
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

    clear() {
        this.pool = [];
    }

    getStats() {
        return { created: this.created, reused: this.reused, pooled: this.pool.length };
    }
}

// Element pools for different types
let characterElementPool;
let entityCardPool;
let mouseoverCardPool;

// Initialize pools
function initializeElementPools() {
    characterElementPool = new ElementPool(
        () => createBaseCharacterElement(),
        (element) => resetCharacterElement(element)
    );

    entityCardPool = new ElementPool(
        () => createBaseEntityCardElement(),
        (element) => resetEntityCardElement(element)
    );

    mouseoverCardPool = new ElementPool(
        () => createBaseMouseoverCardElement(),
        (element) => resetMouseoverCardElement(element)
    );
}

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

// Base element creation functions for pooling
function createBaseCharacterElement() {
    const template = document.createElement('template');
    const placeholder = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E%3C/svg%3E";

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
    const placeholder = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='64'%3E%3C/svg%3E";

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

function createBaseMouseoverCardElement() {
    const div = document.createElement("div");
    div.className = "mouseover-card";
    return div;
}

// Reset functions for pooling
function resetCharacterElement(element) {
    if (!element) return;

    // Clear dynamic classes
    element.className = "result-item grid-view animate-ready";
    element.dataset.characterId = "";
    element.style.cssText = "cursor: pointer;";

    // Clear images
    const images = element.querySelectorAll('img');
    images.forEach(img => {
        img.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E%3C/svg%3E";
        img.dataset.src = "";
        img.alt = "";
    });

    // Clear links
    const links = element.querySelectorAll('a');
    links.forEach(link => {
        link.href = "#";
        link.textContent = "";
    });

    // Remove alliance section if it exists
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
    element.style.cssText = "cursor: pointer;";

    // Clear entity logo
    const logo = element.querySelector('.entity-logo');
    if (logo) {
        logo.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='64'%3E%3C/svg%3E";
        logo.dataset.src = "";
        logo.alt = "";
    }

    // Clear text content
    const typeIcon = element.querySelector('.entity-type-icon');
    const link = element.querySelector('.character-link');
    const countNumber = element.querySelector('.count-number');
    const countLabel = element.querySelector('.count-label');

    if (typeIcon) typeIcon.textContent = "";
    if (link) { link.href = "#"; link.textContent = ""; }
    if (countNumber) countNumber.textContent = "";
    if (countLabel) countLabel.textContent = "";

    // Remove mouseover card reference
    delete element._mouseoverCard;
}

function resetMouseoverCardElement(element) {
    if (!element) return;
    element.className = "mouseover-card";
    element.innerHTML = "";
    element.style.cssText = "";
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
export function updateElementContent(element, character) {
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
    // Initialize pools if not already done
    if (!characterElementPool) {
        initializeElementPools();
    }

    // Get element from pool
    const element = characterElementPool.acquire();

    // Sanitize IDs but keep names unescaped for textContent usage
    const characterId = sanitizeId(character.character_id);
    const characterName = character.character_name; // Don't sanitize - textContent is safe
    const corporationId = sanitizeId(character.corporation_id);
    const corporationName = character.corporation_name; // Don't sanitize - textContent is safe
    const allianceId = character.alliance_id ? sanitizeId(character.alliance_id) : null;
    const allianceName = character.alliance_name; // Don't sanitize - textContent is safe

    // Update element classes and attributes
    element.className = `result-item ${viewType}-view animate-ready ${character.war_eligible ? 'war-eligible' : ''}`;
    element.dataset.characterId = sanitizeAttribute(characterId.toString());

    // Update character avatar and name
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

    // Update war eligible badge
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

    // Update corporation info
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

    // Handle alliance info
    const corpAllianceInfo = element.querySelector('.corp-alliance-info');
    let allianceItem = corpAllianceInfo.querySelector('.org-item:last-child');
    const isAllianceItem = allianceItem && allianceItem !== corpAllianceInfo.querySelector('.corp-item');

    if (allianceName && allianceId) {
        if (!isAllianceItem) {
            // Create alliance section
            const newAllianceItem = document.createElement('div');
            newAllianceItem.className = 'org-item';
            newAllianceItem.innerHTML = `
                <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E%3C/svg%3E"
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
            // Update existing alliance section
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
        // Remove alliance section if character has no alliance
        allianceItem.remove();
    }

    return element;
}

// Function to release elements back to the pool
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

// Get pool stats for debugging
export function getPoolStats() {
    return {
        character: characterElementPool?.getStats() || { created: 0, reused: 0, pooled: 0 },
        entity: entityCardPool?.getStats() || { created: 0, reused: 0, pooled: 0 },
        mouseover: mouseoverCardPool?.getStats() || { created: 0, reused: 0, pooled: 0 }
    };
}

export function createEntityCard({ id, name, count, type, war_eligible }) {
    // Sanitize input data
    const sanitizedId = sanitizeId(id);
    const sanitizedName = name; // Don't escape the name for display
    const sanitizedCount = Math.max(0, Math.floor(count || 0));
    const allowedTypes = ['corporation', 'alliance'];
    const sanitizedType = allowedTypes.includes(type) ? type : 'corporation';

    // Create element using template for better performance
    const template = document.createElement('template');
    const placeholder = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='64'%3E%3C/svg%3E";

    const warEligibleBadge = war_eligible ?
        '<span class="war-eligible-badge">WAR</span>' : '';

    const entityIcon = sanitizedType === 'alliance' ? '🏛️' : '🏢';
    const logoSize = 64; // Larger logo for card format

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
                            <span class="count-number">${sanitizedCount}</span>
                            <span class="count-label">${sanitizedCount === 1 ? 'Member' : 'Members'}</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    const item = template.content.firstElementChild;

    // Set the entity name safely using textContent
    const nameLink = item.querySelector('.character-link');
    if (nameLink) {
        nameLink.textContent = name; // Use original unsanitized name
    }

    // Create mouseover card but don't append it to the item
    const mouseoverCard = createMouseoverCard({ id: sanitizedId, name: name, count: sanitizedCount, war_eligible }, sanitizedType);

    // Store reference to the card on the item for later use
    item._mouseoverCard = mouseoverCard;

    // Event handling is now managed by the centralized EventManager
    // No individual event listeners needed - better performance!

    // FIXED: Observe the entity logo image after it's in the DOM structure
    requestAnimationFrame(() => {
        const entityLogo = item.querySelector('.entity-logo');
        if (entityLogo) {
            observerManager.observeImage(entityLogo);
        }
    });

    return item;
}

export function createSummaryItem({ id, name, count, type, war_eligible }) {
    // Keep the old function for backward compatibility if needed elsewhere
    // This creates the original horizontal list-style items
    const sanitizedId = sanitizeId(id);
    const sanitizedName = name; // Don't escape the name for display
    const sanitizedCount = Math.max(0, Math.floor(count || 0));
    const allowedTypes = ['corporation', 'alliance'];
    const sanitizedType = allowedTypes.includes(type) ? type : 'corporation';

    const item = document.createElement("div");
    item.className = `summary-item ${war_eligible ? 'war-eligible' : ''}`;

    // zkill implementation with sanitized data
    item.dataset.clickable = sanitizedType;
    item.dataset.entityId = sanitizeAttribute(sanitizedId.toString());
    item.dataset.entityName = name;
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
    // Create link element
    const link = document.createElement('a');
    link.href = `https://zkillboard.com/${sanitizedType}/${sanitizedId}/`;
    link.target = '_blank';
    link.className = 'character-link';
    link.textContent = name; // Use original name, not sanitized
    nameDiv.appendChild(link);

    // Add war badge if needed
    if (war_eligible) {
        const warBadge = document.createElement('span');
        warBadge.className = 'war-eligible-badge summary-war-badge';
        warBadge.textContent = 'WAR';
        nameDiv.appendChild(document.createTextNode(' '));
        nameDiv.appendChild(warBadge);
    }
    content.appendChild(nameDiv);

    const countDiv = document.createElement("div");
    countDiv.className = "summary-count";
    countDiv.textContent = sanitizedCount;
    content.appendChild(countDiv);

    item.appendChild(content);

    // Create mouseover card but don't append it to the item
    const mouseoverCard = createMouseoverCard({ id: sanitizedId, name: name, count: sanitizedCount, war_eligible }, sanitizedType);

    // Store reference to the card on the item for later use
    item._mouseoverCard = mouseoverCard;

    // Event handling is now managed by the centralized EventManager
    // No individual event listeners needed - better performance!

    // FIXED: Observe the logo image after it's in the DOM structure
    requestAnimationFrame(() => {
        observerManager.observeImage(logo);
    });

    return item;
}

// Optimized renderGrid function using document fragments
export function renderGrid(containerId, items, type = 'character') {
    const container = document.getElementById(containerId);

    if (type === 'character') {
        if (items.length === 0) {
            container.innerHTML = `
                <div class="no-results">
                    <div class="no-results-icon">🔍</div>
                    <div class="no-results-text">No results found</div>
                </div>
            `;
            return;
        }

        // Use virtual scrolling for better performance
        setupVirtualScrolling(containerId, items);

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

        // Use virtual scrolling for corporations and alliances too
        setupEntityScrolling(containerId, items, type);
    }
}

// Virtual scrolling configuration constants
const VIRTUAL_SCROLL_CONFIG = {
    CONTAINER_HEIGHT: '75vh',
    MIN_HEIGHT: '720px',
    MAX_HEIGHT: '900px',
    BUFFER_SIZE: 5, // Increased to ensure smooth scrolling and full initial render
    GRID_GAP: '1.35rem',
    CONTENT_PADDING: '1.8rem',
    MIN_ITEM_WIDTH: 252,
    CONTAINER_MIN_WIDTH: 270,
    CONTAINER_PADDING: 60,
    // Performance optimization constants
    SCROLL_DEBOUNCE_MS: 8,
    MAX_RENDERED_ELEMENTS: 200, // Limit total rendered elements
    MIN_INITIAL_ROWS: 6 // Ensure at least 6 rows rendered initially (4 visible + 2 buffer)
};

const VIEW_DIMENSIONS = {
    list: { height: 90, itemsPerRow: 1 },
    grid: { height: 150, itemsPerRow: null } // calculated dynamically
};

/**
 * Setup scrolling for entity cards (corporations and alliances)
 */
export function setupEntityScrolling(containerId, items, type) {
    const container = document.getElementById(containerId);
    if (!validateScrollingPreconditions(container, items, containerId)) {
        return;
    }

    // Clean up previous results first
    getObserverManager().cleanupDeadElements();

    // Find parent grid and apply same classes as virtual scrolling
    const parentGrid = container.closest('.result-grid') || container.parentElement;
    if (parentGrid) {
        parentGrid.classList.add('virtual-enabled');
    }

    // Apply same container styling as virtual scrolling
    Object.assign(container.style, {
        height: VIRTUAL_SCROLL_CONFIG.CONTAINER_HEIGHT,
        minHeight: VIRTUAL_SCROLL_CONFIG.MIN_HEIGHT,
        maxHeight: VIRTUAL_SCROLL_CONFIG.MAX_HEIGHT,
        overflowY: 'auto',
        position: 'relative'
    });

    container.className = 'virtual-scroll-container';

    // Create the same DOM structure as virtual scrolling
    const spacer = document.createElement('div');
    spacer.className = 'virtual-scroll-spacer';

    const content = document.createElement('div');
    content.className = 'virtual-scroll-content';

    // Use appropriate grid configuration for entity type
    const minWidth = type === 'alliance' || type === 'corporation' ? '300px' : '252px';
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


    // Create all items in memory first using the new card format
    const elements = items.map(item => createEntityCard(item));

    // Add all elements to content
    elements.forEach(element => content.appendChild(element));

    // Set spacer height to accommodate all content
    const itemHeight = 150; // Approximate height per item for entities
    const itemsPerRow = Math.max(1, Math.floor((container.clientWidth - 60) / 300));
    const totalRows = Math.ceil(elements.length / itemsPerRow);
    spacer.style.height = `${totalRows * itemHeight}px`;

    // Assemble the structure
    spacer.appendChild(content);

    // Single DOM update
    container.innerHTML = "";
    container.appendChild(spacer);

    // Now append all mouseover cards to the appropriate parent container
    const summaryColumn = container.closest('.summary-column');
    const tabContent = container.closest('.tab-content');
    const parentContainer = summaryColumn || tabContent || container.parentElement;

    if (parentContainer) {
        elements.forEach(element => {
            if (element._mouseoverCard) {
                parentContainer.appendChild(element._mouseoverCard);
            }
        });
    }

    // Observe images for lazy loading
    requestAnimationFrame(() => {
        const images = container.querySelectorAll('img[data-src]');
        images.forEach(img => getObserverManager().observeImage(img));

        elements.forEach(element => {
            getObserverManager().observeAnimation(element);
        });
    });
}

/**
 * Virtual scrolling implementation for performance with large lists
 */
export function setupVirtualScrolling(containerId, items) {
    const container = document.getElementById(containerId);
    if (!validateScrollingPreconditions(container, items, containerId)) {
        return;
    }

    // Use requestAnimationFrame to ensure DOM is ready and dimensions are calculated
    requestAnimationFrame(() => {
        // Double RAF to ensure layout is complete
        requestAnimationFrame(() => {
            const scrollInstance = new VirtualScrollManager(container, items);
            scrollInstance.initialize();
        });
    });
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
        // Add fallback for when parentGrid.clientWidth is 0 (DOM not ready)
        let parentWidth = this.parentGrid.clientWidth;
        if (parentWidth === 0) {
            // Fallback: try to get computed width or use a reasonable default
            const computedStyle = window.getComputedStyle(this.parentGrid);
            parentWidth = parseInt(computedStyle.width) || 800; // fallback to 800px
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

        // Add resize listener to recalculate dimensions when needed
        this.resizeListener = () => {
            // Recalculate configuration if container dimensions changed
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
        let endRow = Math.min(this.dimensions.totalRows,
            Math.ceil((scrollTop + containerHeight) / this.dimensions.itemHeight) + VIRTUAL_SCROLL_CONFIG.BUFFER_SIZE);

        // Ensure we render at least MIN_INITIAL_ROWS on initial load
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
            // Limit total rendered elements to prevent memory bloat
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
        // Remove elements that are far from the current view
        const scrollTop = this.container.scrollTop;
        const containerHeight = this.container.clientHeight;
        const currentCenterRow = Math.floor((scrollTop + containerHeight / 2) / this.dimensions.itemHeight);
        const keepDistance = VIRTUAL_SCROLL_CONFIG.BUFFER_SIZE * 3; // Keep elements within 3x buffer distance

        const elementsToRemove = [];
        for (const [index] of this.renderedElements) {
            const elementRow = Math.floor(index / this.dimensions.itemsPerRow);
            if (Math.abs(elementRow - currentCenterRow) > keepDistance) {
                elementsToRemove.push(index);
            }
        }

        // Remove oldest elements first
        elementsToRemove.slice(0, Math.max(20, elementsToRemove.length / 4)).forEach(index => {
            const element = this.renderedElements.get(index);
            if (element) {
                // Clean up observers
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

                // Release to pool and remove from DOM
                releaseElementToPool(element);
                this.renderedElements.delete(index);
            }
        });
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
        if (this.container._resizeListener) {
            window.removeEventListener('resize', this.container._resizeListener);
            delete this.container._resizeListener;
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

            // Release element back to pool
            releaseElementToPool(element);
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

// Export event manager cleanup function
export function cleanupEventListeners() {
    eventManager.cleanup();
}