# Test Applications

Six classic TUI app patterns that exercise different Viewport protocol capabilities.

## Apps

| App | Exercises | Key Protocol Features |
|-----|-----------|----------------------|
| `counter` | Basic tree, patches, click handling | TREE, PATCH(set), INPUT(click, key) |
| `file-browser` | Schema, data records, scroll, sorting | SCHEMA, DATA, TREE(scroll), sorting |
| `dashboard` | Complex flexbox, real-time patching | TREE(nested), PATCH(multi), canvas alt-text |
| `table-view` | Input field, filtering, large updates | INPUT(value_change), TREE(large), sorting |
| `form-wizard` | Multi-step state, validation, focus | INPUT, conditional rendering, step transitions |
| `chat` | Scroll append, dynamic growth | PATCH(childrenInsert), scroll, INPUT |

## Conventions

- Each app uses stable integer IDs (not auto-generated) defined in a top-level `ID` const
- Apps use the `defineApp()` factory from `../app-sdk/`
- Apps interact exclusively through `AppConnection` — they never touch protocol encoding
- Input handlers are registered via `conn.onInput()`
- Structured data uses `conn.defineSchema()` + `conn.emitData()`

## Adding New Test Apps

1. Create `src/test-apps/your-app.ts`
2. Define stable IDs for all nodes
3. Use `defineApp({ name, description, setup })` pattern
4. Register in `src/test-apps/index.ts` in `ALL_APPS`
5. Add interaction sequences in `src/harness/cli.ts` `getInteractions()`
