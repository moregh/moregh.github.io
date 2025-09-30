/*
    EVE Ship Classification Data - mapping of ship types

    Based on EVE Static Data Export from fuzzwork.co.uk

    Copyright (C) 2025 moregh (https://github.com/moregh/)
    Licensed under AGPL License.
*/

export const SHIP_GROUP_CLASSIFICATIONS = {
    // ===== SMALL SHIPS =====

    // Frigates
    25: { size: 'Small', role: 'Combat', category: 'Frigate' },

    // Corvettes (Rookie Ships)
    237: { size: 'Small', role: 'Combat', category: 'Corvette' },

    // Assault Frigates
    324: { size: 'Small', role: 'Combat', category: 'Assault Frigate' },

    // Interceptors
    831: { size: 'Small', role: 'Specialist', category: 'Interceptor' },

    // Covert Ops
    830: { size: 'Small', role: 'Specialist', category: 'Covert Ops' },

    // Electronic Attack Ships
    893: { size: 'Small', role: 'Support', category: 'Electronic Attack Ship' },

    // Stealth Bombers
    834: { size: 'Small', role: 'Specialist', category: 'Stealth Bomber' },

    // Destroyers
    420: { size: 'Small', role: 'Combat', category: 'Destroyer' },

    // Interdictors
    541: { size: 'Small', role: 'Specialist', category: 'Interdictor' },

    // Command Destroyers
    1534: { size: 'Small', role: 'Support', category: 'Command Destroyer' },

    // Tactical Destroyers
    1305: { size: 'Small', role: 'Combat', category: 'Tactical Destroyer' },

    // Expedition Frigates
    1283: { size: 'Small', role: 'Industrial', category: 'Expedition Frigate' },

    // Logistics Frigates
    1527: { size: 'Small', role: 'Support', category: 'Logistics Frigate' },

    // Prototype Exploration Ships
    1022: { size: 'Small', role: 'Specialist', category: 'Prototype Exploration Ship' },

    // ===== MEDIUM SHIPS =====

    // Cruisers
    26: { size: 'Medium', role: 'Combat', category: 'Cruiser' },

    // Heavy Assault Cruisers
    358: { size: 'Medium', role: 'Combat', category: 'Heavy Assault Cruiser' },

    // Heavy Interdiction Cruisers
    894: { size: 'Medium', role: 'Specialist', category: 'Heavy Interdiction Cruiser' },

    // Logistics Cruisers
    832: { size: 'Medium', role: 'Support', category: 'Logistics' },

    // Force Recon Ships
    833: { size: 'Medium', role: 'Specialist', category: 'Force Recon Ship' },

    // Combat Recon Ships
    906: { size: 'Medium', role: 'Specialist', category: 'Combat Recon Ship' },

    // Strategic Cruisers
    963: { size: 'Medium', role: 'Combat', category: 'Strategic Cruiser' },

    // Command Ships
    540: { size: 'Medium', role: 'Support', category: 'Command Ship' },

    // Combat Battlecruisers
    419: { size: 'Medium', role: 'Combat', category: 'Combat Battlecruiser' },

    // Attack Battlecruisers
    1201: { size: 'Medium', role: 'Combat', category: 'Attack Battlecruiser' },

    // Flag Cruisers
    1972: { size: 'Medium', role: 'Support', category: 'Flag Cruiser' },

    // ===== LARGE SHIPS =====

    // Battleships
    27: { size: 'Large', role: 'Combat', category: 'Battleship' },

    // Faction Battleships (Special Faction/Pirate)
    381: { size: 'Large', role: 'Combat', category: 'Faction Battleship' },

    // Marauders
    900: { size: 'Large', role: 'Combat', category: 'Marauder' },

    // Black Ops
    898: { size: 'Large', role: 'Specialist', category: 'Black Ops' },

    // ===== CAPITAL SHIPS =====

    // Dreadnoughts
    485: { size: 'Capital', role: 'Combat', category: 'Dreadnought' },

    // Lancer Dreadnoughts
    4594: { size: 'Capital', role: 'Combat', category: 'Lancer Dreadnought' },

    // Carriers
    547: { size: 'Capital', role: 'Support', category: 'Carrier' },

    // Force Auxiliaries
    1538: { size: 'Capital', role: 'Support', category: 'Force Auxiliary' },

    // Supercarriers
    659: { size: 'Capital', role: 'Combat', category: 'Supercarrier' },

    // Titans
    30: { size: 'Capital', role: 'Combat', category: 'Titan' },

    // ===== INDUSTRIAL SHIPS =====

    // Haulers (Basic Industrial)
    28: { size: 'Industrial', role: 'Industrial', category: 'Hauler' },

    // Deep Space Transports
    380: { size: 'Industrial', role: 'Industrial', category: 'Deep Space Transport' },

    // Blockade Runners
    1202: { size: 'Industrial', role: 'Industrial', category: 'Blockade Runner' },

    // Industrial Command Ships
    941: { size: 'Industrial', role: 'Industrial', category: 'Industrial Command Ship' },

    // Freighters
    513: { size: 'Industrial', role: 'Industrial', category: 'Freighter' },

    // Jump Freighters
    902: { size: 'Industrial', role: 'Industrial', category: 'Jump Freighter' },

    // Capital Industrial Ships
    883: { size: 'Capital', role: 'Industrial', category: 'Capital Industrial Ship' },

    // Mining Barges
    463: { size: 'Industrial', role: 'Industrial', category: 'Mining Barge' },

    // Exhumers
    543: { size: 'Industrial', role: 'Industrial', category: 'Exhumer' },

    // ===== SPECIAL CASES =====

    // Capsules
    29: { size: 'Pod', role: 'Special', category: 'Capsule' },

    // Shuttles
    31: { size: 'Pod', role: 'Special', category: 'Shuttle' },

    // Citizen Ships (Special Event Ships)
    2001: { size: 'Special', role: 'Special', category: 'Citizen Ships' }
};

export function getShipClassification(shipTypeID, groupID, shipName = '', groupName = '') {
    // Try direct group ID lookup first (most accurate)
    if (groupID && SHIP_GROUP_CLASSIFICATIONS[groupID]) {
        return SHIP_GROUP_CLASSIFICATIONS[groupID];
    }
    return { size: 'Unknown', role: 'Combat', category: 'Unknown Ship' };
}

/**
 * Complete Ship Type ID to Group ID mapping from EVE SDE
 * Generated from Fuzzwork SQLite database
 */
export const SHIP_TYPE_TO_GROUP = {
    582: 25,
    583: 25,
    584: 25,
    585: 25,
    586: 25,
    587: 25,
    589: 25,
    590: 25,
    591: 25,
    592: 25,
    593: 25,
    594: 25,
    597: 25,
    598: 25,
    599: 25,
    602: 25,
    603: 25,
    605: 25,
    607: 25,
    608: 25,
    609: 25,
    2161: 25,
    3532: 25,
    3766: 25,
    11940: 25,
    11942: 25,
    17619: 25,
    17703: 25,
    17812: 25,
    17841: 25,
    17924: 25,
    17926: 25,
    17928: 25,
    17930: 25,
    17932: 25,
    29248: 25,
    32880: 25,
    33468: 25,
    33816: 25,
    37453: 25,
    37454: 25,
    37455: 25,
    37456: 25,
    47269: 25,
    54731: 25,
    72903: 25,
    72904: 25,
    72907: 25,
    72913: 25,
    77114: 25,
    620: 26,
    621: 26,
    622: 26,
    623: 26,
    624: 26,
    625: 26,
    626: 26,
    627: 26,
    628: 26,
    629: 26,
    630: 26,
    631: 26,
    632: 26,
    633: 26,
    634: 26,
    635: 26,
    2006: 26,
    11011: 26,
    17634: 26,
    17709: 26,
    17713: 26,
    17715: 26,
    17718: 26,
    17720: 26,
    17722: 26,
    17843: 26,
    17922: 26,
    29336: 26,
    29337: 26,
    29340: 26,
    29344: 26,
    33470: 26,
    33553: 26,
    33818: 26,
    34590: 26,
    47270: 26,
    49712: 26,
    54732: 26,
    638: 27,
    639: 27,
    640: 27,
    641: 27,
    642: 27,
    643: 27,
    644: 27,
    645: 27,
    11936: 27,
    11938: 27,
    13202: 27,
    17636: 27,
    17726: 27,
    17728: 27,
    17732: 27,
    17736: 27,
    17738: 27,
    17740: 27,
    17918: 27,
    17920: 27,
    24688: 27,
    24690: 27,
    24692: 27,
    24694: 27,
    26840: 27,
    26842: 27,
    32305: 27,
    32307: 27,
    32309: 27,
    32311: 27,
    33472: 27,
    33820: 27,
    47271: 27,
    47466: 27,
    54733: 27,
    648: 28,
    649: 28,
    650: 28,
    651: 28,
    652: 28,
    653: 28,
    654: 28,
    655: 28,
    656: 28,
    657: 28,
    1944: 28,
    2863: 28,
    2998: 28,
    4363: 28,
    4388: 28,
    19744: 28,
    32811: 28,
    81008: 28,
    670: 29,
    33328: 29,
    671: 30,
    3764: 30,
    11567: 30,
    23773: 30,
    42126: 30,
    42241: 30,
    45649: 30,
    78576: 30,
    672: 31,
    11129: 31,
    11132: 31,
    11134: 31,
    21097: 31,
    21628: 31,
    29266: 31,
    30842: 31,
    33513: 31,
    34496: 31,
    64034: 31,
    588: 237,
    596: 237,
    601: 237,
    606: 237,
    615: 237,
    617: 237,
    33079: 237,
    33081: 237,
    33083: 237,
    2834: 324,
    3516: 324,
    11365: 324,
    11371: 324,
    11379: 324,
    11381: 324,
    11393: 324,
    11400: 324,
    12042: 324,
    12044: 324,
    32207: 324,
    32788: 324,
    52250: 324,
    74141: 324,
    78414: 324,
    2836: 358,
    3518: 358,
    11993: 358,
    11999: 358,
    12003: 358,
    12005: 358,
    12011: 358,
    12015: 358,
    12019: 358,
    12023: 358,
    32209: 358,
    52252: 358,
    74316: 358,
    77726: 358,
    12731: 380,
    12745: 380,
    12747: 380,
    12753: 380,
    81047: 380,
    3756: 419,
    16227: 419,
    16229: 419,
    16231: 419,
    16233: 419,
    24696: 419,
    24698: 419,
    24700: 419,
    24702: 419,
    33151: 419,
    33153: 419,
    33155: 419,
    33157: 419,
    49711: 419,
    72811: 419,
    72812: 419,
    72869: 419,
    72872: 419,
    78366: 419,
    78369: 419,
    85086: 419,
    16236: 420,
    16238: 420,
    16240: 420,
    16242: 420,
    32872: 420,
    32874: 420,
    32876: 420,
    32878: 420,
    42685: 420,
    49710: 420,
    73789: 420,
    73794: 420,
    73795: 420,
    73796: 420,
    78333: 420,
    78367: 420,
    85087: 420,
    17476: 463,
    17478: 463,
    17480: 463,
    19720: 485,
    19722: 485,
    19724: 485,
    19726: 485,
    42124: 485,
    42243: 485,
    45647: 485,
    52907: 485,
    73787: 485,
    73790: 485,
    73792: 485,
    73793: 485,
    87381: 485,
    20183: 513,
    20185: 513,
    20187: 513,
    20189: 513,
    34328: 513,
    81040: 513,
    22442: 540,
    22444: 540,
    22446: 540,
    22448: 540,
    22466: 540,
    22468: 540,
    22470: 540,
    22474: 540,
    22452: 541,
    22456: 541,
    22460: 541,
    22464: 541,
    22544: 543,
    22546: 543,
    22548: 543,
    23757: 547,
    23911: 547,
    23915: 547,
    24483: 547,
    3514: 659,
    22852: 659,
    23913: 659,
    23917: 659,
    23919: 659,
    42125: 659,
    11172: 830,
    11182: 830,
    11188: 830,
    11192: 830,
    33397: 830,
    42246: 830,
    44993: 830,
    48636: 830,
    85062: 830,
    11176: 831,
    11178: 831,
    11184: 831,
    11186: 831,
    11196: 831,
    11198: 831,
    11200: 831,
    11202: 831,
    33673: 831,
    35779: 831,
    11978: 832,
    11985: 832,
    11987: 832,
    11989: 832,
    32790: 832,
    42245: 832,
    49713: 832,
    11957: 833,
    11963: 833,
    11965: 833,
    11969: 833,
    33395: 833,
    33675: 833,
    44995: 833,
    45531: 833,
    48635: 833,
    85229: 833,
    11377: 834,
    12032: 834,
    12034: 834,
    12038: 834,
    45530: 834,
    28352: 883,
    11174: 893,
    11190: 893,
    11194: 893,
    11387: 893,
    60765: 893,
    11995: 894,
    12013: 894,
    12017: 894,
    12021: 894,
    35781: 894,
    60764: 894,
    22428: 898,
    22430: 898,
    22436: 898,
    22440: 898,
    44996: 898,
    85236: 898,
    28659: 900,
    28661: 900,
    28665: 900,
    28710: 900,
    88001: 900,
    28844: 902,
    28846: 902,
    28848: 902,
    28850: 902,
    11959: 906,
    11961: 906,
    11971: 906,
    20125: 906,
    28606: 941,
    42244: 941,
    29984: 963,
    29986: 963,
    29988: 963,
    29990: 963,
    2078: 1022,
    4302: 1201,
    4306: 1201,
    4308: 1201,
    4310: 1201,
    12729: 1202,
    12733: 1202,
    12735: 1202,
    12743: 1202,
    81046: 1202,
    33697: 1283,
    37135: 1283,
    34317: 1305,
    34562: 1305,
    34828: 1305,
    35683: 1305,
    37457: 1527,
    37458: 1527,
    37459: 1527,
    37460: 1527,
    37480: 1534,
    37481: 1534,
    37482: 1534,
    37483: 1534,
    52254: 1534,
    37604: 1538,
    37605: 1538,
    37606: 1538,
    37607: 1538,
    42242: 1538,
    45645: 1538,
    45534: 1972,
    77281: 4594,
    77283: 4594,
    77284: 4594,
    77288: 4594,
};
