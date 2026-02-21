/**
 * Dashboard app — multi-panel system monitor.
 *
 * Exercises: complex flexbox layout, multiple regions, real-time
 * patching (simulated), canvas alt-text, nested boxes.
 */

import { defineApp, box, text, column, row, separator, canvas } from '../app-sdk/index.js';
import type { AppConnection } from '../core/types.js';

const ID = {
  ROOT: 1,
  TITLE: 2,
  TOP_ROW: 3,
  CPU_PANEL: 10,
  CPU_TITLE: 11,
  CPU_GRAPH: 12,
  CPU_VALUE: 13,
  MEM_PANEL: 20,
  MEM_TITLE: 21,
  MEM_BAR_BG: 22,
  MEM_BAR_FILL: 23,
  MEM_VALUE: 24,
  NET_PANEL: 30,
  NET_TITLE: 31,
  NET_UP: 32,
  NET_DOWN: 33,
  BOTTOM_ROW: 40,
  PROC_PANEL: 50,
  PROC_TITLE: 51,
  // Process rows start at 200
  PROC_ROW_BASE: 200,
  DISK_PANEL: 60,
  DISK_TITLE: 61,
  // Disk rows start at 300
  DISK_ROW_BASE: 300,
  STATUS_BAR: 70,
  UPTIME: 71,
  LOAD: 72,
} as const;

interface SystemState {
  cpu: number;
  memory: { used: number; total: number };
  network: { up: number; down: number };
  processes: Array<{ pid: number; name: string; cpu: number; mem: number }>;
  disks: Array<{ mount: string; used: number; total: number }>;
  uptime: string;
  loadAvg: [number, number, number];
}

function mockSystemState(): SystemState {
  return {
    cpu: 34.2,
    memory: { used: 8.4, total: 16.0 },
    network: { up: 1.2, down: 15.7 },
    processes: [
      { pid: 1234, name: 'node', cpu: 12.3, mem: 4.2 },
      { pid: 5678, name: 'chrome', cpu: 8.7, mem: 2.1 },
      { pid: 9012, name: 'code', cpu: 5.1, mem: 1.8 },
      { pid: 3456, name: 'docker', cpu: 3.4, mem: 0.9 },
      { pid: 7890, name: 'postgres', cpu: 2.1, mem: 0.6 },
      { pid: 1111, name: 'nginx', cpu: 0.8, mem: 0.2 },
      { pid: 2222, name: 'redis', cpu: 0.3, mem: 0.1 },
    ],
    disks: [
      { mount: '/', used: 45.2, total: 100 },
      { mount: '/home', used: 120.5, total: 500 },
      { mount: '/tmp', used: 2.3, total: 10 },
    ],
    uptime: '14d 3h 22m',
    loadAvg: [1.24, 0.98, 0.76],
  };
}

export const dashboardApp = defineApp({
  name: 'dashboard',
  description: 'Multi-panel system monitor dashboard. Tests complex flexbox, real-time updates, canvas.',

  setup(conn: AppConnection) {
    let state = mockSystemState();
    let tickCount = 0;

    function buildPanel(
      id: number,
      titleId: number,
      title: string,
      children: ReturnType<typeof text>[]
    ) {
      return column({
        id,
        flex: 1,
        padding: 12,
        gap: 8,
        border: { width: 1, color: '#45475a', style: 'solid' },
        borderRadius: 8,
        background: '#1e1e2e',
      }, [
        text({ id: titleId, content: title, weight: 'bold', size: 14, color: '#89b4fa' }),
        ...children,
      ]);
    }

    function memBarWidth(): string {
      const pct = (state.memory.used / state.memory.total) * 100;
      return `${pct}%`;
    }

    function diskPct(d: { used: number; total: number }): string {
      return `${((d.used / d.total) * 100).toFixed(1)}%`;
    }

    function buildTree() {
      conn.setTree(
        column({ id: ID.ROOT, padding: 8, gap: 8, background: '#11111b' }, [
          text({ id: ID.TITLE, content: '  System Monitor', weight: 'bold', size: 18 }),

          // Top row: CPU, Memory, Network
          row({ id: ID.TOP_ROW, gap: 8, height: 150 }, [
            // CPU panel with canvas graph
            buildPanel(ID.CPU_PANEL, ID.CPU_TITLE, 'CPU', [
              canvas({
                id: ID.CPU_GRAPH,
                width: 200,
                height: 60,
                altText: `CPU usage graph: ${state.cpu.toFixed(1)}%`,
                mode: 'vector2d',
              }),
              text({
                id: ID.CPU_VALUE,
                content: `${state.cpu.toFixed(1)}%`,
                size: 24,
                weight: 'bold',
                fontFamily: 'monospace',
                color: state.cpu > 80 ? '#f38ba8' : state.cpu > 50 ? '#f9e2af' : '#a6e3a1',
              }),
            ]),

            // Memory panel with bar
            buildPanel(ID.MEM_PANEL, ID.MEM_TITLE, 'Memory', [
              box({
                id: ID.MEM_BAR_BG,
                width: '100%',
                height: 20,
                background: '#313244',
                borderRadius: 4,
              }, [
                box({
                  id: ID.MEM_BAR_FILL,
                  width: memBarWidth(),
                  height: 20,
                  background: '#89b4fa',
                  borderRadius: 4,
                }),
              ]),
              text({
                id: ID.MEM_VALUE,
                content: `${state.memory.used.toFixed(1)} / ${state.memory.total.toFixed(1)} GB`,
                fontFamily: 'monospace',
                color: '#cdd6f4',
              }),
            ]),

            // Network panel
            buildPanel(ID.NET_PANEL, ID.NET_TITLE, 'Network', [
              text({
                id: ID.NET_UP,
                content: `▲ ${state.network.up.toFixed(1)} MB/s`,
                fontFamily: 'monospace',
                color: '#a6e3a1',
              }),
              text({
                id: ID.NET_DOWN,
                content: `▼ ${state.network.down.toFixed(1)} MB/s`,
                fontFamily: 'monospace',
                color: '#89b4fa',
              }),
            ]),
          ]),

          // Bottom row: Processes and Disks
          row({ id: ID.BOTTOM_ROW, gap: 8, flex: 1 }, [
            // Process list
            column({
              id: ID.PROC_PANEL,
              flex: 2,
              padding: 12,
              gap: 4,
              border: { width: 1, color: '#45475a', style: 'solid' },
              borderRadius: 8,
              background: '#1e1e2e',
            }, [
              text({ id: ID.PROC_TITLE, content: 'Processes', weight: 'bold', size: 14, color: '#89b4fa' }),
              row({ gap: 16, padding: [4, 0] }, [
                text({ content: 'PID', weight: 'bold', width: 60, fontFamily: 'monospace' }),
                text({ content: 'Name', weight: 'bold', width: 120, fontFamily: 'monospace' }),
                text({ content: 'CPU%', weight: 'bold', width: 60, fontFamily: 'monospace', textAlign: 'right' }),
                text({ content: 'MEM GB', weight: 'bold', fontFamily: 'monospace', textAlign: 'right' }),
              ]),
              separator(),
              ...state.processes.map((proc, i) =>
                row({ id: ID.PROC_ROW_BASE + i, gap: 16, padding: [2, 0] }, [
                  text({ content: String(proc.pid), width: 60, fontFamily: 'monospace', color: '#6c7086' }),
                  text({ content: proc.name, width: 120, fontFamily: 'monospace' }),
                  text({
                    content: proc.cpu.toFixed(1),
                    width: 60,
                    fontFamily: 'monospace',
                    textAlign: 'right',
                    color: proc.cpu > 10 ? '#f9e2af' : '#cdd6f4',
                  }),
                  text({
                    content: proc.mem.toFixed(1),
                    fontFamily: 'monospace',
                    textAlign: 'right',
                  }),
                ])
              ),
            ]),

            // Disk usage
            column({
              id: ID.DISK_PANEL,
              flex: 1,
              padding: 12,
              gap: 8,
              border: { width: 1, color: '#45475a', style: 'solid' },
              borderRadius: 8,
              background: '#1e1e2e',
            }, [
              text({ id: ID.DISK_TITLE, content: 'Disk Usage', weight: 'bold', size: 14, color: '#89b4fa' }),
              ...state.disks.map((disk, i) =>
                column({ id: ID.DISK_ROW_BASE + i, gap: 2 }, [
                  row({ justify: 'between' }, [
                    text({ content: disk.mount, fontFamily: 'monospace' }),
                    text({ content: diskPct(disk), fontFamily: 'monospace', color: '#6c7086' }),
                  ]),
                  box({ height: 8, background: '#313244', borderRadius: 4 }, [
                    box({
                      width: diskPct(disk),
                      height: 8,
                      background: (disk.used / disk.total) > 0.8 ? '#f38ba8' : '#89b4fa',
                      borderRadius: 4,
                    }),
                  ]),
                ])
              ),
            ]),
          ]),

          // Status bar
          row({
            id: ID.STATUS_BAR,
            justify: 'between',
            padding: [8, 12],
            background: '#181825',
            borderRadius: 4,
          }, [
            text({ id: ID.UPTIME, content: `Uptime: ${state.uptime}`, color: '#6c7086', fontFamily: 'monospace' }),
            text({ id: ID.LOAD, content: `Load: ${state.loadAvg.map(l => l.toFixed(2)).join(' ')}`, color: '#6c7086', fontFamily: 'monospace' }),
          ]),
        ])
      );
    }

    buildTree();

    // Simulate periodic updates via input events
    conn.onInput((event) => {
      if (event.kind === 'key' && event.key === 'r') {
        // Simulate a data refresh with incremental patches
        tickCount++;
        const newCpu = 20 + Math.sin(tickCount * 0.3) * 30 + Math.random() * 10;
        state.cpu = Math.max(0, Math.min(100, newCpu));
        state.memory.used = 7 + Math.random() * 4;
        state.network.up = Math.random() * 5;
        state.network.down = Math.random() * 30;

        // Patch only changed values instead of rebuilding
        conn.patch([
          { target: ID.CPU_VALUE, set: {
            content: `${state.cpu.toFixed(1)}%`,
            color: state.cpu > 80 ? '#f38ba8' : state.cpu > 50 ? '#f9e2af' : '#a6e3a1',
          }},
          { target: ID.CPU_GRAPH, set: {
            altText: `CPU usage graph: ${state.cpu.toFixed(1)}%`,
          }},
          { target: ID.MEM_BAR_FILL, set: {
            width: `${(state.memory.used / state.memory.total * 100).toFixed(1)}%`,
          }},
          { target: ID.MEM_VALUE, set: {
            content: `${state.memory.used.toFixed(1)} / ${state.memory.total.toFixed(1)} GB`,
          }},
          { target: ID.NET_UP, set: {
            content: `▲ ${state.network.up.toFixed(1)} MB/s`,
          }},
          { target: ID.NET_DOWN, set: {
            content: `▼ ${state.network.down.toFixed(1)} MB/s`,
          }},
        ]);
      }
    });

    return {};
  },
});
