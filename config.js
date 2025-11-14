(() => {
  const DEFAULT_SERVER_BASE =
    "https://autoform-chrome-extention-server-csasaeerewb7b9ga.japaneast-01.azurewebsites.net/chrome_extension";
  const CACHE_STORAGE_KEY = "aimsalesRuntimeConfigCache";
  const MEMORY_CACHE = new Map();
  const API_KEY_STORAGE_KEY = "aimsalesApiKey";
  const FALLBACK_CONFIG = {
    edition: "free",
    rules: {
      priority: { initialDays: 7, dailyInitial: 50, dailyAfter: 10 },
      sharedDelay: { minMs: 2000, maxMs: 8000 },
      requireApiKey: false
    },
    endpoints: {
      formItems: `${DEFAULT_SERVER_BASE}/form_items`,
      envUpload: `${DEFAULT_SERVER_BASE}/env`,
      deviceToken: `${DEFAULT_SERVER_BASE}/device_token`
    },
    ui: {
      popup: {
        html: "",
        ads: {
          cards: []
        }
      }
    },
    quota: null,
    promoBlockText: ""
  };

  const clampInt = (value) => Math.max(0, Math.floor(Number(value) || 0));

  const clone = (input) => JSON.parse(JSON.stringify(input || {}));

  const deepMerge = (base, override) => {
    if (!override || typeof override !== "object") return clone(base);
    const result = clone(base);
    for (const [key, value] of Object.entries(override)) {
      if (value && typeof value === "object" && !Array.isArray(value) && result[key] && typeof result[key] === "object") {
        result[key] = deepMerge(result[key], value);
      } else {
        result[key] = value;
      }
    }
    return result;
  };

  const normalizeAdCards = (rawCards) => {
    if (!Array.isArray(rawCards)) return [];
    return rawCards
      .map((entry, index) => {
        if (!entry) return null;
        if (typeof entry === "string") {
          const trimmed = entry.trim();
          return trimmed
            ? {
                id: `promo-card-${index + 1}`,
                label: `広告${index + 1}`,
                html: trimmed
              }
            : null;
        }
        const html = typeof entry.html === "string" ? entry.html.trim() : "";
        if (!html) return null;
        const labelSource = typeof entry.label === "string" ? entry.label : entry.title;
        return {
          id: entry.id || `promo-card-${index + 1}`,
          label: labelSource ? String(labelSource).trim() : `広告${index + 1}`,
          html
        };
      })
      .filter(Boolean);
  };

  const normalizeConfig = (raw) => {
    const merged = raw ? deepMerge(FALLBACK_CONFIG, raw) : clone(FALLBACK_CONFIG);
    merged.rules = merged.rules || FALLBACK_CONFIG.rules;
    const priority = { ...(merged.rules?.priority || FALLBACK_CONFIG.rules.priority) };
    const normalizePriorityValue = (value, fallback) => (Number.isFinite(Number(value)) ? clampInt(value) : fallback);
    if (raw) {
      if (raw.rules?.priority) {
        const serverPriority = raw.rules.priority;
        if (serverPriority.initialDays != null) {
          priority.initialDays = normalizePriorityValue(serverPriority.initialDays, priority.initialDays);
        }
        if (serverPriority.dailyInitial != null) {
          priority.dailyInitial = normalizePriorityValue(serverPriority.dailyInitial, priority.dailyInitial);
        }
        if (serverPriority.dailyAfter != null) {
          priority.dailyAfter = normalizePriorityValue(serverPriority.dailyAfter, priority.dailyAfter);
        }
      }
      if (raw.initial_days != null) {
        priority.initialDays = normalizePriorityValue(raw.initial_days, priority.initialDays);
      }
      if (raw.daily_initial != null) {
        priority.dailyInitial = normalizePriorityValue(raw.daily_initial, priority.dailyInitial);
      }
      if (raw.daily_after != null) {
        priority.dailyAfter = normalizePriorityValue(raw.daily_after, priority.dailyAfter);
      }
    }
    merged.rules.priority = priority;
    merged.endpoints = merged.endpoints || FALLBACK_CONFIG.endpoints;
    if (!merged.ui) merged.ui = { popup: { ...FALLBACK_CONFIG.ui.popup } };
    if (!merged.ui.popup) merged.ui.popup = { ...FALLBACK_CONFIG.ui.popup };
    if (!merged.ui.popup.ads) merged.ui.popup.ads = { cards: [] };
    const block3Text =
      typeof raw?.block3_text === "string" ? raw.block3_text : merged.promoBlockText || merged.ui.popup.block3Text;
    merged.promoBlockText = typeof block3Text === "string" ? block3Text : "";
    if (merged.ui.popup) {
      merged.ui.popup.block3Text = merged.promoBlockText;
      if (typeof merged.ui.popup.html !== "string" || !merged.ui.popup.html.trim()) {
        merged.ui.popup.html = "";
      }
    }
    const adCardCandidates = [
      raw?.ui?.popup?.ads?.cards,
      raw?.ui?.popup?.ads,
      raw?.popup_ads,
      raw?.ads
    ];
    let normalizedAds = [];
    for (const candidate of adCardCandidates) {
      if (Array.isArray(candidate)) {
        normalizedAds = normalizeAdCards(candidate);
        break;
      }
    }
    if (!normalizedAds.length && Array.isArray(merged.ui.popup.ads.cards)) {
      normalizedAds = normalizeAdCards(merged.ui.popup.ads.cards);
    }
    merged.ui.popup.ads.cards = normalizedAds;
    merged.quota = merged.quota || null;
    return merged;
  };

  const readStorageCacheMap = () =>
    new Promise((resolve) => {
      if (!chrome?.storage?.local) {
        resolve({});
        return;
      }
      chrome.storage.local.get(CACHE_STORAGE_KEY, (res) => resolve(res?.[CACHE_STORAGE_KEY] || {}));
    });

  const writeStorageCacheMap = (cacheMap) =>
    new Promise((resolve) => {
      if (!chrome?.storage?.local) {
        resolve();
        return;
      }
      chrome.storage.local.set({ [CACHE_STORAGE_KEY]: cacheMap }, () => resolve());
    });

  const loadFromStorage = async (cacheId) => {
    const cacheMap = await readStorageCacheMap();
    return cacheMap?.[cacheId] || null;
  };

  const saveToStorage = async (cacheId, entry) => {
    const cacheMap = await readStorageCacheMap();
    cacheMap[cacheId] = entry;
    await writeStorageCacheMap(cacheMap);
  };

  const makeCacheId = (base, plan) => `${base}|${plan || "default"}`;

  const readSyncStorage = (key) =>
    new Promise((resolve) => {
      if (!chrome?.storage?.sync) {
        resolve(undefined);
        return;
      }
      chrome.storage.sync.get(key, (res) => resolve(res?.[key]));
    });

  const getStoredApiKey = async () => {
    const stored = await readSyncStorage(API_KEY_STORAGE_KEY);
    return typeof stored === "string" ? stored : "";
  };

  const ensureDeviceToken = async (base) => {
    if (!DeviceAuth?.getOrRefreshDeviceToken) return null;
    const endpoint = `${base}/device_token`;
    const gather = typeof DeviceAuth?.collectSignals === "function" ? DeviceAuth.collectSignals : undefined;
    try {
      return await DeviceAuth.getOrRefreshDeviceToken(gather, endpoint);
    } catch (err) {
      console.warn("[RuntimeConfig] device token refresh failed", err);
      return null;
    }
  };

  const fetchRuntimeConfig = async (base, plan, authContext = {}) => {
    const normalizedBase = `${base || DEFAULT_SERVER_BASE}`.replace(/\/+$/, "");
    const url = new URL(`${normalizedBase}/config`);
    if (plan) url.searchParams.set("plan", plan);
    const headers = { accept: "application/json" };
    const deviceToken = authContext.deviceToken || null;
    const apiKey = authContext.apiKey || null;
    if (deviceToken) {
      headers.Authorization = `Bearer ${deviceToken}`;
    }
    if (apiKey) {
      headers["X-API-Key"] = apiKey;
    }
    const response = await fetch(url.toString(), { headers });
    if (!response.ok) {
      throw new Error(`Config fetch failed (${response.status})`);
    }
    return response.json();
  };

  const memoryEntryIsValid = (entry) => entry && entry.expiresAt && entry.expiresAt > Date.now();

  async function loadRuntimeConfig(options = {}) {
    const serverBase = options.serverBase || DEFAULT_SERVER_BASE;
    const plan = options.plan || FALLBACK_CONFIG.edition || "free";
    const normalizedBase = `${serverBase}`.replace(/\/+$/, "");
    const cacheId = makeCacheId(normalizedBase, plan);
    const now = Date.now();
    const authContext = {};
    try {
      authContext.deviceToken = await ensureDeviceToken(normalizedBase);
    } catch (_) {
      authContext.deviceToken = null;
    }
    try {
      authContext.apiKey = await getStoredApiKey();
    } catch (_) {
      authContext.apiKey = "";
    }

    const memoryEntry = MEMORY_CACHE.get(cacheId);
    if (memoryEntryIsValid(memoryEntry)) {
      return memoryEntry.config;
    }

    const storedEntry = await loadFromStorage(cacheId);
    if (memoryEntryIsValid(storedEntry)) {
      MEMORY_CACHE.set(cacheId, storedEntry);
      return storedEntry.config;
    }

    let fetched;
    try {
      if (!authContext.deviceToken) {
        authContext.deviceToken = await ensureDeviceToken(normalizedBase);
      }
      fetched = await fetchRuntimeConfig(normalizedBase, plan, authContext);
    } catch (_) {
      if (storedEntry?.config) {
        return storedEntry.config;
      }
      const fallbackConfig = normalizeConfig();
      const fallbackEntry = { config: fallbackConfig, expiresAt: now + 60 * 1000 };
      MEMORY_CACHE.set(cacheId, fallbackEntry);
      return fallbackConfig;
    }

    const normalized = normalizeConfig(fetched);
    const ttlSec = clampInt(fetched?.cache_ttl_sec);
    const ttlMs = ttlSec > 0 ? ttlSec * 1000 : 5 * 60 * 1000;
    const entry = { config: normalized, expiresAt: now + ttlMs };
    MEMORY_CACHE.set(cacheId, entry);
    await saveToStorage(cacheId, entry);
    return normalized;
  }

  async function getCachedConfig(options = {}) {
    const serverBase = options.serverBase || DEFAULT_SERVER_BASE;
    const plan = options.plan || FALLBACK_CONFIG.edition || "free";
    const cacheId = makeCacheId(serverBase, plan);
    const memoryEntry = MEMORY_CACHE.get(cacheId);
    if (memoryEntryIsValid(memoryEntry)) {
      return memoryEntry.config;
    }
    const storedEntry = await loadFromStorage(cacheId);
    if (memoryEntryIsValid(storedEntry)) {
      MEMORY_CACHE.set(cacheId, storedEntry);
      return storedEntry.config;
    }
    return null;
  }

  function clearRuntimeCache() {
    MEMORY_CACHE.clear();
    if (chrome?.storage?.local) {
      chrome.storage.local.remove(CACHE_STORAGE_KEY, () => {});
    }
  }

  self.RuntimeConfig = {
    loadRuntimeConfig,
    getCachedConfig,
    clearRuntimeCache,
    DEFAULTS: FALLBACK_CONFIG,
    DEFAULT_SERVER_BASE
  };
})();
