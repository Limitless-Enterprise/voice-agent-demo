import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createVoiceWidgetConfig,
  purpleBasilVoiceWidgetConfig,
} from '../src/voice-widget-config.mjs';

test('Purple Basil config encodes Mia launcher copy, capabilities, environment vendor ids, and safe defaults', () => {
  assert.equal(purpleBasilVoiceWidgetConfig.siteId, 'purple-basil-medspa');
  assert.equal(purpleBasilVoiceWidgetConfig.agentName, 'Mia');
  assert.equal(purpleBasilVoiceWidgetConfig.brandName, 'Purple Basil Medspa');
  assert.equal(purpleBasilVoiceWidgetConfig.roleLabel, 'AI receptionist');
  assert.equal(purpleBasilVoiceWidgetConfig.copy.launcherLabel, 'Ask Mia');
  assert.equal(
    purpleBasilVoiceWidgetConfig.copy.prompt,
    'Need help choosing a treatment? Ask Mia, our AI receptionist.',
  );
  assert.deepEqual(purpleBasilVoiceWidgetConfig.capabilities, [
    'services',
    'pricing',
    'memberships',
    'booking',
    'skin concerns',
  ]);
  assert.equal(
    purpleBasilVoiceWidgetConfig.vendor.elevenLabs.agentIds.production,
    'agent_9201kvqe56a2ebwafvj92w81xy68',
  );
  assert.equal(purpleBasilVoiceWidgetConfig.behavior.autoOpenConversation, false);
  assert.equal(purpleBasilVoiceWidgetConfig.behavior.voiceRequiresExplicitGesture, true);
  assert.equal(purpleBasilVoiceWidgetConfig.behavior.textFirst, true);
  assert.equal(purpleBasilVoiceWidgetConfig.behavior.noAutoplay, true);
  assert.ok(purpleBasilVoiceWidgetConfig.suppression.promptDismissTtlMs > 0);
});

test('createVoiceWidgetConfig produces a reusable, copy-adaptable config without mutating defaults', () => {
  const otherSiteConfig = createVoiceWidgetConfig({
    siteId: 'example-spa',
    agentName: 'Ava',
    brandName: 'Example Spa',
    roleLabel: 'AI concierge',
    launcherLabel: 'Ask Ava',
    prompt: 'Questions before booking? Ask Ava.',
    capabilities: ['services'],
    vendor: {
      elevenLabs: {
        scriptSrc: 'https://cdn.example.test/widget.js',
        agentIds: { production: 'agent_prod', preview: 'agent_preview', development: 'agent_dev' },
      },
    },
  });

  assert.equal(otherSiteConfig.siteId, 'example-spa');
  assert.equal(otherSiteConfig.copy.launcherLabel, 'Ask Ava');
  assert.deepEqual(otherSiteConfig.capabilities, ['services']);
  assert.equal(otherSiteConfig.behavior.autoOpenConversation, false);
  assert.equal(purpleBasilVoiceWidgetConfig.agentName, 'Mia');
});

test('page context hook classifies common page types without exposing private content', () => {
  assert.equal(purpleBasilVoiceWidgetConfig.pageContext.getPageType('/services/hydrafacial'), 'services');
  assert.equal(purpleBasilVoiceWidgetConfig.pageContext.getPageType('/membership'), 'memberships');
  assert.equal(purpleBasilVoiceWidgetConfig.pageContext.getPageType('/book-now'), 'booking');
  assert.equal(purpleBasilVoiceWidgetConfig.pageContext.getPageType('/privacy-policy'), 'excluded');
});

test('caller-supplied suppression storage keys are honoured instead of silently replaced', () => {
  const config = createVoiceWidgetConfig({
    siteId: 'example-spa',
    agentName: 'Ava',
    brandName: 'Example Spa',
    roleLabel: 'AI concierge',
    launcherLabel: 'Ask Ava',
    prompt: 'Questions before booking? Ask Ava.',
    capabilities: ['services'],
    suppression: {
      namespace: 'tenant-a:voice',
      sessionStorageKey: 'tenant-a:voice:session',
      promptSessionCap: 3,
    },
    vendor: { elevenLabs: { agentIds: { production: 'agent_prod' } } },
  });

  assert.equal(config.suppression.namespace, 'tenant-a:voice');
  assert.equal(config.suppression.sessionStorageKey, 'tenant-a:voice:session');
  assert.equal(config.suppression.promptSessionCap, 3);

  const derived = createVoiceWidgetConfig({
    siteId: 'example-spa',
    agentName: 'Ava',
    brandName: 'Example Spa',
    roleLabel: 'AI concierge',
    launcherLabel: 'Ask Ava',
    prompt: 'Questions before booking? Ask Ava.',
    capabilities: ['services'],
    vendor: { elevenLabs: { agentIds: { production: 'agent_prod' } } },
  });

  assert.equal(derived.suppression.namespace, 'voice-widget:example-spa');
  assert.equal(derived.suppression.sessionStorageKey, 'voice-widget:session:example-spa');
});
