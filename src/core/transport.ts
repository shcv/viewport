/**
 * VIEWPORT environment variable parsing and output mode detection.
 *
 * The VIEWPORT env var is a URI that determines how the app outputs its UI.
 * This module parses that URI, auto-detects when unset, and exposes typed
 * output mode information for apps to adapt their rendering.
 */

import { isatty } from 'node:tty';

// ── Transport Schemes ────────────────────────────────────────────

/**
 * All recognized URI schemes for the VIEWPORT env var.
 *
 * Self-rendering (no external viewer):
 *   text, ansi, headless
 *
 * Local transports (same machine):
 *   unix, unix-abstract, fd, pipe, windows, stdio
 *
 * Network transports:
 *   tcp, tls, ws, wss
 *
 * Specialized:
 *   vsock, launchd, systemd
 */
export type TransportScheme =
  // Self-rendering
  | 'text'
  | 'ansi'
  | 'headless'
  // Local
  | 'unix'
  | 'unix-abstract'
  | 'fd'
  | 'pipe'
  | 'windows'
  | 'stdio'
  // Network
  | 'tcp'
  | 'tls'
  | 'ws'
  | 'wss'
  // Specialized
  | 'vsock'
  | 'launchd'
  | 'systemd';

const SELF_RENDERING_SCHEMES = new Set<TransportScheme>(['text', 'ansi', 'headless']);
const LOCAL_SCHEMES = new Set<TransportScheme>(['unix', 'unix-abstract', 'fd', 'pipe', 'windows', 'stdio']);
const NETWORK_SCHEMES = new Set<TransportScheme>(['tcp', 'tls', 'ws', 'wss']);
const SPECIALIZED_SCHEMES = new Set<TransportScheme>(['vsock', 'launchd', 'systemd']);

const ALL_SCHEMES = new Set<TransportScheme>([
  ...SELF_RENDERING_SCHEMES,
  ...LOCAL_SCHEMES,
  ...NETWORK_SCHEMES,
  ...SPECIALIZED_SCHEMES,
]);

// ── Output Mode ──────────────────────────────────────────────────

/**
 * The resolved output mode. Apps query this to adapt their UI.
 */
export type OutputMode =
  | { type: 'text' }
  | { type: 'ansi'; altScreen: boolean; fps: number }
  | { type: 'viewer'; transport: TransportInfo }
  | { type: 'headless' };

/**
 * Transport connection details for viewer mode.
 */
export interface TransportInfo {
  /** The transport scheme. */
  scheme: TransportScheme;
  /** The original URI string. */
  uri: string;
  /** Parsed address/path for the transport. */
  address: TransportAddress;
  /** Viewer capabilities from VIEWPORT_FEATURES. */
  features: string[];
  /** Protocol version from VIEWPORT_VERSION. */
  version: number;
  /** Session ID from VIEWPORT_SESSION. */
  session?: string;
  /** Query parameters from the URI. */
  params: Record<string, string>;
}

/**
 * Parsed transport address — varies by scheme.
 */
export type TransportAddress =
  | { type: 'path'; path: string }             // unix
  | { type: 'name'; name: string }             // unix-abstract, windows, launchd, systemd
  | { type: 'fd'; fd: number; duplex: boolean } // fd, pipe
  | { type: 'host'; host: string; port: number } // tcp, tls
  | { type: 'url'; url: string }               // ws, wss
  | { type: 'vsock'; cid: number; port: number } // vsock
  | { type: 'none' };                           // stdio

// ── Parsed URI ───────────────────────────────────────────────────

export interface ParsedViewportUri {
  scheme: TransportScheme;
  authority: string;
  path: string;
  params: Record<string, string>;
  raw: string;
}

// ── Parser ───────────────────────────────────────────────────────

/**
 * Parse a VIEWPORT URI string into its components.
 *
 * Handles both authority-based (unix://path) and opaque (text:) URIs.
 * Throws on unrecognized schemes.
 */
export function parseViewportUri(uri: string): ParsedViewportUri {
  const raw = uri.trim();

  // Extract scheme — everything before the first ':'
  const colonIdx = raw.indexOf(':');
  if (colonIdx === -1) {
    throw new ViewportUriError(`Invalid VIEWPORT URI: missing scheme in "${raw}"`);
  }

  const scheme = raw.substring(0, colonIdx) as TransportScheme;
  if (!ALL_SCHEMES.has(scheme)) {
    throw new ViewportUriError(`Unknown VIEWPORT scheme: "${scheme}"`);
  }

  const rest = raw.substring(colonIdx + 1);

  // Parse query parameters
  const qIdx = rest.indexOf('?');
  const query = qIdx !== -1 ? rest.substring(qIdx + 1) : '';
  const params = parseQueryParams(query);
  const beforeQuery = qIdx !== -1 ? rest.substring(0, qIdx) : rest;

  // Parse authority and path
  let authority = '';
  let path = '';

  if (beforeQuery.startsWith('//')) {
    // Authority-based: scheme://authority/path
    const afterSlashes = beforeQuery.substring(2);
    const slashIdx = afterSlashes.indexOf('/');
    if (slashIdx === -1) {
      authority = afterSlashes;
    } else {
      authority = afterSlashes.substring(0, slashIdx);
      path = afterSlashes.substring(slashIdx);
    }
  } else {
    // Opaque: scheme: or scheme:rest
    path = beforeQuery;
  }

  // Percent-decode the path
  path = decodeURIComponent(path);

  return { scheme, authority, path, params, raw };
}

function parseQueryParams(query: string): Record<string, string> {
  const params: Record<string, string> = {};
  if (!query) return params;
  for (const pair of query.split('&')) {
    const eqIdx = pair.indexOf('=');
    if (eqIdx === -1) {
      params[decodeURIComponent(pair)] = 'true';
    } else {
      params[decodeURIComponent(pair.substring(0, eqIdx))] =
        decodeURIComponent(pair.substring(eqIdx + 1));
    }
  }
  return params;
}

// ── Address Resolution ───────────────────────────────────────────

/**
 * Resolve a parsed URI into a typed transport address.
 */
export function resolveAddress(parsed: ParsedViewportUri): TransportAddress {
  switch (parsed.scheme) {
    case 'unix':
      // unix:///path/to/socket or unix://path (authority as path fallback)
      return { type: 'path', path: parsed.path || `/${parsed.authority}` };

    case 'unix-abstract':
      return { type: 'name', name: parsed.authority || parsed.path };

    case 'fd':
    case 'pipe': {
      const fd = parseInt(parsed.authority || parsed.path, 10);
      if (isNaN(fd) || fd < 0) {
        throw new ViewportUriError(`Invalid file descriptor in "${parsed.raw}"`);
      }
      const duplex = parsed.params['duplex'] === 'true';
      return { type: 'fd', fd, duplex };
    }

    case 'windows':
      return { type: 'name', name: parsed.authority || parsed.path };

    case 'launchd':
      return { type: 'name', name: parsed.authority || parsed.path };

    case 'systemd':
      return { type: 'name', name: parsed.authority || parsed.path };

    case 'stdio':
      return { type: 'none' };

    case 'tcp':
    case 'tls':
      return parseHostPort(parsed);

    case 'ws':
    case 'wss': {
      // Reconstruct the full WebSocket URL
      const wsScheme = parsed.scheme === 'ws' ? 'ws' : 'wss';
      const url = `${wsScheme}://${parsed.authority}${parsed.path}`;
      return { type: 'url', url };
    }

    case 'vsock': {
      const parts = parsed.authority.split(':');
      if (parts.length !== 2) {
        throw new ViewportUriError(`Invalid vsock address in "${parsed.raw}", expected CID:port`);
      }
      const cid = parseInt(parts[0], 10);
      const port = parseInt(parts[1], 10);
      if (isNaN(cid) || isNaN(port)) {
        throw new ViewportUriError(`Invalid vsock CID or port in "${parsed.raw}"`);
      }
      return { type: 'vsock', cid, port };
    }

    // Self-rendering schemes have no address
    case 'text':
    case 'ansi':
    case 'headless':
      return { type: 'none' };
  }
}

function parseHostPort(parsed: ParsedViewportUri): TransportAddress {
  const authority = parsed.authority;
  if (!authority) {
    throw new ViewportUriError(`Missing host:port in "${parsed.raw}"`);
  }

  // Handle IPv6: [::1]:port
  let host: string;
  let portStr: string;
  if (authority.startsWith('[')) {
    const bracketEnd = authority.indexOf(']');
    if (bracketEnd === -1) {
      throw new ViewportUriError(`Malformed IPv6 address in "${parsed.raw}"`);
    }
    host = authority.substring(1, bracketEnd);
    portStr = authority.substring(bracketEnd + 2); // skip ]:
  } else {
    const lastColon = authority.lastIndexOf(':');
    if (lastColon === -1) {
      throw new ViewportUriError(`Missing port in "${parsed.raw}"`);
    }
    host = authority.substring(0, lastColon);
    portStr = authority.substring(lastColon + 1);
  }

  const port = parseInt(portStr, 10);
  if (isNaN(port) || port < 0 || port > 65535) {
    throw new ViewportUriError(`Invalid port "${portStr}" in "${parsed.raw}"`);
  }

  return { type: 'host', host, port };
}

// ── Output Mode Resolution ───────────────────────────────────────

export interface ResolveOptions {
  /** Override for VIEWPORT env var (for testing). */
  viewport?: string;
  /** Override for VIEWPORT_VERSION env var. */
  version?: string;
  /** Override for VIEWPORT_FEATURES env var. */
  features?: string;
  /** Override for VIEWPORT_SESSION env var. */
  session?: string;
  /** Override for isatty(stdout) check (for testing). */
  stdoutIsTty?: boolean;
}

/**
 * Resolve the current output mode from environment variables.
 *
 * This is the main entry point. Call at app startup to determine
 * how the app should output its UI.
 */
export function resolveOutputMode(options: ResolveOptions = {}): OutputMode {
  const viewport = options.viewport ?? process.env['VIEWPORT'];
  const version = parseInt(options.version ?? process.env['VIEWPORT_VERSION'] ?? '1', 10);
  const features = (options.features ?? process.env['VIEWPORT_FEATURES'] ?? '')
    .split(',')
    .map(f => f.trim())
    .filter(Boolean);
  const session = options.session ?? process.env['VIEWPORT_SESSION'];

  // Auto-detect when VIEWPORT is unset
  if (viewport === undefined || viewport === '') {
    const isTty = options.stdoutIsTty ?? isatty(1);
    if (isTty) {
      return { type: 'ansi', altScreen: true, fps: 30 };
    } else {
      return { type: 'text' };
    }
  }

  // Parse the URI
  const parsed = parseViewportUri(viewport);

  // Self-rendering schemes
  switch (parsed.scheme) {
    case 'text':
      return { type: 'text' };

    case 'headless':
      return { type: 'headless' };

    case 'ansi':
      return {
        type: 'ansi',
        altScreen: parsed.params['alt'] !== 'false',
        fps: parseInt(parsed.params['fps'] ?? '30', 10),
      };
  }

  // All other schemes are viewer transports
  const address = resolveAddress(parsed);
  return {
    type: 'viewer',
    transport: {
      scheme: parsed.scheme,
      uri: parsed.raw,
      address,
      features,
      version,
      session,
      params: parsed.params,
    },
  };
}

// ── Utilities ────────────────────────────────────────────────────

/**
 * Check if an output mode supports interactivity (input events).
 */
export function isInteractive(mode: OutputMode): boolean {
  return mode.type !== 'text';
}

/**
 * Check if an output mode supports rich rendering (canvas, GPU, etc.).
 */
export function isRichRendering(mode: OutputMode): boolean {
  if (mode.type === 'viewer') {
    return mode.transport.features.includes('gpu') ||
           mode.transport.features.includes('canvas');
  }
  return false;
}

/**
 * Get a human-readable description of the output mode.
 */
export function describeOutputMode(mode: OutputMode): string {
  switch (mode.type) {
    case 'text':
      return 'text (plain text line output)';
    case 'ansi':
      return `ansi (embedded terminal renderer, ${mode.fps}fps)`;
    case 'headless':
      return 'headless (no output)';
    case 'viewer':
      return `viewer via ${mode.transport.scheme} (${describeAddress(mode.transport.address)})`;
  }
}

function describeAddress(addr: TransportAddress): string {
  switch (addr.type) {
    case 'path': return addr.path;
    case 'name': return addr.name;
    case 'fd': return `fd ${addr.fd}`;
    case 'host': return `${addr.host}:${addr.port}`;
    case 'url': return addr.url;
    case 'vsock': return `vsock ${addr.cid}:${addr.port}`;
    case 'none': return 'stdio';
  }
}

// ── Error ────────────────────────────────────────────────────────

export class ViewportUriError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ViewportUriError';
  }
}
