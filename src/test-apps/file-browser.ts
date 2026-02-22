/**
 * File browser app — scrollable list with structured data.
 *
 * Exercises: schema definition, data records, schema display hints,
 * scroll regions, virtualization, selection state, sorting.
 */

import { defineApp, box, text, scroll, column, row, clickable } from '../app-sdk/index.js';
import type { AppConnection, SchemaColumn } from '../core/types.js';

const ID = {
  ROOT: 1,
  HEADER: 2,
  TITLE: 3,
  PATH: 4,
  COLUMN_HEADERS: 5,
  COL_NAME: 6,
  COL_SIZE: 7,
  COL_DATE: 8,
  FILE_LIST: 9,
  STATUS_BAR: 10,
  FILE_COUNT: 11,
  SELECTED: 12,
  // File rows start at 100
  FILE_ROW_BASE: 100,
} as const;

const SCHEMA_SLOT = 100;

interface FileEntry {
  name: string;
  size: number;
  modified: number;
  isDir: boolean;
}

// Sample file data for testing
const SAMPLE_FILES: FileEntry[] = [
  { name: '..', size: 0, modified: 1708300000, isDir: true },
  { name: 'src/', size: 0, modified: 1708290000, isDir: true },
  { name: 'tests/', size: 0, modified: 1708280000, isDir: true },
  { name: 'node_modules/', size: 0, modified: 1708270000, isDir: true },
  { name: 'package.json', size: 1234, modified: 1708260000, isDir: false },
  { name: 'tsconfig.json', size: 456, modified: 1708250000, isDir: false },
  { name: 'README.md', size: 8901, modified: 1708240000, isDir: false },
  { name: '.gitignore', size: 89, modified: 1708230000, isDir: false },
  { name: 'server.log', size: 48231, modified: 1708220000, isDir: false },
  { name: 'config.yml', size: 892, modified: 1708210000, isDir: false },
  { name: 'Makefile', size: 2341, modified: 1708200000, isDir: false },
  { name: 'LICENSE', size: 1067, modified: 1708190000, isDir: false },
  { name: 'CHANGELOG.md', size: 15678, modified: 1708180000, isDir: false },
  { name: 'docker-compose.yml', size: 3456, modified: 1708170000, isDir: false },
  { name: '.env.example', size: 234, modified: 1708160000, isDir: false },
];

export const fileBrowserApp = defineApp({
  name: 'file-browser',
  description: 'File browser with scrollable list, structured data, selection, and sorting.',

  setup(conn: AppConnection) {
    let selectedIndex = 0;
    let sortColumn = 'name';
    let sortAsc = true;
    let files = [...SAMPLE_FILES];

    const columns: SchemaColumn[] = [
      { id: 0, name: 'name', type: 'string' },
      { id: 1, name: 'size', type: 'uint64', unit: 'bytes', format: 'human_bytes' },
      { id: 2, name: 'modified', type: 'timestamp', format: 'relative_time' },
    ];

    // Define the schema
    conn.defineSchema(SCHEMA_SLOT, columns);

    function sortFiles() {
      files.sort((a, b) => {
        // Directories first
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;

        let cmp = 0;
        switch (sortColumn) {
          case 'name': cmp = a.name.localeCompare(b.name); break;
          case 'size': cmp = a.size - b.size; break;
          case 'modified': cmp = a.modified - b.modified; break;
        }
        return sortAsc ? cmp : -cmp;
      });
    }

    function buildFileRow(file: FileEntry, index: number) {
      const isSelected = index === selectedIndex;
      const namePrefix = file.isDir ? '📁 ' : '   ';

      return clickable({
        id: ID.FILE_ROW_BASE + index,
        direction: 'row',
        gap: 16,
        padding: [2, 8],
        background: isSelected ? '#313244' : undefined,
      }, [
        text({
          id: ID.FILE_ROW_BASE + 1000 + index,
          content: `${namePrefix}${file.name}`,
          fontFamily: 'monospace',
          color: file.isDir ? '#89b4fa' : '#cdd6f4',
          width: 200,
        }),
        text({
          id: ID.FILE_ROW_BASE + 2000 + index,
          content: file.isDir ? '' : formatBytes(file.size),
          fontFamily: 'monospace',
          color: '#6c7086',
          width: 80,
          textAlign: 'right',
        }),
        text({
          id: ID.FILE_ROW_BASE + 3000 + index,
          content: formatDate(file.modified),
          fontFamily: 'monospace',
          color: '#6c7086',
        }),
      ]);
    }

    function buildTree() {
      sortFiles();

      conn.setTree(
        column({ id: ID.ROOT, padding: 8, gap: 0 }, [
          // Header
          column({ id: ID.HEADER, gap: 4, padding: [0, 0, 8, 0] }, [
            text({ id: ID.TITLE, content: 'File Browser', weight: 'bold', size: 16 }),
            text({ id: ID.PATH, content: '/home/user/project', color: '#6c7086', fontFamily: 'monospace' }),
          ]),

          // Column headers
          row({
            id: ID.COLUMN_HEADERS,
            gap: 16,
            padding: [4, 8],
            border: { width: 1, color: '#45475a', style: 'solid' },
          }, [
            clickable({ id: ID.COL_NAME }, [
              text({ content: `Name ${sortColumn === 'name' ? (sortAsc ? '▲' : '▼') : ' '}`, weight: 'bold', width: 200 }),
            ]),
            clickable({ id: ID.COL_SIZE }, [
              text({ content: `Size ${sortColumn === 'size' ? (sortAsc ? '▲' : '▼') : ' '}`, weight: 'bold', width: 80, textAlign: 'right' }),
            ]),
            clickable({ id: ID.COL_DATE }, [
              text({ content: `Modified ${sortColumn === 'modified' ? (sortAsc ? '▲' : '▼') : ' '}`, weight: 'bold' }),
            ]),
          ]),

          // File list
          scroll({
            id: ID.FILE_LIST,
            flex: 1,
            virtualHeight: files.length * 24,
            schema: SCHEMA_SLOT,
          }, files.map((file, i) => buildFileRow(file, i))),

          // Status bar
          row({
            id: ID.STATUS_BAR,
            gap: 16,
            padding: [8, 8, 0, 8],
            border: { width: 1, color: '#45475a', style: 'solid' },
          }, [
            text({ id: ID.FILE_COUNT, content: `${files.length} items`, color: '#6c7086' }),
            text({ id: ID.SELECTED, content: `Selected: ${files[selectedIndex]?.name ?? 'none'}`, color: '#6c7086' }),
          ]),
        ])
      );

      // Also emit structured data records
      for (const file of files) {
        conn.emitData(SCHEMA_SLOT, [file.name, file.size, file.modified]);
      }
    }

    buildTree();

    conn.onInput((event) => {
      if (event.kind === 'click') {
        // Column header clicks for sorting
        const target = event.target ?? 0;
        if (target === ID.COL_NAME || (target > ID.COL_NAME && target < ID.COL_SIZE)) {
          sortColumn = sortColumn === 'name' && sortAsc ? 'name' : 'name';
          sortAsc = sortColumn === 'name' ? !sortAsc : true;
          buildTree();
          return;
        }
        if (target === ID.COL_SIZE) {
          sortAsc = sortColumn === 'size' ? !sortAsc : true;
          sortColumn = 'size';
          buildTree();
          return;
        }
        if (target === ID.COL_DATE) {
          sortAsc = sortColumn === 'modified' ? !sortAsc : true;
          sortColumn = 'modified';
          buildTree();
          return;
        }

        // File row clicks
        if (target >= ID.FILE_ROW_BASE) {
          const index = (target - ID.FILE_ROW_BASE) % 1000;
          if (index >= 0 && index < files.length) {
            selectedIndex = index;
            buildTree();
          }
        }
      }

      if (event.kind === 'key') {
        switch (event.key) {
          case 'ArrowUp':
          case 'k':
            selectedIndex = Math.max(0, selectedIndex - 1);
            buildTree();
            break;
          case 'ArrowDown':
          case 'j':
            selectedIndex = Math.min(files.length - 1, selectedIndex + 1);
            buildTree();
            break;
          case 'Home':
            selectedIndex = 0;
            buildTree();
            break;
          case 'End':
            selectedIndex = files.length - 1;
            buildTree();
            break;
        }
      }
    });

    return {};
  },
});

function formatBytes(bytes: number): string {
  if (bytes === 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let b = bytes;
  while (b >= 1024 && i < units.length - 1) { b /= 1024; i++; }
  return `${b.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}
