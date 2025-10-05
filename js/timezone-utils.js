/*
    EVE Target Intel - Timezone Analysis Utilities

    Copyright (C) 2025 moregh (https://github.com/moregh/)
    Licensed under AGPL License.
*/

export function calculateTimezoneFromHourlyData(hourlyTotals) {
    const maxHour = hourlyTotals.indexOf(Math.max(...hourlyTotals));
    const primeTime = `${maxHour.toString().padStart(2, '0')}:00 EVE Time`;

    const eutzEarlyKills = [14, 15, 16, 17, 18].reduce((sum, h) => sum + hourlyTotals[h], 0);
    const eutzLateKills = [19, 20, 21, 22, 23].reduce((sum, h) => sum + hourlyTotals[h], 0);
    const ustzEarlyKills = [0, 1, 2, 3, 4].reduce((sum, h) => sum + hourlyTotals[h], 0);
    const ustzLateKills = [5, 6, 7, 8, 9].reduce((sum, h) => sum + hourlyTotals[h], 0);
    const autzKills = [10, 11, 12, 13].reduce((sum, h) => sum + hourlyTotals[h], 0);

    const timezones = [
        { name: 'Early EUTZ', kills: eutzEarlyKills },
        { name: 'Late EUTZ', kills: eutzLateKills },
        { name: 'Early USTZ', kills: ustzEarlyKills },
        { name: 'Late USTZ', kills: ustzLateKills },
        { name: 'AUTZ', kills: autzKills }
    ];

    const maxTZ = timezones.reduce((max, tz) => tz.kills > max.kills ? tz : max, { kills: 0 });
    const timezone = maxTZ.kills > 0 ? maxTZ.name : 'Unknown';

    return { timezone, primeTime };
}

export function calculateTimezoneFromKillmails(killmails) {
    if (!killmails || killmails.length === 0) {
        return { timezone: 'Unknown', primeTime: 'Unknown' };
    }

    const hourlyTotals = new Array(24).fill(0);

    killmails.forEach(km => {
        const killTime = km.killmail?.killmail_time;
        if (killTime) {
            const date = new Date(killTime);
            const hour = date.getUTCHours();
            hourlyTotals[hour]++;
        }
    });

    return calculateTimezoneFromHourlyData(hourlyTotals);
}
