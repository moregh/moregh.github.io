const ESI_BASE = "https://esi.evetech.net/latest";
    const CACHE_EXPIRY_HOURS = 12;
    const characterInfoCache = new Map();
    const corporationInfoCache = new Map();
    const allianceInfoCache = new Map();
    const characterNameToIdCache = new Map();
    const characterAffiliationCache = new Map(); // New cache for affiliations
    let timerInterval = null, startTime = 0;

    // Cache management functions
    function getCacheKey(type, id) {
      return `eve_${type}_${id}`;
    }

    function getNameCacheKey(name) {
      return `eve_name_${name.toLowerCase()}`;
    }

    function getAffiliationCacheKey(id) {
      return `eve_affiliation_${id}`;
    }

    function getCachedData(type, id) {
      try {
        const cacheKey = getCacheKey(type, id);
        const cached = localStorage.getItem(cacheKey);
        if (!cached) return null;
        
        const { data, timestamp } = JSON.parse(cached);
        const now = Date.now();
        const expiryTime = timestamp + (CACHE_EXPIRY_HOURS * 60 * 60 * 1000);
        
        if (now > expiryTime) {
          localStorage.removeItem(cacheKey);
          return null;
        }
        
        return data;
      } catch (e) {
        console.warn(`Error reading cache for ${type}:${id}`, e);
        return null;
      }
    }

    function getCachedNameToId(name) {
      try {
        const cacheKey = getNameCacheKey(name);
        const cached = localStorage.getItem(cacheKey);
        if (!cached) return null;
        
        const { data, timestamp } = JSON.parse(cached);
        const now = Date.now();
        const expiryTime = timestamp + (CACHE_EXPIRY_HOURS * 60 * 60 * 1000);
        
        if (now > expiryTime) {
          localStorage.removeItem(cacheKey);
          return null;
        }
        
        return data;
      } catch (e) {
        console.warn(`Error reading name cache for ${name}`, e);
        return null;
      }
    }

    function getCachedAffiliation(id) {
      try {
        const cacheKey = getAffiliationCacheKey(id);
        const cached = localStorage.getItem(cacheKey);
        if (!cached) return null;
        
        const { data, timestamp } = JSON.parse(cached);
        const now = Date.now();
        const expiryTime = timestamp + (CACHE_EXPIRY_HOURS * 60 * 60 * 1000);
        
        if (now > expiryTime) {
          localStorage.removeItem(cacheKey);
          return null;
        }
        
        return data;
      } catch (e) {
        console.warn(`Error reading affiliation cache for ${id}`, e);
        return null;
      }
    }

    function setCachedData(type, id, data) {
      try {
        const cacheKey = getCacheKey(type, id);
        const cacheData = {
          data: data,
          timestamp: Date.now()
        };
        localStorage.setItem(cacheKey, JSON.stringify(cacheData));
      } catch (e) {
        console.warn(`Error writing cache for ${type}:${id}`, e);
      }
    }

    function setCachedNameToId(name, characterData) {
      try {
        const cacheKey = getNameCacheKey(name);
        const cacheData = {
          data: { id: characterData.id, name: characterData.name },
          timestamp: Date.now()
        };
        localStorage.setItem(cacheKey, JSON.stringify(cacheData));
        // Also cache in memory
        characterNameToIdCache.set(name.toLowerCase(), { id: characterData.id, name: characterData.name });
      } catch (e) {
        console.warn(`Error writing name cache for ${name}`, e);
      }
    }

    function setCachedAffiliation(id, affiliationData) {
      try {
        const cacheKey = getAffiliationCacheKey(id);
        const cacheData = {
          data: affiliationData,
          timestamp: Date.now()
        };
        localStorage.setItem(cacheKey, JSON.stringify(cacheData));
        // Also cache in memory
        characterAffiliationCache.set(id, affiliationData);
      } catch (e) {
        console.warn(`Error writing affiliation cache for ${id}`, e);
      }
    }

    function clearExpiredCache() {
      try {
        const keys = Object.keys(localStorage);
        const now = Date.now();
        const expiryMs = CACHE_EXPIRY_HOURS * 60 * 60 * 1000;
        
        keys.forEach(key => {
          if (key.startsWith('eve_')) {
            try {
              const cached = JSON.parse(localStorage.getItem(key));
              if (now > cached.timestamp + expiryMs) {
                localStorage.removeItem(key);
              }
            } catch (e) {
              localStorage.removeItem(key);
            }
          }
        });
      } catch (e) {
        console.warn('Error clearing expired cache', e);
      }
    }

    // Clear expired cache on page load
    clearExpiredCache();

    function clientValidate(name) {
      name = name.trim();
      if(name.length < 3 || name.length > 37) return false;
      let pattern = /^[A-Za-z0-9.''-]+( [A-Za-z0-9.''-]+)*$/;
      if(!pattern.test(name)) return false;
      if(/^[ '-]|[ '-]$/.test(name)) return false;
      let parts = name.split(" ");
      if(parts.length===1 && name.length>24) return false;
      if(parts.length>1){
        let firstAndMiddle = parts.slice(0,-1).join(" ");
        let familyName = parts[parts.length-1];
        if(firstAndMiddle.length>24 || familyName.length>12) return false;
      }
      return true;
    }

    async function getCharacterIds(names){
      // Check which names we already have cached
      const cachedCharacters = [];
      const uncachedNames = [];
      
      for (const name of names) {
        // Check memory cache first
        const lowerName = name.toLowerCase();
        if (characterNameToIdCache.has(lowerName)) {
          cachedCharacters.push(characterNameToIdCache.get(lowerName));
          continue;
        }
        
        // Check localStorage cache
        const cached = getCachedNameToId(name);
        if (cached) {
          characterNameToIdCache.set(lowerName, cached);
          cachedCharacters.push(cached);
          continue;
        }
        
        // This name needs to be fetched
        uncachedNames.push(name);
      }
      
      let fetchedCharacters = [];
      
      // Only call ESI if we have uncached names
      if (uncachedNames.length > 0) {
        console.log(`Fetching ${uncachedNames.length} uncached names from ESI, using ${cachedCharacters.length} from cache`);
        const res = await fetch(`${ESI_BASE}/universe/ids/`,{
          method:'POST',
          headers:{'Content-Type':'application/json','Accept':'application/json'},
          body:JSON.stringify(uncachedNames)
        });
        if(!res.ok) throw new Error(`Failed to get character IDs: ${res.status}`);
        const data = await res.json();
        fetchedCharacters = data.characters || [];
        
        // Cache the newly fetched name->ID mappings
        fetchedCharacters.forEach(char => {
          setCachedNameToId(char.name, char);
        });
      } else {
        console.log(`Using all ${cachedCharacters.length} names from cache, no ESI calls needed`);
      }
      
      // Combine cached and fetched results
      return [...cachedCharacters, ...fetchedCharacters];
    }

    async function getCharacterAffiliations(characterIds) {
      // Check which affiliations we already have cached
      const cachedAffiliations = [];
      const uncachedIds = [];
      
      for (const id of characterIds) {
        // Check memory cache first
        if (characterAffiliationCache.has(id)) {
          cachedAffiliations.push(characterAffiliationCache.get(id));
          continue;
        }
        
        // Check localStorage cache
        const cached = getCachedAffiliation(id);
        if (cached) {
          characterAffiliationCache.set(id, cached);
          cachedAffiliations.push(cached);
          continue;
        }
        
        // This ID needs to be fetched
        uncachedIds.push(id);
      }
      
      let fetchedAffiliations = [];
      
      // Only call ESI if we have uncached IDs
      if (uncachedIds.length > 0) {
        console.log(`Fetching ${uncachedIds.length} uncached affiliations from ESI, using ${cachedAffiliations.length} from cache`);
        const res = await fetch(`${ESI_BASE}/characters/affiliation/`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json', 'Accept': 'application/json'},
          body: JSON.stringify(uncachedIds)
        });
        if (!res.ok) throw new Error(`Failed to get character affiliations: ${res.status}`);
        fetchedAffiliations = await res.json();
        
        // Cache the newly fetched affiliations
        fetchedAffiliations.forEach(affiliation => {
          setCachedAffiliation(affiliation.character_id, affiliation);
        });
      } else {
        console.log(`Using all ${cachedAffiliations.length} affiliations from cache, no ESI calls needed`);
      }
      
      // Combine cached and fetched results
      return [...cachedAffiliations, ...fetchedAffiliations];
    }

    async function getCorporationInfo(id){
      // Check memory cache first
      if(corporationInfoCache.has(id)) return corporationInfoCache.get(id);
      
      // Check localStorage cache
      const cached = getCachedData('corporation', id);
      if (cached) {
        corporationInfoCache.set(id, cached);
        return cached;
      }
      
      // Fetch from ESI
      const res = await fetch(`${ESI_BASE}/corporations/${id}/`);
      if(!res.ok) throw new Error(`Failed to get corporation info for ${id}: ${res.status}`);
      const data = await res.json();
      
      // Cache in both memory and localStorage
      corporationInfoCache.set(id, data);
      setCachedData('corporation', id, data);
      return data;
    }

    async function getAllianceInfo(id){
      // Check memory cache first
      if(allianceInfoCache.has(id)) return allianceInfoCache.get(id);
      
      // Check localStorage cache
      const cached = getCachedData('alliance', id);
      if (cached) {
        allianceInfoCache.set(id, cached);
        return cached;
      }
      
      // Fetch from ESI
      const res = await fetch(`${ESI_BASE}/alliances/${id}/`);
      if(!res.ok) throw new Error(`Failed to get alliance info for ${id}: ${res.status}`);
      const data = await res.json();
      
      // Cache in both memory and localStorage
      allianceInfoCache.set(id, data);
      setCachedData('alliance', id, data);
      return data;
    }

    async function validator(names){
      const characters = await getCharacterIds(names);
      const characterIds = characters.map(char => char.id);
      
      // Get all character affiliations in bulk
      const affiliations = await getCharacterAffiliations(characterIds);
      
      // Create a map for quick affiliation lookups
      const affiliationMap = new Map();
      affiliations.forEach(affiliation => {
        affiliationMap.set(affiliation.character_id, affiliation);
      });
      
      const results = [];
      updateProgress(0, characters.length);
      
      // Get unique corporation and alliance IDs to minimize API calls
      const uniqueCorpIds = new Set();
      const uniqueAllianceIds = new Set();
      
      affiliations.forEach(affiliation => {
        uniqueCorpIds.add(affiliation.corporation_id);
        if (affiliation.alliance_id) {
          uniqueAllianceIds.add(affiliation.alliance_id);
        }
      });
      
      // Fetch all corporation info in parallel
      const corpPromises = Array.from(uniqueCorpIds).map(id => 
        getCorporationInfo(id).catch(e => {
          console.error(`Error fetching corporation ${id}:`, e);
          return { name: 'Unknown Corporation', war_eligible: false };
        })
      );
      const corpInfos = await Promise.all(corpPromises);
      const corpMap = new Map();
      Array.from(uniqueCorpIds).forEach((id, index) => {
        corpMap.set(id, corpInfos[index]);
      });
      
      // Fetch all alliance info in parallel
      const alliancePromises = Array.from(uniqueAllianceIds).map(id => 
        getAllianceInfo(id).catch(e => {
          console.error(`Error fetching alliance ${id}:`, e);
          return { name: 'Unknown Alliance' };
        })
      );
      const allianceInfos = await Promise.all(alliancePromises);
      const allianceMap = new Map();
      Array.from(uniqueAllianceIds).forEach((id, index) => {
        allianceMap.set(id, allianceInfos[index]);
      });
      
      // Process each character
      for(let i = 0; i < characters.length; i++){
        const char = characters[i];
        try{
          const affiliation = affiliationMap.get(char.id);
          if (!affiliation) {
            throw new Error(`No affiliation found for character ${char.name}`);
          }
          
          const corpInfo = corpMap.get(affiliation.corporation_id);
          if (!corpInfo) {
            throw new Error(`No corporation info found for corporation ${affiliation.corporation_id}`);
          }
          
          let result = {
            character_name: char.name,
            character_id: char.id,
            corporation_name: corpInfo.name,
            corporation_id: affiliation.corporation_id,
            alliance_name: null,
            alliance_id: null,
            war_eligible: false
          };
          
          // Check for alliance ID from affiliation
          if(affiliation.alliance_id){
            const allianceInfo = allianceMap.get(affiliation.alliance_id);
            if (allianceInfo) {
              result.alliance_name = allianceInfo.name;
              result.alliance_id = affiliation.alliance_id;
            }
          }
          
          if(corpInfo.war_eligible !== undefined) result.war_eligible = corpInfo.war_eligible;
          results.push(result);
        }catch(e){
          console.error(`Error processing character ${char.name}:`, e);
          results.push({
            character_name: char.name,
            character_id: char.id,
            corporation_name: 'Error loading',
            corporation_id: null,
            alliance_name: null,
            alliance_id: null,
            war_eligible: false
          });
        }
        updateProgress(i + 1, characters.length);
      }
      return results;
    }

    function updateProgress(current, total) {
      const p = total > 0 ? (current / total) * 100 : 0;
      document.getElementById('progressBar').style.width = p + '%';
      document.getElementById('progressText').textContent = `Processed: ${current} / ${total}`;
    }

    function createCharacterItem(character){
      const item = document.createElement("div");
      item.className = "result-item";
      const charAvatar = document.createElement("img");
      charAvatar.src = `https://images.evetech.net/characters/${character.character_id}/portrait?size=64`;
      charAvatar.alt = character.character_name;
      charAvatar.className = "character-avatar";
      item.appendChild(charAvatar);
      const textContainer = document.createElement("div");
      textContainer.style.flex = "1";
      const charName = document.createElement("span");
      charName.className = "character-name";
      charName.innerHTML = `<a href="https://zkillboard.com/character/${character.character_id}/" target="_blank" class="character-link">${character.character_name}</a>`;
      textContainer.appendChild(charName);
      const details = document.createElement("div");
      details.className = "character-details";
      const corpAllianceInfo = document.createElement("div");
      corpAllianceInfo.className = "corp-alliance-info";
      if(character.corporation_id){
        const corpDiv = document.createElement("div");
        const corpLogo = document.createElement("img");
        corpLogo.src = `https://images.evetech.net/corporations/${character.corporation_id}/logo?size=64`;
        corpLogo.alt = character.corporation_name;
        corpLogo.className = "character-avatar";
        corpLogo.style.width = "24px";
        corpLogo.style.height = "24px";
        corpDiv.innerHTML = `<a href="https://zkillboard.com/corporation/${character.corporation_id}/" target="_blank" class="character-link">${character.corporation_name}</a>`;
        corpDiv.prepend(corpLogo);
        corpAllianceInfo.appendChild(corpDiv);
      }
      if(character.alliance_name && character.alliance_id){
        const allianceDiv = document.createElement("div");
        const allianceLogo = document.createElement("img");
        allianceLogo.src = `https://images.evetech.net/alliances/${character.alliance_id}/logo?size=64`;
        allianceLogo.alt = character.alliance_name;
        allianceLogo.className = "character-avatar";
        allianceLogo.style.width = "24px";
        allianceLogo.style.height = "24px";
        allianceDiv.innerHTML = `<a href="https://zkillboard.com/alliance/${character.alliance_id}/" target="_blank" class="character-link">${character.alliance_name}</a>`;
        allianceDiv.prepend(allianceLogo);
        corpAllianceInfo.appendChild(allianceDiv);
      }
      details.appendChild(corpAllianceInfo);
      textContainer.appendChild(details);
      item.appendChild(textContainer);
      return item;
    }

    function createSummaryItem({ id, name, count, type }) {
      const item = document.createElement("div");
      item.className = "summary-item";
      const logo = document.createElement("img");
      logo.src = `https://images.evetech.net/${type}s/${id}/logo?size=32`;
      logo.alt = name;
      logo.className = "summary-logo";
      item.appendChild(logo);
      const nameDiv = document.createElement("div");
      nameDiv.className = "summary-name";
      nameDiv.innerHTML = `<a href="https://zkillboard.com/${type}/${id}/" target="_blank" class="character-link">${name}</a>`;
      item.appendChild(nameDiv);
      const countDiv = document.createElement("div");
      countDiv.className = "summary-count";
      countDiv.textContent = count;
      item.appendChild(countDiv);
      return item;
    }

    function renderGrid(containerId, items, type = 'character') {
      const container = document.getElementById(containerId);
      container.innerHTML = "";
      if (items.length === 0) {
        const noResults = document.createElement("div");
        noResults.className = type === 'character' ? "no-results" : "no-summary";
        noResults.textContent = type === 'character' ? "No results found" : `No war-eligible ${type}s found`;
        container.appendChild(noResults);
        return;
      }
      items.forEach(item => container.appendChild(type === 'character' ? createCharacterItem(item) : createSummaryItem(item)));
    }

    function updateTimer() {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      document.getElementById("timer").textContent = `Elapsed: ${elapsed}s`;
    }

    function startLoading() {
      const lc = document.getElementById("loading-container");
      const rs = document.getElementById("results-section");
      const cb = document.getElementById("checkButton");
      const ec = document.getElementById("error-container");
      // Reset loading container styles to allow it to show
      lc.style.opacity = '';
      lc.style.height = '';
      lc.style.overflow = '';
      // Reset progress bar and text
      document.getElementById('progressBar').style.width = '0%';
      document.getElementById('progressText').textContent = 'Processed: 0 / 0';
      lc.classList.add("show");
      rs.classList.remove("show");
      cb.disabled = true;
      ec.innerHTML = "";
      startTime = Date.now();
      timerInterval = setInterval(updateTimer, 100);
    }

    function stopLoading() {
      const lc = document.getElementById("loading-container");
      const rs = document.getElementById("results-section");
      const cb = document.getElementById("checkButton");
      lc.classList.remove("show");
      cb.disabled = false;
      if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
      }
      setTimeout(() => {
        rs.classList.add("show");
        // Ensure loading-container remains collapsed
        lc.style.opacity = '0';
        lc.style.height = '0';
        lc.style.overflow = 'hidden';
      }, 100);
    }

    function showError(message) {
      document.getElementById("error-container").innerHTML = `<div class="error-message">${message}</div>`;
    }

    function updateStats(eligible, ineligible) {
      document.getElementById("eligible-count").textContent = eligible.length;
      document.getElementById("ineligible-count").textContent = ineligible.length;
      document.getElementById("total-count").textContent = eligible.length + ineligible.length;
    }

    function summarizeEntities(results) {
      const corpCounts = new Map();
      const allianceCounts = new Map();
      results.forEach(result => {
        if (result.war_eligible) {
          if (result.corporation_id) {
            corpCounts.set(result.corporation_id, {
              id: result.corporation_id,
              name: result.corporation_name,
              count: (corpCounts.get(result.corporation_id)?.count || 0) + 1,
              type: 'corporation'
            });
          }
          if (result.alliance_id) {
            allianceCounts.set(result.alliance_id, {
              id: result.alliance_id,
              name: result.alliance_name,
              count: (allianceCounts.get(result.alliance_id)?.count || 0) + 1,
              type: 'alliance'
            });
          }
        }
      });
      const topCorps = Array.from(corpCounts.values())
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
        .slice(0, 5);
      const topAlliances = Array.from(allianceCounts.values())
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
        .slice(0, 5);
      return { topCorps, topAlliances };
    }

    async function validateNames() {
      const rawNames = document.getElementById("names").value.split("\n").map(n => n.trim()).filter(n => n && clientValidate(n));
      
      // Deduplicate names (case-insensitive)
      const seenNames = new Set();
      const names = rawNames.filter(name => {
        const lowerName = name.toLowerCase();
        if (seenNames.has(lowerName)) {
          return false;
        }
        seenNames.add(lowerName);
        return true;
      });
      if (names.length === 0) {
        showError("No valid names entered. Please check the format of your character names.");
        return;
      }
      startLoading();
      try {
        const results = await validator(names);
        results.sort((a, b) => b.war_eligible - a.war_eligible);
        const eligible = results.filter(r => r.war_eligible);
        const ineligible = results.filter(r => !r.war_eligible);
        const { topCorps, topAlliances } = summarizeEntities(results);
        renderGrid("eligible-grid", eligible, 'character');
        renderGrid("ineligible-grid", ineligible, 'character');
        renderGrid("top-corp-grid", topCorps, 'corporation');
        renderGrid("top-alliance-grid", topAlliances, 'alliance');
        updateStats(eligible, ineligible);
      } catch (err) {
        showError("Error contacting EVE ESI servers. Please try again later.");
        console.error("Validation error:", err);
      } finally {
        stopLoading();
      }
    }

    document.getElementById('names').addEventListener('keydown', function(e) {
      if (e.ctrlKey && e.key === 'Enter') {
        validateNames();
      }
    });
