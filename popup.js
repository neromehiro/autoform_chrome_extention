(() => {
  const DATA_KEY = "autoformImportedJson";
  const SEND_STORAGE_KEY = "autoformSendContent";
  const SEND_PRESET_STORAGE_KEY = "autoformSendPresets";
  const FLOATING_BUTTON_STORAGE_KEY = "autoformShowFloatingButton";
  const AUTO_BUTTON_STORAGE_KEY = "autoformShowAutoButton";
  const API_KEY_STORAGE_KEY = "aimsalesApiKey";
  const SERVER_BASE =
    RuntimeConfig?.DEFAULT_SERVER_BASE ||
    "https://autoform-chrome-extention-server-csasaeerewb7b9ga.japaneast-01.azurewebsites.net/chrome_extension";
  const DEFAULT_PLAN = "free";
  const PRIORITY_UNLIMITED_THRESHOLD = 10000;
  const PRIORITY_UNLIMITED_LABEL = "∞ ※ 期間限定";
  const FREE_PLAN_EXHAUSTED_MESSAGE = "本日の利用可能数を使い切りました。Aimsalesなら常時優先・一括送信が可能です";
  const FREE_PLAN_EXHAUSTED_NOTE = `${FREE_PLAN_EXHAUSTED_MESSAGE} https://forms.gle/FWkuxr8HenuLkARC7`;
  const PRIORITY_COUNT_LABEL_DEFAULT = "本日の残り回数";
  const PRIORITY_COUNT_LABEL_EMPTY = "本日の残り回数はありません";
  const PAID_API_KEY_PROMPT = "APIキーを入力してください";
  const PAID_EDITION_UNLIMITED_LABEL = "∞";
  const clone = (value) => JSON.parse(JSON.stringify(value || {}));
  const shuffleArray = (input) => {
    if (!Array.isArray(input)) return [];
    const result = input.slice();
    for (let index = result.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      const temp = result[index];
      result[index] = result[swapIndex];
      result[swapIndex] = temp;
    }
    return result;
  };
  let runtimeConfig = clone(RuntimeConfig?.DEFAULTS || {});
  let EDITION = runtimeConfig?.edition || "free";
  let REQUIRE_API_KEY = EDITION === "paid";
  let currentQuotaState = runtimeConfig?.quota || null;
  let configReloadPromise = null;
  const DEFAULT_SEND_CONTENT = {
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
    remark: "お世話になっております。\n株式会社サンプルの営業部の田中です。\n\n突然のご連絡失礼いたします。\n弊社ではWeb制作や広告運用、SNS代行などを幅広く行っております。\nもし貴社でもそういったことをお考えでしたら、ぜひご相談ください。\n\nこれまで多くの企業様にご利用いただいており、皆様からご好評をいただいております。\nコーポレートサイトやECサイト、採用サイトなど制作可能です。\n\n現在、まさにサイト作成でお悩みでしたら、\n一度、ぜひお打ち合わせさせてください。\n\n日程調整はこちらからお願いいたしますhttps://app.spirinc.com/patterns/availability-sharing/4HBCM9QxxRR7l4zx69xoq/confirm\n\nよろしくお願いいたします。\n\n株式会社サンプル 営業部 田中 一真"
  };
  const DEFAULT_PROMO_CARDS = [
    {
      id: "aimsales-pro",
      label: "Aimsales Proのご案内",
      html: `
        <div class="promo-card-eyebrow">AIMSALES PRO</div>
        <h3 class="promo-card-title">営業フォームの入力を、AIで完全自動化</h3>
        <p class="promo-card-lead">
          Aimsales Pro はフォーム営業を一連のワークフローとして最適化し、
          チームの反応速度を最大化します。
        </p>
        <ul class="promo-card-highlights">
          <li>AIがフォーム構造を即時解析し最適な入力を提案</li>
          <li>社内の送信履歴をスコア化し、勝ち筋テンプレを共有</li>
          <li>Salesforce・HubSpot連携で進捗を自動で同期</li>
        </ul>
        <a
          class="promo-card-cta"
          href="https://forms.gle/FWkuxr8HenuLkARC7"
          target="_blank"
          rel="noreferrer noopener"
        >
          資料ダウンロード
        </a>
      `.trim()
    },
    {
      id: "aimsales-lp",
      label: "Aimsalesの特徴まとめ",
      html: `
        <div class="promo-card-eyebrow is-outline">WHY AIMSALES</div>
        <h3 class="promo-card-title">1クリックで営業フォームを完了</h3>
        <p class="promo-card-lead">
          反応率を落とさずに送信量を伸ばしたいチームのための
          全自動AI営業ツールです。
        </p>
        <dl class="promo-card-metrics">
          <div>
            <dt>平均作業時間</dt>
            <dd><strong>▲72%</strong></dd>
          </div>
          <div>
            <dt>導入チーム</dt>
            <dd><strong>120社以上</strong></dd>
          </div>
          <div>
            <dt>フォーム対応数</dt>
            <dd><strong>200種+</strong></dd>
          </div>
        </dl>
        <a
          class="promo-card-cta is-secondary"
          href="https://aimsales.jp"
          target="_blank"
          rel="noreferrer noopener"
        >
          事例を見る
        </a>
      `.trim()
    }
  ];

  let currentData = null;
  let currentSendContent = null;
  let currentSendPresetId = "preset-1";
  let sendPresets = {
    activeId: "preset-1",
    presets: { "preset-1": { name: "プリセット1", data: DEFAULT_SEND_CONTENT } }
  };
  let currentApiKey = "";
  const AUTO_SAVE_DEBOUNCE_MS = 800;
  let autoSaveTimerId = null;
  let lastAutoSavedSnapshot = null;
  let fillNowButton = null;
  let promoScrollAnimationFrame = null;
  let popupDomReady = false;
  let lastPriorityDisplay = null;

  const hasTrimmedApiKey = () => Boolean(currentApiKey && currentApiKey.trim());
  const isPaidEdition = () => EDITION === "paid";
  const hasPaidAccess = () => isPaidEdition() && hasTrimmedApiKey();

  const getApiKeyInputs = () => Array.from(document.querySelectorAll("[data-api-key-input]"));
  const setApiKeyInputsValue = (value) => {
    getApiKeyInputs().forEach((input) => {
      if (document.activeElement === input) return;
      input.value = value;
    });
  };

  function applyRuntimeConfigUpdate(nextConfig) {
    if (!nextConfig || typeof nextConfig !== "object") {
      return runtimeConfig;
    }
    runtimeConfig = nextConfig;
    EDITION = runtimeConfig?.edition || "free";
    REQUIRE_API_KEY = EDITION === "paid";
    applyApiKeyCardVisibility();
    applyManualFillAvailability();
    applyFloatingButtonEditionRules();
    return runtimeConfig;
  }

  function handleConfigReloadResult(config) {
    if (!config || typeof config !== "object") {
      return null;
    }
    applyRuntimeConfigUpdate(config);
    if (document.readyState !== "loading") {
      renderPromoBlock();
    }
    const quota = config?.quota && typeof config.quota === "object" ? config.quota : null;
    if (quota) {
      applyQuotaToUI(quota);
    }
    return quota;
  }

  function forceConfigReload(reason = "ui_request") {
    if (configReloadPromise) {
      return configReloadPromise;
    }
    const plan = EDITION || DEFAULT_PLAN;
    if (!chrome?.runtime?.sendMessage || typeof RuntimeConfig?.loadRuntimeConfig !== "function") {
      const loader = RuntimeConfig?.loadRuntimeConfig
        ? RuntimeConfig.loadRuntimeConfig({ serverBase: SERVER_BASE, plan, forceReload: true })
            .then((cfg) => handleConfigReloadResult(cfg))
            .catch((err) => {
              console.error("[AutoForm] config refresh failed", err);
              return null;
            })
        : Promise.resolve(null);
      configReloadPromise = loader.finally(() => {
        configReloadPromise = null;
      });
      return configReloadPromise;
    }
    configReloadPromise = new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: "autoform_refresh_runtime_config", reason },
        (response) => {
          if (chrome.runtime?.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message });
            return;
          }
          resolve(response || { ok: false });
        }
      );
    })
      .then((response) => {
        if (response?.ok && response.config) {
          return handleConfigReloadResult(response.config);
        }
        const quota = response?.quota && typeof response.quota === "object" ? response.quota : null;
        if (quota) {
          applyQuotaToUI(quota);
        }
        return quota;
      })
      .catch((err) => {
        console.error("[AutoForm] config refresh failed", err);
        return null;
      })
      .finally(() => {
        configReloadPromise = null;
      });
    return configReloadPromise;
  }

  const runtimeConfigReady =
    typeof RuntimeConfig?.loadRuntimeConfig === "function"
      ? RuntimeConfig.loadRuntimeConfig({ serverBase: SERVER_BASE, plan: EDITION || DEFAULT_PLAN })
          .then((cfg) => {
            applyRuntimeConfigUpdate(cfg || runtimeConfig || {});
            return runtimeConfig;
          })
          .catch((err) => {
            console.error("[AutoForm] failed to load runtime config", err);
            applyRuntimeConfigUpdate(runtimeConfig);
            return runtimeConfig;
          })
      : Promise.resolve(runtimeConfig);

  function qs(id) {
    return document.getElementById(id);
  }

  function setStatus(message, isError = false) {
    const statusEl = qs("import-status");
    if (statusEl) {
      statusEl.textContent = message;
      statusEl.style.color = isError ? "#b91c1c" : "#555";
    }
    updateExecuteState();
  }

  function setManualStatus(message, isError = false) {
    const statusEl = qs("manual-status");
    if (!statusEl) return;
    const hasMessage = Boolean(message);
    statusEl.textContent = hasMessage ? message : "";
    statusEl.classList.toggle("error", Boolean(isError && hasMessage));
    statusEl.style.color = hasMessage ? (isError ? "#b91c1c" : "#475569") : "";
    statusEl.hidden = !hasMessage;
  }

  function formatDetectionCountMessage(count) {
    if (typeof count !== "number" || !Number.isFinite(count)) {
      return "入力欄の検知状況を取得できませんでした";
    }
    if (count <= 0) {
      return "入力欄はまだ検知されていません。";
    }
    return `${count}件以上の入力欄を検知しました。`;
  }

  function setInputCountStatus(value, isError = false) {
    const countEl = qs("input-count");
    if (countEl) {
      const message =
        typeof value === "number" && Number.isFinite(value) ? formatDetectionCountMessage(value) : value;
      countEl.textContent = message;
      countEl.classList.toggle("error", Boolean(isError));
    }
  }

  function setGoogleFormStatus(message, isError = false) {
    const statusEl = qs("google-form-status");
    if (!statusEl) return;
    const hasMessage = Boolean(message);
    statusEl.textContent = hasMessage ? message : "";
    statusEl.classList.toggle("error", Boolean(isError && hasMessage));
    statusEl.style.color = hasMessage ? (isError ? "#b91c1c" : "#64748b") : "";
    statusEl.hidden = !hasMessage;
  }

  function normalizeGoogleFormUrlList(urls) {
    if (!Array.isArray(urls)) return [];
    const unique = new Set();
    urls.forEach((url) => {
      if (typeof url !== "string") return;
      const trimmed = url.trim();
      if (!trimmed) return;
      unique.add(trimmed);
    });
    return Array.from(unique);
  }

  function renderGoogleFormUrls(urls, options = {}) {
    const listEl = qs("google-form-list");
    const emptyEl = qs("google-form-empty");
    if (!listEl || !emptyEl) return;
    listEl.innerHTML = "";
    const normalized = normalizeGoogleFormUrlList(urls);
    if (!normalized.length) {
      emptyEl.style.display = options.showEmpty === false ? "none" : "block";
      return;
    }
    emptyEl.style.display = "none";
    normalized.forEach((url, index) => {
      const item = document.createElement("li");
      item.className = "google-form-item";

      const label = document.createElement("span");
      label.className = "google-form-item-label";
      label.textContent = `URL ${index + 1}`;

      const link = document.createElement("a");
      link.className = "google-form-link";
      link.href = url;
      link.target = "_blank";
      link.rel = "noreferrer noopener";
      link.textContent = url;

      item.appendChild(label);
      item.appendChild(link);
      listEl.appendChild(item);
    });
  }

  function setSendContentStatus(message, isError = false) {
    const statusEl = qs("send-content-status");
    if (statusEl) {
      statusEl.textContent = message;
      statusEl.style.color = isError ? "#b91c1c" : "#555";
    }
  }

  function setFillNowEnabled(enabled) {
    if (fillNowButton) {
      fillNowButton.disabled = !enabled;
    }
  }

  function hasQuotaRemaining(quota = currentQuotaState) {
    if (priorityConfigIndicatesUnlimited()) {
      return true;
    }
    if (!quota) return true;
    const remaining = quota?.remaining;
    if (remaining === Infinity) return true;
    if (typeof remaining === "string") {
      const normalized = remaining.trim().toLowerCase();
      if (normalized === "infinity" || normalized === "inf") {
        return true;
      }
    }
    const numeric = Number(remaining);
    if (!Number.isFinite(numeric)) return true;
    return numeric > 0;
  }

  function applyManualFillAvailability() {
    const planPaid = isPaidEdition();
    const quotaOk = planPaid ? true : hasQuotaRemaining();
    const accessOk = planPaid ? hasPaidAccess() : true;
    const enabled = quotaOk && accessOk;
    setFillNowEnabled(enabled);
    if (!enabled) {
      if (planPaid && !hasPaidAccess()) {
        setManualStatus("APIキーを設定すると入力できます", true);
      } else if (!planPaid && !quotaOk) {
        setManualStatus(FREE_PLAN_EXHAUSTED_MESSAGE, true);
      }
    } else {
      const statusEl = qs("manual-status");
      if (statusEl) {
        const text = statusEl.textContent?.trim();
        if (text === FREE_PLAN_EXHAUSTED_MESSAGE || text === "APIキーを設定すると入力できます") {
          setManualStatus("");
        }
      }
    }
    return enabled;
  }

  function setFloatingButtonStatus(message, isError = false) {
    const statusEl = qs("floating-button-status");
    if (!statusEl) return;
    if (shouldSuppressFloatingButtonControls()) {
      statusEl.textContent = "";
      statusEl.style.display = "none";
      return;
    }
    statusEl.textContent = message || "";
    statusEl.style.color = isError ? "#dc2626" : "#64748b";
    statusEl.style.display = message ? "block" : "none";
  }

  function setPlanStatus() {
    const planEl = qs("plan-status");
    const badgeEl = qs("plan-badge");
    const manualPillEl = qs("manual-plan-pill");
    const planPaid = isPaidEdition();
    const label = planPaid ? "有料版" : "無料版";
    if (planEl) {
      planEl.textContent = label;
      planEl.classList.toggle("plan-status-paid", planPaid);
    }
    if (badgeEl) {
      badgeEl.textContent = label;
      badgeEl.classList.toggle("plan-badge-paid", planPaid);
    }
    if (manualPillEl) {
      manualPillEl.textContent = label;
      manualPillEl.classList.toggle("is-paid", planPaid);
    }
  }

  function setApiKeyStatus(message, isError = false) {
    const statusEl = qs("api-key-status");
    if (!statusEl) return;
    if (!isPaidEdition()) {
      statusEl.textContent = "このプランではAPIキーは不要です";
      statusEl.style.color = "#475569";
      return;
    }
    statusEl.textContent = message;
    statusEl.style.color = isError ? "#b91c1c" : "#475569";
  }

  function shouldSuppressFloatingButtonControls() {
    return false;
  }

  function applyFloatingButtonEditionRules() {
    const hide = shouldSuppressFloatingButtonControls();
    if (!popupDomReady) return;
    const row = document.querySelector("[data-floating-button-row]");
    const checkbox = qs("show-floating-button");
    const statusEl = qs("floating-button-status");
    if (row) {
      row.style.display = hide ? "none" : "";
    }
    if (checkbox) {
      checkbox.disabled = hide;
      if (hide) {
        checkbox.checked = false;
      }
    }
    if (statusEl) {
      if (hide) {
        statusEl.textContent = "";
      }
      const hasMessage = Boolean(statusEl.textContent && !hide);
      statusEl.style.display = hasMessage ? "block" : "none";
    }
  }

  function applyApiKeyCardVisibility() {
    const card = document.querySelector(".api-key-card");
    const inlineCard = document.getElementById("api-key-inline-card");
    const planRequiresKey = isPaidEdition();
    if (!planRequiresKey) {
      if (inlineCard) {
        inlineCard.classList.remove("is-visible");
      }
      if (card) {
        card.style.display = "none";
      }
      return;
    }
    const needsInline = !hasTrimmedApiKey();
    if (inlineCard) {
      inlineCard.classList.toggle("is-visible", needsInline);
    }
    if (card) {
      card.style.display = "";
    }
  }

  function setPriorityNumberDisplay(text, options = {}) {
    const { hideUnit = false } = options;
    const nodes = new Set();
    const legacy = document.getElementById("priority-remaining");
    if (legacy) nodes.add(legacy);
    document.querySelectorAll("[data-priority-number]").forEach((el) => nodes.add(el));
    const needsCompactDisplay = text === PAID_API_KEY_PROMPT;
    const shouldHideUnit =
      hideUnit ||
      text === PAID_API_KEY_PROMPT ||
      text === PAID_EDITION_UNLIMITED_LABEL ||
      text === PRIORITY_UNLIMITED_LABEL;
    nodes.forEach((node) => {
      node.textContent = text;
      node.classList.toggle("priority-number-small", needsCompactDisplay);
    });
    document.querySelectorAll("[data-priority-unit]").forEach((unit) => {
      unit.style.display = shouldHideUnit ? "none" : "inline";
    });
    triggerPriorityFigurePulse(text);
  }

  function setPriorityNoteVisibility(message, visible) {
    const nodes = new Set();
    const legacy = document.getElementById("priority-note");
    if (legacy) nodes.add(legacy);
    document.querySelectorAll(".priority-note").forEach((el) => nodes.add(el));
    nodes.forEach((node) => {
      if (typeof message === "string") {
        renderPriorityNoteMessage(node, message);
      }
      node.style.display = visible ? "block" : "none";
    });
  }

  function renderPriorityNoteMessage(node, message) {
    if (!node) return;
    if (typeof message !== "string" || !message) {
      node.textContent = "";
      return;
    }
    const urlMatch = message.match(/https?:\/\/\S+/);
    if (!urlMatch) {
      node.textContent = message;
      return;
    }
    const [url] = urlMatch;
    const prefix = message.slice(0, urlMatch.index);
    const suffix = message.slice(urlMatch.index + url.length);
    node.textContent = "";
    if (prefix) {
      node.appendChild(document.createTextNode(prefix));
    }
    const link = document.createElement("a");
    link.href = url;
    link.textContent = url;
    link.target = "_blank";
    link.rel = "noreferrer noopener";
    node.appendChild(link);
    if (suffix) {
      node.appendChild(document.createTextNode(suffix));
    }
  }

  function computePaidPlanUiState(rawPlan) {
    if (!rawPlan || typeof rawPlan !== "object") {
      return { remainingLabel: "", note: "" };
    }
    const remainingCandidate = rawPlan.remaining_days ?? rawPlan.remainingDays;
    const remainingValue = Number(remainingCandidate);
    const showRemaining = Number.isFinite(remainingValue) && remainingValue >= 0 && remainingValue < 30;
    const remainingLabel = showRemaining ? `有効日数あと${remainingValue}日` : "";
    const note = typeof rawPlan.note === "string" ? rawPlan.note.trim() : "";
    return { remainingLabel, note };
  }

  function setPaidPlanNote(message) {
    const noteEl = document.getElementById("priority-paid-note");
    if (!noteEl) return;
    const normalized = typeof message === "string" ? message.trim() : "";
    if (normalized) {
      noteEl.textContent = normalized;
      noteEl.style.display = "block";
    } else {
      noteEl.textContent = "";
      noteEl.style.display = "none";
    }
  }

  function getPriorityCardElement() {
    return document.querySelector("[data-priority-card]") || document.querySelector(".priority-card");
  }

  function setPriorityCardMode(mode) {
    const card = getPriorityCardElement();
    if (!card) return;
    card.dataset.mode = mode || "";
    card.classList.toggle("is-shared", mode === "shared");
  }

  function setPriorityCardVisible(visible) {
    const card = getPriorityCardElement();
    if (!card) return;
    const isVisible = Boolean(visible);
    if (isVisible) {
      card.style.display = "";
      card.removeAttribute("hidden");
      card.setAttribute("aria-hidden", "false");
      card.dataset.priorityHidden = "0";
    } else {
      card.style.display = "none";
      card.setAttribute("hidden", "true");
      card.setAttribute("aria-hidden", "true");
      card.dataset.priorityHidden = "1";
    }
  }

  function setPriorityCountLabel(isEmpty, options = {}) {
    const label = document.querySelector(".priority-count-label");
    if (!label) return;
    const baseText = isEmpty ? PRIORITY_COUNT_LABEL_EMPTY : PRIORITY_COUNT_LABEL_DEFAULT;
    const suffix = typeof options.suffixText === "string" ? options.suffixText.trim() : "";
    label.textContent = suffix ? `${baseText}（${suffix}）` : baseText;
  }

  function setPriorityWarningState(active) {
    const badge = document.getElementById("priority-warning");
    if (!badge) return;
    badge.classList.toggle("is-visible", Boolean(active));
    badge.setAttribute("aria-hidden", (!active).toString());
  }

  function triggerPriorityFigurePulse(nextDisplay) {
    if (nextDisplay === lastPriorityDisplay) return;
    lastPriorityDisplay = nextDisplay;
    const figures = document.querySelectorAll(".priority-figure");
    figures.forEach((figure) => {
      figure.classList.remove("is-updated");
      void figure.offsetWidth;
      figure.classList.add("is-updated");
      setTimeout(() => figure.classList.remove("is-updated"), 900);
    });
  }

  function meetsUnlimitedThreshold(value) {
    if (value == null) return false;
    if (value === Infinity) return true;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "infinity" || normalized === "inf") {
        return true;
      }
    }
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= PRIORITY_UNLIMITED_THRESHOLD;
  }

  function priorityConfigIndicatesUnlimited() {
    const priorityRules = runtimeConfig?.rules?.priority;
    if (!priorityRules) return false;
    return [priorityRules.dailyInitial, priorityRules.dailyAfter].some((value) => meetsUnlimitedThreshold(value));
  }

  function parseQuotaNumber(value) {
    if (value === Infinity) return Infinity;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) return null;
      const normalized = trimmed.toLowerCase();
      if (normalized === "infinity" || normalized === "inf") {
        return Infinity;
      }
      const numeric = Number(trimmed);
      return Number.isFinite(numeric) ? numeric : null;
    }
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : null;
    }
    return null;
  }

  function getConfiguredPriorityThreshold() {
    const configured = runtimeConfig?.ui?.priorityCard?.showWhenRemainingAtMost;
    if (configured == null) return null;
    const numeric = Number(configured);
    if (!Number.isFinite(numeric) || numeric < 0) return null;
    return Math.max(0, Math.floor(numeric));
  }

  function getPriorityCardFallbackLimit(limitValue) {
    if (Number.isFinite(limitValue) && limitValue > 0) {
      return limitValue;
    }
    const priorityRules = runtimeConfig?.rules?.priority;
    if (!priorityRules) return null;
    const candidates = [
      parseQuotaNumber(priorityRules.dailyInitial),
      parseQuotaNumber(priorityRules.dailyAfter)
    ];
    const fallback = candidates.find((value) => Number.isFinite(value) && value > 0);
    return fallback ?? null;
  }

  function resolvePriorityCardThreshold(limitValue) {
    const configured = getConfiguredPriorityThreshold();
    if (configured != null) {
      return configured;
    }
    const fallbackLimit = getPriorityCardFallbackLimit(limitValue);
    if (!Number.isFinite(fallbackLimit) || fallbackLimit <= 0) {
      return null;
    }
    return Math.max(0, Math.floor(fallbackLimit / 2));
  }

  function shouldDisplayPriorityCard(remainingValue, limitValue) {
    const threshold = resolvePriorityCardThreshold(limitValue);
    if (threshold == null) return true;
    if (!Number.isFinite(remainingValue)) return true;
    return remainingValue <= threshold;
  }

  function isQuotaUnlimited(quota) {
    if (!quota || typeof quota !== "object") return false;
    const plan = typeof quota.plan === "string" ? quota.plan.trim().toLowerCase() : "";
    if (plan === "unlimited") return true;
    const mode = typeof quota.mode === "string" ? quota.mode.trim().toLowerCase() : "";
    if (mode === "unlimited") return true;
    const remainingValue = parseQuotaNumber(quota.remaining);
    const limitValue = parseQuotaNumber(quota.daily_limit ?? quota.limit);
    return meetsUnlimitedThreshold(remainingValue) || meetsUnlimitedThreshold(limitValue);
  }

  function quotaIndicatesDepleted(quota) {
    if (!quota || typeof quota !== "object") return false;
    const remaining = quota.remaining;
    if (remaining === Infinity || remaining === "Infinity") return false;
    if (remaining == null) return false;
    const numeric = Number(remaining);
    if (!Number.isFinite(numeric)) return false;
    return numeric <= 0;
  }

  function isQuotaExhaustedError(info = {}) {
    if (!info || typeof info !== "object") return false;
    const { code, message, quota } = info;
    if (code === "FREE_QUOTA_LIMIT") return true;
    if (quotaIndicatesDepleted(quota)) return true;
    if (typeof message !== "string") return false;
    return message.trim() === FREE_PLAN_EXHAUSTED_MESSAGE.trim();
  }

  function getBasePromoCards(carousel) {
    if (!carousel) return [];
    return Array.from(carousel.querySelectorAll(".promo-card")).filter((card) => card.dataset.promoClone !== "1");
  }

  function scrollPromoToIndex(index) {
    if (typeof index !== "number" || index < 0) return;
    const carousel = document.getElementById("dynamic-info-content");
    if (!carousel) return;
    const cards = getBasePromoCards(carousel);
    const target = cards[index];
    if (!target) return;
    const firstCard = cards[0];
    const baseOffset = firstCard ? firstCard.offsetLeft : 0;
    const relativeOffset = target.offsetLeft - baseOffset;
    const destination = baseOffset + relativeOffset;
    carousel.scrollTo({ left: destination, behavior: "smooth" });
  }

  function initPromoCarouselDots(count) {
    const dotsContainer = document.getElementById("promo-carousel-dots");
    if (!dotsContainer) return;
    dotsContainer.innerHTML = "";
    if (!count || count <= 1) {
      dotsContainer.classList.add("is-hidden");
      dotsContainer.setAttribute("aria-hidden", "true");
      return;
    }
    dotsContainer.classList.remove("is-hidden");
    dotsContainer.setAttribute("aria-hidden", "false");
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < count; index += 1) {
      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = "promo-dot";
      dot.setAttribute("role", "tab");
      dot.setAttribute("aria-label", `お知らせ ${index + 1}`);
      dot.setAttribute("aria-pressed", "false");
      dot.tabIndex = index === 0 ? 0 : -1;
      dot.addEventListener("click", () => scrollPromoToIndex(index));
      fragment.appendChild(dot);
    }
    dotsContainer.appendChild(fragment);
  }

  function updatePromoDotsActive() {
    const dotsContainer = document.getElementById("promo-carousel-dots");
    const carousel = document.getElementById("dynamic-info-content");
    if (!dotsContainer || !carousel) return;
    const dots = dotsContainer.querySelectorAll(".promo-dot");
    const cards = getBasePromoCards(carousel);
    if (!dots.length || !cards.length) return;
    let activeIndex = 0;
    const firstCard = cards[0];
    const baseOffset = firstCard ? firstCard.offsetLeft : 0;
    const viewportCenter = carousel.scrollLeft - baseOffset + carousel.clientWidth / 2;
    cards.forEach((card, index) => {
      const cardCenter = card.offsetLeft - baseOffset + card.offsetWidth / 2;
      const activeCenter = cards[activeIndex].offsetLeft - baseOffset + cards[activeIndex].offsetWidth / 2;
      if (Math.abs(cardCenter - viewportCenter) < Math.abs(activeCenter - viewportCenter)) {
        activeIndex = index;
      }
    });
    dots.forEach((dot, index) => {
      const isActive = index === activeIndex;
      dot.classList.toggle("is-active", isActive);
      dot.setAttribute("aria-pressed", isActive.toString());
      dot.tabIndex = isActive ? 0 : -1;
    });
  }

  function preparePromoCarouselLoop(carousel, cardCount) {
    if (!carousel) return;
    if (!Number.isFinite(cardCount) || cardCount < 2) return;
    const baseCards = getBasePromoCards(carousel);
    if (baseCards.length < 2) return;
    const setWidth = (() => {
      const firstCard = baseCards[0];
      const lastCard = baseCards[baseCards.length - 1];
      if (!firstCard || !lastCard) return 0;
      const firstOffset = firstCard.offsetLeft;
      const lastEdge = lastCard.offsetLeft + lastCard.offsetWidth;
      return Math.max(0, lastEdge - firstOffset);
    })();
    const beforeFragment = document.createDocumentFragment();
    for (let index = baseCards.length - 1; index >= 0; index -= 1) {
      const prependClone = baseCards[index].cloneNode(true);
      prependClone.dataset.promoClone = "1";
      beforeFragment.appendChild(prependClone);
    }
    const afterFragment = document.createDocumentFragment();
    baseCards.forEach((card) => {
      const appendClone = card.cloneNode(true);
      appendClone.dataset.promoClone = "1";
      afterFragment.appendChild(appendClone);
    });
    carousel.insertBefore(beforeFragment, carousel.firstChild);
    carousel.appendChild(afterFragment);
    requestAnimationFrame(() => {
      if (setWidth > 0) {
        carousel.scrollLeft = setWidth;
      }
    });
  }

  function bindPromoCarouselScroll() {
    const carousel = document.getElementById("dynamic-info-content");
    if (!carousel || carousel.dataset.promoDotsBound === "1") return;
    carousel.dataset.promoDotsBound = "1";
    carousel.addEventListener(
      "scroll",
      () => {
        if (promoScrollAnimationFrame) {
          cancelAnimationFrame(promoScrollAnimationFrame);
        }
        promoScrollAnimationFrame = requestAnimationFrame(() => {
          promoScrollAnimationFrame = null;
          updatePromoDotsActive();
        });
      },
      { passive: true }
    );
  }

  function applyQuotaToUI(quota) {
    currentQuotaState = quota || null;
    const finalizeQuotaUiUpdate = () => {
      applyManualFillAvailability();
      applyFloatingButtonEditionRules();
    };
    const hasPriorityView = document.getElementById("priority-remaining") || getPriorityCardElement();
    if (!hasPriorityView) {
      finalizeQuotaUiUpdate();
      return;
    }
    const planPaid = isPaidEdition();
    const apiKeyAvailable = hasTrimmedApiKey();
    setPriorityCountLabel(false);
    setPriorityWarningState(false);
    if (planPaid) {
      const paidPlanState = computePaidPlanUiState(runtimeConfig?.paid_plan);
      if (paidPlanState.remainingLabel) {
        setPriorityCountLabel(false, { suffixText: paidPlanState.remainingLabel });
      }
      setPaidPlanNote(paidPlanState.note);
      setPriorityCardVisible(true);
      if (!apiKeyAvailable) {
        setPriorityNumberDisplay("--");
        setPriorityCardMode("blocked");
        setPriorityNoteVisibility(PAID_API_KEY_PROMPT, true);
      } else {
        setPriorityNumberDisplay(PAID_EDITION_UNLIMITED_LABEL);
        setPriorityCardMode("priority");
        setPriorityNoteVisibility("", false);
      }
      finalizeQuotaUiUpdate();
      return;
    }
    setPaidPlanNote("");
    const configUnlimited = priorityConfigIndicatesUnlimited();
    if (!quota) {
      setPriorityCardVisible(true);
      if (configUnlimited) {
        setPriorityNumberDisplay(PRIORITY_UNLIMITED_LABEL);
        setPriorityCardMode("priority");
      } else {
        setPriorityNumberDisplay("--");
        setPriorityCardMode("unknown");
      }
      setPriorityNoteVisibility("", false);
      finalizeQuotaUiUpdate();
      return;
    }
    const formatFinite = (value) => String(Math.max(0, Math.floor(Number(value) || 0)));
    const remainingValue = parseQuotaNumber(quota.remaining);
    const limitValue = parseQuotaNumber(quota.daily_limit ?? quota.limit);
    const shouldShowCard = shouldDisplayPriorityCard(remainingValue, limitValue);
    setPriorityCardVisible(shouldShowCard);
    if (!shouldShowCard) {
      finalizeQuotaUiUpdate();
      return;
    }
    const unlimitedByQuota = meetsUnlimitedThreshold(remainingValue) || meetsUnlimitedThreshold(limitValue);
    const isUnlimited = unlimitedByQuota || configUnlimited;
    let display = "--";
    if (isUnlimited) {
      display = PRIORITY_UNLIMITED_LABEL;
    } else if (Number.isFinite(remainingValue) && Number.isFinite(limitValue)) {
      display = `${formatFinite(remainingValue)}/${formatFinite(limitValue)}`;
    } else if (Number.isFinite(remainingValue)) {
      display = formatFinite(remainingValue);
    }
    setPriorityNumberDisplay(display);
    const hasQuota = isUnlimited || remainingValue === null || remainingValue === Infinity || remainingValue > 0;
    const resolvedMode = hasQuota ? (isUnlimited ? "priority" : quota.mode || "priority") : "blocked";
    setPriorityCardMode(resolvedMode);
    const isDepleted = !hasQuota;
    setPriorityCountLabel(isDepleted);
    setPriorityWarningState(isDepleted);
    const noteMessage = isDepleted ? quota.message || FREE_PLAN_EXHAUSTED_NOTE : "";
    setPriorityNoteVisibility(noteMessage, isDepleted);
    finalizeQuotaUiUpdate();
  }

  function syncQuotaWithBackground(options = {}) {
    const { allowRefreshOnEmpty = true, reasonOnEmpty = "popup_quota_missing" } = options;
    if (!chrome?.runtime?.sendMessage) {
      return allowRefreshOnEmpty ? forceConfigReload(reasonOnEmpty) : Promise.resolve(null);
    }
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: "autoform_get_quota_state" }, (response) => {
          if (chrome.runtime?.lastError) {
            if (allowRefreshOnEmpty) {
              forceConfigReload(reasonOnEmpty)
                .then((quota) => resolve(quota))
                .catch(() => resolve(null));
            } else {
              resolve(null);
            }
            return;
          }
          if (typeof response?.edition === "string" && response.edition && response.edition !== EDITION) {
            EDITION = response.edition;
            runtimeConfig.edition = EDITION;
            REQUIRE_API_KEY = EDITION === "paid";
            applyApiKeyCardVisibility();
            setPlanStatus();
          }
          const quota = response?.quota || null;
          if (quota) {
            applyQuotaToUI(quota);
            resolve(quota);
            return;
          }
          if (!allowRefreshOnEmpty) {
            resolve(null);
            return;
          }
          forceConfigReload(reasonOnEmpty)
            .then((freshQuota) => resolve(freshQuota))
            .catch(() => resolve(null));
        });
      } catch (_) {
        if (allowRefreshOnEmpty) {
          forceConfigReload(reasonOnEmpty)
            .then((quota) => resolve(quota))
            .catch(() => resolve(null));
        } else {
          resolve(null);
        }
      }
    });
  }

  function initPriorityRefreshButton(button) {
    if (!button) return;
    const defaultLabel = button.getAttribute("aria-label") || "残り回数を再読み込み";
    const defaultTitle = button.getAttribute("title") || defaultLabel;
    const loadingLabel = `${defaultLabel}中`;
    const setLoading = (loading) => {
      button.disabled = loading;
      button.dataset.loading = loading ? "1" : "0";
      button.setAttribute("aria-busy", loading ? "true" : "false");
      button.setAttribute("aria-label", loading ? loadingLabel : defaultLabel);
      button.setAttribute("title", loading ? loadingLabel : defaultTitle);
    };
    button.addEventListener("click", () => {
      if (button.dataset.loading === "1") return;
      setLoading(true);
      forceConfigReload("priority_card_refresh_button")
        .then((quota) => {
          if (quota) return quota;
          return syncQuotaWithBackground({ allowRefreshOnEmpty: false });
        })
        .catch((err) => {
          console.error("[AutoForm] priority refresh failed", err);
        })
        .finally(() => {
          setLoading(false);
        });
    });
  }

  function initGoogleFormRefreshButton(button) {
    if (!button) return;
    const defaultLabel = button.getAttribute("aria-label") || "Google Form URLを再検出";
    const defaultTitle = button.getAttribute("title") || defaultLabel;
    const loadingLabel = `${defaultLabel}中`;
    const setLoading = (loading) => {
      button.disabled = loading;
      button.dataset.loading = loading ? "1" : "0";
      button.setAttribute("aria-busy", loading ? "true" : "false");
      button.setAttribute("aria-label", loading ? loadingLabel : defaultLabel);
      button.setAttribute("title", loading ? loadingLabel : defaultTitle);
    };
    button.addEventListener("click", () => {
      if (button.dataset.loading === "1") return;
      setLoading(true);
      refreshGoogleFormUrls()
        .catch((err) => {
          console.error("[AutoForm] google form refresh failed", err);
        })
        .finally(() => {
          setLoading(false);
        });
    });
  }

  function initPriorityDetails(container) {
    const root = container || document;
    root.querySelectorAll("[data-priority-details-toggle]").forEach((toggle) => {
      if (toggle.dataset.priorityBound === "1") return;
      const card = toggle.closest("[data-priority-card]") || root;
      const content = card.querySelector("[data-priority-details-content]");
      if (!content) return;
      toggle.dataset.priorityBound = "1";
      toggle.addEventListener("click", () => {
        const nextState = !content.classList.contains("is-open");
        content.classList.toggle("is-open", nextState);
        content.setAttribute("aria-hidden", (!nextState).toString());
        toggle.setAttribute("aria-expanded", nextState.toString());
      });
    });
  }


  function getPromoCardsFromConfig() {
    const cards = runtimeConfig?.ui?.popup?.ads?.cards;
    if (!Array.isArray(cards)) return [];
    return cards
      .map((card, index) => {
        if (!card) return null;
        if (typeof card === "string") {
          const trimmed = card.trim();
          return trimmed
            ? {
                id: `promo-card-${index + 1}`,
                label: `広告${index + 1}`,
                html: trimmed
              }
            : null;
        }
        const html = typeof card.html === "string" ? card.html.trim() : "";
        if (!html) return null;
        const labelSource = typeof card.label === "string" ? card.label : card.title;
        return {
          id: card.id || `promo-card-${index + 1}`,
          label: labelSource ? String(labelSource).trim() : `広告${index + 1}`,
          html
        };
      })
      .filter(Boolean);
  }

  function renderPromoBlock() {
    const container = document.getElementById("dynamic-info-content");
    const card = document.getElementById("dynamic-info-card");
    if (!container) return;
    const text = typeof runtimeConfig?.promoBlockText === "string" ? runtimeConfig.promoBlockText.trim() : "";
    const loadedCards = getPromoCardsFromConfig();
    const shouldUseDefaultCards = !loadedCards.length && !text;
    const cards = shouldUseDefaultCards ? DEFAULT_PROMO_CARDS : loadedCards;
    container.innerHTML = "";
    if (!cards.length && !text) {
      if (card) {
        card.style.display = "none";
      }
      initPromoCarouselDots(0);
      return;
    }
    if (card) {
      card.style.display = "";
    }
    let rendered = false;
    const cardsToRender = shuffleArray(cards);
    if (cardsToRender.length) {
      cardsToRender.forEach((promo) => {
        const article = document.createElement("article");
        article.className = "promo-card";
        article.setAttribute("role", "listitem");
        article.dataset.promoId = promo.id;
        delete article.dataset.promoClone;
        article.innerHTML = promo.html;
        if (promo.label) {
          article.setAttribute("aria-label", promo.label);
        }
        container.appendChild(article);
      });
      preparePromoCarouselLoop(container, cardsToRender.length);
      rendered = true;
      initPromoCarouselDots(cardsToRender.length);
    } else if (text) {
      const fallbackArticle = document.createElement("article");
      fallbackArticle.className = "promo-card";
      fallbackArticle.setAttribute("role", "listitem");
      const paragraph = document.createElement("p");
      paragraph.className = "promo-text";
      text.split("\n").forEach((line, index) => {
        if (index > 0) {
          paragraph.appendChild(document.createElement("br"));
        }
        paragraph.appendChild(document.createTextNode(line));
      });
      fallbackArticle.appendChild(paragraph);
      container.appendChild(fallbackArticle);
      rendered = true;
      initPromoCarouselDots(0);
    }
    if (rendered) {
      initPriorityDetails(container);
      bindPromoCarouselScroll();
      requestAnimationFrame(() => updatePromoDotsActive());
    }
  }

  async function ensureAllUrlsPermission() {
    if (!chrome?.permissions?.contains) return true;
    const hasAll = await new Promise((resolve) => {
      chrome.permissions.contains({ origins: ["<all_urls>"] }, (granted) => resolve(Boolean(granted)));
    });
    if (hasAll) return true;
    if (!chrome.permissions?.request) return false;
    return new Promise((resolve) => {
      chrome.permissions.request({ origins: ["<all_urls>"] }, (granted) => resolve(Boolean(granted)));
    });
  }

  async function enableAlwaysOnInjection() {
    if (!chrome?.runtime?.sendMessage) return;
    await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "autoform_enable_always_on" }, () => resolve());
    });
  }

  async function ensureInjectedToFrames(tabId, frameIds) {
    if (!chrome?.scripting?.executeScript) return;
    try {
      const target = { tabId };
      if (Array.isArray(frameIds) && frameIds.length > 0) {
        target.frameIds = frameIds;
      }
      await chrome.scripting.executeScript({
        target,
        files: ["content.js"]
      });
    } catch (_) {
      // ignore injection failures (sandboxed framesなど)
    }
  }

  async function injectContentScriptIntoTab(tabId) {
    if (!chrome?.scripting?.executeScript || typeof tabId !== "number") return;
    try {
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: ["content.js"]
      });
    } catch (_) {
      // ignore (chrome:// など)
    }
  }

  async function injectContentScriptIntoExistingTabs() {
    if (!chrome?.tabs?.query) return;
    const tabs = await new Promise((resolve) => {
      chrome.tabs.query({}, (result) => resolve(result || []));
    });
    for (const tab of tabs) {
      if (typeof tab?.id !== "number") continue;
      if (!tab.url || !/^https?:/i.test(tab.url)) continue;
      await injectContentScriptIntoTab(tab.id);
    }
  }

  function initFloatingButtonToggle(checkbox) {
    if (!checkbox) return;
    if (shouldSuppressFloatingButtonControls()) {
      checkbox.checked = false;
      checkbox.disabled = true;
      setFloatingButtonStatus("");
      return;
    }

    const apply = (value) => {
      const enabled = value !== false;
      checkbox.checked = enabled;
      if (!enabled) {
        setFloatingButtonStatus("");
      }
    };

    apply(undefined);

    if (chrome?.storage?.sync) {
      chrome.storage.sync.get(FLOATING_BUTTON_STORAGE_KEY, (res) => {
        apply(res?.[FLOATING_BUTTON_STORAGE_KEY]);
      });
    }

    checkbox.addEventListener("change", () => {
      handleFloatingButtonToggleChange(checkbox).catch((err) => {
        console.error("[AutoForm] Floating button toggle failed", err);
        setFloatingButtonStatus(`ボタンの切替に失敗しました: ${err.message}`, true);
      });
    });
  }

  async function handleFloatingButtonToggleChange(checkbox) {
    const wantsEnabled = checkbox.checked;
    if (!chrome?.storage?.sync) {
      checkbox.checked = false;
      setFloatingButtonStatus("設定を保存できません (storage が利用できません)", true);
      return;
    }
    if (!wantsEnabled) {
      chrome.storage.sync.set({ [FLOATING_BUTTON_STORAGE_KEY]: false });
      setFloatingButtonStatus("");
      return;
    }
    setFloatingButtonStatus("「無制限に使うには」ボタンを有効化しています…");
    checkbox.disabled = true;
    try {
      const granted = await ensureAllUrlsPermission();
      if (!granted) {
        checkbox.checked = false;
        chrome.storage.sync.set({ [FLOATING_BUTTON_STORAGE_KEY]: false });
        setFloatingButtonStatus("全サイトアクセスを許可すると「∞に使うには」ボタンを常時表示できます。", true);
        return;
      }
      await enableAlwaysOnInjection();
      await injectContentScriptIntoExistingTabs();
      chrome.storage.sync.set({ [FLOATING_BUTTON_STORAGE_KEY]: true });
      setFloatingButtonStatus("");
    } finally {
      checkbox.disabled = false;
    }
  }

  function loadApiKeyState() {
    if (!chrome?.storage?.sync) {
      currentApiKey = "";
      setApiKeyInputsValue("");
      setPlanStatus();
      setApiKeyStatus("storage が利用できません (APIキー未設定)", true);
      applyManualFillAvailability();
      applyApiKeyCardVisibility();
      applyQuotaToUI(currentQuotaState);
      return;
    }
    chrome.storage.sync.get(API_KEY_STORAGE_KEY, (res) => {
      const prevHasKey = Boolean(currentApiKey);
      const stored = res?.[API_KEY_STORAGE_KEY];
      currentApiKey = typeof stored === "string" ? stored : "";
      setApiKeyInputsValue(currentApiKey);
      setPlanStatus();
      setApiKeyStatus(currentApiKey ? "保存済みのAPIキーを読み込みました" : "APIキーが未設定です");
      applyManualFillAvailability();
      applyApiKeyCardVisibility();
      applyQuotaToUI(currentQuotaState);
      if (!prevHasKey && currentApiKey) {
        forceConfigReload("api_key_synced").catch(() => {});
      }
    });
  }

  function initApiKeySaveHandler(button) {
    if (!button) return;
    const targetId = button.dataset?.apiKeyTarget;
    button.addEventListener("click", () => {
      const input = targetId ? document.getElementById(targetId) : qs("api-key-input");
      if (!input) return;
      const value = input.value.trim();
      if (!chrome?.storage?.sync) {
        setApiKeyStatus("storage が利用できません (保存不可)", true);
        return;
      }
      button.disabled = true;
      const finish = (successMessage, isError = false) => {
        button.disabled = false;
        setApiKeyStatus(successMessage, isError);
      };
      const hadApiKey = Boolean(currentApiKey);
      if (!value) {
        chrome.storage.sync.remove(API_KEY_STORAGE_KEY, () => {
          if (chrome.runtime?.lastError) {
            finish(`APIキーの削除に失敗しました: ${chrome.runtime.lastError.message}`, true);
            return;
          }
          currentApiKey = "";
          setPlanStatus();
          applyManualFillAvailability();
          applyApiKeyCardVisibility();
          applyQuotaToUI(currentQuotaState);
          finish("APIキーを削除しました");
        });
        return;
      }
      chrome.storage.sync.set({ [API_KEY_STORAGE_KEY]: value }, () => {
        if (chrome.runtime?.lastError) {
          finish(`APIキーの保存に失敗しました: ${chrome.runtime.lastError.message}`, true);
          return;
        }
        currentApiKey = value;
        setPlanStatus();
        applyManualFillAvailability();
        applyApiKeyCardVisibility();
        applyQuotaToUI(currentQuotaState);
        finish("APIキーを保存しました");
        forceConfigReload(hadApiKey ? "api_key_updated" : "api_key_saved").catch(() => {});
      });
    });
  }

  function initSendContentToggle(toggleEl, bodyEl, initiallyExpanded = false) {
    if (!toggleEl || !bodyEl) return;
    let expanded = initiallyExpanded;
    const applyState = () => {
      bodyEl.classList.toggle("collapsed", !expanded);
      bodyEl.setAttribute("aria-hidden", (!expanded).toString());
      toggleEl.classList.toggle("open", expanded);
      toggleEl.setAttribute("aria-expanded", expanded.toString());
    };
    applyState();
    toggleEl.addEventListener("click", () => {
      expanded = !expanded;
      applyState();
    });
  }

  function updateExecuteState() {
    const btn = qs("execute-json");
    if (btn) {
      btn.disabled = !(currentData && currentData.length);
    }
  }

  function loadPersistedData() {
    if (!chrome?.storage?.local) {
      setStatus("storage が利用できません", true);
      return;
    }
    chrome.storage.local.get(DATA_KEY, (res) => {
      const stored = res?.[DATA_KEY];
      if (Array.isArray(stored) && stored.length) {
        currentData = stored;
        setStatus(`前回読み込み: ${stored.length}件`);
      } else {
        setStatus("JSON未読み込み");
      }
    });
  }

  function persistData() {
    if (!chrome?.storage?.local) return;
    chrome.storage.local.set({ [DATA_KEY]: currentData });
  }

  function getPresetDisplayName(preset, fallbackIndex = 1) {
    if (preset?.name && typeof preset.name === "string" && preset.name.trim()) {
      return preset.name.trim();
    }
    return `プリセット${fallbackIndex}`;
  }

  function getNextPresetName() {
    const names = Object.values(sendPresets?.presets || {}).map((p) => p?.name || "");
    const usedNumbers = names
      .map((name) => {
        const match = String(name).match(/プリセット\s*(\d+)/);
        return match ? Number(match[1]) : null;
      })
      .filter((n) => Number.isFinite(n));
    let next = names.length + 1;
    if (usedNumbers.length) {
      next = Math.max(...usedNumbers) + 1;
    }
    return `プリセット${next}`;
  }

  function normalizeSendPresets(rawPresets, legacyContent) {
    const defaultPresetId = "preset-1";
    const defaultPreset = { name: "プリセット1", data: DEFAULT_SEND_CONTENT };
    if (rawPresets?.presets && typeof rawPresets.presets === "object") {
      const valid = {};
      let index = 1;
      Object.entries(rawPresets.presets).forEach(([id, preset]) => {
        if (!preset || typeof preset !== "object" || Array.isArray(preset)) return;
        if (!preset.data || typeof preset.data !== "object" || Array.isArray(preset.data)) return;
        const name = getPresetDisplayName(preset, index);
        valid[id] = { name, data: { ...DEFAULT_SEND_CONTENT, ...preset.data } };
        index += 1;
      });
      const validIds = Object.keys(valid);
      if (validIds.length) {
        const activeId =
          rawPresets.activeId && valid[rawPresets.activeId] ? rawPresets.activeId : validIds[0];
        return { activeId, presets: valid };
      }
    }
    if (legacyContent && typeof legacyContent === "object" && !Array.isArray(legacyContent)) {
      return {
        activeId: defaultPresetId,
        presets: {
          [defaultPresetId]: {
            name: defaultPreset.name,
            data: { ...DEFAULT_SEND_CONTENT, ...legacyContent }
          }
        }
      };
    }
    return { activeId: defaultPresetId, presets: { [defaultPresetId]: defaultPreset } };
  }

  function renderSendPresetSelect() {
    const select = document.getElementById("send-preset-select");
    if (!select) return;
    select.innerHTML = "";
    const entries = Object.entries(sendPresets.presets);
    entries.forEach(([id, preset], idx) => {
      const option = document.createElement("option");
      option.value = id;
      option.textContent = getPresetDisplayName(preset, idx + 1);
      if (id === sendPresets.activeId) {
        option.selected = true;
      }
      select.appendChild(option);
    });
  }

  function applyPresetNameToInput() {
    const input = document.getElementById("send-preset-name");
    if (!input) return;
    const preset = sendPresets.presets[currentSendPresetId];
    input.value = getPresetDisplayName(preset, 1);
  }

  function switchSendPreset(nextId) {
    if (!sendPresets.presets[nextId]) return;
    flushAutoSave({ force: true });
    sendPresets.activeId = nextId;
    currentSendPresetId = nextId;
    currentSendContent = sendPresets.presets[nextId].data || DEFAULT_SEND_CONTENT;
    applySendContentToForm(currentSendContent);
    applyPresetNameToInput();
    lastAutoSavedSnapshot = serializeSendContent(currentSendContent);
    renderSendPresetSelect();
    setSendContentStatus(`${getPresetDisplayName(sendPresets.presets[nextId])} を読み込みました`);
    updateSendContentWarning(currentSendContent);
    persistSendContent();
  }

  function createSendPreset(baseData = null) {
    flushAutoSave({ force: true });
    const id = `preset-${Date.now()}`;
    const name = getNextPresetName();
    const presetData = baseData && typeof baseData === "object" ? baseData : currentSendContent || DEFAULT_SEND_CONTENT;
    sendPresets.presets[id] = { name, data: { ...DEFAULT_SEND_CONTENT, ...presetData } };
    switchSendPreset(id);
  }

  function deleteSendPreset(id) {
    if (!sendPresets.presets[id]) return;
    const keys = Object.keys(sendPresets.presets);
    if (keys.length <= 1) {
      setSendContentStatus("最後のプリセットは削除できません", true);
      return;
    }
    delete sendPresets.presets[id];
    const nextActive = sendPresets.presets[sendPresets.activeId]
      ? sendPresets.activeId
      : Object.keys(sendPresets.presets)[0];
    switchSendPreset(nextActive);
  }

  function getSendContentFields() {
    return Array.from(document.querySelectorAll("[data-send-field]"));
  }

  function applySendContentToForm(data) {
    const fields = getSendContentFields();
    fields.forEach((el) => {
      const key = el.dataset.sendField;
      if (!key) return;
      const value = data?.[key];
      if (el.tagName === "TEXTAREA") {
        el.value = value ?? "";
      } else {
        el.value = value ?? "";
      }
    });
  }

  function readSendContentFromForm() {
    const result = {};
    const fields = getSendContentFields();
    fields.forEach((el) => {
      const key = el.dataset.sendField;
      if (!key) return;
      result[key] = el.value ?? "";
    });
    return result;
  }

  function loadSendContent() {
    if (!chrome?.storage?.local) {
      currentSendContent = DEFAULT_SEND_CONTENT;
      sendPresets = {
        activeId: "preset-1",
        presets: { "preset-1": { name: "プリセット1", data: DEFAULT_SEND_CONTENT } }
      };
      currentSendPresetId = "preset-1";
      renderSendPresetSelect();
      applyPresetNameToInput();
      applySendContentToForm(currentSendContent);
      lastAutoSavedSnapshot = serializeSendContent(currentSendContent);
      setSendContentStatus("storage が利用できません (初期値のみ)", true);
      updateSendContentWarning(currentSendContent);
      return;
    }
    chrome.storage.local.get([SEND_PRESET_STORAGE_KEY, SEND_STORAGE_KEY], (res) => {
      const rawPresets = res?.[SEND_PRESET_STORAGE_KEY];
      const legacyContent = res?.[SEND_STORAGE_KEY];
      const normalized = normalizeSendPresets(rawPresets, legacyContent);
      sendPresets = normalized;
      currentSendPresetId = normalized.activeId;
      currentSendContent =
        normalized.presets[normalized.activeId]?.data || DEFAULT_SEND_CONTENT;
      renderSendPresetSelect();
      applyPresetNameToInput();
      applySendContentToForm(currentSendContent);
      lastAutoSavedSnapshot = serializeSendContent(currentSendContent);
      setSendContentStatus("保存済みのプリセットを読み込みました");
      updateSendContentWarning(currentSendContent);
      persistSendContent();
    });
  }

  function persistSendContent() {
    if (!chrome?.storage?.local || !currentSendContent) return;
    const presetEntry = sendPresets.presets[currentSendPresetId] || {
      name: getPresetDisplayName(null, 1),
      data: DEFAULT_SEND_CONTENT
    };
    const nextPresets = {
      ...sendPresets,
      activeId: currentSendPresetId,
      presets: {
        ...sendPresets.presets,
        [currentSendPresetId]: {
          name: presetEntry.name,
          data: currentSendContent
        }
      }
    };
    sendPresets = nextPresets;
    chrome.storage.local.set({
      [SEND_PRESET_STORAGE_KEY]: nextPresets,
      [SEND_STORAGE_KEY]: currentSendContent
    });
  }

  function serializeSendContent(data) {
    try {
      return JSON.stringify(data || {});
    } catch (_) {
      return null;
    }
  }

  function cancelAutoSaveTimer() {
    if (autoSaveTimerId) {
      clearTimeout(autoSaveTimerId);
      autoSaveTimerId = null;
    }
  }

  function scheduleAutoSave() {
    cancelAutoSaveTimer();
    autoSaveTimerId = setTimeout(() => {
      autoSaveTimerId = null;
      performAutoSave();
    }, AUTO_SAVE_DEBOUNCE_MS);
  }

  function performAutoSave(options = {}) {
    const { silent = false } = options;
    const formData = readSendContentFromForm();
    currentSendContent = formData;
    if (!chrome?.storage?.local) {
      return;
    }
    const serialized = serializeSendContent(formData);
    if (serialized && serialized === lastAutoSavedSnapshot) {
      if (!silent) {
        setSendContentStatus("自動保存済み");
      }
      return;
    }
    persistSendContent();
    lastAutoSavedSnapshot = serialized;
    if (!silent) {
      setSendContentStatus("自動保存しました");
    }
    updateSendContentWarning(formData);
  }

  function flushAutoSave(options = {}) {
    const nextOptions = { silent: true, ...options };
    if (autoSaveTimerId) {
      cancelAutoSaveTimer();
      performAutoSave(nextOptions);
    } else if (nextOptions.force) {
      performAutoSave(nextOptions);
    }
  }

  function handleSendContentFieldInput() {
    setSendContentStatus("未保存の変更があります");
    updateSendContentWarning();
    scheduleAutoSave();
  }

  runtimeConfigReady.then(() => {
    if (!chrome?.storage?.onChanged) return;
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "sync" && Object.prototype.hasOwnProperty.call(changes, API_KEY_STORAGE_KEY)) {
        const nextValue = changes[API_KEY_STORAGE_KEY]?.newValue;
        currentApiKey = typeof nextValue === "string" ? nextValue : "";
        setApiKeyInputsValue(currentApiKey);
        setPlanStatus();
        setApiKeyStatus(currentApiKey ? "APIキーが更新されました" : "APIキーが未設定です");
        applyManualFillAvailability();
        applyApiKeyCardVisibility();
        applyQuotaToUI(currentQuotaState);
      }
    });
  });

  function handleFileChange(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!Array.isArray(parsed)) {
          throw new Error("JSONは配列形式である必要があります");
        }
        currentData = parsed;
        persistData();
        setStatus(`読み込み成功: ${parsed.length}件`);
      } catch (err) {
        currentData = null;
        setStatus(`読み込み失敗: ${err.message}`, true);
      }
    };
    reader.onerror = () => {
      currentData = null;
      setStatus("ファイル読み込みに失敗しました", true);
    };
    reader.readAsText(file);
  }

  function getActiveTabId() {
    return new Promise((resolve, reject) => {
      if (!chrome?.tabs?.query) {
        reject(new Error("tabs API が利用できません"));
        return;
      }
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs && tabs[0];
        if (tab && typeof tab.id === "number") {
          resolve(tab.id);
        } else {
          reject(new Error("アクティブなタブが見つかりません"));
        }
      });
    });
  }

  function getAllFrameIds(tabId) {
    return new Promise((resolve, reject) => {
      if (!chrome?.webNavigation?.getAllFrames) {
        reject(new Error("webNavigation API が利用できません"));
        return;
      }
      chrome.webNavigation.getAllFrames({ tabId }, (frames) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!frames || !frames.length) {
          resolve([0]);
          return;
        }
        resolve(frames.map((frame) => frame.frameId));
      });
    });
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

  function sendCommandToFrame(tabId, frameId, command, payload) {
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(
        tabId,
        { type: command, payload },
        { frameId },
        (response) => {
          if (chrome.runtime.lastError) {
            const message = chrome.runtime.lastError.message || "unknown error";
            resolve({
              error: message,
              unreachable: isIgnorableConnectionError(message)
            });
            return;
          }
          resolve(response || {});
        }
      );
    });
  }

  async function refreshGoogleFormUrls() {
    setGoogleFormStatus("Google Form URLを検出中です…");
    renderGoogleFormUrls([], { showEmpty: false });
    try {
      const tabId = await getActiveTabId();
      const granted = await ensureAllUrlsPermission();
      if (!granted) {
        setGoogleFormStatus("全サイトへのアクセス許可が必要です。ボタンを押して許可してください。", true);
        return;
      }
      await enableAlwaysOnInjection();
      await injectContentScriptIntoTab(tabId);
      const frameIds = await getAllFrameIds(tabId);
      await ensureInjectedToFrames(tabId, frameIds);
      const results = await Promise.all(
        frameIds.map((frameId) => sendCommandToFrame(tabId, frameId, "autoform_request_google_form_urls"))
      );
      const urls = new Set();
      results.forEach((res) => {
        if (res?.unreachable) return;
        if (!Array.isArray(res?.urls)) return;
        res.urls.forEach((url) => {
          if (typeof url !== "string") return;
          const trimmed = url.trim();
          if (trimmed) {
            urls.add(trimmed);
          }
        });
      });
      const list = Array.from(urls);
      if (list.length) {
        setGoogleFormStatus(`${list.length}件のGoogle Form URLを検出しました`);
      } else {
        setGoogleFormStatus("Google Form の URL が見つかりませんでした。");
      }
      renderGoogleFormUrls(list);
    } catch (err) {
      const message = err?.message || "不明なエラー";
      setGoogleFormStatus(`Google Form URLの取得に失敗しました: ${message}`, true);
      renderGoogleFormUrls([], { showEmpty: false });
    }
  }

  async function refreshDetectedInputCount() {
    setInputCountStatus("入力欄/フォームを検知中です…");
    try {
      const tabId = await getActiveTabId();
      const granted = await ensureAllUrlsPermission();
      if (!granted) {
        setInputCountStatus("全サイトへのアクセス許可が必要です。ボタンを押して許可してください。", true);
        return;
      }
      await enableAlwaysOnInjection();
      await injectContentScriptIntoTab(tabId);
      const frameIds = await getAllFrameIds(tabId);
      await ensureInjectedToFrames(tabId, frameIds);
      const results = await Promise.all(
        frameIds.map((frameId) => sendCommandToFrame(tabId, frameId, "autoform_request_input_count"))
      );
      const usable = results.filter((res) => !res?.unreachable && Number.isFinite(res?.count));
      if (!usable.length) {
        setInputCountStatus("フォームを検知できませんでした。ページを再読み込みしてください。", true);
        return;
      }
      const total = usable.reduce((sum, res) => sum + (res.count || 0), 0);
      setInputCountStatus(total);
    } catch (err) {
      setInputCountStatus(`入力欄の取得に失敗しました: ${err.message}`, true);
    }
  }

  async function handleExecuteClick(btn) {
    if (!(currentData && currentData.length)) {
      setStatus("JSONを読み込んでください", true);
      return;
    }
    btn.disabled = true;
    setStatus("権限チェック中…");
    try {
      const tabId = await getActiveTabId();
      const granted = await ensureAllUrlsPermission();
      if (!granted) {
        setStatus("実行中止: 全サイト権限が得られませんでした", true);
        btn.disabled = false;
        updateExecuteState();
        await refreshDetectedInputCount();
        return;
      }
      await enableAlwaysOnInjection();
      setStatus("入力を送信中…");
      const frameIds = await getAllFrameIds(tabId);
      await ensureInjectedToFrames(tabId, frameIds);
      const results = await Promise.all(
        frameIds.map((frameId) =>
          sendCommandToFrame(tabId, frameId, "autoform_execute_json", currentData)
        )
      );
      const summary = results.reduce(
        (acc, res) => {
          const applied = res?.applied || {};
          acc.success += applied.success || 0;
          acc.skipped += applied.skipped || 0;
          acc.total += applied.total || 0;
          return acc;
        },
        { success: 0, skipped: 0, total: 0 }
      );
      if (summary.total === 0) summary.total = currentData.length;
      setStatus(`実行完了: 成功 ${summary.success} / ${summary.total}件 (スキップ ${summary.skipped})`);
    } catch (err) {
      setStatus(`実行失敗: ${err.message}`, true);
    } finally {
      updateExecuteState();
      await refreshDetectedInputCount();
    }
  }

  function handleManualFillErrorState(errorInfo) {
    if (!errorInfo || typeof errorInfo !== "object") {
      setManualStatus("失敗: 入力に失敗しました", true);
      return;
    }
    if (errorInfo.code === "PAID_API_KEY_MISSING") {
      setManualStatus("失敗: 有料プランでは API キー が必須です", true);
      return;
    }
    if (errorInfo.code === "PAID_API_KEY_INVALID") {
      setManualStatus("失敗: API キーが無効/期限切れです", true);
      return;
    }
    if (isQuotaExhaustedError(errorInfo)) {
      setManualStatus(FREE_PLAN_EXHAUSTED_MESSAGE, true);
      return;
    }
    const message = errorInfo.message && typeof errorInfo.message === "string" ? errorInfo.message : "入力に失敗しました";
    setManualStatus(`失敗: ${message}`, true);
  }

  function flashPrimaryButtonSuccess(button) {
    if (!button) return;
    button.classList.add("is-success");
    setTimeout(() => button.classList.remove("is-success"), 1400);
  }

  function fetchLastFillResultFromBackground() {
    if (!chrome?.runtime?.sendMessage) {
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: "autoform_get_last_fill_result" }, (response) => {
          if (chrome.runtime?.lastError) {
            resolve(null);
            return;
          }
          resolve(response?.result || null);
        });
      } catch (_) {
        resolve(null);
      }
    });
  }

  function applyStoredFillResultToManualStatus(result) {
    if (!result || result.ok !== false) return;
    const timestamp = typeof result.timestamp === "number" ? result.timestamp : null;
    if (timestamp && Date.now() - timestamp > 5 * 60 * 1000) {
      return;
    }
    handleManualFillErrorState({
      code: result.code || null,
      message: typeof result.message === "string" ? result.message : "",
      quota: result.quota || null
    });
  }

  async function handleManualFill(btn) {
    btn.disabled = true;
    btn.dataset.loading = "1";
    btn.classList.remove("is-success");
    setManualStatus("");
    let resolvedQuota = null;
    try {
      const tabId = await getActiveTabId();
      const granted = await ensureAllUrlsPermission();
      if (!granted) {
        setManualStatus("全サイト権限がないため入力できませんでした", true);
        return;
      }
      await enableAlwaysOnInjection();
      await injectContentScriptIntoTab(tabId);
      await ensureInjectedToFrames(tabId, [0]);
      const response = await sendCommandToFrame(tabId, 0, "autoform_manual_fill");
      if (response?.error && !response?.unreachable) {
        resolvedQuota = response?.quota && typeof response.quota === "object" ? response.quota : null;
        handleManualFillErrorState({
          code: response?.code || null,
          message: response.error || "",
          quota: resolvedQuota
        });
        return;
      }
      const applied = response?.applied;
      const filled = typeof response?.filled === "number" ? response.filled : applied?.success;
      if (!applied && typeof filled !== "number") {
        setManualStatus("入力結果が取得できませんでした", true);
        return;
      }
      if (!resolvedQuota && response?.quota && typeof response.quota === "object") {
        resolvedQuota = response.quota;
      }
      setManualStatus("");
      flashPrimaryButtonSuccess(btn);
    } catch (err) {
      if (!resolvedQuota && err?.quota && typeof err.quota === "object") {
        resolvedQuota = err.quota;
      }
      const quotaInfo = resolvedQuota || (err?.quota && typeof err.quota === "object" ? err.quota : null);
      handleManualFillErrorState({
        code: err?.code || null,
        message: err?.message || "",
        quota: quotaInfo
      });
    } finally {
      delete btn.dataset.loading;
      btn.disabled = false;
      await refreshDetectedInputCount();
      if (resolvedQuota) {
        applyQuotaToUI(resolvedQuota);
      } else {
        await syncQuotaWithBackground();
      }
    }
  }

  function validateSendContent(data) {
    const values = Object.values(data || {});
    if (!values.length) return false;
    return values.every((value) => {
      if (value == null) return false;
      if (typeof value === "string") {
        return value.trim().length > 0;
      }
      return true;
    });
  }

  function updateSendContentWarning(data) {
    const warningEl = qs("send-content-warning");
    if (!warningEl) return;
    const formData = data || readSendContentFromForm();
    const hasEmpty = !validateSendContent(formData);
    warningEl.style.display = hasEmpty ? "block" : "none";
    if (!hasEmpty) {
      const statusEl = qs("send-content-status");
      if (statusEl && statusEl.textContent === "全ての入力項目を埋めてください") {
        statusEl.textContent = "未保存の変更があります";
        statusEl.style.color = "#555";
      }
    }
  }

  function handleSendContentSave() {
    cancelAutoSaveTimer();
    const formData = readSendContentFromForm();
    if (!validateSendContent(formData)) {
      setSendContentStatus("全ての入力項目を埋めてください", true);
      updateSendContentWarning(formData);
      return;
    }
    currentSendContent = formData;
    persistSendContent();
    lastAutoSavedSnapshot = serializeSendContent(currentSendContent);
    const preset = sendPresets.presets[currentSendPresetId];
    setSendContentStatus(`${getPresetDisplayName(preset)} を保存しました`);
    updateSendContentWarning(formData);
  }

  async function handleSendContentApply(btn) {
    cancelAutoSaveTimer();
    currentSendContent = readSendContentFromForm();
    persistSendContent();
    lastAutoSavedSnapshot = serializeSendContent(currentSendContent);

    btn.disabled = true;
    setSendContentStatus("権限チェック中…");
    try {
      const tabId = await getActiveTabId();
      const granted = await ensureAllUrlsPermission();
      if (!granted) {
        setSendContentStatus("入力中止: 全サイト権限が必要です", true);
        return;
      }
      await enableAlwaysOnInjection();
      setSendContentStatus("入力処理中…");
      const frameIds = await getAllFrameIds(tabId);
      await ensureInjectedToFrames(tabId, frameIds);
      const results = await Promise.all(
        frameIds.map((frameId) =>
          sendCommandToFrame(tabId, frameId, "autoform_apply_send_content", currentSendContent)
        )
      );
      const filledKeys = new Set();
      for (const res of results) {
        const keys = res?.sendContent?.filledKeys;
        if (Array.isArray(keys)) {
          keys.forEach((key) => filledKeys.add(key));
        }
      }
      const totalKeys = Object.keys(currentSendContent).length;
      setSendContentStatus(`入力完了: ${filledKeys.size}/${totalKeys} 件 (キー単位)`);
    } catch (err) {
      setSendContentStatus(`入力失敗: ${err.message}`, true);
    } finally {
      btn.disabled = false;
      await refreshDetectedInputCount();
    }
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      flushAutoSave({ force: true });
    }
  });

  window.addEventListener("beforeunload", () => {
    flushAutoSave({ force: true });
  });

  function initPopupDom() {
    popupDomReady = true;
    applyApiKeyCardVisibility();
    applyFloatingButtonEditionRules();
    const fillBtn = qs("fill-now");
    const priorityRefreshBtn = qs("priority-refresh");
    const googleFormRefreshBtn = qs("google-form-refresh");
    const sendContentToggle = qs("send-content-toggle");
    const sendContentBody = qs("send-content-body");
    const saveSendBtn = qs("save-send-content");
    const sendPresetSelect = document.getElementById("send-preset-select");
    const sendPresetNameInput = document.getElementById("send-preset-name");
    const newPresetBtn = document.getElementById("send-preset-new");
    const duplicatePresetBtn = document.getElementById("send-preset-duplicate");
    const deletePresetBtn = document.getElementById("send-preset-delete");
    const floatingButtonCheckbox = qs("show-floating-button");
    const saveApiKeyBtns = document.querySelectorAll("[data-api-key-save]");

    if (fillBtn) {
      fillNowButton = fillBtn;
      applyManualFillAvailability();
      fillBtn.addEventListener("click", () => handleManualFill(fillBtn));
    }
    const sendContentFields = getSendContentFields();
    if (sendContentFields.length) {
      sendContentFields.forEach((field) => {
        field.addEventListener("input", handleSendContentFieldInput);
      });
    }
    if (saveSendBtn) {
      saveSendBtn.addEventListener("click", handleSendContentSave);
    }
    if (sendPresetSelect) {
      sendPresetSelect.addEventListener("change", (e) => switchSendPreset(e.target.value));
    }
    if (sendPresetNameInput) {
      sendPresetNameInput.addEventListener("blur", (e) => {
        const preset = sendPresets.presets[currentSendPresetId];
        if (!preset) return;
        const fallbackName = getPresetDisplayName(
          sendPresets.presets[currentSendPresetId],
          Object.keys(sendPresets.presets || {}).length || 1
        );
        const nextName = e.target.value.trim() || fallbackName;
        sendPresets.presets[currentSendPresetId] = { ...preset, name: nextName };
        applyPresetNameToInput();
        renderSendPresetSelect();
        persistSendContent();
      });
      sendPresetNameInput.addEventListener("input", () => {
        setSendContentStatus("未保存の変更があります");
      });
    }
    if (newPresetBtn) {
      newPresetBtn.addEventListener("click", () => createSendPreset(DEFAULT_SEND_CONTENT));
    }
    if (duplicatePresetBtn) {
      duplicatePresetBtn.addEventListener("click", () => {
        const active = sendPresets.presets[currentSendPresetId];
        createSendPreset(active?.data || currentSendContent);
      });
    }
    if (deletePresetBtn) {
      deletePresetBtn.addEventListener("click", () => deleteSendPreset(currentSendPresetId));
    }
    initSendContentToggle(sendContentToggle, sendContentBody, true);
    updateSendContentWarning();
    initFloatingButtonToggle(floatingButtonCheckbox);
    saveApiKeyBtns.forEach((btn) => initApiKeySaveHandler(btn));

    initPriorityRefreshButton(priorityRefreshBtn);
    initGoogleFormRefreshButton(googleFormRefreshBtn);
    renderPromoBlock();
    syncQuotaWithBackground();
    refreshDetectedInputCount();
    refreshGoogleFormUrls();
    loadSendContent();
    loadApiKeyState();
    fetchLastFillResultFromBackground()
      .then((result) => applyStoredFillResultToManualStatus(result))
      .catch(() => {});
  }

  document.addEventListener("DOMContentLoaded", () => {
    runtimeConfigReady
      .catch(() => {})
      .then(() => initPopupDom());
  });
})();
