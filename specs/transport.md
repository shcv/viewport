# Viewport Transport Specification

**Status:** Draft v0.1
**Date:** February 2026

---

## 1. Overview

The `VIEWPORT` environment variable tells applications how to output their UI. Its
value is a URI that determines the transport, or it can be unset to trigger
auto-detection. This single variable replaces the previous `VIEWPORT` + `VIEWPORT_SOCKET`
pair and unifies all output modes under one scheme.

```
VIEWPORT=unix:///run/user/1000/viewport/sess-a3f2.sock
VIEWPORT=tcp://localhost:9400
VIEWPORT=ansi:
VIEWPORT=text:
```

When an app starts, it reads `VIEWPORT` and enters one of three output modes:

| Mode | Meaning |
|------|---------|
| **text** | Plain text line output on stdout (pipes, scripts, CI) |
| **ansi** | Embedded ANSI renderer, app owns the terminal (a la Ink) |
| **viewer** | Connected to an external Viewport viewer via a transport |

The output mode is queryable by the application, so it can adapt which UI elements
to draw and how to draw them (e.g., skip canvas nodes in text mode, simplify layouts
in ANSI mode, use full rich rendering with a viewer).

---

## 2. Auto-Detection (VIEWPORT unset)

When `VIEWPORT` is not set, the app SDK auto-detects the appropriate mode:

```
VIEWPORT unset + stdout is a pipe/file  →  text mode
VIEWPORT unset + stdout is a TTY        →  ansi mode (embedded renderer)
```

This means:

- `my-app | grep foo` — text mode, line-oriented output via text projection
- `my-app > output.txt` — text mode, captures text projection
- `my-app` (interactive terminal) — ansi mode, renders TUI directly

Apps can override auto-detection by setting `VIEWPORT=text:` or `VIEWPORT=ansi:`
explicitly.

---

## 3. URI Schemes

The scheme portion of the VIEWPORT URI selects the transport. Not all schemes are
supported on all platforms; the app SDK reports unsupported schemes as errors at
connection time.

### 3.1 Self-Rendering (no external viewer)

These schemes mean the app manages its own output. No IPC, no external viewer process.

#### `text:`

Plain text line mode. The app outputs its text projection to stdout.

```
VIEWPORT=text:
```

No authority, no path. The app calls `setTree()` / `patch()` as normal; the SDK
runs text projection and writes lines to stdout. Interactive features (input,
click) are unavailable. Suitable for pipes, scripts, CI.

#### `ansi:`

Embedded ANSI terminal renderer. The app renders its UI directly to the terminal
using ANSI escape sequences, similar to Ink, Bubbletea, or Textual.

```
VIEWPORT=ansi:
VIEWPORT=ansi:?alt=true        # use alternate screen buffer
VIEWPORT=ansi:?fps=30          # target frame rate
```

The SDK manages raw mode, alternate screen, cursor hiding, resize signals, and
keyboard input. This is the "batteries-included TUI" mode — apps don't need to
know about ANSI; they use the same `setTree()` / `patch()` API as with an
external viewer.

Query parameters:
- `alt` — use alternate screen buffer (default: `true`)
- `fps` — target render frame rate (default: `30`)

#### `headless:`

No output at all. For testing, benchmarking, CI. The app runs and processes
messages but nothing is rendered.

```
VIEWPORT=headless:
```

### 3.2 Local Transports (same machine)

These connect to a viewer on the same machine. Full bidirectional protocol.

#### `unix://`

Unix domain socket (stream mode). The primary production transport on Linux and
macOS.

```
VIEWPORT=unix:///run/user/1000/viewport/sess-a3f2.sock
VIEWPORT=unix:///tmp/viewport.sock
VIEWPORT=unix://%2Frun%2Fuser%2F1000%2Fviewport%2Fsock   # percent-encoded
```

The path is the socket file path. The viewer creates this socket; the app connects
to it.

Platform: Linux, macOS, BSDs, WSL.

#### `unix-abstract://`

Linux abstract namespace socket. No filesystem entry — the name lives in the kernel
and is automatically cleaned up when all references close. Avoids stale socket file
issues.

```
VIEWPORT=unix-abstract://viewport-session-a3f2
VIEWPORT=unix-abstract://viewport-${USER}-${DISPLAY}
```

The authority is the abstract name (without the leading NUL byte — the SDK adds it).

Platform: Linux only.

#### `pipe://` / `fd://`

Inherited file descriptor. The parent process creates a socketpair or pipe before
exec and passes one end as an open fd number. Useful for tightly-coupled parent-child
viewer relationships.

```
VIEWPORT=fd://3
VIEWPORT=fd://3?duplex=true     # bidirectional (socketpair)
VIEWPORT=pipe://3               # alias for fd://
```

The authority is the file descriptor number. The SDK does not open or create the fd —
it must already be open.

Query parameters:
- `duplex` — fd is bidirectional, a socketpair (default: `false`; if false, fd is
  read-write on a single fd using the protocol's framing to separate directions)

Platform: All Unix, Windows (with handle inheritance).

#### `windows://`

Windows named pipe. The native IPC mechanism on Windows.

```
VIEWPORT=windows://viewport-session-a3f2
VIEWPORT=windows://viewport-${USERNAME}
```

The authority is the pipe name. The full path becomes `\\.\pipe\{name}`.

Platform: Windows only.

#### `stdio:`

Protocol messages on stdin/stdout. The app writes CBOR-framed messages to stdout
and reads input events from stdin. This is the Tier 1 mode from the architecture
spec — structured output over the existing PTY connection.

```
VIEWPORT=stdio:
VIEWPORT=stdio:?magic=true     # use VP magic bytes to coexist with ANSI
```

Query parameters:
- `magic` — wrap protocol frames in magic byte detection so the viewer can
  distinguish protocol messages from regular text output (default: `true`)

This mode is useful when the viewer already owns the PTY and can detect magic bytes.
Apps that want a simple "structured stdout" without a socket use this.

Platform: All.

### 3.3 Network Transports (same or different machine)

These connect to a viewer over a network. Full bidirectional protocol. Each requires
the viewer to be listening on the specified address.

#### `tcp://`

Plain TCP socket.

```
VIEWPORT=tcp://localhost:9400
VIEWPORT=tcp://192.168.1.50:9400
VIEWPORT=tcp://[::1]:9400
```

Standard `host:port` authority. IPv4, IPv6, and hostnames supported.

No encryption — suitable for localhost or trusted networks only. For production
remote use, prefer `tls://` or `wss://`.

Platform: All.

#### `tls://`

TLS-encrypted TCP socket.

```
VIEWPORT=tls://viewer.example.com:9400
VIEWPORT=tls://viewer.local:9400?ca=/path/to/ca.pem
VIEWPORT=tls://viewer.local:9400?insecure=true
```

Same as `tcp://` but with TLS. Certificate verification uses the system trust store
by default.

Query parameters:
- `ca` — path to CA certificate for verification
- `cert` — path to client certificate (for mutual TLS)
- `key` — path to client private key
- `insecure` — skip certificate verification (default: `false`)

Platform: All.

#### `ws://`

WebSocket (unencrypted).

```
VIEWPORT=ws://localhost:9400/viewport
VIEWPORT=ws://192.168.1.50:9400/v1/session/abc123
```

Standard WebSocket connection. The protocol's binary frames are sent as WebSocket
binary messages (one protocol frame per WebSocket message, no additional framing
needed).

Useful for browser-based viewers, web-based IDEs, and environments where WebSocket
is the only available transport (corporate proxies, serverless).

Platform: All (requires WebSocket library).

#### `wss://`

Secure WebSocket (TLS).

```
VIEWPORT=wss://viewer.example.com/viewport
VIEWPORT=wss://viewer.example.com/viewport?token=abc123
```

Same as `ws://` with TLS. Supports the same TLS query parameters as `tls://`.

Query parameters:
- `token` — bearer token for authentication (sent in `Authorization` header)
- `ca`, `cert`, `key`, `insecure` — same as `tls://`

Platform: All.

### 3.4 Specialized Transports

#### `vsock://`

Virtio socket for VM-to-host or container-to-host communication. Used when the app
runs inside a VM or container and the viewer runs on the host.

```
VIEWPORT=vsock://2:5000           # CID 2 (host), port 5000
VIEWPORT=vsock://-1:5000          # VMADDR_CID_ANY
```

The authority is `CID:port`. CID 2 is conventionally the host.

Platform: Linux (with virtio-vsock kernel module). Firecracker, QEMU, Cloud Hypervisor.

#### `launchd://`

macOS launchd socket activation. The viewer registers a Mach service name with
launchd; the app connects by name. Launchd manages the lifecycle.

```
VIEWPORT=launchd://com.example.viewport
```

Platform: macOS only.

#### `systemd://`

systemd socket activation. The viewer is socket-activated; the app connects to
the socket path managed by systemd.

```
VIEWPORT=systemd://viewport.socket
```

The SDK resolves the actual socket path from `LISTEN_FDS` / `LISTEN_FDNAMES`
environment if the app itself is socket-activated, or connects to the conventional
path.

Platform: Linux with systemd.

---

## 4. Supplementary Environment Variables

The URI in `VIEWPORT` is the primary configuration. A few additional env vars
provide metadata:

| Variable | Value | Description |
|----------|-------|-------------|
| `VIEWPORT_VERSION` | `1` | Protocol version (always matches URI scheme version) |
| `VIEWPORT_FEATURES` | `gpu,audio,canvas` | Comma-separated viewer capability flags |
| `VIEWPORT_TEXT` | `/proc/self/fd/3` | Path to live text projection virtual file |
| `VIEWPORT_SESSION` | `sess-a3f2` | Session identifier for reconnection |

These are **set by the viewer** (or the launching shell) when spawning the app. The
app reads them but does not set them.

`VIEWPORT_VERSION` allows future protocol versions to be negotiated. The app SDK
checks this and falls back to compatible behavior if the viewer is older.

`VIEWPORT_FEATURES` lets the app know viewer capabilities before connecting, so it
can decide whether to emit canvas, audio, or other optional message types.

---

## 5. Output Mode API

The app SDK exposes the resolved output mode so applications can adapt their UI:

```typescript
type OutputMode =
  | { type: 'text' }
  | { type: 'ansi'; altScreen: boolean; fps: number }
  | { type: 'viewer'; transport: TransportInfo }
  | { type: 'headless' }

type TransportInfo = {
  scheme: TransportScheme;
  uri: string;
  features: string[];       // from VIEWPORT_FEATURES
  version: number;           // from VIEWPORT_VERSION
}
```

Applications query this via `conn.outputMode` to make rendering decisions:

```typescript
const app = defineApp({
  name: 'my-app',
  setup(conn) {
    if (conn.outputMode.type === 'text') {
      // Minimal output — just the data, no chrome
      conn.setTree(column({}, [
        text({ content: formatData(data) }),
      ]));
    } else {
      // Full UI with charts, borders, interactive elements
      conn.setTree(column({}, [
        heading('Dashboard'),
        canvas({ mode: 'vector2d', width: 400, height: 200 }),
        scroll({ schema: 1 }, dataRows),
      ]));
    }
  },
});
```

### 5.1 Component-Level Adaptation

The standard component library can also adapt automatically. Components receive the
output mode and make internal rendering decisions:

- **`scroll`** in text mode → renders all rows as plain lines
- **`scroll`** in ANSI mode → renders visible window with scroll indicators
- **`scroll`** in viewer mode → full virtual scrolling with viewer-managed inertia
- **`canvas`** in text mode → renders `altText` only
- **`canvas`** in ANSI mode → renders Braille/block character fallback
- **`canvas`** in viewer mode → full GPU-accelerated rendering
- **`input`** in text mode → not rendered (no interactivity)
- **`input`** in ANSI mode → terminal-managed line editing
- **`input`** in viewer mode → viewer-managed rich text input

---

## 6. Connection Lifecycle

### 6.1 Viewer-to-App Startup

When the viewer launches an app:

1. Viewer creates transport endpoint (socket, pipe, etc.)
2. Viewer sets `VIEWPORT=<uri>` (and supplementary vars) in the app's environment
3. Viewer spawns the app process
4. App SDK reads `VIEWPORT`, resolves the output mode
5. If output mode is `viewer`: app connects to the transport endpoint
6. Viewer sends `ENV` message with display dimensions, capabilities
7. App sends initial `TREE` message
8. Bidirectional protocol communication begins

### 6.2 App Self-Start (no viewer)

When the app starts without a viewer:

1. App SDK reads `VIEWPORT` (unset)
2. App SDK checks `isatty(stdout)`:
   - TTY → `ansi` mode: SDK initializes raw mode, alternate screen, etc.
   - Not TTY → `text` mode: SDK will output text projection to stdout
3. App calls `setTree()` as normal
4. In ANSI mode: SDK renders to terminal, handles keyboard/mouse input
5. In text mode: SDK runs text projection, writes to stdout

### 6.3 Reconnection

For transports that support it (sockets, TCP, WebSocket), the app SDK can attempt
reconnection if the connection drops:

- App continues running, buffering state
- SDK reconnects using the same URI
- On reconnection, app re-sends current `TREE` (full state)
- Viewer resume from the fresh tree

The `VIEWPORT_SESSION` variable enables the viewer to recognize a reconnecting app
and restore its region/position.

---

## 7. Platform Support Matrix

| Scheme | Linux | macOS | Windows | Browser | Container/VM |
|--------|-------|-------|---------|---------|-------------|
| `text:` | yes | yes | yes | — | yes |
| `ansi:` | yes | yes | yes (ConPTY) | — | yes |
| `headless:` | yes | yes | yes | yes | yes |
| `unix://` | yes | yes | — | — | yes |
| `unix-abstract://` | yes | — | — | — | yes (Linux) |
| `fd://` | yes | yes | partial | — | yes |
| `windows://` | — | — | yes | — | — |
| `stdio:` | yes | yes | yes | — | yes |
| `tcp://` | yes | yes | yes | — | yes |
| `tls://` | yes | yes | yes | — | yes |
| `ws://` | yes | yes | yes | yes | yes |
| `wss://` | yes | yes | yes | yes | yes |
| `vsock://` | yes | — | — | — | yes |
| `launchd://` | — | yes | — | — | — |
| `systemd://` | yes | — | — | — | — |

---

## 8. Security Considerations

### 8.1 Local Transports

Unix domain sockets and named pipes use filesystem permissions for access control.
The viewer should create sockets with mode `0600` (owner-only).

Abstract sockets (Linux) have no filesystem permissions — any process in the same
network namespace can connect. Use with caution in shared environments.

### 8.2 Network Transports

Plain `tcp://` and `ws://` provide no encryption or authentication. Use only on
localhost or fully trusted networks.

For any network exposure, use `tls://` or `wss://` with proper certificates. The
`token` query parameter on `wss://` provides a simple bearer token mechanism for
session binding.

### 8.3 URI Sanitization

The `VIEWPORT` URI may contain sensitive information (tokens, paths). The app SDK
should not log the full URI in production output. The `OutputMode` type exposes
the scheme and non-sensitive metadata only.

---

## 9. Examples

```bash
# Auto-detect: TUI in terminal, text in pipes
my-app
my-app | head -20

# Force text mode even in a terminal
VIEWPORT=text: my-app

# Force ANSI embedded renderer
VIEWPORT=ansi: my-app

# Connect to local viewer (Unix socket)
VIEWPORT=unix:///run/user/1000/viewport/sess.sock my-app

# Connect to local viewer (abstract socket)
VIEWPORT=unix-abstract://viewport-session-1234 my-app

# Connect to local viewer (inherited fd from parent)
VIEWPORT=fd://3 my-app

# Connect to remote viewer
VIEWPORT=tls://devbox.example.com:9400 my-app

# Connect to browser-based viewer
VIEWPORT=wss://ide.example.com/viewport?token=abc123 my-app

# Inside a VM, connect to host viewer
VIEWPORT=vsock://2:5000 my-app

# Testing / CI
VIEWPORT=headless: my-app
```
