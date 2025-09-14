import crypto from "crypto";

// ------------------------------
// Constants & Helpers
// ------------------------------
const baseUrl = "https://zkillboard.com/api/stats/";
const isInteger = (value) => /^\d+$/.test(value);
const formatUserAgent = (ua) => `${ua || "UnknownClient"} +vercel-proxy`;

// Simple in-memory cache (per Lambda instance)
const cache = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes in ms

function getCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiry) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key, data) {
  cache.set(key, { data, expiry: Date.now() + CACHE_TTL });
  // Optional LRU eviction: cap cache size
  if (cache.size > 500) {
    const firstKey = cache.keys().next().value;
    cache.delete(firstKey);
  }
}

// ------------------------------
// Handler
// ------------------------------
export default async function handler(request, response) {
  // Set CORS headers for all responses
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");

  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    return response.status(200).end();
  }

  const { query } = request;
  let targetUrl = null;
  let idType = null;
  let idValue = null;

  // ---- Extract target entity ----
  if (query.character) {
    idType = "character";
    idValue = query.character;
    if (!isInteger(idValue)) {
      return response
        .status(400)
        .json({ error: "Character ID must be an integer" });
    }
    targetUrl = `${baseUrl}characterID/${idValue}/`;
  } else if (query.corporation) {
    idType = "corporation";
    idValue = query.corporation;
    if (!isInteger(idValue)) {
      return response
        .status(400)
        .json({ error: "Corporation ID must be an integer" });
    }
    targetUrl = `${baseUrl}corporationID/${idValue}/`;
  } else if (query.alliance) {
    idType = "alliance";
    idValue = query.alliance;
    if (!isInteger(idValue)) {
      return response
        .status(400)
        .json({ error: "Alliance ID must be an integer" });
    }
    targetUrl = `${baseUrl}allianceID/${idValue}/`;
  } else {
    return response.status(400).json({
      error:
        "Invalid request. Use ?character=ID, ?corporation=ID, or ?alliance=ID",
    });
  }

  // ---- Proof of Work verification ----
  const { nonce, hash, ts } = query;
  if (!nonce || !hash || !ts) {
    return response
      .status(400)
      .json({ error: "Missing PoW parameters (nonce, hash, ts)" });
  }

  const now = (Date.now() / 1000) | 0; // integer seconds
  const tsNum = Number(ts);

  if (Number.isNaN(tsNum) || Math.abs(now - tsNum) > 300) {
    return response.status(403).json({ error: "Stale PoW timestamp" });
  }

  const input = idValue + "|" + nonce + "|" + ts;
  const computedHash = crypto.createHash("sha256").update(input).digest("hex");

  if (computedHash !== hash) {
    return response.status(403).json({ error: "Invalid PoW hash" });
  }

  // Difficulty check: first 12 bits must be zero ("000" prefix in hex)
  if (
    computedHash[0] !== "0" ||
    computedHash[1] !== "0" ||
    computedHash[2] !== "0"
  ) {
    return response.status(403).json({ error: "Insufficient PoW difficulty" });
  }

  // ---- Cache lookup ----
  const cacheKey = `${idType}:${idValue}`;
  const cached = getCache(cacheKey);
  if (cached) {
    response.setHeader("Cache-Control", "public, max-age=1800");
    return response.status(200).json(cached);
  }

  // ---- Fetch from zKillboard ----
  try {
    const zkillResponse = await fetch(targetUrl, {
      headers: {
        "User-Agent": formatUserAgent(request.headers["user-agent"]),
      },
    });

    if (!zkillResponse.ok) {
      return response
        .status(zkillResponse.status)
        .json({ error: "Upstream zKillboard error" });
    }

    const data = await zkillResponse.json();

    // Save to cache
    setCache(cacheKey, data);

    // Cache headers for client/CDN
    response.setHeader("Cache-Control", "public, max-age=1800");

    return response.status(200).json(data);
  } catch (error) {
    return response
      .status(502)
      .json({ error: `Failed to fetch from zKillboard: ${error.message}` });
  }
}
