import { purpleBasilVoiceWidgetConfig, resolveElevenLabsAgentId } from './voice-widget-config.mjs';

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

function findButtonByNames(root, names) {
  const normalized = names.map((name) => name.toLowerCase());
  const buttons = [...root.querySelectorAll('button,[role="button"]')];
  return buttons.find((button) => {
    const label = [
      button.getAttribute('aria-label'),
      button.getAttribute('title'),
      button.textContent,
    ]
      .filter(Boolean)
      .join(' ')
      .trim()
      .toLowerCase();
    return normalized.some((name) => label.includes(name.toLowerCase()));
  });
}

export function createDomVendorElement(element) {
  return {
    clickControl(controlName) {
      if (!element) return false;
      const root = element.shadowRoot || element;
      const labelsByControl = {
        Message: ['Message', 'Chat', 'Text'],
        Collapse: ['Collapse', 'Minimize', 'Close'],
        Dismiss: ['Dismiss'],
      };
      const button = findButtonByNames(root, labelsByControl[controlName] || [controlName]);
      if (!button || typeof button.click !== 'function') return false;
      button.click();
      return true;
    },
  };
}

export function createVoiceWidgetController({
  config,
  storage,
  sessionStorage,
  now = () => Date.now(),
  vendorElement,
  onChange,
} = {}) {
  if (!config) throw new TypeError('config is required');
  const durableStorage = storage || globalThis.localStorage;
  const sessionStore = sessionStorage || globalThis.sessionStorage || durableStorage;
  const state = {
    panelOpen: false,
    promptVisible: false,
    dismissed: false,
    openSource: null,
    lastAction: 'initialized',
  };

  const emit = () => {
    if (typeof onChange === 'function') onChange({ ...state });
  };

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

  function shouldShowPrompt({ pageType = 'home', intent = true } = {}) {
    if (state.panelOpen || pageType === 'excluded') return false;
    if (config.behavior.promptRequiresIntent && !intent) return false;
    if (getPromptDismissedUntil() > now()) return false;
    return getSessionPromptCount() < config.suppression.promptSessionCap;
  }

  function showPrompt(reason = 'timer') {
    if (!shouldShowPrompt()) return false;
    state.promptVisible = true;
    state.lastAction = `prompt:${reason}`;
    setSessionPromptCount(getSessionPromptCount() + 1);
    emit();
    return true;
  }

  function open(source = 'launcher') {
    const clicked = vendorElement?.clickControl?.('Message') ?? false;
    state.panelOpen = Boolean(clicked);
    state.promptVisible = false;
    state.openSource = source;
    state.lastAction = clicked ? `open:${source}` : `open-failed:${source}`;
    emit();
    return Boolean(clicked);
  }

  function collapse(source = 'launcher') {
    const clicked = vendorElement?.clickControl?.('Collapse') ?? false;
    state.panelOpen = false;
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
    open,
    collapse,
    dismiss,
    resetTimingState,
  };
}

function ensureVendorElement(config) {
  let element = document.querySelector('elevenlabs-convai');
  if (!element) {
    element = document.createElement('elevenlabs-convai');
    document.body.append(element);
  }
  element.setAttribute('agent-id', resolveElevenLabsAgentId(config));
  element.setAttribute('data-managed-by', 'limitless-voice-widget-launcher');
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

function renderLauncher(root, config, controller) {
  const pageType = config.pageContext.getPageType(window.location.pathname);
  const prompt = config.pageContext.getPromptForPage(pageType, config);
  const quickReplies = config.copy.quickReplies
    .map((reply) => `<li>${escapeHtml(reply)}</li>`)
    .join('');
  root.innerHTML = `
    <section class="voice-widget-shell" data-state="closed" aria-label="${escapeHtml(config.brandName)} voice receptionist">
      <div class="voice-widget-prompt" hidden>
        <button class="voice-widget-prompt__dismiss" type="button" aria-label="Dismiss ${escapeHtml(config.agentName)} prompt">×</button>
        <p>${escapeHtml(prompt)}</p>
      </div>
      <button class="voice-widget-launcher" type="button" aria-expanded="false" aria-controls="voice-widget-status">
        <span class="voice-widget-launcher__avatar" aria-hidden="true">${escapeHtml(config.agentName.slice(0, 1))}</span>
        <span class="voice-widget-launcher__copy">
          <strong>${escapeHtml(config.copy.launcherLabel)}</strong>
          <small>${escapeHtml(config.agentName)} · ${escapeHtml(config.roleLabel)}</small>
        </span>
      </button>
      <div class="voice-widget-card" id="voice-widget-status" hidden>
        <p class="voice-widget-card__brand">${escapeHtml(config.brandName)}</p>
        <p class="voice-widget-card__prompt">${escapeHtml(prompt)}</p>
        <ul class="voice-widget-card__chips" aria-label="${escapeHtml(config.copy.quickReplyIntro)}">
          ${quickReplies}
        </ul>
        <p class="voice-widget-card__boundary">${escapeHtml(config.copy.boundary)}</p>
        <p class="voice-widget-card__voice">${escapeHtml(config.copy.voiceDisclosure)}</p>
        <p class="voice-widget-card__open" hidden>Voice conversation is open.</p>
        <button class="voice-widget-card__collapse" type="button">Collapse launcher</button>
      </div>
    </section>
  `;

  const shell = root.querySelector('.voice-widget-shell');
  const launcher = root.querySelector('.voice-widget-launcher');
  const card = root.querySelector('.voice-widget-card');
  const openNote = root.querySelector('.voice-widget-card__open');
  const promptEl = root.querySelector('.voice-widget-prompt');
  const dismissButton = root.querySelector('.voice-widget-prompt__dismiss');
  const collapseButton = root.querySelector('.voice-widget-card__collapse');

  function applyState(state) {
    shell.dataset.state = state.panelOpen ? 'open' : state.promptVisible ? 'prompt' : 'closed';
    launcher.setAttribute('aria-expanded', String(state.panelOpen));
    // Once opened, the vendor widget owns the conversation surface. Keep the
    // first-party shell from covering the ElevenLabs panel.
    card.hidden = true;
    openNote.hidden = true;
    promptEl.hidden = !state.promptVisible || state.panelOpen;
  }

  function runAndApply(action) {
    action();
    applyState(controller.getState());
  }

  launcher.addEventListener('click', () => runAndApply(() => controller.open('launcher')));
  dismissButton.addEventListener('click', () => runAndApply(() => controller.dismiss('prompt')));
  collapseButton.addEventListener('click', () => runAndApply(() => controller.collapse('card')));
  applyState(controller.getState());
  return applyState;
}

export function mountVoiceWidgetLauncher({
  config = purpleBasilVoiceWidgetConfig,
  root = document.getElementById('voice-widget-launcher-root'),
} = {}) {
  if (!root) throw new Error('voice-widget-launcher-root not found');
  const vendorElement = ensureVendorElement(config);
  ensureVendorScript(config);
  const controller = createVoiceWidgetController({
    config,
    storage: window.localStorage,
    sessionStorage: window.sessionStorage,
    vendorElement: createDomVendorElement(vendorElement),
  });
  const applyState = renderLauncher(root, config, controller);
  const api = {
    open: controller.open,
    collapse: controller.collapse,
    dismiss: controller.dismiss,
    showPrompt: controller.showPrompt,
    shouldShowPrompt: controller.shouldShowPrompt,
    resetTimingState: controller.resetTimingState,
    getState: controller.getState,
    config,
  };

  const update = () => applyState(controller.getState());
  for (const method of ['open', 'collapse', 'dismiss', 'showPrompt', 'resetTimingState']) {
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
  const pageType = config.pageContext.getPageType(window.location.pathname);
  window.setTimeout(() => {
    if (api.shouldShowPrompt({ pageType, intent: true })) {
      api.showPrompt('dwell');
      window.setTimeout(() => {
        if (api.getState().promptVisible) api.collapse('prompt-timeout');
      }, config.behavior.promptVisibleMs);
    }
  }, dwellMs);

  window.voiceWidget = api;
  return api;
}
