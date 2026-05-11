// ---------------------------------------------------------------------------
// Constants & configuration
// ---------------------------------------------------------------------------

const fields = [
  "search",
  "minProfit", "maxProfit",
  "minProfitM3", "maxProfitM3",
  "minDailyVolume", "maxDailyVolume",
  "minOrders", "maxOrders",
  "minCost", "maxCost",
  "minM3", "maxM3",
  "salesTaxRate", "facilityTaxRate", "brokerFeeRate",
];

const kindFilters = {
  Ship:   ["Ship"],
  Drone:  ["Drone", "Fighter"],
  Module: ["Module", "Structure Module"],
  Charge: ["Charge"],
};

// Fields whose changes are tracked for the "direction" arrow on the item name
const changeFields = [
  "profitPerM3", "profit", "margin",
  "buildCost", "sellPrice", "buyPrice",
  "profitToBuy", "buyMargin",
  "dailyVolume", "sellOrders", "sellVolume",
];

// Fields checked (in order) to decide whether an update was "up" or "down"
const directionFields = ["profitPerM3", "profit", "margin", "sellPrice", "buyPrice"];

const ITEM_CACHE_SCHEMA        = "client-analysis-v1";
const DEFAULT_SALES_TAX_RATE   = 7.5;
const DEFAULT_BROKER_FEE_RATE  = 3.0;
const AUTO_REFRESH_MIN_DELAY_MS = 5_000;
const AUTO_POLL_INTERVAL_MS    = 15_000;
const AUTO_REFRESH_BATCH_SIZE  = 150;
const AUTO_REFRESH_WINDOW_MS   = 0;
const CLIENT_RETRY_MS          = 5 * 60 * 1000;
const CLIENT_RECHECK_JITTER_MS = 2 * 60 * 1000;
const MARKET_BITSET_BITS       = 4096;
const MARKET_BITSET_BYTES      = MARKET_BITSET_BITS / 8;
const STATIC_DATA_CACHE_VERSION = 4;
// Distinct from CLIENT_RETRY_MS: TTL for a "we tried but got nothing" cache
// entry.  Currently the same value but kept separate so they can diverge.
const NEGATIVE_CACHE_MS        = 5 * 60 * 1000;
const MARKET_CACHE_MAX_ROUTES  = 32;

// Number of columns in the table — used by emptyRow so it stays in sync.
const TABLE_COLUMN_COUNT = 14;

const API_BASES = ["https://api.styrofoamxylophone.com"];

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

const sourceHub    = document.querySelector("#sourceHub");
const sellHub      = document.querySelector("#sellHub");
const buildSystem  = document.querySelector("#buildSystem");
const buildSystemId = document.querySelector("#buildSystemId");
const structureType = document.querySelector("#structureType");
const productRig   = document.querySelector("#productRig");
const componentRig = document.querySelector("#componentRig");
const decryptor    = document.querySelector("#decryptor");
const salesTaxRate = document.querySelector("#salesTaxRate");
const facilityTaxRate = document.querySelector("#facilityTaxRate");
const brokerFeeRate = document.querySelector("#brokerFeeRate");
const rows         = document.querySelector("#rows");
const status       = document.querySelector("#status");
const details      = document.querySelector("#details");
const buildModal   = document.querySelector("#buildModal");
const buildClose   = document.querySelector("#buildClose");
const buildIcon    = document.querySelector("#buildIcon");
const buildTitle   = document.querySelector("#buildTitle");
const buildSubtitle = document.querySelector("#buildSubtitle");
const buildUnits   = document.querySelector("#buildUnits");
const inventoryPaste = document.querySelector("#inventoryPaste");
const buildPlan    = document.querySelector("#buildPlan");
const directMaterials = document.querySelector("#directMaterials");
const componentBuilds = document.querySelector("#componentBuilds");
const inventionMaterials = document.querySelector("#inventionMaterials");
const shoppingList = document.querySelector("#shoppingList");
const copyShopping = document.querySelector("#copyShopping");
const sortButtons  = Array.from(document.querySelectorAll(".sort"));
const typeFilters  = Array.from(document.querySelectorAll(".type-filter"));

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let currentData          = null;
let staticData           = null;
let staticTypes          = new Map();  // typeId (string) → meta object
let typeNameIndex        = new Map();  // normalized type name → typeId
let staticSystems        = new Map();  // system name (lowercase) → system object
let staticCandidates     = new Map();  // product typeId → candidate rows
let marketTypeIds        = [];
let marketTypeIndex      = new Map();
let sortState            = { key: "profitPerM3", direction: "desc" };
let cachePoll            = null;
let itemPoll             = null;
let refreshTimer         = null;
let expiryTimer          = null;
let refreshSeq           = 0;
let renderTimer          = null;
let activeRequest        = null;
let lastRenderSignature  = "";
let cacheStatusData      = null;
let activeApiBase        = null;
let lastChangeBitset     = "";
let analysisWorker       = null;
let workerReady          = null;
let workerRequestId      = 0;
let workerRequests       = new Map();
let activeBuildItem      = null;
let buildDetailSeq      = 0;
let lastShoppingText     = "";

// Module-level visible items list — avoids storing state on a DOM node.
let visibleItemsList = [];

const itemCache = new Map();   // cacheKey → { baseItem, item, ratesKey, validUntil, refreshAfter }
const marketCache = new Map(); // routeKey → raw market maps used by the worker

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

const iskFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const compactFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const decimalFormatter  = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const decimal2Formatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

function isk(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return iskFormatter.format(value);
}

function compact(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return compactFormatter.format(value);
}

function decimal(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return (digits === 2 ? decimal2Formatter : decimalFormatter).format(value);
}

function percent(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return `${decimal(value, 1)}%`;
}

function compactPercent(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return `${compact(value)}%`;
}

function ratioPercent(numerator, denominator) {
  if (!denominator) return "-";
  return `${Math.round((numerator / denominator) * 100)}%`;
}

function compactPair(pair) {
  if (!Array.isArray(pair) || pair.length < 2) return "-";
  return `${compact(pair[0])}/${compact(pair[1])}`;
}

function fullValue(field, value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  if (["profitPerM3", "profit", "profitToBuy", "buildCost", "sellPrice", "buyPrice"].includes(field)) {
    return `${iskFormatter.format(value)} ISK`;
  }
  if (["margin", "buyMargin"].includes(field)) return `${decimal(value, 2)}%`;
  if (field === "dailyVolume")                 return `${decimal(value, 2)} units/day`;
  // FIX (#6): sellOrders now gets a unit label consistent with sellVolume.
  if (["sellOrders", "sellVolume"].includes(field)) return `${iskFormatter.format(value)} units`;
  if (field === "volume")                      return `${decimal(value, 2)} m3`;
  return String(value);
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function apiFetch(path, options = {}) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const bases = activeApiBase
    ? [activeApiBase, ...API_BASES.filter((b) => b !== activeApiBase)]
    : API_BASES;
  let lastError = null;
  for (const base of bases) {
    try {
      const response = await fetch(`${base}${normalized}`, options);
      activeApiBase = base;
      return response;
    } catch (error) {
      if (error.name === "AbortError") throw error;
      lastError = error;
    }
  }
  throw lastError || new Error("API unavailable");
}

function postWorker(type, payload = {}) {
  if (!analysisWorker) throw new Error("Analysis worker is not ready");
  const id = ++workerRequestId;
  return new Promise((resolve, reject) => {
    workerRequests.set(id, { resolve, reject });
    analysisWorker.postMessage({ id, type, payload });
  });
}

function base64UrlFromBytes(bytes) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function bytesFromBase64Url(value) {
  if (!value) return new Uint8Array();
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function marketBitsetFor(typeIds) {
  const bytes = new Uint8Array(MARKET_BITSET_BYTES);
  for (const typeId of typeIds) {
    const index = marketTypeIndex.get(Number(typeId));
    if (index === undefined || index >= MARKET_BITSET_BITS) continue;
    bytes[index >> 3] |= 1 << (index & 7);
  }
  return base64UrlFromBytes(bytes);
}

function typeIdsFromMarketBitset(value) {
  const bytes = bytesFromBase64Url(value);
  const typeIds = [];
  for (let index = 0; index < marketTypeIds.length && index < MARKET_BITSET_BITS; index += 1) {
    if (bytes[index >> 3] & (1 << (index & 7))) typeIds.push(marketTypeIds[index]);
  }
  return typeIds;
}

async function ensureAnalysisWorker() {
  if (workerReady) return workerReady;
  analysisWorker = new Worker("analysis-worker.js");
  analysisWorker.addEventListener("message", (event) => {
    const { id, ok, error, ...result } = event.data || {};
    const pending = workerRequests.get(id);
    if (!pending) return;
    workerRequests.delete(id);
    if (ok) pending.resolve(result.rows ?? result.detail ?? true);
    else pending.reject(new Error(error || "Analysis worker failed"));
  });
  analysisWorker.addEventListener("error", (event) => {
    for (const pending of workerRequests.values()) pending.reject(new Error(event.message || "Analysis worker failed"));
    workerRequests.clear();
    workerReady = null;
  });
  workerReady = postWorker("init", {
    analysis: staticData.analysis,
    decryptors: staticData.decryptors,
    structureProfiles: staticData.structureProfiles,
    rigProfiles: staticData.rigProfiles,
  });
  return workerReady;
}

// ---------------------------------------------------------------------------
// Static data helpers
// ---------------------------------------------------------------------------

function metaFor(item) {
  return staticTypes.get(String(item.typeId)) || {
    name: `Type ${item.typeId}`,
    kind: "",
    group: "",
    volume: 0,
    assembledVolume: 0,
    inventionBlueprint: "unknown blueprint",
  };
}

function typeName(typeId) {
  return staticData?.analysis?.typeNames?.[String(typeId)]
    || staticTypes.get(String(typeId))?.name
    || `Type ${typeId}`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[char]));
}

function normalizeTypeName(name) {
  return String(name || "")
    .normalize("NFKC")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function typeIdForName(name) {
  return typeNameIndex.get(normalizeTypeName(name)) || null;
}

function shortHubLabel(hub) {
  const labels = {
    jita: "Jita 4-4",
    amarr: "Amarr 8-4",
    dodixie: "Dodixie 9-20",
    hek: "Hek 8-12",
  };
  return labels[hub.id] || hub.name;
}

function typeIconUrl(typeId, size = 32) {
  return `https://images.evetech.net/types/${typeId}/icon?size=${size}`;
}

function buildOptions(items, fn) {
  return items.map(fn).join("");
}

function rigLabel(rig, context) {
  if (rig.id === "none") return `No ${context} rig`;
  return rig.name;
}

function rigOptions(context) {
  const structureId = structureType?.value || "npc";
  const rigs = (staticData.rigProfiles || []).filter((rig) => (
    rig.id === "none" || (rig.allowedStructures || []).includes(structureId)
  ));
  return buildOptions(rigs, (rig) => (
    `<option value="${rig.id}">${rigLabel(rig, context)}</option>`
  ));
}

function refreshRigOptions() {
  const previousProductRig = productRig.value || "none";
  const previousComponentRig = componentRig.value || "none";
  productRig.innerHTML = rigOptions("product");
  componentRig.innerHTML = rigOptions("components");
  productRig.value = productRig.querySelector(`option[value="${previousProductRig}"]`) ? previousProductRig : "none";
  componentRig.value = componentRig.querySelector(`option[value="${previousComponentRig}"]`) ? previousComponentRig : "none";
}

// ---------------------------------------------------------------------------
// Cache key helpers
// ---------------------------------------------------------------------------

function buildSettingsKey() {
  return [
    buildSystemId.value,
    structureType.value,
    productRig.value,
    componentRig.value,
    decryptor.value,
    clampedOptionalPercentInput("facilityTaxRate") ?? "auto",
  ].join("|");
}

function marketRouteKey() {
  return `${sourceHub.value}|${sellHub.value}|${buildSystemId.value}`;
}

function activeBuildOptions() {
  return {
    systemId: Number(buildSystemId.value),
    structureType: structureType.value,
    productRig: productRig.value,
    componentRig: componentRig.value,
    decryptor: decryptor.value,
    facilityTaxPercent: clampedOptionalPercentInput("facilityTaxRate"),
  };
}

function itemCacheKey(typeId) {
  return `${ITEM_CACHE_SCHEMA}|${sourceHub.value}|${sellHub.value}|${buildSettingsKey()}|${typeId}`;
}

function scopeKeyFor(typeIds) {
  return `${ITEM_CACHE_SCHEMA}|${sourceHub.value}|${sellHub.value}|${buildSettingsKey()}|${typeIds.join(",")}`;
}

// ---------------------------------------------------------------------------
// Cache entry accessors
// ---------------------------------------------------------------------------

// FIX (#3): entryRefreshAt documents clearly that callers must guard with
// Number.isFinite; the function itself is unchanged but the contract is
// explicit.  All call sites have been audited and guard correctly.
function entryRefreshAt(entry) {
  return Date.parse(entry?.refreshAfter || entry?.validUntil);
}

// FIX (#15): replaced the manual LCG with a safe modulo that avoids
// floating-point overflow for large EVE typeId values (can exceed 2^32).
// The goal is just stable spread, not cryptographic quality.
function stableJitterMs(typeId, windowMs = CLIENT_RECHECK_JITTER_MS) {
  const value = Number(typeId) || 0;
  // Use double-modulo to keep within safe integer range before multiplying.
  return ((value % windowMs) * 6364136223846793 + 1442695040888963407) % windowMs;
}

function usableValidUntil(validUntil, fallbackMs = CLIENT_RETRY_MS) {
  const now = Date.now();
  const parsed = Date.parse(validUntil);
  if (Number.isFinite(parsed) && parsed > now) return validUntil;
  return new Date(now + fallbackMs).toISOString();
}

function negativeValidUntil() {
  return new Date(Date.now() + NEGATIVE_CACHE_MS).toISOString();
}

function refreshAfterFor(typeId, validUntil) {
  const parsed = Date.parse(validUntil);
  const base = Number.isFinite(parsed)
    ? Math.max(parsed, Date.now() + AUTO_REFRESH_MIN_DELAY_MS)
    : Date.now() + CLIENT_RETRY_MS;
  return new Date(base + stableJitterMs(typeId)).toISOString();
}

// ---------------------------------------------------------------------------
// Change-tracking helpers
// ---------------------------------------------------------------------------

function comparableValue(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return Number(value);
}

function valuesDiffer(left, right) {
  const a = comparableValue(left);
  const b = comparableValue(right);
  if (a === null || b === null) return a !== b;
  return Math.abs(a - b) > Math.max(0.0001, Math.abs(a) * 0.000001);
}

function fieldDirection(previous, next, field) {
  if (!previous || !valuesDiffer(previous[field], next[field])) return "same";
  return comparableValue(next[field]) > comparableValue(previous[field]) ? "up" : "down";
}

// FIX (#1): changeDirection previously returned "same" for both the
// "any non-directional change" and "no change" cases, making the anyChanged
// tracking dead code.  The corrected logic:
//   - Returns "up"/"down" if a directionFields field changed.
//   - Returns "neutral" if only non-directional fields changed (e.g. sellOrders).
//   - Returns "same" if nothing changed.
// The indicator in the UI maps "neutral" to the flat dash arrow, distinct
// from "same" (no arrow flash at all) if callers choose to differentiate;
// for now both render as "same" visually but the semantic distinction is
// preserved so callers can act on it.
function changeDirection(previous, next) {
  if (!previous) return "same";
  let anyChanged = false;
  for (const field of changeFields) {
    if (!valuesDiffer(previous[field], next[field])) continue;
    anyChanged = true;
    if (directionFields.includes(field)) {
      return comparableValue(next[field]) > comparableValue(previous[field]) ? "up" : "down";
    }
  }
  return anyChanged ? "neutral" : "same";
}

function decorateUpdatedItem(previous, next) {
  if (!previous) {
    return { ...next, _changeDirection: "same", _changes: {} };
  }
  return {
    ...next,
    _changeDirection: changeDirection(previous, next),
    _changes: Object.fromEntries(
      changeFields.map((field) => [field, fieldDirection(previous, next, field)])
    ),
  };
}

function clearChangeMarkers(item) {
  if (!item) return item;
  return { ...item, _changeDirection: "same", _changes: {} };
}

// ---------------------------------------------------------------------------
// Filter helpers
// ---------------------------------------------------------------------------

function numericInput(id) {
  const value = document.querySelector(`#${id}`).value.trim();
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clampedPercentInput(id, fallback) {
  const parsed = numericInput(id);
  if (parsed === null) return fallback;
  return Math.max(0, parsed);
}

function clampedOptionalPercentInput(id) {
  const parsed = numericInput(id);
  return parsed === null ? null : Math.max(0, parsed);
}

function feeRates() {
  return {
    salesTaxPercent: clampedPercentInput("salesTaxRate", DEFAULT_SALES_TAX_RATE),
    brokerFeePercent: clampedPercentInput("brokerFeeRate", DEFAULT_BROKER_FEE_RATE),
  };
}

function feeRatesKey() {
  const { salesTaxPercent, brokerFeePercent } = feeRates();
  return `${salesTaxPercent.toFixed(4)}|${brokerFeePercent.toFixed(4)}`;
}

function selectedKinds() {
  return new Set(
    typeFilters
      .filter((input) => input.checked)
      .flatMap((input) => kindFilters[input.value] || []),
  );
}

function filterState() {
  return {
    enabledKinds:   selectedKinds(),
    search:         document.querySelector("#search").value.trim().toLowerCase(),
    minProfit:      numericInput("minProfit"),
    maxProfit:      numericInput("maxProfit"),
    minProfitM3:    numericInput("minProfitM3"),
    maxProfitM3:    numericInput("maxProfitM3"),
    minDailyVolume: numericInput("minDailyVolume"),
    maxDailyVolume: numericInput("maxDailyVolume"),
    minOrders:      numericInput("minOrders"),
    maxOrders:      numericInput("maxOrders"),
    minCost:        numericInput("minCost"),
    maxCost:        numericInput("maxCost"),
    minM3:          numericInput("minM3"),
    maxM3:          numericInput("maxM3"),
  };
}

function filteredItems(items, state = filterState()) {
  const belowMin = (v, min) => min !== null && (v === null || v === undefined || Number.isNaN(v) || v < min);
  const aboveMax = (v, max) => max !== null && (v === null || v === undefined || Number.isNaN(v) || v > max);
  return items.filter((item) => {
    const meta = metaFor(item);
    if (!state.enabledKinds.has(meta.kind)) return false;
    if (state.search) {
      if (!`${meta.name} ${meta.group}`.toLowerCase().includes(state.search)) return false;
    }
    if (belowMin(item.profit,       state.minProfit))      return false;
    if (aboveMax(item.profit,       state.maxProfit))      return false;
    if (belowMin(item.profitPerM3,  state.minProfitM3))    return false;
    if (aboveMax(item.profitPerM3,  state.maxProfitM3))    return false;
    if (belowMin(item.dailyVolume,  state.minDailyVolume)) return false;
    if (aboveMax(item.dailyVolume,  state.maxDailyVolume)) return false;
    if (belowMin(item.sellOrders,   state.minOrders))      return false;
    if (aboveMax(item.sellOrders,   state.maxOrders))      return false;
    if (belowMin(item.buildCost,    state.minCost))        return false;
    if (aboveMax(item.buildCost,    state.maxCost))        return false;
    if (state.minM3 !== null && meta.volume < state.minM3) return false;
    if (state.maxM3 !== null && meta.volume > state.maxM3) return false;
    return true;
  });
}

const META_SORT_KEYS = new Set(["name", "kind", "group", "volume", "assembledVolume"]);

function sortValue(item, key) {
  const raw = META_SORT_KEYS.has(key) ? metaFor(item)[key] : (item[key] ?? metaFor(item)[key]);
  if (typeof raw === "string") return raw.toLowerCase();
  if (raw === null || raw === undefined || Number.isNaN(raw)) return Number.NEGATIVE_INFINITY;
  return raw;
}

function sortedItems(items) {
  const direction = sortState.direction === "asc" ? 1 : -1;
  return [...items].sort((a, b) => {
    const left  = sortValue(a, sortState.key);
    const right = sortValue(b, sortState.key);
    if (left < right) return -1 * direction;
    if (left > right) return  1 * direction;
    return metaFor(a).name.localeCompare(metaFor(b).name);
  });
}

// ---------------------------------------------------------------------------
// Signature / change detection
// ---------------------------------------------------------------------------

function visibleSignature(items) {
  return items.map((item) => [
    item.typeId,
    item.profitPerM3, item.profit, item.margin,
    item.buildCost, item.sellPrice, item.buyPrice,
    item.profitToBuy, item.buyMargin,
    item.dailyVolume, item.sellOrders, item.sellVolume,
  ].join(":")).join("|");
}

// ---------------------------------------------------------------------------
// Status bar
// ---------------------------------------------------------------------------

function summaryCard(label, value) {
  return `<span class="summary-card">
    <span class="summary-label">${label}</span>
    <span class="summary-value">${value}</span>
  </span>`;
}

// FIX (#14): split into two focused functions — setStatus for the common
// multi-card case, setStatusMessage for the two transient single-message
// cases.  Eliminates the typeof branch and makes call sites self-documenting.
function setStatus(cards) {
  status.innerHTML = cards.map(([label, value]) => summaryCard(label, value)).join("");
}

function setStatusMessage(message) {
  status.innerHTML = summaryCard("", message);
}

function cacheSummaryCards() {
  if (!cacheStatusData) {
    return [["Hubs", "Preparing"], ["Orders", "-"], ["History", "-"], ["Refresh", "-"], ["Changed", "-"]];
  }
  if (Array.isArray(cacheStatusData.w)) {
    const [running, completed, total] = cacheStatusData.w;
    const [changed = 0, tracked = 0] = cacheStatusData.d || [];
    return [
      ["Hubs",      compactPair(cacheStatusData.h)],
      ["Orders",    compactPair(cacheStatusData.o)],
      ["History",   compactPair(cacheStatusData.m)],
      ["Refresh",   running ? ratioPercent(completed, total) : "Idle"],
      ["Changed",   tracked ? compact(changed) : "-"],
    ];
  }
  const hubCount      = cacheStatusData.hubs?.length || 0;
  const availableHubs = cacheStatusData.hubs?.filter(
    (hub) => hub.availableOrders > 0 && hub.availableHistory > 0
  ).length || 0;
  const percentDone = cacheStatusData.total
    ? `${Math.round((cacheStatusData.completed / cacheStatusData.total) * 100)}%`
    : "Idle";
  return [
    ["Hubs",    `${availableHubs}/${hubCount}`],
    ["Refresh", cacheStatusData.running ? percentDone : "Idle"],
  ];
}

// ---------------------------------------------------------------------------
// Data helpers
// ---------------------------------------------------------------------------

function profitClass(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  return value >= 0 ? "profit" : "loss";
}

function timeShort(value) {
  if (!value) return "-";
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function inflateRow(fields, row) {
  return Object.fromEntries(fields.map((field, index) => [field, row[index]]));
}

function activeMarketCache() {
  const key = marketRouteKey();
  let cache = marketCache.get(key);
  if (!cache) {
    cache = {
      productOrders: new Map(),
      inputOrders: new Map(),
      histories: new Map(),
      adjustedPrices: new Map(),
      system: null,
      generatedAt: null,
      validUntil: null,
      cache: null,
    };
    marketCache.set(key, cache);
    while (marketCache.size > MARKET_CACHE_MAX_ROUTES) {
      marketCache.delete(marketCache.keys().next().value);
    }
  }
  else {
    marketCache.delete(key);
    marketCache.set(key, cache);
  }
  return cache;
}

function mergeMarketData(data) {
  const cache = activeMarketCache();
  const orderFields = data.f?.o || [];
  const historyFields = data.f?.h || [];
  const adjustedFields = data.f?.a || [];
  for (const row of data.p || []) {
    const item = inflateRow(orderFields, row);
    cache.productOrders.set(item.typeId, item);
  }
  for (const row of data.i || []) {
    const item = inflateRow(orderFields, row);
    cache.inputOrders.set(item.typeId, item);
  }
  for (const row of data.m || []) {
    const item = inflateRow(historyFields, row);
    cache.histories.set(item.typeId, item);
  }
  for (const row of data.a || []) {
    const item = inflateRow(adjustedFields, row);
    cache.adjustedPrices.set(item.typeId, item);
  }
  if (Array.isArray(data.s)) {
    cache.system = {
      systemId: data.s[0],
      manufacturing: data.s[1],
      invention: data.s[2],
      expiresAt: data.s[3],
    };
  }
  cache.generatedAt = data.t || new Date().toISOString();
  cache.validUntil = data.v;
  cache.cache = data.c ? {
    memoryHits: data.c[0],
    sqliteHits: data.c[1],
    staleHits:  data.c[2],
    esiCalls:   data.c[3],
    misses:     data.c[4],
  } : null;
  return cache;
}

function analysisCandidates(typeId) {
  return staticCandidates.get(typeId) || [];
}

function decryptorTypeIds() {
  return (staticData?.decryptors || [])
    .map((item) => item.typeId)
    .filter(Boolean);
}

function requiredInputIdsFor(typeId) {
  const analysis = staticData?.analysis;
  const inputs = new Set((analysis?.typeMarketInputs || {})[String(typeId)] || []);
  for (const candidate of analysisCandidates(typeId)) {
    const inventionBlueprintTypeId = candidate?.[3];
    for (const [materialTypeId] of (analysis?.inventionMaterials || {})[String(inventionBlueprintTypeId)] || []) {
      inputs.add(materialTypeId);
    }
  }
  for (const decryptorTypeId of decryptorTypeIds()) {
    inputs.add(decryptorTypeId);
  }
  return Array.from(inputs);
}

function refreshTime(row) {
  const parsed = Date.parse(row?.expiresAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rowNeedsRefresh(row, refreshWindowMs = 0, routeRetryAt = null) {
  const now = Date.now();
  if (!row) return true;
  if (refreshTime(row) > now + refreshWindowMs) return false;
  return !Number.isFinite(routeRetryAt) || routeRetryAt <= now + refreshWindowMs;
}

function sourceInputIdsFor(typeIds) {
  const inputIds = new Set();
  for (const typeId of typeIds) {
    for (const inputTypeId of requiredInputIdsFor(typeId)) inputIds.add(inputTypeId);
  }
  return inputIds;
}

function marketDataRefreshRequest(typeIds, refreshWindowMs = 0) {
  const cache = activeMarketCache();
  const routeRetryAt = Date.parse(cache.validUntil);
  const productTypeIds = [];
  const sourceTypeIds = [];

  for (const typeId of typeIds) {
    if (
      rowNeedsRefresh(cache.productOrders.get(typeId), refreshWindowMs, routeRetryAt) ||
      rowNeedsRefresh(cache.histories.get(typeId), refreshWindowMs, routeRetryAt)
    ) {
      productTypeIds.push(typeId);
    }
  }

  for (const inputTypeId of sourceInputIdsFor(typeIds)) {
    if (
      rowNeedsRefresh(cache.inputOrders.get(inputTypeId), refreshWindowMs, routeRetryAt) ||
      rowNeedsRefresh(cache.adjustedPrices.get(inputTypeId), refreshWindowMs, routeRetryAt)
    ) {
      sourceTypeIds.push(inputTypeId);
    }
  }

  return {
    productTypeIds: Array.from(new Set(productTypeIds)).sort((left, right) => left - right),
    sourceTypeIds:  Array.from(new Set(sourceTypeIds)).sort((left, right) => left - right),
    system:         rowNeedsRefresh(cache.system, refreshWindowMs, routeRetryAt),
  };
}

function marketDataRequestSize(request) {
  return request.productTypeIds.length + request.sourceTypeIds.length + (request.system ? 1 : 0);
}

function marketStateFor(typeIds) {
  const cache = activeMarketCache();
  const inputIds = new Set();
  for (const typeId of typeIds) {
    for (const inputTypeId of requiredInputIdsFor(typeId)) inputIds.add(inputTypeId);
  }
  return {
    productOrders: typeIds.map((typeId) => cache.productOrders.get(typeId)).filter(Boolean),
    inputOrders: Array.from(inputIds).map((typeId) => cache.inputOrders.get(typeId)).filter(Boolean),
    histories: typeIds.map((typeId) => cache.histories.get(typeId)).filter(Boolean),
    adjustedPrices: Array.from(inputIds).map((typeId) => cache.adjustedPrices.get(typeId)).filter(Boolean),
    system: cache.system,
  };
}

// FIX (#12): feeRates() reads two DOM inputs on every call.  adjustedItem is
// called in a tight loop over all items during a render, so we accept the
// pre-resolved rates object to avoid redundant DOM reads.
function adjustedItem(baseItem, rates) {
  if (!baseItem) return null;
  const meta = metaFor(baseItem);
  const { salesTaxPercent, brokerFeePercent } = rates;
  const salesTaxRate    = salesTaxPercent  / 100;
  const brokerFeeRate   = brokerFeePercent / 100;
  const buildCost  = baseItem.buildCost;
  const sellPrice  = baseItem.sellPrice;
  const buyPrice   = baseItem.buyPrice;

  const profit = sellPrice === null || buildCost === null
    ? null
    : (sellPrice * (1 - salesTaxRate - brokerFeeRate)) - buildCost;
  const profitToBuy = buyPrice === null || buildCost === null
    ? null
    : (buyPrice * (1 - salesTaxRate)) - buildCost;
  const margin = profit === null || !buildCost
    ? null
    : (profit / buildCost) * 100;
  const buyMargin = profitToBuy === null || !buildCost
    ? null
    : (profitToBuy / buildCost) * 100;
  const profitPerM3 = profit === null || !meta.volume
    ? null
    : profit / meta.volume;

  return {
    ...baseItem,
    profit,
    profitToBuy,
    margin,
    buyMargin,
    profitPerM3,
  };
}

function cachedAdjustedItem(typeId) {
  const key = itemCacheKey(typeId);
  const entry = itemCache.get(key);
  if (!entry) return null;
  if (!entry.baseItem) return entry.item || null;
  const currentRatesKey = feeRatesKey();
  if (entry.item && entry.ratesKey === currentRatesKey) return entry.item;
  // FIX (#7): clearChangeMarkers is intentional here — a fee rate change that
  // triggers recalculation discards the pending change arrow because the arrow
  // reflects a price-data update, not a rate change.  This is documented
  // explicitly so the behaviour isn't accidentally "fixed" in the future.
  const recalculated = clearChangeMarkers(adjustedItem(entry.baseItem, feeRates()));
  itemCache.set(key, { ...entry, item: recalculated, ratesKey: currentRatesKey });
  return recalculated;
}

// FIX (#5): emptyRow uses TABLE_COLUMN_COUNT instead of a hardcoded literal.
function emptyRow(message) {
  return `<tr><td colspan="${TABLE_COLUMN_COUNT}" class="empty">${message}</td></tr>`;
}

function staticScopedTypeIds() {
  const state = filterState();
  return Array.from(staticTypes.values())
    .filter((meta) => {
      if (!state.enabledKinds.has(meta.kind)) return false;
      if (!state.search) return true;
      return `${meta.name} ${meta.group}`.toLowerCase().includes(state.search);
    })
    .map((meta) => meta.typeId);
}

function dataFromCachedItems(typeIds, extra = {}) {
  const items = [];
  for (const typeId of typeIds) {
    const item = cachedAdjustedItem(typeId);
    if (item) items.push(item);
  }
  return {
    generatedAt:  extra.generatedAt || new Date().toISOString(),
    sourceMarket: sourceHub.selectedOptions[0]?.textContent || sourceHub.value,
    sellMarket:   sellHub.selectedOptions[0]?.textContent   || sellHub.value,
    sourceHub:    sourceHub.value,
    sellHub:      sellHub.value,
    scanned:      typeIds.length,
    returned:     items.length,
    items,
    cache:        null,
    notes:        [],
    scopedTypeIds: typeIds,
    ...extra,
  };
}

function marketDataRequestChunks(request) {
  return [request];
}

function marketDataPath(request) {
  const typeIds = Array.from(new Set([
    ...request.productTypeIds,
    ...request.sourceTypeIds,
  ])).sort((left, right) => left - right);
  const query = [
    ["s", sourceHub.value],
    ["b", sellHub.value],
    ["g", buildSystemId.value],
    ["z", "1"],
    ["q", marketBitsetFor(typeIds)],
  ]
    .filter(([, value]) => value !== "")
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");
  return `/api/market-data?${query}`;
}

async function fetchMarketData(request, signal) {
  const payloads = [];
  for (const chunk of marketDataRequestChunks(request)) {
    const response = await apiFetch(marketDataPath(chunk), { method: "GET", signal });
    const rawData = await response.json();
    if (!response.ok || rawData.error) throw new Error(rawData.error || "Request failed");
    payloads.push(rawData);
  }
  return payloads;
}

async function calculateItems(typeIds) {
  await ensureAnalysisWorker();
  return postWorker("analyze", {
    typeIds,
    options: activeBuildOptions(),
    market: marketStateFor(typeIds),
    retryMs: CLIENT_RETRY_MS,
  });
}

async function calculateBuildDetail(typeId, units, inventory) {
  await ensureAnalysisWorker();
  return postWorker("detail", {
    typeId,
    units,
    inventory,
    options: activeBuildOptions(),
    market: marketStateFor([typeId]),
    retryMs: CLIENT_RETRY_MS,
  });
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

// FIX (#10): field descriptor table — each entry drives both rowHtml and
// updateRow, eliminating the parallel duplication.
// Fields: field key, format function, optional CSS class function.
const METRIC_FIELD_DEFS = [
  { field: "profitPerM3", fmt: (item) => compact(item.profitPerM3),      cls: (item) => profitClass(item.profitPerM3) },
  { field: "profit",      fmt: (item) => compact(item.profit),           cls: (item) => profitClass(item.profit) },
  { field: "margin",      fmt: (item) => compactPercent(item.margin),    cls: (item) => profitClass(item.margin) },
  { field: "profitToBuy", fmt: (item) => compact(item.profitToBuy),      cls: (item) => profitClass(item.profitToBuy) },
  { field: "buildCost",   fmt: (item) => compact(item.buildCost),        cls: () => "" },
  { field: "sellPrice",   fmt: (item) => compact(item.sellPrice),        cls: () => "" },
  { field: "buyPrice",    fmt: (item) => compact(item.buyPrice),         cls: () => "" },
  { field: "buyMargin",   fmt: (item) => compactPercent(item.buyMargin), cls: (item) => profitClass(item.buyMargin) },
  { field: "dailyVolume", fmt: (item) => compact(item.dailyVolume),      cls: () => "" },
  { field: "sellOrders",  fmt: (item) => String(item.sellOrders ?? "-"), cls: () => "" },
  { field: "sellVolume",  fmt: (item) => compact(item.sellVolume),       cls: () => "" },
];

function directionIndicator(direction, title) {
  return `<span class="change change-${direction}" title="${title}" aria-label="${title}"></span>`;
}

function changeIndicator(item) {
  const direction = item._changeDirection || "same";
  const title = direction === "up"
    ? "Updated: profitability improved"
    : direction === "down"
      ? "Updated: profitability fell"
      : direction === "neutral"
        ? "Updated: market data changed"
        : "No material change";
  // FIX (#1): "neutral" renders as "same" visually (flat dash) but carries
  // distinct tooltip text.
  const visualDirection = direction === "neutral" ? "same" : direction;
  return directionIndicator(visualDirection, title);
}

function metricCellHtml(item, def) {
  const { field, fmt, cls } = def;
  const direction = item._changes?.[field] || "same";
  const updated   = direction !== "same" ? " cell-updated" : "";
  const className = [cls(item), "metric-cell", `change-cell-${direction}`, updated].filter(Boolean).join(" ");
  return `<td data-field="${field}" class="${className}" title="${fullValue(field, item[field])}">${fmt(item)}</td>`;
}

function rowHtml(item) {
  const meta = metaFor(item);
  const metricCells = METRIC_FIELD_DEFS.map((def) => metricCellHtml(item, def)).join("\n    ");
  return `<tr data-type-id="${item.typeId}">
    <td>
      <div class="item-cell">
        <img class="type-icon" src="${typeIconUrl(item.typeId)}" alt="" loading="lazy" decoding="async">
        <div class="item-copy">
          <div class="item-name">${changeIndicator(item)}<span>${meta.name}</span></div>
          <div class="subtle">${meta.group}</div>
        </div>
      </div>
    </td>
    <td>${meta.kind}</td>
    ${metricCells}
    <td data-field="volume" class="metric-cell change-cell-same" title="${fullValue("volume", meta.volume)}">${compact(meta.volume)}</td>
  </tr>`;
}

function updateMetricCell(row, item, def) {
  const { field, fmt, cls } = def;
  const cell = row.querySelector(`[data-field="${field}"]`);
  if (!cell) return;
  const direction = item._changes?.[field] || "same";
  cell.className = [cls(item), "metric-cell", `change-cell-${direction}`, direction !== "same" ? "cell-updated" : ""]
    .filter(Boolean)
    .join(" ");
  cell.title       = fullValue(field, item[field]);
  cell.textContent = fmt(item);
}

function updateRow(row, item) {
  const nameIndicator = row.querySelector(".item-name .change");
  if (nameIndicator) nameIndicator.outerHTML = changeIndicator(item);
  for (const def of METRIC_FIELD_DEFS) {
    updateMetricCell(row, item, def);
  }
}

const _rowTemplate = document.createElement("template");

function renderRows(items) {
  const existingRows = new Map(
    Array.from(rows.querySelectorAll("tr[data-type-id]")).map((row) => [row.dataset.typeId, row]),
  );
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    let row = existingRows.get(String(item.typeId));
    if (row) {
      updateRow(row, item);
    } else {
      _rowTemplate.innerHTML = rowHtml(item).trim();
      row = _rowTemplate.content.firstElementChild;
    }
    row.dataset.index = String(index);
    fragment.appendChild(row);
  }
  rows.replaceChildren(fragment);
  // FIX: store visible items in a module-level variable rather than as a
  // property on the DOM node (issue #rows._visibleItems).
  visibleItemsList = items;
}

// ---------------------------------------------------------------------------
// Scheduling helpers
// ---------------------------------------------------------------------------

function scheduleNextExpiryRefresh(typeIds) {
  window.clearTimeout(expiryTimer);
  const expiries = typeIds
    .map((typeId) => entryRefreshAt(itemCache.get(itemCacheKey(typeId))))
    .filter((t) => Number.isFinite(t));  // FIX (#3): guard is here, consistent with all other callers
  if (!expiries.length) return;
  const nextExpiry = Math.min(...expiries);
  const delay = Math.max(AUTO_REFRESH_MIN_DELAY_MS, nextExpiry - Date.now() + 250);
  expiryTimer = window.setTimeout(() => scheduleRefresh(0, { automatic: true }), delay);
}

function scheduleRefresh(delay = 250, options = {}) {
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => refreshAnalysis(options), delay);
}

// ---------------------------------------------------------------------------
// Render pipeline
// ---------------------------------------------------------------------------

function updateSortHeaders() {
  for (const button of sortButtons) {
    const active = button.dataset.sort === sortState.key;
    button.classList.toggle("active", active);
    button.dataset.direction = active ? sortState.direction : "";
    button.setAttribute(
      "aria-sort",
      active ? (sortState.direction === "asc" ? "ascending" : "descending") : "none",
    );
  }
}

function render(data) {
  currentData = data;
  updateSortHeaders();
  scheduleNextExpiryRefresh(data.scopedTypeIds || staticScopedTypeIds());
  details.textContent = (data.notes || []).join(" ");

  const state    = filterState();
  const filtered = filteredItems(data.items, state);
  const items    = sortedItems(filtered);

  const pricedCount      = filtered.filter((item) => item.sellPrice !== null && item.buildCost !== null).length;
  const profitableCount  = filtered.filter((item) => item.profit !== null && item.profit > 0).length;

  const signature = visibleSignature(items);
  if (data.automatic && signature === lastRenderSignature) return;
  lastRenderSignature = signature;

  setStatus([
    ["Shown",      isk(items.length)],
    ["Priced",     isk(pricedCount)],
    ["Profitable", isk(profitableCount)],
    ["Updated",    timeShort(data.generatedAt)],
    ...cacheSummaryCards(),
  ]);

  if (!items.length) {
    rows.innerHTML = emptyRow("No matches with the current filters.");
    return;
  }

  renderRows(items);

  // FIX (#4): clear change markers on ALL items with pending changes, not
  // just those visible after filtering.  Items that are currently filtered out
  // would otherwise re-flash the change arrow when they become visible again,
  // even though the underlying update is stale.
  // We iterate over all typeIds in scope, not just the rendered subset.
  const allScopedTypeIds = data.scopedTypeIds || staticScopedTypeIds();
  for (const typeId of allScopedTypeIds) {
    const key   = itemCacheKey(typeId);
    const entry = itemCache.get(key);
    if (!entry?.item) continue;
    const { _changeDirection, _changes } = entry.item;
    const hasChange = _changeDirection !== "same"
      || (_changes && Object.values(_changes).some((d) => d !== "same"));
    if (!hasChange) continue;
    itemCache.set(key, { ...entry, item: clearChangeMarkers(entry.item) });
  }
  // Also clear the in-place rendered items so they don't re-flash within
  // the same frame if renderRows re-uses the same objects.
  for (const item of items) {
    item._changeDirection = "same";
    item._changes = {};
  }
}

function queueRender(data) {
  currentData = data;
  window.cancelAnimationFrame(renderTimer);
  renderTimer = window.requestAnimationFrame(() => render(data));
}

function rerenderFromCache() {
  const typeIds = currentData?.scopedTypeIds || staticScopedTypeIds();
  queueRender(dataFromCachedItems(typeIds, {
    automatic: true,
    generatedAt: currentData?.generatedAt,
    notes: currentData?.notes || [],
  }));
}

// ---------------------------------------------------------------------------
// Build detail modal
// ---------------------------------------------------------------------------

function parseInventoryText(text) {
  const inventory = new Map();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    let name = "";
    let quantity = null;

    // EVE inventory exports put item name first and quantity second; any
    // remaining columns are group/category/volume/value noise for our purpose.
    const tabParts = line.split("\t").map((part) => part.trim()).filter(Boolean);
    if (tabParts.length >= 2) {
      const parsedQuantity = Number(tabParts[1].replace(/,/g, ""));
      if (Number.isFinite(parsedQuantity)) {
        name = tabParts[0];
        quantity = parsedQuantity;
      }
    }
    if (quantity === null) {
      const trailing = line.match(/^(.+?)\s+([\d,]+)$/);
      if (trailing) {
        name = trailing[1];
        quantity = Number(trailing[2].replace(/,/g, ""));
      }
    }
    const typeId = typeIdForName(name);
    if (!typeId || !Number.isFinite(quantity) || quantity <= 0) continue;
    inventory.set(typeId, (inventory.get(typeId) || 0) + quantity);
  }
  return Array.from(inventory.entries());
}

function materialRowsHtml(items, emptyText = "None") {
  if (!items?.length) return `<p class="empty-small">${emptyText}</p>`;
  return `<table class="mini-table">
    <thead><tr><th>Item</th><th>Qty</th><th>Est. cost</th></tr></thead>
    <tbody>
      ${items.map((item) => {
        const name = typeName(item.typeId);
        return `<tr>
        <td><span class="mini-item"><img class="mini-icon" src="${typeIconUrl(item.typeId, 32)}" alt=""><span title="${escapeHtml(name)}">${escapeHtml(name)}</span></span></td>
        <td>${isk(Math.ceil(item.quantity))}</td>
        <td>${item.totalPrice === null ? "-" : `${isk(item.totalPrice)} ISK`}</td>
      </tr>`;
      }).join("")}
    </tbody>
  </table>`;
}

function shoppingText(items) {
  return (items || [])
    .filter((item) => item.quantity > 0)
    .map((item) => `${typeName(item.typeId)}\t${Math.ceil(item.quantity)}`)
    .join("\n");
}

function renderBuildPlan(detail) {
  const cards = [
    ["Output", `${isk(detail.outputUnits)} units`],
    ["Build runs", isk(detail.manufacturingRuns)],
    ["BPCs", isk(detail.requiredBpcs)],
    ["Runs/BPC", isk(detail.inventionRuns)],
    ["Expected attempts", decimal(detail.expectedAttempts, 2)],
    ["Planned attempts", isk(detail.plannedAttempts)],
    ["Invention chance", percent(detail.inventionProbability * 100)],
    ["Invented ME", `${decimal(detail.inventedMaterialEfficiency, 1)}%`],
    ["Invented TE", `${decimal(detail.inventedTimeEfficiency, 1)}%`],
    ["Final build fee", `${isk(detail.finalProductManufacturingJobCostTotal)} ISK`],
    ["Final gross", `${isk(detail.finalProductManufacturingGrossCostTotal)} ISK`],
    ["Final SCC", `${isk(detail.finalProductManufacturingSccSurchargeTotal)} ISK`],
    ["Final facility", `${isk(detail.finalProductManufacturingFacilityTaxTotal)} ISK`],
    ["Component fees", `${isk(detail.componentManufacturingJobCostTotal)} ISK`],
    ["Component gross", `${isk(detail.componentManufacturingGrossCostTotal)} ISK`],
    ["Component SCC", `${isk(detail.componentManufacturingSccSurchargeTotal)} ISK`],
    ["Component facility", `${isk(detail.componentManufacturingFacilityTaxTotal)} ISK`],
    ["Build fees total", `${isk(detail.manufacturingJobCostTotal)} ISK`],
    ["Invention fees", `${isk(detail.inventionJobCostTotal)} ISK`],
  ];
  buildPlan.innerHTML = `<div class="plan-grid">${cards.map(([label, value]) => (
    `<div class="plan-card"><span class="plan-label">${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`
  )).join("")}</div>`;
  directMaterials.innerHTML = materialRowsHtml(detail.directMaterials);
  componentBuilds.innerHTML = materialRowsHtml(detail.componentBuilds, "No intermediate components");
  inventionMaterials.innerHTML = materialRowsHtml(detail.inventionMaterials);
  shoppingList.innerHTML = materialRowsHtml(detail.shoppingList, "Nothing to buy");
  lastShoppingText = shoppingText(detail.shoppingList);
}

async function refreshBuildDetail() {
  if (!activeBuildItem) return;
  const seq = ++buildDetailSeq;
  buildPlan.innerHTML = `<p class="empty-small">Calculating build plan...</p>`;
  try {
    const units = Math.max(1, Math.ceil(Number(buildUnits.value) || 1));
    const detail = await calculateBuildDetail(activeBuildItem.typeId, units, parseInventoryText(inventoryPaste.value));
    if (seq !== buildDetailSeq) return;
    renderBuildPlan(detail);
  } catch (error) {
    if (seq !== buildDetailSeq) return;
    buildPlan.innerHTML = `<p class="empty-small">${error.message || "Build details failed."}</p>`;
  }
}

function openBuildModal(item) {
  activeBuildItem = item;
  const meta = metaFor(item);
  buildIcon.src = typeIconUrl(item.typeId, 64);
  buildTitle.textContent = meta.name;
  buildSubtitle.textContent = `${meta.group} · ${sourceHub.selectedOptions[0]?.textContent || sourceHub.value} materials · ${sellHub.selectedOptions[0]?.textContent || sellHub.value} sales`;
  buildUnits.value = "1";
  inventoryPaste.value = "";
  lastShoppingText = "";
  buildModal.hidden = false;
  document.body.classList.add("modal-open");
  refreshBuildDetail();
}

function closeBuildModal() {
  buildModal.hidden = true;
  document.body.classList.remove("modal-open");
  activeBuildItem = null;
  buildDetailSeq += 1;
}

// ---------------------------------------------------------------------------
// Static data loading
// ---------------------------------------------------------------------------

async function loadStaticData() {
  if (staticData) {
    await ensureAnalysisWorker();
    return staticData;
  }
  const stored = localStorage.getItem("tradefind.staticData");
  const cachedRecord = stored ? JSON.parse(stored) : null;
  const cached = (
    cachedRecord?.version === STATIC_DATA_CACHE_VERSION
    && cachedRecord?.payload?.schema === STATIC_DATA_CACHE_VERSION
    && cachedRecord?.payload?.analysis?.typeNames
  ) ? cachedRecord : null;
  const query = new URLSearchParams({ v: String(STATIC_DATA_CACHE_VERSION) });
  if (cached?.hash) query.set("hash", cached.hash);
  const response = await apiFetch(`/api/static-data?${query}`);
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error || "Static data failed");

  staticData  = (data.unchanged && cached) ? cached.payload : data;
  if (!data.unchanged) {
    localStorage.setItem("tradefind.staticData", JSON.stringify({
      version: STATIC_DATA_CACHE_VERSION,
      hash: data.hash,
      payload: data,
    }));
  }

  staticTypes = new Map(Object.entries(staticData.types));
  typeNameIndex = new Map();
  const indexTypeName = (typeId, name) => {
    const normalized = normalizeTypeName(name);
    if (normalized && !typeNameIndex.has(normalized)) typeNameIndex.set(normalized, Number(typeId));
  };
  for (const [typeId, itemName] of Object.entries(staticData.analysis?.typeNames || {})) {
    indexTypeName(typeId, itemName);
  }
  for (const [typeId, meta] of staticTypes) {
    indexTypeName(typeId, meta.name);
  }
  marketTypeIds = (staticData.marketTypeIds || []).map(Number).slice(0, MARKET_BITSET_BITS);
  marketTypeIndex = new Map(marketTypeIds.map((typeId, index) => [typeId, index]));
  staticCandidates = new Map();
  for (const row of staticData.analysis?.candidates || []) {
    if (!staticCandidates.has(row[0])) staticCandidates.set(row[0], []);
    staticCandidates.get(row[0]).push(row);
  }

  if (staticData.tradeHubs) {
    const hubOptions = buildOptions(staticData.tradeHubs, (hub) => (
      `<option value="${hub.id}"${hub.id === "jita" ? " selected" : ""}>${shortHubLabel(hub)}</option>`
    ));
    sourceHub.innerHTML = hubOptions;
    sellHub.innerHTML   = hubOptions;
  }

  if (staticData.structureProfiles) {
    structureType.innerHTML = buildOptions(staticData.structureProfiles, (profile) => (
      `<option value="${profile.id}"${profile.id === "npc" ? " selected" : ""}>${profile.name}</option>`
    ));
  }

  if (staticData.rigProfiles) {
    refreshRigOptions();
  }

  if (staticData.decryptors) {
    decryptor.innerHTML = buildOptions(staticData.decryptors, (item) => (
      `<option value="${item.id}"${item.id === "none" ? " selected" : ""}>${item.name}</option>`
    ));
  }

  if (staticData.solarSystems) {
    staticSystems = new Map(staticData.solarSystems.map((s) => [s.name.toLowerCase(), s]));
    document.querySelector("#solarSystems").innerHTML = buildOptions(
      staticData.solarSystems,
      (s) => `<option value="${s.name}"></option>`
    );
  }

  syncRigControls();
  await ensureAnalysisWorker();
  return staticData;
}

// ---------------------------------------------------------------------------
// Industry structure sync
// ---------------------------------------------------------------------------

function selectedStructureProfile() {
  return staticData?.structureProfiles?.find((p) => p.id === structureType.value) || null;
}

function syncRigControls() {
  const allowsRigs = selectedStructureProfile()?.allowsRigs !== false;
  refreshRigOptions();
  productRig.disabled  = !allowsRigs;
  componentRig.disabled = !allowsRigs;
  if (!allowsRigs) {
    productRig.value  = "none";
    componentRig.value = "none";
  }
}

// ---------------------------------------------------------------------------
// Main refresh logic
// ---------------------------------------------------------------------------

async function refreshAnalysis(options = {}) {
  if (options.automatic && activeRequest) return;
  const seq = ++refreshSeq;

  if (!options.automatic && activeRequest) {
    activeRequest.abort();
    activeRequest = null;
  }

  if (!options.automatic) setStatusMessage("Checking local cache");
  if (!currentData) rows.innerHTML = emptyRow("Loading market analysis.");
  if (!options.automatic) details.textContent = "";

  try {
    await loadStaticData();
    if (seq !== refreshSeq) return;

    const typeIds  = staticScopedTypeIds();
    const scopeKey = scopeKeyFor(typeIds);

    if (!typeIds.length) {
      queueRender({
        generatedAt:  new Date().toISOString(),
        sourceMarket: sourceHub.selectedOptions[0]?.textContent || sourceHub.value,
        sellMarket:   sellHub.selectedOptions[0]?.textContent   || sellHub.value,
        scanned:      0,
        returned:     0,
        items:        [],
        cache:        null,
        notes:        [],
        scopedTypeIds: typeIds,
      });
      return;
    }

    const refreshWindowMs = options.automatic ? AUTO_REFRESH_WINDOW_MS : 0;
    const refreshRequest = marketDataRefreshRequest(typeIds, refreshWindowMs);
    if (options.automatic) {
      refreshRequest.productTypeIds = refreshRequest.productTypeIds.slice(0, AUTO_REFRESH_BATCH_SIZE);
    }
    const requestSize = marketDataRequestSize(refreshRequest);

    if (requestSize) {
      if (!options.automatic && refreshRequest.productTypeIds.length < typeIds.length) {
        queueRender(dataFromCachedItems(typeIds, {
          notes: ["Showing fresh local rows while refreshing expired or missing items."],
        }));
      }

      if (!options.automatic) {
        setStatusMessage(`Refreshing ${isk(requestSize)} stale or missing market rows`);
      }

      if (activeRequest) {
        if (options.automatic) return;
        activeRequest.abort();
      }

      const controller = new AbortController();
      activeRequest    = controller;
      const payloads   = await fetchMarketData(refreshRequest, controller.signal);
      if (activeRequest === controller) activeRequest = null;

      for (const rawData of payloads) mergeMarketData(rawData);
      if (seq !== refreshSeq || scopeKey !== scopeKeyFor(staticScopedTypeIds())) return;
    }

    if (seq !== refreshSeq || scopeKey !== scopeKeyFor(staticScopedTypeIds())) return;

    const calculatedItems = await calculateItems(typeIds);
    if (seq !== refreshSeq || scopeKey !== scopeKeyFor(staticScopedTypeIds())) return;

    const rates = feeRates();
    const ratesKey = feeRatesKey();
    const returned = new Set();
    for (const item of calculatedItems) {
      returned.add(item.typeId);
      const cacheKey  = itemCacheKey(item.typeId);
      const previous  = cachedAdjustedItem(item.typeId);
      const decorated = decorateUpdatedItem(previous, adjustedItem(item, rates));
      const validUntil = usableValidUntil(item.validUntil || activeMarketCache().validUntil);
      itemCache.set(cacheKey, {
        baseItem:     item,
        item:         decorated,
        ratesKey,
        validUntil,
        refreshAfter: refreshAfterFor(item.typeId, validUntil),
      });
    }

    for (const typeId of typeIds) {
      if (!returned.has(typeId)) {
        const validUntil = negativeValidUntil();
        itemCache.set(itemCacheKey(typeId), {
          item:         null,
          validUntil,
          refreshAfter: refreshAfterFor(typeId, validUntil),
        });
      }
    }
    queueRender(dataFromCachedItems(typeIds, { automatic: options.automatic }));
  } catch (error) {
    if (error.name === "AbortError") return;
    setStatusMessage(error.message);
    rows.innerHTML = emptyRow("Analysis failed.");
  }
}

// ---------------------------------------------------------------------------
// Cache status polling
// ---------------------------------------------------------------------------

function renderCacheStatus(data) {
  cacheStatusData = data;
  if (data?.c && data.c !== lastChangeBitset && staticData) {
    lastChangeBitset = data.c;
    const scopedTypeIds = staticScopedTypeIds();
    const interested = new Set([
      ...scopedTypeIds,
      ...sourceInputIdsFor(scopedTypeIds),
    ]);
    const changed = typeIdsFromMarketBitset(data.c).filter((typeId) => interested.has(typeId));
    if (changed.length) {
      const cache = activeMarketCache();
      cache.validUntil = null;
      for (const typeId of changed) {
        for (const row of [
          cache.productOrders.get(typeId),
          cache.inputOrders.get(typeId),
          cache.histories.get(typeId),
          cache.adjustedPrices.get(typeId),
        ]) {
          if (row) row.expiresAt = null;
        }
      }
      scheduleRefresh(0, { automatic: true });
    }
  }
  if (currentData) queueRender(currentData);
}

async function refreshCacheStatus() {
  try {
    const response = await apiFetch("/api/cache-warm/status");
    const data     = await response.json();
    if (!response.ok || data.error) throw new Error(data.error || "Cache status failed");
    renderCacheStatus(data);
  } catch {
    cacheStatusData = null;
    if (currentData) queueRender(currentData);
  }
}

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------

sourceHub.addEventListener("change",   () => scheduleRefresh(0));
sellHub.addEventListener("change",     () => scheduleRefresh(0));
structureType.addEventListener("change", () => { syncRigControls(); scheduleRefresh(0); });
productRig.addEventListener("change",  () => scheduleRefresh(0));
componentRig.addEventListener("change",() => scheduleRefresh(0));
decryptor.addEventListener("change",   () => scheduleRefresh(0));

buildSystem.addEventListener("change", () => {
  const match = staticSystems.get(buildSystem.value.trim().toLowerCase());
  if (match) buildSystemId.value = match.id;
  scheduleRefresh(0);
});

rows.addEventListener("click", (event) => {
  const row = event.target.closest("tr[data-index]");
  if (!row || !rows.contains(row)) return;
  // FIX: use module-level visibleItemsList instead of rows._visibleItems
  const item = visibleItemsList[Number(row.dataset.index)];
  if (!item) return;
  openBuildModal(item);
});

buildClose.addEventListener("click", closeBuildModal);
buildModal.addEventListener("click", (event) => {
  if (event.target === buildModal) closeBuildModal();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !buildModal.hidden) closeBuildModal();
});
buildUnits.addEventListener("input", () => refreshBuildDetail());
inventoryPaste.addEventListener("input", () => refreshBuildDetail());
copyShopping.addEventListener("click", async () => {
  if (!lastShoppingText) return;
  await navigator.clipboard.writeText(lastShoppingText);
  copyShopping.textContent = "Copied";
  window.setTimeout(() => { copyShopping.textContent = "Copy"; }, 1200);
});

rows.addEventListener("animationend", (event) => {
  if (event.animationName === "cell-update") {
    event.target.classList.remove("cell-updated");
  }
});

for (const button of sortButtons) {
  button.addEventListener("click", () => {
    const key = button.dataset.sort;
    if (sortState.key === key) {
      sortState.direction = sortState.direction === "asc" ? "desc" : "asc";
    } else {
      sortState = { key, direction: "desc" };
    }
    if (currentData) queueRender(currentData);
    else updateSortHeaders();
  });
}

for (const id of fields) {
  const field = document.querySelector(`#${id}`);
  field.addEventListener("input", () => {
    if (id === "search") scheduleRefresh();
    else if (id === "facilityTaxRate") scheduleRefresh(0);
    else if (id === "salesTaxRate" || id === "brokerFeeRate") {
      if (currentData) rerenderFromCache();
    }
    else if (currentData) queueRender(currentData);
  });
  field.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (id === "search") scheduleRefresh(0);
    else if (id === "facilityTaxRate") scheduleRefresh(0);
    else if (id === "salesTaxRate" || id === "brokerFeeRate") {
      if (currentData) rerenderFromCache();
      else scheduleRefresh(0);
    }
    else if (currentData) queueRender(currentData);
    else scheduleRefresh(0);
  });
}

for (const field of typeFilters) {
  field.addEventListener("change", () => scheduleRefresh(0));
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

updateSortHeaders();
refreshCacheStatus();
cachePoll = window.setInterval(refreshCacheStatus, 10_000);
itemPoll  = window.setInterval(() => scheduleRefresh(0, { automatic: true }), AUTO_POLL_INTERVAL_MS);
loadStaticData()
  .then(() => scheduleRefresh(0))
  .catch((error) => setStatusMessage(error.message));
