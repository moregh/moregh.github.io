// Vercel handler

export default async function handler(request, response) {
  // Handle CORS preflight requests
  if (request.method === 'OPTIONS') {
    return response.status(200).json(null);
  }

  const { query } = request;
  const baseUrl = "https://zkillboard.com/api/stats/";
  let targetUrl = null;
  let idType = null;
  let idValue = null;

  // Helper function
  const isInteger = (value) => /^\d+$/.test(value);

  // Set CORS headers for all responses
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');

  // Extract the ID parameter
  if (query.character) {
    idType = "character";
    idValue = query.character;
    if (!isInteger(idValue)) {
      return response.status(400).json({ error: "Character ID must be an integer" });
    }
    targetUrl = `${baseUrl}characterID/${idValue}/`;
  } else if (query.corporation) {
    idType = "corporation";
    idValue = query.corporation;
    if (!isInteger(idValue)) {
      return response.status(400).json({ error: "Corporation ID must be an integer" });
    }
    targetUrl = `${baseUrl}corporationID/${idValue}/`;
  } else if (query.alliance) {
    idType = "alliance";
    idValue = query.alliance;
    if (!isInteger(idValue)) {
      return response.status(400).json({ error: "Alliance ID must be an integer" });
    }
    targetUrl = `${baseUrl}allianceID/${idValue}/`;
  } else {
    return response.status(400).json({ 
      error: "Invalid request. Use ?character=ID, ?corporation=ID, or ?alliance=ID" 
    });
  }

  // Proof of Work check
  const powNonce = query.nonce;
  const powHash = query.hash;
  const powTimestamp = query.ts;
  const now = Math.floor(Date.now() / 1000);

  if (!powNonce || !powHash || !powTimestamp) {
    return response.status(400).json({ error: "Missing PoW parameters (nonce, hash, ts)" });
  }

  // Reject if timestamp is too old/new (±5 minutes)
  if (Math.abs(now - parseInt(powTimestamp, 10)) > 300) {
    return response.status(403).json({ error: "Stale PoW timestamp" });
  }

  // Recompute hash
  const crypto = require('crypto');
  const input = `${idValue}|${powNonce}|${powTimestamp}`;
  const computedHash = crypto.createHash('sha256').update(input).digest('hex');

  if (computedHash !== powHash) {
    return response.status(403).json({ error: "Invalid PoW hash" });
  }

  // Difficulty check: first 12 bits must be zero (i.e. "000" prefix in hex)
  if (!computedHash.startsWith("000")) {
    return response.status(403).json({ error: "Insufficient PoW difficulty" });
  }

  // Fetch from zKillboard
  try {
    const zkillResponse = await fetch(targetUrl, {
      headers: {
        'User-Agent': `${request.headers['user-agent'] || 'UnknownClient'} +vercel-proxy`
      }
    });

    const data = await zkillResponse.json();
    
    // Set cache headers for 30 minutes
    response.setHeader('Cache-Control', 'public, max-age=1800');
    
    return response.status(zkillResponse.status).json(data);
    
  } catch (error) {
    return response.status(502).json({ 
      error: `Failed to fetch from zKillboard: ${error.message}` 
    });
  }
}