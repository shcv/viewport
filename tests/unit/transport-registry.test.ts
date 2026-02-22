/**
 * Tests for the transport registry, modular transports, and viewer config.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TransportRegistry } from '../../src/core/transport-registry.js';
import { createConnectionPair, createInProcessPair } from '../../src/transports/in-process.js';
import { createDefaultRegistry } from '../../src/transports/index.js';
import {
  mergeConfigs,
  parseViewerArgs,
  buildViewportEnv,
  DEFAULT_CONFIG,
} from '../../src/core/viewer-config.js';
import type { TransportConnection } from '../../src/core/transport-api.js';
import type { ViewerConfig } from '../../src/core/viewer-config.js';

// ── In-Process Connection Pair ───────────────────────────────────

describe('createConnectionPair', () => {
  it('creates two connected ends', () => {
    const [a, b] = createConnectionPair();
    expect(a.connected).toBe(true);
    expect(b.connected).toBe(true);
  });

  it('delivers messages from A to B', () => {
    const [a, b] = createConnectionPair();
    const received: Uint8Array[] = [];
    b.onMessage((data) => received.push(data));

    const msg = new Uint8Array([1, 2, 3]);
    a.send(msg);

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(msg);
  });

  it('delivers messages from B to A', () => {
    const [a, b] = createConnectionPair();
    const received: Uint8Array[] = [];
    a.onMessage((data) => received.push(data));

    const msg = new Uint8Array([4, 5, 6]);
    b.send(msg);

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(msg);
  });

  it('delivers multiple messages in order', () => {
    const [a, b] = createConnectionPair();
    const received: Uint8Array[] = [];
    b.onMessage((data) => received.push(data));

    a.send(new Uint8Array([1]));
    a.send(new Uint8Array([2]));
    a.send(new Uint8Array([3]));

    expect(received).toHaveLength(3);
    expect(received[0]).toEqual(new Uint8Array([1]));
    expect(received[1]).toEqual(new Uint8Array([2]));
    expect(received[2]).toEqual(new Uint8Array([3]));
  });

  it('closing A closes B', () => {
    const [a, b] = createConnectionPair();
    let bClosed = false;
    b.onClose(() => { bClosed = true; });

    a.close();

    expect(a.connected).toBe(false);
    expect(b.connected).toBe(false);
    expect(bClosed).toBe(true);
  });

  it('throws when sending on closed connection', () => {
    const [a, b] = createConnectionPair();
    a.close();

    expect(() => a.send(new Uint8Array([1]))).toThrow('closed');
  });

  it('has correct connection info', () => {
    const [a, b] = createConnectionPair('tcp');
    expect(a.info.scheme).toBe('tcp');
    expect(a.info.remoteAddress).toContain('in-process');
    expect(a.info.connectedAt).toBeGreaterThan(0);
  });
});

// ── In-Process Pair (Connector + Listener) ───────────────────────

describe('createInProcessPair', () => {
  it('connector connects through listener', async () => {
    const { connector, listener } = createInProcessPair();

    const connections: TransportConnection[] = [];
    await listener.listen(
      { type: 'path', path: '/tmp/test.sock' },
      { uri: { scheme: 'unix', authority: '', path: '/tmp/test.sock', params: {}, raw: 'unix:///tmp/test.sock' } },
    );
    listener.onConnection((conn) => connections.push(conn));

    const appConn = await connector.connect(
      { type: 'path', path: '/tmp/test.sock' },
      { uri: { scheme: 'unix', authority: '', path: '/tmp/test.sock', params: {}, raw: 'unix:///tmp/test.sock' } },
    );

    expect(appConn.connected).toBe(true);
    expect(connections).toHaveLength(1);
    expect(connections[0].connected).toBe(true);
  });

  it('messages flow through connector/listener pair', async () => {
    const { connector, listener } = createInProcessPair();

    let viewerConn: TransportConnection | null = null;
    await listener.listen(
      { type: 'path', path: '/tmp/test.sock' },
      { uri: { scheme: 'unix', authority: '', path: '/tmp/test.sock', params: {}, raw: 'unix:///tmp/test.sock' } },
    );
    listener.onConnection((conn) => { viewerConn = conn; });

    const appConn = await connector.connect(
      { type: 'path', path: '/tmp/test.sock' },
      { uri: { scheme: 'unix', authority: '', path: '/tmp/test.sock', params: {}, raw: 'unix:///tmp/test.sock' } },
    );

    // App → Viewer
    const viewerReceived: Uint8Array[] = [];
    viewerConn!.onMessage((data) => viewerReceived.push(data));
    appConn.send(new Uint8Array([10, 20, 30]));
    expect(viewerReceived).toHaveLength(1);

    // Viewer → App
    const appReceived: Uint8Array[] = [];
    appConn.onMessage((data) => appReceived.push(data));
    viewerConn!.send(new Uint8Array([40, 50]));
    expect(appReceived).toHaveLength(1);
  });
});

// ── Transport Registry ───────────────────────────────────────────

describe('TransportRegistry', () => {
  it('starts empty', () => {
    const registry = new TransportRegistry();
    expect(registry.connectorSchemes).toEqual([]);
    expect(registry.listenerSchemes).toEqual([]);
  });

  it('registers and retrieves connectors', () => {
    const registry = new TransportRegistry();
    const { connector } = createInProcessPair();
    registry.registerConnector(connector);

    expect(registry.getConnector('unix')).toBe(connector);
    expect(registry.getConnector('tcp')).toBe(connector);
    expect(registry.getConnector('ws')).toBeUndefined();
  });

  it('registers and retrieves listeners', () => {
    const registry = new TransportRegistry();
    const { listener } = createInProcessPair();
    registry.registerListener(listener);

    expect(registry.getListener('unix')).toBe(listener);
    expect(registry.getListener('ws')).toBeUndefined();
  });

  it('connect() works with registered connector', async () => {
    const registry = new TransportRegistry();
    const { connector, listener } = createInProcessPair();
    registry.registerConnector(connector);
    registry.registerListener(listener);

    await registry.listen('unix:///tmp/test.sock');

    const viewerConns: TransportConnection[] = [];
    registry.onConnection((conn) => viewerConns.push(conn));

    const appConn = await registry.connect('unix:///tmp/test.sock');
    expect(appConn.connected).toBe(true);
    expect(viewerConns).toHaveLength(1);
  });

  it('connect() throws on unregistered scheme', async () => {
    const registry = new TransportRegistry();
    await expect(registry.connect('vsock://2:5000')).rejects.toThrow('No connector registered');
  });

  it('listen() throws on unregistered scheme', async () => {
    const registry = new TransportRegistry();
    await expect(registry.listen('vsock://2:5000')).rejects.toThrow('No listener registered');
  });

  it('closeAll() cleans up', async () => {
    const registry = new TransportRegistry();
    const { connector, listener } = createInProcessPair();
    registry.registerConnector(connector);
    registry.registerListener(listener);

    await registry.listen('unix:///tmp/test.sock');
    await registry.closeAll();
    // Should not throw
  });
});

// ── Default Registry ─────────────────────────────────────────────

describe('createDefaultRegistry', () => {
  it('has connectors for all standard schemes', () => {
    const registry = createDefaultRegistry();
    const schemes = registry.connectorSchemes;

    expect(schemes).toContain('unix');
    expect(schemes).toContain('unix-abstract');
    expect(schemes).toContain('tcp');
    expect(schemes).toContain('tls');
    expect(schemes).toContain('stdio');
    expect(schemes).toContain('fd');
    expect(schemes).toContain('pipe');
    expect(schemes).toContain('ws');
    expect(schemes).toContain('wss');
  });

  it('has listeners for socket-based schemes', () => {
    const registry = createDefaultRegistry();
    const schemes = registry.listenerSchemes;

    expect(schemes).toContain('unix');
    expect(schemes).toContain('tcp');
    expect(schemes).toContain('tls');
    expect(schemes).toContain('stdio');
    expect(schemes).toContain('ws');
    expect(schemes).toContain('wss');
  });
});

// ── Real Net Socket Transport ────────────────────────────────────

describe('NetSocketTransport (real TCP)', () => {
  let registry: TransportRegistry;

  beforeEach(() => {
    registry = createDefaultRegistry();
  });

  afterEach(async () => {
    await registry.closeAll();
  });

  it('connects and exchanges messages over TCP', async () => {
    // Listen on a random port
    const result = await registry.listen('tcp://127.0.0.1:0');
    expect(result.viewportUri).toMatch(/^tcp:\/\//);

    const viewerConns: TransportConnection[] = [];
    registry.onConnection((conn) => viewerConns.push(conn));

    // Connect to the listener
    const appConn = await registry.connect(result.viewportUri);
    expect(appConn.connected).toBe(true);

    // Wait for the connection to be accepted
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(viewerConns).toHaveLength(1);

    // Build a valid protocol frame (magic + version + type + length + payload)
    const payload = new Uint8Array([0x42]);
    const frame = new Uint8Array(9);
    frame[0] = 0x56; // V
    frame[1] = 0x50; // P
    frame[2] = 0x01; // version
    frame[3] = 0x02; // type (TREE)
    frame[4] = 0x01; // length LE (1 byte)
    frame[5] = 0x00;
    frame[6] = 0x00;
    frame[7] = 0x00;
    frame[8] = 0x42; // payload

    // App → Viewer
    const viewerReceived: Uint8Array[] = [];
    viewerConns[0].onMessage((data) => viewerReceived.push(data));
    appConn.send(frame);

    await new Promise(resolve => setTimeout(resolve, 50));
    expect(viewerReceived).toHaveLength(1);
    expect(viewerReceived[0]).toEqual(frame);

    // Viewer → App
    const appReceived: Uint8Array[] = [];
    appConn.onMessage((data) => appReceived.push(data));
    viewerConns[0].send(frame);

    await new Promise(resolve => setTimeout(resolve, 50));
    expect(appReceived).toHaveLength(1);
    expect(appReceived[0]).toEqual(frame);

    // Clean up
    appConn.close();
  });
});

// ── Viewer Config ────────────────────────────────────────────────

describe('ViewerConfig', () => {
  describe('mergeConfigs', () => {
    it('returns defaults when no overrides', () => {
      const config = mergeConfigs();
      expect(config).toEqual(DEFAULT_CONFIG);
    });

    it('overrides listen URIs', () => {
      const config = mergeConfigs({ listen: ['tcp://0.0.0.0:9400'] });
      expect(config.listen).toEqual(['tcp://0.0.0.0:9400']);
    });

    it('partially overrides display', () => {
      const config = mergeConfigs({ display: { width: 1920 } as any });
      expect(config.display.width).toBe(1920);
      expect(config.display.height).toBe(DEFAULT_CONFIG.display.height);
    });

    it('merges multiple sources in order', () => {
      const config = mergeConfigs(
        { display: { width: 1000 } as any },
        { display: { width: 2000, height: 1000 } as any },
      );
      expect(config.display.width).toBe(2000);
      expect(config.display.height).toBe(1000);
    });

    it('overrides features', () => {
      const config = mergeConfigs({ features: ['gpu', 'canvas'] });
      expect(config.features).toEqual(['gpu', 'canvas']);
    });

    it('sets TLS options', () => {
      const config = mergeConfigs({ tls: { cert: '/path/cert.pem', key: '/path/key.pem' } });
      expect(config.tls?.cert).toBe('/path/cert.pem');
    });

    it('sets session options', () => {
      const config = mergeConfigs({ session: { id: 'test-123', persistent: true } });
      expect(config.session?.id).toBe('test-123');
      expect(config.session?.persistent).toBe(true);
    });
  });

  describe('parseViewerArgs', () => {
    it('parses --listen', () => {
      const { config } = parseViewerArgs(['--listen', 'unix:///tmp/sock']);
      expect(config.listen).toEqual(['unix:///tmp/sock']);
    });

    it('supports multiple --listen flags', () => {
      const { config } = parseViewerArgs([
        '--listen', 'unix:///tmp/sock',
        '--listen', 'tcp://0.0.0.0:9400',
      ]);
      expect(config.listen).toEqual(['unix:///tmp/sock', 'tcp://0.0.0.0:9400']);
    });

    it('parses --width and --height', () => {
      const { config } = parseViewerArgs(['--width', '1920', '--height', '1080']);
      expect(config.display?.width).toBe(1920);
      expect(config.display?.height).toBe(1080);
    });

    it('parses --features', () => {
      const { config } = parseViewerArgs(['--features', 'gpu,canvas,audio']);
      expect(config.features).toEqual(['gpu', 'canvas', 'audio']);
    });

    it('parses TLS flags', () => {
      const { config } = parseViewerArgs([
        '--tls-cert', '/cert.pem',
        '--tls-key', '/key.pem',
        '--tls-ca', '/ca.pem',
        '--tls-insecure',
      ]);
      expect(config.tls?.cert).toBe('/cert.pem');
      expect(config.tls?.key).toBe('/key.pem');
      expect(config.tls?.ca).toBe('/ca.pem');
      expect(config.tls?.insecure).toBe(true);
    });

    it('parses --session', () => {
      const { config } = parseViewerArgs(['--session', 'sess-abc']);
      expect(config.session?.id).toBe('sess-abc');
    });

    it('parses --log-level', () => {
      const { config } = parseViewerArgs(['--log-level', 'debug']);
      expect(config.logLevel).toBe('debug');
    });

    it('parses --max-connections', () => {
      const { config } = parseViewerArgs(['--max-connections', '10']);
      expect(config.maxConnections).toBe(10);
    });

    it('parses --config path', () => {
      const { configFilePath } = parseViewerArgs(['--config', '/etc/viewport.json']);
      expect(configFilePath).toBe('/etc/viewport.json');
    });

    it('parses --help', () => {
      const { help } = parseViewerArgs(['--help']);
      expect(help).toBe(true);
    });

    it('ignores unknown args', () => {
      const { config } = parseViewerArgs(['--unknown', 'value', '--listen', 'tcp://localhost:9400']);
      expect(config.listen).toEqual(['tcp://localhost:9400']);
    });
  });

  describe('buildViewportEnv', () => {
    it('builds basic env vars', () => {
      const env = buildViewportEnv('unix:///tmp/sock', DEFAULT_CONFIG);
      expect(env['VIEWPORT']).toBe('unix:///tmp/sock');
      expect(env['VIEWPORT_VERSION']).toBe('1');
    });

    it('includes features when present', () => {
      const config: ViewerConfig = { ...DEFAULT_CONFIG, features: ['gpu', 'canvas'] };
      const env = buildViewportEnv('unix:///tmp/sock', config);
      expect(env['VIEWPORT_FEATURES']).toBe('gpu,canvas');
    });

    it('omits features when empty', () => {
      const env = buildViewportEnv('unix:///tmp/sock', DEFAULT_CONFIG);
      expect(env['VIEWPORT_FEATURES']).toBeUndefined();
    });

    it('includes session when provided', () => {
      const env = buildViewportEnv('unix:///tmp/sock', DEFAULT_CONFIG, 'sess-123');
      expect(env['VIEWPORT_SESSION']).toBe('sess-123');
    });
  });
});
