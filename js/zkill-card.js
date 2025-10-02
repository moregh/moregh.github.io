/*
    EVE Target Intel - zKillboard Stats Card Component
    
    Copyright (C) 2025 moregh (https://github.com/moregh/)
    Licensed under AGPL License.
*/

import { get_zkill_character_stats, get_zkill_corporation_stats, get_zkill_alliance_stats } from './zkillboard-api.js';
import {
    CHARACTER_PORTRAIT_SIZE_PX, CORP_LOGO_SIZE_PX, ALLIANCE_LOGO_SIZE_PX, ZKILL_CARD_ANIMATION_DURATION_MS,
    ZKILL_TIMER_UPDATE_INTERVAL_MS, ZKILL_PROGRESS_CONNECTING, ZKILL_PROGRESS_ESI_BASE, ZKILL_PROGRESS_AFFILIATIONS,
    ZKILL_PROGRESS_PROCESSING, ZKILL_RECENT_KILLS_LIMIT, ZKILL_NAVIGATION_CLOSE_DELAY_MS, ZKILL_NAVIGATION_HISTORY_LIMIT,
    ZKILL_EFFICIENCY_THRESHOLD_HIGH, ZKILL_EFFICIENCY_THRESHOLD_MEDIUM, ZKILL_GANG_RATIO_THRESHOLD_HIGH,
    ZKILL_GANG_RATIO_THRESHOLD_LOW, ZKILL_WORMHOLE_SECURITY, ZKILL_SECURITY_HIGH_THRESHOLD,
    ZKILL_SECURITY_NULL_THRESHOLD, ZKILL_SECURITY_WSPACE_THRESHOLD, IMAGE_PLACEHOLDER_SIZE_PX,
    CHART_WIDTH_PX, CHART_HEIGHT_PX, CHART_MARGIN_TOP_PX, CHART_MARGIN_RIGHT_PX, CHART_MARGIN_BOTTOM_PX,
    CHART_MARGIN_LEFT_PX, CHART_BAR_SPACING_PX, CHART_STEPS, CHART_LABEL_INTERVAL_DIVISOR,
    CHART_COLOR_THRESHOLD_HIGH, CHART_COLOR_THRESHOLD_MEDIUM, TOP_ITEMS_DISPLAY_LIMIT,
    BREAKDOWN_DISPLAY_LIMIT
} from './config.js';
import { getEntityMaps } from './rendering.js';
import { esiClient } from './esi-client.js';
import { sanitizeCharacterName, sanitizeCorporationName, sanitizeAllianceName, sanitizeId, sanitizeAttribute, escapeHtml } from './xss-protection.js';
import { getCachedUniverseName, setCachedUniverseName } from './database.js';

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
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isVisible) {
                this.close();
            }
        });

        document.addEventListener('click', (e) => {
            if (e.target && e.target.classList.contains('zkill-modal-backdrop')) {
                this.close();
            }
        });
    }

    async showCharacterStats(characterId, characterName) {
        await this.showStats('character', characterId, characterName, 'characterID');
    }

    async showCorporationStats(corporationId, corporationName) {
        await this.showStats('corporation', corporationId, corporationName, 'corporationID');
    }

    async showAllianceStats(allianceId, allianceName) {
        await this.showStats('alliance', allianceId, allianceName, 'allianceID');
    }

    async showStats(entityType, entityId, entityName, apiType) {
        if (this.isVisible) {
            this.close();
        }

        this.currentModal = this.createModalStructure(entityType, entityId, entityName);
        document.body.appendChild(this.currentModal);
        this.updateBackButtonVisibility();

        requestAnimationFrame(() => {
            this.currentModal.classList.add('show');
            this.isVisible = true;
        });

        const startTime = Date.now();
        const timerInterval = setInterval(() => {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            const timerEl = this.currentModal.querySelector('.timer');
            if (timerEl) {
                timerEl.textContent = `Elapsed: ${elapsed}s`;
            }
        }, ZKILL_TIMER_UPDATE_INTERVAL_MS);

        try {
            this.updateLoadingProgress('Connecting to zKillboard...', 0, '');

            const statsPromise = this.loadStats(apiType, entityId, (source, message, current, total) => {
                let percentage = 0;
                let detail = '';

                if (source === 'zkill') {
                    percentage = ZKILL_PROGRESS_CONNECTING;
                    detail = message;
                } else if (source === 'esi') {
                    if (total > 0) {
                        percentage = ZKILL_PROGRESS_CONNECTING + (current / total) * ZKILL_PROGRESS_ESI_BASE;
                        detail = `${current}/${total} killmails`;
                    } else {
                        percentage = ZKILL_PROGRESS_CONNECTING;
                        detail = message;
                    }
                }

                this.updateLoadingProgress(message, percentage, detail);
            });

            const affiliationPromise = this.fetchEntityAffiliations(entityType, entityId);

            const [stats, affiliationData] = await Promise.all([statsPromise, affiliationPromise]);

            this.updateLoadingProgress('Loading affiliations...', ZKILL_PROGRESS_AFFILIATIONS, '');

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

            this.updateLoadingProgress('Processing data...', ZKILL_PROGRESS_PROCESSING, '');

            clearInterval(timerInterval);

            this.renderAffiliations(
                affiliationData?.corporation_id,
                corporationName,
                affiliationData?.alliance_id,
                allianceName
            );

            this.populateStatsData(stats, entityType, entityId, entityName);
        } catch (error) {
            clearInterval(timerInterval);
            console.error('Failed to load zKillboard stats:', error);
            this.showError('Failed to load killboard statistics. Please try again later.');
        }
    }

    async loadStats(apiType, entityId, onProgress = null) {
        const options = {
            includeKillmails: true,
            onProgress: onProgress
        };
        switch (apiType) {
            case 'characterID':
                return await get_zkill_character_stats(entityId, options);
            case 'corporationID':
                return await get_zkill_corporation_stats(entityId, options);
            case 'allianceID':
                return await get_zkill_alliance_stats(entityId, options);
            default:
                throw new Error(`Unknown API type: ${apiType}`);
        }
    }

    async fetchEntityAffiliations(entityType, entityId) {
        try {
            let affiliationData = null;

            if (entityType === 'character') {
                const charData = await esiClient.get(`/characters/${entityId}/`);
                if (charData) {
                    affiliationData = {
                        corporation_id: charData.corporation_id,
                        alliance_id: charData.alliance_id || null
                    };
                }
            } else if (entityType === 'corporation') {
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

    async fetchEntityName(entityType, entityId) {
        if (!entityId) return null;

        try {
            const endpoint = entityType === 'corporation'
                ? `/corporations/${entityId}/`
                : `/alliances/${entityId}/`;

            const data = await esiClient.get(endpoint);
            return data && data.name ? data.name : null;
        } catch (error) {
            console.warn(`Failed to fetch ${entityType} ${entityId} name:`, error);
            return null;
        }
    }

    async fetchEntityNames(corporationId, allianceId) {
        const [corporationName, allianceName] = await Promise.all([
            corporationId ? this.fetchEntityName('corporation', corporationId) : null,
            allianceId ? this.fetchEntityName('alliance', allianceId) : null
        ]);

        return { corporationName, allianceName };
    }

    renderAffiliations(corporationId, corporationName, allianceId, allianceName) {
        const affiliationsContainer = document.getElementById('zkill-affiliations');
        if (!affiliationsContainer) return;

        let affiliationsHTML = '';

        if (corporationId && corporationName) {
            affiliationsHTML += `
            <div class="zkill-affiliation-item">
                <img src="https://images.evetech.net/corporations/${corporationId}/logo?size=${IMAGE_PLACEHOLDER_SIZE_PX}"
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
                <img src="https://images.evetech.net/alliances/${allianceId}/logo?size=${IMAGE_PLACEHOLDER_SIZE_PX}"
                     alt="${allianceName}"
                     class="zkill-affiliation-logo"
                     loading="lazy">
                <div class="zkill-affiliation-info">
                    <div class="zkill-affiliation-label">Alliance</div>
                    <div class="zkill-affiliation-link"
                                data-entity-type="alliance"
                                data-entity-id="${allianceId}"
                                data-entity-name="${sanitizeAttribute(allianceName)}"
                                style="cursor: pointer;">${sanitizeAllianceName(allianceName)}
                    </div>
                </div>
            </div>
        `;
        }

        affiliationsContainer.innerHTML = affiliationsHTML;

        const affiliationLinks = affiliationsContainer.querySelectorAll('.zkill-affiliation-link');
        affiliationLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();

                const entityType = link.dataset.entityType;
                const entityId = link.dataset.entityId;
                const entityName = link.dataset.entityName;


                const currentEntityType = this.currentModal.querySelector('.zkill-entity-type').textContent;
                const currentEntityName = this.currentModal.querySelector('.zkill-entity-details h2').textContent.replace(' ⚔️', '');
                const currentEntityId = this.getCurrentEntityId();

                this.navigationHistory.push({
                    entityType: currentEntityType,
                    entityId: currentEntityId,
                    entityName: currentEntityName,
                    apiType: currentEntityType + 'ID'
                });


                if (this.navigationHistory.length > ZKILL_NAVIGATION_HISTORY_LIMIT - 1) {
                    this.navigationHistory.shift();
                }

                this.close();

                setTimeout(() => {
                    if (entityType === 'corporation') {
                        this.showCorporationStats(entityId, entityName);
                    } else if (entityType === 'alliance') {
                        this.showAllianceStats(entityId, entityName);
                    }
                }, ZKILL_NAVIGATION_CLOSE_DELAY_MS);
            });
        });
    }

    createBarChart(data, title, maxValue) {
        if (!data || data.length === 0) {
            return ``;
        }

        const width = CHART_WIDTH_PX;
        const height = CHART_HEIGHT_PX;
        const margin = { top: CHART_MARGIN_TOP_PX, right: CHART_MARGIN_RIGHT_PX, bottom: CHART_MARGIN_BOTTOM_PX, left: CHART_MARGIN_LEFT_PX };
        const chartWidth = width - margin.left - margin.right;
        const chartHeight = height - margin.top - margin.bottom;
        const barSpacing = CHART_BAR_SPACING_PX;
        const barWidth = Math.max(1, (chartWidth - (data.length - 1) * barSpacing) / data.length);

        const bars = data.map((item, index) => {
            const barHeight = maxValue > 0 ? (item.value / maxValue) * chartHeight : 0;
            const x = margin.left + index * (barWidth + barSpacing);
            const y = margin.top + chartHeight - barHeight;

            let fillColor = 'rgba(0, 212, 255, 0.3)';
            if (item.value > maxValue * CHART_COLOR_THRESHOLD_HIGH) {
                fillColor = 'rgba(248, 113, 113, 0.8)';
            } else if (item.value > maxValue * CHART_COLOR_THRESHOLD_MEDIUM) {
                fillColor = 'rgba(251, 191, 36, 0.8)';
            } else if (item.value > 0) {
                fillColor = 'rgba(74, 222, 128, 0.8)';
            }

            return `
            <rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" 
                  fill="${fillColor}" stroke="rgba(255, 255, 255, 0.2)" stroke-width="1"
                  class="zkill-chart-bar">
                <title>${item.label}: ${item.value} kills</title>
            </rect>
        `;
        }).join('');


        const labelInterval = Math.ceil(data.length / CHART_LABEL_INTERVAL_DIVISOR);
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


        const yAxisLabels = [];
        const steps = CHART_STEPS;
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
                ${bars}
                <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + chartHeight}" 
                      stroke="rgba(255, 255, 255, 0.3)" stroke-width="2"/>
                <line x1="${margin.left}" y1="${margin.top + chartHeight}" x2="${margin.left + chartWidth}" y2="${margin.top + chartHeight}" 
                      stroke="rgba(255, 255, 255, 0.3)" stroke-width="2"/>
                ${labels}
                ${yAxisLabels.join('')}
            </svg>
        </div>
    `;
    }

    createSpacePieChart(breakdown) {
        const size = 200;
        const radius = 80;
        const centerX = size / 2;
        const centerY = size / 2;

        const colors = {
            'Highsec': '#4ade80',
            'Lowsec': '#fbbf24',
            'Nullsec': '#ef4444',
            'Pochven': '#a855f7',
            'W-Space': '#3b82f6'
        };

        let slices = '';

        if (breakdown.length === 1 && breakdown[0].percentage === 100) {
            slices = `
                <circle cx="${centerX}" cy="${centerY}" r="${radius}"
                        fill="${colors[breakdown[0].space] || '#666'}"
                        stroke="rgba(0, 0, 0, 0.3)"
                        stroke-width="2"
                        class="zkill-pie-slice">
                    <title>${breakdown[0].space}: 100%</title>
                </circle>
            `;
        } else {
            let currentAngle = -90;
            slices = breakdown.map(item => {
                const angle = (item.percentage / 100) * 360;
                const startAngle = currentAngle;
                const endAngle = currentAngle + angle;
                currentAngle = endAngle;

                const startRad = (startAngle * Math.PI) / 180;
                const endRad = (endAngle * Math.PI) / 180;

                const x1 = centerX + radius * Math.cos(startRad);
                const y1 = centerY + radius * Math.sin(startRad);
                const x2 = centerX + radius * Math.cos(endRad);
                const y2 = centerY + radius * Math.sin(endRad);

                const largeArc = angle > 180 ? 1 : 0;

                return `
                    <path d="M ${centerX} ${centerY} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z"
                          fill="${colors[item.space] || '#666'}"
                          stroke="rgba(0, 0, 0, 0.3)"
                          stroke-width="2"
                          class="zkill-pie-slice">
                        <title>${item.space}: ${item.percentage}%</title>
                    </path>
                `;
            }).join('');
        }

        const legend = breakdown.map(item => `
            <div class="zkill-pie-legend-item">
                <div class="zkill-pie-legend-color" style="background: ${colors[item.space] || '#666'}"></div>
                <div class="zkill-pie-legend-label">${item.space}</div>
                <div class="zkill-pie-legend-value">${item.percentage}%</div>
            </div>
        `).join('');

        return `
            <div class="zkill-chart-container zkill-pie-chart-container">
                <svg width="${size}" height="${size}" class="zkill-pie-chart">
                    ${slices}
                </svg>
                <div class="zkill-pie-legend">
                    ${legend}
                </div>
            </div>
        `;
    }

    getCurrentEntityId() {
        if (!this.currentModal) return null;
        const avatar = this.currentModal.querySelector('.zkill-entity-avatar');
        if (!avatar) return null;

        const src = avatar.src;
        const matches = src.match(/\/(\d+)\//);
        return matches ? matches[1] : null;
    }

    createActivityChartsHTML(activityData) {
        if (!activityData || !activityData.hasData) {
            return '';
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

    createModalStructure(entityType, entityId, entityName) {
        const modal = document.createElement('div');
        modal.className = 'zkill-modal-backdrop';
        const allowedTypes = ['character', 'corporation', 'alliance'];
        const sanitizedType = allowedTypes.includes(entityType) ? entityType : 'character';
        const sanitizedId = sanitizeId(entityId);

        const headerName = entityName.replace(/[<>&"]/g, (match) => {
            return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[match];
        });

        const sanitizedName = sanitizedType === 'character' ?
            sanitizeCharacterName(entityName) :
            sanitizedType === 'corporation' ?
                sanitizeCorporationName(entityName) :
                sanitizeAllianceName(entityName);

        const avatarSize = sanitizedType === 'character' ? CHARACTER_PORTRAIT_SIZE_PX :
            sanitizedType === 'corporation' ? CORP_LOGO_SIZE_PX : ALLIANCE_LOGO_SIZE_PX;

        const warEligible = this.getWarEligibility(sanitizedType, sanitizedId);
        const warStatusBadge = warEligible ?
            '<span class="war-eligible-badge">WAR</span>' : '';

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
                    <div class="loading-spinner-container">
                        <div class="loading-spinner"></div>
                        <div class="pulse-ring"></div>
                    </div>
                    <h3 class="loading-text">Loading killboard statistics</h3>
                    <p class="loading-subtitle">Fetching data from zKillboard...</p>
                    <div class="progress-container">
                        <div class="progress-bar"></div>
                        <div class="progress-glow"></div>
                    </div>
                    <div class="loading-stats">
                        <span class="progress-text">Connecting to zKillboard API...</span>
                        <span class="timer">Elapsed: 0.0s</span>
                    </div>
                </div>
            </div>
        </div>
    `;

        const closeBtn = modal.querySelector('.zkill-close-btn');
        closeBtn.addEventListener('click', () => this.close());
        const backBtn = modal.querySelector('.zkill-back-btn');
        backBtn.addEventListener('click', () => this.goBack());

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

        modal.addEventListener('click', (e) => {
            const memberItem = e.target.closest('[data-click-action]');
            if (memberItem) {
                e.preventDefault();
                e.stopPropagation();

                const action = memberItem.dataset.clickAction;

                if (action === 'show-character') {
                    const characterId = memberItem.dataset.characterId;
                    const characterName = memberItem.dataset.characterName;
                    this.addToNavigationHistory();
                    this.close();

                    setTimeout(() => {
                        this.showCharacterStats(characterId, characterName);
                    }, ZKILL_NAVIGATION_CLOSE_DELAY_MS);

                } else if (action === 'show-corporation') {
                    const corporationId = memberItem.dataset.corporationId;
                    const corporationName = memberItem.dataset.corporationName;
                    this.addToNavigationHistory();
                    this.close();

                    setTimeout(() => {
                        this.showCorporationStats(corporationId, corporationName);
                    }, ZKILL_NAVIGATION_CLOSE_DELAY_MS);
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

            if (this.navigationHistory.length > ZKILL_NAVIGATION_HISTORY_LIMIT) {
                this.navigationHistory.shift();
            }
        }
    }

    goBack() {
        if (this.navigationHistory.length > 0) {
            const previous = this.navigationHistory.pop();
            this.close();

            setTimeout(() => {
                this.showStatsWithoutHistory(previous.entityType, previous.entityId, previous.entityName, previous.apiType);
            }, ZKILL_NAVIGATION_CLOSE_DELAY_MS);
        }
    }

    async showStatsWithoutHistory(entityType, entityId, entityName, apiType) {
        if (this.isVisible) {
            this.close();
        }

        this.currentModal = this.createModalStructure(entityType, entityId, entityName);
        document.body.appendChild(this.currentModal);
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

    updateBackButtonVisibility() {
        const backBtn = document.getElementById('zkill-back-btn');
        if (backBtn) {
            backBtn.style.display = this.navigationHistory.length > 0 ? 'block' : 'none';
        }
    }

    updateLoadingProgress(text, percentage, detail = '') {
        if (!this.currentModal) return;

        const progressText = this.currentModal.querySelector('.progress-text');
        const progressBar = this.currentModal.querySelector('.progress-bar');
        const subtitle = this.currentModal.querySelector('.loading-subtitle');

        if (progressText) {
            progressText.textContent = text;
        }

        if (progressBar) {
            progressBar.style.width = `${percentage}%`;
        }

        if (subtitle && detail) {
            subtitle.textContent = detail;
        }
    }

    formatDangerRatio(ratio) {
        if (ratio === 0) return '0.00';
        if (ratio >= 100) return Math.round(ratio).toString();
        return ratio.toFixed(2);
    }

    getOrgSize(memberCount) {
        if (!memberCount) return 'N/A';
        if (memberCount < 10) return 'Micro';
        if (memberCount < 50) return 'Small';
        if (memberCount < 250) return 'Medium';
        if (memberCount < 1000) return 'Large';
        return 'Massive';
    }

    async populateStatsData(stats, entityType, entityId, entityName) {
        if (!this.currentModal) return;

        const content = this.currentModal.querySelector('.zkill-card-content');

        if (!stats || (stats.totalKills === 0 && stats.totalLosses === 0)) {
            content.innerHTML = this.createEmptyStateHTML(entityName);
            return;
        }
        content.innerHTML = await this.createStatsHTML(stats, entityType, entityId);
    }


    createMembersDropdownHTML(entityType, entityId) {
        const isCorporation = entityType === 'corporation';
        const members = isCorporation
            ? this.corpToCharactersMap.get(parseInt(entityId)) || []
            : this.allianceToCorpsMap.get(parseInt(entityId)) || [];

        if (members.length === 0) return '';

        const config = isCorporation
            ? {
                icon: '👥',
                title: 'Corporation Members',
                action: 'show-character',
                idKey: 'character-id',
                nameKey: 'character-name',
                imgType: 'characters',
                imgPath: 'portrait',
                sanitizeName: sanitizeCharacterName,
                getDetails: () => 'Character'
            }
            : {
                icon: '🏢',
                title: 'Member Corporations',
                action: 'show-corporation',
                idKey: 'corporation-id',
                nameKey: 'corporation-name',
                imgType: 'corporations',
                imgPath: 'logo',
                sanitizeName: sanitizeCorporationName,
                getDetails: (item) => `${item.count} member${item.count !== 1 ? 's' : ''}`
            };

        const membersHTML = members.map(member => {
            const id = isCorporation ? member.character_id : member.id;
            const name = isCorporation ? member.character_name : member.name;

            return `
                <div class="zkill-member-item"
                     data-click-action="${config.action}"
                     data-${config.idKey}="${id}"
                     data-${config.nameKey}="${sanitizeAttribute(name)}">
                    <img src="https://images.evetech.net/${config.imgType}/${sanitizeId(id)}/${config.imgPath}?size=${IMAGE_PLACEHOLDER_SIZE_PX}"
                         alt="${sanitizeAttribute(name)}"
                         class="zkill-member-avatar"
                         loading="lazy">
                    <div class="zkill-member-info">
                        <div class="zkill-member-name">${config.sanitizeName(name)}</div>
                        <div class="zkill-member-details">${config.getDetails(member)}</div>
                    </div>
                </div>
            `;
        }).join('');

        return `
            <div class="zkill-members-section">
                <div class="zkill-members-dropdown" id="zkill-members-dropdown">
                    <div class="zkill-members-header" data-action="toggle-members">
                        <div class="zkill-members-title">
                            <span class="zkill-section-icon">${config.icon}</span>
                            ${config.title}
                            <span class="zkill-members-count">${members.length}</span>
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

    async createStatsHTML(stats, entityType, entityId) {
        const recentKillsHTML = await this.createRecentKillsHTML(stats.killmailData, entityType, entityId);

        return `
        ${this.createMembersDropdownHTML(entityType, entityId)}
        ${this.createPlaystyleTagsHTML(stats.combatStyle)}
        ${this.createThreatAssessmentHTML(stats.securityPreference, stats.combatStyle, stats.activityInsights, stats.shipAnalysis)}
        ${this.createTacticalOverviewHTML(stats)}
        ${this.createTop10CombinedHTML(stats.topShips, stats.topPlayers, stats.topLocations, entityType)}
        ${this.createKillmailInsightsHTML(stats.killmailData)}
        ${this.createCombinedStatsAndChartsHTML(stats, stats.securityPreference, stats.activityInsights, stats.recentActivity.activePvPData, stats.activityData)}
        ${recentKillsHTML}
        <div style="text-align: center; padding: 1rem; border-top: 1px solid rgba(255, 255, 255, 0.1); margin-top: 1rem;">
            <a href="https://zkillboard.com/${entityType}/${entityId}/"
               target="_blank"
               style="color: var(--primary-color); text-decoration: none; font-weight: 600;">
                View full stats on zKillboard →
            </a>
        </div>
    `;
    }

    createKillmailInsightsHTML(killmailData) {
        if (!killmailData || !killmailData.hasData || !killmailData.analysis) {
            return '';
        }

        const analysis = killmailData.analysis;
        const fleetSize = analysis.fleetSizeAnalysis;
        const soloVsFleet = analysis.soloVsFleet;
        const totalKillmails = killmailData.totalFetched || analysis.totalKillmails;

        return `
        <div class="zkill-section">
            <h3 class="zkill-section-title">Last ${totalKillmails} Kills</h3>
            <div class="zkill-stats-grid zkill-stats-grid-single-row">
                <div class="zkill-stat-item zkill-stat-item-compact">
                    <div class="zkill-stat-label">Avg Fleet Size</div>
                    <div class="zkill-stat-value zkill-stat-value-fleet">${fleetSize.average}</div>
                </div>
                <div class="zkill-stat-item zkill-stat-item-compact">
                    <div class="zkill-stat-label">Solo Kills</div>
                    <div class="zkill-stat-value zkill-stat-value-solo">${soloVsFleet.solo.percentage}%</div>
                </div>
                <div class="zkill-stat-item zkill-stat-item-compact">
                    <div class="zkill-stat-label">Small Gang</div>
                    <div class="zkill-stat-value zkill-stat-value-gang">${soloVsFleet.smallGang.percentage}%</div>
                </div>
                <div class="zkill-stat-item zkill-stat-item-compact">
                    <div class="zkill-stat-label">Fleet Ops</div>
                    <div class="zkill-stat-value zkill-stat-value-ops">${soloVsFleet.fleet.percentage}%</div>
                </div>
                <div class="zkill-stat-item zkill-stat-item-compact">
                    <div class="zkill-stat-label">Biggest</div>
                    <div class="zkill-stat-value zkill-stat-value-isk">${this.formatISK(analysis.mostExpensiveKill.value)}</div>
                </div>
                <div class="zkill-stat-item zkill-stat-item-compact">
                    <div class="zkill-stat-label">Average</div>
                    <div class="zkill-stat-value zkill-stat-value-isk">${this.formatISK(analysis.avgValue)}</div>
                </div>
            </div>
        </div>
        `;
    }

    async createRecentKillsHTML(killmailData, entityType, entityId) {
        if (!killmailData || !killmailData.hasData || !killmailData.recentKills || killmailData.recentKills.length === 0) {
            return '';
        }

        const killsWithNames = await Promise.all(killmailData.recentKills.slice(0, ZKILL_RECENT_KILLS_LIMIT).map(async kill => {
            const [shipName, systemData] = await Promise.all([
                this.getShipName(kill.victimShipTypeId),
                this.getSystemName(kill.systemId)
            ]);

            return {
                ...kill,
                shipName,
                systemName: systemData.name,
                systemSecurity: systemData.security !== undefined ? systemData.security : kill.systemSecurity
            };
        }));

        const killsHTML = killsWithNames.map(kill => {
            const date = new Date(kill.time);
            const relativeTime = this.getRelativeTime(date);
            const iskValue = this.formatISK(kill.value);

            const secStatus = kill.systemSecurity !== undefined && kill.systemSecurity !== null
                ? kill.systemSecurity.toFixed(1)
                : '?';
            const secClass = this.getSecurityClass(kill.systemSecurity, kill.systemName);

            return `
                <div class="zkill-kill-item">
                    <div class="zkill-kill-ship">
                        <img src="https://images.evetech.net/types/${kill.victimShipTypeId}/icon?size=${IMAGE_PLACEHOLDER_SIZE_PX}"
                             alt="${kill.shipName}"
                             class="zkill-kill-icon"
                             loading="lazy">
                        <div class="zkill-kill-ship-info">
                            <div class="zkill-kill-ship-name">${kill.shipName}</div>
                            <div class="zkill-kill-value">${iskValue}</div>
                        </div>
                    </div>
                    <div class="zkill-kill-details">
                        <div class="zkill-kill-meta">
                            <span class="zkill-kill-system">
                                <span class="zkill-kill-sec ${secClass}">${secStatus}</span>
                                <span class="zkill-kill-system-name">${kill.systemName}</span>
                            </span>
                            <span class="zkill-kill-attackers">${kill.attackers} pilot${kill.attackers !== 1 ? 's' : ''}</span>
                            <span class="zkill-kill-time">${relativeTime}</span>
                        </div>
                        <a href="https://zkillboard.com/kill/${kill.killmailId}/"
                           target="_blank"
                           class="zkill-kill-link">View</a>
                    </div>
                </div>
            `;
        }).join('');

        return `
        <div class="zkill-section">
            <h3 class="zkill-section-title">Recent Kills</h3>
            <div class="zkill-kills-list">
                ${killsHTML}
            </div>
        </div>
        `;
    }

    getSecurityClass(security, systemName) {
        if (security === undefined || security === null) return 'sec-unknown';
        if (security >= 0.5) return 'sec-high';
        if (security > 0.0) return 'sec-low';
        if (security > -0.99) return 'sec-null';
        if (systemName && systemName[0] === 'J') return 'sec-wspace';
        const pochvenSystems = ['Skarkon', 'Archee', 'Kino', 'Konola', 'Krirald', 'Nalvula', 'Nani', 'Ala', 'Angymonne', 'Arvasaras', 'Harva', 'Ignebaener', 'Kuharah', 'Otanuomi', 'Otela', 'Senda', 'Vale', 'Wirashoda', 'Ahtila', 'Ichoriya', 'Kaunokka', 'Raravoss', 'Sakenta', 'Skarkon', 'Urhinichi'];
        if (pochvenSystems.includes(systemName)) return 'sec-pochven';
        return 'sec-wspace';
    }

    async getShipName(shipTypeId) {
        if (!shipTypeId) return 'Unknown Ship';

        try {
            const cached = await getCachedUniverseName(shipTypeId);
            if (cached && cached.name) return cached.name;

            const data = await esiClient.get(`/universe/types/${shipTypeId}/`);
            if (!data) return 'Unknown Ship';

            await setCachedUniverseName(shipTypeId, data.name);
            return data.name;
        } catch (error) {
            console.error('Error fetching ship name:', error);
            return 'Unknown Ship';
        }
    }

    async getSystemName(systemId) {
        if (!systemId) return { name: 'Unknown System', security: null };

        try {
            const cached = await getCachedUniverseName(systemId);
            if (cached && cached.name) return cached;

            const data = await esiClient.get(`/universe/systems/${systemId}/`);
            if (!data) return { name: 'Unknown System', security: null };

            await setCachedUniverseName(systemId, data.name, data.security_status);
            return { name: data.name, security: data.security_status };
        } catch (error) {
            console.error('Error fetching system name:', error);
            return { name: 'Unknown System', security: null };
        }
    }

    getRelativeTime(date) {
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 60) {
            return `${diffMins}m ago`;
        } else if (diffHours < 24) {
            return `${diffHours}h ago`;
        } else {
            return `${diffDays}d ago`;
        }
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

    createTopShipsHTML(ships) {
        if (!ships || ships.length === 0) {
            return '';
        }

        const shipsHTML = ships.map(ship => `
        <div class="zkill-ship-card">
            <div class="zkill-ship-info">
                <img src="https://images.evetech.net/types/${sanitizeId(ship.shipTypeID)}/icon?size=${IMAGE_PLACEHOLDER_SIZE_PX}"
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

    createTopLocationsHTML(locations) {
        if (!locations || locations.length === 0) {
            return '';
        }

        const displayCount = Math.min(locations.length, 15);
        const topLocations = locations.slice(0, displayCount);

        const locationsHTML = topLocations.map(location => {
            const secClass = this.getSecurityClass(location.securityStatus, location.systemName);
            const secFormatted = this.formatSecurity(location.securityStatus, location.systemName);

            return `
            <div class="zkill-location-detail-card">
                <div class="zkill-location-header">
                    <div class="zkill-location-system-info">
                        <a href="https://zkillboard.com/system/${sanitizeId(location.systemId)}/"
                           target="_blank"
                           class="zkill-location-system-name">
                            ${escapeHtml(location.systemName)}
                        </a>
                        <div class="zkill-location-sec-badge ${secClass}">
                            ${secFormatted}
                        </div>
                    </div>
                    <div class="zkill-location-kills-count">
                        ${location.kills} kills
                    </div>
                </div>
            </div>
        `;
        }).join('');

        const totalKills = topLocations.reduce((sum, loc) => sum + loc.kills, 0);
        const avgKillsPerSystem = Math.round(totalKills / topLocations.length);

        return `
        <div class="zkill-section">
            <h3 class="zkill-section-title">
                <span class="zkill-section-icon">🌍</span>
                Top Operating Locations
            </h3>
            <div class="zkill-location-summary">
                <div class="zkill-location-stat">
                    <span class="zkill-location-stat-label">Top ${displayCount} Systems</span>
                    <span class="zkill-location-stat-value">${this.formatNumber(totalKills)} kills</span>
                </div>
                <div class="zkill-location-stat">
                    <span class="zkill-location-stat-label">Average per System</span>
                    <span class="zkill-location-stat-value">${avgKillsPerSystem} kills</span>
                </div>
            </div>
            <div class="zkill-locations-detail-list">
                ${locationsHTML}
            </div>
        </div>
    `;
    }

    createTopPlayersHTML(topPlayers, entityType) {
        if (!topPlayers || topPlayers.length === 0 || entityType === 'character') {
            return '';
        }

        const playersHTML = topPlayers.map(player => `
        <div class="zkill-player-card"
             data-click-action="show-character"
             data-character-id="${sanitizeId(player.characterId)}"
             data-character-name="${sanitizeAttribute(player.characterName)}">
            <img src="https://images.evetech.net/characters/${sanitizeId(player.characterId)}/portrait?size=${IMAGE_PLACEHOLDER_SIZE_PX}"
                 alt="${sanitizeAttribute(player.characterName)}"
                 class="zkill-player-portrait"
                 loading="lazy">
            <div class="zkill-player-info">
                <div class="zkill-player-name">${sanitizeCharacterName(player.characterName)}</div>
                <div class="zkill-player-kills">${player.kills} kills</div>
            </div>
        </div>
    `).join('');

        return `
        <div class="zkill-section">
            <h3 class="zkill-section-title">
                <span class="zkill-section-icon">👤</span>
                Top Players
            </h3>
            <div class="zkill-players-grid">
                ${playersHTML}
            </div>
        </div>
    `;
    }

    createTacticalOverviewHTML(stats) {
        return `
        <div class="zkill-section zkill-tactical-overview">
            <h3 class="zkill-section-title">
                <span class="zkill-section-icon">🎯</span>
                PVP Summary
            </h3>
            <div class="zkill-tactical-grid">
                <div class="zkill-tactical-stat ${stats.dangerRatio > 2 ? 'dangerous' : stats.dangerRatio > 1 ? 'moderate' : 'safe'}">
                    <div class="zkill-tactical-icon">⚔️</div>
                    <div class="zkill-tactical-value">${this.formatDangerRatio(stats.dangerRatio)}</div>
                    <div class="zkill-tactical-label">K/D Ratio</div>
                </div>
                <div class="zkill-tactical-stat ${stats.efficiency > ZKILL_EFFICIENCY_THRESHOLD_HIGH ? 'high' : stats.efficiency > ZKILL_EFFICIENCY_THRESHOLD_MEDIUM ? 'moderate' : 'low'}">
                    <div class="zkill-tactical-icon">💰</div>
                    <div class="zkill-tactical-value">${stats.efficiency.toFixed(0)}%</div>
                    <div class="zkill-tactical-label">ISK Efficiency</div>
                </div>
                <div class="zkill-tactical-stat ${stats.gangRatio > ZKILL_GANG_RATIO_THRESHOLD_HIGH ? 'fleet' : stats.gangRatio < ZKILL_GANG_RATIO_THRESHOLD_LOW ? 'solo' : 'mixed'}">
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

    createTop10CombinedHTML(topShips, topPlayers, topLocations, entityType) {
        const hasShips = topShips && topShips.length > 0;
        const hasPlayers = topPlayers && topPlayers.length > 0 && entityType !== 'character';
        const hasLocations = topLocations && topLocations.length > 0;

        if (!hasShips && !hasPlayers && !hasLocations) {
            return '';
        }

        const shipsHTML = hasShips ? topShips.slice(0, 10).map(ship => `
            <div class="zkill-top10-item">
                <img src="https://images.evetech.net/types/${sanitizeId(ship.shipTypeID)}/icon?size=${IMAGE_PLACEHOLDER_SIZE_PX}"
                     alt="${sanitizeAttribute(ship.shipName)}"
                     class="zkill-top10-icon"
                     loading="lazy">
                <div class="zkill-top10-info">
                    <div class="zkill-top10-name">${escapeHtml(ship.shipName)}</div>
                    <div class="zkill-top10-value">${ship.kills} kills</div>
                </div>
            </div>
        `).join('') : '<div class="zkill-top10-empty">No ship data</div>';

        const playersHTML = hasPlayers ? topPlayers.slice(0, 10).map(player => `
            <div class="zkill-top10-item"
                 data-click-action="show-character"
                 data-character-id="${sanitizeId(player.characterId)}"
                 data-character-name="${sanitizeAttribute(player.characterName)}">
                <img src="https://images.evetech.net/characters/${sanitizeId(player.characterId)}/portrait?size=${IMAGE_PLACEHOLDER_SIZE_PX}"
                     alt="${sanitizeAttribute(player.characterName)}"
                     class="zkill-top10-portrait"
                     loading="lazy">
                <div class="zkill-top10-info">
                    <div class="zkill-top10-name">${sanitizeCharacterName(player.characterName)}</div>
                    <div class="zkill-top10-value">${player.kills} kills</div>
                </div>
            </div>
        `).join('') : (entityType === 'character' ? '' : '<div class="zkill-top10-empty">No player data</div>');

        const locationsHTML = hasLocations ? topLocations.slice(0, 10).map(location => {
            const secClass = this.getSecurityClass(location.securityStatus, location.systemName);
            const secFormatted = this.formatSecurity(location.securityStatus, location.systemName);
            return `
            <div class="zkill-top10-item">
                <div class="zkill-top10-sec-badge ${secClass}">${secFormatted}</div>
                <div class="zkill-top10-info">
                    <div class="zkill-top10-name">
                        <a href="https://zkillboard.com/system/${sanitizeId(location.systemId)}/"
                           target="_blank"
                           class="zkill-top10-link">
                            ${escapeHtml(location.systemName)}
                        </a>
                    </div>
                    <div class="zkill-top10-value">${location.kills} kills</div>
                </div>
            </div>
        `;
        }).join('') : '<div class="zkill-top10-empty">No location data</div>';

        return `
        <div class="zkill-top10-section">
            <div class="zkill-top10-grid">
                <div class="zkill-top10-column">
                    <h4 class="zkill-top10-column-title">
                        <span class="zkill-top10-column-icon">🌍</span>
                        Systems
                    </h4>
                    <div class="zkill-top10-list">
                        ${locationsHTML}
                    </div>
                </div>
                ${entityType !== 'character' ? `
                <div class="zkill-top10-column">
                    <h4 class="zkill-top10-column-title">
                        <span class="zkill-top10-column-icon">👤</span>
                        Players
                    </h4>
                    <div class="zkill-top10-list">
                        ${playersHTML}
                    </div>
                </div>
                ` : ''}
                <div class="zkill-top10-column">
                    <h4 class="zkill-top10-column-title">
                        <span class="zkill-top10-column-icon">🚀</span>
                        Ships
                    </h4>
                    <div class="zkill-top10-list">
                        ${shipsHTML}
                    </div>
                </div>
            </div>
        </div>
        `;
    }

    createPlaystyleTagsHTML(combatStyle) {
        if (!combatStyle || !combatStyle.playstyleDetails || combatStyle.playstyleDetails.length === 0) {
            return '';
        }

        const tags = combatStyle.playstyleDetails;

        return `
        <div class="zkill-section zkill-playstyle-tags">
            <div class="zkill-tags-container">
                ${tags.map(tag => `<span class="zkill-tag zkill-tag-${tag.toLowerCase().replace(/[\/\s]/g, '-')}">${tag}</span>`).join('')}
            </div>
        </div>
        `;
    }

    createThreatAssessmentHTML(securityPreference, combatStyle, activityInsights, shipAnalysis) {
        if (!securityPreference || !combatStyle) return '';

        const memberCount = combatStyle.memberCount;
        const activePlayerCount = combatStyle.activePlayerCount;

        let baseRiskLevel = securityPreference.riskProfile === 'High Risk' ? 'high' :
            securityPreference.riskProfile === 'Risk Averse' ? 'low' : 'moderate';

        let riskLevel = baseRiskLevel;
        let adjustedRiskProfile = securityPreference.riskProfile;

        if (memberCount && activePlayerCount) {
            const participationRate = (activePlayerCount / memberCount) * 100;

            if (participationRate < 1) {
                riskLevel = 'low';
                adjustedRiskProfile = 'Minimal Threat';
            } else if (participationRate < 5) {
                if (baseRiskLevel === 'high') {
                    riskLevel = 'low';
                    adjustedRiskProfile = 'Low Risk';
                } else if (baseRiskLevel === 'moderate') {
                    riskLevel = 'low';
                    adjustedRiskProfile = 'Low Risk';
                }
            } else if (participationRate < 15) {
                if (baseRiskLevel === 'high') {
                    riskLevel = 'moderate';
                    adjustedRiskProfile = 'Moderate Risk';
                }
            } else if (participationRate >= 40) {
                if (baseRiskLevel === 'low') {
                    riskLevel = 'moderate';
                    adjustedRiskProfile = 'Moderate Risk';
                } else if (baseRiskLevel === 'moderate') {
                    riskLevel = 'high';
                    adjustedRiskProfile = 'High Risk';
                }
            }
        }

        const sizeHTML = shipAnalysis?.sizeBreakdown ? shipAnalysis.sizeBreakdown.slice(0, BREAKDOWN_DISPLAY_LIMIT).map(item => `
            <div class="zkill-pref-item">
                <div class="zkill-pref-bar">
                    <div class="zkill-pref-fill size-${item.category.toLowerCase()}" style="width: ${item.percentage}%"></div>
                </div>
                <div class="zkill-pref-info">
                    <span class="zkill-pref-category">${item.category}</span>
                    <span class="zkill-pref-percent">${item.percentage}%</span>
                </div>
            </div>
        `).join('') : '';

        const specialization = shipAnalysis?.specialization;

        let participationInfo = '';
        if (memberCount && activePlayerCount) {
            const participationRate = Math.round((activePlayerCount / memberCount) * 100);
            participationInfo = `
                <div class="zkill-threat-item">
                    <span class="zkill-threat-label">Active Members:</span>
                    <span class="zkill-threat-value">${this.formatNumber(activePlayerCount)} / ${this.formatNumber(memberCount)} (${participationRate}%)</span>
                </div>`;
        }

        return `
        <div class="zkill-section zkill-threat-assessment">
            <h3 class="zkill-section-title">
                <span class="zkill-section-icon">🛡️</span>
                Threat Assessment
            </h3>
            <div class="zkill-threat-grid">
                <div class="zkill-threat-primary">
                    <div class="zkill-risk-indicator ${riskLevel}">
                        <div class="zkill-risk-icon">${riskLevel === 'high' ? '🔥' : riskLevel === 'low' ? '🛡️' : '⚠️'}</div>
                        <div class="zkill-risk-level">${adjustedRiskProfile}</div>
                        <div class="zkill-risk-space">Primarily ${securityPreference.primary}</div>
                    </div>
                </div>
                <div class="zkill-threat-details">
                    <div class="zkill-threat-item">
                        <span class="zkill-threat-label">Primary Role:</span>
                        <span class="zkill-threat-value">${combatStyle.primaryRole?.role || 'Unknown'}</span>
                    </div>
                    <div class="zkill-threat-item">
                        <span class="zkill-threat-label">Playstyle:</span>
                        <span class="zkill-threat-value">${combatStyle.fleetRole}</span>
                    </div>
                    <div class="zkill-threat-item">
                        <span class="zkill-threat-label">Activity Trend:</span>
                        <span class="zkill-threat-value ${activityInsights?.trend?.toLowerCase()}">${activityInsights?.trend || 'Unknown'}</span>
                    </div>
                    ${participationInfo}
                </div>
                ${shipAnalysis && sizeHTML ? `
                <div class="zkill-threat-ship-sizes">
                    ${specialization ? `
                    <div class="zkill-specialization-badge">
                        <span class="zkill-spec-icon">${specialization.type === 'Generalist' ? '🔄' : '🎯'}</span>
                        <span class="zkill-spec-text">${specialization.description}</span>
                    </div>
                    ` : ''}
                    <div class="zkill-size-breakdown">
                        ${sizeHTML}
                    </div>
                </div>
                ` : ''}
            </div>
        </div>
        `;
    }

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

    createCombinedStatsAndChartsHTML(stats, securityPreference, activityInsights, activePvPData, activityData) {
        const spaceChart = securityPreference && securityPreference.breakdown && securityPreference.breakdown.length > 0
            ? this.createSpacePieChart(securityPreference.breakdown)
            : '';

        const hasCharts = activityData && activityData.hasData;
        const hasActivityInsights = activityInsights != null;

        return `
        <div class="zkill-section zkill-stats-charts-combined">
            <h3 class="zkill-section-title">
                <span class="zkill-section-icon">📊</span>
                Activity & Statistics
            </h3>

            <div class="zkill-stats-row">
                <div class="zkill-stats-left">
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
                    ${hasActivityInsights ? `
                    <div class="zkill-activity-summary">
                        <div class="zkill-pattern-item">
                            <div class="zkill-pattern-icon">⏰</div>
                            <div class="zkill-pattern-info">
                                <div class="zkill-pattern-value">${activityInsights.primeTime}</div>
                                <div class="zkill-pattern-label">Prime Time</div>
                            </div>
                        </div>
                        <div class="zkill-pattern-item">
                            <div class="zkill-pattern-icon">🌍</div>
                            <div class="zkill-pattern-info">
                                <div class="zkill-pattern-value">${activityInsights.timezone}</div>
                                <div class="zkill-pattern-label">Timezone</div>
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
                        <div class="zkill-pattern-item">
                            <div class="zkill-pattern-icon">👥</div>
                            <div class="zkill-pattern-info">
                                <div class="zkill-pattern-value">${this.getOrgSize(stats.memberCount)}</div>
                                <div class="zkill-pattern-label">Org Size</div>
                            </div>
                        </div>
                        <div class="zkill-pattern-item">
                            <div class="zkill-pattern-icon">🚀</div>
                            <div class="zkill-pattern-info">
                                <div class="zkill-pattern-value">${activePvPData.ships || 0}</div>
                                <div class="zkill-pattern-label">Active Ships</div>
                            </div>
                        </div>
                    </div>
                    ` : ''}
                </div>
                ${spaceChart}
            </div>

            ${hasCharts ? `
            <div class="zkill-charts-row">
                ${this.createBarChart(activityData.hourlyData, 'Kills by Hour (EVE Time)', activityData.maxHourly)}
                ${this.createBarChart(activityData.dailyData, 'Kills by Day of Week', activityData.maxDaily)}
            </div>
            ` : ''}
        </div>
        `;
    }

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

    createCombatStyleHTML(combatStyle) {
        if (!combatStyle) return '';

        const secondaryRoleHTML = combatStyle.secondaryRole ? `
                <div class="zkill-combat-card">
                    <div class="zkill-combat-icon">🎯</div>
                    <div class="zkill-combat-label">Secondary Role</div>
                    <div class="zkill-combat-value">${combatStyle.secondaryRole.role} (${combatStyle.secondaryRole.percentage}%)</div>
                </div>` : '';

        return `
        <div class="zkill-section">
            <h3 class="zkill-section-title">
                <span class="zkill-section-icon">⚔️</span>
                Combat Style Profile
            </h3>
            <div class="zkill-combat-grid">
                <div class="zkill-combat-card">
                    <div class="zkill-combat-icon">⚔️</div>
                    <div class="zkill-combat-label">Primary Role</div>
                    <div class="zkill-combat-value">${combatStyle.primaryRole?.role || 'Unknown'} (${combatStyle.primaryRole?.percentage || 0}%)</div>
                </div>${secondaryRoleHTML}
                <div class="zkill-combat-card">
                    <div class="zkill-combat-icon">👥</div>
                    <div class="zkill-combat-label">Playstyle</div>
                    <div class="zkill-combat-value">${combatStyle.fleetRole}</div>
                    ${combatStyle.fleetSizeRange ? `<div class="zkill-combat-subtext">${combatStyle.fleetSizeRange.avg.toFixed(1)} avg fleet size</div>` : ''}
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

    close() {
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

    formatValue(value, thresholds) {
        for (const [threshold, suffix] of thresholds) {
            if (value >= threshold) {
                return (value / threshold).toFixed(1) + suffix;
            }
        }
        return value.toFixed(0);
    }

    formatNumber(num) {
        const thresholds = [
            [1000000, 'M'],
            [1000, 'k']
        ];
        return this.formatValue(num, thresholds);
    }

    formatISK(isk) {
        const thresholds = [
            [1000000000000, 'T'],
            [1000000000, 'B'],
            [1000000, 'M'],
            [1000, 'k']
        ];
        return this.formatValue(isk, thresholds);
    }

    formatSecurity(security, systemName) {
        if (security === null || security === undefined) {
            return 'Unknown';
        }

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
        } else if (security > -0.99) {
            return security.toFixed(1);
        } else {
            if (systemName && systemName[0] === 'J') {
                return 'WH';
            }
            const pochvenSystems = ['Skarkon', 'Archee', 'Kino', 'Konola', 'Krirald', 'Nalvula', 'Nani', 'Ala', 'Angymonne', 'Arvasaras', 'Harva', 'Ignebaener', 'Kuharah', 'Otanuomi', 'Otela', 'Senda', 'Vale', 'Wirashoda', 'Ahtila', 'Ichoriya', 'Kaunokka', 'Raravoss', 'Sakenta', 'Skarkon', 'Urhinichi'];
            if (pochvenSystems.includes(systemName)) {
                return 'POCH';
            }
            return 'WH';
        }
    }
}

const zkillStatsCard = new ZKillStatsCard();

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

export function getZkillCardInstance() {
    return zkillStatsCard;
}