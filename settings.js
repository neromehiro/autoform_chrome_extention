(() => {
  const MASTER_STORAGE_KEY = "autoformEnabled";
  const AUTO_RUN_STORAGE_KEY = "autoformAutoRunOnOpen";
  const API_KEY_STORAGE_KEY = "aimsalesApiKey";

  function persistSetting(key, value) {
    const payload = { [key]: value };
    if (chrome?.storage?.local) {
      try {
        chrome.storage.local.set(payload, () => void chrome.runtime?.lastError);
      } catch (_) {
        // ignore local storage errors
      }
    }
    if (chrome?.storage?.sync) {
      try {
        chrome.storage.sync.set(payload, () => void chrome.runtime?.lastError);
      } catch (_) {
        // ignore sync storage errors
      }
    }
  }

  function readSetting(key, callback) {
    const applyValue = (value) => callback(value);
    const readFromSync = () => {
      if (!chrome?.storage?.sync) {
        applyValue(undefined);
        return;
      }
      try {
        chrome.storage.sync.get(key, (res) => {
          if (chrome.runtime?.lastError) {
            applyValue(undefined);
            return;
          }
          applyValue(res?.[key]);
        });
      } catch (_) {
        applyValue(undefined);
      }
    };
    if (chrome?.storage?.local) {
      try {
        chrome.storage.local.get(key, (localRes) => {
          if (!chrome.runtime?.lastError && Object.prototype.hasOwnProperty.call(localRes || {}, key)) {
            applyValue(localRes[key]);
            return;
          }
          readFromSync();
        });
      } catch (_) {
        readFromSync();
      }
      return;
    }
    readFromSync();
  }

  function setDependentState(enabled) {
    const dependentCards = document.querySelectorAll('[data-master-scope="dependents"]');
    dependentCards.forEach((card) => {
      card.classList.toggle("master-off", !enabled);
      card.setAttribute("aria-disabled", (!enabled).toString());
    });
    const statusText = document.getElementById("master-toggle-status-text");
    if (statusText) {
      statusText.textContent = enabled
        ? "Aimsales AutoForm が有効です"
        : "OFF: 拡張機能は停止中です";
      statusText.style.color = enabled ? "#64748b" : "#dc2626";
    }
    const dependents = document.querySelectorAll("[data-master-controlled]");
    dependents.forEach((el) => {
      el.disabled = !enabled;
      el.setAttribute("aria-disabled", (!enabled).toString());
    });
  }

  function initMasterToggle() {
    const checkbox = document.getElementById("extension-master-toggle");
    if (!checkbox) return;

    const applyState = (value) => {
      const enabled = value !== false;
      checkbox.checked = enabled;
      setDependentState(enabled);
    };

    if (!chrome?.storage?.sync && !chrome?.storage?.local) {
      applyState(true);
      checkbox.addEventListener("change", () => {
        applyState(checkbox.checked);
      });
      return;
    }

    readSetting(MASTER_STORAGE_KEY, (storedValue) => {
      applyState(storedValue);
    });

    checkbox.addEventListener("change", () => {
      const enabled = checkbox.checked;
      setDependentState(enabled);
      persistSetting(MASTER_STORAGE_KEY, enabled);
    });

    if (chrome?.storage?.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "sync" && area !== "local") return;
        if (!Object.prototype.hasOwnProperty.call(changes, MASTER_STORAGE_KEY)) return;
        applyState(changes[MASTER_STORAGE_KEY]?.newValue);
      });
    }
  }

  function initAutoRunToggle() {
    const checkbox = document.getElementById("autoform-toggle");
    if (!checkbox) return;

    const applyState = (value) => {
      checkbox.checked = value === true;
    };

    if (!chrome?.storage?.sync && !chrome?.storage?.local) {
      applyState(false);
      checkbox.addEventListener("change", () => {
        applyState(checkbox.checked);
      });
      return;
    }

    readSetting(AUTO_RUN_STORAGE_KEY, (storedValue) => {
      applyState(storedValue);
    });

    checkbox.addEventListener("change", () => {
      persistSetting(AUTO_RUN_STORAGE_KEY, checkbox.checked);
    });

    if (chrome?.storage?.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "sync" && area !== "local") return;
        if (!Object.prototype.hasOwnProperty.call(changes, AUTO_RUN_STORAGE_KEY)) return;
        applyState(changes[AUTO_RUN_STORAGE_KEY]?.newValue);
      });
    }
  }

  function setOptionsApiKeyStatus(message, isError = false) {
    const statusEl = document.getElementById("options-api-key-status");
    if (!statusEl) return;
    statusEl.textContent = message || "";
    statusEl.style.color = isError ? "#dc2626" : "#475569";
  }

  function initOptionsApiKeyForm() {
    const input = document.getElementById("options-api-key-input");
    const saveBtn = document.getElementById("options-save-api-key");
    const deleteBtn = document.getElementById("options-delete-api-key");
    if (!input || !saveBtn) return;

    if (!chrome?.storage?.sync) {
      input.disabled = true;
      saveBtn.disabled = true;
      if (deleteBtn) deleteBtn.disabled = true;
      setOptionsApiKeyStatus("storage が利用できません (APIキー未設定)", true);
      return;
    }

    const applyValue = (value, messageOverride) => {
      if (document.activeElement !== input) {
        input.value = value;
      }
      if (messageOverride) {
        setOptionsApiKeyStatus(messageOverride);
        return;
      }
      setOptionsApiKeyStatus(value ? "保存済みのAPIキーを読み込みました" : "APIキーが未設定です");
    };

    chrome.storage.sync.get(API_KEY_STORAGE_KEY, (res) => {
      if (chrome.runtime?.lastError) {
        setOptionsApiKeyStatus(`APIキーの読み込みに失敗しました: ${chrome.runtime.lastError.message}`, true);
        return;
      }
      const stored = typeof res?.[API_KEY_STORAGE_KEY] === "string" ? res[API_KEY_STORAGE_KEY] : "";
      applyValue(stored);
    });

    const handleSave = () => {
      const value = input.value.trim();
      saveBtn.disabled = true;
      if (deleteBtn) deleteBtn.disabled = true;
      const finish = (message, isError = false) => {
        saveBtn.disabled = false;
        if (deleteBtn) deleteBtn.disabled = false;
        setOptionsApiKeyStatus(message, isError);
      };
      if (!value) {
        chrome.storage.sync.remove(API_KEY_STORAGE_KEY, () => {
          if (chrome.runtime?.lastError) {
            finish(`APIキーの削除に失敗しました: ${chrome.runtime.lastError.message}`, true);
            return;
          }
          applyValue("");
          finish("APIキーを削除しました");
        });
        return;
      }
      chrome.storage.sync.set({ [API_KEY_STORAGE_KEY]: value }, () => {
        if (chrome.runtime?.lastError) {
          finish(`APIキーの保存に失敗しました: ${chrome.runtime.lastError.message}`, true);
          return;
        }
        applyValue(value);
        finish("APIキーを保存しました");
      });
    };

    saveBtn.addEventListener("click", handleSave);
    if (deleteBtn) {
      deleteBtn.addEventListener("click", () => {
        input.value = "";
        handleSave();
      });
    }

    if (chrome?.storage?.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "sync" || !Object.prototype.hasOwnProperty.call(changes, API_KEY_STORAGE_KEY)) {
          return;
        }
        const nextValue = changes[API_KEY_STORAGE_KEY]?.newValue;
        const normalized = typeof nextValue === "string" ? nextValue : "";
        applyValue(normalized, normalized ? "APIキーが更新されました" : "APIキーが未設定です");
      });
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    initMasterToggle();
    initAutoRunToggle();
    initOptionsApiKeyForm();
  });
})();
