/*
    EVE Target Intel - zKillboard Stats Card Component
    
    Copyright (C) 2025 moregh (https://github.com/moregh/)
    Licensed under AGPL License.
*/

import {
    get_zkill_character_stats,
    get_zkill_corporation_stats,
    get_zkill_alliance_stats
} from './zkillboard-api.js';
import {
    CHARACTER_PORTRAIT_SIZE_PX,
    CORP_LOGO_SIZE_PX,
    ALLIANCE_LOGO_SIZE_PX,
    ZKILL_CARD_ANIMATION_DURATION_MS
} from './config.js';
import { getEntityMaps } from './rendering.js';
import { esiClient } from './esi-client.js';
import {
    sanitizeCharacterName,
    sanitizeCorporationName,
    sanitizeAllianceName,
    sanitizeId,
    sanitizeAttribute,
    escapeHtml
} from './xss-protection.js';

/**
 * zKillboard Stats Card Manager
 */
class ZKillStatsCard {
    constructor() {
        this.currentModal = null;
        this.isVisible = false;
        this.navigationHistory = [];
        this.completeResults = [];
        this.setupEventListeners();
        this.updateEntityMaps();
    }
    
    updateEntityMaps() {
        const maps = getEntityMaps();
        this.corpToCharactersMap = maps.corpToCharactersMap;
        this.allianceToCorpsMap = maps.allianceToCorpsMap;
    }

    setCompleteResults(results) {
        this.completeResults = results;
    }

    getWarEligibility(entityType, entityId) {
        if (entityType === 'character') {
            const character = this.completeResults.find(char => char.character_id == entityId);
            return character?.war_eligible || false;
        } else if (entityType === 'corporation') {
            const character = this.completeResults.find(char => char.corporation_id == entityId);
            return character?.war_eligible || false;
        } else if (entityType === 'alliance') {
            const character = this.completeResults.find(char => char.alliance_id == entityId);
            return character?.war_eligible || false;
        }
        return false;
    }

    setupEventListeners() {
        // Close modal on Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isVisible) {
                this.close();
            }
        });

        // Close modal on backdrop click
        document.addEventListener('click', (e) => {
            if (e.target && e.target.classList.contains('zkill-modal-backdrop')) {
                this.close();
            }
        });
    }

    /**
     * Show stats card for a character
     */
    async showCharacterStats(characterId, characterName) {
        await this.showStats('character', characterId, characterName, 'characterID');
    }

    /**
     * Show stats card for a corporation
     */
    async showCorporationStats(corporationId, corporationName) {
        await this.showStats('corporation', corporationId, corporationName, 'corporationID');
    }

    /**
     * Show stats card for an alliance
     */
    async showAllianceStats(allianceId, allianceName) {
        await this.showStats('alliance', allianceId, allianceName, 'allianceID');
    }

    /**
     * Generic method to show stats card
     */
    async showStats(entityType, entityId, entityName, apiType) {
        // Close existing modal if any
        if (this.isVisible) {
            this.close();
        }

        // Create modal structure
        this.currentModal = this.createModalStructure(entityType, entityId, entityName);
        document.body.appendChild(this.currentModal);

        // Update back button visibility
        this.updateBackButtonVisibility();

        // Show modal with animation
        requestAnimationFrame(() => {
            this.currentModal.classList.add('show');
            this.isVisible = true;
        });

        // Load stats data and affiliations in parallel
        try {
            const [stats, affiliationData] = await Promise.all([
                this.loadStats(apiType, entityId),
                this.fetchEntityAffiliations(entityType, entityId)
            ]);

            // Fetch entity names if we have affiliation data
            let corporationName = null;
            let allianceName = null;

            if (affiliationData) {
                const names = await this.fetchEntityNames(
                    affiliationData?.corporation_id,
                    affiliationData?.alliance_id
                );
                corporationName = names.corporationName;
                allianceName = names.allianceName;
            }

            this.renderAffiliations(
                affiliationData?.corporation_id,
                corporationName,
                affiliationData?.alliance_id,
                allianceName
            );

            this.populateStatsData(stats, entityType, entityId, entityName);
        } catch (error) {
            console.error('Failed to load zKillboard stats:', error);
            this.showError('Failed to load killboard statistics. Please try again later.');
        }
    }

    /**
     * Load stats from appropriate API
     */
    async loadStats(apiType, entityId) {
        switch (apiType) {
            case 'characterID':
                return await get_zkill_character_stats(entityId);
            case 'corporationID':
                return await get_zkill_corporation_stats(entityId);
            case 'allianceID':
                return await get_zkill_alliance_stats(entityId);
            default:
                throw new Error(`Unknown API type: ${apiType}`);
        }
    }

    /**
     * FIXED: Use ESI client instead of direct fetch calls
     * Fetch entity affiliations using the existing ESI infrastructure
     */
    async fetchEntityAffiliations(entityType, entityId) {
        try {
            let affiliationData = null;

            if (entityType === 'character') {
                // Use ESI client for character data
                const charData = await esiClient.get(`/characters/${entityId}/`);
                if (charData) {
                    affiliationData = {
                        corporation_id: charData.corporation_id,
                        alliance_id: charData.alliance_id || null
                    };
                }
            } else if (entityType === 'corporation') {
                // Use ESI client for corporation data
                const corpData = await esiClient.get(`/corporations/${entityId}/`);
                if (corpData) {
                    affiliationData = {
                        alliance_id: corpData.alliance_id || null
                    };
                }
            }

            return affiliationData;
        } catch (error) {
            console.warn('Failed to fetch entity affiliations:', error);
            return null;
        }
    }

    /**
     * FIXED: Use ESI client instead of direct fetch calls
     * Fetch entity names using the existing ESI infrastructure
     */
    async fetchEntityNames(corporationId, allianceId) {
        const names = {};

        try {
            // Use Promise.all to fetch both names concurrently
            const promises = [];
            
            if (corporationId) {
                promises.push(
                    esiClient.get(`/corporations/${corporationId}/`)
                        .then(corpData => {
                            if (corpData && corpData.name) {
                                names.corporationName = corpData.name;
                            }
                        })
                        .catch(error => {
                            console.warn(`Failed to fetch corporation ${corporationId} name:`, error);
                        })
                );
            }

            if (allianceId) {
                promises.push(
                    esiClient.get(`/alliances/${allianceId}/`)
                        .then(allianceData => {
                            if (allianceData && allianceData.name) {
                                names.allianceName = allianceData.name;
                            }
                        })
                        .catch(error => {
                            console.warn(`Failed to fetch alliance ${allianceId} name:`, error);
                        })
                );
            }

            // Wait for all requests to complete
            await Promise.all(promises);
        } catch (error) {
            console.warn('Failed to fetch entity names:', error);
        }

        return names;
    }

    renderAffiliations(corporationId, corporationName, allianceId, allianceName) {
        const affiliationsContainer = document.getElementById('zkill-affiliations');
        if (!affiliationsContainer) return;

        let affiliationsHTML = '';

        if (corporationId && corporationName) {
            affiliationsHTML += `
            <div class="zkill-affiliation-item">
                <img src="https://images.evetech.net/corporations/${corporationId}/logo?size=32" 
                     alt="${corporationName}" 
                     class="zkill-affiliation-logo"
                     loading="lazy">
                <div class="zkill-affiliation-info">
                    <div class="zkill-affiliation-label">Corporation</div>
                    <div class="zkill-affiliation-link" 
                        data-entity-type="corporation" 
                        data-entity-id="${corporationId}"
                        data-entity-name="${sanitizeAttribute(corporationName)}"
                        style="cursor: pointer;">${sanitizeCorporationName(corporationName)}
                    </div>
                </div>
            </div>
        `;
        }

        if (allianceId && allianceName) {
            affiliationsHTML += `
            <div class="zkill-affiliation-item">
                <img src="https://images.evetech.net/alliances/${allianceId}/logo?size=32" 
                     alt="${allianceName}" 
                     class="zkill-affiliation-logo"
                     loading="lazy">
                <div class="zkill-affiliation-info">
                    <div class="zkill-affiliation-label">Alliance</div>
                    <div class="zkill-affiliation-link" 
     data-entity-type="alliance" 
     data-entity-id="${allianceId}"
     data-entity-name="${sanitizeAttribute(allianceName)}"
     style="cursor: pointer;">${sanitizeAllianceName(allianceName)}</div>
                </div>
            </div>
        `;
        }

        affiliationsContainer.innerHTML = affiliationsHTML;
        // Add individual click handlers to prevent conflicts
        const affiliationLinks = affiliationsContainer.querySelectorAll('.zkill-affiliation-link');
        affiliationLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();

                const entityType = link.dataset.entityType;
                const entityId = link.dataset.entityId;
                const entityName = link.dataset.entityName;

                // Add current card to history before navigating
                const currentEntityType = this.currentModal.querySelector('.zkill-entity-type').textContent;
                const currentEntityName = this.currentModal.querySelector('.zkill-entity-details h2').textContent.replace(' ⚔️', '');
                const currentEntityId = this.getCurrentEntityId(); // We'll need to store this

                this.navigationHistory.push({
                    entityType: currentEntityType,
                    entityId: currentEntityId,
                    entityName: currentEntityName,
                    apiType: currentEntityType + 'ID'
                });

                // Limit history to 2 items (character -> corp -> alliance)
                if (this.navigationHistory.length > 2) {
                    this.navigationHistory.shift();
                }

                this.close();

                setTimeout(() => {
                    if (entityType === 'corporation') {
                        this.showCorporationStats(entityId, entityName);
                    } else if (entityType === 'alliance') {
                        this.showAllianceStats(entityId, entityName);
                    }
                }, 350);
            });
        });
    }

    /**
     * Create a bar chart SVG
     */
    createBarChart(data, title, maxValue) {
        if (!data || data.length === 0) {
            return `<div class="zkill-chart-empty">No activity data available</div>`;
        }

        const width = 320;
        const height = 180;
        const margin = { top: 20, right: 20, bottom: 40, left: 40 };
        const chartWidth = width - margin.left - margin.right;
        const chartHeight = height - margin.top - margin.bottom;

        // Calculate bar width and spacing
        const barSpacing = 2;
        const barWidth = Math.max(1, (chartWidth - (data.length - 1) * barSpacing) / data.length);

        // Create bars
        const bars = data.map((item, index) => {
            const barHeight = maxValue > 0 ? (item.value / maxValue) * chartHeight : 0;
            const x = margin.left + index * (barWidth + barSpacing);
            const y = margin.top + chartHeight - barHeight;

            // Color based on activity level
            let fillColor = 'rgba(0, 212, 255, 0.3)';
            if (item.value > maxValue * 0.7) {
                fillColor = 'rgba(248, 113, 113, 0.8)'; // High activity - red
            } else if (item.value > maxValue * 0.4) {
                fillColor = 'rgba(251, 191, 36, 0.8)'; // Medium activity - yellow
            } else if (item.value > 0) {
                fillColor = 'rgba(74, 222, 128, 0.8)'; // Low activity - green
            }

            return `
            <rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" 
                  fill="${fillColor}" stroke="rgba(255, 255, 255, 0.2)" stroke-width="1"
                  class="zkill-chart-bar">
                <title>${item.label}: ${item.value} kills</title>
            </rect>
        `;
        }).join('');

        // Create x-axis labels (show every nth label to avoid crowding)
        const labelInterval = Math.ceil(data.length / 8);
        const labels = data.map((item, index) => {
            if (index % labelInterval === 0 || index === data.length - 1) {
                const x = margin.left + index * (barWidth + barSpacing) + barWidth / 2;
                const y = height - 10;
                return `
                <text x="${x}" y="${y}" text-anchor="middle" 
                      fill="var(--text-secondary)" font-size="10" class="zkill-chart-label">
                    ${item.label}
                </text>
            `;
            }
            return '';
        }).join('');

        // Create y-axis labels
        const yAxisLabels = [];
        const steps = 4;
        for (let i = 0; i <= steps; i++) {
            const value = Math.round((maxValue * i) / steps);
            const y = margin.top + chartHeight - (i / steps) * chartHeight;
            yAxisLabels.push(`
            <text x="${margin.left - 10}" y="${y + 4}" text-anchor="end" 
                  fill="var(--text-secondary)" font-size="10" class="zkill-chart-label">
                ${value}
            </text>
            <line x1="${margin.left - 5}" y1="${y}" x2="${margin.left}" y2="${y}" 
                  stroke="rgba(255, 255, 255, 0.3)" stroke-width="1"/>
        `);
        }

        return `
        <div class="zkill-chart-container">
            <div class="zkill-chart-title">${title}</div>
            <svg width="${width}" height="${height}" class="zkill-chart">
                <!-- Grid lines -->
                ${Array.from({ length: steps + 1 }, (_, i) => {
            const y = margin.top + chartHeight - (i / steps) * chartHeight;
            return `<line x1="${margin.left}" y1="${y}" x2="${margin.left + chartWidth}" y2="${y}" 
                                  stroke="rgba(255, 255, 255, 0.1)" stroke-width="1"/>`;
        }).join('')}
                
                <!-- Bars -->
                ${bars}
                
                <!-- Axes -->
                <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + chartHeight}" 
                      stroke="rgba(255, 255, 255, 0.3)" stroke-width="2"/>
                <line x1="${margin.left}" y1="${margin.top + chartHeight}" x2="${margin.left + chartWidth}" y2="${margin.top + chartHeight}" 
                      stroke="rgba(255, 255, 255, 0.3)" stroke-width="2"/>
                
                <!-- Labels -->
                ${labels}
                ${yAxisLabels.join('')}
            </svg>
        </div>
    `;
    }

    getCurrentEntityId() {
        if (!this.currentModal) return null;
        const avatar = this.currentModal.querySelector('.zkill-entity-avatar');
        if (!avatar) return null;

        // Extract ID from the image src URL
        const src = avatar.src;
        const matches = src.match(/\/(\d+)\//);
        return matches ? matches[1] : null;
    }

    createActivityChartsHTML(activityData) {
        if (!activityData || !activityData.hasData) {
            return '<div class="zkill-charts-empty"><div class="zkill-empty-text">No activity data available</div></div>';
        }

        const hourlyChart = this.createBarChart(
            activityData.hourlyData,
            'Kills by Hour (EVE Time)',
            activityData.maxHourly
        );

        const dailyChart = this.createBarChart(
            activityData.dailyData,
            'Kills by Day of Week',
            activityData.maxDaily
        );

        return `
            <div class="zkill-charts-grid">
                ${hourlyChart}
                ${dailyChart}
            </div>
        `;
    }

    /**
     * Create modal DOM structure
     */
    createModalStructure(entityType, entityId, entityName) {
        const modal = document.createElement('div');
        modal.className = 'zkill-modal-backdrop';

        // Sanitize input data
        const allowedTypes = ['character', 'corporation', 'alliance'];
        const sanitizedType = allowedTypes.includes(entityType) ? entityType : 'character';
        const sanitizedId = sanitizeId(entityId);
        // For header, escape only dangerous chars but leave apostrophes
        const headerName = entityName.replace(/[<>&"]/g, (match) => {
            return {'<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;'}[match];
        });

        // For other contexts that need full sanitization, keep the sanitized version
        const sanitizedName = sanitizedType === 'character' ?
            sanitizeCharacterName(entityName) :
            sanitizedType === 'corporation' ?
                sanitizeCorporationName(entityName) :
                sanitizeAllianceName(entityName);

        const avatarSize = sanitizedType === 'character' ? CHARACTER_PORTRAIT_SIZE_PX :
            sanitizedType === 'corporation' ? CORP_LOGO_SIZE_PX : ALLIANCE_LOGO_SIZE_PX;

        const warEligible = this.getWarEligibility(sanitizedType, sanitizedId);
        const warStatusBadge = warEligible ?
            '<span class="war-eligible-badge zkill-war-badge">WAR</span>' : '';

        modal.innerHTML = `
        <div class="zkill-stats-card ${warEligible ? 'war-eligible' : ''}">
            <div class="zkill-card-header">
                <div class="zkill-entity-info">
                    <img src="https://images.evetech.net/${sanitizedType === 'character' ? 'characters' : sanitizedType + 's'}/${sanitizedId}/${sanitizedType === 'character' ? 'portrait' : 'logo'}?size=${avatarSize}"
                         alt="${sanitizeAttribute(sanitizedName)}"
                         class="zkill-entity-avatar"
                         loading="eager">
                    <div class="zkill-entity-details">
                        <h2>${headerName} ${warStatusBadge}</h2>
                        <div class="zkill-entity-type">${sanitizedType}</div>
                    </div>
                    <!-- Affiliations now separate from entity-details -->
                    <div class="zkill-entity-affiliations" id="zkill-affiliations"></div>
                </div>
                <div class="zkill-header-controls">
                    <button class="zkill-back-btn" id="zkill-back-btn" title="Back" style="display: none;">
                        ←
                    </button>
                    <button class="zkill-close-btn" title="Close">
                        ✕
                    </button>
                </div>
            </div>
            <div class="zkill-card-content">
                <div class="zkill-loading">
                    <div class="zkill-loading-spinner"></div>
                    <div class="zkill-loading-text">Loading killboard statistics...</div>
                </div>
            </div>
        </div>
    `;

        // Add close button functionality
        const closeBtn = modal.querySelector('.zkill-close-btn');
        closeBtn.addEventListener('click', () => this.close());

        // Add back button functionality
        const backBtn = modal.querySelector('.zkill-back-btn');
        backBtn.addEventListener('click', () => this.goBack());

        // Add dropdown toggle functionality
        modal.addEventListener('click', (e) => {
            if (e.target.closest('[data-action="toggle-members"]')) {
                e.preventDefault();
                e.stopPropagation();
                const dropdown = modal.querySelector('#zkill-members-dropdown');
                if (dropdown) {
                    dropdown.classList.toggle('expanded');
                }
            }
        });

        // Add member click functionality
        modal.addEventListener('click', (e) => {
            const memberItem = e.target.closest('[data-click-action]');
            if (memberItem) {
                e.preventDefault();
                e.stopPropagation();
                
                const action = memberItem.dataset.clickAction;
                
                if (action === 'show-character') {
                    const characterId = memberItem.dataset.characterId;
                    const characterName = memberItem.dataset.characterName;
                    
                    // Add current card to history
                    this.addToNavigationHistory();
                    
                    // Close current modal and show character
                    this.close();
                    setTimeout(() => {
                        this.showCharacterStats(characterId, characterName);
                    }, 350);
                    
                } else if (action === 'show-corporation') {
                    const corporationId = memberItem.dataset.corporationId;
                    const corporationName = memberItem.dataset.corporationName;
                    
                    // Add current card to history
                    this.addToNavigationHistory();
                    
                    // Close current modal and show corporation
                    this.close();
                    setTimeout(() => {
                        this.showCorporationStats(corporationId, corporationName);
                    }, 350);
                }
            }
        });

        return modal;
    }
    
    addToNavigationHistory() {
        if (!this.currentModal) return;
        
        const currentEntityType = this.currentModal.querySelector('.zkill-entity-type').textContent;
        const currentEntityName = this.currentModal.querySelector('.zkill-entity-details h2').textContent.replace(' ⚔️', '');
        const currentEntityId = this.getCurrentEntityId();
        
        if (currentEntityId) {
            this.navigationHistory.push({
                entityType: currentEntityType,
                entityId: currentEntityId,
                entityName: currentEntityName,
                apiType: currentEntityType + 'ID'
            });
            
            // Limit history to 3 items (character -> corp -> alliance)
            if (this.navigationHistory.length > 3) {
                this.navigationHistory.shift();
            }
        }
    }

    // Navigate back to previous card
    goBack() {
        if (this.navigationHistory.length > 0) {
            const previous = this.navigationHistory.pop();
            this.close();

            setTimeout(() => {
                // Don't add to history when going back
                this.showStatsWithoutHistory(previous.entityType, previous.entityId, previous.entityName, previous.apiType);
            }, 350);
        }
    }

    // Show stats without adding to navigation history (for back navigation)
    async showStatsWithoutHistory(entityType, entityId, entityName, apiType) {
        // Same as showStats but without history tracking
        if (this.isVisible) {
            this.close();
        }

        this.currentModal = this.createModalStructure(entityType, entityId, entityName);
        document.body.appendChild(this.currentModal);

        // Update back button visibility
        this.updateBackButtonVisibility();

        requestAnimationFrame(() => {
            this.currentModal.classList.add('show');
            this.isVisible = true;
        });

        try {
            const [stats, affiliationData] = await Promise.all([
                this.loadStats(apiType, entityId),
                this.fetchEntityAffiliations(entityType, entityId)
            ]);

            let corporationName = null;
            let allianceName = null;

            if (affiliationData) {
                const names = await this.fetchEntityNames(
                    affiliationData?.corporation_id,
                    affiliationData?.alliance_id
                );
                corporationName = names.corporationName;
                allianceName = names.allianceName;
            }

            this.renderAffiliations(
                affiliationData?.corporation_id,
                corporationName,
                affiliationData?.alliance_id,
                allianceName
            );

            this.populateStatsData(stats, entityType, entityId, entityName);
        } catch (error) {
            console.error('Failed to load zKillboard stats:', error);
            this.showError('Failed to load killboard statistics. Please try again later.');
        }
    }

    // Update back button visibility
    updateBackButtonVisibility() {
        const backBtn = document.getElementById('zkill-back-btn');
        if (backBtn) {
            backBtn.style.display = this.navigationHistory.length > 0 ? 'block' : 'none';
        }
    }

    formatDangerRatio(ratio) {
        if (ratio === 0) return '0.00';
        if (ratio >= 100) return Math.round(ratio).toString();
        return ratio.toFixed(2);
    }

    /**
     * Populate modal with stats data
     */
    populateStatsData(stats, entityType, entityId, entityName) {
        if (!this.currentModal) return;

        const content = this.currentModal.querySelector('.zkill-card-content');

        if (!stats || (stats.totalKills === 0 && stats.totalLosses === 0)) {
            content.innerHTML = this.createEmptyStateHTML(entityName);
            return;
        }

        content.innerHTML = this.createStatsHTML(stats, entityType, entityId);
    }

    /**
     * Create main stats HTML
     */
    // Add this method to the ZKillStatsCard class
    createMembersDropdownHTML(entityType, entityId) {
        if (entityType === 'corporation') {
            const characters = this.corpToCharactersMap.get(parseInt(entityId)) || [];
            if (characters.length === 0) return '';
            
            const membersHTML = characters.map(character => `
                <div class="zkill-member-item" 
                     data-click-action="show-character" 
                     data-character-id="${character.character_id}"
                     data-character-name="${sanitizeAttribute(character.character_name)}">
                    <img src="https://images.evetech.net/characters/${sanitizeId(character.character_id)}/portrait?size=32"
                         alt="${sanitizeAttribute(character.character_name)}"
                         class="zkill-member-avatar"
                         loading="lazy">
                    <div class="zkill-member-info">
                        <div class="zkill-member-name">${sanitizeCharacterName(character.character_name)}</div>
                        <div class="zkill-member-details">Character</div>
                    </div>
                </div>
            `).join('');
            
            return `
                <div class="zkill-members-section">
                    <div class="zkill-members-dropdown" id="zkill-members-dropdown">
                        <div class="zkill-members-header" data-action="toggle-members">
                            <div class="zkill-members-title">
                                <span class="zkill-section-icon">👥</span>
                                Corporation Members
                                <span class="zkill-members-count">${characters.length}</span>
                            </div>
                            <div class="zkill-members-toggle">▼</div>
                        </div>
                        <div class="zkill-members-list">
                            <div class="zkill-members-content">
                                ${membersHTML}
                            </div>
                        </div>
                    </div>
                </div>
            `;
        } else if (entityType === 'alliance') {
            const corps = this.allianceToCorpsMap.get(parseInt(entityId)) || [];
            if (corps.length === 0) return '';
            
            const membersHTML = corps.map(corp => `
                <div class="zkill-member-item" 
                     data-click-action="show-corporation" 
                     data-corporation-id="${corp.id}"
                     data-corporation-name="${sanitizeAttribute(corp.name)}">
                    <img src="https://images.evetech.net/corporations/${sanitizeId(corp.id)}/logo?size=32"
                         alt="${sanitizeAttribute(corp.name)}"
                         class="zkill-member-avatar"
                         loading="lazy">
                    <div class="zkill-member-info">
                        <div class="zkill-member-name">${sanitizeCorporationName(corp.name)}</div>
                        <div class="zkill-member-details">${corp.count} member${corp.count !== 1 ? 's' : ''}</div>
                    </div>
                </div>
            `).join('');
            
            return `
                <div class="zkill-members-section">
                    <div class="zkill-members-dropdown" id="zkill-members-dropdown">
                        <div class="zkill-members-header" data-action="toggle-members">
                            <div class="zkill-members-title">
                                <span class="zkill-section-icon">🏢</span>
                                Member Corporations
                                <span class="zkill-members-count">${corps.length}</span>
                            </div>
                            <div class="zkill-members-toggle">▼</div>
                        </div>
                        <div class="zkill-members-list">
                            <div class="zkill-members-content">
                                ${membersHTML}
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }
        return '';
    }

    createStatsHTML(stats, entityType, entityId) {
        return `
        <!-- Members Dropdown -->
        ${this.createMembersDropdownHTML(entityType, entityId)}

        <!-- TACTICAL OVERVIEW - Critical at-a-glance intel -->
        ${this.createTacticalOverviewHTML(stats)}

        <!-- THREAT ASSESSMENT - Risk profile and combat style -->
        ${this.createThreatAssessmentHTML(stats.securityPreference, stats.combatStyle, stats.activityInsights)}

        <!-- SHIP PREFERENCES - What they fly and where -->
        ${this.createShipPreferencesHTML(stats.shipAnalysis, stats.topLocations)}

        <!-- ACTIVITY PATTERNS - When and how they operate -->
        ${this.createActivityPatternsHTML(stats.activityInsights, stats.recentActivity.activePvPData, stats.activityData)}

        <!-- DETAILED STATISTICS - Full breakdown for analysis -->
        ${this.createDetailedStatsHTML(stats)}

        <!-- TOP SHIPS - Specific ship usage -->
        ${this.createTopShipsHTML(stats.topShips)}

        <!-- Footer -->
        <div style="text-align: center; padding: 1rem; border-top: 1px solid rgba(255, 255, 255, 0.1); margin-top: 1rem;">
            <a href="https://zkillboard.com/${entityType}/${entityId}/" 
               target="_blank" 
               style="color: var(--primary-color); text-decoration: none; font-weight: 600;">
                View full stats on zKillboard →
            </a>
        </div>
    `;
    }

    createRecentActivityHtml(activePvPData) {
        if (activePvPData.characters === 1 && 
            activePvPData.ships === 0 &&
            activePvPData.totalKills === 0 &&
            activePvPData.systems === 0 &&
            activePvPData.regions === 0) {
                return '';
            }
        return `
        <div class="zkill-section">
            <h3 class="zkill-section-title">
                Recent PvP Activity
            </h3>
            <div class="zkill-activity-grid">
                <div class="zkill-activity-card">
                    <div class="zkill-activity-icon">👤</div>
                    <div class="zkill-activity-number">${activePvPData.characters}</div>
                    <div class="zkill-activity-label">Characters</div>
                </div>
                <div class="zkill-activity-card">
                    <div class="zkill-activity-icon">🚀</div>
                    <div class="zkill-activity-number">${activePvPData.ships}</div>
                    <div class="zkill-activity-label">Ship Types</div>
                </div>
                <div class="zkill-activity-card">
                    <div class="zkill-activity-icon">⚔️</div>
                    <div class="zkill-activity-number">${activePvPData.totalKills}</div>
                    <div class="zkill-activity-label">Recent Kills</div>
                </div>
                <div class="zkill-activity-card">
                    <div class="zkill-activity-icon">🌍</div>
                    <div class="zkill-activity-number">${activePvPData.systems}</div>
                    <div class="zkill-activity-label">Systems</div>
                </div>
                <div class="zkill-activity-card">
                    <div class="zkill-activity-icon">🗺️</div>
                    <div class="zkill-activity-number">${activePvPData.regions}</div>
                    <div class="zkill-activity-label">Regions</div>
                </div>
            </div>
        </div>
        `;
    }

    /**
     * Create top ships HTML
     */
    createTopShipsHTML(ships) {
        if (!ships || ships.length === 0) {
            return '';
        }

        const shipsHTML = ships.map(ship => `
        <div class="zkill-ship-card">
            <div class="zkill-ship-info">
                <img src="https://images.evetech.net/types/${sanitizeId(ship.shipTypeID)}/icon?size=32"
                     alt="${sanitizeAttribute(ship.shipName)}"
                     class="zkill-ship-icon"
                     loading="lazy">
                <div class="zkill-ship-details">
                    <div class="zkill-ship-name">
                        <a href="https://zkillboard.com/ship/${sanitizeId(ship.shipTypeID)}/"
                           target="_blank"
                           style="color: var(--primary-color); text-decoration: none; font-weight: 600;">
                            ${escapeHtml(ship.shipName)}
                        </a>
                    </div>
                    <div class="zkill-ship-group">${escapeHtml(ship.groupName)}</div>
                </div>
            </div>
            <div class="zkill-ship-kills">${ship.kills} kill${ship.kills !== 1 ? 's' : ''}</div>
        </div>
    `).join('');

        return `
        <div class="zkill-section">
            <h3 class="zkill-section-title">
                <span class="zkill-section-icon">🚀</span>
                Most Used Ships
            </h3>
            <div class="zkill-ships-grid">
                ${shipsHTML}
            </div>
        </div>
    `;
    }

    /**
     * Create top locations HTML
     */
    createTopLocationsHTML(locations) {
        if (!locations || locations.length === 0) {
            return '';
        }

        const locationsHTML = locations.map(location => `
        <div class="zkill-location-card">
            <div class="zkill-location-name">
                <a href="https://zkillboard.com/system/${sanitizeId(location.systemId)}/" 
                target="_blank"
                style="color: var(--primary-color); text-decoration: none; font-weight: 600;">
                    ${escapeHtml(location.systemName)}
                </a>
            </div>
            <div class="zkill-location-bottom">
                <div class="zkill-location-security ${this.getSecurityClass(location.securityStatus)}">
                    ${this.formatSecurity(location.securityStatus, location.systemName)}
                </div>
                <div class="zkill-location-kills">${location.kills} kills</div>
            </div>
        </div>
    `).join('');

        return `
        <div class="zkill-section">
            <h3 class="zkill-section-title">
                <span class="zkill-section-icon">🌍</span>
                Top PVP Locations
            </h3>
            <div class="zkill-locations-grid">
                ${locationsHTML}
            </div>
        </div>
    `;
    }

    /**
     * Create tactical overview - critical at-a-glance intel
     */
    createTacticalOverviewHTML(stats) {
        // Key tactical metrics in a compact format
        return `
        <div class="zkill-section zkill-tactical-overview">
            <h3 class="zkill-section-title">
                <span class="zkill-section-icon">🎯</span>
                Tactical Overview
            </h3>
            <div class="zkill-tactical-grid">
                <div class="zkill-tactical-stat ${stats.dangerRatio > 2 ? 'dangerous' : stats.dangerRatio > 1 ? 'moderate' : 'safe'}">
                    <div class="zkill-tactical-icon">⚔️</div>
                    <div class="zkill-tactical-value">${this.formatDangerRatio(stats.dangerRatio)}</div>
                    <div class="zkill-tactical-label">K/D Ratio</div>
                </div>
                <div class="zkill-tactical-stat ${stats.efficiency > 80 ? 'high' : stats.efficiency > 50 ? 'moderate' : 'low'}">
                    <div class="zkill-tactical-icon">💰</div>
                    <div class="zkill-tactical-value">${stats.efficiency.toFixed(0)}%</div>
                    <div class="zkill-tactical-label">ISK Efficiency</div>
                </div>
                <div class="zkill-tactical-stat ${stats.gangRatio > 70 ? 'fleet' : stats.gangRatio < 30 ? 'solo' : 'mixed'}">
                    <div class="zkill-tactical-icon">👥</div>
                    <div class="zkill-tactical-value">${stats.gangRatio}%</div>
                    <div class="zkill-tactical-label">Gang Activity</div>
                </div>
                <div class="zkill-tactical-stat">
                    <div class="zkill-tactical-icon">📊</div>
                    <div class="zkill-tactical-value">${this.formatNumber(stats.totalKills)}</div>
                    <div class="zkill-tactical-label">Total Kills</div>
                </div>
            </div>
        </div>
        `;
    }

    /**
     * Create threat assessment - risk profile and combat style
     */
    createThreatAssessmentHTML(securityPreference, combatStyle, activityInsights) {
        if (!securityPreference || !combatStyle) return '';

        const riskLevel = securityPreference.riskProfile === 'High Risk' ? 'high' :
                         securityPreference.riskProfile === 'Risk Averse' ? 'low' : 'moderate';

        return `
        <div class="zkill-section zkill-threat-assessment">
            <h3 class="zkill-section-title">
                <span class="zkill-section-icon">🛡️</span>
                Threat Assessment
            </h3>
            <div class="zkill-threat-grid">
                <div class="zkill-threat-primary">
                    <div class="zkill-risk-indicator ${riskLevel}">
                        <div class="zkill-risk-icon">${securityPreference.riskProfile === 'High Risk' ? '🔥' : securityPreference.riskProfile === 'Risk Averse' ? '🛡️' : '⚠️'}</div>
                        <div class="zkill-risk-level">${securityPreference.riskProfile}</div>
                        <div class="zkill-risk-space">Primarily ${securityPreference.primary}</div>
                    </div>
                </div>
                <div class="zkill-threat-details">
                    <div class="zkill-threat-item">
                        <span class="zkill-threat-label">Combat Style:</span>
                        <span class="zkill-threat-value">${combatStyle.engagementStyle}</span>
                    </div>
                    <div class="zkill-threat-item">
                        <span class="zkill-threat-label">Fleet Role:</span>
                        <span class="zkill-threat-value">${combatStyle.fleetRole}</span>
                    </div>
                    <div class="zkill-threat-item">
                        <span class="zkill-threat-label">Activity Trend:</span>
                        <span class="zkill-threat-value ${activityInsights?.trend?.toLowerCase()}">${activityInsights?.trend || 'Unknown'}</span>
                    </div>
                </div>
            </div>
        </div>
        `;
    }

    /**
     * Create ship preferences - what they fly and where
     */
    createShipPreferencesHTML(shipAnalysis, topLocations) {
        if (!shipAnalysis) return '';

        const { specialization, sizeBreakdown, topShips } = shipAnalysis;

        const sizeHTML = sizeBreakdown.slice(0, 4).map(item => `
            <div class="zkill-pref-item">
                <div class="zkill-pref-bar">
                    <div class="zkill-pref-fill size-${item.category.toLowerCase()}" style="width: ${item.percentage}%"></div>
                </div>
                <div class="zkill-pref-info">
                    <span class="zkill-pref-category">${item.category}</span>
                    <span class="zkill-pref-percent">${item.percentage}%</span>
                </div>
            </div>
        `).join('');

        const topShipsHTML = topShips.slice(0, 3).map(ship => `
            <div class="zkill-fav-ship">
                <img src="https://images.evetech.net/types/${ship.shipTypeID}/icon?size=32"
                     alt="${ship.shipName}" class="zkill-fav-ship-icon" loading="lazy">
                <div class="zkill-fav-ship-info">
                    <div class="zkill-fav-ship-name">${ship.shipName}</div>
                    <div class="zkill-fav-ship-kills">${ship.kills} kills</div>
                </div>
            </div>
        `).join('');

        const topLocsHTML = topLocations.slice(0, 3).map(loc => {
            const securityFormatted = this.formatSecurity(loc.securityStatus, loc.systemName);
            const securityClass = securityFormatted === 'WH' ? 'wormhole' : this.getSecurityClass(loc.securityStatus);

            return `
            <div class="zkill-hot-zone">
                <div class="zkill-hot-zone-icon">
                    <div class="zkill-system-sec ${securityClass}">
                        ${securityFormatted}
                    </div>
                </div>
                <div class="zkill-hot-zone-info">
                    <div class="zkill-hot-zone-name">${loc.systemName}</div>
                    <div class="zkill-hot-zone-kills">${loc.kills} kills</div>
                </div>
            </div>
        `;
        }).join('');

        return `
        <div class="zkill-section zkill-ship-prefs">
            <h3 class="zkill-section-title">
                <span class="zkill-section-icon">🚀</span>
                Ship & Location Preferences
            </h3>
            <div class="zkill-prefs-layout">
                <div class="zkill-ship-sizes">
                    <h4 class="zkill-prefs-subtitle">Ship Size Preference</h4>
                    <div class="zkill-specialization-badge">
                        <span class="zkill-spec-icon">${specialization.type === 'Generalist' ? '🔄' : '🎯'}</span>
                        <span class="zkill-spec-text">${specialization.description}</span>
                    </div>
                    <div class="zkill-size-breakdown">
                        ${sizeHTML}
                    </div>
                </div>
                <div class="zkill-favorite-ships">
                    <h4 class="zkill-prefs-subtitle">Favourite Ships</h4>
                    <div class="zkill-fav-ships-list">
                        ${topShipsHTML}
                    </div>
                </div>
                <div class="zkill-hot-zones">
                    <h4 class="zkill-prefs-subtitle">Hot Zones</h4>
                    <div class="zkill-hot-zones-list">
                        ${topLocsHTML}
                    </div>
                </div>
            </div>
        </div>
        `;
    }

    /**
     * Create activity patterns section
     */
    createActivityPatternsHTML(activityInsights, activePvPData, activityData) {
        if (!activityInsights) return '';

        return `
        <div class="zkill-section zkill-activity-patterns">
            <h3 class="zkill-section-title">
                <span class="zkill-section-icon">📈</span>
                Activity Patterns
            </h3>
            <div class="zkill-patterns-layout">
                <div class="zkill-pattern-summary">
                    <div class="zkill-pattern-item">
                        <div class="zkill-pattern-icon">⏰</div>
                        <div class="zkill-pattern-info">
                            <div class="zkill-pattern-value">${activityInsights.primeTime}</div>
                            <div class="zkill-pattern-label">Prime Time</div>
                        </div>
                    </div>
                    <div class="zkill-pattern-item">
                        <div class="zkill-pattern-icon">📅</div>
                        <div class="zkill-pattern-info">
                            <div class="zkill-pattern-value">${activityInsights.consistency}</div>
                            <div class="zkill-pattern-label">Consistency</div>
                        </div>
                    </div>
                    <div class="zkill-pattern-item">
                        <div class="zkill-pattern-icon trend-${activityInsights.trend.toLowerCase()}">
                            ${activityInsights.trend === 'Increasing' ? '📈' : activityInsights.trend === 'Decreasing' ? '📉' : '📊'}
                        </div>
                        <div class="zkill-pattern-info">
                            <div class="zkill-pattern-value">${activityInsights.trend}</div>
                            <div class="zkill-pattern-label">Trend</div>
                        </div>
                    </div>
                </div>
                ${this.createActivityChartsHTML(activityData)}
            </div>
        </div>
        `;
    }

    /**
     * Create detailed statistics section (compact)
     */
    createDetailedStatsHTML(stats) {
        return `
        <div class="zkill-section zkill-detailed-stats">
            <h3 class="zkill-section-title">
                <span class="zkill-section-icon">📊</span>
                Detailed Statistics
            </h3>
            <div class="zkill-details-grid">
                <div class="zkill-detail-group kills">
                    <div class="zkill-detail-header">Kills</div>
                    <div class="zkill-detail-item">
                        <span class="zkill-detail-label">Total</span>
                        <span class="zkill-detail-value">${this.formatNumber(stats.totalKills)}</span>
                    </div>
                    <div class="zkill-detail-item">
                        <span class="zkill-detail-label">Solo</span>
                        <span class="zkill-detail-value">${this.formatNumber(stats.soloKills)}</span>
                    </div>
                    <div class="zkill-detail-item">
                        <span class="zkill-detail-label">ISK</span>
                        <span class="zkill-detail-value">${this.formatISK(stats.iskDestroyed)}</span>
                    </div>
                </div>
                <div class="zkill-detail-group losses">
                    <div class="zkill-detail-header">Losses</div>
                    <div class="zkill-detail-item">
                        <span class="zkill-detail-label">Total</span>
                        <span class="zkill-detail-value">${this.formatNumber(stats.totalLosses)}</span>
                    </div>
                    <div class="zkill-detail-item">
                        <span class="zkill-detail-label">Solo</span>
                        <span class="zkill-detail-value">${this.formatNumber(stats.soloLosses)}</span>
                    </div>
                    <div class="zkill-detail-item">
                        <span class="zkill-detail-label">ISK</span>
                        <span class="zkill-detail-value">${this.formatISK(stats.iskLost)}</span>
                    </div>
                </div>
            </div>
        </div>
        `;
    }

    /**
     * Create enhanced ship analysis HTML
     */
    createShipAnalysisHTML(shipAnalysis) {
        if (!shipAnalysis || !shipAnalysis.topShips.length) return '';

        const { specialization, sizeBreakdown, techBreakdown, roleBreakdown, diversity, totalShipTypes } = shipAnalysis;

        const sizeHTML = sizeBreakdown.map(item => `
            <div class="zkill-breakdown-item">
                <div class="zkill-breakdown-label">${item.category}</div>
                <div class="zkill-breakdown-bar">
                    <div class="zkill-breakdown-fill" style="width: ${item.percentage}%"></div>
                </div>
                <div class="zkill-breakdown-value">${item.percentage}%</div>
            </div>
        `).join('');

        const techHTML = techBreakdown.map(item => `
            <div class="zkill-breakdown-item">
                <div class="zkill-breakdown-label">${item.category}</div>
                <div class="zkill-breakdown-bar">
                    <div class="zkill-breakdown-fill tech-${item.category.toLowerCase()}" style="width: ${item.percentage}%"></div>
                </div>
                <div class="zkill-breakdown-value">${item.percentage}%</div>
            </div>
        `).join('');

        return `
        <div class="zkill-section">
            <h3 class="zkill-section-title">
                <span class="zkill-section-icon">🛸</span>
                Ship Usage Analysis
            </h3>
            <div class="zkill-analysis-grid">
                <div class="zkill-analysis-card">
                    <div class="zkill-analysis-header">
                        <div class="zkill-analysis-title">Specialization</div>
                        <div class="zkill-analysis-icon">${specialization.type === 'Generalist' ? '🔄' : '🎯'}</div>
                    </div>
                    <div class="zkill-specialization">
                        <div class="zkill-spec-type">${specialization.type}</div>
                        <div class="zkill-spec-focus">${specialization.focus}</div>
                        <div class="zkill-spec-description">${specialization.description}</div>
                    </div>
                </div>
                <div class="zkill-analysis-card">
                    <div class="zkill-analysis-header">
                        <div class="zkill-analysis-title">Diversity Index</div>
                        <div class="zkill-analysis-icon">📊</div>
                    </div>
                    <div class="zkill-diversity">
                        <div class="zkill-diversity-score">${Math.round(diversity)}%</div>
                        <div class="zkill-diversity-label">Ship Variety</div>
                        <div class="zkill-diversity-info">${totalShipTypes} different ships</div>
                    </div>
                </div>
            </div>
            <div class="zkill-breakdowns">
                <div class="zkill-breakdown-section">
                    <h4 class="zkill-breakdown-title">Ship Size Preference</h4>
                    ${sizeHTML}
                </div>
                <div class="zkill-breakdown-section">
                    <h4 class="zkill-breakdown-title">Tech Level Usage</h4>
                    ${techHTML}
                </div>
            </div>
        </div>
        `;
    }

    /**
     * Create combat style analysis HTML
     */
    createCombatStyleHTML(combatStyle) {
        if (!combatStyle) return '';

        return `
        <div class="zkill-section">
            <h3 class="zkill-section-title">
                <span class="zkill-section-icon">⚔️</span>
                Combat Style Profile
            </h3>
            <div class="zkill-combat-grid">
                <div class="zkill-combat-card">
                    <div class="zkill-combat-icon">🎯</div>
                    <div class="zkill-combat-label">Engagement Style</div>
                    <div class="zkill-combat-value">${combatStyle.engagementStyle}</div>
                </div>
                <div class="zkill-combat-card">
                    <div class="zkill-combat-icon">👥</div>
                    <div class="zkill-combat-label">Fleet Preference</div>
                    <div class="zkill-combat-value">${combatStyle.fleetRole}</div>
                </div>
                <div class="zkill-combat-card">
                    <div class="zkill-combat-icon">⚠️</div>
                    <div class="zkill-combat-label">Risk Tolerance</div>
                    <div class="zkill-combat-value">${combatStyle.riskTolerance}</div>
                </div>
                <div class="zkill-combat-card">
                    <div class="zkill-combat-icon">📊</div>
                    <div class="zkill-combat-label">Gang Activity</div>
                    <div class="zkill-combat-value">${combatStyle.gangPreference}%</div>
                </div>
            </div>
        </div>
        `;
    }

    /**
     * Create activity insights HTML
     */
    createActivityInsightsHTML(activityInsights) {
        if (!activityInsights) return '';

        return `
        <div class="zkill-section">
            <h3 class="zkill-section-title">
                <span class="zkill-section-icon">📈</span>
                Activity Insights
            </h3>
            <div class="zkill-insights-grid">
                <div class="zkill-insight-card">
                    <div class="zkill-insight-icon trend-${activityInsights.trend.toLowerCase()}">
                        ${activityInsights.trend === 'Increasing' ? '📈' : activityInsights.trend === 'Decreasing' ? '📉' : '📊'}
                    </div>
                    <div class="zkill-insight-label">Activity Trend</div>
                    <div class="zkill-insight-value">${activityInsights.trend}</div>
                </div>
                <div class="zkill-insight-card">
                    <div class="zkill-insight-icon">⏰</div>
                    <div class="zkill-insight-label">Prime Time</div>
                    <div class="zkill-insight-value">${activityInsights.primeTime}</div>
                </div>
                <div class="zkill-insight-card">
                    <div class="zkill-insight-icon">📅</div>
                    <div class="zkill-insight-label">Consistency</div>
                    <div class="zkill-insight-value">${activityInsights.consistency}</div>
                </div>
                <div class="zkill-insight-card">
                    <div class="zkill-insight-icon">🎯</div>
                    <div class="zkill-insight-label">Recent Activity</div>
                    <div class="zkill-insight-value">${activityInsights.recentActivity} kills</div>
                </div>
            </div>
        </div>
        `;
    }

    /**
     * Create security preference HTML
     */
    createSecurityPreferenceHTML(securityPreference) {
        if (!securityPreference || !securityPreference.breakdown.length) return '';

        const breakdownHTML = securityPreference.breakdown.map(item => `
            <div class="zkill-security-item">
                <div class="zkill-security-space ${item.space.toLowerCase()}">${item.space}</div>
                <div class="zkill-security-bar">
                    <div class="zkill-security-fill ${item.space.toLowerCase()}" style="width: ${item.percentage}%"></div>
                </div>
                <div class="zkill-security-percentage">${item.percentage}%</div>
                <div class="zkill-security-kills">${item.kills} kills</div>
            </div>
        `).join('');

        return `
        <div class="zkill-section">
            <h3 class="zkill-section-title">
                <span class="zkill-section-icon">🛡️</span>
                Security Space Preference
            </h3>
            <div class="zkill-security-profile">
                <div class="zkill-security-summary">
                    <div class="zkill-security-primary">Primary: <strong>${securityPreference.primary}</strong></div>
                    <div class="zkill-security-risk">Risk Profile: <strong>${securityPreference.riskProfile}</strong></div>
                </div>
                <div class="zkill-security-breakdown">
                    ${breakdownHTML}
                </div>
            </div>
        </div>
        `;
    }

    /**
     * Create empty state HTML
     */
    createEmptyStateHTML(entityName) {
        return `
            <div class="zkill-empty">
                <div class="zkill-empty-icon">📊</div>
                <div class="zkill-empty-text">No killboard data found</div>
                <div style="color: var(--text-secondary); font-size: 0.9rem; margin-top: 0.5rem;">
                    ${escapeHtml(entityName)} has no recorded kills or losses on zKillboard.
                </div>
            </div>
        `;
    }

    /**
     * Show error state
     */
    showError(message) {
        if (!this.currentModal) return;

        const content = this.currentModal.querySelector('.zkill-card-content');
        content.innerHTML = `
            <div class="zkill-error">
                <div class="zkill-error-icon">⚠️</div>
                <div class="zkill-error-text">Error Loading Data</div>
                <div class="zkill-error-details">${escapeHtml(message)}</div>
            </div>
        `;
    }

    /**
     * Close modal
     */
    close() {
        if (this.currentModal) {
            this.currentModal.removeEventListener('click', this.affiliationClickHandler);
        }
        if (!this.currentModal || !this.isVisible) return;

        this.currentModal.classList.remove('show');
        this.isVisible = false;

        setTimeout(() => {
            if (this.currentModal && this.currentModal.parentNode) {
                this.currentModal.parentNode.removeChild(this.currentModal);
            }
            this.currentModal = null;
        }, ZKILL_CARD_ANIMATION_DURATION_MS);
    }

    /**
     * Utility functions
     */
    formatNumber(num) {
        if (num >= 1000000) {
            return (num / 1000000).toFixed(1) + 'M';
        } else if (num >= 1000) {
            return (num / 1000).toFixed(1) + 'k';
        }
        return num.toString();
    }

    formatISK(isk) {
        if (isk >= 1000000000000) {
            return (isk / 1000000000000).toFixed(1) + 'T ISK';
        } else if (isk >= 1000000000) {
            return (isk / 1000000000).toFixed(1) + 'B ISK';
        } else if (isk >= 1000000) {
            return (isk / 1000000).toFixed(1) + 'M ISK';
        } else if (isk >= 1000) {
            return (isk / 1000).toFixed(1) + 'k ISK';
        }
        return isk.toFixed(0) + ' ISK';
    }

    formatSecurity(security, systemName) {
        if (security === null || security === undefined) {
            return 'Unknown';
        }

        // Handle string security values
        if (typeof security === 'string') {
            const numSec = parseFloat(security);
            if (isNaN(numSec)) {
                return 'Unknown';
            }
            security = numSec;
        }

        if (security >= 0.5) {
            return security.toFixed(1);
        } else if (security > 0.0) {
            return security.toFixed(1);
        } else if (security === -1.0) {
            if (systemName && systemName[0] == 'J') {
                return 'WH'
            }
            return 'POCH';
        } else {
            return '0.0';
        }
    }

    getSecurityClass(security) {
        if (security === null || security === undefined) {
            return 'unknown';
        }

        // Handle string security values
        if (typeof security === 'string') {
            const numSec = parseFloat(security);
            if (isNaN(numSec)) {
                return 'unknown';
            }
            security = numSec;
        }

        if (security >= 0.5) {
            return 'highsec';
        } else if (security > 0.0) {
            return 'lowsec';
        } else {
            return 'nullsec';
        }
    }

}

// Create singleton instance
const zkillStatsCard = new ZKillStatsCard();

// Export functions for use in other modules
export function showCharacterStats(characterId, characterName) {
    return zkillStatsCard.showCharacterStats(characterId, characterName);
}

export function showCorporationStats(corporationId, corporationName) {
    return zkillStatsCard.showCorporationStats(corporationId, corporationName);
}

export function showAllianceStats(allianceId, allianceName) {
    return zkillStatsCard.showAllianceStats(allianceId, allianceName);
}

export function closeStatsCard() {
    zkillStatsCard.close();
}

// Export the singleton instance for external access
export function getZkillCardInstance() {
    return zkillStatsCard;
}