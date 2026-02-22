/**
 * Viewer configuration model.
 *
 * Unified configuration for a Viewport viewer, with merging from
 * multiple sources: defaults → config file → CLI args → env vars.
 *
 * The viewer reads this at startup to know:
 *   - What transport(s) to listen on
 *   - Display dimensions and capabilities
 *   - Which features to advertise
 *   - Session management options
 *   - TLS settings
 */

import type { TlsOptions } from './transport-api.js';

// ── Configuration Schema ─────────────────────────────────────────

export interface ViewerConfig {
  /**
   * Transport URIs to listen on. The viewer binds to all of these.
   * Each URI selects a transport from the registry.
   *
   * Examples:
   *   ["unix:///run/user/1000/viewport/sess.sock"]
   *   ["tcp://0.0.0.0:9400", "unix:///tmp/viewport.sock"]
   *   ["wss://0.0.0.0:9400"]
   */
  listen: string[];

  /** Display configuration. */
  display: DisplayConfig;

  /** Features to advertise in VIEWPORT_FEATURES. */
  features: string[];

  /** TLS configuration (applies to tls:// and wss:// listeners). */
  tls?: TlsOptions;

  /** Session configuration. */
  session?: SessionConfig;

  /** Logging level. */
  logLevel?: 'silent' | 'error' | 'warn' | 'info' | 'debug';

  /** Maximum concurrent app connections. 0 = unlimited. */
  maxConnections?: number;
}

export interface DisplayConfig {
  /** Display width in logical pixels. */
  width: number;
  /** Display height in logical pixels. */
  height: number;
  /** Pixel density (e.g., 2.0 for Retina). */
  pixelDensity: number;
  /** Color depth in bits (e.g., 8 for 256 colors, 24 for true color). */
  colorDepth: number;
}

export interface SessionConfig {
  /** Session ID. Auto-generated if not specified. */
  id?: string;
  /** Enable session persistence for reconnection. */
  persistent?: boolean;
}

// ── Defaults ─────────────────────────────────────────────────────

export const DEFAULT_CONFIG: ViewerConfig = {
  listen: ['unix:///tmp/viewport.sock'],
  display: {
    width: 800,
    height: 600,
    pixelDensity: 1.0,
    colorDepth: 24,
  },
  features: [],
  logLevel: 'info',
  maxConnections: 0,
};

// ── Config Merging ───────────────────────────────────────────────

/**
 * Merge configuration from multiple sources.
 *
 * Sources are applied in order (later sources override earlier):
 *   1. defaults (DEFAULT_CONFIG)
 *   2. config file
 *   3. CLI args
 *   4. env vars
 *
 * Partial configs are deep-merged. Arrays are replaced, not concatenated.
 */
export function mergeConfigs(...sources: Partial<ViewerConfig>[]): ViewerConfig {
  let result: ViewerConfig = structuredClone(DEFAULT_CONFIG);

  for (const source of sources) {
    result = mergeTwo(result, source);
  }

  return result;
}

function mergeTwo(base: ViewerConfig, override: Partial<ViewerConfig>): ViewerConfig {
  const result = { ...base };

  if (override.listen !== undefined) result.listen = override.listen;
  if (override.features !== undefined) result.features = override.features;
  if (override.logLevel !== undefined) result.logLevel = override.logLevel;
  if (override.maxConnections !== undefined) result.maxConnections = override.maxConnections;

  if (override.display) {
    result.display = { ...result.display, ...override.display };
  }

  if (override.tls !== undefined) {
    result.tls = override.tls === undefined ? undefined : { ...result.tls, ...override.tls };
  }

  if (override.session !== undefined) {
    result.session = override.session === undefined
      ? undefined
      : { ...result.session, ...override.session };
  }

  return result;
}

// ── CLI Argument Parsing ─────────────────────────────────────────

/**
 * Parse CLI arguments into a partial ViewerConfig.
 *
 * Recognized flags:
 *   --listen <uri>        Transport URI (repeatable)
 *   --width <n>           Display width
 *   --height <n>          Display height
 *   --pixel-density <n>   Pixel density
 *   --color-depth <n>     Color depth
 *   --features <list>     Comma-separated feature list
 *   --tls-cert <path>     TLS certificate path
 *   --tls-key <path>      TLS private key path
 *   --tls-ca <path>       TLS CA certificate path
 *   --tls-insecure        Skip TLS verification
 *   --session <id>        Session ID
 *   --log-level <level>   Logging level
 *   --max-connections <n> Max concurrent connections
 *   --config <path>       Config file path
 */
export interface ParsedCli {
  config: Partial<ViewerConfig>;
  configFilePath?: string;
  help?: boolean;
}

export function parseViewerArgs(argv: string[]): ParsedCli {
  const config: Partial<ViewerConfig> = {};
  const listenUris: string[] = [];
  let configFilePath: string | undefined;
  let help = false;

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];

    switch (arg) {
      case '--listen':
        listenUris.push(argv[++i]);
        break;
      case '--width':
        config.display = { ...config.display as DisplayConfig, width: parseInt(argv[++i], 10) };
        break;
      case '--height':
        config.display = { ...config.display as DisplayConfig, height: parseInt(argv[++i], 10) };
        break;
      case '--pixel-density':
        config.display = { ...config.display as DisplayConfig, pixelDensity: parseFloat(argv[++i]) };
        break;
      case '--color-depth':
        config.display = { ...config.display as DisplayConfig, colorDepth: parseInt(argv[++i], 10) };
        break;
      case '--features':
        config.features = argv[++i].split(',').map(f => f.trim()).filter(Boolean);
        break;
      case '--tls-cert':
        config.tls = { ...config.tls, cert: argv[++i] };
        break;
      case '--tls-key':
        config.tls = { ...config.tls, key: argv[++i] };
        break;
      case '--tls-ca':
        config.tls = { ...config.tls, ca: argv[++i] };
        break;
      case '--tls-insecure':
        config.tls = { ...config.tls, insecure: true };
        break;
      case '--session':
        config.session = { ...config.session, id: argv[++i] };
        break;
      case '--log-level':
        config.logLevel = argv[++i] as ViewerConfig['logLevel'];
        break;
      case '--max-connections':
        config.maxConnections = parseInt(argv[++i], 10);
        break;
      case '--config':
        configFilePath = argv[++i];
        break;
      case '--help':
      case '-h':
        help = true;
        break;
      default:
        // Unknown args are ignored (allow extension by downstream CLIs)
        break;
    }

    i++;
  }

  if (listenUris.length > 0) {
    config.listen = listenUris;
  }

  return { config, configFilePath, help };
}

// ── Config File Loading ──────────────────────────────────────────

/**
 * Load a ViewerConfig from a JSON config file.
 *
 * Config files are plain JSON matching the ViewerConfig schema.
 * Only the fields present in the file are returned (partial config).
 */
export async function loadConfigFile(path: string): Promise<Partial<ViewerConfig>> {
  const fs = await import('node:fs/promises');
  const content = await fs.readFile(path, 'utf-8');
  return JSON.parse(content) as Partial<ViewerConfig>;
}

/**
 * Search for a config file in standard locations.
 *
 * Checks (in order):
 *   1. VIEWPORT_CONFIG env var
 *   2. ./viewport.config.json (current directory)
 *   3. ~/.config/viewport/config.json (XDG)
 *
 * Returns the path of the first file found, or undefined.
 */
export async function findConfigFile(): Promise<string | undefined> {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const os = await import('node:os');

  const candidates: string[] = [];

  // Env var
  const envPath = process.env['VIEWPORT_CONFIG'];
  if (envPath) candidates.push(envPath);

  // Current directory
  candidates.push(path.join(process.cwd(), 'viewport.config.json'));

  // XDG config
  const xdgConfig = process.env['XDG_CONFIG_HOME'] || path.join(os.homedir(), '.config');
  candidates.push(path.join(xdgConfig, 'viewport', 'config.json'));

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }

  return undefined;
}

// ── Full Resolution ──────────────────────────────────────────────

/**
 * Resolve the complete viewer configuration from all sources.
 *
 * Merges: defaults → config file → CLI args
 */
export async function resolveViewerConfig(
  argv: string[] = process.argv.slice(2),
): Promise<ViewerConfig> {
  const cli = parseViewerArgs(argv);

  // Find and load config file
  const configPath = cli.configFilePath ?? await findConfigFile();
  let fileConfig: Partial<ViewerConfig> = {};
  if (configPath) {
    try {
      fileConfig = await loadConfigFile(configPath);
    } catch {
      // Config file not found or invalid — use defaults
    }
  }

  return mergeConfigs(fileConfig, cli.config);
}

// ── Environment Setup ────────────────────────────────────────────

/**
 * Build the environment variables that a viewer should set
 * when spawning a child app process.
 */
export function buildViewportEnv(
  viewportUri: string,
  config: ViewerConfig,
  session?: string,
): Record<string, string> {
  const env: Record<string, string> = {
    VIEWPORT: viewportUri,
    VIEWPORT_VERSION: '1',
  };

  if (config.features.length > 0) {
    env['VIEWPORT_FEATURES'] = config.features.join(',');
  }

  if (session) {
    env['VIEWPORT_SESSION'] = session;
  }

  return env;
}
