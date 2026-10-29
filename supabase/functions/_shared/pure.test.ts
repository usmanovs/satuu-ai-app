import { describe, expect, test } from 'vitest';
import { bearerToken, classifyN8nResponse, HttpError, isWithinServiceWindow, mapDbError, parseTimestamp, sha256Hex } from './pure';

describe('classifyN8nResponse: what may be shown as sent, failed, or unknown', () => {
  test('2xx is accepted (not delivered)', () => expect(classifyN8nResponse({ httpStatus: 200 })).toEqual({ status: 'accepted' }));
  test('4xx is a definite failure', () => {
    expect(classifyN8nResponse({ httpStatus: 400 }).status).toBe('failed');
    expect(classifyN8nResponse({ httpStatus: 401 }).status).toBe('failed');
  });
  test('5xx, 408 and network errors stay pending: n8n may have sent it, never auto-retry', () => {
    expect(classifyN8nResponse({ httpStatus: 500 }).status).toBe('pending');
    expect(classifyN8nResponse({ httpStatus: 503 }).status).toBe('pending');
    expect(classifyN8nResponse({ httpStatus: 408 }).status).toBe('pending');
    expect(classifyN8nResponse({ networkError: 'TimeoutError' }).status).toBe('pending');
  });
  test('a redirect is not success', () => expect(classifyN8nResponse({ httpStatus: 302 }).status).toBe('failed'));
});

describe('parseTimestamp', () => {
  test('unix seconds, unix ms, ISO', () => {
    expect(parseTimestamp('1793276163')).toBe('2026-10-29T12:16:03.000Z');
    expect(parseTimestamp(1793276163000)).toBe('2026-10-29T12:16:03.000Z');
    expect(parseTimestamp('2026-10-29T12:16:03Z')).toBe('2026-10-29T12:16:03.000Z');
  });
  test('absent is null, garbage is rejected', () => {
    expect(parseTimestamp(undefined)).toBeNull();
    expect(() => parseTimestamp('not-a-date')).toThrow(HttpError);
  });
});

describe('misc', () => {
  test('service window', () => {
    const now = Date.parse('2026-10-29T12:00:00Z');
    expect(isWithinServiceWindow('2026-10-28T13:00:00Z', now)).toBe(true);
    expect(isWithinServiceWindow('2026-10-28T11:59:00Z', now)).toBe(false);
    expect(isWithinServiceWindow(null, now)).toBe(false);
  });
  test('unknown DB errors never leak SQL text', () => {
    const e = mapDbError('insert or update on table "x" violates foreign key constraint');
    expect(e.status).toBe(500); expect(e.message).not.toMatch(/foreign key/);
    expect(mapDbError('window_closed').status).toBe(422);
    expect(mapDbError('not_human_handling').status).toBe(409);
  });
  test('bearer parsing and sha256', async () => {
    expect(bearerToken('Bearer abc')).toBe('abc');
    expect(bearerToken('Basic abc')).toBeNull();
    expect(bearerToken(null)).toBeNull();
    expect(await sha256Hex('test-key-A')).toMatch(/^[0-9a-f]{64}$/);
  });
});
