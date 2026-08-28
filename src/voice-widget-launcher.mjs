import { purpleBasilVoiceWidgetConfig, resolveElevenLabsAgentId } from './voice-widget-config.mjs';

const VENDOR_TAG = 'elevenlabs-convai';
const VENDOR_ELEMENT_ID = 'voice-widget-conversation';

const CONTROL_LABELS = {
  Message: ['Message', 'Chat', 'Text'],
  Collapse: ['Collapse', 'Minimize', 'Close'],
  Dismiss: ['Dismiss'],
};

function safeJsonParse(value) {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function storageKey(config, name) {
  return `${config.suppression.namespace}:${name}`;
}

function isControl(node, controlName) {
  if (!node || node.nodeType !== 1) return false;
  const tag = node.tagName?.toLowerCase();
  if (tag !== 'button' && node.getAttribute?.('role') !== 'button') return false;
  const label = [node.getAttribute?.('aria-label'), node.getAttribute?.('title'), node.textContent]
    .filter(Boolean)
    .join(' ')
    .trim()
    .toLowerCase();
  return (CONTROL_LABELS[controlName] || [controlName]).some((name) =>
    label.includes(name.toLowerCase()),
  );
}

function findControl(root, controlName) {
  const buttons = [...root.querySelectorAll('button,[role="button"]')];
  return buttons.find((button) => isControl(button, controlName));
}

export function createDomVendorElement(element, { readyTimeoutMs = 8000 } = {}) {
  const setCollapsedEntrySuppressed = (suppressed) => {
    if (!element) return;
    element.dataset.limitlessEntryState = suppressed ? 'suppressed' : 'open';
  };

  return {
    setCollapsedEntrySuppressed,
    clickControl(controlName) {
      if (!element) return false;
      const root = element.shadowRoot || element;
      const button = findControl(root, controlName);
      if (!button || typeof button.click !== 'function') return false;
      button.click();
      return true;
    },
    whenReady() {
      if (!element) return Promise.reject(new Error('vendor element is missing'));
      if (element.shadowRoot) return Promise.resolve(element);
      const defined = globalThis.customElements?.whenDefined
        ? globalThis.customElements.whenDefined(VENDOR_TAG)
        : Promise.resolve();
      return defined.then(
        () =>
          new Promise((resolve, reject) => {
            const deadline = Date.now() + readyTimeoutMs;
            const check = () => {
              if (element.shadowRoot) {
                resolve(element);
                return;
              }
              if (Date.now() >= deadline) {
                reject(new Error('vendor widget did not become ready'));
                return;
              }
              globalThis.setTimeout(check, 100);
            };
            check();
          }),
      );
    },
    onCollapsed(callback) {
      if (!element || typeof callback !== 'function') return () => {};
      const handler = (event) => {
        const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
        const nodes = path.length ? path : [event.target];
        const collapsed = nodes.some((node) => node !== element && isControl(node, 'Collapse'));
        if (collapsed) callback('vendor-control');
      };
      element.addEventListener('click', handler, true);
      return () => element.removeEventListener('click', handler, true);
    },
  };
}

export function createVoiceWidgetController({
  config,
  storage,
  sessionStorage,
  now = () => Date.now(),
  vendorElement,
  pageType: currentPageType = 'home',
  onChange,
} = {}) {
  if (!config) throw new TypeError('config is required');
  const durableStorage = storage || globalThis.localStorage;
  const sessionStore = sessionStorage || globalThis.sessionStorage || durableStorage;
  const state = {
    panelOpen: false,
    pendingOpen: false,
    openFailed: false,
    promptVisible: false,
    dismissed: false,
    openSource: null,
    lastAction: 'initialized',
  };

  const emit = () => {
    if (typeof onChange === 'function') onChange({ ...state });
  };

  let awaitedVendorReady = false;

  const promptDismissKey = storageKey(config, 'prompt-dismissed-until');
  const sessionKey = config.suppression.sessionStorageKey;

  function getPromptDismissedUntil() {
    const raw = durableStorage?.getItem(promptDismissKey);
    const parsed = safeJsonParse(raw);
    return Number(parsed?.until || 0);
  }

  function getSessionPromptCount() {
    const raw = sessionStore?.getItem(sessionKey);
    const parsed = safeJsonParse(raw);
    return Number(parsed?.promptCount || 0);
  }

  function setSessionPromptCount(count) {
    sessionStore?.setItem(sessionKey, JSON.stringify({ promptCount: count, updatedAt: now() }));
  }

  function shouldShowPrompt({ pageType = currentPageType, intent = true } = {}) {
    if (state.panelOpen || state.pendingOpen || pageType === 'excluded') return false;
    if (config.behavior.promptRequiresIntent && !intent) return false;
    if (getPromptDismissedUntil() > now()) return false;
    return getSessionPromptCount() < config.suppression.promptSessionCap;
  }

  function showPrompt(reason = 'timer', context) {
    if (!shouldShowPrompt(context)) return false;
    state.promptVisible = true;
    state.lastAction = `prompt:${reason}`;
    setSessionPromptCount(getSessionPromptCount() + 1);
    emit();
    return true;
  }

  function hidePrompt(reason = 'timeout') {
    if (!state.promptVisible) return false;
    state.promptVisible = false;
    state.lastAction = `prompt-hidden:${reason}`;
    emit();
    return true;
  }

  function failOpen(source) {
    vendorElement?.setCollapsedEntrySuppressed?.(true);
    state.panelOpen = false;
    state.pendingOpen = false;
    state.openFailed = true;
    state.promptVisible = false;
    state.openSource = source;
    state.lastAction = `open-failed:${source}`;
    emit();
  }

  function open(source = 'launcher') {
    if (state.panelOpen) return true;
    vendorElement?.setCollapsedEntrySuppressed?.(false);
    const clicked = vendorElement?.clickControl?.('Message') ?? false;
    if (clicked) {
      state.panelOpen = true;
      state.pendingOpen = false;
      state.openFailed = false;
      state.promptVisible = false;
      state.openSource = source;
      state.lastAction = `open:${source}`;
      emit();
      return true;
    }
    if (!awaitedVendorReady && typeof vendorElement?.whenReady === 'function') {
      awaitedVendorReady = true;
      state.pendingOpen = true;
      state.openFailed = false;
      state.promptVisible = false;
      state.openSource = source;
      state.lastAction = `open-pending:${source}`;
      emit();
      vendorElement.whenReady().then(
        () => {
          if (!state.pendingOpen) return;
          state.pendingOpen = false;
          open(source);
        },
        () => {
          if (!state.pendingOpen) return;
          failOpen(source);
        },
      );
      return false;
    }
    failOpen(source);
    return false;
  }

  function syncCollapsed(source = 'vendor') {
    vendorElement?.setCollapsedEntrySuppressed?.(true);
    state.panelOpen = false;
    state.pendingOpen = false;
    state.openFailed = false;
    state.promptVisible = false;
    state.lastAction = `collapsed:${source}`;
    emit();
    return true;
  }

  function collapse(source = 'launcher') {
    const clicked = vendorElement?.clickControl?.('Collapse') ?? false;
    vendorElement?.setCollapsedEntrySuppressed?.(true);
    state.panelOpen = false;
    state.pendingOpen = false;
    state.openFailed = false;
    state.promptVisible = false;
    state.lastAction = clicked ? `collapse:${source}` : `collapse-local:${source}`;
    emit();
    return Boolean(clicked);
  }

  function dismiss(source = 'launcher') {
    const until = now() + config.suppression.promptDismissTtlMs;
    durableStorage?.setItem(promptDismissKey, JSON.stringify({ until, source, updatedAt: now() }));
    state.promptVisible = false;
    state.dismissed = true;
    state.lastAction = `dismiss:${source}`;
    emit();
    return true;
  }

  function resetTimingState() {
    durableStorage?.removeItem(promptDismissKey);
    sessionStore?.removeItem(sessionKey);
    state.dismissed = false;
    state.promptVisible = false;
    state.lastAction = 'reset-timing';
    emit();
  }

  state.dismissed = getPromptDismissedUntil() > now();

  return {
    getState: () => ({ ...state }),
    shouldShowPrompt,
    showPrompt,
    hidePrompt,
    open,
    collapse,
    syncCollapsed,
    dismiss,
    resetTimingState,
  };
}

function ensureVendorElement(config) {
  let element = document.querySelector(VENDOR_TAG);
  if (!element) {
    element = document.createElement(VENDOR_TAG);
    document.body.append(element);
  }
  if (!element.id) element.id = VENDOR_ELEMENT_ID;
  element.setAttribute('agent-id', resolveElevenLabsAgentId(config));
  element.setAttribute('data-managed-by', 'limitless-voice-widget-launcher');
  element.dataset.limitlessEntryState = 'suppressed';
  return element;
}

function ensureVendorScript(config) {
  const src = config.vendor.elevenLabs.scriptSrc;
  const existing = [...document.scripts].find((script) => script.src === src);
  if (existing) return existing;
  const script = document.createElement('script');
  script.src = src;
  script.async = true;
  script.type = 'text/javascript';
  script.dataset.voiceWidgetVendor = 'elevenlabs-convai';
  document.body.append(script);
  return script;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderLauncher(root, config, controller, { conversationId = VENDOR_ELEMENT_ID } = {}) {
  const pageType = config.pageContext.getPageType(window.location.pathname);
  const prompt = config.pageContext.getPromptForPage(pageType, config);
  root.innerHTML = `
    <section class="voice-widget-shell" data-state="closed" aria-label="${escapeHtml(config.brandName)} voice receptionist">
      <div class="voice-widget-prompt" hidden>
        <button class="voice-widget-prompt__dismiss" type="button" aria-label="Dismiss ${escapeHtml(config.agentName)} prompt">×</button>
        <p>${escapeHtml(prompt)}</p>
      </div>
      <button class="voice-widget-launcher" type="button" aria-expanded="false" aria-controls="${escapeHtml(conversationId)}">
        <span class="voice-widget-launcher__avatar" aria-hidden="true">${escapeHtml(config.agentName.slice(0, 1))}</span>
        <span class="voice-widget-launcher__copy">
          <strong>${escapeHtml(config.copy.launcherLabel)}</strong>
          <small>${escapeHtml(config.agentName)} · ${escapeHtml(config.roleLabel)}</small>
        </span>
      </button>
      <p class="voice-widget-status" id="voice-widget-status" role="status" aria-live="polite"></p>
    </section>
  `;

  const shell = root.querySelector('.voice-widget-shell');
  const launcher = root.querySelector('.voice-widget-launcher');
  const statusEl = root.querySelector('.voice-widget-status');
  const promptEl = root.querySelector('.voice-widget-prompt');
  const dismissButton = root.querySelector('.voice-widget-prompt__dismiss');

  function statusMessage(state) {
    if (state.panelOpen) return '';
    if (state.pendingOpen) return config.copy.connecting;
    if (state.openFailed) return config.copy.unavailable;
    return config.copy.voiceDisclosure;
  }

  function applyState(state) {
    // Once opened, the vendor widget owns the conversation surface. Keep the
    // first-party shell from covering the ElevenLabs panel.
    shell.dataset.state = state.panelOpen
      ? 'open'
      : state.pendingOpen
        ? 'pending'
        : state.promptVisible
          ? 'prompt'
          : 'closed';
    launcher.setAttribute('aria-expanded', String(state.panelOpen));
    launcher.disabled = state.pendingOpen;
    launcher.setAttribute('aria-busy', String(state.pendingOpen));
    statusEl.textContent = statusMessage(state);
    promptEl.hidden = !state.promptVisible || state.panelOpen;
  }

  function runAndApply(action) {
    action();
    applyState(controller.getState());
  }

  launcher.addEventListener('click', () => runAndApply(() => controller.open('launcher')));
  dismissButton.addEventListener('click', () => runAndApply(() => controller.dismiss('prompt')));
  applyState(controller.getState());
  return applyState;
}

export function mountVoiceWidgetLauncher({
  config = purpleBasilVoiceWidgetConfig,
  root = document.getElementById('voice-widget-launcher-root'),
} = {}) {
  if (!root) throw new Error('voice-widget-launcher-root not found');
  const vendorElement = ensureVendorElement(config);
  const vendor = createDomVendorElement(vendorElement);
  ensureVendorScript(config);
  const pageType = config.pageContext.getPageType(window.location.pathname);
  let applyState = () => {};
  const controller = createVoiceWidgetController({
    config,
    storage: window.localStorage,
    sessionStorage: window.sessionStorage,
    vendorElement: vendor,
    pageType,
    onChange: (state) => applyState(state),
  });
  applyState = renderLauncher(root, config, controller, { conversationId: vendorElement.id });
  vendor.onCollapsed(() => controller.syncCollapsed('vendor'));
  const api = {
    open: controller.open,
    collapse: controller.collapse,
    dismiss: controller.dismiss,
    showPrompt: controller.showPrompt,
    hidePrompt: controller.hidePrompt,
    shouldShowPrompt: controller.shouldShowPrompt,
    resetTimingState: controller.resetTimingState,
    getState: controller.getState,
    config,
  };

  const update = () => applyState(controller.getState());
  for (const method of ['open', 'collapse', 'dismiss', 'showPrompt', 'hidePrompt', 'resetTimingState']) {
    const current = api[method];
    api[method] = (...args) => {
      const result = current(...args);
      update();
      return result;
    };
  }

  const dwellMs = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)
    ? config.behavior.mobilePromptDwellMs
    : config.behavior.promptDwellMs;
  window.setTimeout(() => {
    if (api.showPrompt('dwell', { pageType, intent: true })) {
      window.setTimeout(() => {
        api.hidePrompt('prompt-timeout');
      }, config.behavior.promptVisibleMs);
    }
  }, dwellMs);

  window.voiceWidget = api;
  return api;
}
