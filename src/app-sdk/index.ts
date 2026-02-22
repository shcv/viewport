export { defineApp, RecordingConnection } from './app.js';
export type { RecordedMessage } from './app.js';
export {
  box, text, scroll, input, separator, image, canvas,
  clickable, row, column, heading, label, muted,
  resetIdCounter,
} from './components.js';
export {
  resolveOutputMode,
  parseViewportUri,
  isInteractive,
  isRichRendering,
  describeOutputMode,
  ViewportUriError,
} from '../core/transport.js';
export type {
  OutputMode,
  TransportScheme,
  TransportInfo,
  TransportAddress,
  ParsedViewportUri,
} from '../core/transport.js';
export {
  createDefaultRegistry,
  createConnectionPair,
  createInProcessPair,
} from '../transports/index.js';
export type {
  TransportConnection,
  TransportConnector,
  TransportListener,
  ConnectOptions,
  ListenOptions,
  ListenResult,
  ConnectionInfo,
  SelfRenderDriver,
  SelfRenderOptions,
} from '../core/transport-api.js';
export { TransportRegistry } from '../core/transport-registry.js';
export {
  mergeConfigs,
  parseViewerArgs,
  resolveViewerConfig,
  buildViewportEnv,
  DEFAULT_CONFIG,
} from '../core/viewer-config.js';
export type {
  ViewerConfig,
  DisplayConfig,
  SessionConfig,
  ParsedCli,
} from '../core/viewer-config.js';
