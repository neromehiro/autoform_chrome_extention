(() => {
  const MASTER_STORAGE_KEY = "autoformEnabled";
  const AUTO_RUN_STORAGE_KEY = "autoformAutoRunOnOpen";

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

    if (!chrome?.storage?.sync) {
      applyState(true);
      checkbox.addEventListener("change", () => {
        applyState(checkbox.checked);
      });
      return;
    }

    chrome.storage.sync.get(MASTER_STORAGE_KEY, (res) => {
      applyState(res?.[MASTER_STORAGE_KEY]);
    });

    checkbox.addEventListener("change", () => {
      const enabled = checkbox.checked;
      setDependentState(enabled);
      chrome.storage.sync.set({ [MASTER_STORAGE_KEY]: enabled });
    });
  }

  function initAutoRunToggle() {
    const checkbox = document.getElementById("autoform-toggle");
    if (!checkbox) return;

    const applyState = (value) => {
      checkbox.checked = value !== false;
    };

    if (!chrome?.storage?.sync) {
      applyState(true);
      checkbox.addEventListener("change", () => {
        applyState(checkbox.checked);
      });
      return;
    }

    chrome.storage.sync.get(AUTO_RUN_STORAGE_KEY, (res) => {
      applyState(res?.[AUTO_RUN_STORAGE_KEY]);
    });

    checkbox.addEventListener("change", () => {
      chrome.storage.sync.set({ [AUTO_RUN_STORAGE_KEY]: checkbox.checked });
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    initMasterToggle();
    initAutoRunToggle();
  });
})();
