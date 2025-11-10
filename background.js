const FORM_ITEMS_ENDPOINT =
  "https://autoform-chrome-extention-server-csasaeerewb7b9ga.japaneast-01.azurewebsites.net/chrome_extension/form_items";
const RECORDS_ENDPOINT =
  "https://autoform-chrome-extention-server-csasaeerewb7b9ga.japaneast-01.azurewebsites.net/chrome_extension/records";
const ENV_UPLOAD_ENDPOINT =
  "https://autoform-chrome-extention-server-csasaeerewb7b9ga.japaneast-01.azurewebsites.net/chrome_extension/env";
const SEND_STORAGE_KEY = "autoformSendContent";
const STORAGE_SYNC_KEYS = [
  "autoformEnabled",
  "autoformAutoRunOnOpen",
  "autoformShowFloatingButton",
  "autoformShowAutoButton"
];
const STORAGE_LOCAL_KEYS = null;
const INSTALL_ID_STORAGE_KEY = "autoformInstallId";
const MAX_CURL_LOGS = 20;
const ANALYSIS_TTL_MS = 2 * 60 * 1000;
const PENDING_TTL_MS = 2 * 60 * 1000;
const TEMPLATE_ENV_TTL_MS = 5 * 60 * 1000;
const BADGE_BG_COLOR = "#2563eb";
const BADGE_TEXT_COLOR = "#ffffff";

let lastApiLog = null;
let lastUserInfoSnapshot = null;
let trackedEmail = null;

const detectedCurlLogs = [];
const pendingCurlRequests = new Map();
const seenCurlSignatures = new Set();
const lastHtmlByTab = new Map();
const tabLastCommittedUrls = new Map();
const tabInputCounts = new Map();
const frameInputCounts = new Map();
const templateBrowserEnvByTab = new Map();

bootstrapTabUrls();
setBadgeBackgroundDefaults();
refreshTrackedEmail();

function resolveTrackedEmailCandidate(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || !trimmed.includes("@")) {
    return null;
  }
  return trimmed;
}

function recordTabUrl(tabId, url) {
  if (typeof tabId !== "number") return;
  if (typeof url === "string" && url.trim()) {
    tabLastCommittedUrls.set(tabId, url);
  } else {
    tabLastCommittedUrls.delete(tabId);
  }
}

function isChromeExtensionUrl(url) {
  return typeof url === "string" && url.startsWith("chrome-extension://");
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
  if (typeof count === "number" && count > 0) {
    tabInputCounts.set(tabId, count);
  } else {
    tabInputCounts.delete(tabId);
  }
  applyBadgeText(tabId, count);
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

function collectBrowserEnvFromTab(tabId) {
  return new Promise((resolve) => {
    if (!chrome?.tabs?.sendMessage || typeof tabId !== "number") {
      resolve(null);
      return;
    }
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    }, 400);
    try {
      chrome.tabs.sendMessage(tabId, { type: "autoform_collect_browser_env" }, (response) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        if (chrome.runtime?.lastError) {
          resolve(null);
          return;
        }
        resolve(response?.env || null);
      });
    } catch (_) {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(null);
      }
    }
  });
}

function getTemplateBrowserEnv(tabId) {
  if (typeof tabId !== "number") return null;
  const entry = templateBrowserEnvByTab.get(tabId);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > TEMPLATE_ENV_TTL_MS) {
    templateBrowserEnvByTab.delete(tabId);
    return null;
  }
  return entry.data || null;
}

async function resolveBrowserEnvForTab(tabId) {
  if (typeof tabId !== "number") return null;
  const templateEnv = getTemplateBrowserEnv(tabId);
  if (templateEnv) {
    return templateEnv;
  }
  return collectBrowserEnvFromTab(tabId);
}

function nowMs() {
  const hasPerformance = typeof performance !== "undefined" && typeof performance.now === "function";
  return hasPerformance ? performance.now() : Date.now();
}

function escapeSingleQuotes(str) {
  return String(str ?? "").replace(/'/g, "'\"'\"'");
}

function extractRequestBody(details) {
  const requestBody = details?.requestBody;
  if (!requestBody) return "";
  if (requestBody.formData) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(requestBody.formData)) {
      if (Array.isArray(value)) {
        value.forEach((v) => params.append(key, v));
      } else if (value != null) {
        params.append(key, value);
      }
    }
    return params.toString();
  }
  if (Array.isArray(requestBody.raw) && requestBody.raw.length) {
    try {
      const decoder = new TextDecoder("utf-8");
      return requestBody.raw
        .filter((part) => part?.bytes)
        .map((part) => decoder.decode(part.bytes))
        .join("");
    } catch (_) {
      return "";
    }
  }
  return "";
}

function buildCurlCommand(entry) {
  const method = (entry.method || "GET").toUpperCase();
  const headerLines = (entry.headers || [])
    .filter((h) => h && typeof h.name === "string" && typeof h.value === "string")
    .map((h) => `  -H '${h.name}: ${escapeSingleQuotes(h.value)}'`)
    .join(" \\\n");

  let cmd = `curl '${entry.url}'`;
  if (method !== "GET") {
    cmd += ` \\\n  -X ${method}`;
  }
  if (headerLines) {
    cmd += ` \\\n${headerLines}`;
  }
  if (entry.body) {
    cmd += ` \\\n  --data-raw '${escapeSingleQuotes(entry.body)}'`;
  }
  return cmd;
}

function buildLogSignature(entry) {
  const unique = entry.requestId || `${Date.now()}-${Math.random()}`;
  return `${(entry.method || "GET").toUpperCase()}::${entry.url}::${entry.body || ""}::${unique}`;
}

function bodyContainsEmail(body, preferredEmail) {
  if (typeof body !== "string" || !body) {
    return false;
  }
  const normalizedBody = body.toLowerCase();
  if (preferredEmail) {
    const email = preferredEmail.toLowerCase();
    if (normalizedBody.includes(email)) {
      return true;
    }
    const encoded = encodeURIComponent(preferredEmail).toLowerCase();
    if (normalizedBody.includes(encoded)) {
      return true;
    }
  }
  return /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(body);
}

async function sha256Hex(input) {
  try {
    if (!globalThis.crypto?.subtle) {
      throw new Error("subtle_unavailable");
    }
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

function createHtmlPreview(html) {
  if (typeof html !== "string") {
    return { preview: "", length: 0, truncated: false };
  }
  const limit = 2000;
  if (html.length <= limit) {
    return { preview: html, length: html.length, truncated: false };
  }
  return {
    preview: `${html.slice(0, limit)}...`,
    length: html.length,
    truncated: true
  };
}

async function getStorageSnapshot(areaName, keys = null) {
  const storageArea = chrome?.storage?.[areaName];
  if (!storageArea) {
    return { available: false, data: null, keys: [], bytesInUse: null, error: "unavailable" };
  }
  const { value, error } = await new Promise((resolve) => {
    try {
      storageArea.get(keys, (items) => {
        if (chrome.runtime?.lastError) {
          resolve({ value: {}, error: chrome.runtime.lastError.message });
          return;
        }
        resolve({ value: items || {}, error: null });
      });
    } catch (err) {
      resolve({ value: {}, error: err?.message || "unknown_error" });
    }
  });
  const bytesInUse =
    typeof storageArea.getBytesInUse === "function"
      ? await new Promise((resolve) => {
          try {
            storageArea.getBytesInUse(keys, (bytes) => {
              if (chrome.runtime?.lastError) {
                resolve(null);
                return;
              }
              resolve(typeof bytes === "number" ? bytes : null);
            });
          } catch (_) {
            resolve(null);
          }
        })
      : null;
  const dataObject = value && typeof value === "object" ? value : {};
  return {
    available: true,
    data: dataObject,
    keys: Object.keys(dataObject),
    bytesInUse,
    error
  };
}

function getPlatformInfoSafe() {
  return new Promise((resolve) => {
    if (!chrome?.runtime?.getPlatformInfo) {
      resolve(null);
      return;
    }
    try {
      chrome.runtime.getPlatformInfo((info) => {
        if (chrome.runtime?.lastError) {
          resolve({ error: chrome.runtime.lastError.message });
          return;
        }
        resolve(info || null);
      });
    } catch (err) {
      resolve({ error: err?.message || "platform_info_failed" });
    }
  });
}

function getBrowserInfoSafe() {
  return new Promise((resolve) => {
    if (!chrome?.runtime?.getBrowserInfo) {
      resolve(null);
      return;
    }
    try {
      chrome.runtime.getBrowserInfo((info) => {
        if (chrome.runtime?.lastError) {
          resolve({ error: chrome.runtime.lastError.message });
          return;
        }
        resolve(info || null);
      });
    } catch (err) {
      resolve({ error: err?.message || "browser_info_failed" });
    }
  });
}

function getPermissionsInfoSafe() {
  return new Promise((resolve) => {
    if (!chrome?.permissions?.getAll) {
      resolve(null);
      return;
    }
    try {
      chrome.permissions.getAll((info) => {
        if (chrome.runtime?.lastError) {
          resolve({ error: chrome.runtime.lastError.message });
          return;
        }
        resolve(info || null);
      });
    } catch (err) {
      resolve({ error: err?.message || "permissions_failed" });
    }
  });
}

function getProfileInfoSafe() {
  return new Promise((resolve) => {
    if (!chrome?.identity?.getProfileUserInfo) {
      resolve(null);
      return;
    }
    try {
      chrome.identity.getProfileUserInfo({ accountStatus: "ANY" }, (info) => {
        if (chrome.runtime?.lastError) {
          resolve({ error: chrome.runtime.lastError.message });
          return;
        }
        resolve(info || null);
      });
    } catch (err) {
      resolve({ error: err?.message || "profile_failed" });
    }
  });
}

function sanitizeManifest(manifest) {
  if (!manifest || typeof manifest !== "object") return null;
  const {
    name,
    short_name: shortName,
    description,
    version,
    version_name: versionName,
    manifest_version: manifestVersion,
    permissions,
    host_permissions: hostPermissions,
    optional_host_permissions: optionalHostPermissions
  } = manifest;
  return {
    name,
    shortName,
    description,
    version,
    versionName,
    manifestVersion,
    permissions,
    hostPermissions,
    optionalHostPermissions
  };
}

async function gatherUserInfoSnapshot(reason = null) {
  const manifest = chrome?.runtime?.getManifest ? chrome.runtime.getManifest() : null;
  const platformPromise = getPlatformInfoSafe();
  const [platformInfo, browserInfo, permissions, storageLocal, storageSync, profile] = await Promise.all([
    platformPromise,
    getBrowserInfoSafe(),
    getPermissionsInfoSafe(),
    getStorageSnapshot("local", STORAGE_LOCAL_KEYS),
    getStorageSnapshot("sync", STORAGE_SYNC_KEYS),
    getProfileInfoSafe()
  ]);
  let systemSignals = null;
  try {
    systemSignals = await gatherSystemSignals({ nonce: reason || "user_info_snapshot", platformInfo });
  } catch (_) {
    systemSignals = null;
  }
  return {
    timestamp: Date.now(),
    reason,
    runtime: {
      id: chrome?.runtime?.id || null,
      manifest: sanitizeManifest(manifest)
    },
    platformInfo,
    browserInfo,
    permissions,
    storage: {
      local: storageLocal,
      sync: storageSync
    },
    profile,
    systemSignals
  };
}

function getSystemCpuInfo() {
  return new Promise((resolve) => {
    if (!chrome?.system?.cpu?.getInfo) {
      resolve(null);
      return;
    }
    try {
      chrome.system.cpu.getInfo((info) => {
        if (chrome.runtime?.lastError) {
          resolve(null);
          return;
        }
        resolve(info || null);
      });
    } catch (_) {
      resolve(null);
    }
  });
}

function getSystemMemoryInfo() {
  return new Promise((resolve) => {
    if (!chrome?.system?.memory?.getInfo) {
      resolve(null);
      return;
    }
    try {
      chrome.system.memory.getInfo((info) => {
        if (chrome.runtime?.lastError) {
          resolve(null);
          return;
        }
        resolve(info || null);
      });
    } catch (_) {
      resolve(null);
    }
  });
}

function getSystemDisplayInfo() {
  return new Promise((resolve) => {
    if (!chrome?.system?.display?.getInfo) {
      resolve(null);
      return;
    }
    try {
      chrome.system.display.getInfo((info) => {
        if (chrome.runtime?.lastError) {
          resolve(null);
          return;
        }
        resolve(Array.isArray(info) ? info : null);
      });
    } catch (_) {
      resolve(null);
    }
  });
}

function getSystemStorageInfo() {
  return new Promise((resolve) => {
    if (!chrome?.system?.storage?.getInfo) {
      resolve(null);
      return;
    }
    try {
      chrome.system.storage.getInfo((info) => {
        if (chrome.runtime?.lastError) {
          resolve(null);
          return;
        }
        resolve(Array.isArray(info) ? info : null);
      });
    } catch (_) {
      resolve(null);
    }
  });
}

function hasEnterpriseHardwareInfo() {
  return new Promise((resolve) => {
    const api = chrome?.enterprise?.hardwarePlatform?.getHardwareInfo;
    if (!api) {
      resolve(false);
      return;
    }
    try {
      api.call(chrome.enterprise.hardwarePlatform, () => {
        if (chrome.runtime?.lastError) {
          resolve(false);
          return;
        }
        resolve(true);
      });
    } catch (_) {
      resolve(false);
    }
  });
}

function hasEnterpriseDeviceAttributes() {
  return new Promise((resolve) => {
    const api = chrome?.enterprise?.deviceAttributes?.getDeviceSerialNumber;
    if (!api) {
      resolve(false);
      return;
    }
    try {
      api.call(chrome.enterprise.deviceAttributes, () => {
        if (chrome.runtime?.lastError) {
          resolve(false);
          return;
        }
        resolve(true);
      });
    } catch (_) {
      resolve(false);
    }
  });
}

async function getOrCreateInstallId() {
  if (!chrome?.storage?.local) {
    return null;
  }
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
        chrome.storage.local.set({ [INSTALL_ID_STORAGE_KEY]: generated }, () => {
          resolve(generated);
        });
      });
    } catch (_) {
      resolve(null);
    }
  });
}

async function gatherSystemSignals({ nonce = "", platformInfo: presetPlatform = null } = {}) {
  const platformPromise = presetPlatform ? Promise.resolve(presetPlatform) : getPlatformInfoSafe();
  const [platformInfo, cpu, memory, displays, storageDevices, enterpriseHardware, enterpriseDeviceAttr] = await Promise.all([
    platformPromise,
    getSystemCpuInfo(),
    getSystemMemoryInfo(),
    getSystemDisplayInfo(),
    getSystemStorageInfo(),
    hasEnterpriseHardwareInfo(),
    hasEnterpriseDeviceAttributes()
  ]);
  const manifest = chrome?.runtime?.getManifest ? chrome.runtime.getManifest() : null;
  const extVersion = manifest?.version || null;
  const installId = await getOrCreateInstallId();
  const today = new Date().toISOString().slice(0, 10);
  const baseString = `${installId || "anonymous"}|${nonce || ""}|${today}`;
  const installEphemeral = await sha256Hex(baseString);
  return {
    extVersion,
    platform: platformInfo,
    cpu,
    memory,
    displays,
    storage: storageDevices,
    enterprise: {
      hasHardwareInfo: !!enterpriseHardware,
      hasDeviceAttr: !!enterpriseDeviceAttr
    },
    installEphemeral
  };
}

function refreshTrackedEmail() {
  if (!chrome?.storage?.local) {
    trackedEmail = null;
    return;
  }
  chrome.storage.local.get(SEND_STORAGE_KEY, (res) => {
    if (chrome.runtime?.lastError) {
      return;
    }
    const storedEmail = res?.[SEND_STORAGE_KEY]?.email;
    trackedEmail = resolveTrackedEmailCandidate(storedEmail);
  });
}

if (chrome?.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[SEND_STORAGE_KEY]) {
      const newValue = changes[SEND_STORAGE_KEY]?.newValue;
      trackedEmail = resolveTrackedEmailCandidate(newValue?.email);
    }
  });
}

async function fetchFormItems(payload, originTabId) {
  const { html, sendRecord, pageUrl } = payload || {};
  if (!html || !sendRecord) {
    throw new Error("html と send_record が必要です");
  }

  let userInfoDetails = null;
  try {
    userInfoDetails = await gatherUserInfoSnapshot("api_request");
    lastUserInfoSnapshot = userInfoDetails;
  } catch (err) {
    userInfoDetails = lastUserInfoSnapshot || null;
  }
  if (typeof originTabId === "number") {
    try {
      const browserEnv = await resolveBrowserEnvForTab(originTabId);
      if (browserEnv) {
        userInfoDetails = userInfoDetails || {};
        userInfoDetails.browser_env = browserEnv;
      }
    } catch (_) {
      // ignore env collection errors
    }
  }

  const analysisId =
    (globalThis.crypto?.randomUUID && crypto.randomUUID()) ||
    `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const htmlSha256 = await sha256Hex(html).catch(() => null);
  const htmlPreview = createHtmlPreview(html);

  const startedAt = nowMs();
  let response;
  let data = null;
  const requestPayload = {
    analysis_id: analysisId || undefined,
    html_sha256: htmlSha256 || undefined,
    send_record: sendRecord,
    html,
    page_url: pageUrl || undefined,
    user_info: userInfoDetails || {}
  };
  try {
    response = await fetch(FORM_ITEMS_ENDPOINT, {
      method: "POST",
      headers: {
        accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestPayload)
    });
  } catch (err) {
    throw new Error(`APIリクエストに失敗しました: ${err?.message || err}`);
  }

  const text = await response.text().catch(() => "");
  try {
    data = text ? JSON.parse(text) : {};
  } catch (_) {
    throw new Error("APIレスポンスの解析に失敗しました");
  }

  const items = Array.isArray(data?.form_items)
    ? data.form_items
    : Array.isArray(data)
      ? data
      : [];
  const durationMs = nowMs() - startedAt;

  lastApiLog = {
    timestamp: Date.now(),
    request: {
      analysis_id: analysisId,
      html_sha256: htmlSha256,
      send_record: sendRecord,
      html_preview: htmlPreview.preview,
      html_length: htmlPreview.length,
      html_truncated: htmlPreview.truncated,
      page_url: pageUrl || undefined,
      user_info: requestPayload.user_info
    },
    response: {
      status: response.status,
      ok: response.ok,
      body: data,
      duration_ms: durationMs
    },
    items_count: items.length
  };

  const htmlLogId = typeof data?.html_log_id === "string" && data.html_log_id.trim() ? data.html_log_id.trim() : null;

  if (typeof originTabId === "number") {
    lastHtmlByTab.set(originTabId, {
      analysisId,
      pageUrl: pageUrl || undefined,
      htmlSha256,
      htmlLength: html.length || 0,
      requestedAt: Date.now(),
      htmlLogId
    });
  }

  if (data?.env_token && originTabId != null) {
    try {
      const envToken = data.env_token;
      const analysisFromServer = data?.analysis_id || analysisId;
      const runtimeInfo = userInfoDetails || (await gatherUserInfoSnapshot("env_upload"));
      const browserEnv = await collectBrowserEnvFromTab(originTabId);
      const mergedInfo = Object.assign({}, runtimeInfo || {}, browserEnv ? { browser_env: browserEnv } : {});
      await fetch(ENV_UPLOAD_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          analysis_id: analysisFromServer,
          token: envToken,
          page_url: pageUrl || null,
          html_sha256: htmlSha256 || null,
          user_info: mergedInfo || {}
        })
      }).catch(() => {});
    } catch (err) {
      console.warn("[AutoForm] env upload failed", err);
    }
  }

  return { items, durationMs };
}

function handleBeforeRequest(details) {
  if (!details || !details.requestId || typeof details.tabId !== "number") {
    return;
  }
  const method = (details.method || "GET").toUpperCase();
  if (method !== "POST") {
    return;
  }
  const body = extractRequestBody(details);
  const sourceUrl =
    tabLastCommittedUrls.get(details.tabId) || details.documentUrl || details.initiator || null;
  pendingCurlRequests.set(details.requestId, {
    requestId: details.requestId,
    method,
    url: details.url,
    body,
    headers: [],
    tabId: details.tabId,
    sourceUrl,
    startedAt: Date.now()
  });
}

function handleBeforeSendHeaders(details) {
  if (!details?.requestId) return;
  const entry = pendingCurlRequests.get(details.requestId);
  if (!entry) return;
  entry.headers = details.requestHeaders || [];
}

async function sendRecordForCurl(entry, curl) {
  const analysis = lastHtmlByTab.get(entry.tabId);
  if (!analysis?.htmlLogId) {
    return;
  }
  let userInfo = null;
  try {
    userInfo = await gatherUserInfoSnapshot("curl_record");
    lastUserInfoSnapshot = userInfo;
  } catch (_) {
    userInfo = lastUserInfoSnapshot || null;
  }
  if (typeof entry.tabId === "number") {
    try {
      const browserEnv = await resolveBrowserEnvForTab(entry.tabId);
      if (browserEnv) {
        userInfo = userInfo || {};
        userInfo.browser_env = browserEnv;
      }
    } catch (_) {
      // ignore env collection errors
    }
  }
  const payload = {
    analysis_id: analysis?.analysisId || undefined,
    html_log_id: analysis?.htmlLogId || undefined,
    site_url:
      tabLastCommittedUrls.get(entry.tabId) || analysis?.pageUrl || entry.sourceUrl || undefined,
    curl: {
      raw: curl,
      method: entry.method,
      url: entry.url,
      status_code: typeof entry.statusCode === "number" ? entry.statusCode : undefined
    },
    html_request: analysis
      ? {
          analysis_id: analysis.analysisId,
          page_url: analysis.pageUrl,
          html_sha256: analysis.htmlSha256,
          html_length: analysis.htmlLength,
          requested_at: analysis.requestedAt
        }
      : undefined,
    user_info: userInfo || {}
  };
  try {
    await fetch(RECORDS_ENDPOINT, {
      method: "POST",
      headers: {
        accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      keepalive: true
    });
  } catch (_) {
    // network errors are ignored for now
  }
}

function finalizeCurlLog(requestId, extra = {}) {
  const entry = pendingCurlRequests.get(requestId);
  if (!entry) return;
  pendingCurlRequests.delete(requestId);
  entry.statusCode = typeof extra.statusCode === "number" ? extra.statusCode : null;
  entry.error = extra.error || null;

  if (isChromeExtensionUrl(entry.sourceUrl)) {
    return;
  }

  if (!bodyContainsEmail(entry.body, trackedEmail)) {
    return;
  }

  const curl = buildCurlCommand(entry);
  const signature = buildLogSignature(entry);
  if (seenCurlSignatures.has(signature)) {
    return;
  }
  seenCurlSignatures.add(signature);

  sendRecordForCurl(entry, curl);

  detectedCurlLogs.unshift({
    timestamp: Date.now(),
    url: entry.url,
    method: entry.method,
    statusCode: entry.statusCode,
    sourceUrl: entry.sourceUrl || null,
    curl,
    analysisId: lastHtmlByTab.get(entry.tabId)?.analysisId || null,
    tabId: entry.tabId
  });
  if (detectedCurlLogs.length > MAX_CURL_LOGS) {
    detectedCurlLogs.length = MAX_CURL_LOGS;
  }
}

if (chrome?.webRequest) {
  const filter = { urls: ["<all_urls>"] };
  chrome.webRequest.onBeforeRequest.addListener(handleBeforeRequest, filter, ["requestBody"]);
  chrome.webRequest.onBeforeSendHeaders.addListener(handleBeforeSendHeaders, filter, ["requestHeaders", "extraHeaders"]);
  chrome.webRequest.onCompleted.addListener((details) => {
    finalizeCurlLog(details.requestId, { statusCode: details.statusCode });
  }, filter);
  chrome.webRequest.onErrorOccurred.addListener((details) => {
    finalizeCurlLog(details.requestId, { error: details.error || "request_error" });
  }, filter);
}

if (chrome?.webNavigation?.onCommitted) {
  chrome.webNavigation.onCommitted.addListener((details) => {
    if (details.frameId === 0) {
      recordTabUrl(details.tabId, details.url);
      frameInputCounts.delete(details.tabId);
      updateBadgeCount(details.tabId, 0);
      templateBrowserEnvByTab.delete(details.tabId);
    }
  });
}

if (chrome?.tabs?.onRemoved) {
  chrome.tabs.onRemoved.addListener((tabId) => {
    recordTabUrl(tabId, null);
    lastHtmlByTab.delete(tabId);
    frameInputCounts.delete(tabId);
    updateBadgeCount(tabId, 0);
    templateBrowserEnvByTab.delete(tabId);
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message?.type) {
    return;
  }

  if (message.type === "autoform_fetch_form_items") {
    const originTabId = sender?.tab?.id;
    fetchFormItems(message.payload, originTabId)
      .then((result) => sendResponse({ items: result.items, durationMs: result.durationMs }))
      .catch((err) => sendResponse({ error: err?.message || "APIエラー" }));
    return true;
  }

  if (message.type === "autoform_get_last_api_log") {
    sendResponse({ log: lastApiLog });
    return;
  }

  if (message.type === "autoform_get_detected_curl_logs") {
    const requestedTabId = typeof message.tabId === "number" ? message.tabId : null;
    const logs =
      requestedTabId == null
        ? detectedCurlLogs.slice()
        : detectedCurlLogs.filter((log) => log?.tabId === requestedTabId);
    sendResponse({ logs });
    return;
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

  if (message.type === "autoform_page_env_report") {
    const tabId = sender?.tab?.id;
    if (typeof tabId === "number" && message?.payload) {
      templateBrowserEnvByTab.set(tabId, {
        data: message.payload,
        pageUrl: typeof message.pageUrl === "string" ? message.pageUrl : null,
        timestamp: Date.now()
      });
    }
    sendResponse?.({ ok: true });
    return;
  }

  if (message.type === "autoform_get_user_info_details") {
    const forceRefresh = message?.refresh === true || !lastUserInfoSnapshot;
    if (!forceRefresh && lastUserInfoSnapshot) {
      sendResponse({ userInfo: lastUserInfoSnapshot });
      return;
    }
    gatherUserInfoSnapshot(message?.reason || null)
      .then((snapshot) => {
        lastUserInfoSnapshot = snapshot;
        sendResponse({ userInfo: snapshot });
      })
      .catch((err) => {
        sendResponse({ error: err?.message || "ユーザー情報の取得に失敗しました", userInfo: lastUserInfoSnapshot || null });
      });
    return true;
  }

  if (message.type === "get_system_signals") {
    const nonce = typeof message.nonce === "string" ? message.nonce : "";
    gatherSystemSignals({ nonce })
      .then((signals) => sendResponse(signals || null))
      .catch((err) => sendResponse({ error: err?.message || "system_signals_failed" }));
    return true;
  }

  if (message.type === "autoform_reset_debug_data") {
    detectedCurlLogs.length = 0;
    seenCurlSignatures.clear();
    pendingCurlRequests.clear();
    lastHtmlByTab.clear();
    lastApiLog = null;
    sendResponse({ ok: true });
    return;
  }
});

setInterval(() => {
  const now = Date.now();
  for (const [requestId, entry] of pendingCurlRequests.entries()) {
    if (now - entry.startedAt > PENDING_TTL_MS) {
      pendingCurlRequests.delete(requestId);
    }
  }
  for (const [tabId, info] of lastHtmlByTab.entries()) {
    if (!info || now - info.requestedAt > ANALYSIS_TTL_MS) {
      lastHtmlByTab.delete(tabId);
    }
  }
  for (const [tabId, info] of templateBrowserEnvByTab.entries()) {
    if (!info || now - info.timestamp > TEMPLATE_ENV_TTL_MS) {
      templateBrowserEnvByTab.delete(tabId);
    }
  }
}, 30 * 1000);
