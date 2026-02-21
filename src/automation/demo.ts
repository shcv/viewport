/**
 * Automation API demo — demonstrates the Playwright-style ViewportPage
 * API by running interactive scenarios against test apps.
 *
 * Usage: npx tsx src/automation/demo.ts
 */

import { createPage } from './page.js';
import { ALL_APPS } from '../test-apps/index.js';
import { createTreePatchBackend } from '../variants/protocol-a-tree-patch/index.js';
import { createHeadlessViewer } from '../variants/viewer-headless/index.js';

function log(msg: string): void {
  console.log(`  ${msg}`);
}

function header(title: string): void {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${'─'.repeat(60)}`);
}

async function demoCounter(): Promise<void> {
  header('Demo: Counter App');
  const protocol = createTreePatchBackend();
  const viewer = createHeadlessViewer();
  const page = createPage(ALL_APPS['counter'], protocol, viewer);

  log('Initial state:');
  page.expectText('Count: 0');
  log('✓ Count starts at 0');

  log('Clicking increment button...');
  const plusBtn = page.getByText('+');
  await page.click(plusBtn);
  page.expectText('Count: 1');
  log('✓ Count is now 1');

  await page.click(plusBtn);
  await page.click(plusBtn);
  page.expectText('Count: 3');
  log('✓ Clicked twice more, count is 3');

  log('Clicking decrement button...');
  const minusBtn = page.getByText('-');
  await page.click(minusBtn);
  page.expectText('Count: 2');
  log('✓ Count decremented to 2');

  log('Pressing keyboard shortcut (ArrowUp)...');
  await page.press('ArrowUp');
  page.expectText('Count: 3');
  log('✓ Keyboard increment works');

  log('Getting screenshot...');
  const screenshot = await page.screenshot();
  log(`Screenshot format: ${screenshot.format}, size: ${(screenshot.data as string).length} chars`);

  log('Checking metrics...');
  const metrics = page.metrics();
  log(`Messages processed: ${metrics.messagesProcessed}`);
  log(`Tree nodes: ${metrics.treeNodeCount}`);

  page.close();
  log('✓ Counter demo complete');
}

async function demoChat(): Promise<void> {
  header('Demo: Chat App');
  const protocol = createTreePatchBackend();
  const viewer = createHeadlessViewer();
  const page = createPage(ALL_APPS['chat'], protocol, viewer);

  log('Initial state:');
  const textContent = page.textContent();
  log(`Text projection (first 100 chars): "${textContent.slice(0, 100)}..."`);

  log('Typing a message...');
  const inputField = page.getByType('input').first();
  await page.type(inputField, 'Hello from the automation demo!');
  log('✓ Message typed');

  log('Sending message (Enter)...');
  await page.press('Enter');
  log('✓ Message sent');

  log('Checking message appears...');
  page.expectText('Hello from the automation demo!');
  log('✓ Message visible in chat');

  log('Triggering bot reply...');
  await page.press('F5');
  log('Checking for bot reply...');
  const projection = page.textContent();
  log(`Text projection (last 200 chars): "...${projection.slice(-200)}"`);

  page.close();
  log('✓ Chat demo complete');
}

async function demoFormWizard(): Promise<void> {
  header('Demo: Form Wizard');
  const protocol = createTreePatchBackend();
  const viewer = createHeadlessViewer();
  const page = createPage(ALL_APPS['form-wizard'], protocol, viewer);

  log('Step 1: Personal Information');
  page.expectText('Personal Info');
  log('✓ On step 1');

  log('Filling in name...');
  await page.type(page.getById(101), 'Jane Developer');
  log('✓ Name entered');

  log('Filling in email...');
  await page.type(page.getById(104), 'jane@example.com');
  log('✓ Email entered');

  log('Clicking Next...');
  await page.click(page.getById(403));
  page.expectText('Preferences');
  log('✓ Advanced to step 2');

  log('Selecting a role...');
  await page.click(page.getById(202)); // Manager
  log('✓ Role selected');

  log('Clicking Next...');
  await page.click(page.getById(403));
  page.expectText('Review');
  log('✓ Advanced to step 3 (Review)');

  log('Submitting form...');
  await page.click(page.getById(403));
  log('✓ Form submitted');

  const finalText = page.textContent();
  log(`Final state: "${finalText.slice(0, 200)}..."`);

  page.close();
  log('✓ Form wizard demo complete');
}

async function demoLocators(): Promise<void> {
  header('Demo: Locator API');
  const protocol = createTreePatchBackend();
  const viewer = createHeadlessViewer();
  const page = createPage(ALL_APPS['counter'], protocol, viewer);

  log('Testing locator strategies...');

  const byText = page.getByText('Count');
  log(`getByText("Count"): ${byText.count()} match(es) — ${byText.describe()}`);

  const byType = page.getByType('text');
  log(`getByType("text"): ${byType.count()} match(es)`);

  const byRole = page.getByRole('button');
  log(`getByRole("button"): ${byRole.count()} match(es)`);

  const byId = page.getById(1);
  log(`getById(1): ${byId.isVisible() ? 'visible' : 'not found'}`);

  const firstText = byType.first();
  log(`First text node content: "${firstText.textContent()}"`);

  const filtered = page.filter((n) => n.props.weight === 'bold');
  log(`Bold nodes: ${filtered.count()}`);

  log('Testing assertions...');
  page.expectVisible(byText);
  log('✓ expectVisible passed');
  page.expectCount(page.getByType('separator'), 0);
  log('✓ expectCount passed');

  page.close();
  log('✓ Locator demo complete');
}

async function main(): Promise<void> {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║              Viewport Automation API Demo                   ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  await demoCounter();
  await demoChat();
  await demoFormWizard();
  await demoLocators();

  header('Summary');
  log('All demos completed successfully.');
  log('The ViewportPage API provides:');
  log('  • Locators: getByText, getById, getByType, getByRole, filter');
  log('  • Actions: click, type, fill, press, hover, focus, scroll, resize');
  log('  • Assertions: expectText, expectNoText, expectCount, expectVisible, expectHidden');
  log('  • Inspection: textContent, screenshot, getTree, metrics');
}

main().catch(console.error);
