/**
 * Table view app — sortable, filterable data table.
 *
 * Exercises: input field, large tree updates, column sorting,
 * re-ordering children, text filtering, schema + data records.
 */

import { defineApp, box, text, scroll, column, row, input, clickable, separator } from '../app-sdk/index.js';
import type { AppConnection, SchemaColumn } from '../core/types.js';

const ID = {
  ROOT: 1,
  TITLE: 2,
  FILTER_ROW: 3,
  FILTER_LABEL: 4,
  FILTER_INPUT: 5,
  RESULT_COUNT: 6,
  TABLE_HEADER: 10,
  TABLE_BODY: 20,
  STATUS: 30,
  ROW_BASE: 100,
} as const;

const SCHEMA_SLOT = 100;

interface DataRow {
  id: number;
  name: string;
  email: string;
  role: string;
  status: 'active' | 'inactive' | 'pending';
  lastLogin: number;
}

const SAMPLE_DATA: DataRow[] = [
  { id: 1, name: 'Alice Chen', email: 'alice@example.com', role: 'Admin', status: 'active', lastLogin: 1708300000 },
  { id: 2, name: 'Bob Smith', email: 'bob@example.com', role: 'User', status: 'active', lastLogin: 1708290000 },
  { id: 3, name: 'Carol White', email: 'carol@example.com', role: 'Editor', status: 'inactive', lastLogin: 1708200000 },
  { id: 4, name: 'Dave Jones', email: 'dave@example.com', role: 'User', status: 'pending', lastLogin: 1708100000 },
  { id: 5, name: 'Eve Brown', email: 'eve@example.com', role: 'Admin', status: 'active', lastLogin: 1708295000 },
  { id: 6, name: 'Frank Lee', email: 'frank@example.com', role: 'User', status: 'active', lastLogin: 1708280000 },
  { id: 7, name: 'Grace Kim', email: 'grace@example.com', role: 'Editor', status: 'inactive', lastLogin: 1708150000 },
  { id: 8, name: 'Henry Park', email: 'henry@example.com', role: 'User', status: 'active', lastLogin: 1708270000 },
  { id: 9, name: 'Iris Wang', email: 'iris@example.com', role: 'Admin', status: 'active', lastLogin: 1708260000 },
  { id: 10, name: 'Jack Liu', email: 'jack@example.com', role: 'User', status: 'pending', lastLogin: 1708050000 },
  { id: 11, name: 'Karen Xu', email: 'karen@example.com', role: 'Editor', status: 'active', lastLogin: 1708250000 },
  { id: 12, name: 'Leo Zhang', email: 'leo@example.com', role: 'User', status: 'active', lastLogin: 1708240000 },
  { id: 13, name: 'Mia Huang', email: 'mia@example.com', role: 'Admin', status: 'active', lastLogin: 1708230000 },
  { id: 14, name: 'Noah Wu', email: 'noah@example.com', role: 'User', status: 'inactive', lastLogin: 1707900000 },
  { id: 15, name: 'Olivia Yang', email: 'olivia@example.com', role: 'Editor', status: 'active', lastLogin: 1708220000 },
];

const COLUMNS = ['name', 'email', 'role', 'status', 'lastLogin'] as const;
const COLUMN_LABELS: Record<string, string> = {
  name: 'Name', email: 'Email', role: 'Role', status: 'Status', lastLogin: 'Last Login',
};
const COLUMN_WIDTHS: Record<string, number> = {
  name: 140, email: 200, role: 80, status: 80, lastLogin: 120,
};

export const tableViewApp = defineApp({
  name: 'table-view',
  description: 'Sortable, filterable data table. Tests input, large updates, sorting, filtering.',

  setup(conn: AppConnection) {
    let filter = '';
    let sortCol: string = 'name';
    let sortAsc = true;
    let selectedRow = -1;

    const schema: SchemaColumn[] = [
      { id: 0, name: 'name', type: 'string' },
      { id: 1, name: 'email', type: 'string' },
      { id: 2, name: 'role', type: 'string' },
      { id: 3, name: 'status', type: 'string' },
      { id: 4, name: 'lastLogin', type: 'timestamp', format: 'relative_time' },
    ];

    conn.defineSchema(SCHEMA_SLOT, schema);

    function getFiltered(): DataRow[] {
      let rows = [...SAMPLE_DATA];

      if (filter) {
        const f = filter.toLowerCase();
        rows = rows.filter(r =>
          r.name.toLowerCase().includes(f) ||
          r.email.toLowerCase().includes(f) ||
          r.role.toLowerCase().includes(f) ||
          r.status.toLowerCase().includes(f)
        );
      }

      rows.sort((a, b) => {
        const av = a[sortCol as keyof DataRow];
        const bv = b[sortCol as keyof DataRow];
        let cmp = 0;
        if (typeof av === 'string' && typeof bv === 'string') cmp = av.localeCompare(bv);
        else cmp = Number(av) - Number(bv);
        return sortAsc ? cmp : -cmp;
      });

      return rows;
    }

    function statusColor(status: string): string {
      switch (status) {
        case 'active': return '#a6e3a1';
        case 'inactive': return '#f38ba8';
        case 'pending': return '#f9e2af';
        default: return '#cdd6f4';
      }
    }

    function buildTree() {
      const filtered = getFiltered();

      conn.setTree(
        column({ id: ID.ROOT, padding: 12, gap: 8 }, [
          text({ id: ID.TITLE, content: 'Users', weight: 'bold', size: 18 }),

          // Filter row
          row({ id: ID.FILTER_ROW, gap: 8, align: 'center' }, [
            text({ id: ID.FILTER_LABEL, content: 'Filter:', weight: 'bold' }),
            input({
              id: ID.FILTER_INPUT,
              value: filter,
              placeholder: 'Search by name, email, role, or status...',
              width: 400,
            }),
            text({
              id: ID.RESULT_COUNT,
              content: `${filtered.length} of ${SAMPLE_DATA.length} users`,
              color: '#6c7086',
            }),
          ]),

          // Table header
          row({
            id: ID.TABLE_HEADER,
            gap: 0,
            padding: [6, 8],
            background: '#313244',
            borderRadius: 4,
          },
            COLUMNS.map((col, i) =>
              clickable({
                id: ID.TABLE_HEADER + 1 + i,
                width: COLUMN_WIDTHS[col],
              }, [
                text({
                  content: `${COLUMN_LABELS[col]} ${sortCol === col ? (sortAsc ? '▲' : '▼') : ''}`,
                  weight: 'bold',
                  fontFamily: 'monospace',
                }),
              ])
            )
          ),

          // Table body
          scroll({
            id: ID.TABLE_BODY,
            flex: 1,
            virtualHeight: filtered.length * 28,
          },
            filtered.map((dataRow, i) =>
              clickable({
                id: ID.ROW_BASE + i,
                direction: 'row',
                gap: 0,
                padding: [4, 8],
                background: i === selectedRow ? '#313244' : (i % 2 === 0 ? '#1e1e2e' : '#181825'),
              }, [
                text({ id: ID.ROW_BASE + 1000 + i, content: dataRow.name, width: COLUMN_WIDTHS.name, fontFamily: 'monospace' }),
                text({ id: ID.ROW_BASE + 2000 + i, content: dataRow.email, width: COLUMN_WIDTHS.email, fontFamily: 'monospace', color: '#89b4fa' }),
                text({ id: ID.ROW_BASE + 3000 + i, content: dataRow.role, width: COLUMN_WIDTHS.role, fontFamily: 'monospace' }),
                text({ id: ID.ROW_BASE + 4000 + i, content: dataRow.status, width: COLUMN_WIDTHS.status, fontFamily: 'monospace', color: statusColor(dataRow.status) }),
                text({ id: ID.ROW_BASE + 5000 + i, content: new Date(dataRow.lastLogin * 1000).toLocaleDateString(), fontFamily: 'monospace', color: '#6c7086' }),
              ])
            )
          ),

          // Status
          text({
            id: ID.STATUS,
            content: `Sort: ${COLUMN_LABELS[sortCol]} ${sortAsc ? 'ascending' : 'descending'}`,
            color: '#6c7086',
            size: 12,
          }),
        ])
      );

      // Emit structured data
      for (const dataRow of filtered) {
        conn.emitData(SCHEMA_SLOT, [dataRow.name, dataRow.email, dataRow.role, dataRow.status, dataRow.lastLogin]);
      }
    }

    buildTree();

    conn.onInput((event) => {
      if (event.kind === 'value_change' && event.target === ID.FILTER_INPUT) {
        filter = event.value ?? '';
        selectedRow = -1;
        buildTree();
      }

      if (event.kind === 'click') {
        const t = event.target ?? 0;
        // Column header click
        for (let i = 0; i < COLUMNS.length; i++) {
          if (t === ID.TABLE_HEADER + 1 + i) {
            const col = COLUMNS[i];
            if (sortCol === col) {
              sortAsc = !sortAsc;
            } else {
              sortCol = col;
              sortAsc = true;
            }
            buildTree();
            return;
          }
        }
        // Row click
        if (t >= ID.ROW_BASE) {
          const index = (t - ID.ROW_BASE) % 1000;
          selectedRow = index;
          buildTree();
        }
      }

      if (event.kind === 'key') {
        const filtered = getFiltered();
        switch (event.key) {
          case 'ArrowUp':
          case 'k':
            selectedRow = Math.max(0, selectedRow - 1);
            buildTree();
            break;
          case 'ArrowDown':
          case 'j':
            selectedRow = Math.min(filtered.length - 1, selectedRow + 1);
            buildTree();
            break;
        }
      }
    });

    return {};
  },
});
