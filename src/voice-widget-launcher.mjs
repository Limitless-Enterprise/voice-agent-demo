import { purpleBasilVoiceWidgetConfig, resolveElevenLabsAgentId } from './voice-widget-config.mjs';
import { createVoiceWidgetAnalytics, mapVendorToolCallToWidgetEvent } from './voice-widget-analytics.mjs';

const VENDOR_TAG = 'elevenlabs-convai';
const VENDOR_ELEMENT_ID = 'voice-widget-conversation';

const CONTROL_LABELS = {
  Message: ['Message', 'Chat', 'Text'],
  Collapse: ['Minimize', 'Close', 'Dismiss'],
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
  return (CONTROL_LABELS[controlName] || [controlName]).some((name) => {
    const normalized = name.toLowerCase();
    return label === normalized || label.startsWith(`${normalized} `);
  });
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
      const defined = globalThis.customElements?.whenDefined
        ? globalThis.customElements.whenDefined(VENDOR_TAG)
        : Promise.resolve();
      return defined.then(
        () =>
          new Promise((resolve, reject) => {
            const deadline = Date.now() + readyTimeoutMs;
            const check = () => {
              const root = element.shadowRoot || element;
              if (findControl(root, 'Message')) {
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
  analytics,
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
    firstUserTurnTracked: false,
    firstAgentResponseTracked: false,
    lastAction: 'initialized',
  };

  const emitAnalytics = (eventName, properties = {}, options = {}) =>
    analytics?.emit?.(
      eventName,
      {
        route_category: currentPageType,
        ...properties,
      },
      options,
    );

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
    emitAnalytics(
      'voice_widget_impression',
      { source: 'teaser', route_category: context?.pageType || currentPageType },
      { dedupeKey: `teaser:${context?.pageType || currentPageType}` },
    );
    emit();
    return true;
  }

  function hidePrompt(reason = 'timeout') {
    if (!state.promptVisible) return false;
    state.promptVisible = false;
    state.lastAction = `prompt-hidden:${reason}`;
    if (reason === 'prompt-timeout') {
      emitAnalytics('voice_widget_teaser_timeout', { source: 'teaser' });
    }
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
    emitAnalytics('voice_widget_error', {
      source,
      stage: 'open',
      code: 'vendor_not_ready',
      recoverable: true,
    });
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
      emitAnalytics('voice_widget_open', { source });
      emitAnalytics('voice_widget_mode_start', { source, mode: 'text' });
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
    const wasOpen = state.panelOpen;
    state.panelOpen = false;
    state.pendingOpen = false;
    state.openFailed = false;
    state.promptVisible = false;
    state.lastAction = `collapsed:${source}`;
    if (wasOpen) emitAnalytics('voice_widget_minimize', { source });
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
    emitAnalytics('voice_widget_minimize', { source });
    emit();
    return Boolean(clicked);
  }

  function dismiss(source = 'launcher') {
    const until = now() + config.suppression.promptDismissTtlMs;
    durableStorage?.setItem(promptDismissKey, JSON.stringify({ until, source, updatedAt: now() }));
    state.promptVisible = false;
    state.dismissed = true;
    state.lastAction = `dismiss:${source}`;
    emitAnalytics('voice_widget_dismiss', { source });
    emit();
    return true;
  }

  function recordFirstUserTurn({ mode = state.openSource === 'voice' ? 'voice' : 'text' } = {}) {
    if (state.firstUserTurnTracked) return false;
    state.firstUserTurnTracked = true;
    emitAnalytics('voice_widget_first_user_turn', { mode }, { dedupeKey: 'first-user-turn' });
    emit();
    return true;
  }

  function recordFirstAgentResponse({ mode = state.openSource === 'voice' ? 'voice' : 'text', code = 'ok' } = {}) {
    if (state.firstAgentResponseTracked) return false;
    state.firstAgentResponseTracked = true;
    emitAnalytics('voice_widget_first_agent_response', { mode, code }, { dedupeKey: 'first-agent-response' });
    emit();
    return true;
  }

  function recordContactCapture({ contactType = 'unknown' } = {}) {
    emitAnalytics('voice_widget_contact_capture', { contact_type: contactType });
    return true;
  }

  function recordHandoff({ state: handoffState = 'selected', destinationType = 'staff' } = {}) {
    emitAnalytics('voice_widget_handoff', {
      handoff_state: handoffState,
      handoff_destination_type: destinationType,
    });
    return true;
  }

  function recordBookingClick({ destination = 'booking_system', placement = 'assistant' } = {}) {
    emitAnalytics('voice_widget_booking_click', {
      booking_destination: destination,
      booking_placement: placement,
    });
    return true;
  }

  function recordError({ stage = 'vendor', code = 'unknown', recoverable = true } = {}) {
    emitAnalytics('voice_widget_error', { stage, code, recoverable });
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
    recordFirstUserTurn,
    recordFirstAgentResponse,
    recordContactCapture,
    recordHandoff,
    recordBookingClick,
    recordError,
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

  launcher.addEventListener('click', () => controller.open('launcher'));
  dismissButton.addEventListener('click', () => controller.dismiss('prompt'));
  applyState(controller.getState());
  return applyState;
}

function bindVendorInstrumentation(element, controller) {
  if (!element || !controller) return () => {};
  const disposers = [];
  const onToolCall = (event) => {
    const mapped = mapVendorToolCallToWidgetEvent(event.detail || {});
    if (!mapped) return;
    const [eventName, properties] = mapped;
    if (eventName === 'voice_widget_booking_click') controller.recordBookingClick(properties);
    if (eventName === 'voice_widget_handoff') controller.recordHandoff(properties);
  };
  const onUserTurn = (event) => controller.recordFirstUserTurn({ mode: event.detail?.mode });
  const onAgentResponse = (event) => controller.recordFirstAgentResponse({ mode: event.detail?.mode, code: 'ok' });
  const onError = (event) =>
    controller.recordError({ stage: 'vendor', code: event.detail?.code || 'vendor_error', recoverable: true });

  element.addEventListener('elevenlabs-convai:call', onToolCall);
  element.addEventListener('voice-widget:first-user-turn', onUserTurn);
  element.addEventListener('voice-widget:first-agent-response', onAgentResponse);
  element.addEventListener('voice-widget:error', onError);
  disposers.push(() => element.removeEventListener('elevenlabs-convai:call', onToolCall));
  disposers.push(() => element.removeEventListener('voice-widget:first-user-turn', onUserTurn));
  disposers.push(() => element.removeEventListener('voice-widget:first-agent-response', onAgentResponse));
  disposers.push(() => element.removeEventListener('voice-widget:error', onError));
  return () => disposers.forEach((dispose) => dispose());
}

export function mountVoiceWidgetLauncher({
  config = purpleBasilVoiceWidgetConfig,
  root = document.getElementById('voice-widget-launcher-root'),
  analytics,
} = {}) {
  if (!root) throw new Error('voice-widget-launcher-root not found');
  const vendorElement = ensureVendorElement(config);
  const vendor = createDomVendorElement(vendorElement);
  ensureVendorScript(config);
  const pageType = config.pageContext.getPageType(window.location.pathname);
  const analyticsClient =
    analytics ||
    createVoiceWidgetAnalytics({
      config,
      storage: window.localStorage,
      sessionStorage: window.sessionStorage,
      viewportWidth: window.innerWidth,
      userAgent: navigator.userAgent,
    });
  analyticsClient.emit('voice_widget_eligible', { route_category: pageType, suppression_reason: 'eligible' }, { dedupeKey: `eligible:${pageType}` });
  let applyState = () => {};
  const controller = createVoiceWidgetController({
    config,
    storage: window.localStorage,
    sessionStorage: window.sessionStorage,
    vendorElement: vendor,
    pageType,
    analytics: analyticsClient,
    onChange: (state) => applyState(state),
  });
  applyState = renderLauncher(root, config, controller, { conversationId: vendorElement.id });
  analyticsClient.emit('voice_widget_impression', { route_category: pageType, source: 'launcher' }, { dedupeKey: `launcher:${pageType}` });
  vendor.onCollapsed(() => controller.syncCollapsed('vendor'));
  bindVendorInstrumentation(vendorElement, controller);
  vendor.whenReady().then(
    () => analyticsClient.emit('voice_widget_ready', { route_category: pageType, stage: 'vendor_ready', code: 'ok' }, { dedupeKey: `ready:${pageType}` }),
    () => controller.recordError({ stage: 'ready', code: 'vendor_not_ready', recoverable: true }),
  );
  const api = {
    open: controller.open,
    collapse: controller.collapse,
    dismiss: controller.dismiss,
    showPrompt: controller.showPrompt,
    hidePrompt: controller.hidePrompt,
    shouldShowPrompt: controller.shouldShowPrompt,
    recordFirstUserTurn: controller.recordFirstUserTurn,
    recordFirstAgentResponse: controller.recordFirstAgentResponse,
    recordContactCapture: controller.recordContactCapture,
    recordHandoff: controller.recordHandoff,
    recordBookingClick: controller.recordBookingClick,
    recordError: controller.recordError,
    resetTimingState: controller.resetTimingState,
    getState: controller.getState,
    analytics: analyticsClient,
    config,
  };

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
