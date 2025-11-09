const FORM_ITEMS_ENDPOINT =
  "https://autoform-chrome-extention-server-csasaeerewb7b9ga.japaneast-01.azurewebsites.net/chrome_extension/form_items";
const SEND_STORAGE_KEY = "autoformSendContent";
const DEFAULT_EMAIL = "y.abe@lassic.co.jp";
const MAX_CURL_LOGS = 20;
const BADGE_BG_COLOR = "#2563eb";
const BADGE_TEXT_COLOR = "#ffffff";

let lastApiLog = null;
let trackedEmail = null;
let detectedCurlLogs = [];
const pendingCurlRequests = new Map();
const seenCurlSignatures = new Set();
const frameInputCounts = new Map();
const tabLastCommittedUrls = new Map();

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

function bodyContainsTrackedEmail(body) {
  if (!body || !trackedEmail) return false;
  const email = trackedEmail.trim();
  if (!email) return false;
  const encoded = encodeURIComponent(email);
  const lowerBody = body.toLowerCase();
  return lowerBody.includes(email.toLowerCase()) || lowerBody.includes(encoded.toLowerCase());
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
  return `${method}::${url}::${body}`;
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

function refreshTrackedEmail() {
  if (!chrome?.storage?.local) {
    trackedEmail = null;
    return;
  }
  chrome.storage.local.get(SEND_STORAGE_KEY, (res) => {
    const storedEmail = res?.[SEND_STORAGE_KEY]?.email;
    let nextEmail = null;
    if (typeof storedEmail === "string" && storedEmail.trim()) {
      nextEmail = storedEmail.trim();
    } else if (storedEmail == null && DEFAULT_EMAIL) {
      nextEmail = DEFAULT_EMAIL;
    }
    trackedEmail = typeof nextEmail === "string" && nextEmail.trim() ? nextEmail.trim() : null;
  });
}

function handleBeforeRequest(details) {
  if (
    !trackedEmail ||
    !details ||
    !details.requestId ||
    (typeof details.tabId === "number" && details.tabId < 0)
  ) {
    return;
  }
  if (pendingCurlRequests.has(details.requestId)) {
    return;
  }
  const body = extractRequestBody(details);
  if (!bodyContainsTrackedEmail(body)) {
    return;
  }
  const tabUrl =
    typeof details.tabId === "number" && tabLastCommittedUrls.has(details.tabId)
      ? tabLastCommittedUrls.get(details.tabId)
      : null;
  const fallbackSource = details.documentUrl || details.initiator || null;
  pendingCurlRequests.set(details.requestId, {
    method: details.method || "GET",
    url: details.url,
    body,
    email: trackedEmail,
    sourceUrl: tabUrl || fallbackSource
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
    let nextEmail = null;
    if (newValue && typeof newValue.email === "string" && newValue.email.trim()) {
      nextEmail = newValue.email.trim();
    } else if (!newValue && DEFAULT_EMAIL) {
      nextEmail = DEFAULT_EMAIL;
    }
    trackedEmail = typeof nextEmail === "string" && nextEmail.trim() ? nextEmail.trim() : null;
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

if (chrome?.tabs?.onRemoved) {
  chrome.tabs.onRemoved.addListener((tabId) => {
    recordTabUrl(tabId, null);
    clearTabBadge(tabId);
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

async function fetchFormItems(payload) {
  const { html, sendRecord, pageUrl } = payload || {};
  if (!html || !sendRecord) {
    throw new Error("html と send_record が必要です");
  }

  const htmlPreview = createHtmlPreview(html);
  const logEntry = {
    timestamp: Date.now(),
    request: {
      send_record: sendRecord,
      html_preview: htmlPreview.preview,
      html_length: htmlPreview.length,
      html_truncated: htmlPreview.truncated,
      page_url: pageUrl || null
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
      page_url: pageUrl || null
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
    fetchFormItems(message.payload)
      .then((result) => sendResponse({ items: result.items, durationMs: result.durationMs }))
      .catch((err) => {
        console.error("[AutoForm] API fetch error", err);
        sendResponse({ error: err?.message || "APIエラー" });
      });
    return true;
  }

  if (message.type === "autoform_get_last_api_log") {
    sendResponse({ log: lastApiLog });
  }

  if (message.type === "autoform_get_detected_curl_logs") {
    sendResponse({ logs: detectedCurlLogs });
  }
});

setTimeout(requestCountsForAllTabs, 500);
