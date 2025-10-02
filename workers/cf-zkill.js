/*
    EVE Target Intel - Cloudflare Worker for zKillboard
    
    Copyright (C) 2025 moregh (https://github.com/moregh/)
    Licensed under AGPL License.
*/

function getCorsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept'
  };
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          ...getCorsHeaders(),
          'Access-Control-Max-Age': '86400',
        }
      });
    }

    const { searchParams, origin } = new URL(request.url);

    let baseUrl = "https://zkillboard.com/api/stats/";
    let targetUrl = null;
    let cacheKey = null;
    let idType = null;
    let idValue = null;
    let isKillsEndpoint = false;

    const isInteger = (value) => /^\d+$/.test(value);

    if (searchParams.has("kills")) {
      isKillsEndpoint = true;
      baseUrl = "https://zkillboard.com/api/kills/";
      const killsType = searchParams.get("kills");
      idValue = searchParams.get("id");
      const pageParam = searchParams.get("page");

      if (!idValue || !isInteger(idValue)) {
        return jsonError("ID must be provided and be an integer", 400, false);
      }

      if (pageParam && !isInteger(pageParam)) {
        return jsonError("Page parameter must be an integer", 400, false);
      }

      const page = pageParam ? parseInt(pageParam, 10) : 1;

      if (page < 1 || page > 100) {
        return jsonError("Page parameter must be between 1 and 100", 400, false);
      }

      if (killsType === "character") {
        idType = "character";
        targetUrl = `${baseUrl}characterID/${idValue}/page/${page}/`;
        cacheKey = `kills:character:${idValue}:page:${page}`;
      } else if (killsType === "corporation") {
        idType = "corporation";
        targetUrl = `${baseUrl}corporationID/${idValue}/page/${page}/`;
        cacheKey = `kills:corporation:${idValue}:page:${page}`;
      } else if (killsType === "alliance") {
        idType = "alliance";
        targetUrl = `${baseUrl}allianceID/${idValue}/page/${page}/`;
        cacheKey = `kills:alliance:${idValue}:page:${page}`;
      } else {
        return jsonError("kills parameter must be 'character', 'corporation', or 'alliance'", 400, false);
      }
    } else if (searchParams.has("character")) {
      idType = "character";
      idValue = searchParams.get("character");
      if (!isInteger(idValue)) {
        return jsonError("Character ID must be an integer", 400, false);
      }
      targetUrl = `${baseUrl}characterID/${idValue}/`;
      cacheKey = `stats:character:${idValue}`;
    } else if (searchParams.has("corporation")) {
      idType = "corporation";
      idValue = searchParams.get("corporation");
      if (!isInteger(idValue)) {
        return jsonError("Corporation ID must be an integer", 400, false);
      }
      targetUrl = `${baseUrl}corporationID/${idValue}/`;
      cacheKey = `stats:corporation:${idValue}`;
    } else if (searchParams.has("alliance")) {
      idType = "alliance";
      idValue = searchParams.get("alliance");
      if (!isInteger(idValue)) {
        return jsonError("Alliance ID must be an integer", 400, false);
      }
      targetUrl = `${baseUrl}allianceID/${idValue}/`;
      cacheKey = `stats:alliance:${idValue}`;
    } else {
      return jsonError("Invalid request. Use ?character=ID, ?corporation=ID, ?alliance=ID, or ?kills=TYPE&id=ID", 400, false);
    }

    const powNonce = searchParams.get("nonce");
    const powHash = searchParams.get("hash");
    const powTimestamp = searchParams.get("ts");
    const now = Math.floor(Date.now() / 1000);

    if (!powNonce || !powHash || !powTimestamp) {
      return jsonError("Missing PoW parameters (nonce, hash, ts)", 400, false);
    }

    if (Math.abs(now - parseInt(powTimestamp, 10)) > 300) {
      return jsonError("Stale PoW timestamp", 403, false);
    }

    const enc = new TextEncoder();
    const data = enc.encode(`${idValue}|${powNonce}|${powTimestamp}`);
    const digestBuffer = await crypto.subtle.digest("SHA-256", data);
    const digestHex = [...new Uint8Array(digestBuffer)]
      .map((x) => x.toString(16).padStart(2, "0"))
      .join("");

    if (digestHex !== powHash) {
      return jsonError("Invalid PoW hash", 403, false);
    }

    if (!digestHex.startsWith("000")) {
      return jsonError("Insufficient PoW difficulty", 403, false);
    }

    const cache = caches.default;
    const cacheRequest = new Request(`${origin}/cache/${cacheKey}`);
    
    let response = await cache.match(cacheRequest);

    if (response) {
      const newHeaders = new Headers(response.headers);
      newHeaders.set("X-Cache", "HIT");
      newHeaders.set("X-Cache-Key", cacheKey);
      Object.entries(getCorsHeaders()).forEach(([key, value]) => {
        newHeaders.set(key, value);
      });
      
      return new Response(response.body, {
        status: response.status,
        headers: newHeaders
      });
    }

    try {
      const forwardHeaders = new Headers(request.headers);
      const ua = forwardHeaders.get("User-Agent") || "UnknownClient";
      forwardHeaders.set("User-Agent", `${ua} +cf-proxy`);

      const resp = await fetch(targetUrl, { headers: forwardHeaders });
      const data = await resp.arrayBuffer();

      response = new Response(data, {
        status: resp.status,
        headers: {
          "Content-Type": resp.headers.get("Content-Type") || "application/json",
          "X-Cache": "MISS",
          "X-Cache-Key": cacheKey,
          ...getCorsHeaders()
        }
      });

      if (shouldCacheResponse(resp.status, resp.headers)) {
        const cacheResponse = response.clone();
        const cacheHeaders = new Headers(cacheResponse.headers);
        const maxAge = isKillsEndpoint ? 10800 : 1800;
        cacheHeaders.set("Cache-Control", `public, max-age=${maxAge}`);

        const cachedResponse = new Response(cacheResponse.body, {
          status: cacheResponse.status,
          headers: cacheHeaders
        });

        ctx.waitUntil(cache.put(cacheRequest, cachedResponse));
      }
      return response;
    } catch (error) {
      console.error(`Error fetching ${targetUrl}:`, error);
      return jsonError(`Failed to fetch from zKillboard: ${error.message}`, 502, false);
    }
  }
};

/**
 * Determine if a response should be cached based on status and headers
 */
function shouldCacheResponse(status, headers) {
  if (status >= 200 && status < 300) {
    return true;
  }
  
  if (status === 404) {
    return true; // We'll set a shorter TTL for these
  }
  
  if (status === 400 || status === 401 || status === 403 || 
      status === 429 || status >= 500) {
    return false;
  }
  
  const cacheControl = headers.get('cache-control');
  if (cacheControl && cacheControl.includes('no-cache')) {
    return false;
  }
  
  return status < 500;
}

/**
 * Create JSON error response with optional caching
 */
function jsonError(message, status, shouldCache = false) {
  const headers = {
    "Content-Type": "application/json",
    ...getCorsHeaders(),
    "X-Cache": "ERROR-NO-CACHE"
  };
  
  if (!shouldCache) {
    headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
    headers["Expires"] = "0";
  }
  
  return new Response(JSON.stringify({ 
    error: message,
    timestamp: new Date().toISOString()
  }), {
    status,
    headers
  });
}