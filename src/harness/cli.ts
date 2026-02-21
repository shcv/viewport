/**
 * CLI entry point for the test harness.
 *
 * Usage:
 *   npx tsx src/harness/cli.ts                    # Run all apps with default config
 *   npx tsx src/harness/cli.ts --app counter      # Run specific app
 *   npx tsx src/harness/cli.ts --matrix            # Run full protocol×viewer matrix
 *   npx tsx src/harness/cli.ts --benchmark         # Run with interaction sequences
 *   npx tsx src/harness/cli.ts --json              # Output JSON results
 */

import type { InputEvent } from '../core/types.js';
import { ALL_APPS } from '../test-apps/index.js';
import { createTreePatchBackend } from '../variants/protocol-a-tree-patch/index.js';
import { createHeadlessViewer } from '../variants/viewer-headless/index.js';
import { runMatrix, runSingle, formatMatrixReport, type ViewerFactory, type RunConfig } from './runner.js';
import { formatMetrics, summarizeMetrics } from './metrics.js';
import { runQualityChecks } from './quality.js';

function parseArgs(): CLIOptions {
  const args = process.argv.slice(2);
  const opts: CLIOptions = {
    apps: [],
    matrix: false,
    benchmark: false,
    json: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--app':
        opts.apps.push(args[++i]);
        break;
      case '--matrix':
        opts.matrix = true;
        break;
      case '--benchmark':
        opts.benchmark = true;
        break;
      case '--json':
        opts.json = true;
        break;
      case '--help':
        printHelp();
        process.exit(0);
    }
  }

  return opts;
}

interface CLIOptions {
  apps: string[];
  matrix: boolean;
  benchmark: boolean;
  json: boolean;
}

function printHelp(): void {
  console.log(`
Viewport Test Harness

Usage:
  npx tsx src/harness/cli.ts [options]

Options:
  --app <name>    Run specific app(s) (can repeat). Default: all apps.
  --matrix        Run full protocol × viewer matrix.
  --benchmark     Include interaction sequences for benchmarking.
  --json          Output results as JSON.
  --help          Show this help.

Available apps:
  ${Object.keys(ALL_APPS).join(', ')}
`);
}

/** Standard interaction sequences for benchmarking. */
function getInteractions(): Record<string, InputEvent[]> {
  return {
    counter: [
      // Click increment 10 times
      ...Array.from({ length: 10 }, () => ({ kind: 'click' as const, target: 7 })),
      // Click decrement 3 times
      ...Array.from({ length: 3 }, () => ({ kind: 'click' as const, target: 5 })),
      // Keyboard increment 5 times
      ...Array.from({ length: 5 }, () => ({ kind: 'key' as const, key: 'ArrowUp' })),
      // Reset
      { kind: 'click' as const, target: 9 },
    ],

    'file-browser': [
      // Navigate down 5 times
      ...Array.from({ length: 5 }, () => ({ kind: 'key' as const, key: 'ArrowDown' })),
      // Navigate up 2 times
      ...Array.from({ length: 2 }, () => ({ kind: 'key' as const, key: 'ArrowUp' })),
    ],

    dashboard: [
      // Refresh data 20 times (simulates real-time updates)
      ...Array.from({ length: 20 }, () => ({ kind: 'key' as const, key: 'r' })),
    ],

    'table-view': [
      // Type a filter
      { kind: 'value_change' as const, target: 5, value: 'admin' },
      // Sort by different columns
      { kind: 'click' as const, target: 11 }, // sort by name
      { kind: 'click' as const, target: 12 }, // sort by email
      // Clear filter
      { kind: 'value_change' as const, target: 5, value: '' },
      // Navigate rows
      ...Array.from({ length: 5 }, () => ({ kind: 'key' as const, key: 'ArrowDown' })),
    ],

    'form-wizard': [
      // Fill step 1
      { kind: 'value_change' as const, target: 101, value: 'Test User' },
      { kind: 'value_change' as const, target: 104, value: 'test@example.com' },
      // Next
      { kind: 'click' as const, target: 403 },
      // Select options in step 2
      { kind: 'click' as const, target: 202 }, // role: Manager
      { kind: 'click' as const, target: 212 }, // theme: System
      { kind: 'click' as const, target: 221 }, // toggle notifications
      // Next
      { kind: 'click' as const, target: 403 },
      // Submit
      { kind: 'click' as const, target: 403 },
    ],

    chat: [
      // Type and send a message
      { kind: 'value_change' as const, target: 11, value: 'Hello from the test harness!' },
      { kind: 'key' as const, key: 'Enter' },
      // Trigger bot reply
      { kind: 'key' as const, key: 'F5' },
      // Send another message
      { kind: 'value_change' as const, target: 11, value: 'How does the protocol handle this?' },
      { kind: 'key' as const, key: 'Enter' },
      { kind: 'key' as const, key: 'F5' },
    ],
  };
}

function main(): void {
  const opts = parseArgs();

  // Select apps
  const appNames = opts.apps.length > 0
    ? opts.apps.filter((a) => a in ALL_APPS)
    : Object.keys(ALL_APPS);

  if (appNames.length === 0) {
    console.error('No valid apps specified. Available:', Object.keys(ALL_APPS).join(', '));
    process.exit(1);
  }

  const apps = appNames.map((name) => ALL_APPS[name]);

  // Protocol backends (currently only A; B and C to be added)
  const protocols = [createTreePatchBackend()];

  // Viewer factories
  const viewers: ViewerFactory[] = [
    { name: 'Headless Viewer', create: createHeadlessViewer },
  ];

  const interactions = opts.benchmark ? getInteractions() : undefined;

  if (opts.matrix) {
    // Full matrix run
    const config: RunConfig = { apps, protocols, viewers, interactions };
    const result = runMatrix(config);

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(formatMatrixReport(result));
    }
  } else {
    // Single protocol+viewer per app
    for (const app of apps) {
      const protocol = protocols[0];
      const viewer = viewers[0].create();
      const appInteractions = interactions?.[app.name];

      const result = runSingle(app, protocol, viewer, appInteractions);

      if (opts.json) {
        console.log(JSON.stringify({
          app: result.app,
          protocol: result.protocol,
          viewer: result.viewer,
          summary: result.summary,
          quality: result.quality,
          textProjection: result.textProjection.slice(0, 500),
          error: result.error,
        }, null, 2));
      } else {
        console.log(formatMetrics(result.summary, `${result.app} / ${result.protocol}`));
        console.log(`\nQuality: ${result.quality.score}% (${result.quality.passed ? 'PASS' : 'FAIL'})`);
        for (const check of result.quality.checks) {
          const icon = check.passed ? '✓' : check.severity === 'error' ? '✗' : '⚠';
          console.log(`  ${icon} ${check.name}: ${check.message}`);
        }
        console.log('\nText Projection (first 20 lines):');
        console.log(result.textProjection.split('\n').slice(0, 20).map(l => `  │ ${l}`).join('\n'));
        if (result.error) {
          console.log(`\n⚠ Error: ${result.error}`);
        }
        console.log('\n' + '─'.repeat(60));
      }
    }
  }
}

main();
