try {
  importScripts("quota.js");
} catch (err) {
  console.warn("[AutoForm] failed to load quota helpers", err);
}
try {
  importScripts("auth.js");
} catch (err) {
  console.warn("[AutoForm] failed to load auth helpers", err);
}
try {
  importScripts("config.js");
} catch (err) {
  console.warn("[AutoForm] failed to load runtime config helpers", err);
}

const DEFAULT_SERVER_BASE =
  RuntimeConfig?.DEFAULT_SERVER_BASE ||
  "https://autoform-chrome-extention-server-csasaeerewb7b9ga.japaneast-01.azurewebsites.net/chrome_extension";
const FALLBACK_ENDPOINTS = {
  formItems: `${DEFAULT_SERVER_BASE}/form_items`,
  envUpload: `${DEFAULT_SERVER_BASE}/env`,
  deviceToken: `${DEFAULT_SERVER_BASE}/device_token`
};
let FORM_ITEMS_ENDPOINT = FALLBACK_ENDPOINTS.formItems;
let ENV_UPLOAD_ENDPOINT = FALLBACK_ENDPOINTS.envUpload;
let DEVICE_TOKEN_ENDPOINT = FALLBACK_ENDPOINTS.deviceToken;
const INSTALL_ID_STORAGE_KEY = "autoformInstallId";
const LAST_QUOTA_STORAGE_KEY = "autoformLastQuota";
const LAST_FILL_RESULT_STORAGE_KEY = "autoformLastFillResult";
const ANALYSIS_TTL_MS = 2 * 60 * 1000;
const BADGE_BG_COLOR = "#2563eb";
const BADGE_TEXT_COLOR = "#ffffff";
const lastHtmlByTab = new Map();
const tabLastCommittedUrls = new Map();
const tabInputCounts = new Map();
const frameInputCounts = new Map();
const API_KEY_STORAGE_KEY = "aimsalesApiKey";
const FLOATING_BUTTON_STORAGE_KEY = "autoformShowFloatingButton";
const MASTER_STORAGE_KEY = "autoformEnabled";
const AUTO_RUN_STORAGE_KEY = "autoformAutoRunOnOpen";
const AIMSALES_SIGNUP_URL = "https://forms.gle/FWkuxr8HenuLkARC7";

const FALLBACK_RULES = {
  priority: { initialDays: 7, dailyInitial: 50, dailyAfter: 10 },
  sharedDelay: { minMs: 2000, maxMs: 8000 },
  requireApiKey: false
};
const clone = (val) => JSON.parse(JSON.stringify(val || {}));
let RUNTIME = clone(RuntimeConfig?.DEFAULTS || { edition: "free", rules: FALLBACK_RULES, endpoints: FALLBACK_ENDPOINTS });
let EDITION = RUNTIME.edition || "free";
let RULES = RUNTIME.rules || { ...FALLBACK_RULES };
let IS_FREE_EDITION = EDITION === "free";
let REQUIRE_API_KEY = EDITION === "paid";
let lastServerQuota = null;
let lastQuotaLoadPromise = null;
let lastFillResultCache = null;
let lastFillResultLoadPromise = null;
let runtimeConfigRefreshPromise = null;

const deviceAuthAPI = typeof self !== "undefined" ? self.DeviceAuth : undefined;

function applyRuntimeConfig(nextConfig) {
  const fallbackConfig = clone(RuntimeConfig?.DEFAULTS || { edition: "free", rules: FALLBACK_RULES, endpoints: FALLBACK_ENDPOINTS });
  const config = nextConfig || fallbackConfig;
  RUNTIME = config;
  const endpoints = config?.endpoints || FALLBACK_ENDPOINTS;
  FORM_ITEMS_ENDPOINT = endpoints.formItems || FALLBACK_ENDPOINTS.formItems;
  ENV_UPLOAD_ENDPOINT = endpoints.envUpload || FALLBACK_ENDPOINTS.envUpload;
  DEVICE_TOKEN_ENDPOINT = endpoints.deviceToken || FALLBACK_ENDPOINTS.deviceToken;
  RULES = clone(config?.rules || FALLBACK_RULES);
  EDITION = config?.edition || "free";
  IS_FREE_EDITION = EDITION === "free";
  REQUIRE_API_KEY = EDITION === "paid";
  return config;
}

function refreshRuntimeConfigFromServer(options = {}) {
  if (runtimeConfigRefreshPromise) {
    return runtimeConfigRefreshPromise;
  }
  if (typeof RuntimeConfig?.loadRuntimeConfig !== "function") {
    return Promise.resolve(applyRuntimeConfig(null));
  }
  const serverBase = options.serverBase || DEFAULT_SERVER_BASE;
  const plan = options.plan || EDITION || "free";
  runtimeConfigRefreshPromise = RuntimeConfig.loadRuntimeConfig({
    serverBase,
    plan,
    forceReload: true
  })
    .then((cfg) => {
      const applied = applyRuntimeConfig(cfg);
      if (applied?.quota && typeof applied.quota === "object") {
        updateLastServerQuota(applied.quota);
      }
      return applied;
    })
    .finally(() => {
      runtimeConfigRefreshPromise = null;
    });
  return runtimeConfigRefreshPromise;
}

const runtimeConfigPromise =
  typeof RuntimeConfig?.loadRuntimeConfig === "function"
    ? RuntimeConfig.loadRuntimeConfig({ serverBase: DEFAULT_SERVER_BASE, plan: EDITION || "free" })
        .then((cfg) => applyRuntimeConfig(cfg))
        .catch((err) => {
          console.error("[AutoForm] runtime config load failed", err);
          return applyRuntimeConfig(null);
        })
    : Promise.resolve(applyRuntimeConfig(null));

async function ensureRuntimeConfigReady() {
  try {
    await runtimeConfigPromise;
  } catch (_) {
    // fallback already applied
  }
  return RUNTIME;
}

function readSyncStorage(key) {
  if (!chrome?.storage?.sync) {
    return Promise.resolve(undefined);
  }
  return new Promise((resolve) => {
    chrome.storage.sync.get(key, (res) => resolve(res?.[key]));
  });
}

async function getApiKey() {
  const stored = await readSyncStorage(API_KEY_STORAGE_KEY);
  if (typeof stored === "string" && stored.trim()) {
    return stored.trim();
  }
  const localOverrideGetter = RuntimeConfig?.getLocalApiKeyOverride;
  if (typeof localOverrideGetter === "function") {
    try {
      const override = await localOverrideGetter();
      if (override) {
        return override;
      }
    } catch (_) {
      // ignore override failures
    }
  }
  return "";
}

async function resolveEffectiveEdition() {
  return EDITION;
}

function sanitizeQuotaValue(value) {
  if (value === Infinity) return "Infinity";
  if (value === -Infinity) return "-Infinity";
  if (Number.isNaN(value)) return null;
  if (Array.isArray(value)) return value.map((entry) => sanitizeQuotaValue(entry));
  if (value && typeof value === "object") {
    const next = {};
    Object.entries(value).forEach(([key, val]) => {
      next[key] = sanitizeQuotaValue(val);
    });
    return next;
  }
  return value;
}

function persistLastServerQuota(quota) {
  if (!chrome?.storage?.local || !quota || typeof quota !== "object") return;
  const sanitized = sanitizeQuotaValue(quota);
  try {
    chrome.storage.local.set({ [LAST_QUOTA_STORAGE_KEY]: sanitized }, () => {
      if (chrome.runtime?.lastError) {
        console.warn("[AutoForm] failed to persist quota", chrome.runtime.lastError);
      }
    });
  } catch (err) {
    console.warn("[AutoForm] quota persistence failed", err);
  }
}

function sanitizeFillResultEntry(entry) {
  const source = entry && typeof entry === "object" ? entry : {};
  const sanitized = {
    ok: Boolean(source.ok),
    message: typeof source.message === "string" ? source.message : "",
    code: typeof source.code === "string" ? source.code : null,
    planStatus: typeof source.planStatus === "string" ? source.planStatus : null,
    applied: Number.isFinite(source.applied) ? source.applied : null,
    total: Number.isFinite(source.total) ? source.total : null,
    durationMs: Number.isFinite(source.durationMs) ? source.durationMs : null,
    timestamp: typeof source.timestamp === "number" ? source.timestamp : Date.now(),
    source: typeof source.source === "string" ? source.source : null
  };
  const quotaObject = source.quota && typeof source.quota === "object" ? source.quota : null;
  sanitized.quota = quotaObject ? sanitizeQuotaValue(quotaObject) : null;
  return sanitized;
}

function persistLastFillResult(entry) {
  if (!chrome?.storage?.local || !entry || typeof entry !== "object") return;
  try {
    chrome.storage.local.set({ [LAST_FILL_RESULT_STORAGE_KEY]: entry }, () => {
      if (chrome.runtime?.lastError) {
        console.warn("[AutoForm] failed to persist last fill result", chrome.runtime.lastError);
      }
    });
  } catch (err) {
    console.warn("[AutoForm] last fill result persistence failed", err);
  }
}

function recordLastFillResult(entry) {
  if (!entry || typeof entry !== "object") return;
  const sanitized = sanitizeFillResultEntry(entry);
  lastFillResultCache = sanitized;
  persistLastFillResult(sanitized);
}

function ensureLastFillResultLoaded() {
  if (lastFillResultCache) {
    return Promise.resolve(lastFillResultCache);
  }
  if (lastFillResultLoadPromise) {
    return lastFillResultLoadPromise;
  }
  if (!chrome?.storage?.local) {
    return Promise.resolve(null);
  }
  lastFillResultLoadPromise = new Promise((resolve) => {
    chrome.storage.local.get(LAST_FILL_RESULT_STORAGE_KEY, (res) => {
      if (chrome.runtime?.lastError) {
        resolve(null);
        return;
      }
      const stored = res?.[LAST_FILL_RESULT_STORAGE_KEY];
      lastFillResultCache = stored && typeof stored === "object" ? stored : null;
      resolve(lastFillResultCache);
    });
  }).finally(() => {
    lastFillResultLoadPromise = null;
  });
  return lastFillResultLoadPromise;
}

function extractQuotaFromPayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  const detail = payload.detail && typeof payload.detail === "object" ? payload.detail : null;
  const detailQuota = detail && typeof detail.quota === "object" ? detail.quota : null;
  if (detailQuota) return detailQuota;
  const quota = payload.quota;
  if (quota && typeof quota === "object") return quota;
  return null;
}

function extractPlanStatusFromPayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  const detail = payload.detail && typeof payload.detail === "object" ? payload.detail : null;
  const detailStatus = detail?.plan_status;
  if (typeof detailStatus === "string" && detailStatus.trim()) {
    return detailStatus.trim();
  }
  const topLevelStatus = payload.plan_status;
  if (typeof topLevelStatus === "string" && topLevelStatus.trim()) {
    return topLevelStatus.trim();
  }
  return null;
}

function parseApiErrorResponse(response, payload, rawText) {
  let data = payload;
  if (!data || typeof data !== "object") {
    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch (_) {
      data = {};
    }
  }
  const detail = data && typeof data.detail === "object" ? data.detail : null;
  const statusCode = response?.status;
  const fallbackMessage = `APIリクエストに失敗しました (${statusCode ?? "unknown"})`;
  const message =
    (typeof detail?.message === "string" && detail.message) ||
    (typeof data?.message === "string" && data.message) ||
    fallbackMessage;
  const error = new Error(message);
  error.status = statusCode;
  const code =
    (typeof detail?.code === "string" && detail.code) ||
    (typeof data?.code === "string" && data.code) ||
    null;
  if (code) {
    error.code = code;
  }
  const quota = extractQuotaFromPayload(data);
  if (quota) {
    error.quota = quota;
  }
  const planStatus = extractPlanStatusFromPayload(data);
  if (planStatus) {
    error.planStatus = planStatus;
  }
  if (detail && typeof detail.invalid_prefix === "string") {
    error.invalidPrefix = detail.invalid_prefix;
  }
  if (detail && typeof detail.client_plan_hint === "string") {
    error.clientPlanHint = detail.client_plan_hint;
  }
  if (!error.code && statusCode === 429) {
    error.code = "FREE_QUOTA_LIMIT";
  }
  return error;
}

function loadPersistedQuotaFromStorage() {
  if (!chrome?.storage?.local) return Promise.resolve(null);
  return new Promise((resolve) => {
    chrome.storage.local.get(LAST_QUOTA_STORAGE_KEY, (res) => {
      if (chrome.runtime?.lastError) {
        resolve(null);
        return;
      }
      const stored = res?.[LAST_QUOTA_STORAGE_KEY];
      resolve(stored && typeof stored === "object" ? stored : null);
    });
  });
}

function ensureLastQuotaLoaded() {
  if (lastServerQuota) {
    return Promise.resolve(lastServerQuota);
  }
  if (lastQuotaLoadPromise) {
    return lastQuotaLoadPromise;
  }
  lastQuotaLoadPromise = loadPersistedQuotaFromStorage()
    .then((stored) => {
      if (stored && typeof stored === "object" && !lastServerQuota) {
        lastServerQuota = stored;
      }
      return lastServerQuota;
    })
    .catch((err) => {
      console.warn("[AutoForm] failed to load stored quota", err);
      return null;
    })
    .finally(() => {
      lastQuotaLoadPromise = null;
    });
  return lastQuotaLoadPromise;
}

function updateLastServerQuota(quota) {
  if (quota && typeof quota === "object") {
    lastServerQuota = quota;
    persistLastServerQuota(quota);
  }
}

ensureLastQuotaLoaded().catch(() => {});
ensureLastFillResultLoaded().catch(() => {});

runtimeConfigPromise
  .catch(() => {})
  .finally(() => {
    bootstrapTabUrls();
    setBadgeBackgroundDefaults();
    registerAlwaysOnContentScript().catch(() => {});
  });

async function registerAlwaysOnContentScript() {
  if (!chrome?.permissions?.contains || !chrome?.scripting?.registerContentScripts) {
    return false;
  }
  const hasAll = await new Promise((resolve) => {
    chrome.permissions.contains({ origins: ["<all_urls>"] }, (granted) => resolve(Boolean(granted)));
  });
  if (!hasAll) return false;
  try {
    await chrome.scripting.unregisterContentScripts({ ids: ["autoform-all"] });
  } catch (_) {
    // ignore when not previously registered
  }
  await chrome.scripting.registerContentScripts([
    {
      id: "autoform-all",
      matches: ["<all_urls>"],
      js: ["content.js"],
      allFrames: true,
      matchAboutBlank: true,
      runAt: "document_end",
      persistAcrossSessions: true
    }
  ]);
  return true;
}

chrome.runtime?.onStartup?.addListener(() => {
  bootstrapTabUrls();
  registerAlwaysOnContentScript().catch(() => {});
});

chrome.permissions?.onAdded?.addListener((perms) => {
  if (!Array.isArray(perms?.origins)) return;
  const addedAllUrls = perms.origins.some((origin) => origin === "<all_urls>" || origin === "*://*/*");
  if (addedAllUrls) {
    registerAlwaysOnContentScript().catch(() => {});
  }
});

async function hasAllUrlsPermission() {
  if (!chrome?.permissions?.contains) return false;
  return new Promise((resolve) => {
    chrome.permissions.contains({ origins: ["<all_urls>"] }, (granted) => resolve(Boolean(granted)));
  });
}

const QUOTA_EXHAUSTED_MESSAGE =
  "本日の利用可能数を使い切りました。Aimsalesなら常時優先・一括送信が可能です";

async function resolveCurrentQuotaSnapshot() {
  try {
    await ensureLastQuotaLoaded();
  } catch (_) {
    // ignored; fall back to other sources
  }
  if (lastServerQuota) return lastServerQuota;
  return RUNTIME?.quota || null;
}

async function maybeApplyFreeThrottlingAndConsumeQuota() {
  await ensureRuntimeConfigReady();
  return { mode: IS_FREE_EDITION ? "priority" : "bypass" };
}

function getAllFrames(tabId) {
  return new Promise((resolve, reject) => {
    if (!chrome?.webNavigation?.getAllFrames) {
      reject(new Error("webNavigation_unavailable"));
      return;
    }
    chrome.webNavigation.getAllFrames({ tabId }, (frames) => {
      if (chrome.runtime?.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(Array.isArray(frames) && frames.length ? frames : [{ frameId: 0 }]);
    });
  });
}

async function ensureContentScriptInjected(tabId, frameIds) {
  if (!chrome?.scripting?.executeScript) return;
  const target = { tabId };
  if (Array.isArray(frameIds) && frameIds.length) {
    target.frameIds = frameIds;
  }
  try {
    await chrome.scripting.executeScript({ target, files: ["content.js"] });
  } catch (_) {
    // sandboxed iframes may reject injection; safe to ignore
  }
}

function isIgnorableConnectionError(message) {
  if (!message || typeof message !== "string") return false;
  const lower = message.toLowerCase();
  return (
    lower.includes("receiving end does not exist") ||
    lower.includes("could not establish connection") ||
    lower.includes("the message port closed before a response was received") ||
    lower.includes("no matching recipient")
  );
}

function sendCommandToFrame(tabId, frameId, message) {
  return new Promise((resolve) => {
    const payload = message && typeof message === "object" ? message : { type: message };
    chrome.tabs.sendMessage(
      tabId,
      payload,
      { frameId },
      (response) => {
        if (chrome.runtime?.lastError) {
          resolve({ error: chrome.runtime.lastError.message, unreachable: isIgnorableConnectionError(chrome.runtime.lastError.message) });
          return;
        }
        resolve(response || {});
      }
    );
  });
}

async function requestInputCountForTab(tabId) {
  if (typeof tabId !== "number" || tabId < 0) return;
  const hasAll = await hasAllUrlsPermission();
  if (!hasAll) return;
  try {
    const frames = await getAllFrames(tabId).catch(() => [{ frameId: 0 }]);
    const frameIds = Array.isArray(frames) && frames.length ? frames.map((frame) => frame.frameId) : [0];
    await ensureContentScriptInjected(tabId, frameIds);
    await Promise.all(
      frameIds.map((frameId) => sendCommandToFrame(tabId, frameId, { type: "autoform_request_input_count" }))
    );
  } catch (err) {
    console.warn("[AutoForm] failed to refresh input count", err);
  }
}

chrome.runtime?.onInstalled?.addListener(() => {
  registerAlwaysOnContentScript().catch(() => {});
});

function recordTabUrl(tabId, url) {
  if (typeof tabId !== "number") return;
  if (typeof url === "string" && url.trim()) {
    tabLastCommittedUrls.set(tabId, url);
  } else {
    tabLastCommittedUrls.delete(tabId);
  }
}

function bootstrapTabUrls() {
  if (!chrome?.tabs?.query) return;
  chrome.tabs.query({}, (tabs) => {
    if (!Array.isArray(tabs)) return;
    tabs.forEach((tab) => {
      if (typeof tab?.id === "number" && typeof tab?.url === "string") {
        recordTabUrl(tab.id, tab.url);
      }
    });
  });
}

function setBadgeBackgroundDefaults() {
  if (chrome?.action?.setBadgeBackgroundColor) {
    chrome.action.setBadgeBackgroundColor({ color: BADGE_BG_COLOR });
  }
  if (chrome?.action?.setBadgeTextColor) {
    chrome.action.setBadgeTextColor({ color: BADGE_TEXT_COLOR });
  }
}

function applyBadgeText(tabId, count) {
  if (!chrome?.action?.setBadgeText || typeof tabId !== "number") return;
  let text = "";
  if (typeof count === "number" && count > 0) {
    const raw = count > 999 ? "999+" : String(count);
    text = raw.length === 1 ? ` ${raw}` : raw;
  }
  chrome.action.setBadgeText({ tabId, text });
}

function updateBadgeCount(tabId, count) {
  if (typeof tabId !== "number" || tabId < 0) return;
  const hasUsableCount = Number.isFinite(count) && count >= 0;
  const normalized = hasUsableCount ? Math.max(0, Math.floor(count)) : 0;
  if (hasUsableCount) {
    tabInputCounts.set(tabId, {
      count: normalized,
      updatedAt: Date.now()
    });
  } else {
    tabInputCounts.delete(tabId);
  }
  applyBadgeText(tabId, normalized);
}

function recordFrameInputCount(tabId, frameId, count) {
  if (typeof tabId !== "number" || tabId < 0 || typeof frameId !== "number") return;
  const normalized = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  let frames = frameInputCounts.get(tabId);
  if (!frames) {
    frames = new Map();
    frameInputCounts.set(tabId, frames);
  }
  if (normalized === 0) {
    frames.delete(frameId);
    if (frames.size === 0) {
      frameInputCounts.delete(tabId);
    }
  } else {
    frames.set(frameId, normalized);
  }
  let total = 0;
  frameInputCounts.get(tabId)?.forEach((value) => {
    total += value;
  });
  updateBadgeCount(tabId, total);
}

function isHttpOrHttpsUrl(url) {
  if (typeof url !== "string") return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch (_) {
    return false;
  }
}

async function ensureContentScriptForTab(tabId, url) {
  if (typeof tabId !== "number" || tabId < 0) return;
  if (!isHttpOrHttpsUrl(url)) return;
  const hasAll = await hasAllUrlsPermission();
  if (!hasAll) return;
  try {
    const frames = await getAllFrames(tabId).catch(() => null);
    const frameIds = Array.isArray(frames) ? frames.map((frame) => frame.frameId) : undefined;
    await ensureContentScriptInjected(tabId, frameIds);
  } catch (_) {
    await ensureContentScriptInjected(tabId);
  }
}

function nowMs() {
  const hasPerformance = typeof performance !== "undefined" && typeof performance.now === "function";
  return hasPerformance ? performance.now() : Date.now();
}

async function sha256Hex(input) {
  try {
    if (!globalThis.crypto?.subtle) throw new Error("subtle_unavailable");
    const data = new TextEncoder().encode(String(input));
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch (_) {
    let hash = 0;
    const str = String(input || "");
    for (let i = 0; i < str.length; i += 1) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(16);
  }
}

async function getOrCreateInstallId() {
  if (!chrome?.storage?.local) return null;
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(INSTALL_ID_STORAGE_KEY, (res) => {
        if (chrome.runtime?.lastError) {
          resolve(null);
          return;
        }
        let existing = res?.[INSTALL_ID_STORAGE_KEY];
        if (typeof existing === "string" && existing.trim()) {
          resolve(existing.trim());
          return;
        }
        const generated =
          (typeof crypto?.randomUUID === "function" && crypto.randomUUID()) ||
          `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        chrome.storage.local.set({ [INSTALL_ID_STORAGE_KEY]: generated }, () => resolve(generated));
      });
    } catch (_) {
      resolve(null);
    }
  });
}

async function gatherSystemSignals({ nonce = "" } = {}) {
  const manifest = chrome?.runtime?.getManifest ? chrome.runtime.getManifest() : null;
  const extVersion = manifest?.version || null;
  const installId = await getOrCreateInstallId();
  const today = new Date().toISOString().slice(0, 10);
  const baseString = `${installId || "anonymous"}|${nonce || ""}|${today}`;
  const installEphemeral = await sha256Hex(baseString);
  const ua = typeof navigator !== "undefined" && typeof navigator.userAgent === "string" ? navigator.userAgent : "";
  const uaHash = await sha256Hex(`${ua}|${installId || ""}`);
  return { extVersion, installEphemeral, uaHash };
}

async function fetchFormItems(payload, originTabId) {
  await ensureRuntimeConfigReady();
  const { html, sendRecord, pageUrl } = payload || {};
  if (!html || !sendRecord) throw new Error("html と send_record が必要です");

  const requiresApiKeyForRequests = Boolean(REQUIRE_API_KEY);
  let apiKey = "";
  if (requiresApiKeyForRequests) {
    try {
      apiKey = await getApiKey();
    } catch (_) {
      apiKey = "";
    }
  }
  const shouldAttachApiKey = requiresApiKeyForRequests && Boolean(apiKey);
  if (requiresApiKeyForRequests && !apiKey) {
    const apiKeyMissingError = new Error("有料プランでは API キー が必須です");
    apiKeyMissingError.code = "PAID_API_KEY_MISSING";
    apiKeyMissingError.planStatus = "paid-missing";
    throw apiKeyMissingError;
  }

  try {
    await maybeApplyFreeThrottlingAndConsumeQuota();
  } catch (err) {
    if (err?.code === "quota_exhausted") {
      if (err.quota) {
        updateLastServerQuota(err.quota);
      }
      throw err;
    }
    console.warn("[AutoForm] quota handling failed", err);
  }

  const proof = await gatherSystemSignals({ nonce: "api_request" }).catch(() => null);
  const analysisId =
    (globalThis.crypto?.randomUUID && crypto.randomUUID()) || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const htmlSha256 = await sha256Hex(html).catch(() => null);
  const planHint = EDITION === "paid" ? "paid" : "free";

  const startedAt = nowMs();
  const requestPayload = {
    analysis_id: analysisId || undefined,
    send_record: sendRecord,
    page_url: pageUrl || undefined,
    user_info: proof || {},
    plan_hint: planHint,
    html,
    html_sha256: htmlSha256 || undefined
  };

  const getDeviceToken = async (forceRefresh = false) => {
    if (!deviceAuthAPI?.getOrRefreshDeviceToken) {
      return null;
    }
    try {
      if (forceRefresh && typeof deviceAuthAPI?.forceRefreshDeviceToken === "function") {
        return await deviceAuthAPI.forceRefreshDeviceToken(gatherSystemSignals, DEVICE_TOKEN_ENDPOINT);
      }
      return await deviceAuthAPI.getOrRefreshDeviceToken(gatherSystemSignals, DEVICE_TOKEN_ENDPOINT);
    } catch (err) {
      console.warn("[AutoForm] device token retrieval failed", err);
      return null;
    }
  };

  const buildAuthHeaders = async (forceDeviceTokenRefresh = false) => {
    const headers = {};
    const deviceToken = await getDeviceToken(forceDeviceTokenRefresh);
    if (deviceToken) {
      headers.Authorization = `Bearer ${deviceToken}`;
    }
    if (shouldAttachApiKey) {
      headers["X-API-Key"] = apiKey;
    }
    return headers;
  };

  const performApiRequest = async (forceDeviceTokenRefresh = false) => {
    const authHeaders = await buildAuthHeaders(forceDeviceTokenRefresh);
    return fetch(FORM_ITEMS_ENDPOINT, {
      method: "POST",
      headers: {
        accept: "application/json",
        "Content-Type": "application/json",
        ...authHeaders
      },
      body: JSON.stringify(requestPayload)
    });
  };

  const requestWithSafety = async (forceDeviceTokenRefresh = false) => {
    try {
      return await performApiRequest(forceDeviceTokenRefresh);
    } catch (err) {
      throw new Error(`APIリクエストに失敗しました: ${err?.message || err}`);
    }
  };

  let response = await requestWithSafety(false);
  if (response.status === 401) {
    const retryResponse = await requestWithSafety(true);
    response = retryResponse;
  }

  const text = await response.text().catch(() => "");
  let data = null;
  let parseError = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (err) {
      parseError = err;
      data = null;
    }
  } else {
    data = {};
  }
  const durationMs = nowMs() - startedAt;
  const serverQuota = extractQuotaFromPayload(data);
  if (serverQuota) {
    updateLastServerQuota(serverQuota);
  }
  if (!response.ok) {
    const apiError = parseApiErrorResponse(response, data, text);
    if (!apiError.quota && serverQuota) {
      apiError.quota = serverQuota;
    }
    throw apiError;
  }
  if (parseError) {
    throw new Error("APIレスポンスの解析に失敗しました");
  }
  const items = Array.isArray(data?.form_items) ? data.form_items : Array.isArray(data) ? data : [];
  const planStatus = extractPlanStatusFromPayload(data);

  const htmlLogId = typeof data?.html_log_id === "string" && data.html_log_id.trim() ? data.html_log_id.trim() : null;

  if (typeof originTabId === "number") {
    lastHtmlByTab.set(originTabId, {
      analysisId,
      pageUrl: pageUrl || undefined,
      htmlSha256,
      htmlLength: html?.length || 0,
      requestedAt: Date.now(),
      htmlLogId
    });
  }

  if (data?.env_token) {
    try {
      const sig = await gatherSystemSignals({ nonce: "env_upload" }).catch(() => null);
      const host = (() => {
        try {
          return pageUrl ? new URL(pageUrl).host : null;
        } catch (_) {
          return null;
        }
      })();
      const authHeaders = await buildAuthHeaders(false);
      const envSignals = sig || proof || {};
      const envPayload = {
        analysis_id: data?.analysis_id || analysisId,
        token: data.env_token,
        page_url: pageUrl || null,
        page_host: host,
        html_sha256: htmlSha256 || null,
        user_info: proof || {},
        plan_hint: planHint,
        install_ephemeral: envSignals?.installEphemeral || null,
        ext_version: envSignals?.extVersion || null,
        ua_hash: envSignals?.uaHash || null
      };
      await fetch(ENV_UPLOAD_ENDPOINT, {
        method: "POST",
        headers: { accept: "application/json", "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify(envPayload)
      }).catch(() => {});
    } catch (err) {
      console.warn("[AutoForm] env upload failed", err);
    }
  }

  const throttleMode = (() => {
    if (!IS_FREE_EDITION) return "unlimited";
    if (serverQuota?.mode === "blocked") return "blocked";
    const remaining = Number(serverQuota?.remaining);
    if (Number.isFinite(remaining) && remaining <= 0) return "blocked";
    return "priority";
  })();

  return { items, durationMs, throttleMode, quota: serverQuota, planStatus };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message?.type) return;

  if (message.type === "autoform_record_fill_result") {
    if (message?.payload && typeof message.payload === "object") {
      recordLastFillResult({ ...message.payload, timestamp: message.payload.timestamp || Date.now() });
      sendResponse?.({ ok: true });
    } else {
      sendResponse?.({ ok: false, error: "invalid_payload" });
    }
    return;
  }

  if (message.type === "autoform_get_last_fill_result") {
    ensureLastFillResultLoaded()
      .then((result) => sendResponse?.({ result: result || null }))
      .catch(() => sendResponse?.({ result: null }));
    return true;
  }

  if (message.type === "autoform_refresh_runtime_config") {
    refreshRuntimeConfigFromServer({ reason: message.reason })
      .then((config) =>
        resolveEffectiveEdition().then((effectiveEdition) => ({
          ok: true,
          config,
          quota: config?.quota || null,
          edition: effectiveEdition
        }))
      )
      .then((payload) => sendResponse(payload))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error?.message || "config_refresh_failed"
        })
      );
    return true;
  }

  if (message.type === "autoform_get_quota_state") {
    ensureRuntimeConfigReady()
      .then(() => Promise.all([resolveCurrentQuotaSnapshot(), resolveEffectiveEdition()]))
      .then(([quota, effectiveEdition]) => {
        sendResponse?.({
          quota,
          edition: effectiveEdition
        });
      })
      .catch((error) => sendResponse({ error: error?.message || "config_failed" }));
    return true;
  }

  if (message.type === "autoform_fetch_form_items") {
    const originTabId = sender?.tab?.id;
    fetchFormItems(message.payload, originTabId)
      .then((result) =>
        sendResponse({
          items: result.items,
          durationMs: result.durationMs,
          throttleMode: result.throttleMode,
          quota: result.quota,
          planStatus: result.planStatus || null
        })
      )
      .catch((err) =>
        sendResponse({
          error: err?.message || "APIエラー",
          quota: err?.quota || null,
          code: err?.code || null,
          planStatus: err?.planStatus || null
        })
      );
    return true;
  }

  if (message.type === "autoform_open_unlimited_cta") {
    const targetUrl =
      (typeof message?.url === "string" && message.url.trim()) || AIMSALES_SIGNUP_URL;
    if (!targetUrl || !chrome?.tabs?.create) {
      sendResponse?.({ ok: false, error: "tabs_api_unavailable" });
      return;
    }
    chrome.tabs.create({ url: targetUrl, active: true }, () => {
      if (chrome.runtime?.lastError) {
        sendResponse?.({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      sendResponse?.({ ok: true });
    });
    return true;
  }

  if (message.type === "autoform_report_input_count") {
    const tabId = sender?.tab?.id;
    const frameId = typeof sender?.frameId === "number" ? sender.frameId : 0;
    if (typeof tabId === "number") {
      const count = Number(message?.payload?.count);
      recordFrameInputCount(tabId, frameId, count);
    }
    sendResponse?.({ ok: true });
    return;
  }

  if (message.type === "autoform_get_cached_input_count") {
    const requestedTabId =
      typeof message?.tabId === "number" ? message.tabId : sender?.tab?.id;
    if (typeof requestedTabId !== "number") {
      sendResponse?.({ count: null, updatedAt: null });
      return;
    }
    const record = tabInputCounts.get(requestedTabId) || null;
    sendResponse?.({
      count: typeof record?.count === "number" ? record.count : null,
      updatedAt: typeof record?.updatedAt === "number" ? record.updatedAt : null
    });
    return;
  }

  if (message.type === "autoform_enable_always_on") {
    registerAlwaysOnContentScript()
      .then((ok) => sendResponse({ ok }))
      .catch((error) => sendResponse({ error: error?.message || "failed" }));
    return true;
  }

});

if (chrome?.webNavigation?.onCommitted) {
  chrome.webNavigation.onCommitted.addListener((details) => {
    if (details.frameId === 0) {
      recordTabUrl(details.tabId, details.url);
      frameInputCounts.delete(details.tabId);
      updateBadgeCount(details.tabId, null);
      (async () => {
        try {
          await ensureContentScriptForTab(details.tabId, details.url);
        } catch (_) {
          // ignore
        }
        await requestInputCountForTab(details.tabId);
      })();
    }
  });
}

if (chrome?.tabs?.onUpdated) {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === "complete") {
      (async () => {
        try {
          await ensureContentScriptForTab(tabId, tab?.url);
        } catch (_) {
          // ignore
        }
        await requestInputCountForTab(tabId);
      })();
    }
  });
}

if (chrome?.tabs?.onRemoved) {
  chrome.tabs.onRemoved.addListener((tabId) => {
    recordTabUrl(tabId, null);
    lastHtmlByTab.delete(tabId);
    frameInputCounts.delete(tabId);
    updateBadgeCount(tabId, null);
  });
}

const MIRRORED_SYNC_KEYS = new Set([MASTER_STORAGE_KEY, AUTO_RUN_STORAGE_KEY]);

chrome.storage?.onChanged?.addListener((changes, area) => {
  if (area !== "sync" || !chrome?.storage?.local) return;
  const payload = {};
  const removals = [];
  MIRRORED_SYNC_KEYS.forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(changes, key)) return;
    const nextValue = changes[key]?.newValue;
    if (typeof nextValue === "undefined") {
      removals.push(key);
    } else {
      payload[key] = nextValue;
    }
  });
  if (Object.keys(payload).length) {
    try {
      chrome.storage.local.set(payload, () => void chrome.runtime?.lastError);
    } catch (_) {
      // ignore local storage errors
    }
  }
  if (removals.length) {
    try {
      chrome.storage.local.remove(removals, () => void chrome.runtime?.lastError);
    } catch (_) {
      // ignore local storage errors
    }
  }
});

setInterval(() => {
  const now = Date.now();
  for (const [tabId, info] of lastHtmlByTab.entries()) {
    if (!info || now - info.requestedAt > ANALYSIS_TTL_MS) {
      lastHtmlByTab.delete(tabId);
    }
  }
}, 30 * 1000);
