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
  const controller = createVoiceWidgetController({
    config: purpleBasilVoiceWidgetConfig,
    storage: memoryStorage(),
    now: () => 1000,
    vendorElement: {
      clickControl(name) {
        clicks.push(name);
        return true;
      },
    },
  });

  assert.equal(controller.getState().panelOpen, false);
  assert.equal(controller.getState().dismissed, false);
  assert.deepEqual(clicks, []);
});

test('open clicks the vendor message control only after an explicit launcher action', () => {
  const clicks = [];
  const controller = createVoiceWidgetController({
    config: purpleBasilVoiceWidgetConfig,
    storage: memoryStorage(),
    now: () => 1000,
    vendorElement: {
      clickControl(name) {
        clicks.push(name);
        return name === 'Message';
      },
    },
  });

  assert.equal(controller.open('launcher'), true);
  assert.equal(controller.getState().panelOpen, true);
  assert.deepEqual(clicks, ['Message']);
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
