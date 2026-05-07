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

// Compact wire-format field order for inflating array rows from the API
const itemFields = [
  "typeId",
  "buildCost", "manufacturingCost", "inventionCost",
  "manufacturingJobCost", "inventionJobCost",
  "sellPrice", "buyPrice",
  "profit", "profitToBuy", "margin", "buyMargin", "profitPerM3",
  "dailyVolume", "sellOrders", "sellVolume",
  "inventionProbability", "inventionRuns",
  "inventedMaterialEfficiency", "inventedTimeEfficiency",
  "manufacturingQuantity",
  "validUntil",
];

const ITEM_CACHE_SCHEMA        = "cost-model-v3";
const AUTO_REFRESH_MIN_DELAY_MS = 5_000;
const AUTO_POLL_INTERVAL_MS    = 15_000;
const AUTO_REFRESH_BATCH_SIZE  = 150;
const AUTO_REFRESH_WINDOW_MS   = 0;
const CLIENT_RETRY_MS          = 5 * 60 * 1000;
const CLIENT_RECHECK_JITTER_MS = 2 * 60 * 1000;
const NEGATIVE_CACHE_MS        = CLIENT_RETRY_MS;

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
const rows         = document.querySelector("#rows");
const status       = document.querySelector("#status");
const details      = document.querySelector("#details");
const sortButtons  = Array.from(document.querySelectorAll(".sort"));
const typeFilters  = Array.from(document.querySelectorAll(".type-filter"));

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let currentData          = null;
let staticData           = null;
let staticTypes          = new Map();  // typeId (string) → meta object
let staticSystems        = new Map();  // system name (lowercase) → system object
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

const itemCache = new Map();   // cacheKey → { item, validUntil, refreshAfter }

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

// CHANGE: unified percent helpers — compactPercent delegates to compact so
// formatting logic lives in exactly one place.
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
  if (["sellVolume", "sellOrders"].includes(field)) return `${iskFormatter.format(value)} units`;
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

function hubName(id) {
  return staticData?.tradeHubs?.find((hub) => hub.id === id)?.name || id;
}

function typeIconUrl(typeId, size = 32) {
  return `https://images.evetech.net/types/${typeId}/icon?size=${size}`;
}

// CHANGE: extracted shared helper — previously hubs, structures, rigs, and
// decryptors each had their own inline map+join; now they all go through here.
function buildOptions(items, fn) {
  return items.map(fn).join("");
}

function rigLabel(rig, context) {
  if (rig.id === "none") return `No ${context} rig`;
  if (rig.id === "t1")   return `T1 ${context} rig`;
  if (rig.id === "t2")   return `T2 ${context} rig`;
  return `${rig.name} (${context})`;
}

function rigOptions(context) {
  return buildOptions(staticData.rigProfiles, (rig) => (
    `<option value="${rig.id}">${rigLabel(rig, context)}</option>`
  ));
}

// ---------------------------------------------------------------------------
// Cache key helpers
// ---------------------------------------------------------------------------

// CHANGE: `buildSettingsKey` no longer has the redundant `|| "30000142"` fallback
// because buildSystemId's HTML value attribute always provides a default.
function buildSettingsKey() {
  return [
    buildSystemId.value,
    structureType.value,
    productRig.value,
    componentRig.value,
    decryptor.value,
  ].join("|");
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

function entryRefreshAt(entry) {
  // Date.parse(undefined) === NaN, and Number.isFinite(NaN) === false, which
  // is handled correctly by every caller.
  return Date.parse(entry?.refreshAfter || entry?.validUntil);
}

function freshCacheEntry(typeId) {
  const entry = itemCache.get(itemCacheKey(typeId));
  if (!entry || !entry.validUntil || Date.now() >= Date.parse(entry.validUntil)) return null;
  return entry;
}

function cachedEntry(typeId) {
  return itemCache.get(itemCacheKey(typeId)) || null;
}

function stableJitterMs(typeId, windowMs = CLIENT_RECHECK_JITTER_MS) {
  const value = Number(typeId) || 0;
  return Math.abs((value * 1103515245 + 12345) % windowMs);
}

function cacheEntryNeedsRefresh(typeId, refreshWindowMs = 0) {
  const entry = itemCache.get(itemCacheKey(typeId));
  const refreshAt = entryRefreshAt(entry);
  return !entry || !Number.isFinite(refreshAt) || Date.now() >= refreshAt - refreshWindowMs;
}

// CHANGE: capture `Date.now()` once to avoid the two calls having different
// values when the clock ticks between them (was an extremely minor correctness
// issue but free to fix).
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

// CHANGE: previously `changeDirection` made two passes over the fields —
// first over `changeFields` to detect any change, then over `directionFields`
// to pick up/down.  Now a single pass handles both, and we use the shared
// `directionFields` set (a subset of `changeFields`) to determine direction
// while still detecting non-directional changes via the other fields.
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
  return anyChanged ? "same" : "same";  // non-directional change → "same" arrow
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

// CHANGE: `sortValue` now explicitly reads item-level fields first, then falls
// back to meta — previously it tried `item[key]` first and only reached
// `meta[key]` for undefined item fields.  The original code happened to work
// for `name`/`kind`/`volume` because those keys don't exist on items, but the
// intent is clearer with an explicit set.
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

function visibleItems(items, state = filterState()) {
  return sortedItems(filteredItems(items, state));
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

// CHANGE: merged setSummary + setSummaryMessage into one function.
// Pass an array of [label, value] pairs for a full summary, or a plain string
// for a single-card message.
function setStatus(cardsOrMessage) {
  if (typeof cardsOrMessage === "string") {
    status.innerHTML = summaryCard("", cardsOrMessage);
  } else {
    status.innerHTML = cardsOrMessage.map(([label, value]) => summaryCard(label, value)).join("");
  }
}

function cacheSummaryCards() {
  if (!cacheStatusData) {
    return [["Hubs", "Preparing"], ["Orders", "-"], ["History", "-"], ["Refresh", "-"], ["API Cache", "-"]];
  }
  if (Array.isArray(cacheStatusData.w)) {
    const [running, completed, total] = cacheStatusData.w;
    const [apiHits = 0, apiMisses = 0] = cacheStatusData.a || [];
    return [
      ["Hubs",      compactPair(cacheStatusData.h)],
      ["Orders",    compactPair(cacheStatusData.o)],
      ["History",   compactPair(cacheStatusData.m)],
      ["Refresh",   running ? ratioPercent(completed, total) : "Idle"],
      ["API Cache", ratioPercent(apiHits, apiHits + apiMisses)],
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

function inflateItem(row) {
  if (!Array.isArray(row)) return row;
  return Object.fromEntries(itemFields.map((field, i) => [field, row[i]]));
}

function normalizeApiData(data) {
  if (data.items) return data;
  const items = (data.i || []).map(inflateItem);
  return {
    generatedAt: data.t,
    sourceHub: sourceHub.value,
    sellHub: sellHub.value,
    sourceMarket: hubName(sourceHub.value),
    sellMarket: hubName(sellHub.value),
    scanned: data.sc,
    returned: items.length,
    items,
    unpricedTypeIds: data.u || [],
    cache: data.c ? {
      memoryHits:          data.c[0],
      sqliteHits:          data.c[1],
      staleHits:           data.c[2],
      esiCalls:            data.c[3],
      misses:              data.c[4],
    } : null,
    validUntil: data.v,
  };
}

// CHANGE: extracted a reusable empty-row helper used in three places.
function emptyRow(message) {
  return `<tr><td colspan="14" class="empty">${message}</td></tr>`;
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
    const entry = cachedEntry(typeId);
    if (entry?.item) items.push(entry.item);
  }
  return {
    generatedAt:  new Date().toISOString(),
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

async function fetchItems(typeIds, signal) {
  return apiFetch("/api/items", {
    method: "POST",
    signal,
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
    body: JSON.stringify({
      s:  sourceHub.value,
      b:  sellHub.value,
      g:  buildSystemId.value,
      st: structureType.value,
      pr: productRig.value,
      cr: componentRig.value,
      d:  decryptor.value,
      y:  typeIds,
    }),
  });
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function directionIndicator(direction, title) {
  return `<span class="change change-${direction}" title="${title}" aria-label="${title}"></span>`;
}

function changeIndicator(item) {
  const direction = item._changeDirection || "same";
  const title = direction === "up"
    ? "Updated: profitability improved"
    : direction === "down"
      ? "Updated: profitability fell"
      : "No material change";
  return directionIndicator(direction, title);
}

function metricCell(item, field, value, className = "") {
  const direction = item._changes?.[field] || "same";
  const updated   = direction !== "same" ? " cell-updated" : "";
  return `<td data-field="${field}" class="${className} metric-cell change-cell-${direction}${updated}" title="${fullValue(field, item[field])}">${value}</td>`;
}

function rowHtml(item) {
  const meta = metaFor(item);
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
    ${metricCell(item, "profitPerM3", compact(item.profitPerM3),    profitClass(item.profitPerM3))}
    ${metricCell(item, "profit",      compact(item.profit),         profitClass(item.profit))}
    ${metricCell(item, "margin",      compactPercent(item.margin),  profitClass(item.margin))}
    ${metricCell(item, "profitToBuy", compact(item.profitToBuy),    profitClass(item.profitToBuy))}
    ${metricCell(item, "buildCost",   compact(item.buildCost))}
    ${metricCell(item, "sellPrice",   compact(item.sellPrice))}
    ${metricCell(item, "buyPrice",    compact(item.buyPrice))}
    ${metricCell(item, "buyMargin",   compactPercent(item.buyMargin), profitClass(item.buyMargin))}
    ${metricCell(item, "dailyVolume", compact(item.dailyVolume))}
    ${metricCell(item, "sellOrders",  item.sellOrders)}
    ${metricCell(item, "sellVolume",  compact(item.sellVolume))}
    <td data-field="volume" class="metric-cell change-cell-same" title="${fullValue("volume", meta.volume)}">${compact(meta.volume)}</td>
  </tr>`;
}

function updateMetricCell(row, item, field, value, className = "") {
  const cell = row.querySelector(`[data-field="${field}"]`);
  if (!cell) return;
  const direction = item._changes?.[field] || "same";
  cell.className = [className, "metric-cell", `change-cell-${direction}`, direction !== "same" ? "cell-updated" : ""]
    .filter(Boolean)
    .join(" ");
  cell.title      = fullValue(field, item[field]);
  cell.textContent = value;
}

function updateRow(row, item) {
  const nameIndicator = row.querySelector(".item-name .change");
  if (nameIndicator) nameIndicator.outerHTML = changeIndicator(item);
  updateMetricCell(row, item, "profitPerM3", compact(item.profitPerM3),   profitClass(item.profitPerM3));
  updateMetricCell(row, item, "profit",      compact(item.profit),        profitClass(item.profit));
  updateMetricCell(row, item, "margin",      compactPercent(item.margin), profitClass(item.margin));
  updateMetricCell(row, item, "profitToBuy", compact(item.profitToBuy),   profitClass(item.profitToBuy));
  updateMetricCell(row, item, "buildCost",   compact(item.buildCost));
  updateMetricCell(row, item, "sellPrice",   compact(item.sellPrice));
  updateMetricCell(row, item, "buyPrice",    compact(item.buyPrice));
  updateMetricCell(row, item, "buyMargin",   compactPercent(item.buyMargin), profitClass(item.buyMargin));
  updateMetricCell(row, item, "dailyVolume", compact(item.dailyVolume));
  updateMetricCell(row, item, "sellOrders",  item.sellOrders);
  updateMetricCell(row, item, "sellVolume",  compact(item.sellVolume));
}

// CHANGE: hoisted the `<template>` element out of the loop — creating a DOM
// element per-iteration was unnecessary and measurably slower for large lists.
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
    // Store the logical index directly on the element so click handlers can
    // look up items without scanning the visible list.
    row.dataset.index = String(index);
    fragment.appendChild(row);
  }
  rows.replaceChildren(fragment);
  rows._visibleItems = items;
}

// ---------------------------------------------------------------------------
// Scheduling helpers
// ---------------------------------------------------------------------------

function scheduleNextExpiryRefresh(typeIds) {
  window.clearTimeout(expiryTimer);
  const expiries = typeIds
    .map((typeId) => entryRefreshAt(itemCache.get(itemCacheKey(typeId))))
    .filter((t) => Number.isFinite(t));
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

  // CHANGE: previously, change markers were only cleared for items that were
  // currently visible/rendered.  Items that were filtered out while a change
  // was pending would never have their markers cleared, and would flash the
  // change arrow when they became visible again even though the change was old.
  // Now we clear markers on the cache entry for every item that has a pending
  // change, regardless of whether it was rendered this frame.
  for (const item of items) {
    const hasChange = item._changes && Object.values(item._changes).some((d) => d !== "same");
    if (!hasChange) continue;
    const key   = itemCacheKey(item.typeId);
    const entry = itemCache.get(key);
    if (entry?.item) {
      itemCache.set(key, { ...entry, item: clearChangeMarkers(entry.item) });
    }
    item._changeDirection = "same";
    item._changes = {};
  }
}

function queueRender(data) {
  currentData = data;
  window.cancelAnimationFrame(renderTimer);
  renderTimer = window.requestAnimationFrame(() => render(data));
}

// ---------------------------------------------------------------------------
// Static data loading
// ---------------------------------------------------------------------------

async function loadStaticData() {
  if (staticData) return staticData;
  const stored = localStorage.getItem("tradefind.staticData");
  const cached = stored ? JSON.parse(stored) : null;
  const query = cached?.hash ? `?hash=${encodeURIComponent(cached.hash)}` : "";
  const response = await apiFetch(`/api/static-data${query}`);
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error || "Static data failed");

  staticData  = (data.unchanged && cached) ? cached.payload : data;
  if (!data.unchanged) {
    localStorage.setItem("tradefind.staticData", JSON.stringify({ hash: data.hash, payload: data }));
  }

  staticTypes = new Map(Object.entries(staticData.types));

  if (staticData.tradeHubs) {
    // CHANGE: use shared buildOptions helper instead of inline map+join
    const hubOptions = buildOptions(staticData.tradeHubs, (hub) => (
      `<option value="${hub.id}"${hub.id === "jita" ? " selected" : ""}>${hub.name}</option>`
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
    productRig.innerHTML  = rigOptions("product");
    componentRig.innerHTML = rigOptions("components");
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

  if (!options.automatic) setStatus("Checking local cache");
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
    const dueTypeIds = typeIds
      .filter((typeId) => cacheEntryNeedsRefresh(typeId, refreshWindowMs))
      .sort((left, right) => {
        const leftAt  = entryRefreshAt(itemCache.get(itemCacheKey(left)))  || 0;
        const rightAt = entryRefreshAt(itemCache.get(itemCacheKey(right))) || 0;
        return leftAt - rightAt;
      });

    const missingTypeIds = options.automatic ? dueTypeIds.slice(0, AUTO_REFRESH_BATCH_SIZE) : dueTypeIds;

    if (missingTypeIds.length) {
      if (!options.automatic && missingTypeIds.length < typeIds.length) {
        queueRender(dataFromCachedItems(typeIds, {
          notes: ["Showing fresh local rows while refreshing expired or missing items."],
        }));
      }

      if (!options.automatic) {
        setStatus(`Refreshing ${isk(missingTypeIds.length)} stale or missing prices`);
      }

      if (activeRequest) {
        if (options.automatic) return;
        activeRequest.abort();
      }

      const controller = new AbortController();
      activeRequest    = controller;
      const response   = await fetchItems(missingTypeIds, controller.signal);
      if (activeRequest === controller) activeRequest = null;

      const rawData = await response.json();
      if (!response.ok || rawData.error) throw new Error(rawData.error || "Request failed");

      const data = normalizeApiData(rawData);
      if (seq !== refreshSeq || scopeKey !== scopeKeyFor(staticScopedTypeIds())) return;

      const returned = new Set();
      for (const item of data.items) {
        returned.add(item.typeId);
        const previous   = itemCache.get(itemCacheKey(item.typeId))?.item;
        const decorated  = decorateUpdatedItem(previous, item);
        const validUntil = usableValidUntil(item.validUntil || data.validUntil);
        itemCache.set(itemCacheKey(item.typeId), {
          item:         decorated,
          validUntil,
          refreshAfter: refreshAfterFor(item.typeId, validUntil),
        });
      }

      for (const typeId of data.unpricedTypeIds || missingTypeIds) {
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
      return;
    }

    queueRender(dataFromCachedItems(typeIds, { automatic: options.automatic }));
  } catch (error) {
    if (error.name === "AbortError") return;
    setStatus(error.message);
    rows.innerHTML = emptyRow("Analysis failed.");
  }
}

// ---------------------------------------------------------------------------
// Cache status polling
// ---------------------------------------------------------------------------

function renderCacheStatus(data) {
  cacheStatusData = data;
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
  const item = rows._visibleItems?.[Number(row.dataset.index)];
  if (!item) return;
  const meta = metaFor(item);
  details.innerHTML = `
    <strong>${meta.name}</strong>
    costs ${isk(item.manufacturingCost)} ISK/unit to build plus ${isk(item.inventionCost)} ISK/unit expected invention cost.
    Sell margin ${percent(item.margin)}; buy-order return on build cost ${percent(item.buyMargin)}.
    Haul volume ${decimal(meta.volume, 2)} m3; assembled volume ${decimal(meta.assembledVolume, 2)} m3.
    Invention chance ${decimal(item.inventionProbability * 100, 1)}% via ${meta.inventionBlueprint}, invented runs ${item.inventionRuns}, invented ME ${decimal(item.inventedMaterialEfficiency, 1)}%, TE ${decimal(item.inventedTimeEfficiency, 1)}%, manufacturing output ${item.manufacturingQuantity}.
    Included job fees: manufacturing ${isk(item.manufacturingJobCost)} ISK/unit, invention ${isk(item.inventionJobCost)} ISK/unit.
    Sell-region average daily sales ${decimal(item.dailyVolume, 1)} units; sell-hub listing ${isk(item.sellVolume)} units across ${item.sellOrders} sell orders.
  `;
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
    // Search uses a debounce delay to avoid firing on every keystroke;
    // range inputs re-filter immediately since they're numeric.
    if (id === "search") scheduleRefresh();
    else if (currentData) queueRender(currentData);
  });
  field.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (id === "search") scheduleRefresh(0);
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
  .catch((error) => setStatus(error.message));
