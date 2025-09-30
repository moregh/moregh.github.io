/*
    EVE Target Intel - Configuration Constants
    
    Copyright (C) 2025 moregh (https://github.com/moregh/)
    Licensed under AGPL License.
*/

export const CACHE_EXPIRY_HOURS = 12;
export const LONG_CACHE_EXPIRY_HOURS = 168;
export const ZKILL_KILLS_CACHE_HOURS = 3;
export const ESI_KILLMAILS_CACHE_HOURS = 168;
export const MAX_ESI_CALL_SIZE = 100;
export const MAX_CONCURRENT_IMAGES = 4;
export const CHUNK_SIZE = 50;
export const CHUNK_DELAY = 25;
export const STATS_UPDATE_DELAY = 100;
export const DB_NAME = 'EVETargetIntelDB';
export const DB_VERSION = 2;
export const VERSION = "0.8.3";

export const PROGRESS_UPDATE_THROTTLE_MS = 50;
export const TIMER_UPDATE_INTERVAL_MS = 100;
export const TIMER_UPDATE_THROTTLE_MS = 100;
export const LOADING_DISPLAY_DELAY_MS = 300;
export const LOADING_HIDE_DELAY_MS = 500;
export const CHARACTER_COUNT_DEBOUNCE_MS = 150;
export const SCROLL_STATE_TIMEOUT_MS = 150;
export const SCROLL_THROTTLE_MS = 8;
export const ANIMATION_FRAME_THROTTLE_FPS = 16;
export const POPUP_SHOW_DELAY = 400;

export const MIN_CHARACTER_NAME_LENGTH = 3;
export const MAX_CHARACTER_NAME_LENGTH = 37;
export const MAX_SINGLE_NAME_LENGTH = 24;
export const MAX_FAMILY_NAME_LENGTH = 12;
export const MAX_FIRST_MIDDLE_NAME_LENGTH = 24;

export const GRID_VIEW_ITEM_HEIGHT_PX = 150;
export const MIN_GRID_ITEM_WIDTH_PX = 270;
export const USER_NOTIFICATION_DISPLAY_MS = 1500;

export const CHARACTER_PORTRAIT_SIZE_PX = 64;
export const CORP_LOGO_SIZE_PX = 32;
export const ALLIANCE_LOGO_SIZE_PX = 32;
export const MOUSEOVER_CARD_AVATAR_SIZE_PX = 32;
export const MOUSEOVER_CARD_MAX_ITEMS = 10;

export const PERFORMANCE_CONFIG = {
    VIRTUAL_SCROLL_BUFFER: 10,
    ANIMATION_FRAME_THROTTLE: 8,
    OBSERVER_THROTTLE: 50,
    MAX_ELEMENT_POOL_SIZE: 50,
    BATCH_SIZE: 20,
    IMAGE_INTERSECTION_MARGIN: '50px',
    ANIMATION_INTERSECTION_MARGIN: '20px'
};

export const ESI_BASE = "https://esi.evetech.net/latest";
export const USER_AGENT = `WarTargetFinder/${VERSION} (+https://github.com/moregh/moregh.github.io/)`;
export const ALLOWED_IMAGE_URLS = ['images.evetech.net', 'imageserver.eveonline.com'];
export const ESI_HEADERS = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'User-Agent': USER_AGENT,
    'X-User-Agent': `${USER_AGENT}`
};

export const ZKILL_CARD_ANIMATION_DURATION_MS = 300;
export const ZKILL_CARD_BACKDROP_BLUR = '12px';
export const ZKILL_DATA_CACHE_DURATION_MS = 30 * 60 * 1000;
export const MAX_KILLMAILS_TO_FETCH = 100;
export const KILLMAIL_BATCH_SIZE = 10;
export const KILLMAIL_FETCH_DELAY_MS = 100;

export const VIRTUAL_SCROLL_CONFIG = {
    CONTAINER_HEIGHT: '75vh',
    MIN_HEIGHT: '720px',
    MAX_HEIGHT: '900px',
    BUFFER_SIZE: 5,
    GRID_GAP: '1.35rem',
    CONTENT_PADDING: '1.8rem',
    MIN_ITEM_WIDTH: 252,
    CONTAINER_MIN_WIDTH: 270,
    CONTAINER_PADDING: 60,
    SCROLL_DEBOUNCE_MS: 8,
    MAX_RENDERED_ELEMENTS: 200,
    MIN_INITIAL_ROWS: 6
};

export const VIEW_DIMENSIONS = {
    list: { height: 90, itemsPerRow: 1 },
    grid: { height: 150, itemsPerRow: null }
};