import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseUrl = process.env.VOICE_WIDGET_BASE_URL || 'http://127.0.0.1:3000';

const vendorStub = `
  customElements.define('elevenlabs-convai', class extends HTMLElement {
    connectedCallback() {
      if (this.shadowRoot) return;
      const root = this.attachShadow({ mode: 'open' });
      const message = document.createElement('button');
      message.type = 'button';
      message.setAttribute('aria-label', 'Message');
      message.textContent = 'Message';
      const close = document.createElement('button');
      close.type = 'button';
      close.setAttribute('aria-label', 'Close');
      close.textContent = 'Close';
      close.hidden = true;
      message.addEventListener('click', () => {
        this.setAttribute('data-opened', 'message');
        message.hidden = true;
        close.hidden = false;
      });
      close.addEventListener('click', () => {
        this.setAttribute('data-opened', 'collapsed');
        close.hidden = true;
        message.hidden = false;
      });
      root.append(message, close);
    }
  });
`;

function readVendorEntry(page) {
  return page.locator('elevenlabs-convai').evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return {
      entryState: element.dataset.limitlessEntryState,
      visibility: style.visibility,
      opacity: style.opacity,
      pointerEvents: style.pointerEvents,
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  });
}

function elementTagAtPoint(page, point) {
  return page.evaluate(({ x, y }) => {
    const target = document.elementFromPoint(x, y);
    return target?.closest('.voice-widget-shell, elevenlabs-convai')?.tagName.toLowerCase() ?? null;
  }, point);
}

test('first-party launcher opens vendor widget only after click and default auto-open is off', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await page.route('https://unpkg.com/@elevenlabs/convai-widget-embed', async (route) => {
      await route.fulfill({ contentType: 'application/javascript', body: vendorStub });
    });

    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelector('elevenlabs-convai')?.shadowRoot);

    const vendorCollapsedBefore = await readVendorEntry(page);
    assert.equal(vendorCollapsedBefore.entryState, 'suppressed');
    assert.equal(vendorCollapsedBefore.visibility, 'hidden');
    assert.equal(vendorCollapsedBefore.opacity, '0');
    assert.equal(vendorCollapsedBefore.pointerEvents, 'none');

    assert.notEqual(await elementTagAtPoint(page, vendorCollapsedBefore), 'elevenlabs-convai');

    const vendorStateBefore = await page.locator('elevenlabs-convai').getAttribute('data-opened');
    assert.equal(vendorStateBefore, null);
    assert.equal(await page.getByRole('button', { name: 'Ask Mia' }).getAttribute('aria-expanded'), 'false');
    assert.equal(await page.evaluate(() => window.voiceWidget.getState().panelOpen), false);

    await page.getByRole('button', { name: 'Ask Mia' }).click();
    await page.waitForFunction(() => window.voiceWidget.getState().panelOpen === true);
    assert.equal(await page.locator('.voice-widget-launcher').getAttribute('aria-expanded'), 'true');
    assert.equal(await page.locator('elevenlabs-convai').getAttribute('data-opened'), 'message');
    assert.equal(await page.locator('elevenlabs-convai').getAttribute('data-limitless-entry-state'), 'open');
  } finally {
    await browser.close();
  }
});

test('the first-party launcher never overlaps the open vendor conversation surface', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await page.route('https://unpkg.com/@elevenlabs/convai-widget-embed', async (route) => {
      await route.fulfill({ contentType: 'application/javascript', body: vendorStub });
    });

    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelector('elevenlabs-convai')?.shadowRoot);

    const launcherBox = await page.locator('.voice-widget-launcher').boundingBox();
    const launcherPoint = {
      x: launcherBox.x + launcherBox.width / 2,
      y: launcherBox.y + launcherBox.height / 2,
    };
    assert.equal(await elementTagAtPoint(page, launcherPoint), 'section');

    await page.getByRole('button', { name: 'Ask Mia' }).click();
    await page.waitForFunction(() => window.voiceWidget.getState().panelOpen === true);

    assert.equal(await page.locator('.voice-widget-shell').isVisible(), false);
    assert.notEqual(await elementTagAtPoint(page, launcherPoint), 'section');
  } finally {
    await browser.close();
  }
});

test('closing the conversation from the vendor UI restores Ask Mia as the only collapsed entry', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await page.route('https://unpkg.com/@elevenlabs/convai-widget-embed', async (route) => {
      await route.fulfill({ contentType: 'application/javascript', body: vendorStub });
    });

    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelector('elevenlabs-convai')?.shadowRoot);

    await page.getByRole('button', { name: 'Ask Mia' }).click();
    await page.waitForFunction(() => window.voiceWidget.getState().panelOpen === true);
    assert.equal(await page.locator('elevenlabs-convai').getAttribute('data-limitless-entry-state'), 'open');

    await page.locator('elevenlabs-convai').evaluate((element) => {
      element.shadowRoot.querySelector('button[aria-label="Close"]').click();
    });
    await page.waitForFunction(() => window.voiceWidget.getState().panelOpen === false);

    const vendorEntryAfter = await readVendorEntry(page);
    assert.equal(vendorEntryAfter.entryState, 'suppressed');
    assert.equal(vendorEntryAfter.visibility, 'hidden');
    assert.equal(vendorEntryAfter.pointerEvents, 'none');
    assert.notEqual(await elementTagAtPoint(page, vendorEntryAfter), 'elevenlabs-convai');

    assert.equal(await page.locator('.voice-widget-launcher').isVisible(), true);
    assert.equal(await page.locator('.voice-widget-launcher').getAttribute('aria-expanded'), 'false');
  } finally {
    await browser.close();
  }
});

test('the voice disclosure is presented in the launcher surface before any conversation starts', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await page.route('https://unpkg.com/@elevenlabs/convai-widget-embed', async (route) => {
      await route.fulfill({ contentType: 'application/javascript', body: vendorStub });
    });

    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    const status = page.locator('#voice-widget-status');
    assert.equal(await status.isVisible(), true);
    assert.equal(
      (await status.textContent()).trim(),
      'Text is available first. Voice starts only after you choose it and approve microphone access.',
    );
  } finally {
    await browser.close();
  }
});
