/*
    EVE Target Intel - Killmail Analysis Engine

    Copyright (C) 2025 moregh (https://github.com/moregh/)
    Licensed under AGPL License.
*/

export function analyzeKillmails(killmails) {
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
        avgValue: calculateAverageValue(killmails)
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