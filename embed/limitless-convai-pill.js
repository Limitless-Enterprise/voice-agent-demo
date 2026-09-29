(function (global) {
  "use strict";

  var ELEVENLABS_SCRIPT_ID = "limitless-convai-elevenlabs-embed";
  var ELEVENLABS_SCRIPT_URL =
    "https://unpkg.com/@elevenlabs/convai-widget-embed";
  /** Operator-hosted agent copy; resolved from embed script origin (not client attrs). */
  var OPERATOR_CONFIG_PATH = "/config/agents";
  var LOADER_SELECTOR = 'script[src*="limitless-convai-pill"]';
  /** Hide promo after dismiss until this many ms have elapsed (7 days). */
  var DISMISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

  function resolveOperatorConfigBase(script) {
    if (!script || !script.src) {
      return OPERATOR_CONFIG_PATH;
    }
    try {
      var scriptUrl = new URL(script.src, document.baseURI);
      return scriptUrl.origin + OPERATOR_CONFIG_PATH;
    } catch (e) {
      return OPERATOR_CONFIG_PATH;
    }
  }

  function getLoaderScript() {
    if (document.currentScript) {
      return document.currentScript;
    }
    return document.querySelector(LOADER_SELECTOR);
  }

  function loadElevenLabsEmbedOnce() {
    if (document.getElementById(ELEVENLABS_SCRIPT_ID)) {
      return;
    }
    var existing = document.querySelector(
      'script[src*="@elevenlabs/convai-widget-embed"]'
    );
    if (existing) {
      if (!existing.id) {
        existing.id = ELEVENLABS_SCRIPT_ID;
      }
      return;
    }
    var s = document.createElement("script");
    s.id = ELEVENLABS_SCRIPT_ID;
    s.src = ELEVENLABS_SCRIPT_URL;
    s.async = true;
    s.type = "text/javascript";
    document.body.appendChild(s);
  }

  function createPromoController(options) {
    options = options || {};
    var script = options.script || getLoaderScript();
    var configEl = options.configEl || null;
    var widgetEl = options.widgetEl || null;
    var promoId = options.promoId || "widget-promo";

    if (document.getElementById(promoId)) {
      return { init: function () {} };
    }

    function attr(name) {
      var fromScript = script && script.getAttribute("data-" + name);
      if (fromScript != null && fromScript !== "") {
        return fromScript;
      }
      if (configEl) {
        var fromEl =
          configEl.getAttribute(name) ||
          configEl.getAttribute("data-" + name);
        if (fromEl != null && fromEl !== "") {
          return fromEl;
        }
      }
      return null;
    }

    function pillAttr(name) {
      if (!configEl) {
        return null;
      }
      var fromEl =
        configEl.getAttribute(name) || configEl.getAttribute("data-" + name);
      if (fromEl != null && fromEl !== "") {
        return fromEl;
      }
      return null;
    }

    var strings = {
      storageKey:
        pillAttr("storage-key") || attr("storage-key") || "widget-promo-dismissed",
      regionAriaLabel:
        pillAttr("region-aria-label") ||
        attr("region-aria-label") ||
        "Assistant availability",
      closeAriaLabel:
        pillAttr("close-aria-label") ||
        attr("close-aria-label") ||
        "Dismiss",
      closeLabel: "×",
      headline: pillAttr("headline") || "Hi I am Mia",
      body: pillAttr("body") || "How can I help you today?",
    };

    var timing = {
      visibleMs: 2500,
      fadeMs: 280,
      gapMs: 180,
    };

    var agentPoll = {
      intervalMs: 50,
      maxAttempts: 40,
    };

    var STYLE_VAR_MAP = {
      accentColor: "--promo-accent",
      background: "--promo-bg",
      borderColor: "--promo-border",
      textColor: "--promo-text",
      closeColor: "--promo-close",
    };

    var CSS =
      ".widget-promo{position:fixed;right:1.25rem;bottom:calc(1.25rem + 1.125rem + 3.75rem + 0.375rem);z-index:9998;display:flex;align-items:flex-start;gap:0.5rem;max-width:min(16.5rem,calc(100vw - 2.5rem));padding:0.65rem 0.75rem 0.65rem 0.85rem;border:1px solid var(--promo-border,rgba(61,154,139,0.4));border-radius:0.75rem;background:var(--promo-bg,rgba(12,18,24,0.92));box-shadow:0 8px 24px rgba(0,0,0,0.35);color:var(--promo-text,#e8eef3);font-family:\"Segoe UI\",\"Helvetica Neue\",Helvetica,Arial,sans-serif;font-size:0.8125rem;line-height:1.4;pointer-events:auto}" +
      ".widget-promo.is-hidden{display:none}" +
      ".widget-promo__text{margin:0;flex:1;min-height:1.4em}" +
      ".widget-promo__line{display:block;min-height:1.4em;opacity:1;transition:opacity 0.28s ease}" +
      ".widget-promo__line.is-faded{opacity:0}" +
      ".widget-promo__line--headline{color:var(--promo-accent,#3d9a8b);font-weight:600}" +
      ".widget-promo__line--body{font-weight:400}" +
      ".widget-promo__close{flex-shrink:0;margin:-0.15rem -0.1rem 0 0;padding:0;border:0;background:transparent;color:var(--promo-close,#9aadb8);font:inherit;font-size:1.15rem;line-height:1;cursor:pointer}" +
      ".widget-promo__close:hover{color:var(--promo-text,#e8eef3)}" +
      ".widget-promo__close:focus-visible{outline:2px solid var(--promo-accent,#3d9a8b);outline-offset:2px;border-radius:2px}" +
      "@media (max-width:480px){.widget-promo{right:1rem;bottom:calc(1rem + 1.125rem + 3.5rem + 0.375rem);max-width:calc(100vw - 2rem);font-size:0.75rem}}";

    function isValidColor(value) {
      if (typeof value !== "string") {
        return false;
      }
      var trimmed = value.trim();
      if (!trimmed) {
        return false;
      }
      return /^(#[0-9a-fA-F]{3,8}|rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(?:,\s*[\d.]+\s*)?\)|hsla?\(\s*[\d.]+\s*,\s*[\d.]+%\s*,\s*[\d.]+%\s*(?:,\s*[\d.]+\s*)?\))$/.test(
        trimmed
      );
    }

    function applyRemoteStyles(data) {
      if (!data || typeof data.styles !== "object" || data.styles === null) {
        return;
      }
      var styles = data.styles;
      Object.keys(STYLE_VAR_MAP).forEach(function (key) {
        var raw = styles[key];
        if (!isValidColor(raw)) {
          return;
        }
        promo.style.setProperty(STYLE_VAR_MAP[key], raw.trim());
      });
    }

    function injectStyles() {
      if (document.getElementById("limitless-convai-promo-styles")) {
        return;
      }
      var style = document.createElement("style");
      style.id = "limitless-convai-promo-styles";
      style.textContent = CSS;
      (document.head || document.documentElement).appendChild(style);
    }

    function resolveAgentIdFromWidget() {
      if (!widgetEl) {
        return null;
      }
      var fromWidget =
        widgetEl.getAttribute("agent-id") ||
        widgetEl.getAttribute("data-agent-id");
      if (fromWidget != null && fromWidget !== "") {
        return fromWidget;
      }
      return null;
    }

    function resolveAgentId() {
      var fromScript = attr("agent-id");
      if (fromScript) {
        return fromScript;
      }
      if (configEl) {
        var fromEl =
          configEl.getAttribute("agent-id") ||
          configEl.getAttribute("data-agent-id");
        if (fromEl != null && fromEl !== "") {
          return fromEl;
        }
      }
      return resolveAgentIdFromWidget();
    }

    function configUrlForAgent(agentId) {
      var loader = script || getLoaderScript();
      var base = resolveOperatorConfigBase(loader);
      return (
        base.replace(/\/$/, "") +
        "/" +
        encodeURIComponent(agentId) +
        ".json"
      );
    }

    function applyRemoteCopy(data) {
      if (data && typeof data.headline === "string" && data.headline !== "") {
        strings.headline = data.headline;
      }
      if (data && typeof data.body === "string" && data.body !== "") {
        strings.body = data.body;
      }
    }

    function loadCopyThen(next) {
      function done() {
        next();
      }

      function fetchForAgent(agentId) {
        var url = configUrlForAgent(agentId);
        fetch(url)
          .then(function (res) {
            if (!res.ok) {
              throw new Error("config fetch failed");
            }
            return res.json();
          })
          .then(function (data) {
            applyRemoteCopy(data);
            applyRemoteStyles(data);
            done();
          })
          .catch(function () {
            done();
          });
      }

      function poll(attempt) {
        var agentId = resolveAgentId();
        if (agentId) {
          fetchForAgent(agentId);
          return;
        }
        if (attempt >= agentPoll.maxAttempts) {
          done();
          return;
        }
        setTimeout(function () {
          poll(attempt + 1);
        }, agentPoll.intervalMs);
      }

      poll(0);
    }

    var promo = document.createElement("aside");
    promo.id = promoId;
    promo.className = "widget-promo is-hidden";
    promo.setAttribute("aria-label", strings.regionAriaLabel);

    var text = document.createElement("p");
    text.className = "widget-promo__text";

    var line = document.createElement("span");
    line.className = "widget-promo__line";
    line.setAttribute("aria-live", "polite");
    text.appendChild(line);

    var close = document.createElement("button");
    close.type = "button";
    close.className = "widget-promo__close";
    close.setAttribute("aria-label", strings.closeAriaLabel);
    close.textContent = strings.closeLabel;

    promo.appendChild(text);
    promo.appendChild(close);

    var cycleTimer = null;

    function stopCycle() {
      if (cycleTimer !== null) {
        clearTimeout(cycleTimer);
        cycleTimer = null;
      }
    }

    function isPromoVisible() {
      return !promo.classList.contains("is-hidden");
    }

    function schedule(fn, delay) {
      cycleTimer = setTimeout(fn, delay);
    }

    function setLine(content, variant) {
      line.textContent = content;
      line.className = "widget-promo__line";
      if (variant === "headline") {
        line.classList.add("widget-promo__line--headline");
      } else if (variant === "body") {
        line.classList.add("widget-promo__line--body");
      }
    }

    function fadeOutThen(next) {
      line.classList.add("is-faded");
      schedule(function () {
        if (!isPromoVisible()) {
          return;
        }
        setLine("", null);
        line.classList.remove("is-faded");
        schedule(next, timing.gapMs);
      }, timing.fadeMs);
    }

    function showBody() {
      if (!isPromoVisible()) {
        return;
      }
      setLine(strings.body, "body");
      schedule(function () {
        fadeOutThen(showHeadline);
      }, timing.visibleMs);
    }

    function showHeadline() {
      if (!isPromoVisible()) {
        return;
      }
      setLine(strings.headline, "headline");
      schedule(function () {
        fadeOutThen(showBody);
      }, timing.visibleMs);
    }

    function startCycle() {
      stopCycle();
      setLine("", null);
      line.classList.remove("is-faded");
      showHeadline();
    }

    function parseDismissedAt(raw) {
      var ms = Number(raw);
      if (isFinite(ms) && ms > 0) {
        return ms;
      }
      return null;
    }

    function isDismissStillActive() {
      try {
        var raw = localStorage.getItem(strings.storageKey);
        if (raw == null || raw === "") {
          return false;
        }
        var dismissedAt = parseDismissedAt(raw);
        if (dismissedAt == null) {
          localStorage.removeItem(strings.storageKey);
          return false;
        }
        if (Date.now() - dismissedAt < DISMISS_TTL_MS) {
          return true;
        }
        localStorage.removeItem(strings.storageKey);
        return false;
      } catch (e) {
        return false;
      }
    }

    function recordDismiss() {
      try {
        localStorage.setItem(strings.storageKey, String(Date.now()));
      } catch (e) {
        /* ignore quota / private mode */
      }
    }

    function mountPromo() {
      if (widgetEl && widgetEl.parentNode) {
        widgetEl.parentNode.insertBefore(promo, widgetEl);
      } else {
        document.body.appendChild(promo);
      }

      if (!isDismissStillActive()) {
        promo.classList.remove("is-hidden");
        startCycle();
      }

      close.addEventListener("click", function () {
        stopCycle();
        recordDismiss();
        promo.classList.add("is-hidden");
      });
    }

    function init() {
      injectStyles();
      loadCopyThen(mountPromo);
    }

    return { init: init };
  }

  function runWhenReady(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn);
    } else {
      fn();
    }
  }

  class LimitlessConvaiPill extends HTMLElement {
    connectedCallback() {
      if (this._limitlessMounted) {
        return;
      }

      var agentId =
        this.getAttribute("agent-id") ||
        this.getAttribute("data-agent-id");
      if (!agentId) {
        console.warn(
          "[limitless-convai-pill] Missing required agent-id attribute"
        );
        return;
      }

      this._limitlessMounted = true;
      this.setAttribute("hidden", "");

      var widget = document.createElement("elevenlabs-convai");
      widget.setAttribute("agent-id", agentId);
      document.body.appendChild(widget);

      loadElevenLabsEmbedOnce();

      var loaderScript = getLoaderScript();
      var promoId = "widget-promo";
      var storageKey =
        this.getAttribute("data-storage-key") ||
        this.getAttribute("storage-key");
      if (storageKey) {
        promoId = "widget-promo-" + storageKey;
      } else if (document.querySelectorAll("limitless-convai-pill").length > 1) {
        promoId = "widget-promo-" + agentId.replace(/[^a-zA-Z0-9_-]/g, "_");
      }

      runWhenReady(function () {
        createPromoController({
          script: loaderScript,
          configEl: this,
          widgetEl: widget,
          promoId: promoId,
        }).init();
      }.bind(this));
    }
  }

  if (!global.customElements.get("limitless-convai-pill")) {
    global.customElements.define("limitless-convai-pill", LimitlessConvaiPill);
  }
})(typeof window !== "undefined" ? window : globalThis);
