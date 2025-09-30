/*
    EVE Target Intel - Killmail Analysis Engine

    Copyright (C) 2025 moregh (https://github.com/moregh/)
    Licensed under AGPL License.
*/

export function analyzeKillmails(killmails, entityType = null, entityId = null) {
    if (!Array.isArray(killmails) || killmails.length === 0) {
        return null;
    }

    const analysis = {
        totalKillmails: killmails.length,
        mostExpensiveKill: findMostExpensiveKill(killmails),
        fleetSizeAnalysis: analyzeFleetSizes(killmails),
        shipComposition: analyzeShipComposition(killmails),
        weaponPreferences: analyzeWeaponUsage(killmails),
        timeAnalysis: analyzeKillTimes(killmails),
        soloVsFleet: analyzeSoloVsFleet(killmails),
        avgValue: calculateAverageValue(killmails),
        hvtAnalysis: analyzeHighValueTargets(killmails),
        targetPreferences: analyzeTargetPreferences(killmails),
        engagementPatterns: analyzeEngagementPatterns(killmails),
        blopsAnalysis: analyzeBlackOpsActivity(killmails, entityType, entityId),
        cynoAnalysis: analyzeCynoActivity(killmails, entityType, entityId)
    };

    return analysis;
}

function findMostExpensiveKill(killmails) {
    if (!killmails.length) return null;

    const mostExpensive = killmails.reduce((max, km) => {
        const value = km.zkbData?.totalValue || 0;
        const maxValue = max?.zkbData?.totalValue || 0;
        return value > maxValue ? km : max;
    }, killmails[0]);

    return {
        killmailId: mostExpensive.killmailId,
        value: mostExpensive.zkbData?.totalValue || 0,
        victimShipTypeId: mostExpensive.killmail?.victim?.ship_type_id,
        attackers: mostExpensive.killmail?.attackers?.length || 0,
        time: mostExpensive.killmail?.killmail_time
    };
}

function analyzeFleetSizes(killmails) {
    const sizes = killmails.map(km => km.killmail?.attackers?.length || 0);

    if (sizes.length === 0) return null;

    const avg = sizes.reduce((sum, s) => sum + s, 0) / sizes.length;
    const max = Math.max(...sizes);
    const min = Math.min(...sizes);

    const sizeRanges = {
        solo: sizes.filter(s => s === 1).length,
        small: sizes.filter(s => s >= 2 && s <= 5).length,
        medium: sizes.filter(s => s >= 6 && s <= 15).length,
        large: sizes.filter(s => s >= 16 && s <= 50).length,
        blob: sizes.filter(s => s > 50).length
    };

    return {
        average: Math.round(avg * 10) / 10,
        min,
        max,
        sizeRanges
    };
}

function analyzeShipComposition(killmails) {
    const shipCounts = new Map();

    killmails.forEach(km => {
        const attackers = km.killmail?.attackers || [];
        attackers.forEach(attacker => {
            const shipId = attacker.ship_type_id;
            if (shipId) {
                shipCounts.set(shipId, (shipCounts.get(shipId) || 0) + 1);
            }
        });
    });

    const topShips = Array.from(shipCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([shipId, count]) => ({
            shipTypeId: shipId,
            count
        }));

    return {
        uniqueShips: shipCounts.size,
        topShips,
        totalShipsSeen: Array.from(shipCounts.values()).reduce((sum, c) => sum + c, 0)
    };
}

function analyzeWeaponUsage(killmails) {
    const weaponCounts = new Map();

    killmails.forEach(km => {
        const attackers = km.killmail?.attackers || [];
        attackers.forEach(attacker => {
            const weaponId = attacker.weapon_type_id;
            if (weaponId && weaponId !== attacker.ship_type_id) {
                weaponCounts.set(weaponId, (weaponCounts.get(weaponId) || 0) + 1);
            }
        });
    });

    const topWeapons = Array.from(weaponCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([weaponId, count]) => ({
            weaponTypeId: weaponId,
            count
        }));

    return {
        uniqueWeapons: weaponCounts.size,
        topWeapons
    };
}

function analyzeKillTimes(killmails) {
    const hourCounts = new Array(24).fill(0);

    killmails.forEach(km => {
        const time = km.killmail?.killmail_time;
        if (time) {
            const date = new Date(time);
            const hour = date.getUTCHours();
            hourCounts[hour]++;
        }
    });

    const maxHour = hourCounts.indexOf(Math.max(...hourCounts));
    const minHour = hourCounts.indexOf(Math.min(...hourCounts.filter(c => c > 0)));

    return {
        hourlyDistribution: hourCounts,
        peakHour: maxHour,
        quietestHour: minHour
    };
}

function analyzeSoloVsFleet(killmails) {
    let soloKills = 0;
    let smallGangKills = 0;
    let fleetKills = 0;

    killmails.forEach(km => {
        const attackers = km.killmail?.attackers?.length || 0;
        if (attackers === 1) {
            soloKills++;
        } else if (attackers <= 5) {
            smallGangKills++;
        } else {
            fleetKills++;
        }
    });

    const total = killmails.length;

    return {
        solo: {
            count: soloKills,
            percentage: total > 0 ? Math.round((soloKills / total) * 100) : 0
        },
        smallGang: {
            count: smallGangKills,
            percentage: total > 0 ? Math.round((smallGangKills / total) * 100) : 0
        },
        fleet: {
            count: fleetKills,
            percentage: total > 0 ? Math.round((fleetKills / total) * 100) : 0
        }
    };
}

function calculateAverageValue(killmails) {
    if (!killmails.length) return 0;

    const total = killmails.reduce((sum, km) => sum + (km.zkbData?.totalValue || 0), 0);
    return Math.round(total / killmails.length);
}

export function getRecentKills(killmails, limit = 5) {
    if (!Array.isArray(killmails) || killmails.length === 0) {
        return [];
    }

    return killmails
        .sort((a, b) => {
            const timeA = new Date(a.killmail?.killmail_time || 0);
            const timeB = new Date(b.killmail?.killmail_time || 0);
            return timeB - timeA;
        })
        .slice(0, limit)
        .map(km => ({
            killmailId: km.killmailId,
            value: km.zkbData?.totalValue || 0,
            victimShipTypeId: km.killmail?.victim?.ship_type_id,
            attackers: km.killmail?.attackers?.length || 0,
            time: km.killmail?.killmail_time,
            systemId: km.killmail?.solar_system_id,
            systemSecurity: km.killmail?.solar_system_security
        }));
}

export function getTopValueKills(killmails, limit = 5) {
    if (!Array.isArray(killmails) || killmails.length === 0) {
        return [];
    }

    return killmails
        .sort((a, b) => (b.zkbData?.totalValue || 0) - (a.zkbData?.totalValue || 0))
        .slice(0, limit)
        .map(km => ({
            killmailId: km.killmailId,
            value: km.zkbData?.totalValue || 0,
            victimShipTypeId: km.killmail?.victim?.ship_type_id,
            attackers: km.killmail?.attackers?.length || 0,
            time: km.killmail?.killmail_time,
            systemId: km.killmail?.solar_system_id
        }));
}

function analyzeHighValueTargets(killmails) {
    if (!killmails.length) {
        return {
            isHVTHunter: false,
            confidence: 'insufficient',
            hvtCount: 0,
            hvtFrequency: 0,
            avgHVTValue: 0,
            thresholds: {}
        };
    }

    const thresholds = {
        high: 500000000,      // 500M ISK
        veryHigh: 1000000000, // 1B ISK
        extreme: 5000000000   // 5B ISK
    };

    const hvtKills = {
        high: killmails.filter(km => (km.zkbData?.totalValue || 0) >= thresholds.high),
        veryHigh: killmails.filter(km => (km.zkbData?.totalValue || 0) >= thresholds.veryHigh),
        extreme: killmails.filter(km => (km.zkbData?.totalValue || 0) >= thresholds.extreme)
    };

    const totalKills = killmails.length;
    const hvtCount = hvtKills.high.length;
    const hvtFrequency = totalKills > 0 ? hvtCount / totalKills : 0;

    const avgHVTValue = hvtCount > 0
        ? hvtKills.high.reduce((sum, km) => sum + (km.zkbData?.totalValue || 0), 0) / hvtCount
        : 0;

    const avgNormalValue = calculateAverageValue(killmails.filter(km => (km.zkbData?.totalValue || 0) < thresholds.high));
    const hvtToNormalRatio = avgNormalValue > 0 ? avgHVTValue / avgNormalValue : 0;

    const timeSpread = analyzeHVTTimeSpread(hvtKills.high);

    let confidence = 'low';
    if (totalKills >= 50 && hvtCount >= 5) confidence = 'high';
    else if (totalKills >= 20 && hvtCount >= 3) confidence = 'medium';
    else if (hvtCount >= 3) confidence = 'low';
    else confidence = 'insufficient';

    const isHVTHunter = hvtCount >= 3 && hvtFrequency >= 0.15 && confidence !== 'insufficient';

    return {
        isHVTHunter,
        confidence,
        hvtCount,
        veryHighCount: hvtKills.veryHigh.length,
        extremeCount: hvtKills.extreme.length,
        hvtFrequency: Math.round(hvtFrequency * 100),
        avgHVTValue,
        hvtToNormalRatio: Math.round(hvtToNormalRatio * 10) / 10,
        timeSpread,
        thresholds,
        sampleSize: totalKills
    };
}

function analyzeHVTTimeSpread(hvtKills) {
    if (hvtKills.length < 2) {
        return { spread: 'insufficient', consistent: false };
    }

    const times = hvtKills
        .map(km => new Date(km.killmail?.killmail_time).getTime())
        .filter(t => !isNaN(t))
        .sort((a, b) => a - b);

    if (times.length < 2) {
        return { spread: 'insufficient', consistent: false };
    }

    const daysBetween = (times[times.length - 1] - times[0]) / (1000 * 60 * 60 * 24);
    const avgDaysBetweenKills = daysBetween / (times.length - 1);

    let spread = 'sporadic';
    if (avgDaysBetweenKills < 7) spread = 'frequent';
    else if (avgDaysBetweenKills < 30) spread = 'regular';
    else if (avgDaysBetweenKills < 90) spread = 'occasional';

    const consistent = times.length >= 3 && daysBetween > 7;

    return {
        spread,
        consistent,
        daySpan: Math.round(daysBetween),
        avgDaysBetween: Math.round(avgDaysBetweenKills)
    };
}

function analyzeTargetPreferences(killmails) {
    if (!killmails.length) {
        return null;
    }

    const victims = killmails.map(km => km.killmail?.victim).filter(v => v);

    if (!victims.length) {
        return null;
    }

    const shipSizes = categorizeShipSizes(victims);
    const totalVictims = victims.length;

    const industrialCount = victims.filter(v => isIndustrialShip(v.ship_type_id)).length;
    const capitalCount = victims.filter(v => isCapitalShip(v.ship_type_id)).length;

    const preferredSize = Object.entries(shipSizes)
        .sort((a, b) => b[1] - a[1])[0];

    return {
        shipSizes: Object.fromEntries(
            Object.entries(shipSizes).map(([size, count]) => [
                size,
                { count, percentage: Math.round((count / totalVictims) * 100) }
            ])
        ),
        preferredTargetSize: preferredSize ? preferredSize[0] : 'Mixed',
        industrialHunter: industrialCount / totalVictims > 0.3,
        capitalHunter: capitalCount / totalVictims > 0.15,
        industrialCount,
        capitalCount,
        totalVictims
    };
}

function categorizeShipSizes(victims) {
    const sizes = {
        'Frigates': 0,
        'Destroyers': 0,
        'Cruisers': 0,
        'Battlecruisers': 0,
        'Battleships': 0,
        'Capitals': 0,
        'Industrial': 0,
        'Other': 0
    };

    victims.forEach(victim => {
        const shipId = victim.ship_type_id;
        if (isCapitalShip(shipId)) sizes['Capitals']++;
        else if (isIndustrialShip(shipId)) sizes['Industrial']++;
        else sizes['Other']++;
    });

    return sizes;
}

function isCapitalShip(shipTypeId) {
    const capitalGroupIds = [547, 485, 883, 659, 30];
    return false;
}

function isIndustrialShip(shipTypeId) {
    const industrialGroupIds = [28, 941, 380, 543];
    return false;
}

function analyzeEngagementPatterns(killmails) {
    if (!killmails.length) {
        return null;
    }

    const systemKills = new Map();
    const killTimestamps = [];

    killmails.forEach(km => {
        const systemId = km.killmail?.solar_system_id;
        const time = km.killmail?.killmail_time;

        if (systemId) {
            systemKills.set(systemId, (systemKills.get(systemId) || 0) + 1);
        }

        if (time) {
            killTimestamps.push(new Date(time).getTime());
        }
    });

    const maxSystemKills = Math.max(...Array.from(systemKills.values()));
    const systemConcentration = systemKills.size > 0 ? maxSystemKills / killmails.length : 0;

    let huntingStyle = 'Roaming';
    if (systemConcentration > 0.5) huntingStyle = 'Gate Camp';
    else if (systemConcentration > 0.3) huntingStyle = 'Territorial';

    const killSpacing = analyzeKillSpacing(killTimestamps);

    return {
        huntingStyle,
        systemConcentration: Math.round(systemConcentration * 100),
        uniqueSystems: systemKills.size,
        killSpacing,
        territorialBehavior: systemConcentration > 0.3
    };
}

function analyzeKillSpacing(timestamps) {
    if (timestamps.length < 2) {
        return { avgMinutes: 0, pattern: 'insufficient' };
    }

    timestamps.sort((a, b) => a - b);

    const gaps = [];
    for (let i = 1; i < timestamps.length; i++) {
        gaps.push((timestamps[i] - timestamps[i-1]) / (1000 * 60));
    }

    const avgMinutes = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;

    let pattern = 'sporadic';
    if (avgMinutes < 30) pattern = 'rapid';
    else if (avgMinutes < 120) pattern = 'active';
    else if (avgMinutes < 1440) pattern = 'moderate';

    return {
        avgMinutes: Math.round(avgMinutes),
        pattern,
        minGap: Math.round(Math.min(...gaps)),
        maxGap: Math.round(Math.max(...gaps))
    };
}

function analyzeBlackOpsActivity(killmails, entityType = null, entityId = null) {
    if (!killmails.length) {
        return {
            isBlopsUser: false,
            confidence: 'insufficient',
            blopsCount: 0,
            blopsFrequency: 0
        };
    }

    const BLACK_OPS_GROUP_ID = 898;

    const BLACK_OPS_SHIP_IDS = [
        22456, // Panther
        22464, // Widow
        22466, // Redeemer
        22460, // Sin
        28844, // Marshal (AT ship)
        42125, // Virtuoso (AT ship)
        42246  // Chameleon (AT ship)
    ];

    let blopsKillCount = 0;
    let blopsShipsUsed = new Set();
    let totalPlayerShips = 0;

    killmails.forEach(km => {
        const attackers = km.killmail?.attackers || [];

        let playerAttacker = null;
        if (entityType === 'characterID' && entityId) {
            playerAttacker = attackers.find(a => a.character_id === entityId);
        } else if (entityType === 'corporationID' && entityId) {
            playerAttacker = attackers.find(a => a.corporation_id === entityId);
        } else if (entityType === 'allianceID' && entityId) {
            playerAttacker = attackers.find(a => a.alliance_id === entityId);
        } else {
            playerAttacker = attackers.find(a => a.character_id && a.final_blow);
        }

        if (!playerAttacker) return;

        const playerShipId = playerAttacker.ship_type_id;
        const playerGroupId = playerAttacker.ship_group_id;

        if (playerShipId && (BLACK_OPS_SHIP_IDS.includes(playerShipId) || playerGroupId === BLACK_OPS_GROUP_ID)) {
            totalPlayerShips++;
            blopsShipsUsed.add(playerShipId);
            blopsKillCount++;
        }
    });

    const totalKills = killmails.length;
    const blopsFrequency = totalKills > 0 ? blopsKillCount / totalKills : 0;

    let confidence = 'insufficient';
    if (totalKills >= 50 && blopsKillCount >= 5) confidence = 'high';
    else if (totalKills >= 20 && blopsKillCount >= 3) confidence = 'medium';
    else if (blopsKillCount >= 2) confidence = 'low';

    const isBlopsUser = blopsKillCount >= 3 && blopsFrequency >= 0.1;

    const blopsFleetDetected = detectBlopsFleetActivity(killmails, BLACK_OPS_SHIP_IDS);

    return {
        isBlopsUser,
        confidence,
        blopsCount: blopsKillCount,
        blopsFrequency: Math.round(blopsFrequency * 100),
        uniqueBlopsShips: blopsShipsUsed.size,
        totalBlopsShipsUsed: totalPlayerShips,
        fleetActivity: blopsFleetDetected,
        sampleSize: totalKills
    };
}

function detectBlopsFleetActivity(killmails, blopsShipIds) {
    let fleetsWithBlops = 0;
    let totalBlopsInFleets = 0;
    let avgBlopsPerFleet = 0;

    killmails.forEach(km => {
        const attackers = km.killmail?.attackers || [];
        const blopsInThisKill = attackers.filter(a =>
            a.ship_type_id && blopsShipIds.includes(a.ship_type_id)
        ).length;

        if (blopsInThisKill > 0) {
            fleetsWithBlops++;
            totalBlopsInFleets += blopsInThisKill;
        }
    });

    if (fleetsWithBlops > 0) {
        avgBlopsPerFleet = totalBlopsInFleets / fleetsWithBlops;
    }

    let fleetType = 'Solo Blops';
    if (avgBlopsPerFleet >= 3) fleetType = 'Blops Fleet';
    else if (avgBlopsPerFleet >= 1.5) fleetType = 'Small Blops Gang';

    return {
        fleetsWithBlops,
        avgBlopsPerFleet: Math.round(avgBlopsPerFleet * 10) / 10,
        fleetType,
        coordinated: avgBlopsPerFleet >= 2
    };
}

function analyzeCynoActivity(killmails, entityType = null, entityId = null) {
    if (!killmails.length) {
        return {
            isCynoPilot: false,
            confidence: 'insufficient',
            cynoShipCount: 0,
            cynoFrequency: 0
        };
    }

    const CYNO_SHIP_IDS = [
        670,    // Capsule (often used for suicide cynos)
        33328,  // Prospect (covert cyno)
        33816,  // Endurance (covert cyno capable)
        11129,  // Talos (common cyno ship)
        11176,  // Brutix (common cyno ship)
        28710,  // Sunesis (common cyno ship)
        33470,  // Astero (covert cyno)
        11172   // Catalyst (common cheap cyno)
    ];

    const FORCE_RECON_SHIP_GROUP_ID = 833;

    let cynoKillCount = 0;
    let cynoShipsUsed = new Set();
    let suspiciousCynoPatterns = 0;

    killmails.forEach(km => {
        const attackers = km.killmail?.attackers || [];

        let playerAttacker = null;
        if (entityType === 'characterID' && entityId) {
            playerAttacker = attackers.find(a => a.character_id === entityId);
        } else if (entityType === 'corporationID' && entityId) {
            playerAttacker = attackers.find(a => a.corporation_id === entityId);
        } else if (entityType === 'allianceID' && entityId) {
            playerAttacker = attackers.find(a => a.alliance_id === entityId);
        } else {
            playerAttacker = attackers.find(a => a.character_id && a.final_blow);
        }

        if (!playerAttacker) return;

        const playerShipId = playerAttacker.ship_type_id;
        const playerGroupId = playerAttacker.ship_group_id;

        if (playerShipId && (CYNO_SHIP_IDS.includes(playerShipId) || playerGroupId === FORCE_RECON_SHIP_GROUP_ID)) {
            cynoShipsUsed.add(playerShipId);

            const hasCapitalsOnKill = attackers.some(a => isCapitalShipType(a.ship_type_id));
            const hasBlopsOnKill = attackers.some(a => isBlackOpsShipType(a.ship_type_id));

            if (hasCapitalsOnKill || hasBlopsOnKill) {
                cynoKillCount++;
                suspiciousCynoPatterns++;
            } else {
                cynoKillCount++;
            }
        }
    });

    const totalKills = killmails.length;
    const cynoFrequency = totalKills > 0 ? cynoKillCount / totalKills : 0;

    let confidence = 'insufficient';
    if (totalKills >= 30 && cynoKillCount >= 5) confidence = 'high';
    else if (totalKills >= 15 && cynoKillCount >= 3) confidence = 'medium';
    else if (cynoKillCount >= 2) confidence = 'low';

    const isCynoPilot = cynoKillCount >= 3 && cynoFrequency >= 0.15;

    let cynoRole = 'Unknown';
    if (suspiciousCynoPatterns >= 2) {
        cynoRole = 'Hot Drop Cyno';
    } else if (cynoKillCount >= 3) {
        cynoRole = 'Cyno Alt';
    }

    return {
        isCynoPilot,
        confidence,
        cynoShipCount: cynoKillCount,
        cynoFrequency: Math.round(cynoFrequency * 100),
        uniqueCynoShips: cynoShipsUsed.size,
        cynoRole,
        hotDropSupport: suspiciousCynoPatterns,
        sampleSize: totalKills
    };
}

function isCapitalShipType(shipTypeId) {
    const CAPITAL_GROUP_IDS = [485, 547, 659, 30, 1538, 4594, 883];
    return false;
}

function isBlackOpsShipType(shipTypeId) {
    const BLACK_OPS_IDS = [22456, 22464, 22466, 22460, 28844, 42125, 42246];
    return BLACK_OPS_IDS.includes(shipTypeId);
}