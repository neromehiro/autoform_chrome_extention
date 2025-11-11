const FORM_ITEMS_ENDPOINT =
  "https://autoform-chrome-extention-server-csasaeerewb7b9ga.japaneast-01.azurewebsites.net/chrome_extension/form_items";
const ENV_UPLOAD_ENDPOINT =
  "https://autoform-chrome-extention-server-csasaeerewb7b9ga.japaneast-01.azurewebsites.net/chrome_extension/env";
const INSTALL_ID_STORAGE_KEY = "autoformInstallId";
const ANALYSIS_TTL_MS = 2 * 60 * 1000;
const BADGE_BG_COLOR = "#2563eb";
const BADGE_TEXT_COLOR = "#ffffff";
const lastHtmlByTab = new Map();
const tabLastCommittedUrls = new Map();
const tabInputCounts = new Map();
const frameInputCounts = new Map();

bootstrapTabUrls();
setBadgeBackgroundDefaults();
registerAlwaysOnContentScript();

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
      runAt: "document_idle",
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

function sendCommandToFrame(tabId, frameId, type) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(
      tabId,
      { type },
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

async function runManualFillAcrossFrames(tabId) {
  const hasAll = await hasAllUrlsPermission();
  if (!hasAll) {
    throw new Error("missing_all_urls_permission");
  }
  const frames = await getAllFrames(tabId);
  const frameIds = frames.map((frame) => frame.frameId);
  await ensureContentScriptInjected(tabId, frameIds);
  const results = await Promise.all(frameIds.map((frameId) => sendCommandToFrame(tabId, frameId, "autoform_manual_fill")));
  const summary = results.reduce(
    (acc, res) => {
      if (res?.unreachable) {
        acc.unreachable += 1;
        return acc;
      }
      if (res?.error && !acc.error) {
        acc.error = res.error;
      }
      const applied = res?.applied || {};
      acc.success += applied.success || res?.filled || 0;
      acc.skipped += applied.skipped || 0;
      acc.total += applied.total || 0;
      return acc;
    },
    { success: 0, skipped: 0, total: 0, unreachable: 0, error: null }
  );
  return { summary };
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

function createHtmlPreview(html) {
  if (typeof html !== "string") {
    return { preview: "", length: 0, truncated: false };
  }
  const limit = 2000;
  if (html.length <= limit) {
    return { preview: html, length: html.length, truncated: false };
  }
  return { preview: `${html.slice(0, limit)}...`, length: html.length, truncated: true };
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
  return { extVersion, installEphemeral };
}

async function fetchFormItems(payload, originTabId) {
  const { html, sendRecord, pageUrl } = payload || {};
  if (!html || !sendRecord) throw new Error("html と send_record が必要です");

  const proof = await gatherSystemSignals({ nonce: "api_request" }).catch(() => null);
  const analysisId =
    (globalThis.crypto?.randomUUID && crypto.randomUUID()) || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const htmlSha256 = await sha256Hex(html).catch(() => null);
  const htmlPreview = createHtmlPreview(html);

  const startedAt = nowMs();
  const requestPayload = {
    analysis_id: analysisId || undefined,
    html_sha256: htmlSha256 || undefined,
    send_record: sendRecord,
    html,
    page_url: pageUrl || undefined,
    user_info: proof || {}
  };

  let response;
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
  let data = null;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (_) {
    throw new Error("APIレスポンスの解析に失敗しました");
  }
  const items = Array.isArray(data?.form_items) ? data.form_items : Array.isArray(data) ? data : [];
  const durationMs = nowMs() - startedAt;

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
      await fetch(ENV_UPLOAD_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          analysis_id: data?.analysis_id || analysisId,
          token: data.env_token,
          page_host: host,
          html_sha256: htmlSha256 || null,
          install_ephemeral: sig?.installEphemeral || null,
          ext_version: sig?.extVersion || null
        })
      }).catch(() => {});
    } catch (err) {
      console.warn("[AutoForm] env upload failed", err);
    }
  }

  return { items, durationMs };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message?.type) return;

  if (message.type === "autoform_fetch_form_items") {
    const originTabId = sender?.tab?.id;
    fetchFormItems(message.payload, originTabId)
      .then((result) => sendResponse({ items: result.items, durationMs: result.durationMs }))
      .catch((err) => sendResponse({ error: err?.message || "APIエラー" }));
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

  if (message.type === "autoform_manual_fill_all_frames") {
    const tabId = sender?.tab?.id;
    if (typeof tabId !== "number") {
      sendResponse({ error: "tab_unavailable" });
      return;
    }
    runManualFillAcrossFrames(tabId)
      .then((result) => sendResponse({ ok: true, summary: result.summary }))
      .catch((error) => sendResponse({ error: error?.message || "manual_fill_failed" }));
    return true;
  }
});

if (chrome?.webNavigation?.onCommitted) {
  chrome.webNavigation.onCommitted.addListener((details) => {
    if (details.frameId === 0) {
      recordTabUrl(details.tabId, details.url);
      frameInputCounts.delete(details.tabId);
      updateBadgeCount(details.tabId, null);
      ensureContentScriptForTab(details.tabId, details.url).catch(() => {});
    }
  });
}

if (chrome?.tabs?.onUpdated) {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === "complete") {
      ensureContentScriptForTab(tabId, tab?.url).catch(() => {});
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

setInterval(() => {
  const now = Date.now();
  for (const [tabId, info] of lastHtmlByTab.entries()) {
    if (!info || now - info.requestedAt > ANALYSIS_TTL_MS) {
      lastHtmlByTab.delete(tabId);
    }
  }
}, 30 * 1000);
