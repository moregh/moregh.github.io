/*
    EVE Target Intel - Unified Threat Assessment Engine

    Copyright (C) 2025 moregh (https://github.com/moregh/)
    Licensed under AGPL License.
*/

import { THREAT_ASSESSMENT } from './config.js';

export class ThreatAssessment {
    constructor() {
        this.config = THREAT_ASSESSMENT;
    }

    assessThreat(zkillStats, killmailData) {
        const now = Date.now();
        const rawKillmails = killmailData?.rawKillmails || [];
        const analysis = killmailData?.analysis || {};

        const recencyScore = this.calculateRecencyScore(rawKillmails, now);
        const frequencyScore = this.calculateFrequencyScore(rawKillmails, zkillStats, now);
        const hvtScore = this.calculateHVTScore(analysis, zkillStats);
        const shipCapabilityScore = this.calculateShipCapabilityScore(analysis, zkillStats);
        const securityScore = this.calculateSecurityScore(zkillStats.securityPreference);
        const soloScore = this.calculateSoloScore(zkillStats, analysis);

        let totalScore = Math.round(
            recencyScore * this.config.RISK_WEIGHTS.RECENCY +
            frequencyScore * this.config.RISK_WEIGHTS.FREQUENCY +
            hvtScore * this.config.RISK_WEIGHTS.HVT_HUNTING +
            shipCapabilityScore * this.config.RISK_WEIGHTS.SHIP_CAPABILITY +
            securityScore * this.config.RISK_WEIGHTS.SECURITY_PREFERENCE +
            soloScore * this.config.RISK_WEIGHTS.SOLO_RATIO
        );

        if (zkillStats.combatStyle?.fleetRole === 'Blobber') {
            totalScore = Math.max(0, totalScore - 15);
        }
        if (zkillStats.combatStyle?.fleetRole === 'Fleet Fighter') {
            totalScore = Math.max(0, totalScore - 10);
        }

        // Bonus for active capital usage
        if (analysis?.capitalAnalysis?.isCapitalPilot) {
            const capBonus = this.config.RISK_SCORE?.CAPITAL_PILOT_BONUS || 10;
            totalScore = totalScore + capBonus;
        }

        const tags = this.generateTags(zkillStats, killmailData, rawKillmails, now);

        return {
            totalScore,
            breakdown: {
                recency: recencyScore,
                frequency: frequencyScore,
                hvt: hvtScore,
                shipCapability: shipCapabilityScore,
                security: securityScore,
                solo: soloScore
            },
            riskLevel: this.getRiskLevel(totalScore),
            tags,
            lastKillAge: this.getLastKillAge(rawKillmails, now)
        };
    }

    calculateRecencyScore(killmails, now) {
        if (!killmails || killmails.length === 0) return 0;

        const killTimes = killmails
            .map(km => new Date(km.killmail?.killmail_time).getTime())
            .filter(t => !isNaN(t))
            .sort((a, b) => b - a);

        if (killTimes.length === 0) return 0;

        const lastKillTime = killTimes[0];
        const ageMinutes = (now - lastKillTime) / (1000 * 60);
        const ageHours = ageMinutes / 60;
        const ageDays = ageHours / 24;

        const cfg = this.config.SCORING.RECENCY;

        if (ageMinutes < this.config.RECENCY.VERY_RECENT_THRESHOLD_MINUTES) {
            return cfg.VERY_RECENT_SCORE;
        }

        if (ageHours < cfg.TWO_HOUR_THRESHOLD) {
            return cfg.TWO_HOUR_SCORE;
        }

        if (ageHours < cfg.SIX_HOUR_THRESHOLD) {
            return cfg.SIX_HOUR_SCORE;
        }

        if (ageHours < cfg.ONE_DAY_THRESHOLD) {
            return cfg.ONE_DAY_SCORE;
        }

        if (ageDays < cfg.THREE_DAY_THRESHOLD) {
            return cfg.THREE_DAY_SCORE;
        }

        if (ageDays < cfg.SEVEN_DAY_THRESHOLD) {
            return cfg.SEVEN_DAY_SCORE;
        }

        if (ageDays < cfg.FOURTEEN_DAY_THRESHOLD) {
            return cfg.FOURTEEN_DAY_SCORE;
        }

        if (ageDays < cfg.THIRTY_DAY_THRESHOLD) {
            return cfg.THIRTY_DAY_SCORE;
        }

        return cfg.OLD_SCORE;
    }

    calculateFrequencyScore(killmails, zkillStats, now) {
        if (!zkillStats || zkillStats.totalKills === 0) return 0;

        const totalKills = zkillStats.totalKills;
        const cfg = this.config.SCORING.FREQUENCY;
        let score = 0;

        if (totalKills >= cfg.KILLS_5000_THRESHOLD) {
            score = cfg.KILLS_5000_SCORE;
        } else if (totalKills >= cfg.KILLS_2000_THRESHOLD) {
            score = cfg.KILLS_2000_SCORE;
        } else if (totalKills >= cfg.KILLS_1000_THRESHOLD) {
            score = cfg.KILLS_1000_SCORE;
        } else if (totalKills >= cfg.KILLS_500_THRESHOLD) {
            score = cfg.KILLS_500_SCORE;
        } else if (totalKills >= cfg.KILLS_250_THRESHOLD) {
            score = cfg.KILLS_250_SCORE;
        } else if (totalKills >= cfg.KILLS_100_THRESHOLD) {
            score = cfg.KILLS_100_SCORE;
        } else if (totalKills >= cfg.KILLS_50_THRESHOLD) {
            score = cfg.KILLS_50_SCORE;
        } else if (totalKills >= cfg.KILLS_25_THRESHOLD) {
            score = cfg.KILLS_25_SCORE;
        } else if (totalKills >= cfg.KILLS_10_THRESHOLD) {
            score = cfg.KILLS_10_SCORE;
        } else {
            score = totalKills * cfg.SCORE_MULTIPLIER_LOW;
        }

        if (killmails && killmails.length > 0) {
            const windowMs = this.config.FREQUENCY.FREQUENCY_WINDOW_DAYS * 24 * 60 * 60 * 1000;
            const cutoffTime = now - windowMs;

            const recentKills = killmails.filter(km => {
                const killTime = new Date(km.killmail?.killmail_time).getTime();
                return !isNaN(killTime) && killTime >= cutoffTime;
            });

            const killsPerDay = recentKills.length / this.config.FREQUENCY.FREQUENCY_WINDOW_DAYS;

            if (killsPerDay >= cfg.KILLS_PER_DAY_HIGH) {
                score = Math.min(100, score + cfg.RECENT_ACTIVITY_BONUS_HIGH);
            } else if (killsPerDay >= cfg.KILLS_PER_DAY_LOW) {
                score = Math.min(100, score + cfg.RECENT_ACTIVITY_BONUS_LOW);
            }
        }

        return score;
    }

    calculateHVTScore(analysis, zkillStats) {
        if (!analysis) return 0;

        const hvtData = analysis.hvtAnalysis;
        if (!hvtData) return 0;

        if (hvtData.isHVTHunter) {
            const cfg = this.config.SCORING.HVT;
            const freqScore = hvtData.hvtFrequency || 0;
            const countScore = Math.min(100, (hvtData.hvtCount / cfg.COUNT_DIVISOR) * 100);

            let confidenceMultiplier = cfg.CONFIDENCE_DEFAULT;
            if (hvtData.confidence === 'very high') confidenceMultiplier = cfg.CONFIDENCE_VERY_HIGH;
            else if (hvtData.confidence === 'high') confidenceMultiplier = cfg.CONFIDENCE_HIGH;
            else if (hvtData.confidence === 'medium') confidenceMultiplier = cfg.CONFIDENCE_MEDIUM;

            return Math.min(100, (freqScore + countScore) / 2 * confidenceMultiplier);
        }

        return 0;
    }

    calculateShipCapabilityScore(analysis, zkillStats) {
        const cfg = this.config.SCORING.SHIP_CAPABILITY;
        let score = 0;

        if (analysis?.blopsAnalysis?.isBlopsUser) {
            const conf = analysis.blopsAnalysis.confidence;
            if (conf === 'very high') score += cfg.BLOPS_VERY_HIGH_SCORE;
            else if (conf === 'high') score += cfg.BLOPS_HIGH_SCORE;
            else score += cfg.BLOPS_DEFAULT_SCORE;
        }

        if (analysis?.cynoAnalysis?.isCynoPilot) {
            const conf = analysis.cynoAnalysis.confidence;
            if (conf === 'very high') score += cfg.CYNO_VERY_HIGH_SCORE;
            else if (conf === 'high') score += cfg.CYNO_HIGH_SCORE;
            else score += cfg.CYNO_DEFAULT_SCORE;
        }

        if (analysis?.capitalAnalysis?.isCapitalPilot) {
            score += cfg.CAPITAL_SCORE;
        }

        return Math.min(100, score);
    }

    calculateSecurityScore(securityPreference) {
        const cfg = this.config.SCORING.SECURITY;

        if (!securityPreference || !securityPreference.breakdown) return cfg.DEFAULT_SCORE;

        const breakdown = securityPreference.breakdown;
        let score = 0;

        breakdown.forEach(item => {
            const pct = item.percentage / 100;
            if (item.space === 'W-Space') score += pct * cfg.WSPACE_SCORE;
            else if (item.space === 'Nullsec') score += pct * cfg.NULLSEC_SCORE;
            else if (item.space === 'Lowsec') score += pct * cfg.LOWSEC_SCORE;
            else if (item.space === 'Pochven') score += pct * cfg.POCHVEN_SCORE;
            else if (item.space === 'Highsec') score += pct * cfg.HIGHSEC_SCORE;
        });

        return Math.min(100, score);
    }

    calculateSoloScore(zkillStats, analysis) {
        const cfg = this.config.SCORING.SOLO;

        if (!zkillStats) return cfg.DEFAULT_SCORE;

        const soloRatio = zkillStats.totalKills > 0 ? zkillStats.soloKills / zkillStats.totalKills : 0;
        const gangRatio = zkillStats.gangRatio || 0;
        const dangerRatio = zkillStats.dangerRatio || 1;

        let score = cfg.BASE_SCORE;

        if (soloRatio >= cfg.SOLO_60_THRESHOLD) {
            score = cfg.SOLO_60_SCORE;
        } else if (soloRatio >= cfg.SOLO_40_THRESHOLD) {
            score = cfg.SOLO_40_SCORE;
        } else if (soloRatio >= cfg.SOLO_20_THRESHOLD) {
            score = cfg.SOLO_20_SCORE;
        } else if (soloRatio >= cfg.SOLO_10_THRESHOLD) {
            score = cfg.SOLO_10_SCORE;
        }

        if (gangRatio >= cfg.GANG_RATIO_THRESHOLD) {
            score = Math.min(100, score + cfg.GANG_BONUS);
        }

        if (dangerRatio >= cfg.DANGER_RATIO_HIGH) {
            score = Math.min(100, score + cfg.DANGER_BONUS_HIGH);
        } else if (dangerRatio >= cfg.DANGER_RATIO_MEDIUM) {
            score = Math.min(100, score + cfg.DANGER_BONUS_MEDIUM);
        }

        return Math.min(100, score);
    }

    generateTags(zkillStats, killmailData, rawKillmails, now) {
        const tags = [];

        const lastKillAge = this.getLastKillAge(rawKillmails, now);
        if (lastKillAge.minutes !== null) {
            if (lastKillAge.minutes < this.config.TAGS.ACTIVE_NOW_MINUTES) {
                tags.push('ACTIVE NOW');
            } else if (lastKillAge.hours < this.config.TAGS.ACTIVE_RECENTLY_HOURS) {
                tags.push('ACTIVE');
            }
        }

        const analysis = killmailData?.analysis;
        if (analysis) {
            if (analysis.hvtAnalysis?.isHVTHunter) {
                tags.push('HVT Hunter');
            }

            if (analysis.blopsAnalysis?.isBlopsUser) {
                tags.push('Blops');
            }

            if (analysis.cynoAnalysis?.isCynoPilot) {
                tags.push('Cyno');
            }

            if (analysis.soloVsFleet?.solo?.percentage >= this.config.TAGS.SOLO_HUNTER_MIN_PERCENT) {
                tags.push('Solo Hunter');
            } else if (analysis.soloVsFleet?.smallGang?.percentage >= this.config.TAGS.SMALL_GANG_MIN_PERCENT) {
                tags.push('Small Gang');
            } else if (analysis.soloVsFleet?.fleet?.percentage >= this.config.TAGS.FLEET_FIGHTER_MIN_PERCENT) {
                tags.push('Fleet Fighter');
            }

            if (analysis.fleetSizeAnalysis?.average >= this.config.TAGS.BLOB_MIN_AVERAGE_FLEET &&
                analysis.fleetSizeAnalysis?.max >= this.config.TAGS.BLOB_MIN_MAX_FLEET) {
                tags.push('Blob');
            }

            if (analysis.engagementPatterns?.huntingStyle === 'Gate Camp') {
                tags.push('Gate Camper');
            }
        }

        if (analysis?.capitalAnalysis?.isCapitalPilot) {
            tags.push('Capital');
        }

        return tags.slice(0, 3);
    }

    getLastKillAge(killmails, now) {
        if (!killmails || killmails.length === 0) {
            return { minutes: null, hours: null, days: null };
        }

        const killTimes = killmails
            .map(km => new Date(km.killmail?.killmail_time).getTime())
            .filter(t => !isNaN(t))
            .sort((a, b) => b - a);

        if (killTimes.length === 0) {
            return { minutes: null, hours: null, days: null };
        }

        const lastKillTime = killTimes[0];
        const ageMs = now - lastKillTime;
        const ageMinutes = Math.floor(ageMs / (1000 * 60));
        const ageHours = Math.floor(ageMs / (1000 * 60 * 60));
        const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));

        return {
            minutes: ageMinutes,
            hours: ageHours,
            days: ageDays
        };
    }

    getRiskLevel(score) {
        const cfg = this.config.SCORING.THREAT_LEVELS;

        if (score >= cfg.EXTREME_THRESHOLD) return `Extreme Threat (${score})`;
        if (score >= cfg.VERY_HIGH_THRESHOLD) return `Very High Threat (${score})`;
        if (score >= cfg.HIGH_THRESHOLD) return `High Threat (${score})`;
        if (score >= cfg.ELEVATED_THRESHOLD) return `Elevated Threat (${score})`;
        if (score >= cfg.MODERATE_THRESHOLD) return `Moderate Threat (${score})`;
        if (score >= cfg.LOW_THRESHOLD) return `Low Threat (${score})`;
        return `Minimal Threat (${score})`;
    }

}

const threatAssessmentEngine = new ThreatAssessment();

export function assessEntityThreat(zkillStats, killmailData) {
    return threatAssessmentEngine.assessThreat(zkillStats, killmailData);
}
