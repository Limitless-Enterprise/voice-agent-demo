import test from 'node:test';
import assert from 'node:assert/strict';

import { createVoiceWidgetController } from '../src/voice-widget-launcher.mjs';
import { purpleBasilVoiceWidgetConfig } from '../src/voice-widget-config.mjs';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

test('controller starts closed and does not auto-open the vendor conversation', () => {
  const clicks = [];
  const suppressionStates = [];
  const controller = createVoiceWidgetController({
    config: purpleBasilVoiceWidgetConfig,
    storage: memoryStorage(),
    now: () => 1000,
    vendorElement: {
      setCollapsedEntrySuppressed(suppressed) {
        suppressionStates.push(suppressed);
      },
      clickControl(name) {
        clicks.push(name);
        return true;
      },
    },
  });

  assert.equal(controller.getState().panelOpen, false);
  assert.equal(controller.getState().dismissed, false);
  assert.deepEqual(clicks, []);
  assert.deepEqual(suppressionStates, []);
});

test('open reveals and clicks the vendor message control only after an explicit launcher action', () => {
  const clicks = [];
  const suppressionStates = [];
  const controller = createVoiceWidgetController({
    config: purpleBasilVoiceWidgetConfig,
    storage: memoryStorage(),
    now: () => 1000,
    vendorElement: {
      setCollapsedEntrySuppressed(suppressed) {
        suppressionStates.push(suppressed);
      },
      clickControl(name) {
        clicks.push(name);
        return name === 'Message';
      },
    },
  });

  assert.equal(controller.open('launcher'), true);
  assert.equal(controller.getState().panelOpen, true);
  assert.deepEqual(clicks, ['Message']);
  assert.deepEqual(suppressionStates, [false]);
});

test('failed explicit open re-suppresses the vendor collapsed entry point', () => {
  const suppressionStates = [];
  const controller = createVoiceWidgetController({
    config: purpleBasilVoiceWidgetConfig,
    storage: memoryStorage(),
    now: () => 1000,
    vendorElement: {
      setCollapsedEntrySuppressed(suppressed) {
        suppressionStates.push(suppressed);
      },
      clickControl() {
        return false;
      },
    },
  });

  assert.equal(controller.open('launcher'), false);
  assert.equal(controller.getState().panelOpen, false);
  assert.deepEqual(suppressionStates, [false, true]);
});

test('dismiss persists prompt suppression with a safe expiry but keeps manual launcher access available', () => {
  const storage = memoryStorage();
  const start = 10_000;
  const controller = createVoiceWidgetController({
    config: purpleBasilVoiceWidgetConfig,
    storage,
    now: () => start,
    vendorElement: { clickControl: () => true },
  });

  controller.dismiss('prompt');
  assert.equal(controller.getState().dismissed, true);
  assert.equal(controller.shouldShowPrompt(), false);

  const followUp = createVoiceWidgetController({
    config: purpleBasilVoiceWidgetConfig,
    storage,
    now: () => start + purpleBasilVoiceWidgetConfig.suppression.promptDismissTtlMs - 1,
    vendorElement: { clickControl: () => true },
  });
  assert.equal(followUp.shouldShowPrompt(), false);
  assert.equal(followUp.open('manual-after-dismiss'), true);

  const afterExpiry = createVoiceWidgetController({
    config: purpleBasilVoiceWidgetConfig,
    storage,
    now: () => start + purpleBasilVoiceWidgetConfig.suppression.promptDismissTtlMs + 1,
    vendorElement: { clickControl: () => true },
  });
  assert.equal(afterExpiry.shouldShowPrompt(), true);
});

test('vendor-initiated close re-suppresses the vendor collapsed entry so Ask Mia stays the only entry point', () => {
  const suppressionStates = [];
  const controller = createVoiceWidgetController({
    config: purpleBasilVoiceWidgetConfig,
    storage: memoryStorage(),
    now: () => 1000,
    vendorElement: {
      setCollapsedEntrySuppressed(suppressed) {
        suppressionStates.push(suppressed);
      },
      clickControl: () => true,
    },
  });

  controller.open('launcher');
  assert.equal(controller.getState().panelOpen, true);
  assert.deepEqual(suppressionStates, [false]);

  controller.syncCollapsed('vendor');
  assert.equal(controller.getState().panelOpen, false);
  assert.deepEqual(suppressionStates, [false, true]);
});

test('open is a no-op while the conversation is already open', () => {
  const clicks = [];
  const controller = createVoiceWidgetController({
    config: purpleBasilVoiceWidgetConfig,
    storage: memoryStorage(),
    now: () => 1000,
    vendorElement: {
      setCollapsedEntrySuppressed() {},
      clickControl(name) {
        clicks.push(name);
        return true;
      },
    },
  });

  assert.equal(controller.open('launcher'), true);
  assert.equal(controller.open('launcher'), true);
  assert.deepEqual(clicks, ['Message']);
  assert.equal(controller.getState().panelOpen, true);
});

test('an open that lands before the vendor upgrades stays pending and retries once the widget is ready', async () => {
  let vendorReady = false;
  let markReady;
  const readyPromise = new Promise((resolve) => {
    markReady = resolve;
  });
  const controller = createVoiceWidgetController({
    config: purpleBasilVoiceWidgetConfig,
    storage: memoryStorage(),
    now: () => 1000,
    vendorElement: {
      setCollapsedEntrySuppressed() {},
      clickControl: (name) => vendorReady && name === 'Message',
      whenReady: () => readyPromise,
    },
  });

  assert.equal(controller.open('launcher'), false);
  assert.equal(controller.getState().pendingOpen, true);
  assert.equal(controller.getState().openFailed, false);
  assert.equal(controller.getState().panelOpen, false);

  vendorReady = true;
  markReady();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(controller.getState().pendingOpen, false);
  assert.equal(controller.getState().panelOpen, true);
});

test('an open that never becomes ready reports failure and keeps the vendor entry suppressed', async () => {
  const suppressionStates = [];
  const controller = createVoiceWidgetController({
    config: purpleBasilVoiceWidgetConfig,
    storage: memoryStorage(),
    now: () => 1000,
    vendorElement: {
      setCollapsedEntrySuppressed(suppressed) {
        suppressionStates.push(suppressed);
      },
      clickControl: () => false,
      whenReady: () => Promise.reject(new Error('never ready')),
    },
  });

  assert.equal(controller.open('launcher'), false);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(controller.getState().pendingOpen, false);
  assert.equal(controller.getState().openFailed, true);
  assert.deepEqual(suppressionStates, [false, true]);
});

test('hiding the timed prompt is first-party only and never touches a vendor control', () => {
  const clicks = [];
  const controller = createVoiceWidgetController({
    config: purpleBasilVoiceWidgetConfig,
    storage: memoryStorage(),
    sessionStorage: memoryStorage(),
    now: () => 1000,
    vendorElement: {
      setCollapsedEntrySuppressed() {},
      clickControl(name) {
        clicks.push(name);
        return true;
      },
    },
  });

  assert.equal(controller.showPrompt('dwell'), true);
  assert.equal(controller.getState().promptVisible, true);

  assert.equal(controller.hidePrompt('prompt-timeout'), true);
  assert.equal(controller.getState().promptVisible, false);
  assert.deepEqual(clicks, []);
  assert.equal(controller.hidePrompt('prompt-timeout'), false);
});

test('showPrompt honours the caller page context and the controller page type instead of assuming home', () => {
  const controller = createVoiceWidgetController({
    config: purpleBasilVoiceWidgetConfig,
    storage: memoryStorage(),
    sessionStorage: memoryStorage(),
    now: () => 1000,
    pageType: 'excluded',
    vendorElement: { clickControl: () => true },
  });

  assert.equal(controller.shouldShowPrompt(), false);
  assert.equal(controller.showPrompt('manual'), false);
  assert.equal(controller.getState().promptVisible, false);

  const homeController = createVoiceWidgetController({
    config: purpleBasilVoiceWidgetConfig,
    storage: memoryStorage(),
    sessionStorage: memoryStorage(),
    now: () => 1000,
    pageType: 'home',
    vendorElement: { clickControl: () => true },
  });

  assert.equal(homeController.showPrompt('manual', { pageType: 'excluded' }), false);
  assert.equal(homeController.showPrompt('manual', { pageType: 'home', intent: false }), false);
  assert.equal(homeController.showPrompt('manual', { pageType: 'home', intent: true }), true);
});

test('controller emits exact LIM-426 prompt close, text start, voice start, and voice turn event names', () => {
  const events = [];
  const analytics = {
    emit(eventName, properties) {
      events.push({ eventName, properties });
    },
  };
  const controller = createVoiceWidgetController({
    config: purpleBasilVoiceWidgetConfig,
    storage: memoryStorage(),
    sessionStorage: memoryStorage(),
    now: () => 1000,
    analytics,
    vendorElement: {
      setCollapsedEntrySuppressed() {},
      clickControl: () => true,
    },
  });

  assert.equal(controller.showPrompt('dwell'), true);
  assert.equal(controller.hidePrompt('prompt-timeout'), true);
  assert.equal(controller.open('launcher'), true);
  assert.equal(controller.recordFirstUserTurn({ mode: 'voice' }), true);

  assert.deepEqual(events.map((event) => event.eventName), [
    'voice_widget_prompt_impression',
    'voice_widget_prompt_close',
    'voice_widget_open',
    'voice_widget_start_message',
    'voice_widget_first_user_message',
    'voice_widget_first_voice_turn',
  ]);
  assert.equal(events[0].properties.source, 'teaser');
  assert.equal(events[1].properties.code, 'prompt-timeout');
  assert.equal(events[3].properties.mode, 'text');
});

test('controller emits voice_widget_start_call for explicit voice starts', () => {
  const events = [];
  const controller = createVoiceWidgetController({
    config: purpleBasilVoiceWidgetConfig,
    storage: memoryStorage(),
    analytics: { emit: (eventName, properties) => events.push({ eventName, properties }) },
    vendorElement: {
      setCollapsedEntrySuppressed() {},
      clickControl: () => true,
    },
  });

  assert.equal(controller.open('voice'), true);
  assert.deepEqual(events.map((event) => event.eventName), [
    'voice_widget_open',
    'voice_widget_start_call',
  ]);
  assert.equal(events[1].properties.mode, 'voice');
});
