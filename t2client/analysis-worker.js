let staticGraph = null;
let candidateMap = new Map();
let manufacturing = new Map();
let manufacturingMaterials = new Map();
let inventionMaterials = new Map();
let boughtCompleted = new Set();
let basePrices = new Map();
let typeGroups = new Map();
let typeCategories = new Map();
let typeMarketGroups = new Map();
let typeMetaGroups = new Map();
let shipSizeByGroup = new Map();
let rigApplicabilityCache = new Map();
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
  const result = new Map();
  for (const row of rows || []) result.set(row.typeId, row);
  return result;
}

function normalizeHistoryRows(rows) {
  const result = new Map();
  for (const row of rows || []) result.set(row.typeId, row);
  return result;
}

function normalizeAdjustedRows(rows) {
  const result = new Map();
  for (const row of rows || []) result.set(row.typeId, row);
  return result;
}

function makeShipSizeMap() {
  const result = new Map();
  for (const [size, groups] of Object.entries(SHIP_SIZE_GROUPS)) {
    for (const group of groups) result.set(group, size);
  }
  return result;
}

const SHIP_SIZE_GROUPS = {
  small: new Set([
    "Assault Frigate", "Covert Ops", "Electronic Attack Ship", "Expedition Frigate",
    "Frigate", "Interceptor", "Logistics Frigate", "Stealth Bomber", "Tactical Destroyer",
    "Destroyer", "Interdictor",
  ]),
  medium: new Set([
    "Cruiser", "Heavy Assault Cruiser", "Heavy Interdiction Cruiser", "Recon Ship",
    "Logistics", "Strategic Cruiser", "Combat Battlecruiser", "Attack Battlecruiser",
    "Battlecruiser", "Command Ship", "Industrial", "Mining Barge", "Exhumer",
    "Blockade Runner", "Deep Space Transport",
  ]),
  large: new Set([
    "Battleship", "Black Ops", "Marauder", "Capital Industrial Ship", "Carrier",
    "Dreadnought", "Force Auxiliary", "Freighter", "Jump Freighter", "Supercarrier",
    "Titan", "Industrial Command Ship",
  ]),
};

function typeScope(typeId) {
  return {
    group: typeGroups.get(typeId) || "",
    category: typeCategories.get(typeId) || "",
    marketGroups: typeMarketGroups.get(typeId) || [],
    metaGroup: typeMetaGroups.get(typeId) || null,
  };
}

function shipSizeForGroup(group) {
  return shipSizeByGroup.get(group) || null;
}

function rigAppliesToType(rig, productTypeId) {
  if (!rig || rig.id === "none" || !rig.materialBonus) return false;
  const cacheKey = `${rig.id}:${productTypeId}`;
  if (rigApplicabilityCache.has(cacheKey)) return rigApplicabilityCache.get(cacheKey);
  const scope = rig.scope || {};
  const type = typeScope(productTypeId);
  let applies = false;
  if (scope.kind === "ships") {
    applies = type.category === "Ship";
  } else if (scope.kind === "advancedShips") {
    applies = type.category === "Ship"
      && type.metaGroup === 2
      && shipSizeForGroup(type.group) === scope.size;
  } else if (scope.kind === "advancedComponents") {
    applies = type.category === "Commodity" && type.group === "Construction Components";
  }
  rigApplicabilityCache.set(cacheKey, applies);
  return applies;
}

function materialQuantity(quantity, mePercent, options, finalT2, productTypeId) {
  const profile = structures.get(options.structureType) || structures.get("npc");
  const allowsRigs = profile?.allowsRigs !== false;
  const rigId = allowsRigs ? (finalT2 ? options.productRig : options.componentRig) : "none";
  const rig = rigs.get(rigId) || rigs.get("none");
  const rigMultiplier = rigAppliesToType(rig, productTypeId) ? 1 - (rig?.materialBonus || 0) : 1;
  const multiplier = Math.max(
    0,
    (1 - (mePercent / 100)) * (profile?.materialMultiplier || 1) * rigMultiplier,
  );
  if (quantity <= 1) return 1;
  return Math.max(1, Math.ceil(quantity * multiplier - 0.000001));
}

function jobContext(options, system) {
  const profile = structures.get(options.structureType) || structures.get("npc");
  const constants = staticGraph?.constants || {};
  const configuredFacilityTax = Number(options.facilityTaxPercent);
  const facilityTax = Number.isFinite(configuredFacilityTax)
    ? Math.max(0, configuredFacilityTax) / 100
    : (profile?.facilityTax || 0);
  return {
    manufacturing: system?.manufacturing || 0,
    invention: system?.invention || 0,
    costMultiplier: profile?.costMultiplier || 1,
    facilityTax,
    sccSurcharge: constants.sccSurcharge ?? 0.04,
  };
}

function jobCost(eiv, activity, context) {
  return jobCostBreakdown(eiv, activity, context).total;
}

function jobCostBreakdown(eiv, activity, context) {
  const indexFee = eiv * (context?.[activity] || 0);
  const structureFee = indexFee * (context?.costMultiplier || 1);
  const facilityTax = eiv * (context?.facilityTax || 0);
  const sccSurcharge = eiv * (context?.sccSurcharge ?? 0.04);
  return {
    eiv,
    indexFee,
    structureBonus: structureFee - indexFee,
    facilityTax,
    sccSurcharge,
    total: structureFee + facilityTax + sccSurcharge,
  };
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
    const quantity = materialQuantity(baseQuantity, me, options, finalT2, productTypeId);
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

function addQuantity(map, typeId, quantity) {
  if (!quantity || quantity <= 0) return;
  map.set(typeId, (map.get(typeId) || 0) + quantity);
}

function quantityForMaterial(baseQuantity, me, options, finalT2, runs, productTypeId) {
  return materialQuantity(baseQuantity * runs, me, options, finalT2, productTypeId);
}

function recipePlan(typeId, quantity, options, finalT2) {
  const recipe = manufacturing.get(typeId);
  if (!recipe || boughtCompleted.has(typeId)) return null;
  const decryptor = decryptors.get(options.decryptor) || decryptors.get("none");
  const constants = staticGraph.constants || {};
  const outputQuantity = Math.max(recipe[1] || 1, 1);
  const runs = Math.ceil(quantity / outputQuantity);
  let me = finalT2 ? (constants.baseT2InventedMe || 2) + (decryptor?.me || 0) : (constants.baseT1BpoMe || 10);
  me = clamp(me, 0, 20);
  return {
    blueprintTypeId: recipe[0],
    outputQuantity,
    runs,
    produced: runs * outputQuantity,
    materials: (manufacturingMaterials.get(recipe[0]) || []).map(([materialTypeId, baseQuantity]) => [
      materialTypeId,
      quantityForMaterial(baseQuantity, me, options, finalT2, runs, typeId),
    ]),
  };
}

function collectBuildRequirements(typeId, quantity, options, finalT2, raw, craft, root = false) {
  const plan = recipePlan(typeId, quantity, options, finalT2);
  if (!plan) {
    addQuantity(raw, typeId, quantity);
    return;
  }
  if (!root) addQuantity(craft, typeId, quantity);
  for (const [materialTypeId, materialQuantityNeeded] of plan.materials) {
    const nested = manufacturing.get(materialTypeId);
    if (nested && !boughtCompleted.has(materialTypeId)) {
      collectBuildRequirements(materialTypeId, materialQuantityNeeded, options, false, raw, craft);
    } else {
      addQuantity(raw, materialTypeId, materialQuantityNeeded);
    }
  }
}

function emptyJobBreakdown() {
  return {
    eiv: 0,
    indexFee: 0,
    structureBonus: 0,
    facilityTax: 0,
    sccSurcharge: 0,
    total: 0,
  };
}

function addJobBreakdown(target, source) {
  target.eiv += source.eiv || 0;
  target.indexFee += source.indexFee || 0;
  target.structureBonus += source.structureBonus || 0;
  target.facilityTax += source.facilityTax || 0;
  target.sccSurcharge += source.sccSurcharge || 0;
  target.total += source.total || 0;
}

function manufacturingFeesForProduct(typeId, quantity, options, finalT2, adjusted, context, root = false) {
  const plan = recipePlan(typeId, quantity, options, finalT2);
  if (!plan) {
    return {
      finalProduct: 0,
      components: 0,
      finalProductBreakdown: emptyJobBreakdown(),
      componentBreakdown: emptyJobBreakdown(),
    };
  }

  const eiv = plan.materials.reduce(
    (total, [materialTypeId, materialQuantityNeeded]) => (
      total + adjustedPrice(materialTypeId, adjusted) * materialQuantityNeeded
    ),
    0,
  );
  const breakdown = jobCostBreakdown(eiv, "manufacturing", context);
  const totals = {
    finalProduct: root ? breakdown.total : 0,
    components: root ? 0 : breakdown.total,
    finalProductBreakdown: emptyJobBreakdown(),
    componentBreakdown: emptyJobBreakdown(),
  };
  addJobBreakdown(root ? totals.finalProductBreakdown : totals.componentBreakdown, breakdown);

  for (const [materialTypeId, materialQuantityNeeded] of plan.materials) {
    const nested = manufacturing.get(materialTypeId);
    if (nested && !boughtCompleted.has(materialTypeId)) {
      const nestedFees = manufacturingFeesForProduct(
        materialTypeId,
        materialQuantityNeeded,
        options,
        false,
        adjusted,
        context,
      );
      totals.finalProduct += nestedFees.finalProduct;
      totals.components += nestedFees.components;
      addJobBreakdown(totals.finalProductBreakdown, nestedFees.finalProductBreakdown);
      addJobBreakdown(totals.componentBreakdown, nestedFees.componentBreakdown);
    }
  }
  return totals;
}

function fulfillBuildNeed(typeId, quantity, options, finalT2, inventory, shopping) {
  let remaining = quantity;
  const owned = inventory.get(typeId) || 0;
  if (owned > 0) {
    const used = Math.min(owned, remaining);
    remaining -= used;
    inventory.set(typeId, owned - used);
  }
  if (remaining <= 0) return;

  const plan = recipePlan(typeId, remaining, options, finalT2);
  if (!plan) {
    addQuantity(shopping, typeId, remaining);
    return;
  }
  if (plan.produced > remaining) {
    inventory.set(typeId, (inventory.get(typeId) || 0) + (plan.produced - remaining));
  }
  for (const [materialTypeId, materialQuantityNeeded] of plan.materials) {
    fulfillBuildNeed(materialTypeId, materialQuantityNeeded, options, false, inventory, shopping);
  }
}

function mapRows(map, sourcePrices) {
  return Array.from(map.entries())
    .map(([typeId, quantity]) => ({
      typeId,
      quantity,
      unitPrice: sourcePrices.get(typeId)?.sell ?? null,
      totalPrice: sourcePrices.get(typeId)?.sell == null ? null : sourcePrices.get(typeId).sell * quantity,
    }))
    .sort((left, right) => left.typeId - right.typeId);
}

function detail(payload) {
  const typeId = Number(payload.typeId);
  const units = Math.max(1, Math.ceil(Number(payload.units) || 1));
  const options = payload.options || {};
  const market = payload.market || {};
  const sourcePrices = normalizeOrderRows(market.inputOrders);
  const adjusted = normalizeAdjustedRows(market.adjustedPrices);
  const system = market.system || {};
  const context = jobContext(options, system);
  const decryptor = decryptors.get(options.decryptor) || decryptors.get("none");
  const constants = staticGraph.constants || {};
  const candidates = candidateMap.get(typeId) || [];
  const candidate = candidates[0];
  if (!candidate) throw new Error("No build data for item");

  const [
    productTypeId,
    ,
    manufacturingQuantity,
    inventionBlueprintTypeId,
    baseInventionRuns,
    baseInventionProbability,
  ] = candidate;

  const manufacturedQuantity = Math.max(manufacturingQuantity || 1, 1);
  const manufacturingRuns = Math.ceil(units / manufacturedQuantity);
  const outputUnits = manufacturingRuns * manufacturedQuantity;
  const inventionRuns = Math.max((baseInventionRuns || 1) + (decryptor?.runs || 0), 1);
  const requiredBpcs = Math.ceil(manufacturingRuns / inventionRuns);
  const probability = inventionProbability(baseInventionProbability, decryptor);
  const expectedAttempts = probability > 0 ? requiredBpcs / probability : requiredBpcs;
  const plannedAttempts = Math.max(1, Math.ceil(expectedAttempts));
  const inventedMaterialEfficiency = clamp((constants.baseT2InventedMe || 2) + (decryptor?.me || 0), 0, 20);
  const inventedTimeEfficiency = (constants.baseT2InventedTe || 4) + (decryptor?.te || 0);

  const finalPlan = recipePlan(productTypeId, units, options, true);
  const directMaterials = new Map(finalPlan?.materials || []);
  const rawRequirements = new Map();
  const componentBuilds = new Map();
  collectBuildRequirements(productTypeId, units, options, true, rawRequirements, componentBuilds, true);

  const inventionMaterialsNeeded = new Map();
  let inventionEiv = 0;
  for (const [materialTypeId, quantity] of inventionMaterials.get(inventionBlueprintTypeId) || []) {
    const needed = quantity * plannedAttempts;
    addQuantity(inventionMaterialsNeeded, materialTypeId, needed);
    inventionEiv += adjustedPrice(materialTypeId, adjusted) * quantity * plannedAttempts;
  }
  if (decryptor?.typeId) {
    addQuantity(inventionMaterialsNeeded, decryptor.typeId, plannedAttempts);
    inventionEiv += adjustedPrice(decryptor.typeId, adjusted) * plannedAttempts;
  }

  const inventory = new Map((payload.inventory || []).map(([ownedTypeId, quantity]) => [Number(ownedTypeId), Number(quantity) || 0]));
  const shopping = new Map();
  fulfillBuildNeed(productTypeId, units, options, true, inventory, shopping);
  for (const [materialTypeId, quantity] of inventionMaterialsNeeded) {
    fulfillBuildNeed(materialTypeId, quantity, options, false, inventory, shopping);
  }

  const manufacture = manufacturingCostForProduct(
    productTypeId,
    sourcePrices,
    adjusted,
    options,
    context,
    true,
    new Set(),
    new Map(),
  );
  const manufacturingFees = manufacturingFeesForProduct(
    productTypeId,
    units,
    options,
    true,
    adjusted,
    context,
    true,
  );
  const manufacturingJobCostTotal = manufacturingFees.finalProduct + manufacturingFees.components;

  return {
    typeId: productTypeId,
    units,
    outputUnits,
    manufacturingRuns,
    manufacturingQuantity: manufacturedQuantity,
    inventionRuns,
    requiredBpcs,
    expectedAttempts,
    plannedAttempts,
    inventionProbability: probability,
    inventedMaterialEfficiency,
    inventedTimeEfficiency,
    manufacturingJobCostTotal,
    finalProductManufacturingJobCostTotal: manufacturingFees.finalProduct,
    componentManufacturingJobCostTotal: manufacturingFees.components,
    finalProductManufacturingGrossCostTotal: manufacturingFees.finalProductBreakdown.indexFee + manufacturingFees.finalProductBreakdown.structureBonus,
    finalProductManufacturingSccSurchargeTotal: manufacturingFees.finalProductBreakdown.sccSurcharge,
    finalProductManufacturingFacilityTaxTotal: manufacturingFees.finalProductBreakdown.facilityTax,
    componentManufacturingGrossCostTotal: manufacturingFees.componentBreakdown.indexFee + manufacturingFees.componentBreakdown.structureBonus,
    componentManufacturingSccSurchargeTotal: manufacturingFees.componentBreakdown.sccSurcharge,
    componentManufacturingFacilityTaxTotal: manufacturingFees.componentBreakdown.facilityTax,
    inventionJobCostTotal: jobCost(inventionEiv, "invention", context),
    directMaterials: mapRows(directMaterials, sourcePrices),
    componentBuilds: mapRows(componentBuilds, sourcePrices),
    rawRequirements: mapRows(rawRequirements, sourcePrices),
    inventionMaterials: mapRows(inventionMaterialsNeeded, sourcePrices),
    shoppingList: mapRows(shopping, sourcePrices),
  };
}

function minExpiryForRows(rows, retryMs) {
  const now = Date.now();
  let hasMissingExpiry = false;
  let validUntil = Number.POSITIVE_INFINITY;
  for (const row of rows) {
    const expiresAt = parseTime(row?.expiresAt);
    if (Number.isFinite(expiresAt) && expiresAt > now) validUntil = Math.min(validUntil, expiresAt);
    else hasMissingExpiry = true;
  }
  if (validUntil === Number.POSITIVE_INFINITY) validUntil = now + retryMs;
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
  const adjustedRows = Array.from(adjusted.values());
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

      const manufacturingSourceRows = [];
      for (const sourceTypeId of staticGraph.typeMarketInputs?.[String(productTypeId)] || []) {
        manufacturingSourceRows.push(sourcePrices.get(sourceTypeId));
      }
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
      typeGroups = toMap(staticGraph.typeGroups);
      typeCategories = toMap(staticGraph.typeCategories);
      typeMarketGroups = toMap(staticGraph.typeMarketGroups);
      typeMetaGroups = toMap(staticGraph.typeMetaGroups);
      shipSizeByGroup = makeShipSizeMap();
      rigApplicabilityCache = new Map();
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
    if (type === "detail") {
      self.postMessage({ id, ok: true, detail: detail(payload) });
      return;
    }
    throw new Error(`Unknown worker message: ${type}`);
  } catch (error) {
    self.postMessage({ id, ok: false, error: error.message || String(error) });
  }
};
