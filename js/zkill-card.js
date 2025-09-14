/*
    War Target Finder - zKillboard Stats Card Component
    
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

/**
 * zKillboard Stats Card Manager
 */
class ZKillStatsCard {
    constructor() {
        this.currentModal = null;
        this.isVisible = false;
        this.setupEventListeners();
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

        // Show modal with animation
        requestAnimationFrame(() => {
            this.currentModal.classList.add('show');
            this.isVisible = true;
        });

        // Load stats data
        try {
            const stats = await this.loadStats(apiType, entityId);
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

    /**
     * Create activity charts section HTML
     */
    /**
 * Create activity charts section HTML
 */
/**
 * Create activity charts section HTML
 */
createActivityChartsHTML(activityData) {
    if (!activityData || !activityData.hasData) {
        return `
            <div class="zkill-section">
                <h3 class="zkill-section-title">
                    <span class="zkill-section-icon">📊</span>
                    Activity Patterns
                </h3>
                <div class="zkill-charts-empty">
                    <div class="zkill-empty-icon">📈</div>
                    <div class="zkill-empty-text">No activity data available</div>
                </div>
            </div>
        `;
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
        <div class="zkill-section">
            <h3 class="zkill-section-title">
                <span class="zkill-section-icon">📊</span>
                Activity Patterns
            </h3>
            <div class="zkill-charts-grid">
                ${hourlyChart}
                ${dailyChart}
            </div>
        </div>
    `;
}
    /**
     * Create modal DOM structure
     */
    createModalStructure(entityType, entityId, entityName) {
        const modal = document.createElement('div');
        modal.className = 'zkill-modal-backdrop';

        const avatarSize = entityType === 'character' ? CHARACTER_PORTRAIT_SIZE_PX :
            entityType === 'corporation' ? CORP_LOGO_SIZE_PX : ALLIANCE_LOGO_SIZE_PX;

        modal.innerHTML = `
            <div class="zkill-stats-card">
                <div class="zkill-card-header">
                    <div class="zkill-entity-info">
                        <img src="https://images.evetech.net/${entityType === 'character' ? 'characters' : entityType + 's'}/${entityId}/${entityType === 'character' ? 'portrait' : 'logo'}?size=${avatarSize}"
                             alt="${entityName}" 
                             class="zkill-entity-avatar"
                             loading="eager">
                        <div class="zkill-entity-details">
                            <h2>${this.escapeHtml(entityName)} <span class="zkill-stats-icon">⚔️</span></h2>
                            <div class="zkill-entity-type">${entityType}</div>
                        </div>
                    </div>
                    <button class="zkill-close-btn" title="Close">✕</button>
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

        return modal;
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
    createStatsHTML(stats, entityType, entityId) {
        return `
        <!-- Main Stats Grid -->
        <div class="zkill-stats-grid">
            <div class="zkill-stat-item kills">
                <span class="zkill-stat-value">${this.formatNumber(stats.totalKills)}</span>
                <div class="zkill-stat-label">Total Kills</div>
            </div>
            <div class="zkill-stat-item kills">
                <span class="zkill-stat-value">${this.formatISK(stats.iskDestroyed)}</span>
                <div class="zkill-stat-label">ISK Destroyed</div>
            </div>
            <div class="zkill-stat-item kills">
                <span class="zkill-stat-value">${this.formatNumber(stats.soloKills)}</span>
                <div class="zkill-stat-label">Solo Kills</div>
            </div>
            
            
            <div class="zkill-stat-item losses">
                <span class="zkill-stat-value">${this.formatNumber(stats.totalLosses)}</span>
                <div class="zkill-stat-label">Total Losses</div>
            </div>
            <div class="zkill-stat-item losses">
                    <span class="zkill-stat-value">${this.formatISK(stats.iskLost)}</span>
                    <div class="zkill-stat-label">ISK Lost</div>
                </div>
            <div class="zkill-stat-item losses">
                <span class="zkill-stat-value">${this.formatNumber(stats.soloLosses)}</span>
                <div class="zkill-stat-label">Solo Losses</div>
            </div>
            <div class="zkill-stat-item">
                <span class="zkill-stat-value">${this.formatDangerRatio(stats.dangerRatio)}</span>
                <div class="zkill-stat-label">Kill/Death Ratio</div>
            </div>                    
                <div class="zkill-stat-item efficiency">
                    <span class="zkill-stat-value">${stats.efficiency.toFixed(2)}%</span>
                <div class="zkill-stat-label">ISK Efficiency</div>
            </div>
            <div class="zkill-stat-item">
                <span class="zkill-stat-value">${stats.gangRatio}%</span>
                <div class="zkill-stat-label">Gang Activity</div>
            </div>
            </div>
        </div>
        ${this.createActivityChartsHTML(stats.activityData)}
        <!-- Recent Activity - Using activepvp data -->
        <div class="zkill-section">
            <h3 class="zkill-section-title">
                <span class="zkill-section-icon">📊</span>
                Recent PvP Activity
            </h3>
            <div class="zkill-activity-grid">
                <div class="zkill-activity-card">
                    <div class="zkill-activity-icon">👤</div>
                    <div class="zkill-activity-number">${stats.recentActivity.activePvPData.characters}</div>
                    <div class="zkill-activity-label">Characters</div>
                </div>
                <div class="zkill-activity-card">
                    <div class="zkill-activity-icon">🚀</div>
                    <div class="zkill-activity-number">${stats.recentActivity.activePvPData.ships}</div>
                    <div class="zkill-activity-label">Ship Types</div>
                </div>
                <div class="zkill-activity-card">
                    <div class="zkill-activity-icon">⚔️</div>
                    <div class="zkill-activity-number">${stats.recentActivity.activePvPData.totalKills}</div>
                    <div class="zkill-activity-label">Recent Kills</div>
                </div>
                <div class="zkill-activity-card">
                    <div class="zkill-activity-icon">🌍</div>
                    <div class="zkill-activity-number">${stats.recentActivity.activePvPData.systems}</div>
                    <div class="zkill-activity-label">Systems</div>
                </div>
                <div class="zkill-activity-card">
                    <div class="zkill-activity-icon">🗺️</div>
                    <div class="zkill-activity-number">${stats.recentActivity.activePvPData.regions}</div>
                    <div class="zkill-activity-label">Regions</div>
                </div>
            </div>
        </div>

        <!-- Top Locations -->
        ${this.createTopLocationsHTML(stats.topLocations)}

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


    /**
     * Create top locations HTML
     */
    /**
 * Create top locations HTML
 */
    createTopLocationsHTML(locations) {
        if (!locations || locations.length === 0) {
            return `
            <div class="zkill-section">
                <h3 class="zkill-section-title">
                    <span class="zkill-section-icon">🌍</span>
                    Top PVP Locations
                </h3>
                <div style="text-align: center; color: var(--text-muted); padding: 2rem;">
                    No location data available
                </div>
            </div>
        `;
        }

        const locationsHTML = locations.map(location => `
        <div class="zkill-location-card">
            <div class="zkill-location-name">
                <a href="https://zkillboard.com/system/${this.escapeHtml(location.systemId)}/" 
                target="_blank"
                style="color: var(--primary-color); text-decoration: none; font-weight: 600;">
                    ${this.escapeHtml(location.systemName)}
                </a>
            </div>
            <div class="zkill-location-bottom">
                <div class="zkill-location-security ${this.getSecurityClass(location.securityStatus)}">
                    ${this.formatSecurity(location.securityStatus)}
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
     * Create empty state HTML
     */
    createEmptyStateHTML(entityName) {
        return `
            <div class="zkill-empty">
                <div class="zkill-empty-icon">📊</div>
                <div class="zkill-empty-text">No killboard data found</div>
                <div style="color: var(--text-secondary); font-size: 0.9rem; margin-top: 0.5rem;">
                    ${this.escapeHtml(entityName)} has no recorded kills or losses on zKillboard.
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
                <div class="zkill-error-details">${this.escapeHtml(message)}</div>
            </div>
        `;
    }

    /**
     * Close modal
     */
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

    formatSecurity(security) {
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
            return 'WH'
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

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
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