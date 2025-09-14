// Cloudflare handler

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
        return jsonError("Character ID must be an integer", 400);
      }
      targetUrl = `${baseUrl}characterID/${idValue}/`;
      cacheKey = `character:${idValue}`;
    } else if (searchParams.has("corporation")) {
      idType = "corporation";
      idValue = searchParams.get("corporation");
      if (!isInteger(idValue)) {
        return jsonError("Corporation ID must be an integer", 400);
      }
      targetUrl = `${baseUrl}corporationID/${idValue}/`;
      cacheKey = `corporation:${idValue}`;
    } else if (searchParams.has("alliance")) {
      idType = "alliance";
      idValue = searchParams.get("alliance");
      if (!isInteger(idValue)) {
        return jsonError("Alliance ID must be an integer", 400);
      }
      targetUrl = `${baseUrl}allianceID/${idValue}/`;
      cacheKey = `alliance:${idValue}`;
    } else {
      return jsonError("Invalid request. Use ?character=ID, ?corporation=ID, or ?alliance=ID", 400);
    }

    // --- Proof of Work check ---
    const powNonce = searchParams.get("nonce");
    const powHash = searchParams.get("hash");
    const powTimestamp = searchParams.get("ts");
    const now = Math.floor(Date.now() / 1000);

    if (!powNonce || !powHash || !powTimestamp) {
      return jsonError("Missing PoW parameters (nonce, hash, ts)", 400);
    }

    // Reject if timestamp is too old/new (±5 minutes)
    if (Math.abs(now - parseInt(powTimestamp, 10)) > 300) {
      return jsonError("Stale PoW timestamp", 403);
    }

    // Recompute hash
    const enc = new TextEncoder();
    const data = enc.encode(`${idValue}|${powNonce}|${powTimestamp}`);
    const digestBuffer = await crypto.subtle.digest("SHA-256", data);
    const digestHex = [...new Uint8Array(digestBuffer)]
      .map((x) => x.toString(16).padStart(2, "0"))
      .join("");

    if (digestHex !== powHash) {
      return jsonError("Invalid PoW hash", 403);
    }

    // Difficulty check: first 12 bits must be zero (i.e. "000" prefix in hex)
    if (!digestHex.startsWith("000")) {
      return jsonError("Insufficient PoW difficulty", 403);
    }

    // --- Caching ---
    const cache = caches.default;
    const cacheRequest = new Request(`${origin}/${cacheKey}`);
    let response = await cache.match(cacheRequest);

    if (!response) {
      // Forward client headers
      const forwardHeaders = new Headers(request.headers);

      // Append -cf-proxy to User-Agent
      const ua = forwardHeaders.get("User-Agent") || "UnknownClient";
      forwardHeaders.set("User-Agent", `${ua} +cf-proxy`);

      try {
        // Fetch fresh from zKillboard
        const resp = await fetch(targetUrl, { headers: forwardHeaders });
        const data = await resp.arrayBuffer();

        response = new Response(data, {
          status: resp.status,
          headers: {
            "Content-Type": resp.headers.get("Content-Type") || "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS"
          }
        });
        
        // Cache for 30 minutes
        request.headers.set("Cache-Control", "maxage=1800");
        request.headers.set("Cache-Control", "s-maxage=1800");
        ctx.waitUntil(
          cache.put(cacheRequest, response.clone())
        );
      } catch (error) {
        return jsonError(`Failed to fetch from zKillboard: ${error.message}`, 502);
      }
    } else {
      // Add CORS headers to cached response
      const newHeaders = new Headers(response.headers);
      newHeaders.set("X-Cache", "HIT");
      newHeaders.set("Access-Control-Allow-Origin", "*");
      newHeaders.set("Access-Control-Allow-Headers", "*");
      newHeaders.set("Access-Control-Allow-Methods", "GET, OPTIONS");
      
      response = new Response(response.body, {
        status: response.status,
        headers: newHeaders
      });
    }

    return response;
  }
};

// Utility: JSON error response WITH CORS headers
function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS"
    }
  });
}