/**
 * Matrix runner.
 *
 * Runs all test apps against all protocol × viewer combinations
 * and collects comparative metrics.
 */

import type { AppFactory, ProtocolBackend, ViewerBackend, EnvInfo, InputEvent } from '../core/types.js';
import { TestHarness, type HarnessMetrics } from './harness.js';
import { summarizeMetrics, formatMetrics, compareMetrics, formatComparison, type MetricsSummary } from './metrics.js';
import { runQualityChecks, type QualityReport } from './quality.js';

export interface RunConfig {
  apps: AppFactory[];
  protocols: ProtocolBackend[];
  viewers: ViewerFactory[];
  env?: Partial<EnvInfo>;
  /** Input sequences to replay after app start (for interaction testing). */
  interactions?: Record<string, InputEvent[]>;
}

export interface ViewerFactory {
  name: string;
  create(): ViewerBackend;
}

export interface RunResult {
  app: string;
  protocol: string;
  viewer: string;
  metrics: HarnessMetrics;
  summary: MetricsSummary;
  quality: QualityReport;
  textProjection: string;
  error?: string;
}

export interface MatrixResult {
  results: RunResult[];
  comparisons: string[];
  timestamp: string;
}

/** Run a single app+protocol+viewer combination. */
export function runSingle(
  app: AppFactory,
  protocol: ProtocolBackend,
  viewer: ViewerBackend,
  interactions?: InputEvent[],
  env?: Partial<EnvInfo>,
): RunResult {
  const harness = new TestHarness({ app, protocol, viewer, env });

  try {
    harness.start();

    // Replay interactions if provided
    if (interactions) {
      for (const event of interactions) {
        harness.sendInput(event);
      }
    }

    const metrics = harness.getHarnessMetrics();
    const summary = summarizeMetrics(metrics);
    const quality = runQualityChecks(harness.getTree());
    const textProj = harness.getTextProjection();

    harness.stop();

    return {
      app: app.name,
      protocol: protocol.name,
      viewer: viewer.name,
      metrics,
      summary,
      quality,
      textProjection: textProj,
    };
  } catch (err) {
    harness.stop();
    return {
      app: app.name,
      protocol: protocol.name,
      viewer: viewer.name,
      metrics: harness.getHarnessMetrics(),
      summary: summarizeMetrics(harness.getHarnessMetrics()),
      quality: { passed: false, checks: [], score: 0 },
      textProjection: '',
      error: String(err),
    };
  }
}

/** Run the full test matrix. */
export function runMatrix(config: RunConfig): MatrixResult {
  const results: RunResult[] = [];

  for (const app of config.apps) {
    for (const protocol of config.protocols) {
      for (const viewerFactory of config.viewers) {
        const viewer = viewerFactory.create();
        const interactions = config.interactions?.[app.name];
        const result = runSingle(app, protocol, viewer, interactions, config.env);
        results.push(result);
      }
    }
  }

  // Generate comparisons between protocols for the same app+viewer
  const comparisons: string[] = [];

  if (config.protocols.length >= 2) {
    for (const app of config.apps) {
      for (const viewerFactory of config.viewers) {
        const matching = results.filter(
          (r) => r.app === app.name && r.viewer === viewerFactory.name && !r.error
        );

        for (let i = 0; i < matching.length; i++) {
          for (let j = i + 1; j < matching.length; j++) {
            const cmp = compareMetrics(
              matching[i].summary,
              matching[j].summary,
              `${matching[i].protocol}`,
              `${matching[j].protocol}`,
            );
            comparisons.push(
              `\n[${app.name} / ${viewerFactory.name}]\n` +
              formatComparison(cmp)
            );
          }
        }
      }
    }
  }

  return {
    results,
    comparisons,
    timestamp: new Date().toISOString(),
  };
}

/** Format matrix results as a readable report. */
export function formatMatrixReport(matrix: MatrixResult): string {
  const lines: string[] = [];
  lines.push('╔══════════════════════════════════════════════════════════════╗');
  lines.push('║              Viewport Test Harness Report                   ║');
  lines.push('╚══════════════════════════════════════════════════════════════╝');
  lines.push(`\nTimestamp: ${matrix.timestamp}`);
  lines.push(`Total runs: ${matrix.results.length}`);

  // Summary table
  lines.push('\n┌─────────────────┬──────────────────┬──────────────────┬────────┬─────────┬─────────┐');
  lines.push('│ App             │ Protocol         │ Viewer           │ Quality│ Bytes   │ Nodes   │');
  lines.push('├─────────────────┼──────────────────┼──────────────────┼────────┼─────────┼─────────┤');

  for (const r of matrix.results) {
    const errStr = r.error ? ' ERR' : '';
    lines.push(
      `│ ${(r.app + errStr).padEnd(15)} │ ${r.protocol.slice(0, 16).padEnd(16)} │ ${r.viewer.slice(0, 16).padEnd(16)} │ ${String(r.quality.score).padStart(5)}% │ ${String(r.summary.totalBytes).padStart(7)} │ ${String(r.summary.finalNodeCount).padStart(7)} │`
    );
  }

  lines.push('└─────────────────┴──────────────────┴──────────────────┴────────┴─────────┴─────────┘');

  // Errors
  const errors = matrix.results.filter((r) => r.error);
  if (errors.length > 0) {
    lines.push('\n⚠ Errors:');
    for (const e of errors) {
      lines.push(`  ${e.app} / ${e.protocol} / ${e.viewer}: ${e.error}`);
    }
  }

  // Quality failures
  const failures = matrix.results.filter((r) => !r.quality.passed);
  if (failures.length > 0) {
    lines.push('\n⚠ Quality failures:');
    for (const f of failures) {
      const failedChecks = f.quality.checks.filter((c) => !c.passed && c.severity === 'error');
      lines.push(`  ${f.app} / ${f.protocol}: ${failedChecks.map(c => c.message).join('; ')}`);
    }
  }

  // Detailed metrics per run
  lines.push('\n' + '='.repeat(60));
  for (const r of matrix.results) {
    if (!r.error) {
      lines.push(formatMetrics(r.summary, `${r.app} / ${r.protocol} / ${r.viewer}`));
    }
  }

  // Comparisons
  if (matrix.comparisons.length > 0) {
    lines.push('\n' + '='.repeat(60));
    lines.push('\nProtocol Comparisons:');
    for (const cmp of matrix.comparisons) {
      lines.push(cmp);
    }
  }

  return lines.join('\n');
}
