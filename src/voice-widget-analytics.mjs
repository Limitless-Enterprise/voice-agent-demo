const DAY_MS = 24 * 60 * 60 * 1000;

export const VOICE_WIDGET_EVENTS = Object.freeze([
  'voice_widget_eligible',
  'voice_widget_ready',
  'voice_widget_launcher_impression',
  'voice_widget_prompt_impression',
  'voice_widget_prompt_close',
  'voice_widget_open',
  'voice_widget_start_call',
  'voice_widget_start_message',
  'voice_widget_first_user_message',
  'voice_widget_first_voice_turn',
  'voice_widget_first_agent_response',
  'voice_widget_handoff_or_lead',
  'voice_widget_book_now_click',
  'voice_widget_minimize',
  'voice_widget_dismiss',
  'voice_widget_error',
]);

const EVENT_SET = new Set(VOICE_WIDGET_EVENTS);
const CONTROLLED_STRING_KEYS = new Set([
  'event',
  'site_id',
  'environment',
  'locale',
  'timezone',
  'route_category',
  'device_class',
  'session_id',
  'session_storage',
  'config_version',
  'copy_version',
  'analytics_version',
  'vendor',
  'vendor_source',
  'vendor_agent_id',
  'vendor_package',
  'conversation_join_key',
  'experiment_id',
  'assignment_id',
  'arm',
  'launcher_label_variant',
  'copy_variant',
  'timing_variant',
  'modality_variant',
  'quick_reply_variant',
  'source',
  'trigger_type',
  'mode',
  'stage',
  'code',
  'contact_type',
  'handoff_state',
  'handoff_destination_type',
  'booking_destination',
  'booking_placement',
  'suppression_reason',
]);
const BLOCKED_KEY_PATTERN = /(?:message|transcript|audio|email|phone|name|contact_value|treatment_goal|free_text|prompt_text|content|recording|summary|user_text)/i;
const BLOCKED_VALUE_PATTERN = /(?:@|\+?\d[\d\s().-]{7,}|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b)/i;

function safeJsonParse(value, fallback = null) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function randomId(prefix = 'vw') {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `${prefix}_${uuid}`;
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function getStoredJson(storage, key, fallback = null) {
  return safeJsonParse(storage?.getItem?.(key), fallback);
}

function setStoredJson(storage, key, value) {
  storage?.setItem?.(key, JSON.stringify(value));
}

function getOrCreateSession(storage, key, now) {
  const existing = getStoredJson(storage, key);
  if (existing?.session_id) return existing;
  const next = {
    session_id: randomId('vw_session'),
    created_at: now(),
    session_storage: 'session',
  };
  setStoredJson(storage, key, next);
  return next;
}

function pickArm(dimension, random = Math.random) {
  const arms = Array.isArray(dimension?.arms) && dimension.arms.length ? dimension.arms : ['control'];
  const bucket = Math.min(arms.length - 1, Math.floor(random() * arms.length));
  return String(arms[bucket]);
}

export function assignVoiceWidgetExperiments({ config, storage, now = () => Date.now(), random = Math.random } = {}) {
  if (!config) throw new TypeError('config is required');
  const experimentId = config.analytics.experimentId;
  const dimensions = config.analytics.experiments?.dimensions || {};
  const key = `${config.suppression.namespace}:experiment-assignment:${experimentId || 'none'}`;
  const existing = storage ? getStoredJson(storage, key) : null;
  if (existing?.experiment_id === experimentId && existing?.assignment_id) return Object.freeze(existing);

  const assignment = {
    experiment_id: experimentId,
    assignment_id: randomId('vw_assign'),
    arm: String(config.analytics.variant || 'control'),
    launcher_label_variant: pickArm(dimensions.launcherLabel, random),
    copy_variant: pickArm(dimensions.copy, random),
    timing_variant: pickArm(dimensions.timing, random),
    modality_variant: pickArm(dimensions.modality, random),
    quick_reply_variant: pickArm(dimensions.quickReplies, random),
    assigned_at: now(),
  };
  if (storage) setStoredJson(storage, key, assignment);
  return Object.freeze(assignment);
}

function sanitizeValue(key, value) {
  if (value === undefined || value === null) return undefined;
  if (BLOCKED_KEY_PATTERN.test(key)) return undefined;
  if (typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') {
    if (!CONTROLLED_STRING_KEYS.has(key)) return undefined;
    const trimmed = value.slice(0, 120);
    if (BLOCKED_VALUE_PATTERN.test(trimmed)) return undefined;
    return trimmed;
  }
  return undefined;
}

function sanitizeProperties(properties = {}) {
  const safe = {};
  for (const [key, value] of Object.entries(properties || {})) {
    const sanitized = sanitizeValue(key, value);
    if (sanitized !== undefined) safe[key] = sanitized;
  }
  return safe;
}

function getDeviceClass(userAgent = globalThis.navigator?.userAgent || '', width = globalThis.innerWidth) {
  if (/Mobi|Android|iPhone|iPad/i.test(userAgent) || Number(width || 0) <= 560) return 'mobile';
  return 'desktop';
}

export function createVoiceWidgetAnalytics({
  config,
  storage,
  sessionStorage,
  now = () => Date.now(),
  random = Math.random,
  sink,
  dataLayerName = 'dataLayer',
  userAgent,
  viewportWidth,
} = {}) {
  if (!config) throw new TypeError('config is required');
  const sessionStore = sessionStorage || storage;
  const session = getOrCreateSession(sessionStore, `${config.suppression.namespace}:analytics-session`, now);
  const assignment = assignVoiceWidgetExperiments({ config, storage, now, random });
  const emittedKey = `${config.suppression.namespace}:emitted-events`;
  const emitted = new Set(getStoredJson(sessionStore, emittedKey, []));
  const deliver =
    typeof sink === 'function'
      ? sink
      : (payload) => {
          const target = (globalThis[dataLayerName] ||= []);
          if (Array.isArray(target)) target.push(payload);
        };

  function persistEmitted() {
    setStoredJson(sessionStore, emittedKey, [...emitted].slice(-100));
  }

  function emit(eventName, properties = {}, { dedupeKey } = {}) {
    if (!EVENT_SET.has(eventName)) throw new TypeError(`Unsupported voice widget event: ${eventName}`);
    const dedupe = dedupeKey ? `${eventName}:${dedupeKey}` : null;
    if (dedupe && emitted.has(dedupe)) return null;

    const payload = {
      event: eventName,
      site_id: config.siteId,
      environment: config.environment,
      locale: config.locale,
      timezone: config.timezone,
      route_category: properties.route_category,
      device_class: properties.device_class || getDeviceClass(userAgent, viewportWidth),
      trigger_type: properties.trigger_type || properties.source,
      session_id: session.session_id,
      session_storage: session.session_storage,
      config_version: config.version,
      copy_version: config.copy.version,
      analytics_version: config.analytics.version,
      vendor: 'elevenlabs',
      vendor_source: 'widget',
      vendor_agent_id: config.vendor.elevenLabs.agentIds[config.environment] || config.vendor.elevenLabs.agentIds.production,
      vendor_package: config.vendor.elevenLabs.packageVersion,
      experiment_id: assignment.experiment_id,
      assignment_id: assignment.assignment_id,
      arm: assignment.arm,
      launcher_label_variant: assignment.launcher_label_variant,
      copy_variant: assignment.copy_variant,
      timing_variant: assignment.timing_variant,
      modality_variant: assignment.modality_variant,
      quick_reply_variant: assignment.quick_reply_variant,
      occurred_at: now(),
      ...sanitizeProperties(properties),
    };
    if (dedupe) {
      emitted.add(dedupe);
      persistEmitted();
    }
    deliver(payload);
    return Object.freeze(payload);
  }

  return Object.freeze({ emit, assignment, session });
}

export function mapVendorToolCallToWidgetEvent(detail = {}) {
  const toolName = String(detail.toolName || detail.name || detail.clientToolName || '').toLowerCase();
  if (!toolName) return null;
  if (/book|available_slot|appointment|vagaro/.test(toolName)) {
    return ['voice_widget_book_now_click', { destination: 'booking_system', placement: 'assistant_tool' }];
  }
  if (/human|handoff|review|contact/.test(toolName)) {
    return ['voice_widget_handoff_or_lead', { state: 'selected', destinationType: 'staff' }];
  }
  return null;
}

export { DAY_MS };
