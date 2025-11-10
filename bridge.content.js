(() => {
  const BRIDGE_FLAG = "__autoform_ext_bridge_installed__";
  if (window[BRIDGE_FLAG]) return;
  window[BRIDGE_FLAG] = true;

  const relay = (outgoing, responseType) => {
    const nonce = outgoing?.nonce;
    if (typeof nonce !== "string") return;
    const message = { type: responseType, nonce, payload: null };
    try {
      chrome.runtime.sendMessage(outgoing.runtimeMessage, (response) => {
        if (chrome.runtime?.lastError) {
          message.error = chrome.runtime.lastError.message;
        } else if (responseType === "extension_user_info") {
          if (response?.error && !response?.userInfo) {
            message.error = response.error;
          }
          message.payload = response?.userInfo ?? null;
        } else if (response && response.error && !response?.extVersion) {
          message.error = response.error;
        } else {
          message.payload = response || null;
        }
        window.postMessage(message, "*");
      });
    } catch (err) {
      message.error = err?.message || "bridge_failed";
      window.postMessage(message, "*");
    }
  };

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data || {};
    if (typeof data.nonce !== "string") return;

    if (data.type === "collect_ext_signals") {
      relay(
        {
          nonce: data.nonce,
          runtimeMessage: { type: "get_system_signals", nonce: data.nonce }
        },
        "ext_signals"
      );
      return;
    }

    if (data.type === "collect_extension_user_info") {
      relay(
        {
          nonce: data.nonce,
          runtimeMessage: { type: "autoform_get_user_info_details", refresh: true, reason: data.reason || "redirect_template" }
        },
        "extension_user_info"
      );
      return;
    }

    if (data.type === "autoform_share_browser_env") {
      try {
        chrome.runtime.sendMessage({
          type: "autoform_page_env_report",
          payload: data.payload || null,
          pageUrl: typeof data.href === "string" ? data.href : null
        });
      } catch (err) {
        console.warn("[AutoForm] failed to relay browser env", err);
      }
    }
  });
})();
