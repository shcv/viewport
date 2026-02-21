/**
 * Metrics collection and analysis.
 *
 * Provides statistical analysis of harness metrics for comparing
 * protocol and viewer variants.
 */

import type { HarnessMetrics } from './harness.js';
import type { ViewerMetrics } from '../core/types.js';

export interface MetricsSummary {
  // Wire efficiency
  totalBytes: number;
  bytesPerMessage: number;
  bytesByType: Record<string, { count: number; totalBytes: number; avgBytes: number }>;

  // Parse performance
  avgEncodeTimeMs: number;
  avgDecodeTimeMs: number;
  p50EncodeTimeMs: number;
  p95EncodeTimeMs: number;
  p99EncodeTimeMs: number;
  p50DecodeTimeMs: number;
  p95DecodeTimeMs: number;
  p99DecodeTimeMs: number;

  // Viewer performance
  avgProcessTimeMs: number;
  p50ProcessTimeMs: number;
  p95ProcessTimeMs: number;
  p99ProcessTimeMs: number;
  peakFrameTimeMs: number;

  // State
  finalNodeCount: number;
  finalTreeDepth: number;
  finalSlotCount: number;
  finalDataRows: number;
  estimatedMemoryBytes: number;

  // Throughput
  messagesPerSecond: number;
  bytesPerSecond: number;
  elapsedMs: number;
}

export function summarizeMetrics(harness: HarnessMetrics): MetricsSummary {
  const msgCount = harness.appToViewerMessages || 1; // avoid div by zero

  // Collect times from viewer metrics
  const frameTimes = harness.viewerMetrics.frameTimesMs;

  // Collect per-message encode/decode times
  const encodeTimes = harness.encodeTimesMs ?? [];
  const decodeTimes = harness.decodeTimesMs ?? [];

  const MESSAGE_TYPE_NAMES: Record<number, string> = {
    0x01: 'DEFINE',
    0x02: 'TREE',
    0x03: 'PATCH',
    0x04: 'DATA',
    0x05: 'INPUT',
    0x06: 'ENV',
    0x07: 'REGION',
    0x08: 'AUDIO',
    0x09: 'CANVAS',
    0x0a: 'SCHEMA',
  };

  const bytesByType: Record<string, { count: number; totalBytes: number; avgBytes: number }> = {};
  for (const [typeNum, stats] of Object.entries(harness.messagesByType)) {
    const name = MESSAGE_TYPE_NAMES[Number(typeNum)] ?? `0x${Number(typeNum).toString(16)}`;
    bytesByType[name] = {
      count: (stats as any).count,
      totalBytes: (stats as any).bytes,
      avgBytes: (stats as any).count > 0 ? (stats as any).bytes / (stats as any).count : 0,
    };
  }

  return {
    totalBytes: harness.totalWireBytes,
    bytesPerMessage: harness.totalWireBytes / msgCount,
    bytesByType,

    avgEncodeTimeMs: harness.totalEncodeTimeMs / msgCount,
    avgDecodeTimeMs: harness.totalDecodeTimeMs / msgCount,
    p50EncodeTimeMs: percentile(encodeTimes, 50),
    p95EncodeTimeMs: percentile(encodeTimes, 95),
    p99EncodeTimeMs: percentile(encodeTimes, 99),
    p50DecodeTimeMs: percentile(decodeTimes, 50),
    p95DecodeTimeMs: percentile(decodeTimes, 95),
    p99DecodeTimeMs: percentile(decodeTimes, 99),

    avgProcessTimeMs: harness.viewerMetrics.avgFrameTimeMs,
    p50ProcessTimeMs: percentile(frameTimes, 50),
    p95ProcessTimeMs: percentile(frameTimes, 95),
    p99ProcessTimeMs: percentile(frameTimes, 99),
    peakFrameTimeMs: harness.viewerMetrics.peakFrameTimeMs,

    finalNodeCount: harness.viewerMetrics.treeNodeCount,
    finalTreeDepth: harness.viewerMetrics.treeDepth,
    finalSlotCount: harness.viewerMetrics.slotCount,
    finalDataRows: harness.viewerMetrics.dataRowCount,
    estimatedMemoryBytes: harness.viewerMetrics.memoryUsageBytes,

    messagesPerSecond: harness.elapsedMs > 0 ? (msgCount / harness.elapsedMs) * 1000 : 0,
    bytesPerSecond: harness.elapsedMs > 0 ? (harness.totalWireBytes / harness.elapsedMs) * 1000 : 0,
    elapsedMs: harness.elapsedMs,
  };
}

/** Compare two metric summaries side-by-side. */
export function compareMetrics(a: MetricsSummary, b: MetricsSummary, aLabel: string, bLabel: string): ComparisonResult {
  const rows: ComparisonRow[] = [
    compare('Wire: total bytes', a.totalBytes, b.totalBytes, 'lower'),
    compare('Wire: bytes/message', a.bytesPerMessage, b.bytesPerMessage, 'lower'),
    compare('Parse: avg encode (ms)', a.avgEncodeTimeMs, b.avgEncodeTimeMs, 'lower'),
    compare('Parse: avg decode (ms)', a.avgDecodeTimeMs, b.avgDecodeTimeMs, 'lower'),
    compare('Viewer: avg process (ms)', a.avgProcessTimeMs, b.avgProcessTimeMs, 'lower'),
    compare('Viewer: p95 process (ms)', a.p95ProcessTimeMs, b.p95ProcessTimeMs, 'lower'),
    compare('Viewer: peak frame (ms)', a.peakFrameTimeMs, b.peakFrameTimeMs, 'lower'),
    compare('State: node count', a.finalNodeCount, b.finalNodeCount, 'neutral'),
    compare('State: tree depth', a.finalTreeDepth, b.finalTreeDepth, 'neutral'),
    compare('State: memory (KB)', a.estimatedMemoryBytes / 1024, b.estimatedMemoryBytes / 1024, 'lower'),
    compare('Throughput: msg/s', a.messagesPerSecond, b.messagesPerSecond, 'higher'),
    compare('Throughput: bytes/s', a.bytesPerSecond, b.bytesPerSecond, 'higher'),
  ];

  return { aLabel, bLabel, rows };
}

export interface ComparisonResult {
  aLabel: string;
  bLabel: string;
  rows: ComparisonRow[];
}

export interface ComparisonRow {
  metric: string;
  aValue: number;
  bValue: number;
  winner: 'a' | 'b' | 'tie';
  ratio: number; // b/a (>1 means a is better when lower-is-better)
}

function compare(
  metric: string,
  aValue: number,
  bValue: number,
  better: 'lower' | 'higher' | 'neutral',
): ComparisonRow {
  const ratio = aValue > 0 ? bValue / aValue : 1;
  let winner: 'a' | 'b' | 'tie' = 'tie';

  if (Math.abs(ratio - 1) > 0.01) { // 1% threshold
    if (better === 'lower') {
      winner = aValue < bValue ? 'a' : 'b';
    } else if (better === 'higher') {
      winner = aValue > bValue ? 'a' : 'b';
    }
  }

  return { metric, aValue, bValue, winner, ratio };
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

/** Format a metrics summary as a readable table string. */
export function formatMetrics(summary: MetricsSummary, label: string): string {
  const lines: string[] = [];
  lines.push(`\n=== ${label} ===\n`);

  lines.push('Wire Efficiency:');
  lines.push(`  Total bytes:     ${summary.totalBytes.toLocaleString()}`);
  lines.push(`  Bytes/message:   ${summary.bytesPerMessage.toFixed(1)}`);
  for (const [type, stats] of Object.entries(summary.bytesByType)) {
    lines.push(`  ${type}: ${stats.count} msgs, ${stats.totalBytes.toLocaleString()} bytes (avg ${stats.avgBytes.toFixed(1)})`);
  }

  lines.push('\nPerformance:');
  lines.push(`  Avg encode:      ${summary.avgEncodeTimeMs.toFixed(3)} ms`);
  lines.push(`  Avg decode:      ${summary.avgDecodeTimeMs.toFixed(3)} ms`);
  lines.push(`  Avg process:     ${summary.avgProcessTimeMs.toFixed(3)} ms`);
  lines.push(`  P95 process:     ${summary.p95ProcessTimeMs.toFixed(3)} ms`);
  lines.push(`  Peak frame:      ${summary.peakFrameTimeMs.toFixed(3)} ms`);

  lines.push('\nState:');
  lines.push(`  Nodes:           ${summary.finalNodeCount}`);
  lines.push(`  Tree depth:      ${summary.finalTreeDepth}`);
  lines.push(`  Slots:           ${summary.finalSlotCount}`);
  lines.push(`  Data rows:       ${summary.finalDataRows}`);
  lines.push(`  Est. memory:     ${(summary.estimatedMemoryBytes / 1024).toFixed(1)} KB`);

  lines.push('\nThroughput:');
  lines.push(`  Messages/sec:    ${summary.messagesPerSecond.toFixed(0)}`);
  lines.push(`  Bytes/sec:       ${summary.bytesPerSecond.toFixed(0)}`);
  lines.push(`  Elapsed:         ${summary.elapsedMs.toFixed(1)} ms`);

  return lines.join('\n');
}

/** Format a comparison result as a readable table. */
export function formatComparison(result: ComparisonResult): string {
  const lines: string[] = [];
  const colW = 22;
  const numW = 14;

  lines.push(`\n=== Comparison: ${result.aLabel} vs ${result.bLabel} ===\n`);
  lines.push(
    'Metric'.padEnd(colW) +
    result.aLabel.padStart(numW) +
    result.bLabel.padStart(numW) +
    'Winner'.padStart(10) +
    'Ratio'.padStart(10)
  );
  lines.push('-'.repeat(colW + numW * 2 + 20));

  for (const row of result.rows) {
    const winStr = row.winner === 'tie' ? '  —' : row.winner === 'a' ? ` ← ${result.aLabel}` : ` → ${result.bLabel}`;
    lines.push(
      row.metric.padEnd(colW) +
      formatNum(row.aValue).padStart(numW) +
      formatNum(row.bValue).padStart(numW) +
      winStr.padStart(10) +
      row.ratio.toFixed(2).padStart(10)
    );
  }

  return lines.join('\n');
}

function formatNum(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  if (n < 0.01 && n > 0) return n.toExponential(2);
  return n.toFixed(2);
}
