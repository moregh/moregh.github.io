const fields = [
  "search",
  "minProfit",
  "maxProfit",
  "minProfitM3",
  "maxProfitM3",
  "minDailyVolume",
  "maxDailyVolume",
  "minOrders",
  "maxOrders",
  "minCost",
  "maxCost",
  "minM3",
  "maxM3",
];

const kindFilters = {
  Ship: ["Ship"],
  Drone: ["Drone", "Fighter"],
  Module: ["Module", "Structure Module"],
  Charge: ["Charge"],
};

const sourceHub = document.querySelector("#sourceHub");
const sellHub = document.querySelector("#sellHub");
const buildSystem = document.querySelector("#buildSystem");
const buildSystemId = document.querySelector("#buildSystemId");
const structureType = document.querySelector("#structureType");
const productRig = document.querySelector("#productRig");
const componentRig = document.querySelector("#componentRig");
const decryptor = document.querySelector("#decryptor");
const rows = document.querySelector("#rows");
const status = document.querySelector("#status");
const details = document.querySelector("#details");
const sortButtons = Array.from(document.querySelectorAll(".sort"));
const typeFilters = Array.from(document.querySelectorAll(".type-filter"));

let currentData = null;
let staticData = null;
let staticTypes = new Map();
let staticSystems = new Map();
let sortState = { key: "profitPerM3", direction: "desc" };
let cachePoll = null;
let itemPoll = null;
let refreshTimer = null;
let expiryTimer = null;
let refreshSeq = 0;
let renderTimer = null;
let activeRequest = null;
let lastRenderSignature = "";
let cacheStatusData = null;
const itemCache = new Map();
const ITEM_CACHE_SCHEMA = "cost-model-v3";
const AUTO_REFRESH_MIN_DELAY_MS = 5_000;
const AUTO_POLL_INTERVAL_MS = 15_000;
const AUTO_REFRESH_BATCH_SIZE = 150;
const AUTO_REFRESH_WINDOW_MS = 0;
const CLIENT_RETRY_MS = 5 * 60 * 1000;
const CLIENT_RECHECK_JITTER_MS = 2 * 60 * 1000;
const NEGATIVE_CACHE_MS = CLIENT_RETRY_MS;
const API_BASES = [
  "https://api.styrofoamxylophone.com",
];
let activeApiBase = null;
const iskFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const compactFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const decimalFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const decimal2Formatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const changeFields = [
  "profitPerM3",
  "profit",
  "margin",
  "buildCost",
  "sellPrice",
  "buyPrice",
  "profitToBuy",
  "buyMargin",
  "dailyVolume",
  "sellOrders",
  "sellVolume",
];
const itemFields = [
  "typeId",
  "buildCost",
  "manufacturingCost",
  "inventionCost",
  "manufacturingJobCost",
  "inventionJobCost",
  "sellPrice",
  "buyPrice",
  "profit",
  "profitToBuy",
  "margin",
  "buyMargin",
  "profitPerM3",
  "dailyVolume",
  "sellOrders",
  "sellVolume",
  "inventionProbability",
  "inventionRuns",
  "inventedMaterialEfficiency",
  "inventedTimeEfficiency",
  "manufacturingQuantity",
  "validUntil",
];

function isk(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return iskFormatter.format(value);
}

async function apiFetch(path, options = {}) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const bases = activeApiBase
    ? [activeApiBase, ...API_BASES.filter((base) => base !== activeApiBase)]
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

function compact(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return compactFormatter.format(value);
}

function decimal(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return digits === 2 ? decimal2Formatter.format(value) : decimalFormatter.format(value);
}

function percent(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return `${decimal(value, 1)}%`;
}

function compactPercent(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return `${compact(value, 1)}%`;
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
  if (["margin", "buyMargin"].includes(field)) {
    return `${decimal(value, 2)}%`;
  }
  if (field === "dailyVolume") {
    return `${decimal(value, 2)} units/day`;
  }
  if (["sellVolume", "sellOrders"].includes(field)) {
    return `${iskFormatter.format(value)} units`;
  }
  if (field === "volume") {
    return `${decimal(value, 2)} m3`;
  }
  return String(value);
}

function visibleSignature(items) {
  return items.map((item) => (
    [
      item.typeId,
      item.profitPerM3,
      item.profit,
      item.margin,
      item.buildCost,
      item.sellPrice,
      item.buyPrice,
      item.profitToBuy,
      item.buyMargin,
      item.dailyVolume,
      item.sellOrders,
      item.sellVolume,
    ].join(":")
  )).join("|");
}

function numericInput(id) {
  const value = document.querySelector(`#${id}`).value.trim();
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function profitClass(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  return value >= 0 ? "profit" : "loss";
}

function timeShort(value) {
  if (!value) return "-";
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function summaryCard(label, value) {
  return `
    <span class="summary-card">
      <span class="summary-label">${label}</span>
      <span class="summary-value">${value}</span>
    </span>
  `;
}

function setSummary(cards) {
  status.innerHTML = cards.map(([label, value]) => summaryCard(label, value)).join("");
}

function setSummaryMessage(message) {
  status.innerHTML = `<span class="summary-card"><span class="summary-value">${message}</span></span>`;
}

function cacheSummaryCards() {
  if (!cacheStatusData) {
    return [["Hubs", "Preparing"], ["Orders", "-"], ["History", "-"], ["Refresh", "-"], ["API Cache", "-"]];
  }
  if (Array.isArray(cacheStatusData.w)) {
    const [running, completed, total] = cacheStatusData.w;
    const [apiHits = 0, apiMisses = 0] = cacheStatusData.a || [];
    const apiTotal = apiHits + apiMisses;
    return [
      ["Hubs", compactPair(cacheStatusData.h)],
      ["Orders", compactPair(cacheStatusData.o)],
      ["History", compactPair(cacheStatusData.m)],
      ["Refresh", running ? ratioPercent(completed, total) : "Idle"],
      ["API Cache", ratioPercent(apiHits, apiTotal)],
    ];
  }
  const hubCount = cacheStatusData.hubs?.length || 0;
  const availableHubs = cacheStatusData.hubs?.filter((hub) => (
    hub.availableOrders > 0 && hub.availableHistory > 0
  )).length || 0;
  const percentDone = cacheStatusData.total
    ? `${Math.round((cacheStatusData.completed / cacheStatusData.total) * 100)}%`
    : "Idle";
  return [["Hubs", `${availableHubs}/${hubCount}`], ["Refresh", cacheStatusData.running ? percentDone : "Idle"]];
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
    enabledKinds: selectedKinds(),
    search: document.querySelector("#search").value.trim().toLowerCase(),
    minProfit: numericInput("minProfit"),
    maxProfit: numericInput("maxProfit"),
    minProfitM3: numericInput("minProfitM3"),
    maxProfitM3: numericInput("maxProfitM3"),
    minDailyVolume: numericInput("minDailyVolume"),
    maxDailyVolume: numericInput("maxDailyVolume"),
    minOrders: numericInput("minOrders"),
    maxOrders: numericInput("maxOrders"),
    minCost: numericInput("minCost"),
    maxCost: numericInput("maxCost"),
    minM3: numericInput("minM3"),
    maxM3: numericInput("maxM3"),
  };
}

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

function buildSettingsKey() {
  return [
    buildSystemId.value || "30000142",
    structureType.value,
    productRig.value,
    componentRig.value,
    decryptor.value,
  ].join("|");
}

function inflateItem(row) {
  if (!Array.isArray(row)) return row;
  return Object.fromEntries(itemFields.map((field, index) => [field, row[index]]));
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
      memoryHits: data.c[0],
      sqliteHits: data.c[1],
      staleHits: data.c[2],
      esiCalls: data.c[3],
      misses: data.c[4],
    } : null,
    validUntil: data.v,
  };
}

function sortValue(item, key) {
  const meta = metaFor(item);
  const value = item[key] ?? meta[key];
  if (typeof value === "string") return value.toLowerCase();
  if (value === null || value === undefined || Number.isNaN(value)) return Number.NEGATIVE_INFINITY;
  return value;
}

function sortedItems(items) {
  const direction = sortState.direction === "asc" ? 1 : -1;
  return [...items].sort((a, b) => {
    const left = sortValue(a, sortState.key);
    const right = sortValue(b, sortState.key);
    if (left < right) return -1 * direction;
    if (left > right) return 1 * direction;
    return metaFor(a).name.localeCompare(metaFor(b).name);
  });
}

function filteredItems(items, state = filterState()) {
  const belowMin = (value, min) => min !== null && (value === null || value === undefined || Number.isNaN(value) || value < min);
  const aboveMax = (value, max) => max !== null && (value === null || value === undefined || Number.isNaN(value) || value > max);
  return items.filter((item) => {
    const meta = metaFor(item);
    if (!state.enabledKinds.has(meta.kind)) return false;
    if (state.search) {
      const haystack = `${meta.name} ${meta.group}`.toLowerCase();
      if (!haystack.includes(state.search)) return false;
    }
    if (belowMin(item.profit, state.minProfit)) return false;
    if (aboveMax(item.profit, state.maxProfit)) return false;
    if (belowMin(item.profitPerM3, state.minProfitM3)) return false;
    if (aboveMax(item.profitPerM3, state.maxProfitM3)) return false;
    if (belowMin(item.dailyVolume, state.minDailyVolume)) return false;
    if (aboveMax(item.dailyVolume, state.maxDailyVolume)) return false;
    if (belowMin(item.sellOrders, state.minOrders)) return false;
    if (aboveMax(item.sellOrders, state.maxOrders)) return false;
    if (belowMin(item.buildCost, state.minCost)) return false;
    if (aboveMax(item.buildCost, state.maxCost)) return false;
    if (state.minM3 !== null && meta.volume < state.minM3) return false;
    if (state.maxM3 !== null && meta.volume > state.maxM3) return false;
    return true;
  });
}

function visibleItems(items, state = filterState()) {
  return sortedItems(filteredItems(items, state));
}

function scopeKeyFor(typeIds) {
  return `${ITEM_CACHE_SCHEMA}|${sourceHub.value}|${sellHub.value}|${buildSettingsKey()}|${typeIds.join(",")}`;
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

function itemCacheKey(typeId) {
  return `${ITEM_CACHE_SCHEMA}|${sourceHub.value}|${sellHub.value}|${buildSettingsKey()}|${typeId}`;
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

function entryRefreshAt(entry) {
  return Date.parse(entry?.refreshAfter || entry?.validUntil);
}

function cacheEntryNeedsRefresh(typeId, refreshWindowMs = 0) {
  const entry = itemCache.get(itemCacheKey(typeId));
  const refreshAt = entryRefreshAt(entry);
  return !entry || !Number.isFinite(refreshAt) || Date.now() >= refreshAt - refreshWindowMs;
}

function usableValidUntil(validUntil, fallbackMs = CLIENT_RETRY_MS) {
  const parsed = Date.parse(validUntil);
  if (Number.isFinite(parsed) && parsed > Date.now()) return validUntil;
  return new Date(Date.now() + fallbackMs).toISOString();
}

function negativeValidUntil() {
  return new Date(Date.now() + NEGATIVE_CACHE_MS).toISOString();
}

function refreshAfterFor(typeId, validUntil) {
  const parsed = Date.parse(validUntil);
  const base = Number.isFinite(parsed) ? Math.max(parsed, Date.now() + AUTO_REFRESH_MIN_DELAY_MS) : Date.now() + CLIENT_RETRY_MS;
  return new Date(base + stableJitterMs(typeId)).toISOString();
}

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

function changeDirection(previous, next) {
  if (!previous) return "same";
  const changed = changeFields.some((field) => valuesDiffer(previous[field], next[field]));
  if (!changed) return "same";
  const directionFields = ["profitPerM3", "profit", "margin", "sellPrice", "buyPrice"];
  for (const field of directionFields) {
    if (!valuesDiffer(previous[field], next[field])) continue;
    return comparableValue(next[field]) > comparableValue(previous[field]) ? "up" : "down";
  }
  return "same";
}

function fieldDirection(previous, next, field) {
  if (!previous || !valuesDiffer(previous[field], next[field])) return "same";
  return comparableValue(next[field]) > comparableValue(previous[field]) ? "up" : "down";
}

function decorateUpdatedItem(previous, next) {
  if (!previous) {
    return { ...next, _changeDirection: "same", _changes: {} };
  }
  const direction = changeDirection(previous, next);
  return {
    ...next,
    _changeDirection: direction,
    _changes: Object.fromEntries(changeFields.map((field) => [field, fieldDirection(previous, next, field)])),
  };
}

function clearChangeMarkers(item) {
  if (!item) return item;
  return { ...item, _changeDirection: "same", _changes: {} };
}

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
  const title = fullValue(field, item[field]);
  const updated = direction !== "same" ? " cell-updated" : "";
  return `<td data-field="${field}" class="${className} metric-cell change-cell-${direction}${updated}" title="${title}">${value}</td>`;
}

function rowHtml(item, index) {
  const meta = metaFor(item);
  return `
    <tr data-index="${index}" data-type-id="${item.typeId}">
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
      ${metricCell(item, "profitPerM3", compact(item.profitPerM3), profitClass(item.profitPerM3))}
      ${metricCell(item, "profit", compact(item.profit), profitClass(item.profit))}
      ${metricCell(item, "margin", compactPercent(item.margin), profitClass(item.margin))}
      ${metricCell(item, "profitToBuy", compact(item.profitToBuy), profitClass(item.profitToBuy))}
      ${metricCell(item, "buildCost", compact(item.buildCost))}
      ${metricCell(item, "sellPrice", compact(item.sellPrice))}
      ${metricCell(item, "buyPrice", compact(item.buyPrice))}
      ${metricCell(item, "buyMargin", compactPercent(item.buyMargin), profitClass(item.buyMargin))}
      ${metricCell(item, "dailyVolume", compact(item.dailyVolume))}
      ${metricCell(item, "sellOrders", item.sellOrders)}
      ${metricCell(item, "sellVolume", compact(item.sellVolume))}
      <td data-field="volume" class="metric-cell change-cell-same" title="${fullValue("volume", meta.volume)}">${compact(meta.volume)}</td>
    </tr>
  `;
}

function updateMetricCell(row, item, field, value, className = "") {
  const cell = row.querySelector(`[data-field="${field}"]`);
  if (!cell) return;
  const direction = item._changes?.[field] || "same";
  cell.className = [className, "metric-cell", `change-cell-${direction}`, direction !== "same" ? "cell-updated" : ""]
    .filter(Boolean)
    .join(" ");
  cell.title = fullValue(field, item[field]);
  cell.textContent = value;
}

function updateRow(row, item, index) {
  row.dataset.index = String(index);
  const nameIndicator = row.querySelector(".item-name .change");
  if (nameIndicator) nameIndicator.outerHTML = changeIndicator(item);
  updateMetricCell(row, item, "profitPerM3", compact(item.profitPerM3), profitClass(item.profitPerM3));
  updateMetricCell(row, item, "profit", compact(item.profit), profitClass(item.profit));
  updateMetricCell(row, item, "margin", compactPercent(item.margin), profitClass(item.margin));
  updateMetricCell(row, item, "profitToBuy", compact(item.profitToBuy), profitClass(item.profitToBuy));
  updateMetricCell(row, item, "buildCost", compact(item.buildCost));
  updateMetricCell(row, item, "sellPrice", compact(item.sellPrice));
  updateMetricCell(row, item, "buyPrice", compact(item.buyPrice));
  updateMetricCell(row, item, "buyMargin", compactPercent(item.buyMargin), profitClass(item.buyMargin));
  updateMetricCell(row, item, "dailyVolume", compact(item.dailyVolume));
  updateMetricCell(row, item, "sellOrders", item.sellOrders);
  updateMetricCell(row, item, "sellVolume", compact(item.sellVolume));
}

function renderRows(items) {
  const existingRows = new Map(
    Array.from(rows.querySelectorAll("tr[data-type-id]")).map((row) => [row.dataset.typeId, row]),
  );
  const template = document.createElement("template");
  const fragment = document.createDocumentFragment();
  items.forEach((item, index) => {
    let row = existingRows.get(String(item.typeId));
    if (row) {
      updateRow(row, item, index);
    } else {
      template.innerHTML = rowHtml(item, index).trim();
      row = template.content.firstElementChild;
    }
    fragment.appendChild(row);
  });
  rows.replaceChildren(fragment);
  rows._visibleItems = items;
}

function scheduleNextExpiryRefresh(typeIds) {
  window.clearTimeout(expiryTimer);
  const expiries = typeIds
    .map((typeId) => entryRefreshAt(itemCache.get(itemCacheKey(typeId))))
    .filter((time) => Number.isFinite(time));
  if (!expiries.length) return;
  const nextExpiry = Math.min(...expiries);
  const delay = Math.max(AUTO_REFRESH_MIN_DELAY_MS, nextExpiry - Date.now() + 250);
  expiryTimer = window.setTimeout(() => scheduleRefresh(0, { automatic: true }), delay);
}

function dataFromCachedItems(typeIds, extra = {}) {
  const items = [];
  for (const typeId of typeIds) {
    const entry = cachedEntry(typeId);
    if (entry?.item) items.push(entry.item);
  }
  return {
    generatedAt: new Date().toISOString(),
    sourceMarket: sourceHub.selectedOptions[0]?.textContent || sourceHub.value,
    sellMarket: sellHub.selectedOptions[0]?.textContent || sellHub.value,
    sourceHub: sourceHub.value,
    sellHub: sellHub.value,
    scanned: typeIds.length,
    returned: items.length,
    items,
    cache: null,
    notes: [],
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
      s: sourceHub.value,
      b: sellHub.value,
      g: buildSystemId.value || "30000142",
      st: structureType.value,
      pr: productRig.value,
      cr: componentRig.value,
      d: decryptor.value,
      y: typeIds,
    }),
  });
}

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
  const state = filterState();
  const filtered = filteredItems(data.items, state);
  const items = sortedItems(filtered);
  const pricedCount = filtered.filter((item) => item.sellPrice !== null && item.buildCost !== null).length;
  const profitableCount = filtered.filter((item) => item.profit !== null && item.profit > 0).length;
  const signature = visibleSignature(items);
  if (data.automatic && signature === lastRenderSignature) return;
  lastRenderSignature = signature;
  setSummary([
    ["Shown", isk(items.length)],
    ["Priced", isk(pricedCount)],
    ["Profitable", isk(profitableCount)],
    ["Updated", timeShort(data.generatedAt)],
    ...cacheSummaryCards(),
  ]);
  if (!items.length) {
    rows.innerHTML = `<tr><td colspan="14" class="empty">No matches with the current filters.</td></tr>`;
    return;
  }
  renderRows(items);
  for (const item of items) {
    if (!item._changes || !Object.values(item._changes).some((direction) => direction !== "same")) continue;
    const key = itemCacheKey(item.typeId);
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

async function loadStaticData() {
  if (staticData) return staticData;
  const stored = localStorage.getItem("tradefind.staticData");
  const cached = stored ? JSON.parse(stored) : null;
  const query = cached?.hash ? `?hash=${encodeURIComponent(cached.hash)}` : "";
  const response = await apiFetch(`/api/static-data${query}`);
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error || "Static data failed");
  staticData = data.unchanged && cached ? cached.payload : data;
  if (!data.unchanged) {
    localStorage.setItem("tradefind.staticData", JSON.stringify({
      hash: data.hash,
      payload: data,
    }));
  }
  staticTypes = new Map(Object.entries(staticData.types));
  if (staticData.tradeHubs) {
    const hubOptions = staticData.tradeHubs.map((hub) => (
      `<option value="${hub.id}"${hub.id === "jita" ? " selected" : ""}>${hub.name}</option>`
    )).join("");
    sourceHub.innerHTML = hubOptions;
    sellHub.innerHTML = hubOptions;
  }
  if (staticData.structureProfiles) {
    structureType.innerHTML = staticData.structureProfiles.map((profile) => (
      `<option value="${profile.id}"${profile.id === "npc" ? " selected" : ""}>${profile.name}</option>`
    )).join("");
  }
  if (staticData.rigProfiles) {
    const rigOptions = staticData.rigProfiles.map((rig) => (
      `<option value="${rig.id}">${rig.name}</option>`
    )).join("");
    productRig.innerHTML = rigOptions;
    componentRig.innerHTML = rigOptions;
  }
  if (staticData.decryptors) {
    decryptor.innerHTML = staticData.decryptors.map((item) => (
      `<option value="${item.id}"${item.id === "none" ? " selected" : ""}>${item.name}</option>`
    )).join("");
  }
  if (staticData.solarSystems) {
    staticSystems = new Map(staticData.solarSystems.map((system) => [system.name.toLowerCase(), system]));
    document.querySelector("#solarSystems").innerHTML = staticData.solarSystems
      .map((system) => `<option value="${system.name}"></option>`)
      .join("");
  }
  syncRigControls();
  return staticData;
}

async function refreshAnalysis(options = {}) {
  if (options.automatic && activeRequest) return;
  const seq = ++refreshSeq;
  if (!options.automatic && activeRequest) {
    activeRequest.abort();
    activeRequest = null;
  }
  if (!options.automatic) setSummaryMessage("Checking local cache");
  if (!currentData) rows.innerHTML = `<tr><td colspan="14" class="empty">Loading market analysis.</td></tr>`;
  if (!options.automatic) details.textContent = "";
  try {
    await loadStaticData();
    if (seq !== refreshSeq) return;
    const typeIds = staticScopedTypeIds();
    const scopeKey = scopeKeyFor(typeIds);
    if (!typeIds.length) {
      queueRender({
        generatedAt: new Date().toISOString(),
        sourceMarket: sourceHub.selectedOptions[0]?.textContent || sourceHub.value,
        sellMarket: sellHub.selectedOptions[0]?.textContent || sellHub.value,
        scanned: 0,
        returned: 0,
        items: [],
        cache: null,
        notes: [],
        scopedTypeIds: typeIds,
      });
      return;
    }
    const refreshWindowMs = options.automatic ? AUTO_REFRESH_WINDOW_MS : 0;
    const dueTypeIds = typeIds
      .filter((typeId) => cacheEntryNeedsRefresh(typeId, refreshWindowMs))
      .sort((left, right) => {
        const leftAt = entryRefreshAt(itemCache.get(itemCacheKey(left))) || 0;
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
      if (!options.automatic) setSummaryMessage(`Refreshing ${isk(missingTypeIds.length)} stale or missing prices`);
      if (activeRequest) {
        if (options.automatic) return;
        activeRequest.abort();
      }
      const controller = new AbortController();
      activeRequest = controller;
      const response = await fetchItems(missingTypeIds, controller.signal);
      if (activeRequest === controller) activeRequest = null;
      const rawData = await response.json();
      if (!response.ok || rawData.error) throw new Error(rawData.error || "Request failed");
      const data = normalizeApiData(rawData);
      if (seq !== refreshSeq || scopeKey !== scopeKeyFor(staticScopedTypeIds())) return;
      const returned = new Set();
      for (const item of data.items) {
        returned.add(item.typeId);
        const previous = itemCache.get(itemCacheKey(item.typeId))?.item;
        const decorated = decorateUpdatedItem(previous, item);
        const validUntil = usableValidUntil(item.validUntil || data.validUntil);
        itemCache.set(itemCacheKey(item.typeId), {
          item: decorated,
          validUntil,
          refreshAfter: refreshAfterFor(item.typeId, validUntil),
        });
      }
      for (const typeId of data.unpricedTypeIds || missingTypeIds) {
        if (!returned.has(typeId)) {
          const validUntil = negativeValidUntil();
          itemCache.set(itemCacheKey(typeId), {
            item: null,
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
    setSummaryMessage(error.message);
    rows.innerHTML = `<tr><td colspan="14" class="empty">Analysis failed.</td></tr>`;
  }
}

function selectedStructureProfile() {
  return staticData?.structureProfiles?.find((profile) => profile.id === structureType.value) || null;
}

function syncRigControls() {
  const allowsRigs = selectedStructureProfile()?.allowsRigs !== false;
  productRig.disabled = !allowsRigs;
  componentRig.disabled = !allowsRigs;
  if (!allowsRigs) {
    productRig.value = "none";
    componentRig.value = "none";
  }
}

function scheduleRefresh(delay = 250, options = {}) {
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => refreshAnalysis(options), delay);
}

sourceHub.addEventListener("change", () => scheduleRefresh(0));
sellHub.addEventListener("change", () => scheduleRefresh(0));
structureType.addEventListener("change", () => {
  syncRigControls();
  scheduleRefresh(0);
});
productRig.addEventListener("change", () => scheduleRefresh(0));
componentRig.addEventListener("change", () => scheduleRefresh(0));
decryptor.addEventListener("change", () => scheduleRefresh(0));
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

function renderCacheStatus(data) {
  cacheStatusData = data;
  if (currentData) queueRender(currentData);
}

async function refreshCacheStatus() {
  try {
    const response = await apiFetch("/api/cache-warm/status");
    const data = await response.json();
    if (!response.ok || data.error) throw new Error(data.error || "Cache status failed");
    renderCacheStatus(data);
  } catch (error) {
    cacheStatusData = null;
    if (currentData) queueRender(currentData);
  }
}

refreshCacheStatus();
cachePoll = window.setInterval(refreshCacheStatus, 10000);
itemPoll = window.setInterval(() => scheduleRefresh(0, { automatic: true }), AUTO_POLL_INTERVAL_MS);
loadStaticData().then(() => scheduleRefresh(0)).catch((error) => {
  setSummaryMessage(error.message);
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

updateSortHeaders();

for (const id of fields) {
  const field = document.querySelector(`#${id}`);
  field.addEventListener("input", () => {
    if (id === "search") scheduleRefresh();
    else if (currentData) queueRender(currentData);
  });
  field.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (id === "search") scheduleRefresh(0);
      else if (currentData) queueRender(currentData);
      else scheduleRefresh(0);
    }
  });
}

for (const field of typeFilters) {
  field.addEventListener("change", () => scheduleRefresh(0));
}
