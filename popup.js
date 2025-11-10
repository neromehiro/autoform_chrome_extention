(() => {
  const DATA_KEY = "autoformImportedJson";
  const SEND_STORAGE_KEY = "autoformSendContent";
  const FLOATING_BUTTON_STORAGE_KEY = "autoformShowFloatingButton";
  const AUTO_BUTTON_STORAGE_KEY = "autoformShowAutoButton";
  const API_KEY_STORAGE_KEY = "aimsalesApiKey";
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
  let currentApiKey = "";
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

  function setPlanStatus(hasKey) {
    const planEl = qs("plan-status");
    const badgeEl = qs("plan-badge");
    const label = hasKey ? "有料版" : "無料版";
    if (planEl) {
      planEl.textContent = label;
      planEl.classList.toggle("plan-status-paid", hasKey);
    }
    if (badgeEl) {
      badgeEl.textContent = label;
      badgeEl.classList.toggle("plan-badge-paid", hasKey);
    }
  }

  function setApiKeyStatus(message, isError = false) {
    const statusEl = qs("api-key-status");
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.style.color = isError ? "#b91c1c" : "#475569";
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

  function loadApiKeyState() {
    const input = qs("api-key-input");
    if (!chrome?.storage?.sync) {
      currentApiKey = "";
      if (input) input.value = "";
      setPlanStatus(false);
      setApiKeyStatus("storage が利用できません (APIキー未設定)", true);
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

  if (chrome?.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync") return;
      if (Object.prototype.hasOwnProperty.call(changes, API_KEY_STORAGE_KEY)) {
        const nextValue = changes[API_KEY_STORAGE_KEY]?.newValue;
        currentApiKey = typeof nextValue === "string" ? nextValue : "";
        const input = qs("api-key-input");
        if (input && document.activeElement !== input) {
          input.value = currentApiKey;
        }
        setPlanStatus(Boolean(currentApiKey));
        setApiKeyStatus(currentApiKey ? "APIキーが更新されました" : "APIキーが未設定です");
      }
    });
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
    const sendContentToggle = qs("send-content-toggle");
    const sendContentBody = qs("send-content-body");
    const saveSendBtn = qs("save-send-content");
    const floatingButtonCheckbox = qs("show-floating-button");
    const saveApiKeyBtn = qs("save-api-key");

    if (fillBtn) {
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

    refreshDetectedInputCount();
    loadSendContent();
    loadApiKeyState();
  });
})();
