(() => {
  const DEVICE_TOKEN_KEY = "aimsalesDeviceToken";
  const DEVICE_TOKEN_ENDPOINT =
    "https://autoform-chrome-extention-server-csasaeerewb7b9ga.japaneast-01.azurewebsites.net/chrome_extension/device_token";
  const INSTALL_ID_STORAGE_KEY = "autoformInstallId";
  const TOKEN_EXP_SLOP_MS = 5 * 60 * 1000; // refresh 5 minutes before expiry

  const getLocal = (key) =>
    new Promise((resolve) => {
      if (!chrome?.storage?.local) return resolve(undefined);
      chrome.storage.local.get(key, (res) => resolve(res?.[key]));
    });

  const setLocal = (obj) =>
    new Promise((resolve) => {
      if (!chrome?.storage?.local) return resolve();
      chrome.storage.local.set(obj, () => resolve());
    });

  function getUserAgent() {
    if (typeof navigator !== "undefined" && typeof navigator.userAgent === "string") {
      return navigator.userAgent;
    }
    return "";
  }

  async function sha256Hex(input) {
    try {
      if (!globalThis.crypto?.subtle) throw new Error("subtle_unavailable");
      const data = new TextEncoder().encode(String(input ?? ""));
      const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
      return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
    } catch (_) {
      let hash = 0;
      const str = String(input ?? "");
      for (let i = 0; i < str.length; i += 1) {
        hash = (hash << 5) - hash + str.charCodeAt(i);
        hash |= 0;
      }
      return Math.abs(hash).toString(16);
    }
  }

  function b64urlToJSON(segment) {
    try {
      const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
      const decoded = atob(normalized);
      return JSON.parse(decoded);
    } catch (_) {
      return {};
    }
  }

  function parseExpMs(jwt) {
    if (!jwt || typeof jwt !== "string") return null;
    const parts = jwt.split(".");
    if (parts.length !== 3) return null;
    const payload = b64urlToJSON(parts[1]);
    return typeof payload?.exp === "number" ? payload.exp * 1000 : null;
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
            (typeof globalThis.crypto?.randomUUID === "function" && globalThis.crypto.randomUUID()) ||
            `${Date.now()}-${Math.random().toString(16).slice(2)}`;
          chrome.storage.local.set({ [INSTALL_ID_STORAGE_KEY]: generated }, () => resolve(generated));
        });
      } catch (_) {
        resolve(null);
      }
    });
  }

  async function collectSignals({ nonce = "" } = {}) {
    const manifest = chrome?.runtime?.getManifest ? chrome.runtime.getManifest() : null;
    const extVersion = manifest?.version || null;
    const installId = await getOrCreateInstallId();
    const today = new Date().toISOString().slice(0, 10);
    const baseString = `${installId || "anonymous"}|${nonce || ""}|${today}`;
    const installEphemeral = await sha256Hex(baseString);
    const ua = getUserAgent();
    const uaHash = await sha256Hex(`${ua}|${installId || ""}`);
    return {
      extVersion,
      installEphemeral,
      uaHash
    };
  }

  async function getOrRefreshDeviceToken(gatherSignals, overrideEndpoint) {
    const gatherFn = typeof gatherSignals === "function" ? gatherSignals : collectSignals;
    let userInfo = {};
    try {
      userInfo = (await gatherFn({ nonce: "device_token" })) || {};
    } catch (_) {
      userInfo = {};
    }
    const currentUaHash = userInfo?.uaHash || null;
    const storedEntry = (await getLocal(DEVICE_TOKEN_KEY)) || {};
    let token = typeof storedEntry?.token === "string" ? storedEntry.token : "";
    let expMs = typeof storedEntry?.expMs === "number" ? storedEntry.expMs : parseExpMs(token);
    const storedUaHash = typeof storedEntry?.uaHash === "string" ? storedEntry.uaHash : null;
    const expOrphaned = !token || !expMs;
    const isExpiringSoon = expMs ? Date.now() > expMs - TOKEN_EXP_SLOP_MS : true;
    const uaMismatch = Boolean(currentUaHash && storedUaHash && currentUaHash !== storedUaHash);
    const missingUaHash = Boolean(!storedUaHash && currentUaHash);
    const needsRefresh = expOrphaned || isExpiringSoon || uaMismatch || missingUaHash;
    if (!needsRefresh) {
      return token;
    }

    const endpoint = overrideEndpoint || DEVICE_TOKEN_ENDPOINT;
    let response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", accept: "application/json" },
        body: JSON.stringify({ user_info: userInfo })
      });
    } catch (err) {
      console.warn("[DeviceAuth] device token request failed", err);
      return token || null;
    }
    if (!response.ok) {
      console.warn("[DeviceAuth] device token request rejected", response.status);
      return token || null;
    }
    const data = await response.json().catch(() => ({}));
    token = data?.device_token || data?.token || "";
    expMs = parseExpMs(token);
    if (token && expMs) {
      await setLocal({
        [DEVICE_TOKEN_KEY]: {
          token,
          expMs,
          uaHash: currentUaHash || storedUaHash || null
        }
      });
      return token;
    }
    return null;
  }

  self.DeviceAuth = {
    getOrRefreshDeviceToken,
    collectSignals
  };
})();
