// AutoForm: 最小版（テスト）
// 目的: ページ内のフォームっぽい入力欄を見つけて 'test' 等を自動入力するだけ。
// 送信はしない。cURL 取得もしない。

(() => {
  // テスト用の定数
  const STORAGE_KEY = "autoformEnabled";
  const AUTO_RUN_STORAGE_KEY = "autoformAutoRunOnOpen";
  const skipTypes = new Set([
    "hidden", "file", "submit", "button", "reset", "radio", "checkbox",
    "range", "date", "time", "color", "image"
  ]);
  const MIN_INPUTS_FOR_AUTO = 3;
  const MIN_FORM_CONTROLS_FOR_REMOTE = 3;
  const KNOWN_MESSAGE_TYPES = new Set([
    "autoform_execute_json",
    "autoform_manual_fill",
    "autoform_count_inputs",
    "autoform_apply_send_content",
    "autoform_request_input_count"
  ]);
  const SEND_CONTENT_STORAGE_KEY = "autoformSendContent";
  const FLOATING_BUTTON_STORAGE_KEY = "autoformShowFloatingButton";
  const FLOATING_BUTTON_LABEL_DEFAULT = "自動入力を実行";
  const FLOATING_BUTTON_DEFAULT_BACKGROUND = "linear-gradient(135deg, #0ea5e9, #6366f1)";
  const FLOATING_BUTTON_DEFAULT_SHADOW = "0 16px 32px rgba(99, 102, 241, 0.35)";
  const FLOATING_BUTTON_SUCCESS_BACKGROUND = "linear-gradient(135deg, #10b981, #22c55e)";
  const FLOATING_BUTTON_SUCCESS_SHADOW = "0 16px 32px rgba(16, 185, 129, 0.35)";
  const COMPLETION_COUNTDOWN_SECONDS = 3;
  const FLOATING_BUTTON_RESET_FADE_MS = 280;
  const FLOATING_BUTTON_RESET_SWAP_DELAY_MS = 140;
  const DEFAULT_SEND_RECORD = {
    name: "阿部 由希子",
    name_kana: "あべ ゆきこ",
    company: "株式会社LASSIC",
    "部署": "Remogu事業部",
    "住所": "東京都港区高輪1-3-13 NBF高輪ビル 4F",
    postal_code: "108-0074",
    company_kana: "かぶしきがいしゃ らしっく",
    prefecture: "東京都",
    email: "y.abe@lassic.co.jp",
    tel: "03-6455-7720",
    fax: "03-6455-7720",
    title: "エンジニア採用・調達に関する新規お打ち合わせのご提案",
    "業種": "IT人材紹介サービス",
    URL: "https://www.lassic.co.jp",
    remark:
      "お世話になっております。\n株式会社LASSICの阿部と申します。\n\n本日はエンジニア採用・調達における新規のお打ち合わせの件でご連絡いたしました。\n\n弊社ではIT人材特化型の紹介サービスを展開しておりまして、全国47都道府県から集客した1万人超のデータベースを基に、エンジニアをご紹介させていただいております。\n直近では「React、Next.jsでのフロントエンド開発」のご経験をお持ちの方や「PM、テックリード」のご経験をお持ちの方にも多数ご登録いただいております。\n\nRemoguサービスの強み：\n★実務経験3年以上の即戦力エンジニア/デザイナーが1万8000名ご登録\n★フルリモートワークからハイブリッドワークが可能な方まで幅広い人材バラエティ\n★フリーランス人材/中途採用双方でご支援可能\n★直近上流工程の開発やPM/PL・テックリードのご経験をお持ちの方の流入あり\n★開発系の言語からAI系、ゲーム系言語まで対応可能\n\nこちらのリンクより弊サービスについてご確認いただけますので、ご判断の材料にしていただけますと幸いです。\nhttps://www.lassic.co.jp/service/remogu/\n\nご多忙の中大変恐縮ではございますが、一度オンラインでのお打ち合わせの機会をいただけないでしょうか。\n現時点でのご活用ではなく、情報交換でも構いません。\nもしお話可能でしたら、オンラインにて30～60分ほどミーティングの機会をいただけますと幸いです。\n\n日程調整：https://nitte.app/QY6j3DQE60gxhQk40G8ulgiA5B63/42351ab0\n\nご検討のほど、よろしくお願い申し上げます。"
  };

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
  let masterEnabled = true;
  let autoRunOnOpen = true;
  let lastReportedInputCount = null;
  let inputCountReportTimer = null;

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

  function showCompletionNotice(durationSeconds = null) {
    if (showFloatingButtonCompletion(durationSeconds)) {
      return;
    }
    const formatted = formatDuration(durationSeconds);
    const message = formatted
      ? `✅ ${formatted}秒で入力が完了しました`
      : "✅ 自動入力が完了しました";
    const notice = createNoticeElement(message, "rgba(34, 197, 94, 0.95)");
    notice.style.bottom = "16px";
    (document.body || document.documentElement).appendChild(notice);
    setTimeout(() => notice.remove(), 2500);
  }

  function removeFloatingButton() {
    if (!floatingButton) return;
    floatingButton.removeEventListener("click", handleFloatingButtonClick);
    floatingButton.remove();
    floatingButton = null;
    clearFloatingButtonCompletionTimer();
  }

  function createFloatingButtonElement() {
    if (floatingButton || typeof document === "undefined") return;
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
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = FLOATING_BUTTON_LABEL_DEFAULT;
    Object.assign(btn.style, {
      position: "fixed",
      bottom: "24px",
      right: "24px",
      padding: "11px 18px",
      borderRadius: "999px",
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
    applyFloatingButtonDefaultStyle(btn);
    btn.addEventListener("click", handleFloatingButtonClick);
    document.body.appendChild(btn);
    floatingButton = btn;
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

  async function handleFloatingButtonClick(event) {
    event.preventDefault();
    if (floatingButtonBusy) return;
    floatingButtonBusy = true;
    autoFillTriggered = true;
    const btn = floatingButton;
    const originalText = btn?.textContent;
    if (btn) {
      clearFloatingButtonCompletionTimer();
      floatingButtonCompletionPending = false;
      btn.textContent = "処理中…";
      btn.disabled = true;
      btn.style.opacity = "0.85";
      applyFloatingButtonDefaultStyle(btn);
    }
    try {
      await performRemoteFill();
    } finally {
      floatingButtonBusy = false;
      if (btn) {
        if (!floatingButtonCompletionPending) {
          btn.textContent = originalText || FLOATING_BUTTON_LABEL_DEFAULT;
          btn.disabled = false;
          btn.style.opacity = "1";
          applyFloatingButtonDefaultStyle(btn);
        }
      }
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

  async function performRemoteFill() {
    if (remoteFillPromise) return remoteFillPromise;
    remoteFillPromise = (async () => {
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
        return { error: "フォーム候補が見つからないためAPIリクエストをスキップしました" };
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
        const { items, durationMs } = await requestFormItemsViaBackground(html, sendRecord, pageUrl);
        const applied = applyJsonInstructions(items);
        if (applied.success > 0) {
          const durationSeconds = typeof durationMs === "number" ? durationMs / 1000 : null;
          showCompletionNotice(durationSeconds);
        }
        return { applied };
      } catch (err) {
        console.error("[AutoForm] API 実行でエラー", err);
        return { error: err?.message || "APIエラー" };
      }
    })();
    const result = await remoteFillPromise;
    remoteFillPromise = null;
    return result;
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
            reject(new Error(response.error));
            return;
          }
          const items = response?.items;
          if (!Array.isArray(items)) {
            reject(new Error("APIレスポンスが配列形式ではありません"));
            return;
          }
          resolve({ items, durationMs: response?.durationMs });
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

  function showFloatingButtonCompletion(durationSeconds) {
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
      btn.textContent = FLOATING_BUTTON_LABEL_DEFAULT;
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

  function countEligibleInputs(root = document) {
    const scope = root && typeof root.querySelectorAll === "function" ? root : document;
    const nodes = scope.querySelectorAll("input, textarea");
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
    const scope = root && typeof root.querySelectorAll === "function" ? root : document;
    try {
      return scope.querySelectorAll("input, textarea, select").length;
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
      performRemoteFill().then((result) => {
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

    if (success > 0) showCompletionNotice();
    return { total: entries.length, success, filledKeys };
  }

  function handleCommand(command, payload) {
    if (command === "autoform_execute_json") {
      const applied = applyJsonInstructions(payload);
      if (applied.success > 0) {
        showCompletionNotice();
      }
      return { applied };
    }
    if (command === "autoform_manual_fill") {
      return performRemoteFill().then((result) => {
        if (result?.applied) {
          return {
            filled: result.applied.success || 0,
            applied: result.applied
          };
        }
        return { error: result?.error || "入力に失敗しました" };
      });
    }
    if (command === "autoform_count_inputs") {
      return { count: countEligibleInputs(document) };
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
    }, 10000);
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
    autoRunOnOpen = value !== false;
    updateAutoFillState();
  }

  function init() {
    if (!chrome?.storage?.sync) {
      startAutoFill();
      updateFloatingButtonVisibility(false);
      return;
    }

    chrome.storage.sync.get([STORAGE_KEY, AUTO_RUN_STORAGE_KEY, FLOATING_BUTTON_STORAGE_KEY], (res) => {
      masterEnabled = res?.[STORAGE_KEY] !== false;
      autoRunOnOpen = res?.[AUTO_RUN_STORAGE_KEY] !== false;
      updateFloatingButtonVisibility(res?.[FLOATING_BUTTON_STORAGE_KEY] === true);
      updateAutoFillState();
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync") return;
      if (changes[STORAGE_KEY]) {
        applyEnabledState(changes[STORAGE_KEY].newValue !== false);
      }
      if (changes[AUTO_RUN_STORAGE_KEY]) {
        applyAutoRunState(changes[AUTO_RUN_STORAGE_KEY].newValue !== false);
      }
      if (changes[FLOATING_BUTTON_STORAGE_KEY]) {
        updateFloatingButtonVisibility(changes[FLOATING_BUTTON_STORAGE_KEY].newValue === true);
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
