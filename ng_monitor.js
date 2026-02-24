const MONITOR_STYLE_ID = "autoform-ng-style";
const ALERT_CLASS = "autoform-ng-alert";
const HIGHLIGHT_CLASS = "autoform-ng-highlight";
const HIGHLIGHTABLE_SELECTOR =
  "p,li,section,article,blockquote,dd,dt,div,td,th,header,footer,main,.entry-content,.post,.content";
const MAX_DISPLAY_WORDS = 5;

const NG_RULES = [
  { category: "A", words: ["営業", "勧誘", "営業目的", "セールス"] },
  { category: "B", words: ["受け付けておりません", "お断り", "ご遠慮", "固く", "然るべき措置", "ご遠慮ください"] },
  { category: "C", words: ["対応手数料", "対応費"] }
];
const EXCLUDED_PHRASES = ["営業日","営業時間"]; // Allow "営業日" without triggering the "営業" rule

const CATEGORY_PRIORITY = ["C", "B", "A"];
const DANGER_LABEL = {
  high: "危険度・高",
  medium: "危険度・中"
};

export function createNgWordMonitor() {
  return new NgWordMonitor();
}

class NgWordMonitor {
  constructor() {
    this.matches = [];
    this.primaryMatch = null;
    this.floatingContainer = null;
    this.alertButton = null;
    this.activeHighlightTarget = null;
    this.pendingScanTimer = null;
    this.observer = null;
    this.initialized = false;
    this.handleAlertClick = this.handleAlertClick.bind(this);
    this.handleHighlightDismiss = this.handleHighlightDismiss.bind(this);
    this.handleMutations = this.handleMutations.bind(this);
  }

  init() {
    if (this.initialized || typeof document === "undefined") return;
    this.initialized = true;
    this.ensureStyles();
    const bootstrap = () => {
      if (document.body) {
        this.performScan();
        this.observeMutations();
        document.addEventListener("click", this.handleHighlightDismiss);
      }
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
    } else {
      bootstrap();
    }
  }

  ensureStyles() {
    if (document.getElementById(MONITOR_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = MONITOR_STYLE_ID;
    style.textContent = `
.${ALERT_CLASS} {
  border: none;
  border-radius: 14px 14px 4px 14px;
  background: linear-gradient(135deg, #f97316, #dc2626);
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.45;
  padding: 10px 16px;
  min-width: 190px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  box-shadow: 0 18px 34px rgba(220, 38, 38, 0.35);
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  transform-origin: bottom right;
  animation: autoformNgAlertReveal 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.${ALERT_CLASS}:hover,
.${ALERT_CLASS}:focus-visible {
  filter: brightness(1.05);
  outline: none;
}
.autoform-ng-alert-caption {
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  opacity: 0.92;
}
.autoform-ng-alert-level {
  font-size: 16px;
  font-weight: 800;
  letter-spacing: 0.08em;
}
.autoform-ng-alert-hitlist-label {
  font-size: 10px;
  letter-spacing: 0.1em;
  opacity: 0.8;
}
.autoform-ng-alert-hitlist {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 2px;
}
.autoform-ng-alert-pill {
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  background: rgba(15, 23, 42, 0.18);
  color: #fff;
  white-space: nowrap;
}
.autoform-ng-alert-pill.is-extra {
  background: rgba(248, 250, 252, 0.15);
}
.${HIGHLIGHT_CLASS} {
  position: relative;
  display: inline-block;
  background: linear-gradient(90deg, rgba(248, 250, 252, 0.9), rgba(254, 242, 242, 0.85));
  border-radius: 12px;
  padding: 5px;
  box-shadow: 0 0 0 2px rgba(248, 113, 113, 0.55), 0 22px 44px rgba(248, 113, 113, 0.25);
  animation: autoformNgHighlightPulse 1.4s ease-out both;
  cursor: pointer;
  scroll-margin: 120px;
}
@keyframes autoformNgHighlightPulse {
  0% {
    opacity: 0.3;
    box-shadow: 0 0 0 0 rgba(248, 113, 113, 0.6), 0 0 20px rgba(248, 113, 113, 0.3);
  }
  50% {
    opacity: 1;
  }
  100% {
    opacity: 1;
    box-shadow: 0 0 0 2px rgba(248, 113, 113, 0.55), 0 18px 42px rgba(248, 113, 113, 0.2);
  }
}
@keyframes autoformNgAlertReveal {
  0% {
    opacity: 0;
    transform: translateY(12px) scale(0.95);
  }
  100% {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
`;
    (document.head || document.documentElement).appendChild(style);
  }

  setFloatingContainer(container) {
    this.floatingContainer = container || null;
    if (!container) {
      this.teardownAlert();
      this.clearHighlight();
      return;
    }
    if (this.alertButton && this.alertButton.parentElement !== container) {
      this.alertButton.remove();
      container.prepend(this.alertButton);
    }
    this.renderAlert();
  }

  observeMutations() {
    if (this.observer) {
      this.observer.disconnect();
    }
    if (!document?.body) return;
    this.observer = new MutationObserver(this.handleMutations);
    this.observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  handleMutations() {
    if (this.pendingScanTimer) return;
    const scheduler =
      (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function"
        ? window.requestAnimationFrame.bind(window)
        : (cb) => setTimeout(cb, 200));
    this.pendingScanTimer = scheduler(() => {
      this.pendingScanTimer = null;
      this.performScan();
    });
  }

  performScan() {
    if (!document?.body) return;
    this.matches = collectMatches(document.body);
    this.primaryMatch = selectPrimaryMatch(this.matches);
    if (!this.primaryMatch) {
      this.clearHighlight();
    }
    this.renderAlert();
  }

  ensureAlertButton() {
    if (!this.floatingContainer) return null;
    if (this.alertButton && !this.alertButton.isConnected) {
      this.alertButton = null;
    }
    if (!this.alertButton) {
      this.alertButton = document.createElement("button");
      this.alertButton.type = "button";
      this.alertButton.className = ALERT_CLASS;
      this.alertButton.addEventListener("click", this.handleAlertClick);
    }
    if (this.alertButton.parentElement !== this.floatingContainer) {
      this.floatingContainer.prepend(this.alertButton);
    }
    return this.alertButton;
  }

  renderAlert() {
    if (!this.primaryMatch || !this.floatingContainer || !this.primaryMatch.element?.isConnected) {
      this.teardownAlert();
      return;
    }
    const alertEl = this.ensureAlertButton();
    if (!alertEl) return;
    const categories = this.primaryMatch.categories || new Set();
    const danger = computeDangerLevel(categories);
    const label = DANGER_LABEL[danger] || DANGER_LABEL.medium;
    const words = Array.from(this.primaryMatch.words || []);
    const displayWords = words.slice(0, MAX_DISPLAY_WORDS);
    const remaining = Math.max(words.length - displayWords.length, 0);
    const pillsHtml = displayWords
      .map((word) => `<span class="autoform-ng-alert-pill">${escapeHtml(word)}</span>`)
      .join("");
    const extraHtml = remaining > 0 ? `<span class="autoform-ng-alert-pill is-extra">+${remaining}</span>` : "";
    const hitlistContent = pillsHtml || extraHtml ? `${pillsHtml}${extraHtml}` : `<span class="autoform-ng-alert-pill">要確認</span>`;
    alertEl.innerHTML = `
      <span class="autoform-ng-alert-caption">NGワードがあります</span>
      <span class="autoform-ng-alert-level">${label}</span>
      <span class="autoform-ng-alert-hitlist-label">ヒットしたワード</span>
      <div class="autoform-ng-alert-hitlist" role="list">
        ${hitlistContent}
      </div>
    `;
  }

  teardownAlert() {
    if (this.alertButton) {
      this.alertButton.removeEventListener("click", this.handleAlertClick);
      this.alertButton.remove();
      this.alertButton = null;
    }
  }

  handleAlertClick(event) {
    event.preventDefault();
    this.activateHighlight(this.primaryMatch);
  }

  activateHighlight(match) {
    if (!match?.element || !match.element.isConnected) return;
    if (this.activeHighlightTarget && this.activeHighlightTarget !== match.element) {
      this.clearHighlight();
    }
    const target = match.element;
    target.classList.remove(HIGHLIGHT_CLASS);
    target.removeAttribute("data-autoform-ng-highlighted");
    void target.offsetWidth;
    target.classList.add(HIGHLIGHT_CLASS);
    target.setAttribute("data-autoform-ng-highlighted", "1");
    this.activeHighlightTarget = target;
    try {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (_) {
      target.scrollIntoView();
    }
  }

  clearHighlight() {
    if (!this.activeHighlightTarget) return;
    this.activeHighlightTarget.classList.remove(HIGHLIGHT_CLASS);
    this.activeHighlightTarget.removeAttribute("data-autoform-ng-highlighted");
    this.activeHighlightTarget = null;
  }

  handleHighlightDismiss(event) {
    if (!this.activeHighlightTarget) return;
    if (this.activeHighlightTarget.contains(event.target)) {
      this.clearHighlight();
    }
  }
}

function collectMatches(root) {
  if (!root) return [];
  const matchesMap = new Map();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node || !node.parentElement) return NodeFilter.FILTER_SKIP;
      if (!node.textContent || !node.textContent.trim()) return NodeFilter.FILTER_SKIP;
      if (node.parentElement.closest(".autoform-floating-button-wrapper")) return NodeFilter.FILTER_REJECT;
      if (node.parentElement.closest("script,style,noscript,template")) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  while (walker.nextNode()) {
    const textNode = walker.currentNode;
    const hits = detectWords(textNode.textContent);
    if (!hits.length) continue;
    const targetElement = findHighlightTarget(textNode);
    if (!targetElement || !isHighlightable(targetElement)) continue;
    let entry = matchesMap.get(targetElement);
    if (!entry) {
      entry = {
        element: targetElement,
        categories: new Set(),
        words: new Set()
      };
      matchesMap.set(targetElement, entry);
    }
    hits.forEach(({ category, word }) => {
      entry.categories.add(category);
      entry.words.add(word);
    });
  }
  const matches = [];
  matchesMap.forEach((entry) => {
    if (!entry.categories.size || !entry.words.size) return;
    matches.push(entry);
  });
  return matches;
}

function detectWords(text) {
  if (!text || typeof text !== "string") return [];
  const hits = [];
  NG_RULES.forEach(({ category, words }) => {
    words.forEach((word) => {
      if (!word) return;
      let startIndex = 0;
      while (startIndex < text.length) {
        const index = text.indexOf(word, startIndex);
        if (index === -1) break;
        const isExcluded =
          word === "営業" && EXCLUDED_PHRASES.some((phrase) => text.startsWith(phrase, index));
        if (!isExcluded) {
          hits.push({ category, word });
          break;
        }
        startIndex = index + word.length;
      }
    });
  });
  return hits;
}

function findHighlightTarget(textNode) {
  if (!textNode) return null;
  let el = textNode.parentElement;
  while (el && el !== document.body) {
    if (typeof el.matches === "function" && el.matches(HIGHLIGHTABLE_SELECTOR)) {
      return el;
    }
    el = el.parentElement;
  }
  if (el && typeof el.matches === "function" && el.matches(HIGHLIGHTABLE_SELECTOR)) {
    return el;
  }
  return textNode.parentElement || null;
}

function isHighlightable(el) {
  if (!el || !el.isConnected) return false;
  if (el.closest(".autoform-floating-button-wrapper")) return false;
  if (el.closest("script,style,noscript,template")) return false;
  if (typeof window !== "undefined" && window.getComputedStyle) {
    const style = window.getComputedStyle(el);
    if (!style || style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
      return false;
    }
  }
  if (!el.getClientRects || el.getClientRects().length === 0) return false;
  return true;
}

function selectPrimaryMatch(matches) {
  if (!matches || !matches.length) return null;
  const sorted = matches.slice().sort((a, b) => {
    const severityDiff = getSeverityRank(a.categories) - getSeverityRank(b.categories);
    if (severityDiff !== 0) return severityDiff;
    if (a.element === b.element) return 0;
    const position = a.element.compareDocumentPosition(b.element);
    if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    return 0;
  });
  return sorted[0];
}

function getSeverityRank(categories) {
  if (!categories || !categories.size) return CATEGORY_PRIORITY.length;
  for (let i = 0; i < CATEGORY_PRIORITY.length; i += 1) {
    if (categories.has(CATEGORY_PRIORITY[i])) {
      return i;
    }
  }
  return CATEGORY_PRIORITY.length;
}

function computeDangerLevel(categories) {
  const hasB = categories.has("B");
  const hasC = categories.has("C");
  const hasA = categories.has("A");
  if (hasB || hasC) {
    return "high";
  }
  if (hasA) {
    return "medium";
  }
  return "medium";
}

function escapeHtml(input) {
  if (typeof input !== "string") return "";
  return input.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return ch;
    }
  });
}

export default createNgWordMonitor;
