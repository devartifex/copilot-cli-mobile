// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseMcpServers } from './handler.js';

describe('parseMcpServers', () => {
  it('returns undefined for non-array input', () => {
    expect(parseMcpServers(undefined)).toBeUndefined();
    expect(parseMcpServers(null)).toBeUndefined();
    expect(parseMcpServers('string')).toBeUndefined();
    expect(parseMcpServers(42)).toBeUndefined();
  });

  it('returns undefined for an empty array', () => {
    expect(parseMcpServers([])).toBeUndefined();
  });

  it('parses valid HTTP and SSE servers', () => {
    const result = parseMcpServers([
      { name: 'api', url: 'https://api.example.com/mcp', type: 'http', headers: { 'X-Key': 'k1' }, tools: ['search'] },
      { name: 'stream', url: 'https://stream.example.com/events', type: 'sse', headers: {}, tools: [] },
    ]);

    expect(result).toEqual([
      { name: 'api', url: 'https://api.example.com/mcp', type: 'http', headers: { 'X-Key': 'k1' }, tools: ['search'] },
      { name: 'stream', url: 'https://stream.example.com/events', type: 'sse', headers: {}, tools: [] },
    ]);
  });

  it('filters out servers with enabled === false', () => {
    const result = parseMcpServers([
      { name: 'active', url: 'https://a.example.com/mcp', type: 'http', headers: {}, tools: [], enabled: true },
      { name: 'disabled', url: 'https://b.example.com/mcp', type: 'http', headers: {}, tools: [], enabled: false },
    ]);

    expect(result).toEqual([
      { name: 'active', url: 'https://a.example.com/mcp', type: 'http', headers: {}, tools: [] },
    ]);
  });

  it('returns undefined when all servers are disabled', () => {
    const result = parseMcpServers([
      { name: 's1', url: 'https://a.example.com/mcp', type: 'http', headers: {}, tools: [], enabled: false },
      { name: 's2', url: 'https://b.example.com/mcp', type: 'sse', headers: {}, tools: [], enabled: false },
    ]);

    expect(result).toBeUndefined();
  });

  it('includes servers without an enabled field (defaults to enabled)', () => {
    const result = parseMcpServers([
      { name: 'no-flag', url: 'https://a.example.com/mcp', type: 'http', headers: {}, tools: [] },
    ]);

    expect(result).toHaveLength(1);
    expect(result![0].name).toBe('no-flag');
  });

  it('rejects entries with missing or invalid fields', () => {
    const result = parseMcpServers([
      null,
      { name: 'missing-url', type: 'http', headers: {}, tools: [] },
      { name: 'bad-type', url: 'https://a.example.com', type: 'grpc', headers: {}, tools: [] },
      { name: 'no-headers', url: 'https://a.example.com', type: 'http', tools: [] },
      { name: 'no-tools', url: 'https://a.example.com', type: 'http', headers: {} },
      'not-an-object',
    ]);

    expect(result).toBeUndefined();
  });

  it('limits to 10 servers', () => {
    const servers = Array.from({ length: 15 }, (_, i) => ({
      name: `server-${i}`,
      url: `https://s${i}.example.com/mcp`,
      type: 'http' as const,
      headers: {},
      tools: [],
    }));

    const result = parseMcpServers(servers);
    expect(result).toHaveLength(10);
    expect(result![9].name).toBe('server-9');
  });

  it('filters non-string values from tools arrays', () => {
    const result = parseMcpServers([
      { name: 'mixed-tools', url: 'https://a.example.com/mcp', type: 'http', headers: {}, tools: ['valid', 42, null, 'also-valid'] },
    ]);

    expect(result![0].tools).toEqual(['valid', 'also-valid']);
  });
});
