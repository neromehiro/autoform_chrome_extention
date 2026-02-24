(() => {
  const DEFAULT_SERVER_BASE =
    "https://autoform-chrome-extention-server-csasaeerewb7b9ga.japaneast-01.azurewebsites.net/chrome_extension";
  const CACHE_STORAGE_KEY = "aimsalesRuntimeConfigCache";
  const MEMORY_CACHE = new Map();
  const API_KEY_STORAGE_KEY = "aimsalesApiKey";
  const LOCAL_SETTINGS_PATH = "setting.json";
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
      },
      priorityCard: {
        showWhenRemainingAtMost: null
      }
    },
    iframePermissionOrigins: [
      "https://*.hsforms.net/*",
      "https://forms.hubspot.com/*"
    ],
    quota: null,
    promoBlockText: ""
  };

  const clampInt = (value) => Math.max(0, Math.floor(Number(value) || 0));

  const clone = (input) => JSON.parse(JSON.stringify(input || {}));

  const normalizeEditionValue = (value) => {
    if (typeof value !== "string") return null;
    const normalized = value.trim().toLowerCase();
    return normalized === "free" || normalized === "paid" ? normalized : null;
  };

  let localSettingsPromise = null;

  const resolveLocalSettingsUrl = () => {
    try {
      if (typeof chrome?.runtime?.getURL === "function") {
        return chrome.runtime.getURL(LOCAL_SETTINGS_PATH);
      }
    } catch (_) {
      // ignore
    }
    return LOCAL_SETTINGS_PATH;
  };

  const fetchLocalSettings = () => {
    if (localSettingsPromise) {
      return localSettingsPromise;
    }
    if (typeof fetch !== "function") {
      localSettingsPromise = Promise.resolve(null);
      return localSettingsPromise;
    }
    const url = resolveLocalSettingsUrl();
    localSettingsPromise = fetch(url, { cache: "no-cache" })
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null);
    return localSettingsPromise;
  };

  const getLocalEditionOverride = () =>
    fetchLocalSettings()
      .then((data) => {
        if (!data) return null;
        if (typeof data === "string") {
          return normalizeEditionValue(data);
        }
        if (typeof data?.edition === "string") {
          return normalizeEditionValue(data.edition);
        }
        if (typeof data?.mode === "string") {
          return normalizeEditionValue(data.mode);
        }
        return null;
      })
      .catch(() => null);

  const getLocalApiKeyOverride = () =>
    fetchLocalSettings()
      .then((data) => {
        if (!data) return null;
        const candidates = [data.apiKey, data.api_key, data.apikey];
        for (const candidate of candidates) {
          if (typeof candidate === "string" && candidate.trim()) {
            return candidate.trim();
          }
        }
        return null;
      })
      .catch(() => null);

  getLocalEditionOverride()
    .then((override) => {
      if (override) {
        FALLBACK_CONFIG.edition = override;
      }
    })
    .catch(() => {});

  const applyLocalEditionOverride = async (config) => {
    if (!config || typeof config !== "object") {
      return config;
    }
    try {
      const override = await getLocalEditionOverride();
      if (override) {
        config.edition = override;
      }
    } catch (_) {
      // ignore local override failures
    }
    return config;
  };

  const getPlanWithLocalOverride = async (plan) => {
    try {
      const override = await getLocalEditionOverride();
      if (override) {
        return override;
      }
    } catch (_) {
      // ignore and fall back to provided plan
    }
    return normalizeEditionValue(plan) || "free";
  };

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
    const normalizeOptionalThreshold = (value) => {
      if (value == null) return null;
      if (typeof value === "string" && !value.trim()) return null;
      const numeric = Number(value);
      if (!Number.isFinite(numeric) || numeric < 0) return null;
      return clampInt(numeric);
    };
    if (!merged.ui) merged.ui = { popup: { ...FALLBACK_CONFIG.ui.popup }, priorityCard: { ...FALLBACK_CONFIG.ui.priorityCard } };
    if (!merged.ui.popup) merged.ui.popup = { ...FALLBACK_CONFIG.ui.popup };
    if (!merged.ui.priorityCard) {
      merged.ui.priorityCard = { ...FALLBACK_CONFIG.ui.priorityCard };
    } else {
      merged.ui.priorityCard = { ...FALLBACK_CONFIG.ui.priorityCard, ...merged.ui.priorityCard };
    }
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
    const priorityCardSources = [
      raw?.ui?.priorityCard,
      raw?.ui?.priority_card,
      raw?.priority_card,
      raw
    ].filter(Boolean);
    for (const source of priorityCardSources) {
      const thresholdCandidates = [
        source.showWhenRemainingAtMost,
        source.show_when_remaining_at_most,
        source.showThreshold,
        source.show_threshold,
        source.maxRemainingToShow,
        source.max_remaining_to_show,
        source.priorityCardShowThreshold,
        source.priority_card_show_threshold
      ];
      for (const candidate of thresholdCandidates) {
        const normalized = normalizeOptionalThreshold(candidate);
        if (normalized != null) {
          merged.ui.priorityCard.showWhenRemainingAtMost = normalized;
          break;
        }
      }
      if (merged.ui.priorityCard.showWhenRemainingAtMost != null) {
        break;
      }
    }
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
    if (typeof stored === "string" && stored.trim()) {
      return stored.trim();
    }
    try {
      const override = await getLocalApiKeyOverride();
      if (override) {
        return override;
      }
    } catch (_) {
      // ignore local override failures
    }
    return "";
  };

  const shouldAttachApiKeyForConfig = (plan) => {
    const normalized = normalizeEditionValue(plan);
    return normalized === "paid";
  };

  const ensureDeviceToken = async (base, options = {}) => {
    if (!DeviceAuth?.getOrRefreshDeviceToken) return null;
    const endpoint = `${base}/device_token`;
    const gather = typeof DeviceAuth?.collectSignals === "function" ? DeviceAuth.collectSignals : undefined;
    const forceRefresh = Boolean(options?.forceRefresh);
    try {
      const refreshFn =
        forceRefresh && typeof DeviceAuth?.forceRefreshDeviceToken === "function"
          ? DeviceAuth.forceRefreshDeviceToken
          : DeviceAuth.getOrRefreshDeviceToken;
      return await refreshFn(gather, endpoint);
    } catch (err) {
      console.warn("[RuntimeConfig] device token refresh failed", err);
      return null;
    }
  };

  const fetchRuntimeConfig = async (base, plan, authContext = {}) => {
    const normalizedBase = `${base || DEFAULT_SERVER_BASE}`.replace(/\/+$/, "");
    const url = new URL(`${normalizedBase}/config`);
    const normalizedPlanParam = normalizeEditionValue(plan) || (typeof plan === "string" ? plan.trim() : "");
    if (normalizedPlanParam) {
      url.searchParams.set("plan", normalizedPlanParam);
      url.searchParams.set("plan_hint", normalizedPlanParam);
    }
    const headers = { accept: "application/json" };
    const deviceToken = authContext.deviceToken || null;
    const apiKey = authContext.apiKey || "";
    if (deviceToken) {
      headers.Authorization = `Bearer ${deviceToken}`;
    }
    if (shouldAttachApiKeyForConfig(normalizedPlanParam) && apiKey) {
      headers["X-API-Key"] = apiKey;
    }
    const response = await fetch(url.toString(), { headers });
    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      const message = errorBody?.trim()
        ? errorBody
        : `Config fetch failed (${response.status})`;
      const error = new Error(message);
      error.status = response.status;
      error.bodyText = errorBody;
      throw error;
    }
    return response.json();
  };

  const memoryEntryIsValid = (entry) => entry && entry.expiresAt && entry.expiresAt > Date.now();

  const isUnauthorizedError = (error) => {
    if (!error) return false;
    if (typeof error.status === "number" && error.status === 401) {
      return true;
    }
    const merged = [error.message, error.bodyText].filter(Boolean).join(" ").toLowerCase();
    return merged.includes("unauthorized");
  };

  async function loadRuntimeConfig(options = {}) {
    const {
      serverBase = DEFAULT_SERVER_BASE,
      plan = FALLBACK_CONFIG.edition || "free",
      forceReload = false,
      retryUnauthorized = true
    } = options;
    const normalizedBase = `${serverBase}`.replace(/\/+$/, "");
    const normalizedPlan = await getPlanWithLocalOverride(plan);
    const cacheId = makeCacheId(normalizedBase, normalizedPlan);
    const now = Date.now();
    const authContext = {};

    const setDeviceToken = async (force = false) => {
      try {
        authContext.deviceToken = await ensureDeviceToken(normalizedBase, { forceRefresh: force });
      } catch (_) {
        authContext.deviceToken = null;
      }
      return authContext.deviceToken;
    };

    await setDeviceToken(false);
    if (shouldAttachApiKeyForConfig(normalizedPlan)) {
      try {
        authContext.apiKey = await getStoredApiKey();
      } catch (_) {
        authContext.apiKey = "";
      }
    } else {
      authContext.apiKey = "";
    }

    const memoryEntry = MEMORY_CACHE.get(cacheId);
    if (!forceReload && memoryEntryIsValid(memoryEntry)) {
      return applyLocalEditionOverride(memoryEntry.config);
    }

    const storedEntry = await loadFromStorage(cacheId);
    if (!forceReload && memoryEntryIsValid(storedEntry)) {
      MEMORY_CACHE.set(cacheId, storedEntry);
      return applyLocalEditionOverride(storedEntry.config);
    }

    const fetchWithRetry = async () => {
      let attempts = 0;
      const maxAttempts = retryUnauthorized ? 2 : 1;
      let lastError = null;
      while (attempts < maxAttempts) {
        try {
          return await fetchRuntimeConfig(normalizedBase, normalizedPlan, authContext);
        } catch (error) {
          lastError = error;
          const shouldRetry = retryUnauthorized && isUnauthorizedError(error) && attempts === 0;
          if (!shouldRetry) {
            break;
          }
          await setDeviceToken(true);
          attempts += 1;
        }
      }
      throw lastError;
    };

    let fetched;
    try {
      fetched = await fetchWithRetry();
    } catch (error) {
      if (storedEntry?.config) {
        return applyLocalEditionOverride(storedEntry.config);
      }
      const fallbackConfig = normalizeConfig();
      await applyLocalEditionOverride(fallbackConfig);
      const fallbackEntry = { config: fallbackConfig, expiresAt: now + 60 * 1000 };
      MEMORY_CACHE.set(cacheId, fallbackEntry);
      return fallbackConfig;
    }

    const normalized = normalizeConfig(fetched);
    const ttlSec = clampInt(fetched?.cache_ttl_sec);
    const ttlMs = ttlSec > 0 ? ttlSec * 1000 : 5 * 60 * 1000;
    await applyLocalEditionOverride(normalized);
    const entry = { config: normalized, expiresAt: now + ttlMs };
    MEMORY_CACHE.set(cacheId, entry);
    await saveToStorage(cacheId, entry);
    return normalized;
  }

  async function getCachedConfig(options = {}) {
    const serverBase = options.serverBase || DEFAULT_SERVER_BASE;
    const plan = options.plan || FALLBACK_CONFIG.edition || "free";
    const normalizedPlan = await getPlanWithLocalOverride(plan);
    const cacheId = makeCacheId(serverBase, normalizedPlan);
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
    DEFAULT_SERVER_BASE,
    getLocalEditionOverride,
    getLocalApiKeyOverride
  };
})();
