import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseUrl = process.env.VOICE_WIDGET_BASE_URL || 'http://127.0.0.1:3000';

test('first-party launcher opens vendor widget only after click and default auto-open is off', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await page.route('https://unpkg.com/@elevenlabs/convai-widget-embed', async (route) => {
      await route.fulfill({
        contentType: 'application/javascript',
        body: `
          customElements.define('elevenlabs-convai', class extends HTMLElement {
            connectedCallback() {
              if (this.shadowRoot) return;
              const root = this.attachShadow({ mode: 'open' });
              const message = document.createElement('button');
              message.type = 'button';
              message.setAttribute('aria-label', 'Message');
              message.textContent = 'Message';
              message.addEventListener('click', () => this.setAttribute('data-opened', 'message'));
              root.append(message);
            }
          });
        `,
      });
    });

    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelector('elevenlabs-convai')?.shadowRoot);

    const vendorCollapsedBefore = await page.locator('elevenlabs-convai').evaluate((element) => {
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
    assert.equal(vendorCollapsedBefore.entryState, 'suppressed');
    assert.equal(vendorCollapsedBefore.visibility, 'hidden');
    assert.equal(vendorCollapsedBefore.opacity, '0');
    assert.equal(vendorCollapsedBefore.pointerEvents, 'none');

    const hitTargetBefore = await page.evaluate(({ x, y }) => {
      const target = document.elementFromPoint(x, y);
      return target?.tagName.toLowerCase() || null;
    }, vendorCollapsedBefore);
    assert.notEqual(hitTargetBefore, 'elevenlabs-convai');

    const vendorStateBefore = await page.locator('elevenlabs-convai').getAttribute('data-opened');
    assert.equal(vendorStateBefore, null);
    assert.equal(await page.getByRole('button', { name: 'Ask Mia' }).getAttribute('aria-expanded'), 'false');
    assert.equal(await page.evaluate(() => window.voiceWidget.getState().panelOpen), false);

    await page.getByRole('button', { name: 'Ask Mia' }).click();
    await page.waitForFunction(() => window.voiceWidget.getState().panelOpen === true);
    assert.equal(await page.getByRole('button', { name: 'Ask Mia' }).getAttribute('aria-expanded'), 'true');
    assert.equal(await page.locator('elevenlabs-convai').getAttribute('data-opened'), 'message');
    assert.equal(await page.locator('elevenlabs-convai').getAttribute('data-limitless-entry-state'), 'open');
  } finally {
    await browser.close();
  }
});
