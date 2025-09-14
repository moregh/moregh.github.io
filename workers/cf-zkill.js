// Enhanced Cloudflare Worker with Smart Caching

export default {
  async fetch(request, env, ctx) {
    // Handle CORS preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Accept',
          'Access-Control-Max-Age': '86400',
        }
      });
    }

    const { searchParams, origin } = new URL(request.url);

    const baseUrl = "https://zkillboard.com/api/stats/";
    let targetUrl = null;
    let cacheKey = null;
    let idType = null;
    let idValue = null;

    // --- Helpers ---
    const isInteger = (value) => /^\d+$/.test(value);

    // Extract the ID parameter
    if (searchParams.has("character")) {
      idType = "character";
      idValue = searchParams.get("character");
      if (!isInteger(idValue)) {
        return jsonError("Character ID must be an integer", 400, false); // Don't cache errors
      }
      targetUrl = `${baseUrl}characterID/${idValue}/`;
      cacheKey = `character:${idValue}`;
    } else if (searchParams.has("corporation")) {
      idType = "corporation";
      idValue = searchParams.get("corporation");
      if (!isInteger(idValue)) {
        return jsonError("Corporation ID must be an integer", 400, false);
      }
      targetUrl = `${baseUrl}corporationID/${idValue}/`;
      cacheKey = `corporation:${idValue}`;
    } else if (searchParams.has("alliance")) {
      idType = "alliance";
      idValue = searchParams.get("alliance");
      if (!isInteger(idValue)) {
        return jsonError("Alliance ID must be an integer", 400, false);
      }
      targetUrl = `${baseUrl}allianceID/${idValue}/`;
      cacheKey = `alliance:${idValue}`;
    } else {
      return jsonError("Invalid request. Use ?character=ID, ?corporation=ID, or ?alliance=ID", 400, false);
    }

    // --- Proof of Work check ---
    const powNonce = searchParams.get("nonce");
    const powHash = searchParams.get("hash");
    const powTimestamp = searchParams.get("ts");
    const now = Math.floor(Date.now() / 1000);

    if (!powNonce || !powHash || !powTimestamp) {
      return jsonError("Missing PoW parameters (nonce, hash, ts)", 400, false);
    }

    // Reject if timestamp is too old/new (±5 minutes)
    if (Math.abs(now - parseInt(powTimestamp, 10)) > 300) {
      return jsonError("Stale PoW timestamp", 403, false);
    }

    // Recompute hash
    const enc = new TextEncoder();
    const data = enc.encode(`${idValue}|${powNonce}|${powTimestamp}`);
    const digestBuffer = await crypto.subtle.digest("SHA-256", data);
    const digestHex = [...new Uint8Array(digestBuffer)]
      .map((x) => x.toString(16).padStart(2, "0"))
      .join("");

    if (digestHex !== powHash) {
      return jsonError("Invalid PoW hash", 403, false);
    }

    // Difficulty check: first 12 bits must be zero (i.e. "000" prefix in hex)
    if (!digestHex.startsWith("000")) {
      return jsonError("Insufficient PoW difficulty", 403, false);
    }

    // --- Smart Caching Logic ---
    const cache = caches.default;
    const cacheRequest = new Request(`${origin}/cache/${cacheKey}`);
    
    // Try to get from cache first
    let response = await cache.match(cacheRequest);

    if (response) {
      // Cache hit - add headers and return
      const newHeaders = new Headers(response.headers);
      newHeaders.set("X-Cache", "HIT");
      newHeaders.set("X-Cache-Key", cacheKey);
      newHeaders.set("Access-Control-Allow-Origin", "*");
      newHeaders.set("Access-Control-Allow-Headers", "*");
      newHeaders.set("Access-Control-Allow-Methods", "GET, OPTIONS");
      
      return new Response(response.body, {
        status: response.status,
        headers: newHeaders
      });
    }

    try {
      // Forward client headers
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
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS"
        }
      });

      // Smart caching decision
      if (shouldCacheResponse(resp.status, resp.headers)) {
        // Cache successful responses and some specific errors
        const cacheResponse = response.clone();
        const cacheHeaders = new Headers(cacheResponse.headers);
        cacheHeaders.set("Cache-Control", "public, max-age=1800");
        
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
  // Always cache successful responses
  if (status >= 200 && status < 300) {
    return true;
  }
  
  // Cache 404s for a shorter time (entity doesn't exist)
  if (status === 404) {
    return true; // We'll set a shorter TTL for these
  }
  
  // Don't cache authentication errors, server errors, or rate limits
  if (status === 400 || status === 401 || status === 403 || 
      status === 429 || status >= 500) {
    return false;
  }
  
  // Check for specific cache-control headers from upstream
  const cacheControl = headers.get('cache-control');
  if (cacheControl && cacheControl.includes('no-cache')) {
    return false;
  }
  
  // Default: cache other client errors briefly
  return status < 500;
}

/**
 * Create JSON error response with optional caching
 */
function jsonError(message, status, shouldCache = false) {
  const headers = { 
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
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