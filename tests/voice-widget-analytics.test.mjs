import test from 'node:test';
import assert from 'node:assert/strict';

import {
  VOICE_WIDGET_EVENTS,
  assignVoiceWidgetExperiments,
  createVoiceWidgetAnalytics,
  mapVendorToolCallToWidgetEvent,
} from '../src/voice-widget-analytics.mjs';
import { createVoiceWidgetConfig, purpleBasilVoiceWidgetConfig } from '../src/voice-widget-config.mjs';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

test('analytics contract includes the required LIM-426 funnel events', () => {
  assert.deepEqual(VOICE_WIDGET_EVENTS, [
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
});

test('experiment assignment persists A/B hooks for label, copy, timing, modality, and quick replies', () => {
  const storage = memoryStorage();
  const config = createVoiceWidgetConfig({
    siteId: 'example-spa',
    agentName: 'Ava',
    brandName: 'Example Spa',
    roleLabel: 'AI concierge',
    launcherLabel: 'Ask Ava',
    prompt: 'Questions before booking? Ask Ava.',
    capabilities: ['services'],
    analytics: {
      experimentId: 'exp-1',
      variant: 'control',
      experiments: {
        dimensions: {
          launcherLabel: { arms: ['label-a', 'label-b'] },
          copy: { arms: ['copy-a', 'copy-b'] },
          timing: { arms: ['timing-a', 'timing-b'] },
          modality: { arms: ['mode-a', 'mode-b'] },
          quickReplies: { arms: ['quick-a', 'quick-b'] },
        },
      },
    },
    vendor: { elevenLabs: { agentIds: { production: 'agent_prod' } } },
  });

  const first = assignVoiceWidgetExperiments({ config, storage, random: () => 0.75, now: () => 1000 });
  const second = assignVoiceWidgetExperiments({ config, storage, random: () => 0, now: () => 2000 });

  assert.equal(first.assignment_id, second.assignment_id);
  assert.equal(first.experiment_id, 'exp-1');
  assert.equal(first.launcher_label_variant, 'label-b');
  assert.equal(first.copy_variant, 'copy-b');
  assert.equal(first.timing_variant, 'timing-b');
  assert.equal(first.modality_variant, 'mode-b');
  assert.equal(first.quick_reply_variant, 'quick-b');
});

test('analytics emits to dataLayer with only approved operational metadata and deduplicates session events', () => {
  const storage = memoryStorage();
  const sessionStorage = memoryStorage();
  const sent = [];
  const analytics = createVoiceWidgetAnalytics({
    config: purpleBasilVoiceWidgetConfig,
    storage,
    sessionStorage,
    now: () => 12345,
    random: () => 0,
    sink: (payload) => sent.push(payload),
    userAgent: 'Desktop Chrome',
    viewportWidth: 1280,
  });

  const first = analytics.emit(
    'voice_widget_open',
    {
      route_category: 'home',
      source: 'launcher',
      message: 'Hi, my email is patient@example.com and my treatment goal is private',
      email: 'patient@example.com',
      contact_value: '+1 555 123 4567',
      arbitrary_free_text: 'do not send me',
    },
    { dedupeKey: 'open' },
  );
  const duplicate = analytics.emit('voice_widget_open', { source: 'launcher' }, { dedupeKey: 'open' });

  assert.equal(duplicate, null);
  assert.equal(sent.length, 1);
  assert.equal(first.event, 'voice_widget_open');
  assert.equal(first.site_id, 'purple-basil-medspa');
  assert.equal(first.route_category, 'home');
  assert.equal(first.source, 'launcher');
  assert.equal(first.trigger_type, 'launcher');
  assert.equal(first.device_class, 'desktop');
  assert.equal(first.experiment_id, 'purple-basil-voice-widget-funnel-v1');
  assert.ok(first.session_id.startsWith('vw_session_'));
  assert.equal('message' in first, false);
  assert.equal('email' in first, false);
  assert.equal('contact_value' in first, false);
  assert.equal('arbitrary_free_text' in first, false);
});

test('vendor tool-call mapping records only safe funnel outcomes, not conversation content', () => {
  assert.deepEqual(mapVendorToolCallToWidgetEvent({ toolName: 'create_booking', email: 'patient@example.com' }), [
    'voice_widget_book_now_click',
    { destination: 'booking_system', placement: 'assistant_tool' },
  ]);
  assert.deepEqual(mapVendorToolCallToWidgetEvent({ name: 'request_human_review', transcript: 'secret' }), [
    'voice_widget_handoff_or_lead',
    { state: 'selected', destinationType: 'staff' },
  ]);
  assert.equal(mapVendorToolCallToWidgetEvent({ name: 'lookup_hours' }), null);
});
