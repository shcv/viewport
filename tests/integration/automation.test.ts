/**
 * Integration tests for the Playwright-style automation API.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createPage, ViewportPage } from '../../src/automation/page.js';
import { createCanonicalBackend } from '../../src/protocol/index.js';
import { createHeadlessViewer } from '../../src/viewer/headless/index.js';
import { counterApp } from '../../src/test-apps/counter.js';
import { chatApp } from '../../src/test-apps/chat.js';
import { formWizardApp } from '../../src/test-apps/form-wizard.js';
import { tableViewApp } from '../../src/test-apps/table-view.js';

let page: ViewportPage;

afterEach(() => {
  page?.close();
});

describe('ViewportPage', () => {
  describe('locators', () => {
    it('should find elements by text', () => {
      page = createPage(counterApp, createCanonicalBackend(), createHeadlessViewer());

      const loc = page.getByText('Counter');
      expect(loc.count()).toBeGreaterThan(0);
      expect(loc.textContent()).toContain('Counter');
    });

    it('should find elements by ID', () => {
      page = createPage(counterApp, createCanonicalBackend(), createHeadlessViewer());

      const loc = page.getById(3); // DISPLAY
      expect(loc.isVisible()).toBe(true);
      expect(loc.textContent()).toContain('Count: 0');
    });

    it('should find elements by role', () => {
      page = createPage(counterApp, createCanonicalBackend(), createHeadlessViewer());

      const buttons = page.getByRole('button');
      expect(buttons.count()).toBeGreaterThan(0);
    });

    it('should find elements by type', () => {
      page = createPage(counterApp, createCanonicalBackend(), createHeadlessViewer());

      const textNodes = page.getByType('text');
      expect(textNodes.count()).toBeGreaterThan(0);
    });

    it('should support nth() locator', () => {
      page = createPage(counterApp, createCanonicalBackend(), createHeadlessViewer());

      const texts = page.getByType('text');
      const first = texts.first();
      expect(first.isVisible()).toBe(true);
    });
  });

  describe('actions', () => {
    it('should click elements', async () => {
      page = createPage(counterApp, createCanonicalBackend(), createHeadlessViewer());

      await page.click(7); // INC_BTN
      page.expectText('Count: 1');

      await page.click(7);
      page.expectText('Count: 2');
    });

    it('should click via locator', async () => {
      page = createPage(counterApp, createCanonicalBackend(), createHeadlessViewer());

      const incBtn = page.getById(7);
      await page.click(incBtn);
      page.expectText('Count: 1');
    });

    it('should press keys', async () => {
      page = createPage(counterApp, createCanonicalBackend(), createHeadlessViewer());

      await page.press('ArrowUp');
      await page.press('ArrowUp');
      await page.press('ArrowUp');
      page.expectText('Count: 3');
    });

    it('should type into inputs', async () => {
      page = createPage(tableViewApp, createCanonicalBackend(), createHeadlessViewer());

      await page.type(5, 'Admin'); // FILTER_INPUT
      // After typing, the table should be filtered
      const text = page.textContent();
      expect(text).toContain('Users');
    });

    it('should fill inputs', async () => {
      page = createPage(formWizardApp, createCanonicalBackend(), createHeadlessViewer());

      await page.fill(101, 'Test User'); // S1_NAME_INPUT
      await page.fill(104, 'test@example.com'); // S1_EMAIL_INPUT
    });
  });

  describe('assertions', () => {
    it('should assert text presence', () => {
      page = createPage(counterApp, createCanonicalBackend(), createHeadlessViewer());

      page.expectText('Counter');
      page.expectText('Count: 0');
    });

    it('should assert text absence', () => {
      page = createPage(counterApp, createCanonicalBackend(), createHeadlessViewer());

      page.expectNoText('this should not exist');
    });

    it('should assert element visibility', () => {
      page = createPage(counterApp, createCanonicalBackend(), createHeadlessViewer());

      page.expectVisible(page.getByText('Counter'));
      page.expectHidden(page.getByText('nonexistent text'));
    });

    it('should assert element count', () => {
      page = createPage(counterApp, createCanonicalBackend(), createHeadlessViewer());

      const buttons = page.getByRole('button');
      page.expectCount(buttons, 3); // dec, inc, reset
    });

    it('should throw on failed assertion', () => {
      page = createPage(counterApp, createCanonicalBackend(), createHeadlessViewer());

      expect(() => page.expectText('this does not exist')).toThrow();
    });
  });

  describe('inspection', () => {
    it('should return text content', () => {
      page = createPage(counterApp, createCanonicalBackend(), createHeadlessViewer());

      const text = page.textContent();
      expect(text).toContain('Counter');
      expect(text.length).toBeGreaterThan(0);
    });

    it('should return render tree', () => {
      page = createPage(counterApp, createCanonicalBackend(), createHeadlessViewer());

      const tree = page.getTree();
      expect(tree.root).not.toBeNull();
      expect(tree.nodeIndex.size).toBeGreaterThan(0);
    });

    it('should return metrics', () => {
      page = createPage(counterApp, createCanonicalBackend(), createHeadlessViewer());

      const metrics = page.metrics();
      expect(metrics.messagesProcessed).toBeGreaterThan(0);
      expect(metrics.treeNodeCount).toBeGreaterThan(0);
    });

    it('should produce screenshots', async () => {
      page = createPage(counterApp, createCanonicalBackend(), createHeadlessViewer());

      const screenshot = await page.screenshot();
      expect(screenshot.format).toBe('ansi');
      expect(screenshot.data).toBeTruthy();
    });
  });

  describe('complex workflows', () => {
    it('should support full counter workflow', async () => {
      page = createPage(counterApp, createCanonicalBackend(), createHeadlessViewer());

      // Verify initial state
      page.expectText('Count: 0');

      // Increment 5 times
      for (let i = 0; i < 5; i++) {
        await page.click(7);
      }
      page.expectText('Count: 5');

      // Decrement twice
      await page.click(5);
      await page.click(5);
      page.expectText('Count: 3');

      // Reset
      await page.click(9);
      page.expectText('Count: 0');
    });

    it('should support chat send workflow', async () => {
      page = createPage(chatApp, createCanonicalBackend(), createHeadlessViewer());

      // Verify initial messages exist
      page.expectText('Welcome to the chat!');

      // Send a message
      await page.type(11, 'Hello from automation!');
      await page.press('Enter');

      page.expectText('Hello from automation!');

      // Trigger bot reply
      await page.press('F5');
    });

    it('should support form wizard workflow', async () => {
      page = createPage(formWizardApp, createCanonicalBackend(), createHeadlessViewer());

      // Step 1: Personal info
      page.expectText('Personal Info');
      await page.fill(101, 'Alice');
      await page.fill(104, 'alice@test.com');
      await page.click(403); // Next

      // Step 2: Preferences
      page.expectText('Role');
      await page.click(403); // Next

      // Step 3: Review
      page.expectText('Review');
    });
  });
});
