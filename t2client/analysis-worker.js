let staticGraph = null;
let candidateMap = new Map();
let manufacturing = new Map();
let manufacturingMaterials = new Map();
let inventionMaterials = new Map();
let boughtCompleted = new Set();
let basePrices = new Map();
let decryptors = new Map();
let structures = new Map();
let rigs = new Map();

function toMap(object) {
  return new Map(Object.entries(object || {}).map(([key, value]) => [Number(key), value]));
}

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

function parseTime(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isoFromMs(value) {
  return new Date(value).toISOString();
}

function futureOrRetry(expiresAt, retryMs) {
  const now = Date.now();
  if (Number.isFinite(expiresAt) && expiresAt > now) return isoFromMs(expiresAt);
  return isoFromMs(now + retryMs);
}

function normalizeOrderRows(rows) {
  return new Map((rows || []).map((row) => [row.typeId, row]));
}

function normalizeHistoryRows(rows) {
  return new Map((rows || []).map((row) => [row.typeId, row]));
}

function normalizeAdjustedRows(rows) {
  return new Map((rows || []).map((row) => [row.typeId, row]));
}

function materialQuantity(quantity, mePercent, options, finalT2) {
  const profile = structures.get(options.structureType) || structures.get("npc");
  const allowsRigs = profile?.allowsRigs !== false;
  const rigId = allowsRigs ? (finalT2 ? options.productRig : options.componentRig) : "none";
  const rig = rigs.get(rigId) || rigs.get("none");
  const rigMultiplier = 1 - (rig?.materialBonus || 0);
  const multiplier = Math.max(
    0,
    (1 - (mePercent / 100)) * (profile?.materialMultiplier || 1) * rigMultiplier,
  );
  if (quantity <= 1) return 1;
  return Math.max(1, Math.ceil(quantity * multiplier - 0.000001));
}

function jobContext(options, system) {
  const profile = structures.get(options.structureType) || structures.get("npc");
  const multiplier = (profile?.costMultiplier || 1) * (1 + (profile?.facilityTax || 0));
  return {
    manufacturing: (system?.manufacturing || 0) * multiplier,
    invention: (system?.invention || 0) * multiplier,
  };
}

function jobCost(eiv, activity, context) {
  return eiv * (context?.[activity] || 0);
}

function adjustedPrice(typeId, adjusted) {
  const row = adjusted.get(typeId);
  if (row && row.adjustedPrice !== null && row.adjustedPrice !== undefined) return row.adjustedPrice;
  return basePrices.get(typeId) || 0;
}

function inventionProbability(baseProbability, decryptor) {
  return clamp((baseProbability || 0) * 1.05 * 1.20 * (decryptor?.probability || 1), 0, 1);
}

function manufacturingCostForProduct(productTypeId, sourcePrices, adjusted, options, context, finalT2, stack, cache) {
  const cacheKey = `${productTypeId}:${finalT2 ? 1 : 0}`;
  if (cache.has(cacheKey)) {
    const cached = cache.get(cacheKey);
    return { ...cached, missing: new Set(cached.missing) };
  }
  if (stack.has(productTypeId)) return { cost: null, eiv: 0, missing: new Set() };

  const recipe = manufacturing.get(productTypeId);
  if (!recipe) {
    const price = sourcePrices.get(productTypeId)?.sell ?? null;
    const result = {
      cost: price,
      eiv: adjustedPrice(productTypeId, adjusted),
      missing: price === null ? new Set([productTypeId]) : new Set(),
    };
    cache.set(cacheKey, { ...result, missing: Array.from(result.missing) });
    return result;
  }

  stack.add(productTypeId);
  const blueprintTypeId = recipe[0];
  const outputQuantity = Math.max(recipe[1] || 1, 1);
  const constants = staticGraph.constants || {};
  const decryptor = decryptors.get(options.decryptor) || decryptors.get("none");
  let me = finalT2 ? (constants.baseT2InventedMe || 2) + (decryptor?.me || 0) : (constants.baseT1BpoMe || 10);
  me = clamp(me, 0, 20);

  let total = 0;
  let eiv = 0;
  const missing = new Set();
  for (const [materialTypeId, baseQuantity] of manufacturingMaterials.get(blueprintTypeId) || []) {
    const quantity = materialQuantity(baseQuantity, me, options, finalT2);
    const nested = manufacturing.get(materialTypeId);
    let unitCost = null;
    let unitEiv = 0;
    if (nested && !boughtCompleted.has(materialTypeId)) {
      const nestedCost = manufacturingCostForProduct(
        materialTypeId,
        sourcePrices,
        adjusted,
        options,
        context,
        false,
        stack,
        cache,
      );
      unitCost = nestedCost.cost;
      unitEiv = nestedCost.eiv;
      for (const typeId of nestedCost.missing) missing.add(typeId);
    } else {
      unitCost = sourcePrices.get(materialTypeId)?.sell ?? null;
      unitEiv = adjustedPrice(materialTypeId, adjusted);
      if (unitCost === null) missing.add(materialTypeId);
    }
    if (unitCost !== null) total += unitCost * quantity;
    eiv += unitEiv * quantity;
  }
  stack.delete(productTypeId);

  total += jobCost(eiv, "manufacturing", context);
  const result = {
    cost: total / outputQuantity,
    eiv: eiv / outputQuantity,
    missing,
  };
  cache.set(cacheKey, { ...result, missing: Array.from(missing) });
  return result;
}

function minExpiryForRows(rows, retryMs) {
  const now = Date.now();
  let hasMissingExpiry = false;
  const expiries = [];
  for (const row of rows) {
    const expiresAt = parseTime(row?.expiresAt);
    if (Number.isFinite(expiresAt) && expiresAt > now) expiries.push(expiresAt);
    else hasMissingExpiry = true;
  }
  const validUntil = expiries.length ? Math.min(...expiries) : now + retryMs;
  return isoFromMs(hasMissingExpiry ? Math.min(validUntil, now + retryMs) : validUntil);
}

function analyze(payload) {
  const typeIds = payload.typeIds || [];
  const options = payload.options || {};
  const market = payload.market || {};
  const sourcePrices = normalizeOrderRows(market.inputOrders);
  const sellPrices = normalizeOrderRows(market.productOrders);
  const histories = normalizeHistoryRows(market.histories);
  const adjusted = normalizeAdjustedRows(market.adjustedPrices);
  const system = market.system || {};
  const context = jobContext(options, system);
  const decryptor = decryptors.get(options.decryptor) || decryptors.get("none");
  const constants = staticGraph.constants || {};
  const retryMs = payload.retryMs || 300000;
  const manufacturingCache = new Map();
  const rows = [];

  for (const typeId of typeIds) {
    const candidates = candidateMap.get(Number(typeId)) || [];
    if (!candidates.length) continue;
    let bestRow = null;

    for (const candidate of candidates) {
      const [
        productTypeId,
        ,
        manufacturingQuantity,
        inventionBlueprintTypeId,
        baseInventionRuns,
        baseInventionProbability,
      ] = candidate;

      const manufacture = manufacturingCostForProduct(
        productTypeId,
        sourcePrices,
        adjusted,
        options,
        context,
        true,
        new Set(),
        manufacturingCache,
      );
      const missing = new Set(manufacture.missing);
      let inventionAttemptCost = 0;
      let inventionEiv = 0;
      const sourceExpiryRows = [];

      for (const [materialTypeId, quantity] of inventionMaterials.get(inventionBlueprintTypeId) || []) {
        const priceRow = sourcePrices.get(materialTypeId);
        sourceExpiryRows.push(priceRow);
        const price = priceRow?.sell ?? null;
        if (price === null) missing.add(materialTypeId);
        else inventionAttemptCost += price * quantity;
        inventionEiv += adjustedPrice(materialTypeId, adjusted) * quantity;
      }

      if (decryptor?.typeId) {
        const decryptorRow = sourcePrices.get(decryptor.typeId);
        sourceExpiryRows.push(decryptorRow);
        const decryptorPrice = decryptorRow?.sell ?? null;
        if (decryptorPrice === null) missing.add(decryptor.typeId);
        else inventionAttemptCost += decryptorPrice;
        inventionEiv += adjustedPrice(decryptor.typeId, adjusted);
      }

      const manufacturedQuantity = Math.max(manufacturingQuantity || 1, 1);
      const inventionRuns = Math.max((baseInventionRuns || 1) + (decryptor?.runs || 0), 1);
      const probability = inventionProbability(baseInventionProbability, decryptor);
      const inventionJobCost = jobCost(inventionEiv, "invention", context);
      inventionAttemptCost += inventionJobCost;
      const inventionCost = probability > 0
        ? inventionAttemptCost / probability / inventionRuns / manufacturedQuantity
        : null;
      const manufacturingCost = missing.size ? null : manufacture.cost;
      const totalCost = manufacturingCost === null ? null : manufacturingCost + (inventionCost || 0);
      const sale = sellPrices.get(productTypeId) || {};
      const history = histories.get(productTypeId) || {};
      const sellPrice = sale.sell ?? null;
      const buyPrice = sale.buy ?? null;
      const profit = sellPrice === null || totalCost === null ? null : sellPrice - totalCost;
      const profitToBuy = buyPrice === null || totalCost === null ? null : buyPrice - totalCost;
      const margin = profit === null || !totalCost ? null : (profit / totalCost) * 100;
      const buyMargin = profitToBuy === null || !totalCost ? null : (profitToBuy / totalCost) * 100;

      const manufacturingSourceRows = (staticGraph.typeMarketInputs?.[String(productTypeId)] || [])
        .map((sourceTypeId) => sourcePrices.get(sourceTypeId));
      const adjustedRows = Array.from(adjusted.values());
      const validUntil = minExpiryForRows([
        sale,
        history,
        system,
        ...manufacturingSourceRows,
        ...sourceExpiryRows,
        ...adjustedRows,
      ], retryMs);

      const row = {
        typeId: productTypeId,
        buildCost: missing.size ? null : totalCost,
        manufacturingCost,
        inventionCost: missing.size ? null : inventionCost,
        manufacturingJobCost: missing.size ? null : jobCost(manufacture.eiv * manufacturedQuantity, "manufacturing", context),
        inventionJobCost: missing.size ? null : inventionJobCost,
        sellPrice,
        buyPrice,
        profit,
        profitToBuy,
        margin,
        buyMargin,
        profitPerM3: null,
        dailyVolume: history.dailyVolume || 0,
        sellOrders: sale.sellOrders || 0,
        sellVolume: sale.sellVolume || 0,
        inventionProbability: probability,
        inventionRuns,
        inventedMaterialEfficiency: clamp((constants.baseT2InventedMe || 2) + (decryptor?.me || 0), 0, 20),
        inventedTimeEfficiency: (constants.baseT2InventedTe || 4) + (decryptor?.te || 0),
        manufacturingQuantity: manufacturedQuantity,
        validUntil,
      };
      if (
        !bestRow
        || ((row.profit ?? Number.NEGATIVE_INFINITY) > (bestRow.profit ?? Number.NEGATIVE_INFINITY))
        || (row.profit === bestRow.profit && (row.buildCost ?? Number.POSITIVE_INFINITY) < (bestRow.buildCost ?? Number.POSITIVE_INFINITY))
      ) {
        bestRow = row;
      }
    }
    if (bestRow) rows.push(bestRow);
  }

  return rows;
}

self.onmessage = (event) => {
  const { id, type, payload } = event.data || {};
  try {
    if (type === "init") {
      staticGraph = payload.analysis;
      candidateMap = new Map();
      for (const row of staticGraph.candidates || []) {
        if (!candidateMap.has(row[0])) candidateMap.set(row[0], []);
        candidateMap.get(row[0]).push(row);
      }
      manufacturing = toMap(staticGraph.manufacturing);
      manufacturingMaterials = toMap(staticGraph.manufacturingMaterials);
      inventionMaterials = toMap(staticGraph.inventionMaterials);
      boughtCompleted = new Set(staticGraph.boughtCompletedTypeIds || []);
      basePrices = toMap(staticGraph.typeBasePrices);
      decryptors = new Map((payload.decryptors || []).map((item) => [item.id, item]));
      structures = new Map((payload.structureProfiles || []).map((item) => [item.id, item]));
      rigs = new Map((payload.rigProfiles || []).map((item) => [item.id, item]));
      self.postMessage({ id, ok: true });
      return;
    }
    if (type === "analyze") {
      self.postMessage({ id, ok: true, rows: analyze(payload) });
      return;
    }
    throw new Error(`Unknown worker message: ${type}`);
  } catch (error) {
    self.postMessage({ id, ok: false, error: error.message || String(error) });
  }
};
