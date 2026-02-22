/**
 * Unit tests for VIEWPORT URI parsing and output mode resolution.
 */

import { describe, it, expect } from 'vitest';
import {
  parseViewportUri,
  resolveOutputMode,
  resolveAddress,
  isInteractive,
  isRichRendering,
  describeOutputMode,
  ViewportUriError,
} from '../../src/core/transport.js';
import type { OutputMode, TransportAddress } from '../../src/core/transport.js';

describe('parseViewportUri', () => {
  it('parses text: scheme', () => {
    const parsed = parseViewportUri('text:');
    expect(parsed.scheme).toBe('text');
    expect(parsed.authority).toBe('');
    expect(parsed.path).toBe('');
  });

  it('parses ansi: scheme', () => {
    const parsed = parseViewportUri('ansi:');
    expect(parsed.scheme).toBe('ansi');
  });

  it('parses ansi: with query params', () => {
    const parsed = parseViewportUri('ansi:?alt=false&fps=60');
    expect(parsed.scheme).toBe('ansi');
    expect(parsed.params['alt']).toBe('false');
    expect(parsed.params['fps']).toBe('60');
  });

  it('parses headless: scheme', () => {
    const parsed = parseViewportUri('headless:');
    expect(parsed.scheme).toBe('headless');
  });

  it('parses unix:// with path', () => {
    const parsed = parseViewportUri('unix:///run/user/1000/viewport/sess.sock');
    expect(parsed.scheme).toBe('unix');
    expect(parsed.path).toBe('/run/user/1000/viewport/sess.sock');
  });

  it('parses unix:// with percent-encoded path', () => {
    const parsed = parseViewportUri('unix:///tmp/my%20socket.sock');
    expect(parsed.scheme).toBe('unix');
    expect(parsed.path).toBe('/tmp/my socket.sock');
  });

  it('parses unix-abstract:// with name', () => {
    const parsed = parseViewportUri('unix-abstract://viewport-session-1234');
    expect(parsed.scheme).toBe('unix-abstract');
    expect(parsed.authority).toBe('viewport-session-1234');
  });

  it('parses fd:// with fd number', () => {
    const parsed = parseViewportUri('fd://3');
    expect(parsed.scheme).toBe('fd');
    expect(parsed.authority).toBe('3');
  });

  it('parses fd:// with duplex param', () => {
    const parsed = parseViewportUri('fd://3?duplex=true');
    expect(parsed.scheme).toBe('fd');
    expect(parsed.authority).toBe('3');
    expect(parsed.params['duplex']).toBe('true');
  });

  it('parses pipe:// as alias for fd', () => {
    const parsed = parseViewportUri('pipe://5');
    expect(parsed.scheme).toBe('pipe');
    expect(parsed.authority).toBe('5');
  });

  it('parses windows:// with name', () => {
    const parsed = parseViewportUri('windows://viewport-session');
    expect(parsed.scheme).toBe('windows');
    expect(parsed.authority).toBe('viewport-session');
  });

  it('parses tcp:// with host:port', () => {
    const parsed = parseViewportUri('tcp://localhost:9400');
    expect(parsed.scheme).toBe('tcp');
    expect(parsed.authority).toBe('localhost:9400');
  });

  it('parses tcp:// with IPv6', () => {
    const parsed = parseViewportUri('tcp://[::1]:9400');
    expect(parsed.scheme).toBe('tcp');
    expect(parsed.authority).toBe('[::1]:9400');
  });

  it('parses tls:// with host:port and params', () => {
    const parsed = parseViewportUri('tls://viewer.example.com:9400?ca=/path/to/ca.pem');
    expect(parsed.scheme).toBe('tls');
    expect(parsed.authority).toBe('viewer.example.com:9400');
    expect(parsed.params['ca']).toBe('/path/to/ca.pem');
  });

  it('parses ws:// with path', () => {
    const parsed = parseViewportUri('ws://localhost:9400/viewport');
    expect(parsed.scheme).toBe('ws');
    expect(parsed.authority).toBe('localhost:9400');
    expect(parsed.path).toBe('/viewport');
  });

  it('parses wss:// with token param', () => {
    const parsed = parseViewportUri('wss://viewer.example.com/viewport?token=abc123');
    expect(parsed.scheme).toBe('wss');
    expect(parsed.authority).toBe('viewer.example.com');
    expect(parsed.path).toBe('/viewport');
    expect(parsed.params['token']).toBe('abc123');
  });

  it('parses vsock:// with CID:port', () => {
    const parsed = parseViewportUri('vsock://2:5000');
    expect(parsed.scheme).toBe('vsock');
    expect(parsed.authority).toBe('2:5000');
  });

  it('parses launchd:// with service name', () => {
    const parsed = parseViewportUri('launchd://com.example.viewport');
    expect(parsed.scheme).toBe('launchd');
    expect(parsed.authority).toBe('com.example.viewport');
  });

  it('parses systemd:// with socket name', () => {
    const parsed = parseViewportUri('systemd://viewport.socket');
    expect(parsed.scheme).toBe('systemd');
    expect(parsed.authority).toBe('viewport.socket');
  });

  it('parses stdio: scheme', () => {
    const parsed = parseViewportUri('stdio:');
    expect(parsed.scheme).toBe('stdio');
  });

  it('throws on unknown scheme', () => {
    expect(() => parseViewportUri('ftp://host:21')).toThrow(ViewportUriError);
    expect(() => parseViewportUri('ftp://host:21')).toThrow('Unknown VIEWPORT scheme');
  });

  it('throws on missing scheme', () => {
    expect(() => parseViewportUri('/some/path')).toThrow(ViewportUriError);
    expect(() => parseViewportUri('/some/path')).toThrow('missing scheme');
  });

  it('trims whitespace', () => {
    const parsed = parseViewportUri('  text:  ');
    expect(parsed.scheme).toBe('text');
  });
});

describe('resolveAddress', () => {
  it('resolves unix path', () => {
    const parsed = parseViewportUri('unix:///tmp/viewport.sock');
    const addr = resolveAddress(parsed);
    expect(addr).toEqual({ type: 'path', path: '/tmp/viewport.sock' });
  });

  it('resolves unix-abstract name', () => {
    const parsed = parseViewportUri('unix-abstract://viewport-1234');
    const addr = resolveAddress(parsed);
    expect(addr).toEqual({ type: 'name', name: 'viewport-1234' });
  });

  it('resolves fd number', () => {
    const parsed = parseViewportUri('fd://3');
    const addr = resolveAddress(parsed);
    expect(addr).toEqual({ type: 'fd', fd: 3, duplex: false });
  });

  it('resolves fd with duplex', () => {
    const parsed = parseViewportUri('fd://7?duplex=true');
    const addr = resolveAddress(parsed);
    expect(addr).toEqual({ type: 'fd', fd: 7, duplex: true });
  });

  it('throws on invalid fd', () => {
    const parsed = parseViewportUri('fd://abc');
    expect(() => resolveAddress(parsed)).toThrow('Invalid file descriptor');
  });

  it('resolves tcp host:port', () => {
    const parsed = parseViewportUri('tcp://localhost:9400');
    const addr = resolveAddress(parsed);
    expect(addr).toEqual({ type: 'host', host: 'localhost', port: 9400 });
  });

  it('resolves tcp IPv6', () => {
    const parsed = parseViewportUri('tcp://[::1]:9400');
    const addr = resolveAddress(parsed);
    expect(addr).toEqual({ type: 'host', host: '::1', port: 9400 });
  });

  it('resolves tls host:port', () => {
    const parsed = parseViewportUri('tls://viewer.example.com:9400');
    const addr = resolveAddress(parsed);
    expect(addr).toEqual({ type: 'host', host: 'viewer.example.com', port: 9400 });
  });

  it('throws on tcp without port', () => {
    const parsed = parseViewportUri('tcp://localhost');
    expect(() => resolveAddress(parsed)).toThrow('Missing port');
  });

  it('resolves ws URL', () => {
    const parsed = parseViewportUri('ws://localhost:9400/viewport');
    const addr = resolveAddress(parsed);
    expect(addr).toEqual({ type: 'url', url: 'ws://localhost:9400/viewport' });
  });

  it('resolves wss URL', () => {
    const parsed = parseViewportUri('wss://viewer.example.com/viewport');
    const addr = resolveAddress(parsed);
    expect(addr).toEqual({ type: 'url', url: 'wss://viewer.example.com/viewport' });
  });

  it('resolves vsock CID:port', () => {
    const parsed = parseViewportUri('vsock://2:5000');
    const addr = resolveAddress(parsed);
    expect(addr).toEqual({ type: 'vsock', cid: 2, port: 5000 });
  });

  it('throws on malformed vsock', () => {
    const parsed = parseViewportUri('vsock://2');
    expect(() => resolveAddress(parsed)).toThrow('expected CID:port');
  });

  it('resolves windows named pipe', () => {
    const parsed = parseViewportUri('windows://viewport-session');
    const addr = resolveAddress(parsed);
    expect(addr).toEqual({ type: 'name', name: 'viewport-session' });
  });

  it('resolves launchd service name', () => {
    const parsed = parseViewportUri('launchd://com.example.viewport');
    const addr = resolveAddress(parsed);
    expect(addr).toEqual({ type: 'name', name: 'com.example.viewport' });
  });

  it('resolves stdio to none', () => {
    const parsed = parseViewportUri('stdio:');
    const addr = resolveAddress(parsed);
    expect(addr).toEqual({ type: 'none' });
  });

  it('resolves self-rendering to none', () => {
    expect(resolveAddress(parseViewportUri('text:'))).toEqual({ type: 'none' });
    expect(resolveAddress(parseViewportUri('ansi:'))).toEqual({ type: 'none' });
    expect(resolveAddress(parseViewportUri('headless:'))).toEqual({ type: 'none' });
  });
});

describe('resolveOutputMode', () => {
  it('auto-detects text mode when stdout is not a TTY', () => {
    const mode = resolveOutputMode({ viewport: undefined, stdoutIsTty: false });
    expect(mode).toEqual({ type: 'text' });
  });

  it('auto-detects ansi mode when stdout is a TTY', () => {
    const mode = resolveOutputMode({ viewport: undefined, stdoutIsTty: true });
    expect(mode).toEqual({ type: 'ansi', altScreen: true, fps: 30 });
  });

  it('auto-detects text mode when VIEWPORT is empty string', () => {
    const mode = resolveOutputMode({ viewport: '', stdoutIsTty: false });
    expect(mode).toEqual({ type: 'text' });
  });

  it('resolves text: to text mode', () => {
    const mode = resolveOutputMode({ viewport: 'text:' });
    expect(mode.type).toBe('text');
  });

  it('resolves headless: to headless mode', () => {
    const mode = resolveOutputMode({ viewport: 'headless:' });
    expect(mode.type).toBe('headless');
  });

  it('resolves ansi: to ansi mode with defaults', () => {
    const mode = resolveOutputMode({ viewport: 'ansi:' });
    expect(mode).toEqual({ type: 'ansi', altScreen: true, fps: 30 });
  });

  it('resolves ansi: with custom params', () => {
    const mode = resolveOutputMode({ viewport: 'ansi:?alt=false&fps=60' });
    expect(mode).toEqual({ type: 'ansi', altScreen: false, fps: 60 });
  });

  it('resolves unix:// to viewer mode', () => {
    const mode = resolveOutputMode({
      viewport: 'unix:///tmp/viewport.sock',
      features: 'gpu,canvas',
      version: '1',
      session: 'sess-123',
    });
    expect(mode.type).toBe('viewer');
    if (mode.type === 'viewer') {
      expect(mode.transport.scheme).toBe('unix');
      expect(mode.transport.address).toEqual({ type: 'path', path: '/tmp/viewport.sock' });
      expect(mode.transport.features).toEqual(['gpu', 'canvas']);
      expect(mode.transport.version).toBe(1);
      expect(mode.transport.session).toBe('sess-123');
    }
  });

  it('resolves tcp:// to viewer mode', () => {
    const mode = resolveOutputMode({ viewport: 'tcp://localhost:9400' });
    expect(mode.type).toBe('viewer');
    if (mode.type === 'viewer') {
      expect(mode.transport.scheme).toBe('tcp');
      expect(mode.transport.address).toEqual({ type: 'host', host: 'localhost', port: 9400 });
    }
  });

  it('resolves wss:// to viewer mode with params', () => {
    const mode = resolveOutputMode({
      viewport: 'wss://viewer.example.com/viewport?token=secret',
    });
    expect(mode.type).toBe('viewer');
    if (mode.type === 'viewer') {
      expect(mode.transport.scheme).toBe('wss');
      expect(mode.transport.address).toEqual({
        type: 'url',
        url: 'wss://viewer.example.com/viewport',
      });
      expect(mode.transport.params['token']).toBe('secret');
    }
  });

  it('resolves vsock:// to viewer mode', () => {
    const mode = resolveOutputMode({ viewport: 'vsock://2:5000' });
    expect(mode.type).toBe('viewer');
    if (mode.type === 'viewer') {
      expect(mode.transport.scheme).toBe('vsock');
      expect(mode.transport.address).toEqual({ type: 'vsock', cid: 2, port: 5000 });
    }
  });

  it('resolves fd:// to viewer mode', () => {
    const mode = resolveOutputMode({ viewport: 'fd://3?duplex=true' });
    expect(mode.type).toBe('viewer');
    if (mode.type === 'viewer') {
      expect(mode.transport.scheme).toBe('fd');
      expect(mode.transport.address).toEqual({ type: 'fd', fd: 3, duplex: true });
    }
  });

  it('resolves stdio: to viewer mode', () => {
    const mode = resolveOutputMode({ viewport: 'stdio:' });
    expect(mode.type).toBe('viewer');
    if (mode.type === 'viewer') {
      expect(mode.transport.scheme).toBe('stdio');
      expect(mode.transport.address).toEqual({ type: 'none' });
    }
  });

  it('defaults features to empty array', () => {
    const mode = resolveOutputMode({ viewport: 'tcp://localhost:9400' });
    if (mode.type === 'viewer') {
      expect(mode.transport.features).toEqual([]);
    }
  });

  it('defaults version to 1', () => {
    const mode = resolveOutputMode({ viewport: 'tcp://localhost:9400' });
    if (mode.type === 'viewer') {
      expect(mode.transport.version).toBe(1);
    }
  });
});

describe('isInteractive', () => {
  it('text mode is not interactive', () => {
    expect(isInteractive({ type: 'text' })).toBe(false);
  });

  it('ansi mode is interactive', () => {
    expect(isInteractive({ type: 'ansi', altScreen: true, fps: 30 })).toBe(true);
  });

  it('viewer mode is interactive', () => {
    const mode: OutputMode = {
      type: 'viewer',
      transport: {
        scheme: 'unix',
        uri: 'unix:///tmp/sock',
        address: { type: 'path', path: '/tmp/sock' },
        features: [],
        version: 1,
        params: {},
      },
    };
    expect(isInteractive(mode)).toBe(true);
  });

  it('headless mode is interactive', () => {
    expect(isInteractive({ type: 'headless' })).toBe(true);
  });
});

describe('isRichRendering', () => {
  it('text mode is not rich', () => {
    expect(isRichRendering({ type: 'text' })).toBe(false);
  });

  it('ansi mode is not rich', () => {
    expect(isRichRendering({ type: 'ansi', altScreen: true, fps: 30 })).toBe(false);
  });

  it('viewer mode with gpu feature is rich', () => {
    const mode: OutputMode = {
      type: 'viewer',
      transport: {
        scheme: 'unix',
        uri: 'unix:///tmp/sock',
        address: { type: 'path', path: '/tmp/sock' },
        features: ['gpu'],
        version: 1,
        params: {},
      },
    };
    expect(isRichRendering(mode)).toBe(true);
  });

  it('viewer mode without gpu/canvas is not rich', () => {
    const mode: OutputMode = {
      type: 'viewer',
      transport: {
        scheme: 'unix',
        uri: 'unix:///tmp/sock',
        address: { type: 'path', path: '/tmp/sock' },
        features: [],
        version: 1,
        params: {},
      },
    };
    expect(isRichRendering(mode)).toBe(false);
  });
});

describe('describeOutputMode', () => {
  it('describes text mode', () => {
    expect(describeOutputMode({ type: 'text' })).toBe('text (plain text line output)');
  });

  it('describes ansi mode', () => {
    expect(describeOutputMode({ type: 'ansi', altScreen: true, fps: 30 }))
      .toBe('ansi (embedded terminal renderer, 30fps)');
  });

  it('describes headless mode', () => {
    expect(describeOutputMode({ type: 'headless' })).toBe('headless (no output)');
  });

  it('describes viewer mode with unix socket', () => {
    const mode: OutputMode = {
      type: 'viewer',
      transport: {
        scheme: 'unix',
        uri: 'unix:///tmp/viewport.sock',
        address: { type: 'path', path: '/tmp/viewport.sock' },
        features: [],
        version: 1,
        params: {},
      },
    };
    expect(describeOutputMode(mode)).toBe('viewer via unix (/tmp/viewport.sock)');
  });

  it('describes viewer mode with tcp', () => {
    const mode: OutputMode = {
      type: 'viewer',
      transport: {
        scheme: 'tcp',
        uri: 'tcp://localhost:9400',
        address: { type: 'host', host: 'localhost', port: 9400 },
        features: [],
        version: 1,
        params: {},
      },
    };
    expect(describeOutputMode(mode)).toBe('viewer via tcp (localhost:9400)');
  });
});
