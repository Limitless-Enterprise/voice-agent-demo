const DAY_MS = 24 * 60 * 60 * 1000;

const defaultPageContext = {
  getPageType(pathname = '/') {
    const path = String(pathname).toLowerCase();
    if (/privacy|terms|policy|legal/.test(path)) return 'excluded';
    if (/book|appointment|schedule|vagaro/.test(path)) return 'booking';
    if (/membership|member/.test(path)) return 'memberships';
    if (/service|treatment|hydrafacial|botox|filler|laser|skin/.test(path)) return 'services';
    if (/price|pricing|faq/.test(path)) return 'pricing';
    return path === '/' || path === '' ? 'home' : 'content';
  },
  getPromptForPage(pageType, config) {
    const prompts = config.copy.contextPrompts || {};
    return prompts[pageType] || config.copy.prompt;
  },
};

const defaultBehavior = {
  autoOpenConversation: false,
  textFirst: true,
  noAutoplay: true,
  voiceRequiresExplicitGesture: true,
  promptRequiresIntent: true,
  promptDwellMs: 25_000,
  mobilePromptDwellMs: 30_000,
  promptVisibleMs: 12_000,
};

const defaultSuppression = {
  namespace: 'voice-widget',
  sessionStorageKey: 'voice-widget:session',
  promptDismissTtlMs: 30 * DAY_MS,
  promptSessionCap: 1,
};

const defaultExperiments = {
  dimensions: {
    launcherLabel: { arms: ['task-led'] },
    copy: { arms: ['task-led'] },
    timing: { arms: ['dwell-plus-intent'] },
    modality: { arms: ['text-first-explicit-voice'] },
    quickReplies: { arms: ['treatment-pricing-booking'] },
  },
};

export function createVoiceWidgetConfig(options) {
  if (!options || typeof options !== 'object') {
    throw new TypeError('createVoiceWidgetConfig requires an options object');
  }

  const required = ['siteId', 'agentName', 'brandName', 'roleLabel', 'launcherLabel', 'prompt'];
  for (const key of required) {
    if (!options[key]) throw new TypeError(`Missing voice widget config field: ${key}`);
  }
  if (!Array.isArray(options.capabilities) || options.capabilities.length === 0) {
    throw new TypeError('Voice widget config requires at least one capability');
  }

  const vendor = {
    elevenLabs: {
      scriptSrc: 'https://unpkg.com/@elevenlabs/convai-widget-embed',
      packageVersion: '0.17.1',
      agentIds: {},
      ...(options.vendor?.elevenLabs || {}),
    },
  };

  if (!vendor.elevenLabs.agentIds.production) {
    throw new TypeError('Voice widget config requires a production ElevenLabs agent id');
  }

  const copy = {
    launcherLabel: options.launcherLabel,
    prompt: options.prompt,
    quickReplyIntro: 'Popular questions',
    quickReplies: [],
    contextPrompts: {},
    boundary: 'For general information only — not medical advice.',
    voiceDisclosure: 'Voice starts only after you choose it and approve microphone access.',
    connecting: 'Connecting you to the assistant…',
    unavailable: 'The assistant is still loading. Please try again in a moment.',
    ...(options.copy || {}),
  };

  return Object.freeze({
    siteId: options.siteId,
    version: options.version || 'voice-widget-config-v1',
    environment: options.environment || 'production',
    locale: options.locale || 'en-US',
    timezone: options.timezone || 'America/Chicago',
    agentName: options.agentName,
    brandName: options.brandName,
    roleLabel: options.roleLabel,
    capabilities: Object.freeze([...options.capabilities]),
    copy: Object.freeze({
      ...copy,
      version: copy.version || options.copyVersion || 'copy-v1',
      quickReplies: Object.freeze([...copy.quickReplies]),
      contextPrompts: Object.freeze({ ...copy.contextPrompts }),
    }),
    behavior: Object.freeze({ ...defaultBehavior, ...(options.behavior || {}) }),
    suppression: Object.freeze({
      ...defaultSuppression,
      ...(options.suppression || {}),
      namespace: options.suppression?.namespace ?? `${defaultSuppression.namespace}:${options.siteId}`,
      sessionStorageKey:
        options.suppression?.sessionStorageKey ??
        `${defaultSuppression.sessionStorageKey}:${options.siteId}`,
    }),
    analytics: Object.freeze({
      namespace: `voice_widget.${options.siteId}`,
      experimentId: null,
      variant: 'launcher-wrapper-v1',
      version: 'analytics-v1',
      emitToDataLayer: true,
      conversationJoinPolicy: 'pseudonymous-approved-only',
      annoyanceGuardrails: Object.freeze({
        dismissRateDenominator: 'voice_widget_impression',
        closeRateDenominator: 'voice_widget_open',
        immediateCloseWindowMs: 10_000,
      }),
      experiments: defaultExperiments,
      ...(options.analytics || {}),
      experiments: {
        ...defaultExperiments,
        ...(options.analytics?.experiments || {}),
        dimensions: {
          ...defaultExperiments.dimensions,
          ...(options.analytics?.experiments?.dimensions || {}),
        },
      },
    }),
    vendor: Object.freeze({
      elevenLabs: Object.freeze({
        scriptSrc: vendor.elevenLabs.scriptSrc,
        packageVersion: vendor.elevenLabs.packageVersion,
        agentIds: Object.freeze({ ...vendor.elevenLabs.agentIds }),
      }),
    }),
    pageContext: Object.freeze({
      ...defaultPageContext,
      ...(options.pageContext || {}),
    }),
  });
}

export function resolveElevenLabsAgentId(config, environment = config.environment) {
  return (
    config.vendor.elevenLabs.agentIds[environment] ||
    config.vendor.elevenLabs.agentIds.production
  );
}

export const purpleBasilVoiceWidgetConfig = createVoiceWidgetConfig({
  siteId: 'purple-basil-medspa',
  agentName: 'Mia',
  brandName: 'Purple Basil Medspa',
  roleLabel: 'AI receptionist',
  launcherLabel: 'Ask Mia',
  prompt: 'Need help choosing a treatment? Ask Mia, our AI receptionist.',
  capabilities: ['services', 'pricing', 'memberships', 'booking', 'skin concerns'],
  copy: {
    quickReplyIntro: 'Mia can help with',
    quickReplies: [
      'Compare treatments',
      'Check pricing',
      'Membership questions',
      'Booking help',
      'Skin concerns',
    ],
    contextPrompts: {
      home: 'Need help choosing a treatment? Ask Mia, our AI receptionist.',
      services: 'Questions about this treatment, pricing, or prep? Ask Mia.',
      pricing: 'Want help comparing options? Ask Mia or type a question.',
      memberships: 'Questions about memberships or packages? Ask Mia.',
      booking: 'Need help before booking? Ask a quick question.',
    },
    boundary: 'Mia gives general information — not medical advice. Purple Basil’s licensed team can help with personal recommendations.',
    voiceDisclosure: 'Text is available first. Voice starts only after you choose it and approve microphone access.',
    connecting: 'Connecting you to Mia…',
    unavailable: 'Mia is still loading. Please try again in a moment.',
  },
  analytics: {
    experimentId: 'purple-basil-voice-widget-funnel-v1',
    variant: 'launcher-wrapper-v1',
    experiments: {
      dimensions: {
        launcherLabel: { arms: ['ask-mia', 'task-led'] },
        copy: { arms: ['role-led', 'task-led'] },
        timing: { arms: ['launcher-only', 'dwell-plus-intent'] },
        modality: { arms: ['text-first-explicit-voice', 'equal-mode-choice'] },
        quickReplies: { arms: ['popular-questions', 'treatment-pricing-booking'] },
      },
    },
  },
  vendor: {
    elevenLabs: {
      scriptSrc: 'https://unpkg.com/@elevenlabs/convai-widget-embed',
      packageVersion: '0.17.1',
      agentIds: {
        production: 'agent_9201kvqe56a2ebwafvj92w81xy68',
        preview: 'agent_9201kvqe56a2ebwafvj92w81xy68',
        development: 'agent_9201kvqe56a2ebwafvj92w81xy68',
      },
    },
  },
});
