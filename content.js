// AutoForm: 最小版（テスト）
// 目的: ページ内のフォームっぽい入力欄を見つけて 'test' 等を自動入力するだけ。
// 送信はしない。cURL 取得もしない。

(() => {
  const GLOBAL_FLAG_KEY = "__autoformContentScriptLoaded";
  const globalScope = typeof window !== "undefined" ? window : globalThis;
  if (globalScope[GLOBAL_FLAG_KEY]) {
    return;
  }
  globalScope[GLOBAL_FLAG_KEY] = true;

  // テスト用の定数
  const STORAGE_KEY = "autoformEnabled";
  const AUTO_RUN_STORAGE_KEY = "autoformAutoRunOnOpen";
  const API_KEY_STORAGE_KEY = "aimsalesApiKey";
  const skipTypes = new Set([
    "hidden", "file", "submit", "button", "reset", "radio", "checkbox",
    "range", "date", "time", "color", "image"
  ]);
  const MIN_INPUTS_FOR_AUTO = 3;
  const MIN_FORM_CONTROLS_FOR_REMOTE = 1;
  const KNOWN_MESSAGE_TYPES = new Set([
    "autoform_execute_json",
    "autoform_manual_fill",
    "autoform_count_inputs",
    "autoform_count_forms",
    "autoform_apply_send_content",
    "autoform_request_input_count"
  ]);
  const SEND_CONTENT_STORAGE_KEY = "autoformSendContent";
  const FLOATING_BUTTON_STORAGE_KEY = "autoformShowFloatingButton";
  const FLOATING_BUTTON_LABEL_DEFAULT = "自動入力を実行";
  const FLOATING_BUTTON_LABEL_UPSELL = "無制限に使うには";
  const FLOATING_BUTTON_LABEL_REQUIRE_API_KEY = "APIキーを設定してください";
  const AIMSALES_SIGNUP_URL = "https://forms.gle/FWkuxr8HenuLkARC7";
  const FLOATING_BUTTON_DEFAULT_BACKGROUND = "linear-gradient(135deg, #0ea5e9, #6366f1)";
  const FLOATING_BUTTON_DEFAULT_SHADOW = "0 16px 32px rgba(99, 102, 241, 0.35)";
  const FLOATING_BUTTON_SUCCESS_BACKGROUND = "linear-gradient(135deg, #10b981, #22c55e)";
  const FLOATING_BUTTON_SUCCESS_SHADOW = "0 16px 32px rgba(16, 185, 129, 0.35)";
  const COMPLETION_COUNTDOWN_SECONDS = 3;
  const FLOATING_BUTTON_RESET_FADE_MS = 280;
  const FLOATING_BUTTON_RESET_SWAP_DELAY_MS = 140;
  const DEFAULT_SEND_RECORD = {
    name: "営業 太郎",
    name_kana: "えいぎょう たろう",
    company: "サンプル株式会社",
    "部署": "営業部",
    "住所": "東京都中央区架空町1-2-3 サンプルビル 5F",
    postal_code: "123-4567",
    company_kana: "さんぷる かぶしきがいしゃ",
    prefecture: "東京都",
    email: "k.tanaka@sample.co.jp",
    tel: "03-0000-1111",
    fax: "03-0000-1111",
    title: "Web制作・広告運用のご提案",
    "業種": "Web制作・デジタルマーケティング",
    URL: "https://www.sample.co.jp",
    remark:
      "お世話になっております。\n株式会社サンプルの営業部の田中です。\n\n突然のご連絡失礼いたします。\n弊社ではWeb制作や広告運用、SNS代行などを幅広く行っております。\nもし貴社でもそういったことをお考えでしたら、ぜひご相談ください。\n\nこれまで多くの企業様にご利用いただいており、皆様からご好評をいただいております。\nコーポレートサイトやECサイト、採用サイトなど制作可能です。\n\n現在、まさにサイト作成でお悩みでしたら、\n一度、ぜひお打ち合わせさせてください。\n\n日程調整はこちらからお願いいたしますhttps://app.spirinc.com/patterns/availability-sharing/4HBCM9QxxRR7l4zx69xoq/confirm\n\nよろしくお願いいたします。\n\n株式会社サンプル 営業部 田中 一真"
  };
  const SEND_FIELD_DISPLAY_NAMES = {
    name: "お名前",
    name_kana: "お名前（かな）",
    company: "会社名",
    company_kana: "会社名（かな）",
    "部署": "部署",
    "住所": "住所",
    postal_code: "郵便番号",
    prefecture: "都道府県",
    email: "メールアドレス",
    tel: "電話番号",
    fax: "FAX",
    title: "タイトル",
    "業種": "業種",
    URL: "Webサイト",
    remark: "メッセージ"
  };
  const FLOATING_PREVIEW_STYLE_ID = "autoform-floating-preview-style";
  const FLOATING_PREVIEW_HIDE_DELAY_MS = 120;
  const FLOATING_PREVIEW_VALUE_MAX_LENGTH = 60;
  const SETTINGS_STORAGE_KEYS = [STORAGE_KEY, AUTO_RUN_STORAGE_KEY, FLOATING_BUTTON_STORAGE_KEY, API_KEY_STORAGE_KEY];

  const isTopFrame = window.top === window.self;
  let detectionNoticeShown = false;
  let observer = null;
  let observerTimer = null;
  let started = false;
  let autoFillTriggered = false;
  let remoteFillPromise = null;
  let floatingButton = null;
  let floatingButtonPreference = false;
  let floatingButtonShouldDisplay = false;
  let floatingButtonBusy = false;
  let floatingButtonInitScheduled = false;
  let floatingButtonCompletionInterval = null;
  let floatingButtonCompletionPending = false;
  let floatingButtonContainer = null;
  let extensionEdition = "free";
  let apiKeyAvailable = false;
  let floatingButtonUpsellActive = false;
  let floatingButtonBaseLabel = FLOATING_BUTTON_LABEL_DEFAULT;
  let floatingPreviewPanel = null;
  let floatingPreviewList = null;
  let floatingPreviewEmptyEl = null;
  let floatingPreviewToggle = null;
  let floatingPreviewVisible = false;
  let floatingPreviewHideTimer = null;
  let floatingPreviewRenderToken = 0;
  const floatingPreviewCopyTimers = new Map();
  let masterEnabled = true;
  let autoRunOnOpen = false;
  let lastReportedInputCount = null;
  let inputCountReportTimer = null;
  let lastThrottleMode = null;
  const isPaidEdition = () => extensionEdition === "paid";
  const hasPaidAccess = () => isPaidEdition() && apiKeyAvailable;

  function readStorageArea(area, keys) {
    return new Promise((resolve) => {
      if (!area?.get) {
        resolve({});
        return;
      }
      try {
        area.get(keys, (result) => {
          if (chrome.runtime?.lastError || !result) {
            resolve({});
            return;
          }
          resolve(result);
        });
      } catch (_) {
        resolve({});
      }
    });
  }

  function loadSettingsSnapshot(keys) {
    return Promise.all([readStorageArea(chrome?.storage?.sync, keys), readStorageArea(chrome?.storage?.local, keys)])
      .then(([syncRes, localRes]) => {
        const snapshot = { ...(syncRes || {}) };
        Object.entries(localRes || {}).forEach(([key, value]) => {
          snapshot[key] = value;
        });
        return snapshot;
      })
      .catch(() => ({}));
  }

  function setNativeValue(el, v) {
    const proto = Object.getPrototypeOf(el);
    const descriptor = proto ? Object.getOwnPropertyDescriptor(proto, "value") : null;
    if (descriptor && descriptor.set) {
      descriptor.set.call(el, v);
    } else {
      el.value = v;
    }
  }

  function setValue(el, v) {
    // React/Vue 等の制御コンポーネント対策: value のセッターを直接叩き、input/change を発火
    el.focus();
    setNativeValue(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function normalizeComparableValue(value) {
    if (value == null) return "";
    return String(value)
      .trim()
      .replace(/\s+/g, "")
      .toLowerCase();
  }

  function looseEquals(a, b) {
    const normA = normalizeComparableValue(a);
    const normB = normalizeComparableValue(b);
    if (!normA || !normB) return false;
    return normA === normB;
  }

  function toCandidateList(value) {
    if (value == null) return [];
    if (Array.isArray(value)) return value.filter((v) => v !== null && v !== undefined);
    if (typeof value === "object") {
      return Object.values(value).filter((v) => v !== null && v !== undefined);
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) return [];
      try {
        if ((trimmed.startsWith("[") && trimmed.endsWith("]")) || trimmed.startsWith("{")) {
          const parsed = JSON.parse(trimmed);
          return toCandidateList(parsed);
        }
      } catch (_) {
        // fall through to delimiter split
      }
      return trimmed
        .split(/[\n,、]/)
        .map((item) => item.trim())
        .filter(Boolean);
    }
    return [value];
  }

  function isTruthySelectionValue(value) {
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (value == null) return false;
    const normalized = String(value).trim().toLowerCase();
    if (!normalized) return false;
    return ![
      "false",
      "0",
      "off",
      "unchecked",
      "未選択",
      "未入力",
      "no",
      "none",
      "deselect"
    ].includes(normalized);
  }

  function resolveChoiceValue(choices, desired) {
    if (!Array.isArray(choices) || !choices.length || !desired) return null;
    return (
      choices.find(
        (choice) => looseEquals(choice?.value, desired) || looseEquals(choice?.label, desired)
      )?.value || null
    );
  }

  function selectOptions(selectEl, desiredValue, choices) {
    if (!selectEl) return false;
    const candidates = toCandidateList(desiredValue);
    const options = Array.from(selectEl.options || []);
    if (!options.length) return false;

    const pickFirstUsableOption = () =>
      options.find((opt) => normalizeComparableValue(opt.value)) || options[0] || null;

    function findOption(candidateList) {
      for (const candidate of candidateList) {
        for (const option of options) {
          if (
            looseEquals(option.value, candidate) ||
            looseEquals(option.textContent || option.label, candidate)
          ) {
            return option;
          }
        }
      }
      return null;
    }

    if (selectEl.multiple) {
      const normalized = candidates.map((c) => (c == null ? "" : String(c))).filter(Boolean);
      let appliedCount = 0;
      options.forEach((option) => {
        const shouldSelect = normalized.some(
          (candidate) => looseEquals(option.value, candidate) || looseEquals(option.textContent, candidate)
        );
        if (shouldSelect) appliedCount += 1;
        option.selected = shouldSelect;
      });
      if (appliedCount === 0 && options.length) {
        const fallbackOption = pickFirstUsableOption();
        if (fallbackOption) {
          fallbackOption.selected = true;
          appliedCount = 1;
        }
      }
      selectEl.dispatchEvent(new Event("input", { bubbles: true }));
      selectEl.dispatchEvent(new Event("change", { bubbles: true }));
      return appliedCount > 0;
    }

    let optionMatch = findOption(candidates);
    if (!optionMatch && Array.isArray(choices)) {
      const resolved = candidates
        .map((candidate) => resolveChoiceValue(choices, candidate))
        .filter(Boolean);
      optionMatch = findOption(resolved);
    }
    if (!optionMatch && !candidates.length) {
      optionMatch = pickFirstUsableOption();
    }
    if (!optionMatch && candidates.length) {
      optionMatch = pickFirstUsableOption();
    }
    if (!optionMatch) return false;
    selectEl.value = optionMatch.value;
    selectEl.dispatchEvent(new Event("input", { bubbles: true }));
    selectEl.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function createNoticeElement(text, background) {
    const notice = document.createElement("div");
    notice.textContent = text;
    Object.assign(notice.style, {
      position: "fixed",
      right: "16px",
      padding: "14px 18px",
      color: "#fff",
      fontSize: "15px",
      fontWeight: "600",
      borderRadius: "10px",
      zIndex: 2147483647,
      boxShadow: "0 8px 24px rgba(0, 0, 0, 0.25)",
      fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    });
    notice.style.background = background;
    return notice;
  }

  function showDetectionNotice() {
    detectionNoticeShown = true;
  }

  function formatDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return null;
    }
    if (seconds < 0.01) return "0.01";
    return seconds.toFixed(seconds >= 10 ? 1 : 2);
  }

  function showCompletionNotice(durationSeconds = null, throttleMode = null) {
    if (showFloatingButtonCompletion(durationSeconds, throttleMode)) {
      return;
    }
    const formatted = formatDuration(durationSeconds);
    const message = formatted ? `✅ ${formatted}秒で入力が完了しました` : "✅ 自動入力が完了しました";
    const notice = createNoticeElement(message, "rgba(34, 197, 94, 0.95)");
    notice.style.bottom = "16px";
    (document.body || document.documentElement).appendChild(notice);
    setTimeout(() => notice.remove(), 2500);
  }

  function showErrorNotice(message) {
    const text = message && typeof message === "string" ? message : "自動入力に失敗しました";
    const notice = createNoticeElement(`⚠️ ${text}`, "rgba(248, 113, 113, 0.95)");
    notice.style.bottom = "16px";
    (document.body || document.documentElement).appendChild(notice);
    setTimeout(() => notice.remove(), 3200);
  }

  function ensureFloatingPreviewStyles() {
    if (document.getElementById(FLOATING_PREVIEW_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = FLOATING_PREVIEW_STYLE_ID;
    style.textContent = `
.autoform-floating-button-wrapper {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 2147483647;
  display: inline-flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.autoform-floating-controls {
  display: inline-flex;
  align-items: stretch;
  border-radius: 999px;
  box-shadow: 0 16px 30px rgba(15, 23, 42, 0.22);
  overflow: hidden;
  background: transparent;
}
.autoform-floating-main-button {
  border-radius: 999px 0 0 999px;
  border: none;
  padding-right: 22px !important;
}
.autoform-floating-preview-toggle {
  min-width: 34px;
  padding: 0 10px;
  border-radius: 0 999px 999px 0;
  border: none;
  border-left: 1px solid rgba(255, 255, 255, 0.55);
  background: rgba(248, 250, 252, 0.9);
  color: #0f172a;
  font-size: 14px;
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: auto;
  align-self: stretch;
  cursor: pointer;
  backdrop-filter: blur(12px);
  transition: background 0.2s ease, color 0.2s ease;
}
.autoform-floating-preview-toggle:hover,
.autoform-floating-preview-toggle:focus-visible {
  background: rgba(241, 245, 249, 0.95);
  color: #0a0f1c;
  outline: none;
}
.autoform-floating-button-preview {
  position: absolute;
  bottom: calc(100% + 12px);
  right: 8px;
  width: min(210px, calc(100vw - 48px));
  padding: 0;
  border-radius: 0;
  background: transparent;
  color: #0f172a;
  box-shadow: none;
  border: none;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  opacity: 0;
  transform: translateY(6px) scale(0.99);
  pointer-events: none;
  transition: opacity 0.18s cubic-bezier(0.22, 0.9, 0.36, 1), transform 0.18s cubic-bezier(0.22, 0.9, 0.36, 1);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.autoform-floating-button-preview.is-visible {
  opacity: 1;
  transform: translateY(0) scale(1);
  pointer-events: auto;
}
.autoform-floating-button-preview-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.autoform-floating-button-preview-list > li {
  list-style: none;
  margin: 0;
  padding: 0;
}
.autoform-floating-button-preview-list::-webkit-scrollbar {
  width: 6px;
}
.autoform-floating-button-preview-list::-webkit-scrollbar-thumb {
  background: rgba(148, 163, 184, 0.4);
  border-radius: 999px;
}
.autoform-floating-button-preview-item {
  width: 100%;
  border-radius: 14px;
  padding: 10px 12px 12px;
  border: none;
  background: rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  color: #0f172a;
  display: flex;
  flex-direction: column;
  gap: 2px;
  cursor: pointer;
  font-size: 12px;
  text-align: left;
  font-family: inherit;
  min-height: 48px;
  box-shadow: 0 8px 18px rgba(15, 23, 42, 0.08);
  opacity: 0;
  transform: translateY(10px) scale(0.98);
  position: relative;
  overflow: hidden;
  transition: box-shadow 0.25s ease, transform 0.25s ease;
}
.autoform-floating-button-preview.is-visible .autoform-floating-button-preview-item {
  animation: autoformPreviewPop 0.22s cubic-bezier(0.34, 0.97, 0.48, 1.18) forwards;
  transform-origin: bottom center;
}
.autoform-floating-button-preview-item:hover,
.autoform-floating-button-preview-item:focus-visible {
  box-shadow: 0 20px 36px rgba(99, 102, 241, 0.22);
  outline: none;
  transform: translateY(-1px) scale(1.01);
}
.autoform-floating-button-preview-item.is-copied {
  box-shadow: 0 22px 38px rgba(16, 185, 129, 0.32);
  transform: translateY(-1px) scale(1.01);
}
.autoform-floating-button-preview-item.is-error {
  box-shadow: 0 22px 38px rgba(248, 113, 113, 0.3);
  transform: translateY(-1px) scale(1.01);
}
.autoform-preview-label {
  font-size: 11px;
  color: #5b6475;
  letter-spacing: 0.04em;
  text-transform: none;
  font-weight: 600;
  position: relative;
  z-index: 1;
}
.autoform-preview-value {
  font-size: 12px;
  font-weight: 600;
  color: #0f172a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  position: relative;
  z-index: 1;
}
.autoform-preview-feedback {
  position: absolute;
  inset: 8px 10px;
  border-radius: 12px;
  padding: 6px 10px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: none;
  color: #f8fafc;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  opacity: 0;
  transform: translateX(40px) rotate(-1deg);
  z-index: 2;
  background: linear-gradient(120deg, rgba(34, 197, 94, 0.92), rgba(13, 148, 136, 0.95));
  box-shadow: inset 0 0 18px rgba(15, 23, 42, 0.12);
  transition: background 0.25s ease;
}
.autoform-floating-button-preview-item.is-copied .autoform-preview-feedback,
.autoform-floating-button-preview-item.is-error .autoform-preview-feedback {
  opacity: 1;
  animation: autoformFeedbackSlide 1.9s cubic-bezier(0.22, 1, 0.36, 1) forwards;
}
.autoform-floating-button-preview-item.is-error .autoform-preview-feedback {
  background: linear-gradient(120deg, rgba(248, 113, 113, 0.98), rgba(239, 68, 68, 0.95));
}
.autoform-floating-button-preview-empty {
  font-size: 12px;
  color: #94a3b8;
  margin: 0;
}
@keyframes autoformPreviewPop {
  0% {
    opacity: 0;
    transform: translateY(12px) scale(0.97);
  }
  70% {
    opacity: 1;
    transform: translateY(-1px) scale(1.01);
  }
  100% {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
@keyframes autoformFeedbackSlide {
  0% {
    opacity: 0;
    transform: translateX(40px) rotate(-1deg);
  }
  15% {
    opacity: 1;
    transform: translateX(0) rotate(0deg);
  }
  70% {
    opacity: 1;
    transform: translateX(0) rotate(0deg);
  }
  100% {
    opacity: 0;
    transform: translateX(-36px) rotate(1deg);
  }
}
`;
    (document.head || document.documentElement).appendChild(style);
  }

  function getSendFieldDisplayName(key) {
    return SEND_FIELD_DISPLAY_NAMES[key] || key;
  }

  function formatPreviewDisplayValue(value) {
    if (typeof value !== "string") return "";
    const collapsed = value.replace(/\s+/g, " ").trim();
    if (!collapsed) return "";
    if (collapsed.length > FLOATING_PREVIEW_VALUE_MAX_LENGTH) {
      return `${collapsed.slice(0, FLOATING_PREVIEW_VALUE_MAX_LENGTH)}…`;
    }
    return collapsed;
  }

  function clearFloatingPreviewHideTimer() {
    if (floatingPreviewHideTimer) {
      clearTimeout(floatingPreviewHideTimer);
      floatingPreviewHideTimer = null;
    }
  }

  function hideFloatingPreview(immediate = false) {
    if (!floatingPreviewPanel) return;
    const applyHide = () => {
      if (!floatingPreviewPanel) return;
      floatingPreviewPanel.classList.remove("is-visible");
      floatingPreviewPanel.setAttribute("aria-hidden", "true");
      floatingPreviewVisible = false;
    };
    if (immediate) {
      clearFloatingPreviewHideTimer();
      applyHide();
      return;
    }
    clearFloatingPreviewHideTimer();
    floatingPreviewHideTimer = setTimeout(applyHide, FLOATING_PREVIEW_HIDE_DELAY_MS);
  }

  function showFloatingPreview() {
    if (!floatingPreviewPanel) return;
    clearFloatingPreviewHideTimer();
    if (!floatingPreviewVisible) {
      floatingPreviewPanel.classList.add("is-visible");
      floatingPreviewPanel.setAttribute("aria-hidden", "false");
      floatingPreviewVisible = true;
      refreshFloatingPreviewContent();
    }
  }

  function setFloatingPreviewEmptyVisible(isVisible, message) {
    if (!floatingPreviewEmptyEl) return;
    floatingPreviewEmptyEl.style.display = isVisible ? "block" : "none";
    if (typeof message === "string") {
      floatingPreviewEmptyEl.textContent = message;
    }
  }

  function createFloatingPreviewPanel() {
    ensureFloatingPreviewStyles();
    const panel = document.createElement("div");
    panel.className = "autoform-floating-button-preview";
    panel.setAttribute("aria-hidden", "true");

    const list = document.createElement("ul");
    list.className = "autoform-floating-button-preview-list";
    list.setAttribute("role", "list");

    const empty = document.createElement("p");
    empty.className = "autoform-floating-button-preview-empty";
    empty.textContent = "まだ入力項目がありません";

    panel.append(list, empty);
    panel.addEventListener("click", handleFloatingPreviewListClick);
    panel.addEventListener("keydown", handleFloatingPreviewListKeydown);
    panel.addEventListener("mouseenter", handlePreviewInteractionEnter);
    panel.addEventListener("mouseleave", handlePreviewInteractionLeave);
    panel.addEventListener("focusin", handlePreviewInteractionFocusIn);
    panel.addEventListener("focusout", handlePreviewInteractionFocusOut);

    floatingPreviewPanel = panel;
    floatingPreviewList = list;
    floatingPreviewEmptyEl = empty;
    return panel;
  }

  function handleFloatingPreviewListClick(event) {
    const item = event.target.closest(".autoform-floating-button-preview-item");
    if (!item) return;
    event.preventDefault();
    copyFloatingPreviewValue(item);
  }

  function handleFloatingPreviewListKeydown(event) {
    if (event.key !== "Enter" && event.key !== " ") return;
    const item = event.target.closest(".autoform-floating-button-preview-item");
    if (!item) return;
    event.preventDefault();
    copyFloatingPreviewValue(item);
  }

  function clearFloatingPreviewItemTimer(item) {
    const timerId = floatingPreviewCopyTimers.get(item);
    if (timerId) {
      clearTimeout(timerId);
      floatingPreviewCopyTimers.delete(item);
    }
  }

  function clearAllFloatingPreviewItemTimers() {
    floatingPreviewCopyTimers.forEach((timerId) => clearTimeout(timerId));
    floatingPreviewCopyTimers.clear();
  }

  function showFloatingPreviewFeedback(item, message, state) {
    if (!item) return;
    clearFloatingPreviewItemTimer(item);
    item.classList.remove("is-copied", "is-error");
    if (state === "copied") {
      item.classList.add("is-copied");
    } else if (state === "error") {
      item.classList.add("is-error");
    }
    const feedbackEl = item.querySelector(".autoform-preview-feedback");
    if (feedbackEl) {
      feedbackEl.textContent = message || "";
    }
    if (state) {
      const timerId = setTimeout(() => {
        item.classList.remove("is-copied", "is-error");
        if (feedbackEl) {
          feedbackEl.textContent = "";
        }
        floatingPreviewCopyTimers.delete(item);
      }, 2000);
      floatingPreviewCopyTimers.set(item, timerId);
    }
  }

  async function copyTextToClipboard(text) {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand("copy");
    textarea.remove();
    if (!ok) {
      throw new Error("clipboard unavailable");
    }
  }

  async function copyFloatingPreviewValue(item) {
    const value = item?.dataset?.value || "";
    if (!value.trim()) {
      showFloatingPreviewFeedback(item, "コピー対象がありません", "error");
      return;
    }
    try {
      await copyTextToClipboard(value);
      showFloatingPreviewFeedback(item, "コピーしました", "copied");
    } catch (err) {
      console.error("[AutoForm] クリップボードコピーに失敗", err);
      showFloatingPreviewFeedback(item, "コピーに失敗しました", "error");
    }
  }

  function renderFloatingPreviewItems(record) {
    if (!floatingPreviewList) return;
    clearAllFloatingPreviewItemTimers();
    floatingPreviewList.textContent = "";
    const entries = Object.entries(record || {}).filter(([, value]) => {
      return typeof value === "string" && value.trim().length > 0;
    });
    if (!entries.length) {
      setFloatingPreviewEmptyVisible(true, "まだ入力項目がありません");
      return;
    }
    setFloatingPreviewEmptyVisible(false);
    const fragment = document.createDocumentFragment();
    entries.forEach(([key, rawValue]) => {
      const value = typeof rawValue === "string" ? rawValue : "";
      const li = document.createElement("li");
      const item = document.createElement("button");
      item.type = "button";
      item.className = "autoform-floating-button-preview-item";
      item.dataset.key = key;
      item.dataset.value = value;
      item.title = value;

      const labelEl = document.createElement("span");
      labelEl.className = "autoform-preview-label";
      labelEl.textContent = getSendFieldDisplayName(key);

      const valueEl = document.createElement("span");
      valueEl.className = "autoform-preview-value";
      valueEl.textContent = formatPreviewDisplayValue(value);
      valueEl.title = value;

      const feedbackEl = document.createElement("span");
      feedbackEl.className = "autoform-preview-feedback";

      item.append(labelEl, valueEl, feedbackEl);
      li.appendChild(item);
      fragment.appendChild(li);
    });
    floatingPreviewList.appendChild(fragment);
  }

  async function refreshFloatingPreviewContent() {
    if (!floatingPreviewPanel) return;
    const token = ++floatingPreviewRenderToken;
    if (floatingPreviewList) {
      clearAllFloatingPreviewItemTimers();
      floatingPreviewList.textContent = "";
    }
    setFloatingPreviewEmptyVisible(true, "読み込み中…");
    try {
      const record = await getSendRecordFromStorage();
      if (token !== floatingPreviewRenderToken) return;
      renderFloatingPreviewItems(record);
    } catch (err) {
      console.error("[AutoForm] プレビュー用のデータ取得に失敗", err);
      if (token !== floatingPreviewRenderToken) return;
      setFloatingPreviewEmptyVisible(true, "データを取得できませんでした");
    }
  }

  function isWithinPreviewInteractiveArea(node) {
    if (!node) return false;
    if (floatingPreviewPanel && floatingPreviewPanel.contains(node)) return true;
    if (floatingPreviewToggle && floatingPreviewToggle.contains(node)) return true;
    return false;
  }

  function handlePreviewInteractionEnter() {
    showFloatingPreview();
  }

  function handlePreviewInteractionLeave(event) {
    if (isWithinPreviewInteractiveArea(event.relatedTarget)) {
      return;
    }
    hideFloatingPreview();
  }

  function handlePreviewInteractionFocusIn() {
    showFloatingPreview();
  }

  function handlePreviewInteractionFocusOut(event) {
    if (isWithinPreviewInteractiveArea(event.relatedTarget)) {
      return;
    }
    hideFloatingPreview(true);
  }

  function removeFloatingButton() {
    if (floatingButton) {
      floatingButton.removeEventListener("click", handleFloatingButtonClick);
      floatingButton = null;
    }
    if (floatingPreviewPanel) {
      hideFloatingPreview(true);
      floatingPreviewPanel.removeEventListener("click", handleFloatingPreviewListClick);
      floatingPreviewPanel.removeEventListener("keydown", handleFloatingPreviewListKeydown);
      floatingPreviewPanel.removeEventListener("mouseenter", handlePreviewInteractionEnter);
      floatingPreviewPanel.removeEventListener("mouseleave", handlePreviewInteractionLeave);
      floatingPreviewPanel.removeEventListener("focusin", handlePreviewInteractionFocusIn);
      floatingPreviewPanel.removeEventListener("focusout", handlePreviewInteractionFocusOut);
      floatingPreviewPanel = null;
    } else {
      clearFloatingPreviewHideTimer();
    }
    if (floatingPreviewToggle) {
      floatingPreviewToggle.removeEventListener("mouseenter", handlePreviewInteractionEnter);
      floatingPreviewToggle.removeEventListener("mouseleave", handlePreviewInteractionLeave);
      floatingPreviewToggle.removeEventListener("focusin", handlePreviewInteractionFocusIn);
      floatingPreviewToggle.removeEventListener("focusout", handlePreviewInteractionFocusOut);
      floatingPreviewToggle = null;
    }
    if (floatingButtonContainer) {
      floatingButtonContainer.remove();
      floatingButtonContainer = null;
    }
    floatingPreviewList = null;
    floatingPreviewEmptyEl = null;
    floatingPreviewVisible = false;
    floatingPreviewRenderToken += 1;
    clearAllFloatingPreviewItemTimers();
    clearFloatingButtonCompletionTimer();
  }

  function createFloatingButtonElement() {
    if (floatingButton || floatingButtonContainer || typeof document === "undefined") return;
    if (window.top !== window.self) return;
    if (!document.body) {
      if (!floatingButtonInitScheduled) {
        floatingButtonInitScheduled = true;
        document.addEventListener(
          "DOMContentLoaded",
          () => {
            floatingButtonInitScheduled = false;
            if (floatingButtonShouldDisplay) {
              createFloatingButtonElement();
            }
          },
          { once: true }
        );
      }
      return;
    }
    ensureFloatingPreviewStyles();
    const wrapper = document.createElement("div");
    wrapper.className = "autoform-floating-button-wrapper";
    Object.assign(wrapper.style, {
      position: "fixed",
      bottom: "24px",
      right: "24px",
      zIndex: "2147483647",
      display: "inline-flex",
      flexDirection: "column",
      alignItems: "flex-end",
      gap: "8px"
    });

    const previewPanel = createFloatingPreviewPanel();

    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = getFloatingButtonBaseLabel();
    Object.assign(btn.style, {
      padding: "11px 18px",
      borderRadius: "999px 0 0 999px",
      border: "none",
      background: FLOATING_BUTTON_DEFAULT_BACKGROUND,
      color: "#fff",
      fontSize: "14px",
      fontWeight: "600",
      boxShadow: FLOATING_BUTTON_DEFAULT_SHADOW,
      zIndex: "2147483647",
      cursor: "pointer",
      fontFamily: "inherit",
      transition: "opacity 0.25s ease, transform 0.25s ease, box-shadow 0.28s ease, background 0.28s ease"
    });
    btn.classList.add("autoform-floating-main-button");
    applyFloatingButtonDefaultStyle(btn);
    btn.addEventListener("click", handleFloatingButtonClick);
    const controls = document.createElement("div");
    controls.className = "autoform-floating-controls";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "autoform-floating-preview-toggle";
    toggle.setAttribute("aria-label", "コピー候補を表示");
    toggle.innerHTML = '<span aria-hidden="true">▲</span>';
    toggle.addEventListener("mouseenter", handlePreviewInteractionEnter);
    toggle.addEventListener("mouseleave", handlePreviewInteractionLeave);
    toggle.addEventListener("focusin", handlePreviewInteractionFocusIn);
    toggle.addEventListener("focusout", handlePreviewInteractionFocusOut);
    controls.append(btn, toggle);
    wrapper.append(controls, previewPanel);
    document.body.appendChild(wrapper);
    floatingButtonContainer = wrapper;
    floatingButton = btn;
    floatingPreviewToggle = toggle;
  }

  function updateFloatingButtonVisibility(enabled) {
    if (typeof enabled === "boolean") {
      floatingButtonPreference = enabled;
    }
    floatingButtonShouldDisplay = Boolean(floatingButtonPreference && masterEnabled);
    if (floatingButtonShouldDisplay) {
      createFloatingButtonElement();
    } else {
      removeFloatingButton();
    }
  }

  function getFloatingButtonBaseLabel() {
    return floatingButtonBaseLabel || FLOATING_BUTTON_LABEL_DEFAULT;
  }

  function setFloatingButtonBaseLabel(label) {
    const nextLabel = label || FLOATING_BUTTON_LABEL_DEFAULT;
    floatingButtonBaseLabel = nextLabel;
    if (floatingButton && !floatingButtonCompletionPending) {
      floatingButton.textContent = nextLabel;
    }
  }

  function refreshFloatingButtonBaseCopy() {
    if (isPaidEdition() && !hasPaidAccess()) {
      setFloatingButtonBaseLabel(FLOATING_BUTTON_LABEL_REQUIRE_API_KEY);
      return;
    }
    setFloatingButtonBaseLabel(FLOATING_BUTTON_LABEL_DEFAULT);
  }

  function applyEditionStateFromApiKey(value) {
    apiKeyAvailable = typeof value === "string" && value.trim().length > 0;
    floatingButtonUpsellActive = false;
    refreshFloatingButtonBaseCopy();
  }

  function quotaIndicatesDepleted(quota) {
    if (!quota || typeof quota !== "object") return false;
    if (quota.mode && String(quota.mode).toLowerCase() === "blocked") return true;
    const remaining = quota.remaining;
    if (remaining === Infinity || remaining === "Infinity") return false;
    if (remaining == null) return false;
    const numeric = Number(remaining);
    return Number.isFinite(numeric) ? numeric <= 0 : false;
  }

  function reportFillResultToBackground(result) {
    if (!result || typeof result !== "object" || !chrome?.runtime?.sendMessage) {
      return;
    }
    try {
      chrome.runtime.sendMessage(
        { type: "autoform_record_fill_result", payload: result },
        () => void chrome.runtime?.lastError
      );
    } catch (_) {
      // ignore messaging failures
    }
  }

  function applyQuotaStateToFloatingButton(quota) {
    if (isPaidEdition()) {
      floatingButtonUpsellActive = false;
      setFloatingButtonBaseLabel(hasPaidAccess() ? FLOATING_BUTTON_LABEL_DEFAULT : FLOATING_BUTTON_LABEL_REQUIRE_API_KEY);
      return;
    }
    const depleted = quotaIndicatesDepleted(quota);
    floatingButtonUpsellActive = depleted;
    setFloatingButtonBaseLabel(depleted ? FLOATING_BUTTON_LABEL_UPSELL : FLOATING_BUTTON_LABEL_DEFAULT);
  }

  function openUnlimitedCtaInNewTab() {
    const targetUrl = AIMSALES_SIGNUP_URL;
    const fallbackToWindowOpen = () => {
      if (typeof window !== "undefined" && typeof window.open === "function") {
        try {
          window.open(targetUrl, "_blank", "noopener,noreferrer");
        } catch (err) {
          console.warn("[AutoForm] window.open failed for CTA", err);
        }
      }
    };
    if (chrome?.runtime?.sendMessage) {
      try {
        chrome.runtime.sendMessage({ type: "autoform_open_unlimited_cta", url: targetUrl }, (response) => {
          if (chrome.runtime?.lastError) {
            console.warn("[AutoForm] failed to open unlimited CTA via background", chrome.runtime.lastError);
            fallbackToWindowOpen();
            return;
          }
          if (!response || response.ok !== true) {
            if (response?.error) {
              console.warn("[AutoForm] background rejected CTA request", response.error);
            }
            fallbackToWindowOpen();
          }
        });
        return;
      } catch (err) {
        console.warn("[AutoForm] CTA request threw", err);
        fallbackToWindowOpen();
        return;
      }
    }
    fallbackToWindowOpen();
  }

  async function handleFloatingButtonClick(event) {
    event.preventDefault();
    if (floatingButtonUpsellActive && !isPaidEdition()) {
      openUnlimitedCtaInNewTab();
      return;
    }
    if (floatingButtonBusy) return;
    floatingButtonBusy = true;
    const btn = floatingButton;
    if (btn) {
      btn.disabled = true;
      btn.textContent = "入力中…";
    }
    const resetButtonState = () => {
      floatingButtonBusy = false;
      if (btn) {
        btn.disabled = false;
        if (!floatingButtonCompletionPending) {
          btn.textContent = getFloatingButtonBaseLabel();
        }
      }
    };
    try {
      let result = null;
      try {
        result = await performRemoteFill("floating_button");
      } catch (err) {
        console.warn("[AutoForm] floating button fill failed", err);
        result = { error: err?.message || "manual_fill_failed", quota: err?.quota || null };
      }
      if (result?.quota) {
        applyQuotaStateToFloatingButton(result.quota);
      } else {
        applyQuotaStateToFloatingButton(null);
      }
      if (result?.error) {
        console.warn("[AutoForm] floating button fill failed", result.error);
      }
    } catch (err) {
      if (err?.quota) {
        applyQuotaStateToFloatingButton(err.quota);
      }
      console.error("[AutoForm] floating button fill threw", err);
    } finally {
      resetButtonState();
    }
  }

  function getPageHtml() {
    const root = document.documentElement;
    if (!root) return "";
    return root.outerHTML || "";
  }

  function getSendRecordFromStorage() {
    const fallback = () => ({ ...DEFAULT_SEND_RECORD });
    if (!chrome?.storage?.local) {
      return Promise.resolve(fallback());
    }
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(SEND_CONTENT_STORAGE_KEY, (res) => {
          if (chrome.runtime?.lastError) {
            resolve(fallback());
            return;
          }
          const stored = res?.[SEND_CONTENT_STORAGE_KEY];
          if (stored && typeof stored === "object" && !Array.isArray(stored)) {
            resolve({ ...DEFAULT_SEND_RECORD, ...stored });
            return;
          }
          resolve(fallback());
        });
      } catch (_) {
        resolve(fallback());
      }
    });
  }

  async function performRemoteFill(context = null) {
    if (!masterEnabled) {
      const disabledMessage = "拡張機能が無効化されています";
      if (isTopFrame) {
        reportFillResultToBackground({
          ok: false,
          message: disabledMessage,
          code: "MASTER_DISABLED",
          source: context || null
        });
      }
      return { error: disabledMessage, code: "MASTER_DISABLED" };
    }
    if (document.querySelector('input[type="password"]')) {
      const blockedMessage = "ログインページでは自動入力を無効にしています";
      if (isTopFrame) {
        reportFillResultToBackground({
          ok: false,
          message: blockedMessage,
          code: "PASSWORD_PAGE_BLOCKED",
          source: context || null
        });
      }
      return { error: blockedMessage, code: "PASSWORD_PAGE_BLOCKED" };
    }
    if (remoteFillPromise) return remoteFillPromise;
    remoteFillPromise = (async () => {
      if (isPaidEdition() && !hasPaidAccess()) {
        const lockedMessage = "APIキーを設定すると入力できます";
        if (isTopFrame) {
          reportFillResultToBackground({
            ok: false,
            message: lockedMessage,
            code: "PAID_API_KEY_MISSING",
            planStatus: "paid-missing",
            source: context || null
          });
        }
        return { error: lockedMessage, code: "PAID_API_KEY_MISSING", planStatus: "paid-missing" };
      }
      const formsCount = (() => {
        try {
          return document.forms ? document.forms.length : 0;
        } catch (_) {
          return 0;
        }
      })();
      const controlCount = countFormControls();
      if (formsCount === 0 && controlCount < MIN_FORM_CONTROLS_FOR_REMOTE) {
        console.info("[AutoForm] Skipping API fetch: insufficient form controls detected", {
          formsCount,
          controlCount
        });
        return { applied: { total: 0, success: 0, skipped: 0 }, skipped: true };
      }
      const html = getPageHtml();
      if (!html) {
        return { error: "HTMLが取得できませんでした" };
      }
      try {
        const sendRecord = await getSendRecordFromStorage();
        const pageUrl = (() => {
          try {
            return window.location?.href || null;
          } catch (_) {
            return null;
          }
        })();
        const { items, durationMs, throttleMode, quota, planStatus } = await requestFormItemsViaBackground(html, sendRecord, pageUrl);
        lastThrottleMode = throttleMode || lastThrottleMode;
        const applied = applyJsonInstructions(items);
        if (applied.success > 0) {
          const durationSeconds = typeof durationMs === "number" ? durationMs / 1000 : null;
          showCompletionNotice(durationSeconds, lastThrottleMode);
        }
        applyQuotaStateToFloatingButton(quota);
        if (isTopFrame) {
          reportFillResultToBackground({
            ok: true,
            applied: applied?.success || 0,
            total: typeof applied?.total === "number" ? applied.total : Array.isArray(items) ? items.length : null,
            quota: quota || null,
            planStatus: planStatus || null,
            durationMs: typeof durationMs === "number" ? durationMs : null,
            source: context || null
          });
        }
        return { applied, quota, planStatus };
      } catch (err) {
        console.error("[AutoForm] API 実行でエラー", err);
        const quota = err?.quota && typeof err.quota === "object" ? err.quota : null;
        if (quota) {
          applyQuotaStateToFloatingButton(quota);
        }
        const errorMessage = err?.message || "APIエラー";
        if (isTopFrame) {
          reportFillResultToBackground({
            ok: false,
            message: errorMessage,
            code: err?.code || null,
            quota: quota || null,
            planStatus: err?.planStatus || null,
            source: context || null
          });
        }
        return {
          error: errorMessage,
          quota,
          code: err?.code || null,
          planStatus: err?.planStatus || null
        };
      }
    })();
    const result = await remoteFillPromise;
    remoteFillPromise = null;
    return result;
  }

  function refreshEditionStateFromBackground() {
    if (!chrome?.runtime?.sendMessage) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: "autoform_get_quota_state" }, (response) => {
          if (!chrome.runtime?.lastError) {
            if (typeof response?.edition === "string") {
              extensionEdition = response.edition;
            }
            refreshFloatingButtonBaseCopy();
            if (response?.quota && typeof response.quota === "object") {
              applyQuotaStateToFloatingButton(response.quota);
            } else {
              applyQuotaStateToFloatingButton(null);
            }
          }
          resolve();
        });
      } catch (_) {
        resolve();
      }
    });
  }

  function requestFormItemsViaBackground(html, sendRecord, pageUrl) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          type: "autoform_fetch_form_items",
          payload: { html, sendRecord, pageUrl }
        },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (response?.error) {
            const err = new Error(response.error);
            if (response?.quota && typeof response.quota === "object") {
              err.quota = response.quota;
            }
            if (response?.code) {
              err.code = response.code;
            }
            if (response?.planStatus) {
              err.planStatus = response.planStatus;
            }
            reject(err);
            return;
          }
          const items = response?.items;
          if (!Array.isArray(items)) {
            reject(new Error("APIレスポンスが配列形式ではありません"));
            return;
          }
          resolve({
            items,
            durationMs: response?.durationMs,
            throttleMode: response?.throttleMode,
            quota: response?.quota || null,
            planStatus: response?.planStatus || null
          });
        }
      );
    });
  }

  function clearFloatingButtonCompletionTimer() {
    if (floatingButtonCompletionInterval) {
      clearInterval(floatingButtonCompletionInterval);
      floatingButtonCompletionInterval = null;
    }
    floatingButtonCompletionPending = false;
  }

  function showFloatingButtonCompletion(durationSeconds, throttleMode) {
    if (!(floatingButton && floatingButtonShouldDisplay)) return false;
    const formatted = formatDuration(durationSeconds);
    const baseLabel = formatted ? `${formatted}秒で入力完了しました` : "入力完了しました";
    clearFloatingButtonCompletionTimer();
    floatingButtonCompletionPending = true;
    floatingButton.disabled = false;
    floatingButton.style.opacity = "1";
    applyFloatingButtonSuccessStyle(floatingButton);

    let remaining = COMPLETION_COUNTDOWN_SECONDS;
    const updateLabel = () => {
      if (!floatingButton) return;
      floatingButton.textContent = `${baseLabel} (${remaining})`;
    };
    updateLabel();

    floatingButtonCompletionInterval = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearFloatingButtonCompletionTimer();
        if (floatingButton) {
          animateFloatingButtonReturn();
        }
        return;
      }
      updateLabel();
    }, 1000);
    return true;
  }

  function animateFloatingButtonReturn() {
    if (!floatingButton) return;
    const btn = floatingButton;
    btn.dataset.autoformResetting = "1";
    btn.style.opacity = "0";
    btn.style.transform = "translateY(6px)";
    setTimeout(() => {
      if (!floatingButton || btn.dataset.autoformResetting !== "1") return;
      btn.textContent = getFloatingButtonBaseLabel();
      applyFloatingButtonDefaultStyle(btn);
      requestAnimationFrame(() => {
        btn.style.opacity = "1";
        btn.style.transform = "translateY(0)";
        setTimeout(() => {
          if (btn.dataset.autoformResetting === "1") {
            delete btn.dataset.autoformResetting;
          }
        }, FLOATING_BUTTON_RESET_FADE_MS);
      });
    }, FLOATING_BUTTON_RESET_SWAP_DELAY_MS);
  }

  function applyFloatingButtonDefaultStyle(btn = floatingButton) {
    if (!btn) return;
    btn.style.background = FLOATING_BUTTON_DEFAULT_BACKGROUND;
    btn.style.boxShadow = FLOATING_BUTTON_DEFAULT_SHADOW;
    btn.style.color = "#fff";
  }

  function applyFloatingButtonSuccessStyle(btn = floatingButton) {
    if (!btn) return;
    btn.style.background = FLOATING_BUTTON_SUCCESS_BACKGROUND;
    btn.style.boxShadow = FLOATING_BUTTON_SUCCESS_SHADOW;
    btn.style.color = "#fff";
  }

  // Shadow DOMを横断しながら selector に一致する要素を収集
  function queryAllDeep(selector, root = document) {
    const collected = [];
    const queue = [root];
    const visited = new Set();
    while (queue.length) {
      const node = queue.shift();
      if (!node || visited.has(node)) continue;
      visited.add(node);
      let scopedElements = [];
      try {
        if (typeof node.querySelectorAll === "function") {
          scopedElements = node.querySelectorAll(selector);
          scopedElements.forEach((el) => collected.push(el));
          node.querySelectorAll("*").forEach((el) => {
            if (el?.shadowRoot && !visited.has(el.shadowRoot)) {
              queue.push(el.shadowRoot);
            }
          });
        }
      } catch (_) {
        // ignore selector errors from host components
      }
      if (node.shadowRoot && !visited.has(node.shadowRoot)) {
        queue.push(node.shadowRoot);
      }
    }
    return Array.from(new Set(collected));
  }

  function countActualForms(root = document) {
    try {
      const nativeForms = queryAllDeep("form", root).length;
      if (nativeForms > 0) return nativeForms;
      return queryAllDeep(
        '.hs-form, [role="form"], [data-form], [data-component="form"], [class*="form-"]',
        root
      ).length;
    } catch (_) {
      return 0;
    }
  }

  function countEligibleInputs(root = document) {
    const nodes = queryAllDeep(
      'input, textarea, select, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]',
      root
    );
    let count = 0;
    for (const el of nodes) {
      if (el.disabled || el.readOnly) continue;
      const type = (el.getAttribute("type") || "text").toLowerCase();
      if (skipTypes.has(type)) continue;
      count += 1;
    }
    return count;
  }

  function countFormControls(root = document) {
    try {
      return queryAllDeep("input, textarea, select", root).length;
    } catch (_) {
      return 0;
    }
  }

  function dispatchInputCount(count) {
    if (!chrome?.runtime?.sendMessage) return;
    try {
      chrome.runtime.sendMessage({ type: "autoform_report_input_count", payload: { count } }, () => {
        // ignore errors when background is unavailable
        void chrome.runtime.lastError;
      });
    } catch (_) {
      // ignored
    }
  }

  function reportInputCountNow(countOverride) {
    const nextCount =
      typeof countOverride === "number" && Number.isFinite(countOverride)
        ? Math.max(0, Math.floor(countOverride))
        : countEligibleInputs();
    if (nextCount === lastReportedInputCount) {
      return nextCount;
    }
    lastReportedInputCount = nextCount;
    dispatchInputCount(nextCount);
    return nextCount;
  }

  function scheduleInputCountReport(options = {}) {
    const { immediate = false, countOverride } = options;
    if (immediate) {
      reportInputCountNow(countOverride);
      return;
    }
    if (inputCountReportTimer) {
      clearTimeout(inputCountReportTimer);
    }
    inputCountReportTimer = setTimeout(() => {
      inputCountReportTimer = null;
      reportInputCountNow(countOverride);
    }, 200);
  }

  function tryAutoFillStart() {
    if (!masterEnabled || !autoRunOnOpen) return;
    if (autoFillTriggered || remoteFillPromise) return;
    const count = countEligibleInputs();
    scheduleInputCountReport({ immediate: true, countOverride: count });
    if (count >= MIN_INPUTS_FOR_AUTO) {
      autoFillTriggered = true;
      showDetectionNotice();
      performRemoteFill("auto-detect").then((result) => {
        if (result?.error) {
          autoFillTriggered = false;
        }
      });
    }
  }

  function evaluateXPath(xpath) {
    try {
      const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
      return result.singleNodeValue || null;
    } catch (err) {
      console.warn("[AutoForm] XPath 評価に失敗:", xpath, err);
      return null;
    }
  }

  function setNodeValue(node, value, meta = {}) {
    if (!node) return false;
    const fieldType = (meta?.fieldType || meta?.existingData?.type || "").toLowerCase();
    const choices = meta?.choices || meta?.existingData?.choices;

    if (node instanceof HTMLInputElement) {
      const type = node.type.toLowerCase();
      if (type === "button" || type === "submit" || type === "reset") {
        // Do not alter button-like inputs; otherwise the visible label disappears.
        return false;
      }
      if (type === "checkbox") {
        const shouldCheck = isTruthySelectionValue(value);
        if (node.disabled) return false;
        if (node.checked !== shouldCheck) {
          const label = findAssociatedLabel(node);
          if (!(label ? clickLikeUser(label) : clickLikeUser(node))) {
            node.checked = shouldCheck;
            node.dispatchEvent(new Event("input", { bubbles: true }));
            node.dispatchEvent(new Event("change", { bubbles: true }));
          }
        }
        node.dataset.autoformFilled = "1";
        return true;
      }
      if (type === "radio") {
        const shouldSelect = isTruthySelectionValue(value);
        if (node.disabled) return false;
        if (shouldSelect && !node.checked) {
          const label = findAssociatedLabel(node);
          if (!(label ? clickLikeUser(label) : clickLikeUser(node))) {
            node.checked = true;
            node.dispatchEvent(new Event("input", { bubbles: true }));
            node.dispatchEvent(new Event("change", { bubbles: true }));
          }
        }
        node.dataset.autoformFilled = "1";
        return true;
      }
      if (type === "file") return false;
      setValue(node, value ?? "");
      node.dataset.autoformFilled = "1";
      return true;
    }

    if (node instanceof HTMLTextAreaElement) {
      setValue(node, value ?? "");
      node.dataset.autoformFilled = "1";
      return true;
    }

    if (node instanceof HTMLSelectElement) {
      const applied = selectOptions(node, value, choices);
      if (applied) {
        node.dataset.autoformFilled = "1";
      }
      return applied;
    }

    if (node.isContentEditable) {
      node.focus();
      node.textContent = value ?? "";
      node.dispatchEvent(new Event("input", { bubbles: true }));
      node.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }

    return false;
  }

  function cssEscape(value) {
    const str = String(value ?? "");
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
      return CSS.escape(str);
    }
    return str.replace(/["\\]/g, "\\$&");
  }

  function findSendContentTarget(key) {
    if (!key) return null;
    const escaped = cssEscape(key);
    const selectors = [
      `input[name="${escaped}"]`,
      `textarea[name="${escaped}"]`,
      `select[name="${escaped}"]`,
      `input[id="${escaped}"]`,
      `textarea[id="${escaped}"]`,
      `select[id="${escaped}"]`
    ];
    for (const selector of selectors) {
      try {
        const el = document.querySelector(selector);
        if (el) return el;
      } catch (err) {
        console.warn("[AutoForm] セレクタ解析に失敗:", selector, err);
      }
    }
    const lowerKey = String(key).toLowerCase();
    const fuzzyCandidates = Array.from(document.querySelectorAll("input, textarea, select"));
    for (const el of fuzzyCandidates) {
      const name = (el.getAttribute("name") || "").toLowerCase();
      const id = (el.id || "").toLowerCase();
      const placeholder = (el.getAttribute("placeholder") || "").toLowerCase();
      if (name.includes(lowerKey) || id.includes(lowerKey) || placeholder.includes(lowerKey)) {
        return el;
      }
    }
    return null;
  }

  function shouldClickNode(node, condition, value, fieldType = "") {
    if (!node) return false;
    const targetCondition = String(condition || "").toLowerCase();
    const valueStr = typeof value === "string" ? value.toLowerCase() : "";
    const wantsClick = targetCondition.includes("click") || valueStr === "click";
    if (!wantsClick) return false;
    const type = node instanceof HTMLInputElement ? node.type.toLowerCase() : "";
    if (["submit", "reset", "button", "file", "image"].includes(type)) return false;
    return true;
  }

  function findAssociatedLabel(input) {
    if (!(input instanceof HTMLInputElement)) return null;
    const byFor =
      input.id ? document.querySelector(`label[for="${cssEscape(input.id)}"]`) : null;
    return input.closest("label") || byFor || null;
  }

  function clickLikeUser(target) {
    try {
      target.focus();
      target.click();
      return true;
    } catch (err) {
      console.warn("[AutoForm] 擬似クリックに失敗:", err);
      return false;
    }
  }

  function applyJsonInstructions(items) {
    if (!Array.isArray(items)) {
      return { total: 0, success: 0, skipped: 0 };
    }
    let success = 0;
    let skipped = 0;

    for (const item of items) {
      const xpath = item?.existing_data?.xpath;
      if (!xpath) {
        skipped += 1;
        continue;
      }
      const target = evaluateXPath(xpath);
      if (!target) {
        skipped += 1;
        continue;
      }
      const existing = item?.existing_data || {};
      const value = item?.input_data?.value ?? "";
      const condition = (item?.input_data?.match_condition || "").toLowerCase();

      if (shouldClickNode(target, condition, value, existing.type)) {
        try {
          target.focus();
          target.click();
          success += 1;
        } catch (err) {
          console.warn("[AutoForm] クリックに失敗:", err);
          skipped += 1;
        }
        continue;
      }

      const applied = setNodeValue(target, value, {
        existingData: existing,
        fieldType: existing.type,
        choices: existing.choices,
        inputData: item?.input_data
      });
      if (applied) {
        success += 1;
      } else {
        skipped += 1;
      }
    }

    return { total: items.length, success, skipped };
  }

  function applySendContent(payload) {
    if (!payload || Array.isArray(payload) || typeof payload !== "object") {
      return { total: 0, success: 0, filledKeys: [] };
    }
    const entries = Object.entries(payload);
    const filledKeys = [];
    let success = 0;

    for (const [key, value] of entries) {
      const target = findSendContentTarget(key);
      if (!target) continue;
      const applied = setNodeValue(target, value);
      if (applied) {
        success += 1;
        filledKeys.push(key);
      }
    }

    if (success > 0) showCompletionNotice(null, lastThrottleMode);
    return { total: entries.length, success, filledKeys };
  }

  function handleCommand(command, payload) {
    if (command === "autoform_execute_json") {
      const applied = applyJsonInstructions(payload);
      if (applied.success > 0) {
        showCompletionNotice(null, lastThrottleMode);
      }
      return { applied };
    }
    if (command === "autoform_manual_fill") {
      return performRemoteFill("manual-fill").then((result) => {
        if (result?.applied) {
          return {
            filled: result.applied.success || 0,
            applied: result.applied,
            quota: result.quota || null,
            planStatus: result.planStatus || null
          };
        }
        return {
          error: result?.error || "入力に失敗しました",
          quota: result?.quota || null,
          code: result?.code || null,
          planStatus: result?.planStatus || null
        };
      });
    }
    if (command === "autoform_count_inputs") {
      const count = countEligibleInputs(document);
      reportInputCountNow(count);
      return { count };
    }
    if (command === "autoform_count_forms") {
      return {
        forms: countActualForms(document),
        controls: countFormControls(document)
      };
    }
    if (command === "autoform_apply_send_content") {
      const sendContentResult = applySendContent(payload);
      return { sendContent: sendContentResult };
    }
    if (command === "autoform_request_input_count") {
      const count = reportInputCountNow();
      return { count };
    }
    return null;
  }

  function stopObservation() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (observerTimer) {
      clearTimeout(observerTimer);
      observerTimer = null;
    }
  }

  function disableAutoFill() {
    if (!started) return;
    stopObservation();
    autoFillTriggered = false;
    remoteFillPromise = null;
    started = false;
  }

  function startAutoFill() {
    if (!isTopFrame) return;
    if (started) return;
    if (document.querySelector('input[type="password"]')) return; // ガード
    started = true;
    detectionNoticeShown = false;
    autoFillTriggered = false;
    remoteFillPromise = null;

    const run = () => tryAutoFillStart();
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", run, { once: true });
    } else {
      run();
    }

    observer = new MutationObserver(() => {
      scheduleInputCountReport();
      if (!autoFillTriggered) {
        tryAutoFillStart();
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    observerTimer = setTimeout(() => {
      stopObservation();
    }, 30000);
  }

  function updateAutoFillState() {
    if (masterEnabled && autoRunOnOpen) {
      startAutoFill();
    } else {
      disableAutoFill();
    }
  }

  function applyEnabledState(enabled) {
    masterEnabled = enabled !== false;
    updateFloatingButtonVisibility();
    updateAutoFillState();
  }

  function applyAutoRunState(value) {
    autoRunOnOpen = value === true;
    updateAutoFillState();
  }

  function init() {
    if (!chrome?.storage?.sync && !chrome?.storage?.local) {
      startAutoFill();
      updateFloatingButtonVisibility(false);
      return;
    }

    loadSettingsSnapshot(SETTINGS_STORAGE_KEYS)
      .then((snapshot) => {
        const hasMasterOverride = Object.prototype.hasOwnProperty.call(snapshot, STORAGE_KEY);
        const hasAutoRunOverride = Object.prototype.hasOwnProperty.call(snapshot, AUTO_RUN_STORAGE_KEY);
        masterEnabled = hasMasterOverride ? snapshot[STORAGE_KEY] !== false : true;
        autoRunOnOpen = hasAutoRunOverride ? snapshot[AUTO_RUN_STORAGE_KEY] === true : false;
        updateFloatingButtonVisibility(snapshot?.[FLOATING_BUTTON_STORAGE_KEY] === true);
        applyEditionStateFromApiKey(snapshot?.[API_KEY_STORAGE_KEY]);
      })
      .catch(() => {
        masterEnabled = true;
        autoRunOnOpen = false;
        updateFloatingButtonVisibility(false);
      })
      .finally(() => {
        updateAutoFillState();
        refreshEditionStateFromBackground().catch(() => {});
      });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync" && area !== "local") return;
      if (changes[STORAGE_KEY]) {
        applyEnabledState(changes[STORAGE_KEY].newValue !== false);
      }
      if (changes[AUTO_RUN_STORAGE_KEY]) {
        applyAutoRunState(changes[AUTO_RUN_STORAGE_KEY].newValue === true);
      }
      if (changes[FLOATING_BUTTON_STORAGE_KEY]) {
        updateFloatingButtonVisibility(changes[FLOATING_BUTTON_STORAGE_KEY].newValue === true);
      }
      if (changes[API_KEY_STORAGE_KEY]) {
        applyEditionStateFromApiKey(changes[API_KEY_STORAGE_KEY].newValue);
      }
    });

    if (chrome?.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (!message?.type || !KNOWN_MESSAGE_TYPES.has(message.type)) {
          return;
        }
        try {
          const response = handleCommand(message.type, message.payload);
          if (response && typeof response.then === "function") {
            response
              .then((res) => sendResponse(res))
              .catch((err) => {
                console.error("[AutoForm] メッセージ応答エラー", err);
                sendResponse({ error: err?.message || "未知のエラー" });
              });
            return true;
          }
          sendResponse(response);
        } catch (err) {
          console.error("[AutoForm] メッセージ処理でエラー", err);
          sendResponse({ error: err?.message || "未知のエラー" });
        }
      });
    }
  }

  init();
  scheduleInputCountReport({ immediate: true });
})();
