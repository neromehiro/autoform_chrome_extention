const FORM_ITEMS_ENDPOINT =
  "https://autoform-chrome-extention-server-csasaeerewb7b9ga.japaneast-01.azurewebsites.net/chrome_extension/form_items";
const SEND_STORAGE_KEY = "autoformSendContent";
const MAX_CURL_LOGS = 20;
const BADGE_BG_COLOR = "#2563eb";
const BADGE_TEXT_COLOR = "#ffffff";
const STORAGE_SYNC_KEYS = ["autoformEnabled", "autoformAutoRunOnOpen", "autoformShowFloatingButton", "autoformShowAutoButton"];
const STORAGE_LOCAL_KEYS = null; // すべての local storage を取得
const INSTALL_ID_STORAGE_KEY = "autoformInstallId";

let lastApiLog = null;
let trackedEmail = null;
let detectedCurlLogs = [];
const pendingCurlRequests = new Map();
const seenCurlSignatures = new Set();
const frameInputCounts = new Map();
const tabLastCommittedUrls = new Map();
let lastUserInfoSnapshot = null;

function resolveTrackedEmailCandidate(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || !trimmed.includes("@")) {
    return null;
  }
  return trimmed;
}

function setBadgeBackgroundDefaults() {
  if (chrome?.action?.setBadgeBackgroundColor) {
    chrome.action.setBadgeBackgroundColor({ color: BADGE_BG_COLOR });
  }
  if (chrome?.action?.setBadgeTextColor) {
    chrome.action.setBadgeTextColor({ color: BADGE_TEXT_COLOR });
  }
}

setBadgeBackgroundDefaults();
bootstrapTabUrls();

function normalizeCount(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.min(9999, Math.floor(value));
}

function applyBadgeText(tabId, count) {
  if (!chrome?.action?.setBadgeText || typeof tabId !== "number") return;
  let text = "";
  if (count > 0) {
    const raw = count > 999 ? "999+" : String(count);
    text = raw.length === 1 ? ` ${raw}` : raw;
  }
  chrome.action.setBadgeText({ tabId, text });
}

function updateBadgeForTab(tabId) {
  const frames = frameInputCounts.get(tabId);
  if (!frames || frames.size === 0) {
    frameInputCounts.delete(tabId);
    applyBadgeText(tabId, 0);
    return;
  }
  let total = 0;
  frames.forEach((value) => {
    total += value;
  });
  applyBadgeText(tabId, total);
}

function recordFrameInputCount(tabId, frameId, count) {
  if (typeof tabId !== "number" || typeof frameId !== "number") return;
  const normalized = normalizeCount(count);
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
  updateBadgeForTab(tabId);
}

function clearTabBadge(tabId) {
  if (typeof tabId !== "number") return;
  frameInputCounts.delete(tabId);
  applyBadgeText(tabId, 0);
}

function clearFrameCount(tabId, frameId) {
  if (typeof tabId !== "number") return;
  const frames = frameInputCounts.get(tabId);
  if (!frames) return;
  frames.delete(frameId);
  if (frames.size === 0) {
    frameInputCounts.delete(tabId);
  }
  updateBadgeForTab(tabId);
}

function shouldMessageTab(tab) {
  if (!tab || typeof tab.id !== "number" || tab.id < 0) return false;
  const url = typeof tab.url === "string" ? tab.url : "";
  if (!url) return true;
  const normalized = url.toLowerCase();
  return !(
    normalized.startsWith("chrome://") ||
    normalized.startsWith("edge://") ||
    normalized.startsWith("about:") ||
    normalized.startsWith("devtools://") ||
    normalized.startsWith("chrome-extension://")
  );
}

function getFramesForTab(tabId) {
  return new Promise((resolve) => {
    if (!chrome?.webNavigation?.getAllFrames) {
      resolve([{ frameId: 0 }]);
      return;
    }
    chrome.webNavigation.getAllFrames({ tabId }, (frames) => {
      if (chrome.runtime.lastError || !Array.isArray(frames) || frames.length === 0) {
        resolve([{ frameId: 0 }]);
        return;
      }
      resolve(frames);
    });
  });
}

function requestCountFromFrame(tabId, frameId) {
  if (!chrome?.tabs?.sendMessage) return;
  chrome.tabs.sendMessage(
    tabId,
    { type: "autoform_request_input_count" },
    { frameId },
    (response) => {
      if (chrome.runtime.lastError) {
        return;
      }
      const count = Number(response?.count);
      if (Number.isFinite(count)) {
        recordFrameInputCount(tabId, frameId, count);
      }
    }
  );
}

async function requestCountsForTab(tabId) {
  if (typeof tabId !== "number" || tabId < 0) return;
  const frames = await getFramesForTab(tabId).catch(() => [{ frameId: 0 }]);
  frames.forEach((frame) => {
    const frameId = typeof frame?.frameId === "number" ? frame.frameId : 0;
    requestCountFromFrame(tabId, frameId);
  });
}

function requestCountsForAllTabs() {
  if (!chrome?.tabs?.query) return;
  chrome.tabs.query({}, (tabs) => {
    if (!Array.isArray(tabs)) return;
    tabs.forEach((tab) => {
      if (!shouldMessageTab(tab)) return;
      requestCountsForTab(tab.id);
    });
  });
}

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

async function getPlatformInfoSafe() {
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

async function getBrowserInfoSafe() {
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

async function getPermissionsInfoSafe() {
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

async function getProfileInfoSafe() {
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
  const platformPromise = getPlatformInfoSafe();
  const manifest = chrome?.runtime?.getManifest ? chrome.runtime.getManifest() : null;
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
    systemSignals = await gatherSystemSignals({
      nonce: reason || "user_info_snapshot",
      platformInfo
    });
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
          if (chrome.runtime?.lastError) {
            resolve(generated);
            return;
          }
          resolve(generated);
        });
      });
    } catch (_) {
      resolve(null);
    }
  });
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

const hasPerformance = typeof performance !== "undefined" && typeof performance.now === "function";
const nowFn = hasPerformance ? () => performance.now() : () => Date.now();

function escapeSingleQuotes(str) {
  if (typeof str !== "string") return "";
  return str.replace(/'/g, "'\"'\"'");
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
      const chunks = requestBody.raw
        .filter((part) => part?.bytes)
        .map((part) => decoder.decode(part.bytes));
      return chunks.join("");
    } catch (_) {
      return "";
    }
  }
  return "";
}

function bodyContainsTrackedEmail(body, emailValue = trackedEmail) {
  if (!body || !emailValue) return false;
  const email = emailValue.trim();
  if (!email) return false;
  const encoded = encodeURIComponent(email).toLowerCase();
  const lowerBody = body.toLowerCase();
  const lowerEmail = email.toLowerCase();
  return lowerBody.includes(lowerEmail) || lowerBody.includes(encoded);
}

function buildCurlCommand(entry) {
  if (!entry) return "";
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
  const method = (entry?.method || "GET").toUpperCase();
  const url = entry?.url || "";
  const body = entry?.body || "";
  const uniqueToken =
    (entry && typeof entry.requestId === "string" && entry.requestId) ||
    (typeof entry?.startedAt === "number" ? String(entry.startedAt) : `${Date.now()}-${Math.random()}`);
  return `${method}::${url}::${body}::${uniqueToken}`;
}

function finalizeCurlLog(requestId, extra = {}) {
  const entry = pendingCurlRequests.get(requestId);
  if (!entry) return;
  pendingCurlRequests.delete(requestId);
  const curl = buildCurlCommand(entry);
  const signature = buildLogSignature(entry);
  if (seenCurlSignatures.has(signature)) {
    return;
  }
  const log = {
    timestamp: Date.now(),
    url: entry.url,
    method: entry.method,
    tabId: typeof entry.tabId === "number" ? entry.tabId : null,
    email: entry.email,
    sourceUrl: entry.sourceUrl || null,
    curl,
    statusCode: typeof extra.statusCode === "number" ? extra.statusCode : null,
    error: extra.error || null,
    requestBodyPreview: entry.body ? entry.body.slice(0, 2000) : "",
    request: {
      url: entry.url,
      method: entry.method,
      headers: Array.isArray(entry.headers) ? entry.headers : [],
      body: entry.body || ""
    },
    response: {
      statusCode: typeof extra.statusCode === "number" ? extra.statusCode : null,
      error: extra.error || null,
      headers: Array.isArray(entry.responseHeaders) ? entry.responseHeaders : []
    },
    signature
  };
  detectedCurlLogs.unshift(log);
  seenCurlSignatures.add(signature);
  if (detectedCurlLogs.length > MAX_CURL_LOGS) {
    const removed = detectedCurlLogs.splice(MAX_CURL_LOGS);
    removed.forEach((item) => {
      if (item?.signature) {
        seenCurlSignatures.delete(item.signature);
      }
    });
  }
}

function purgePendingRequestsForTab(tabId) {
  if (typeof tabId !== "number") return;
  for (const [requestId, entry] of pendingCurlRequests.entries()) {
    if (entry?.tabId === tabId) {
      pendingCurlRequests.delete(requestId);
    }
  }
}

function refreshTrackedEmail(callback) {
  const safeCallback = typeof callback === "function" ? callback : null;
  if (!chrome?.storage?.local) {
    trackedEmail = null;
    if (safeCallback) {
      safeCallback(null);
    }
    return;
  }
  chrome.storage.local.get(SEND_STORAGE_KEY, (res) => {
    if (chrome.runtime?.lastError) {
      if (safeCallback) {
        safeCallback(trackedEmail);
      }
      return;
    }
    const storedEmail = res?.[SEND_STORAGE_KEY]?.email;
    trackedEmail = resolveTrackedEmailCandidate(storedEmail);
    if (safeCallback) {
      safeCallback(trackedEmail);
    }
  });
}

function handleBeforeRequest(details) {
  if (!details || !details.requestId || typeof details.tabId !== "number" || details.tabId < 0) {
    return;
  }
  const tryRecord = (emailValue) => {
    if (!emailValue || pendingCurlRequests.has(details.requestId)) {
      return;
    }
    const body = extractRequestBody(details);
    if (!bodyContainsTrackedEmail(body, emailValue)) {
      return;
    }
    const tabUrl =
      typeof details.tabId === "number" && tabLastCommittedUrls.has(details.tabId)
        ? tabLastCommittedUrls.get(details.tabId)
        : null;
    const fallbackSource = details.documentUrl || details.initiator || null;
    pendingCurlRequests.set(details.requestId, {
      requestId: details.requestId,
      method: details.method || "GET",
      url: details.url,
      body,
      email: emailValue,
      sourceUrl: tabUrl || fallbackSource,
      tabId: details.tabId,
      startedAt: Date.now()
    });
  };

  if (trackedEmail) {
    tryRecord(trackedEmail);
    return;
  }
  refreshTrackedEmail((emailValue) => {
    tryRecord(emailValue);
  });
}

function handleBeforeSendHeaders(details) {
  if (!details?.requestId) return;
  const entry = pendingCurlRequests.get(details.requestId);
  if (!entry) return;
  entry.headers = details.requestHeaders || [];
}

function handleHeadersReceived(details) {
  if (!details?.requestId) return;
  const entry = pendingCurlRequests.get(details.requestId);
  if (!entry) return;
  entry.responseHeaders = details.responseHeaders || [];
}

function handleCompleted(details) {
  if (!details?.requestId) return;
  finalizeCurlLog(details.requestId, { statusCode: details.statusCode });
}

function handleError(details) {
  if (!details?.requestId) return;
  finalizeCurlLog(details.requestId, { error: details.error || "request_error" });
}

if (chrome?.storage?.local) {
  refreshTrackedEmail();
}

if (chrome?.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[SEND_STORAGE_KEY]) return;
    const newValue = changes[SEND_STORAGE_KEY]?.newValue;
    trackedEmail = resolveTrackedEmailCandidate(newValue?.email);
  });
}

if (chrome?.webRequest) {
  const filter = { urls: ["<all_urls>"] };
  chrome.webRequest.onBeforeRequest.addListener(handleBeforeRequest, filter, ["requestBody"]);
  chrome.webRequest.onBeforeSendHeaders.addListener(handleBeforeSendHeaders, filter, ["requestHeaders", "extraHeaders"]);
  chrome.webRequest.onHeadersReceived.addListener(handleHeadersReceived, filter, ["responseHeaders", "extraHeaders"]);
  chrome.webRequest.onCompleted.addListener(handleCompleted, filter);
  chrome.webRequest.onErrorOccurred.addListener(handleError, filter);
}

if (chrome?.webNavigation?.onCommitted) {
  chrome.webNavigation.onCommitted.addListener((details) => {
    if (details.frameId === 0) {
      recordTabUrl(details.tabId, details.url);
      clearTabBadge(details.tabId);
    } else {
      clearFrameCount(details.tabId, details.frameId);
    }
  });
}

// Safety net to purge stale pending requests left behind after navigation
const PENDING_TTL_MS = 2 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [requestId, entry] of pendingCurlRequests.entries()) {
    const startedAt = typeof entry?.startedAt === "number" ? entry.startedAt : 0;
    if (startedAt && now - startedAt > PENDING_TTL_MS) {
      pendingCurlRequests.delete(requestId);
    }
  }
}, 60 * 1000);

if (chrome?.tabs?.onRemoved) {
  chrome.tabs.onRemoved.addListener((tabId) => {
    recordTabUrl(tabId, null);
    clearTabBadge(tabId);
    purgePendingRequestsForTab(tabId);
  });
}

if (chrome?.tabs?.onActivated) {
  chrome.tabs.onActivated.addListener(({ tabId }) => {
    requestCountsForTab(tabId);
  });
}

if (chrome?.tabs?.onUpdated) {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === "complete" && shouldMessageTab(tab)) {
      requestCountsForTab(tabId);
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
    console.warn("[AutoForm] ユーザー情報の取得に失敗しました", err);
    userInfoDetails = lastUserInfoSnapshot || null;
  }

  const htmlPreview = createHtmlPreview(html);
  const logEntry = {
    timestamp: Date.now(),
    request: {
      send_record: sendRecord,
      html_preview: htmlPreview.preview,
      html_length: htmlPreview.length,
      html_truncated: htmlPreview.truncated,
      page_url: pageUrl || null,
      user_info: userInfoDetails
    },
    response: null,
    error: null,
    duration_ms: null
  };

  function finalize(result, durationMs, error) {
    if (typeof durationMs === "number") {
      logEntry.duration_ms = durationMs;
      if (logEntry.response) {
        logEntry.response.duration_ms = durationMs;
      }
    }
    if (error) {
      logEntry.error = error;
    }
    const tabId = typeof originTabId === "number" ? originTabId : null;
    if (tabId !== null) {
      logEntry.tabId = tabId;
    }
    lastApiLog = logEntry;
    if (error) {
      throw new Error(error);
    }
    return result;
  }

  const startedAt = nowFn();
  let response;
  try {
    const requestBody = {
      send_record: sendRecord,
      html,
      page_url: pageUrl || null,
      user_info: userInfoDetails || null
    };
    response = await fetch(FORM_ITEMS_ENDPOINT, {
      method: "POST",
      headers: {
        accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody)
    });
  } catch (err) {
    const durationMs = nowFn() - startedAt;
    return finalize(null, durationMs, `APIリクエストに失敗しました: ${err?.message || err}`);
  }

  const text = await response.text().catch(() => "");
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (_) {
    const durationMs = nowFn() - startedAt;
    logEntry.response = { status: response.status, body: text };
    return finalize(null, durationMs, "APIレスポンスの解析に失敗しました");
  }

  logEntry.response = {
    status: response.status,
    ok: response.ok,
    body: data
  };

  const durationMs = nowFn() - startedAt;

  if (!response.ok) {
    const message = `APIエラー: ${response.status} ${text || response.statusText}`.trim();
    return finalize(null, durationMs, message);
  }

  const items = Array.isArray(data?.form_items)
    ? data.form_items
    : Array.isArray(data)
      ? data
      : [];
  logEntry.items_count = items.length;
  return finalize({ items, durationMs }, durationMs, null);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message?.type) return;

  if (message.type === "autoform_report_input_count") {
    const tabId = sender?.tab?.id;
    const frameId = sender && typeof sender.frameId === "number" ? sender.frameId : 0;
    if (typeof tabId === "number") {
      recordFrameInputCount(tabId, frameId, Number(message.payload?.count));
    }
    sendResponse({ ok: true });
    return;
  }

  if (message.type === "autoform_fetch_form_items") {
    const originTabId = sender?.tab?.id;
    fetchFormItems(message.payload, originTabId)
      .then((result) => sendResponse({ items: result.items, durationMs: result.durationMs }))
      .catch((err) => {
        console.error("[AutoForm] API fetch error", err);
        sendResponse({ error: err?.message || "APIエラー" });
      });
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
        console.error("[AutoForm] Failed to gather user info", err);
        sendResponse({
          error: err?.message || "ユーザー情報の取得に失敗しました",
          userInfo: lastUserInfoSnapshot || null
        });
    });
    return true;
  }

  if (message.type === "get_system_signals") {
    const nonce = typeof message.nonce === "string" ? message.nonce : "";
    gatherSystemSignals({ nonce })
      .then((signals) => {
        sendResponse(signals || null);
      })
      .catch((err) => {
        console.error("[AutoForm] Failed to gather system signals", err);
        sendResponse({ error: err?.message || "system_signals_failed" });
      });
    return true;
  }

  if (message.type === "autoform_reset_debug_data") {
    detectedCurlLogs = [];
    seenCurlSignatures.clear();
    pendingCurlRequests.clear();
    lastApiLog = null;
    sendResponse({ ok: true });
    return;
  }
});

setTimeout(requestCountsForAllTabs, 500);
