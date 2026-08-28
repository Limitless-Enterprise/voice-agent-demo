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
    ...(options.copy || {}),
  };

  return Object.freeze({
    siteId: options.siteId,
    environment: options.environment || 'production',
    locale: options.locale || 'en-US',
    timezone: options.timezone || 'America/Chicago',
    agentName: options.agentName,
    brandName: options.brandName,
    roleLabel: options.roleLabel,
    capabilities: Object.freeze([...options.capabilities]),
    copy: Object.freeze({
      ...copy,
      quickReplies: Object.freeze([...copy.quickReplies]),
      contextPrompts: Object.freeze({ ...copy.contextPrompts }),
    }),
    behavior: Object.freeze({ ...defaultBehavior, ...(options.behavior || {}) }),
    suppression: Object.freeze({
      ...defaultSuppression,
      ...(options.suppression || {}),
      namespace: `${defaultSuppression.namespace}:${options.siteId}`,
      sessionStorageKey: `${defaultSuppression.sessionStorageKey}:${options.siteId}`,
    }),
    analytics: Object.freeze({
      namespace: `voice_widget.${options.siteId}`,
      experimentId: null,
      variant: 'launcher-wrapper-v1',
      ...(options.analytics || {}),
    }),
    vendor: Object.freeze({
      elevenLabs: Object.freeze({
        scriptSrc: vendor.elevenLabs.scriptSrc,
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
  },
  vendor: {
    elevenLabs: {
      scriptSrc: 'https://unpkg.com/@elevenlabs/convai-widget-embed',
      agentIds: {
        production: 'agent_9201kvqe56a2ebwafvj92w81xy68',
        preview: 'agent_9201kvqe56a2ebwafvj92w81xy68',
        development: 'agent_9201kvqe56a2ebwafvj92w81xy68',
      },
    },
  },
});
