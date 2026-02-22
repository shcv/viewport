/**
 * Test app registry.
 *
 * All test applications are exported here for use by the harness.
 * Each app exercises different protocol capabilities.
 */

import type { AppFactory } from '../core/types.js';
import { counterApp } from './counter.js';
import { fileBrowserApp } from './file-browser.js';
import { dashboardApp } from './dashboard.js';
import { tableViewApp } from './table-view.js';
import { formWizardApp } from './form-wizard.js';
import { chatApp } from './chat.js';

export { counterApp } from './counter.js';
export { fileBrowserApp } from './file-browser.js';
export { dashboardApp } from './dashboard.js';
export { tableViewApp } from './table-view.js';
export { formWizardApp } from './form-wizard.js';
export { chatApp } from './chat.js';

/** All test apps in the suite, keyed by name. */
export const ALL_APPS: Record<string, AppFactory> = {
  counter: counterApp,
  'file-browser': fileBrowserApp,
  dashboard: dashboardApp,
  'table-view': tableViewApp,
  'form-wizard': formWizardApp,
  chat: chatApp,
};

/** App names in a stable order. */
export const APP_NAMES = Object.keys(ALL_APPS);

/**
 * What each test app exercises (for test matrix planning):
 *
 * counter:       basic tree, patches, click handling, keyboard input
 * file-browser:  schema, data records, schema display hints, scroll, virtualization, sorting
 * dashboard:     complex flexbox, multiple panels, real-time patching, canvas alt-text
 * table-view:    input field, large tree updates, sorting, filtering, schema+data
 * form-wizard:   input fields, focus, conditional rendering, multi-step state, validation
 * chat:          scroll append, input, dynamic content growth, child insertion patches
 */
