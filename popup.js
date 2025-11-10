(() => {
  const DATA_KEY = "autoformImportedJson";
  const SEND_STORAGE_KEY = "autoformSendContent";
  const FLOATING_BUTTON_STORAGE_KEY = "autoformShowFloatingButton";
  const AUTO_BUTTON_STORAGE_KEY = "autoformShowAutoButton";
  const DETAIL_STORAGE_KEYS = {
    api: "autoformCachedApiDetails",
    curl: "autoformCachedCurlDetails"
  };
  const DEFAULT_SEND_CONTENT = {
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
    remark: "お世話になっております。\n株式会社LASSICの阿部と申します。\n\n本日はエンジニア採用・調達における新規のお打ち合わせの件でご連絡いたしました。\n\n弊社ではIT人材特化型の紹介サービスを展開しておりまして、全国47都道府県から集客した1万人超のデータベースを基に、エンジニアをご紹介させていただいております。\n直近では「React、Next.jsでのフロントエンド開発」のご経験をお持ちの方や「PM、テックリード」のご経験をお持ちの方にも多数ご登録いただいております。\n\nRemoguサービスの強み：\n★実務経験3年以上の即戦力エンジニア/デザイナーが1万8000名ご登録\n★フルリモートワークからハイブリッドワークが可能な方まで幅広い人材バラエティ\n★フリーランス人材/中途採用双方でご支援可能\n★直近上流工程の開発やPM/PL・テックリードのご経験をお持ちの方の流入あり\n★開発系の言語からAI系、ゲーム系言語まで対応可能\n\nこちらのリンクより弊サービスについてご確認いただけますので、ご判断の材料にしていただけますと幸いです。\nhttps://www.lassic.co.jp/service/remogu/\n\nご多忙の中大変恐縮ではございますが、一度オンラインでのお打ち合わせの機会をいただけないでしょうか。\n現時点でのご活用ではなく、情報交換でも構いません。\nもしお話可能でしたら、オンラインにて30～60分ほどミーティングの機会をいただけますと幸いです。\n\n日程調整：https://nitte.app/QY6j3DQE60gxhQk40G8ulgiA5B63/42351ab0\n\nご検討のほど、よろしくお願い申し上げます。"
  };

  let currentData = null;
  let currentSendContent = null;
  let cachedDetails = { api: "", curl: "" };
  const AUTO_SAVE_DEBOUNCE_MS = 800;
  let autoSaveTimerId = null;
  let lastAutoSavedSnapshot = null;

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
    if (statusEl) {
      statusEl.textContent = message;
      statusEl.style.color = isError ? "#b91c1c" : "#555";
    }
  }

  function formatDetectionCountMessage(count) {
    if (typeof count !== "number" || !Number.isFinite(count)) {
      return "入力欄の検知状況を取得できませんでした";
    }
    if (count <= 0) {
      return "入力欄はまだ検知されていません。";
    }
    return `${count}件以上の入力欄が検知されました。`;
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

  function initFloatingButtonToggle(checkbox) {
    if (!checkbox) return;

    const apply = (value) => {
      checkbox.checked = value;
    };

    if (chrome?.storage?.sync) {
      chrome.storage.sync.get(FLOATING_BUTTON_STORAGE_KEY, (res) => {
        apply(res?.[FLOATING_BUTTON_STORAGE_KEY] === true);
      });
    } else {
      apply(false);
    }

    checkbox.addEventListener("change", () => {
      if (!chrome?.storage?.sync) return;
      chrome.storage.sync.set({ [FLOATING_BUTTON_STORAGE_KEY]: checkbox.checked });
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

  async function fetchApiLog() {
    const tabId = await getActiveTabId().catch(() => null);
    return new Promise((resolve, reject) => {
      if (!chrome?.runtime?.sendMessage) {
        reject(new Error("runtime API が利用できません"));
        return;
      }
      chrome.runtime.sendMessage({ type: "autoform_get_last_api_log", tabId }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(response?.log || null);
      });
    });
  }

  async function fetchCurlLogs() {
    const tabId = await getActiveTabId().catch(() => null);
    return new Promise((resolve, reject) => {
      if (!chrome?.runtime?.sendMessage) {
        reject(new Error("runtime API が利用できません"));
        return;
      }
      chrome.runtime.sendMessage({ type: "autoform_get_detected_curl_logs", tabId }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        const logs = Array.isArray(response?.logs) ? response.logs : [];
        resolve(logs);
      });
    });
  }

  async function fetchUserInfoDetails({ refresh = false, reason = null } = {}) {
    return new Promise((resolve, reject) => {
      if (!chrome?.runtime?.sendMessage) {
        reject(new Error("runtime API が利用できません"));
        return;
      }
      chrome.runtime.sendMessage(
        { type: "autoform_get_user_info_details", refresh, reason },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (response?.error && !response?.userInfo) {
            reject(new Error(response.error));
            return;
          }
          resolve(response?.userInfo || null);
        }
      );
    });
  }

  function formatApiLog(log) {
    if (!log) {
      return "まだAPIリクエストの履歴がありません。フォーム入力を実行してください。";
    }
    const lines = [];
    const time = new Date(log.timestamp || Date.now()).toLocaleString();
    lines.push(`取得時刻: ${time}`);
    lines.push("");
    lines.push("-- Request --");
    lines.push(
      JSON.stringify(
        log.request || {},
        null,
        2
      )
    );
    lines.push("");
    if (log.error) {
      lines.push(`-- Error --\n${log.error}`);
    } else {
      lines.push("-- Response --");
      lines.push(
        JSON.stringify(
          log.response || {},
          null,
          2
        )
      );
      lines.push("");
      lines.push(`items_count: ${log.items_count ?? "不明"}`);
    }
    return lines.join("\n");
  }

  async function handleShowApiDetails(btn, outputEl) {
    if (!outputEl) return;
    const previousText = outputEl.textContent || "";
    const hadPrevious = Boolean(previousText.trim());
    btn.disabled = true;
    outputEl.style.display = "block";
    outputEl.textContent = "取得中...";
    try {
      const log = await fetchApiLog();
      if (log) {
        const text = formatApiLog(log);
        setDetailTextOutput(outputEl, text);
        cacheDetailText("api", text);
        setDetailButtonState(btn, true);
      } else if (hadPrevious) {
        setDetailTextOutput(outputEl, previousText);
      } else {
        outputEl.textContent = "まだAPIレスポンスを取得していません。";
      }
    } catch (err) {
      outputEl.textContent = `詳細取得に失敗しました: ${err.message}`;
    } finally {
      btn.disabled = false;
    }
  }

  const FLOW_STAGE_LABELS = {
    first: "1回目 (入力→確認)",
    second: "2回目 (送信確定)"
  };
  const FLOW_REASON_LABELS = {
    first_detected: "初回: メール一致",
    email_match: "メール一致 (セッション継続)",
    "submit=send": "body に submit=send",
    "url_path=/send": "URL が /send",
    "location=/thanks": "Location が /thanks|/completion",
    "referer=/confirm": "Referer が /confirm",
    form_id_combo: "フォームID + submitConfirm 無し",
    cdp_stack_match: "CDP: submit/click stack一致"
  };

  function filterLogsByStage(logs, stage = null) {
    if (!Array.isArray(logs)) return [];
    if (!stage) return logs;
    return logs.filter((log) => log?.flowStage === stage);
  }

  function formatCurlLogs(logs) {
    if (!Array.isArray(logs) || logs.length === 0) {
      return "まだメールアドレスを含むリクエストを検知していません。フォーム送信後に再度お試しください。";
    }
    return logs
      .map((log, index) => {
        const lines = [];
        const time = new Date(log.timestamp || Date.now()).toLocaleString();
        lines.push(`#${index + 1} / ${time}`);
        lines.push(`URL: ${log.url}`);
        if (log.origin) {
          lines.push(`Origin: ${log.origin}`);
        }
        lines.push(`送信元URL: ${log.sourceUrl || "不明"}`);
        lines.push(`Method: ${log.method || "不明"} / Status: ${log.statusCode ?? "不明"}`);
        if (log.error) {
          lines.push(`Error: ${log.error}`);
        }
        if (log.email) {
          lines.push(`Email: ${log.email}`);
        }
        if (log.flowStage || log.flowReason || log.flowId || log.formId) {
          const stageLabel = FLOW_STAGE_LABELS[log.flowStage] || log.flowStage;
          if (stageLabel) {
            lines.push(`Flow Stage: ${stageLabel}`);
          }
          const reasonLabel = log.flowReason ? FLOW_REASON_LABELS[log.flowReason] || log.flowReason : null;
          if (reasonLabel) {
            lines.push(`Flow 判定根拠: ${reasonLabel}`);
          }
          if (log.flowId) {
            lines.push(`Flow ID: ${log.flowId}`);
          }
          if (log.formId) {
            lines.push(`Form ID: ${log.formId}`);
          }
          if (typeof log.flowCompleted === "boolean" && log.flowStage === "second") {
            lines.push(`完了検知: ${log.flowCompleted ? "完了" : "未確認"}`);
          }
        }
        if (log.cdpMatch?.metadata?.eventName) {
          lines.push(`CDPイベント: ${log.cdpMatch.metadata.eventName}`);
        }
        lines.push("curl:");
        lines.push(log.curl || "(curl文字列なし)");
        return lines.join("\n");
      })
      .join("\n\n");
  }

  function stringifyWithLimit(value, limit = 12000) {
    try {
      const normalized = value === undefined ? null : value;
      const json = JSON.stringify(normalized, null, 2);
      if (typeof json !== "string") {
        return "";
      }
      if (limit && json.length > limit) {
        return `${json.slice(0, limit)}...\n(以下 ${json.length - limit} 文字を省略)`;
      }
      return json;
    } catch (err) {
      return `<<JSON変換エラー: ${err.message}>>`;
    }
  }

  function formatUserInfoDetails(info) {
    if (!info) {
      return "まだユーザー情報を取得していません。対象ページを開いた後に再度お試しください。";
    }
    const lines = [];
    const time = new Date(info.timestamp || Date.now()).toLocaleString();
    lines.push(`取得時刻: ${time}`);
    if (info.reason) {
      lines.push(`トリガー: ${info.reason}`);
    }
    lines.push("");
    lines.push("== Runtime ==");
    lines.push(stringifyWithLimit(info.runtime));
    lines.push("");
    lines.push("== Platform ==");
    lines.push(stringifyWithLimit(info.platformInfo));
    lines.push("");
    lines.push("== Browser ==");
    lines.push(stringifyWithLimit(info.browserInfo));
    lines.push("");
    lines.push("== Permissions ==");
    lines.push(stringifyWithLimit(info.permissions));
    lines.push("");
    lines.push("== Profile (identity) ==");
    lines.push(stringifyWithLimit(info.profile));
    lines.push("");
    lines.push("== System Signals ==");
    lines.push(stringifyWithLimit(info.systemSignals));
    lines.push("");
    const storage = info.storage || {};
    ["local", "sync"].forEach((area) => {
      const snapshot = storage[area];
      lines.push(`== Storage (${area}) ==`);
      if (!snapshot || snapshot.available === false) {
        lines.push("利用できません");
      } else {
        if (snapshot.error) {
          lines.push(`Error: ${snapshot.error}`);
        }
        if (typeof snapshot.bytesInUse === "number") {
          lines.push(`Bytes: ${snapshot.bytesInUse}`);
        }
        if (Array.isArray(snapshot.keys)) {
          lines.push(`Keys: ${snapshot.keys.length ? snapshot.keys.join(", ") : "(なし)"}`);
        }
        lines.push(stringifyWithLimit(snapshot.data));
      }
      lines.push("");
    });
    return lines.join("\n").trim();
  }

  async function handleShowUserInfoDetails(btn, outputEl) {
    if (!outputEl) return;
    btn.disabled = true;
    outputEl.style.display = "block";
    outputEl.textContent = "取得中...";
    try {
      const info = await fetchUserInfoDetails({ refresh: true, reason: "popup_manual" });
      outputEl.textContent = formatUserInfoDetails(info);
      await refreshUserInfoDetailIndicator({ silent: true });
    } catch (err) {
      outputEl.textContent = `ユーザー情報の取得に失敗しました: ${err.message}`;
    } finally {
      btn.disabled = false;
    }
  }

  function formatAnalysisLogEntries(logs) {
    if (!Array.isArray(logs) || logs.length === 0) {
      return "まだデータがありません";
    }
    return logs
      .map((log, index) => {
        const lines = [];
        const time = new Date(log.timestamp || Date.now()).toLocaleString();
        lines.push(`#${index + 1} / ${time}`);
        lines.push(`送信元URL: ${log.sourceUrl || "不明"}`);
        lines.push("");
        lines.push("-- curl --");
        lines.push(log.curl || "(curl文字列なし)");
        if (log.request) {
          lines.push("");
          lines.push("-- Request --");
          lines.push(JSON.stringify(log.request, null, 2));
        }
        if (log.response) {
          lines.push("");
          lines.push("-- Response --");
          lines.push(JSON.stringify(log.response, null, 2));
        }
        return lines.join("\n");
      })
      .join("\n\n" + "-".repeat(20) + "\n\n");
  }

  function sanitizeApiLogForAnalysis(log) {
    if (!log || typeof log !== "object") {
      return log;
    }
    const request = log.request;
    if (!request || typeof request !== "object" || !Object.prototype.hasOwnProperty.call(request, "user_info")) {
      return log;
    }
    const sanitizedRequest = { ...request };
    delete sanitizedRequest.user_info;
    return { ...log, request: sanitizedRequest };
  }

  function formatAnalysisData(logs, { apiLog = null, currentUrl = null } = {}) {
    const sanitizedApiLog = sanitizeApiLogForAnalysis(apiLog);
    const latestSourceUrl = Array.isArray(logs) && logs.length ? logs[0]?.sourceUrl || "" : "";
    let urlText = "";
    if (sanitizedApiLog?.request?.page_url) {
      urlText = `${sanitizedApiLog.request.page_url} (直前レスポンス)`;
    } else if (latestSourceUrl) {
      urlText = `${latestSourceUrl} (curl取得時)`;
    } else if (currentUrl) {
      urlText = `${currentUrl} (現在のタブ)`;
    } else {
      urlText = "取得できませんでした";
    }
    const sections = [];
    sections.push("=== 解析対象のWebサイトURL (直前のレスポンス時) ===");
    sections.push(urlText);
    sections.push("");
    sections.push("=== 直前のレスポンス詳細 ===");
    sections.push(formatApiLog(sanitizedApiLog));
    sections.push("");
    sections.push("=== curl / リクエストログ ===");
    sections.push(formatAnalysisLogEntries(logs));
    return sections.join("\n");
  }

  function formatDetailTimestamp(ts) {
    if (!ts) return "";
    try {
      return new Date(ts).toLocaleString();
    } catch (_) {
      return "";
    }
  }

  function setDetailStatus(el, state, text) {
    if (!el) return;
    el.textContent = text;
    el.dataset.state = state;
    el.classList.toggle("has-data", state === "has-data");
    el.classList.toggle("error", state === "error");
  }

  function setDetailButtonState(btn, hasData) {
    if (!btn) return;
    btn.classList.toggle("data-available", !!hasData);
  }

  function setDetailTextOutput(el, text) {
    if (!el) return;
    if (text) {
      el.textContent = text;
      el.style.display = "block";
    } else {
      el.textContent = "";
      el.style.display = "none";
    }
  }

  function cacheDetailText(kind, text) {
    if (!chrome?.storage?.local || !text) return;
    const key = DETAIL_STORAGE_KEYS[kind];
    if (!key) return;
    cachedDetails = { ...cachedDetails, [kind]: text };
    chrome.storage.local.set({ [key]: text });
  }

  function clearCachedDetails() {
    if (!chrome?.storage?.local) return;
    chrome.storage.local.remove(Object.values(DETAIL_STORAGE_KEYS));
    cachedDetails = { api: "", curl: "" };
  }

  function loadCachedDetails() {
    return new Promise((resolve) => {
      if (!chrome?.storage?.local) {
        cachedDetails = { api: "", curl: "" };
        resolve(cachedDetails);
        return;
      }
      chrome.storage.local.get(Object.values(DETAIL_STORAGE_KEYS), (res) => {
      cachedDetails = {
        api: res?.[DETAIL_STORAGE_KEYS.api] || "",
        curl: res?.[DETAIL_STORAGE_KEYS.curl] || ""
      };
        resolve(cachedDetails);
      });
    });
  }

  async function refreshCurlIndicator(
    {
      indicatorId,
      buttonId,
      cacheKey,
      stage = null,
      emptyLabel = "データ未検知",
      cachedLabel = "保存済みのログあり"
    },
    options = {}
  ) {
    const indicator = qs(indicatorId);
    const btn = qs(buttonId);
    if (!indicator) return;
    if (!options.silent) {
      setDetailStatus(indicator, "loading", "確認中…");
    }
    try {
      const logs = await fetchCurlLogs();
      const filtered = filterLogsByStage(logs, stage);
      if (filtered.length > 0) {
        const time = formatDetailTimestamp(filtered[0].timestamp);
        setDetailStatus(indicator, "has-data", time ? `最新検知: ${time}` : "データあり");
        setDetailButtonState(btn, true);
      } else if (cachedDetails[cacheKey]) {
        setDetailStatus(indicator, "has-data", cachedLabel);
        setDetailButtonState(btn, true);
      } else {
        setDetailStatus(indicator, "empty", emptyLabel);
        setDetailButtonState(btn, false);
      }
    } catch (_) {
      setDetailStatus(indicator, "error", "取得エラー");
      setDetailButtonState(btn, false);
    }
  }

  async function refreshCurlDetailIndicator(options = {}) {
    await refreshCurlIndicator(
      {
        indicatorId: "curl-details-status",
        buttonId: "show-curl-details",
        cacheKey: "curl",
        stage: null,
        emptyLabel: "データ未検知",
        cachedLabel: "保存済みのログあり"
      },
      options
    );
  }

  async function refreshApiDetailIndicator(options = {}) {
    const indicator = qs("api-details-status");
    const btn = qs("show-api-details");
    if (!indicator) return;
    if (!options.silent) {
      setDetailStatus(indicator, "loading", "確認中…");
    }
    try {
      const log = await fetchApiLog();
      if (log) {
        const time = formatDetailTimestamp(log.timestamp);
        setDetailStatus(indicator, "has-data", time ? `最新取得: ${time}` : "データあり");
        setDetailButtonState(btn, true);
      } else if (cachedDetails.api) {
        setDetailStatus(indicator, "has-data", "保存済みのレスポンスあり");
        setDetailButtonState(btn, true);
      } else {
        setDetailStatus(indicator, "empty", "未取得");
        setDetailButtonState(btn, false);
      }
    } catch (_) {
      setDetailStatus(indicator, "error", "取得エラー");
      setDetailButtonState(btn, false);
    }
  }

  async function refreshUserInfoDetailIndicator(options = {}) {
    const indicator = qs("user-info-details-status");
    const btn = qs("show-user-info-details");
    if (!indicator) return;
    if (!options.silent) {
      setDetailStatus(indicator, "loading", "確認中…");
    }
    try {
      const snapshot = await fetchUserInfoDetails({ refresh: false, reason: "popup_indicator" });
      if (snapshot?.timestamp) {
        const time = formatDetailTimestamp(snapshot.timestamp);
        setDetailStatus(indicator, "has-data", time ? `最新取得: ${time}` : "データあり");
        setDetailButtonState(btn, true);
      } else {
        setDetailStatus(indicator, "empty", "未取得");
        setDetailButtonState(btn, false);
      }
    } catch (_) {
      setDetailStatus(indicator, "error", "取得エラー");
      setDetailButtonState(btn, false);
    }
  }

  async function refreshDetailIndicators(options = {}) {
    await Promise.all([
      refreshCurlDetailIndicator(options),
      refreshApiDetailIndicator(options),
      refreshUserInfoDetailIndicator(options),
      refreshAnalysisDataSection(options)
    ]);
  }

  async function handleShowCurlDetails(
    btn,
    outputEl,
    {
      stage = null,
      cacheKey = "curl",
      emptyMessage = "まだcurlログを検知していません。フォーム送信後に再度お試しください。",
      label = "curl"
    } = {}
  ) {
    if (!outputEl) return;
    const previousText = outputEl.textContent || "";
    const hadPrevious = Boolean(previousText.trim());
    btn.disabled = true;
    outputEl.style.display = "block";
    outputEl.textContent = "取得中...";
    try {
      const logs = await fetchCurlLogs();
      const filtered = filterLogsByStage(logs, stage);
      if (Array.isArray(filtered) && filtered.length) {
        const text = formatCurlLogs(filtered);
        setDetailTextOutput(outputEl, text);
        cacheDetailText(cacheKey, text);
        setDetailButtonState(btn, true);
      } else if (hadPrevious) {
        setDetailTextOutput(outputEl, previousText);
      } else {
        outputEl.textContent = emptyMessage;
      }
    } catch (err) {
      outputEl.textContent = `${label}情報の取得に失敗しました: ${err.message}`;
    } finally {
      btn.disabled = false;
    }
  }

  function handleDetailHistoryReset(btn) {
    if (!btn) return;
    btn.addEventListener("click", () => {
      btn.disabled = true;
      clearCachedDetails();
      setDetailTextOutput(qs("curl-details"), "");
      setDetailTextOutput(qs("api-details"), "");
      setDetailTextOutput(qs("user-info-details"), "");
      setDetailTextOutput(qs("analysis-data"), "まだデータがありません");
      setDetailStatus(qs("curl-details-status"), "empty", "データ未検知");
      setDetailStatus(qs("api-details-status"), "empty", "未取得");
      setDetailStatus(qs("user-info-details-status"), "empty", "未取得");
      setDetailStatus(qs("analysis-data-status"), "empty", "データ未検知");

      const sendResetMessage = () =>
        new Promise((resolve, reject) => {
          if (!chrome?.runtime?.sendMessage) {
            resolve(false);
            return;
          }
          chrome.runtime.sendMessage({ type: "autoform_reset_debug_data" }, (response) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            resolve(response?.ok === true);
          });
        });

      sendResetMessage()
        .catch((err) => {
          console.warn("[AutoForm] detail reset failed", err);
          setDetailStatus(qs("curl-details-status"), "error", "リセットエラー");
          setDetailStatus(qs("api-details-status"), "error", "リセットエラー");
          setDetailStatus(qs("analysis-data-status"), "error", "リセットエラー");
        })
        .finally(() => {
          btn.disabled = false;
          refreshDetailIndicators({ silent: true });
        });
    });
  }

  async function listFrameOrigins(tabId) {
    const frames = await new Promise((resolve, reject) => {
      if (!chrome?.webNavigation?.getAllFrames) {
        reject(new Error("webNavigation API が利用できません"));
        return;
      }
      chrome.webNavigation.getAllFrames({ tabId }, (res) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(res || []);
      });
    });
    const origins = new Set();
    for (const frame of frames) {
      try {
        if (!frame.url) continue;
        const u = new URL(frame.url);
        if (["chrome:", "about:", "data:"].includes(u.protocol)) continue;
        origins.add(u.origin);
      } catch (_) {
        continue;
      }
    }
    const topOrigin = await new Promise((resolve) => {
      if (!chrome?.tabs?.get) {
        resolve(null);
        return;
      }
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        try {
          resolve(new URL(tab?.url || "").origin);
        } catch (_) {
          resolve(null);
        }
      });
    });
    if (topOrigin) origins.delete(topOrigin);
    return [...origins];
  }

  async function ensureOriginsPermission(origins) {
    const need = [];
    for (const origin of origins) {
      const has = await new Promise((resolve) => {
        chrome.permissions.contains({ origins: [`${origin}/*`] }, (granted) => {
          resolve(!!granted);
        });
      });
      if (!has) need.push(origin);
    }
    if (!need.length) return true;
    const ok = await new Promise((resolve) => {
      chrome.permissions.request(
        { origins: need.map((origin) => `${origin}/*`) },
        (granted) => resolve(!!granted)
      );
    });
    return ok;
  }

  async function refreshAnalysisDataSection(options = {}) {
    const statusEl = qs("analysis-data-status");
    const outputEl = qs("analysis-data");
    if (!statusEl || !outputEl) return;
    if (!options.silent) {
      statusEl.textContent = "確認中…";
    }
    try {
      const logs = await fetchCurlLogs();
      const [apiLog, currentUrl] = await Promise.all([fetchApiLog().catch(() => null), getActiveTabUrl()]);
      const latestTimestamp = (Array.isArray(logs) && logs[0]?.timestamp) || apiLog?.timestamp || null;
      if (latestTimestamp) {
        const time = formatDetailTimestamp(latestTimestamp);
        statusEl.textContent = time ? `最新検知: ${time}` : "情報あり";
      } else if ((Array.isArray(logs) && logs.length > 0) || apiLog) {
        statusEl.textContent = "情報あり";
      } else {
        statusEl.textContent = "データ未検知";
      }
      outputEl.textContent = formatAnalysisData(logs, { apiLog, currentUrl });
    } catch (err) {
      statusEl.textContent = "取得エラー";
      outputEl.textContent = `curl情報の取得に失敗しました: ${err.message}`;
    }
  }

  async function handleCopyAnalysisData(btn) {
    const outputEl = qs("analysis-data");
    const feedbackEl = qs("analysis-copy-feedback");
    if (!outputEl) return;
    const text = outputEl.textContent || "";
    if (!text.trim()) {
      if (feedbackEl) {
        feedbackEl.textContent = "コピー対象のデータがありません";
        feedbackEl.style.color = "#dc2626";
        feedbackEl.style.display = "block";
        setTimeout(() => {
          feedbackEl.style.display = "none";
          feedbackEl.style.color = "#059669";
          feedbackEl.textContent = "コピーしました";
        }, 2000);
      }
      return;
    }
    btn.disabled = true;
    try {
      await navigator.clipboard.writeText(text);
      if (feedbackEl) {
        feedbackEl.textContent = "コピーしました";
        feedbackEl.style.color = "#059669";
        feedbackEl.style.display = "block";
        setTimeout(() => {
          feedbackEl.style.display = "none";
        }, 2000);
      }
    } catch (err) {
      if (feedbackEl) {
        feedbackEl.textContent = `コピーに失敗しました: ${err.message}`;
        feedbackEl.style.color = "#dc2626";
        feedbackEl.style.display = "block";
        setTimeout(() => {
          feedbackEl.style.display = "none";
          feedbackEl.style.color = "#059669";
          feedbackEl.textContent = "コピーしました";
        }, 2500);
      }
    } finally {
      btn.disabled = false;
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
    setInputCountStatus("入力欄を検知中です…");
    try {
      const tabId = await getActiveTabId();
      const frameIds = await getAllFrameIds(tabId);
      const results = await Promise.all(
        frameIds.map((frameId) =>
          sendCommandToFrame(tabId, frameId, "autoform_count_inputs", null)
        )
      );
      const total = results.reduce((sum, res) => sum + (res?.count || 0), 0);
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
      const origins = await listFrameOrigins(tabId);
      const ok = await ensureOriginsPermission(origins);
      if (!ok) {
        setStatus("実行中止: 権限が得られませんでした", true);
        btn.disabled = false;
        updateExecuteState();
        await refreshDetectedInputCount();
        return;
      }
      setStatus("入力を送信中…");
      const frameIds = await getAllFrameIds(tabId);
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
      await refreshDetailIndicators({ silent: true });
    }
  }

  async function handleManualFill(btn) {
    btn.disabled = true;
    setManualStatus("フォーム入力中…");
    try {
      const tabId = await getActiveTabId();
      const frameIds = await getAllFrameIds(tabId);
      const results = await Promise.all(
        frameIds.map((frameId) =>
          sendCommandToFrame(tabId, frameId, "autoform_manual_fill", null)
        )
      );
      const fatalError = results.find((item) => item?.error && !item?.unreachable)?.error;
      if (fatalError) {
        setManualStatus(`失敗: ${fatalError}`, true);
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
          return acc;
        },
        { success: 0, skipped: 0, total: 0 }
      );
      setManualStatus(`完了: ${summary.success}件に入力`);
    } catch (err) {
      setManualStatus(`失敗: ${err.message}`, true);
    } finally {
      btn.disabled = false;
      await refreshDetectedInputCount();
      await refreshDetailIndicators({ silent: true });
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
      const origins = await listFrameOrigins(tabId);
      const ok = await ensureOriginsPermission(origins);
      if (!ok) {
        setSendContentStatus("入力中止: 権限が得られませんでした", true);
        return;
      }
      setSendContentStatus("入力処理中…");
      const frameIds = await getAllFrameIds(tabId);
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

  document.addEventListener("DOMContentLoaded", () => {
    const fillBtn = qs("fill-now");
    const apiDetailsBtn = qs("show-api-details");
    const apiDetailsBox = qs("api-details");
    const userInfoDetailsBtn = qs("show-user-info-details");
    const userInfoDetailsBox = qs("user-info-details");
    const curlDetailsBtn = qs("show-curl-details");
    const curlDetailsBox = qs("curl-details");
    const copyAnalysisBtn = qs("copy-analysis-data");
    const resetDetailHistoryBtn = qs("reset-detail-history");
    const sendContentToggle = qs("send-content-toggle");
    const sendContentBody = qs("send-content-body");
    const saveSendBtn = qs("save-send-content");
    const floatingButtonCheckbox = qs("show-floating-button");

    if (fillBtn) {
      fillBtn.addEventListener("click", () => handleManualFill(fillBtn));
    }
    if (apiDetailsBtn && apiDetailsBox) {
      apiDetailsBtn.addEventListener("click", () => handleShowApiDetails(apiDetailsBtn, apiDetailsBox));
    }
    if (userInfoDetailsBtn && userInfoDetailsBox) {
      userInfoDetailsBtn.addEventListener("click", () =>
        handleShowUserInfoDetails(userInfoDetailsBtn, userInfoDetailsBox)
      );
    }
    if (curlDetailsBtn && curlDetailsBox) {
      curlDetailsBtn.addEventListener("click", () => handleShowCurlDetails(curlDetailsBtn, curlDetailsBox));
    }
    if (copyAnalysisBtn) {
      copyAnalysisBtn.addEventListener("click", () => handleCopyAnalysisData(copyAnalysisBtn));
    }
    if (resetDetailHistoryBtn) {
      handleDetailHistoryReset(resetDetailHistoryBtn);
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

    refreshDetectedInputCount();
    loadSendContent();
    loadCachedDetails()
      .then(({ api, curl }) => {
        setDetailTextOutput(apiDetailsBox, api);
        setDetailTextOutput(curlDetailsBox, curl);
      })
      .finally(() => {
        refreshDetailIndicators();
      });
  });
})();
