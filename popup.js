(() => {
  const DATA_KEY = "autoformImportedJson";
  const SEND_STORAGE_KEY = "autoformSendContent";
  const FLOATING_BUTTON_STORAGE_KEY = "autoformShowFloatingButton";
  const AUTO_BUTTON_STORAGE_KEY = "autoformShowAutoButton";
  const API_KEY_STORAGE_KEY = "aimsalesApiKey";
  const SERVER_BASE =
    RuntimeConfig?.DEFAULT_SERVER_BASE ||
    "https://autoform-chrome-extention-server-csasaeerewb7b9ga.japaneast-01.azurewebsites.net/chrome_extension";
  const DEFAULT_PLAN = "free";
  const PRIORITY_UNLIMITED_THRESHOLD = 10000;
  const PRIORITY_UNLIMITED_LABEL = "無制限 ※ 期間限定";
  const PRIORITY_EXHAUSTED_MESSAGE =
    "全自動AI営業ツール『Aimsales』では無制限に使えます。お申し込みはこちら https://forms.gle/FWkuxr8HenuLkARC7";
  const PRIORITY_COUNT_LABEL_DEFAULT = "本日の残り回数";
  const PRIORITY_COUNT_LABEL_EMPTY = "本日の残り回数はありません";
  const clone = (value) => JSON.parse(JSON.stringify(value || {}));
  let runtimeConfig = clone(RuntimeConfig?.DEFAULTS || {});
  let EDITION = runtimeConfig?.edition || "free";
  let REQUIRE_API_KEY = Boolean(runtimeConfig?.rules?.requireApiKey);
  let currentQuotaState = runtimeConfig?.quota || null;
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
  let currentApiKey = "";
  const AUTO_SAVE_DEBOUNCE_MS = 800;
  let autoSaveTimerId = null;
  let lastAutoSavedSnapshot = null;
  let fillNowButton = null;
  let promoScrollAnimationFrame = null;

  const runtimeConfigReady =
    typeof RuntimeConfig?.loadRuntimeConfig === "function"
      ? RuntimeConfig.loadRuntimeConfig({ serverBase: SERVER_BASE, plan: EDITION || DEFAULT_PLAN })
          .then((cfg) => {
            runtimeConfig = cfg || runtimeConfig || {};
            EDITION = runtimeConfig?.edition || "free";
            REQUIRE_API_KEY = Boolean(runtimeConfig?.rules?.requireApiKey);
            if (runtimeConfig?.quota) {
              currentQuotaState = runtimeConfig.quota;
            }
            return runtimeConfig;
          })
          .catch((err) => {
            console.error("[AutoForm] failed to load runtime config", err);
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
    const quotaOk = hasQuotaRemaining();
    const apiKeyOk = !REQUIRE_API_KEY || Boolean(currentApiKey);
    setFillNowEnabled(quotaOk && apiKeyOk);
    return quotaOk;
  }

  function setFloatingButtonStatus(message, isError = false) {
    const statusEl = qs("floating-button-status");
    if (!statusEl) return;
    statusEl.textContent = message || "";
    statusEl.style.color = isError ? "#dc2626" : "#64748b";
    statusEl.style.display = message ? "block" : "none";
  }

  function setPlanStatus(hasKey) {
    const planEl = qs("plan-status");
    const badgeEl = qs("plan-badge");
    const isPaidEdition = EDITION === "paid" || Boolean(hasKey);
    const label = isPaidEdition ? "有料版" : "無料版";
    if (planEl) {
      planEl.textContent = label;
      planEl.classList.toggle("plan-status-paid", isPaidEdition);
    }
    if (badgeEl) {
      badgeEl.textContent = label;
      badgeEl.classList.toggle("plan-badge-paid", isPaidEdition);
    }
  }

  function setApiKeyStatus(message, isError = false) {
    const statusEl = qs("api-key-status");
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.style.color = isError ? "#b91c1c" : "#475569";
  }

  function applyApiKeyCardVisibility() {
    const card = document.querySelector(".api-key-card");
    if (!card) return;
    card.style.display = REQUIRE_API_KEY ? "" : "none";
  }

  function setPriorityNumberDisplay(text) {
    const nodes = new Set();
    const legacy = document.getElementById("priority-remaining");
    if (legacy) nodes.add(legacy);
    document.querySelectorAll("[data-priority-number]").forEach((el) => nodes.add(el));
    nodes.forEach((node) => {
      node.textContent = text;
    });
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

  function setPriorityCardMode(mode) {
    const card = document.querySelector("[data-priority-card]");
    if (!card) return;
    card.dataset.mode = mode || "";
    card.classList.toggle("is-shared", mode === "shared");
  }

  function setPriorityCountLabel(isEmpty) {
    const label = document.querySelector(".priority-count-label");
    if (!label) return;
    label.textContent = isEmpty ? PRIORITY_COUNT_LABEL_EMPTY : PRIORITY_COUNT_LABEL_DEFAULT;
  }

  function setPriorityWarningState(active) {
    const badge = document.getElementById("priority-warning");
    if (!badge) return;
    badge.classList.toggle("is-visible", Boolean(active));
    badge.setAttribute("aria-hidden", (!active).toString());
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

  function quotaIndicatesDepleted(quota) {
    if (!quota || typeof quota !== "object") return false;
    const remaining = quota.remaining;
    if (remaining === Infinity || remaining === "Infinity") return false;
    if (remaining == null) return false;
    const numeric = Number(remaining);
    if (!Number.isFinite(numeric)) return false;
    return numeric <= 0;
  }

  function isQuotaExhaustedError(message, quota) {
    if (quotaIndicatesDepleted(quota)) return true;
    if (typeof message !== "string") return false;
    return message.trim() === PRIORITY_EXHAUSTED_MESSAGE.trim();
  }

  function scrollPromoToIndex(index) {
    if (typeof index !== "number" || index < 0) return;
    const carousel = document.getElementById("dynamic-info-content");
    if (!carousel) return;
    const cards = carousel.querySelectorAll(".promo-card");
    const target = cards[index];
    if (!target) return;
    const carouselRect = carousel.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const offset = targetRect.left - carouselRect.left;
    carousel.scrollTo({
      left: carousel.scrollLeft + offset,
      behavior: "smooth"
    });
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
    const cards = carousel.querySelectorAll(".promo-card");
    if (!dots.length || !cards.length) return;
    let activeIndex = 0;
    const viewportCenter = carousel.scrollLeft + carousel.clientWidth / 2;
    cards.forEach((card, index) => {
      const cardCenter = card.offsetLeft + card.offsetWidth / 2;
      const activeCenter = cards[activeIndex].offsetLeft + cards[activeIndex].offsetWidth / 2;
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
    const hasPriorityView =
      document.getElementById("priority-remaining") || document.querySelector("[data-priority-card]");
    if (!hasPriorityView) {
      applyManualFillAvailability();
      return;
    }
    setPriorityCountLabel(false);
    setPriorityWarningState(false);
    const configUnlimited = priorityConfigIndicatesUnlimited();
    if (!quota) {
      if (configUnlimited) {
        setPriorityNumberDisplay(PRIORITY_UNLIMITED_LABEL);
        setPriorityCardMode("priority");
      } else {
        setPriorityNumberDisplay("--");
        setPriorityCardMode("unknown");
      }
      setPriorityNoteVisibility("", false);
      applyManualFillAvailability();
      return;
    }
    const parseQuotaNumber = (value) => {
      const stringValue = typeof value === "string" ? value.trim().toLowerCase() : value;
      if (stringValue === Infinity || stringValue === "infinity" || stringValue === "inf") {
        return Infinity;
      }
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return null;
      return numeric;
    };
    const formatFinite = (value) => String(Math.max(0, Math.floor(Number(value) || 0)));
    const remainingValue = parseQuotaNumber(quota.remaining);
    const limitValue = parseQuotaNumber(quota.daily_limit ?? quota.limit);
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
    const noteMessage = hasQuota ? "" : quota.message || PRIORITY_EXHAUSTED_MESSAGE;
    setPriorityNoteVisibility(noteMessage, !hasQuota);
    applyManualFillAvailability();
  }

  function syncQuotaWithBackground() {
    if (!chrome?.runtime?.sendMessage) {
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: "autoform_get_quota_state" }, (response) => {
          if (chrome.runtime?.lastError) {
            resolve(null);
            return;
          }
          const quota = response?.quota || null;
          if (quota) {
            applyQuotaToUI(quota);
          }
          resolve(quota);
        });
      } catch (_) {
        resolve(null);
      }
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
    if (cards.length) {
      cards.forEach((promo) => {
        const article = document.createElement("article");
        article.className = "promo-card";
        article.setAttribute("role", "listitem");
        article.dataset.promoId = promo.id;
        article.innerHTML = promo.html;
        if (promo.label) {
          article.setAttribute("aria-label", promo.label);
        }
        container.appendChild(article);
      });
      rendered = true;
      initPromoCarouselDots(cards.length);
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

    const apply = (value) => {
      const enabled = value === true;
      checkbox.checked = enabled;
      if (!enabled) {
        setFloatingButtonStatus("");
      }
    };

    if (chrome?.storage?.sync) {
      chrome.storage.sync.get(FLOATING_BUTTON_STORAGE_KEY, (res) => {
        apply(res?.[FLOATING_BUTTON_STORAGE_KEY] === true);
      });
    } else {
      apply(false);
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
        setFloatingButtonStatus("全サイトアクセスを許可すると「無制限に使うには」ボタンを常時表示できます。", true);
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
    const input = qs("api-key-input");
    if (!chrome?.storage?.sync) {
      currentApiKey = "";
      if (input) input.value = "";
      setPlanStatus(false);
      setApiKeyStatus("storage が利用できません (APIキー未設定)", true);
      applyManualFillAvailability();
      return;
    }
    chrome.storage.sync.get(API_KEY_STORAGE_KEY, (res) => {
      const stored = res?.[API_KEY_STORAGE_KEY];
      currentApiKey = typeof stored === "string" ? stored : "";
      if (input && document.activeElement !== input) {
        input.value = currentApiKey;
      }
      setPlanStatus(Boolean(currentApiKey));
      setApiKeyStatus(currentApiKey ? "保存済みのAPIキーを読み込みました" : "APIキーが未設定です");
      applyManualFillAvailability();
    });
  }

  function initApiKeySaveHandler(button) {
    if (!button) return;
    button.addEventListener("click", () => {
      const input = qs("api-key-input");
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
      if (!value) {
        chrome.storage.sync.remove(API_KEY_STORAGE_KEY, () => {
          if (chrome.runtime?.lastError) {
            finish(`APIキーの削除に失敗しました: ${chrome.runtime.lastError.message}`, true);
            return;
          }
          currentApiKey = "";
          setPlanStatus(false);
          applyManualFillAvailability();
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
        setPlanStatus(true);
        applyManualFillAvailability();
        finish("APIキーを保存しました");
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
      applySendContentToForm(currentSendContent);
      lastAutoSavedSnapshot = serializeSendContent(currentSendContent);
      setSendContentStatus("storage が利用できません (初期値のみ)", true);
      updateSendContentWarning(currentSendContent);
      return;
    }
    chrome.storage.local.get(SEND_STORAGE_KEY, (res) => {
      const stored = res?.[SEND_STORAGE_KEY];
      if (stored && typeof stored === "object" && !Array.isArray(stored)) {
        currentSendContent = stored;
        setSendContentStatus("保存済みの内容を読み込みました");
      } else {
        currentSendContent = DEFAULT_SEND_CONTENT;
        setSendContentStatus("初期 SEND_CONTENT を読み込みました");
      }
      applySendContentToForm(currentSendContent);
      lastAutoSavedSnapshot = serializeSendContent(currentSendContent);
      updateSendContentWarning(currentSendContent);
    });
  }

  function persistSendContent() {
    if (!chrome?.storage?.local || !currentSendContent) return;
    chrome.storage.local.set({ [SEND_STORAGE_KEY]: currentSendContent });
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
        const input = qs("api-key-input");
        if (input && document.activeElement !== input) {
          input.value = currentApiKey;
        }
        setPlanStatus(Boolean(currentApiKey));
        setApiKeyStatus(currentApiKey ? "APIキーが更新されました" : "APIキーが未設定です");
        applyManualFillAvailability();
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

  function getActiveTabUrl() {
    return new Promise((resolve) => {
      if (!chrome?.tabs?.query) {
        resolve(null);
        return;
      }
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        const tab = tabs && tabs[0];
        resolve(tab?.url || null);
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

  async function handleManualFill(btn) {
    btn.disabled = true;
    setManualStatus("フォーム入力中…");
    let resolvedQuota = null;
    try {
      const tabId = await getActiveTabId();
      const granted = await ensureAllUrlsPermission();
      if (!granted) {
        setManualStatus("全サイト権限がないため入力できませんでした", true);
        return;
      }
      await enableAlwaysOnInjection();
      const frameIds = await getAllFrameIds(tabId);
      await ensureInjectedToFrames(tabId, frameIds);
      const results = await Promise.all(
        frameIds.map((frameId) =>
          sendCommandToFrame(tabId, frameId, "autoform_manual_fill", null)
        )
      );
      const fatalEntry = results.find((item) => item?.error && !item?.unreachable);
      if (fatalEntry) {
        if (!resolvedQuota && fatalEntry.quota && typeof fatalEntry.quota === "object") {
          resolvedQuota = fatalEntry.quota;
        }
        if (isQuotaExhaustedError(fatalEntry.error, resolvedQuota || fatalEntry.quota)) {
          setManualStatus("");
        } else {
          const errorMessage = fatalEntry.error || "入力に失敗しました";
          setManualStatus(`失敗: ${errorMessage}`, true);
        }
        return;
      }
      const usableResults = results.filter((item) => !item?.unreachable);
      if (!usableResults.length) {
        setManualStatus("入力可能なフレームが見つかりませんでした", true);
        return;
      }
      const summary = usableResults.reduce(
        (acc, res) => {
          const applied = res?.applied || {};
          acc.success += applied.success || res?.filled || 0;
          acc.skipped += applied.skipped || 0;
          acc.total += applied.total || 0;
          if (!resolvedQuota && res?.quota && typeof res.quota === "object") {
            resolvedQuota = res.quota;
          }
          return acc;
        },
        { success: 0, skipped: 0, total: 0 }
      );
      setManualStatus(`完了: ${summary.success}件に入力`);
    } catch (err) {
      if (!resolvedQuota && err?.quota && typeof err.quota === "object") {
        resolvedQuota = err.quota;
      }
      if (isQuotaExhaustedError(err?.message, resolvedQuota || err?.quota)) {
        setManualStatus("");
      } else {
        const fallback = err?.message || "入力に失敗しました";
        setManualStatus(`失敗: ${fallback}`, true);
      }
    } finally {
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
    setSendContentStatus("入力項目を保存しました");
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
    applyApiKeyCardVisibility();
    const fillBtn = qs("fill-now");
    const sendContentToggle = qs("send-content-toggle");
    const sendContentBody = qs("send-content-body");
    const saveSendBtn = qs("save-send-content");
    const floatingButtonCheckbox = qs("show-floating-button");
    const saveApiKeyBtn = qs("save-api-key");

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
    initSendContentToggle(sendContentToggle, sendContentBody, true);
    updateSendContentWarning();
    initFloatingButtonToggle(floatingButtonCheckbox);
    initApiKeySaveHandler(saveApiKeyBtn);

    renderPromoBlock();
    if (runtimeConfig?.quota) {
      applyQuotaToUI(runtimeConfig.quota);
    }
    syncQuotaWithBackground();
    refreshDetectedInputCount();
    loadSendContent();
    loadApiKeyState();
  }

  document.addEventListener("DOMContentLoaded", () => {
    runtimeConfigReady
      .catch(() => {})
      .then(() => initPopupDom());
  });
})();
