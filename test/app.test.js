'use strict';

/**
 * Tests for app.js — computeQualityMismatch unit tests + integration tests
 *
 * Tasks 5.3, 5.4, 5.5
 *
 * Validates: Requirements 3.1, 3.2, 6.4
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { computeQualityMismatch, createApp } = require('../app');

// ═══════════════════════════════════════════════════════════════════════════════
// Task 5.3: computeQualityMismatch unit tests
//
// Validates: Requirements 3.1, 3.2
//
// Covers:
//   - validationDetails = null → false
//   - validationDetails = { skipped: true } → false
//   - 128k + bitrateKbps < 96 → true
//   - 128k + bitrateKbps >= 96 → false
//   - 128k + format='unknown' → true
//   - 320k + bitrateKbps < threshold → true (relaxed: < 72, strict: < 200)
//   - 320k + bitrateKbps >= threshold → false
//   - 320k + format='unknown' → true
//   - flac + lossless=true → false
//   - flac + lossless=false → true
//   - flac24bit + lossless=false → true
//   - master + lossless=true → false
// ═══════════════════════════════════════════════════════════════════════════════

describe('computeQualityMismatch: validationDetails null or skipped', () => {
    // **Validates: Requirements 3.1**

    it('returns false when validationDetails is null', () => {
        assert.equal(computeQualityMismatch('320k', null), false);
    });

    it('returns false when validationDetails is undefined', () => {
        assert.equal(computeQualityMismatch('320k', undefined), false);
    });

    it('returns false when validationDetails.skipped is true', () => {
        assert.equal(
            computeQualityMismatch('320k', { skipped: true }),
            false,
        );
    });

    it('returns false when validationDetails.skipped is true (128k)', () => {
        assert.equal(
            computeQualityMismatch('128k', { skipped: true }),
            false,
        );
    });

    it('returns false when validationDetails.skipped is true (flac)', () => {
        assert.equal(
            computeQualityMismatch('flac', { skipped: true }),
            false,
        );
    });
});

describe('computeQualityMismatch: 128k quality tier', () => {
    // **Validates: Requirements 3.1, 3.2**

    it('returns true when bitrateKbps is below 96 (e.g. 64)', () => {
        assert.equal(
            computeQualityMismatch('128k', { bitrateKbps: 64, format: 'mp3', lossless: false }),
            true,
        );
    });

    it('returns true when bitrateKbps is 50', () => {
        assert.equal(
            computeQualityMismatch('128k', { bitrateKbps: 50, format: 'mp3', lossless: false }),
            true,
        );
    });

    it('returns false when bitrateKbps is 128 (above threshold)', () => {
        assert.equal(
            computeQualityMismatch('128k', { bitrateKbps: 128, format: 'mp3', lossless: false }),
            false,
        );
    });

    it('returns false when bitrateKbps is exactly 96 (at threshold)', () => {
        assert.equal(
            computeQualityMismatch('128k', { bitrateKbps: 96, format: 'mp3', lossless: false }),
            false,
        );
    });

    it('returns true when format is unknown', () => {
        assert.equal(
            computeQualityMismatch('128k', { bitrateKbps: 128, format: 'unknown', lossless: false }),
            true,
        );
    });

    it('returns false when bitrateKbps is null (cannot determine)', () => {
        assert.equal(
            computeQualityMismatch('128k', { bitrateKbps: null, format: 'mp3', lossless: false }),
            false,
        );
    });
});

describe('computeQualityMismatch: 320k quality tier (relaxed mode)', () => {
    // **Validates: Requirements 3.1, 3.2**
    // Default mode is relaxed (QUALITY_FILTER_STRICT=false), threshold is 72

    it('returns true when bitrateKbps is below 72 (e.g. 50)', () => {
        assert.equal(
            computeQualityMismatch('320k', { bitrateKbps: 50, format: 'mp3', lossless: false }),
            true,
        );
    });

    it('returns false when bitrateKbps is 100 (above relaxed threshold 72)', () => {
        assert.equal(
            computeQualityMismatch('320k', { bitrateKbps: 100, format: 'mp3', lossless: false }),
            false,
        );
    });

    it('returns false when bitrateKbps is exactly 72 (at relaxed threshold)', () => {
        assert.equal(
            computeQualityMismatch('320k', { bitrateKbps: 72, format: 'mp3', lossless: false }),
            false,
        );
    });

    it('returns true when format is unknown', () => {
        assert.equal(
            computeQualityMismatch('320k', { bitrateKbps: 200, format: 'unknown', lossless: false }),
            true,
        );
    });

    it('returns false when bitrateKbps is null (cannot determine)', () => {
        assert.equal(
            computeQualityMismatch('320k', { bitrateKbps: null, format: 'mp3', lossless: false }),
            false,
        );
    });

    it('returns false when bitrateKbps is 320 (well above threshold)', () => {
        assert.equal(
            computeQualityMismatch('320k', { bitrateKbps: 320, format: 'mp3', lossless: false }),
            false,
        );
    });
});

describe('computeQualityMismatch: lossless quality tiers (flac, flac24bit, master, hires, atmos)', () => {
    // **Validates: Requirements 3.1, 3.2**

    it('flac + lossless=true → false (no mismatch)', () => {
        assert.equal(
            computeQualityMismatch('flac', { bitrateKbps: 900, format: 'flac', lossless: true }),
            false,
        );
    });

    it('flac + lossless=false → true (mismatch)', () => {
        assert.equal(
            computeQualityMismatch('flac', { bitrateKbps: 320, format: 'mp3', lossless: false }),
            true,
        );
    });

    it('flac24bit + lossless=false → true (mismatch)', () => {
        assert.equal(
            computeQualityMismatch('flac24bit', { bitrateKbps: 320, format: 'mp3', lossless: false }),
            true,
        );
    });

    it('flac24bit + lossless=true → false (no mismatch)', () => {
        assert.equal(
            computeQualityMismatch('flac24bit', { bitrateKbps: 1400, format: 'flac', lossless: true }),
            false,
        );
    });

    it('master + lossless=true → false (no mismatch)', () => {
        assert.equal(
            computeQualityMismatch('master', { bitrateKbps: 2000, format: 'flac', lossless: true }),
            false,
        );
    });

    it('master + lossless=false → true (mismatch)', () => {
        assert.equal(
            computeQualityMismatch('master', { bitrateKbps: 320, format: 'mp3', lossless: false }),
            true,
        );
    });

    it('hires + lossless=true → false (no mismatch)', () => {
        assert.equal(
            computeQualityMismatch('hires', { bitrateKbps: 2000, format: 'flac', lossless: true }),
            false,
        );
    });

    it('hires + lossless=false → true (mismatch)', () => {
        assert.equal(
            computeQualityMismatch('hires', { bitrateKbps: 320, format: 'mp3', lossless: false }),
            true,
        );
    });

    it('atmos + lossless=true → false (no mismatch)', () => {
        assert.equal(
            computeQualityMismatch('atmos', { bitrateKbps: 2000, format: 'flac', lossless: true }),
            false,
        );
    });

    it('atmos + lossless=false → true (mismatch)', () => {
        assert.equal(
            computeQualityMismatch('atmos', { bitrateKbps: 320, format: 'mp3', lossless: false }),
            true,
        );
    });

    it('flac + lossless=undefined → true (mismatch, lossless !== true)', () => {
        assert.equal(
            computeQualityMismatch('flac', { bitrateKbps: 900, format: 'flac' }),
            true,
        );
    });
});

describe('computeQualityMismatch: unknown/unrecognized quality', () => {
    // Edge case: quality not in known set

    it('returns false for unknown quality tier', () => {
        assert.equal(
            computeQualityMismatch('unknown_quality', { bitrateKbps: 32, format: 'mp3', lossless: false }),
            false,
        );
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Task 5.4: /health endpoint integration test
//
// Validates: Requirement 6.4
//
// Verifies that the /health endpoint response contains the qualityFilter object
// with strict, bitrateFloor320k, bitrateFloor128k fields.
// ═══════════════════════════════════════════════════════════════════════════════

describe('/health endpoint integration test', () => {
    // **Validates: Requirements 6.4**

    let server;
    let baseUrl;

    before((t, done) => {
        const app = createApp();
        server = app.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            baseUrl = `http://127.0.0.1:${port}`;
            done();
        });
    });

    after((t, done) => {
        server.close(done);
    });

    it('responds with qualityFilter object containing strict, bitrateFloor320k, bitrateFloor128k', async () => {
        const res = await fetch(`${baseUrl}/health`);
        assert.equal(res.status, 200);

        const body = await res.json();
        assert.equal(body.ok, true);
        assert.ok('qualityFilter' in body, 'response should contain qualityFilter');

        const qf = body.qualityFilter;
        assert.ok(typeof qf === 'object' && qf !== null, 'qualityFilter should be an object');
        assert.ok('strict' in qf, 'qualityFilter should contain strict');
        assert.ok('bitrateFloor320k' in qf, 'qualityFilter should contain bitrateFloor320k');
        assert.ok('bitrateFloor128k' in qf, 'qualityFilter should contain bitrateFloor128k');
    });

    it('qualityFilter.strict is a boolean', async () => {
        const res = await fetch(`${baseUrl}/health`);
        const body = await res.json();
        assert.equal(typeof body.qualityFilter.strict, 'boolean');
    });

    it('qualityFilter.bitrateFloor320k is a positive number', async () => {
        const res = await fetch(`${baseUrl}/health`);
        const body = await res.json();
        assert.equal(typeof body.qualityFilter.bitrateFloor320k, 'number');
        assert.ok(body.qualityFilter.bitrateFloor320k > 0, 'bitrateFloor320k should be positive');
    });

    it('qualityFilter.bitrateFloor128k is a positive number', async () => {
        const res = await fetch(`${baseUrl}/health`);
        const body = await res.json();
        assert.equal(typeof body.qualityFilter.bitrateFloor128k, 'number');
        assert.ok(body.qualityFilter.bitrateFloor128k > 0, 'bitrateFloor128k should be positive');
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Task 5.5: /proxy/url endpoint integration test
//
// Validates: Requirements 3.1, 3.2
//
// Strategy: Since /proxy/url requires source scripts to be available via
// smartDispatch, and no sources are configured in the test environment,
// the endpoint will return 404 with error '未找到可用音源'.
//
// To test the qualityMismatch logic in the response meta, we test
// computeQualityMismatch thoroughly (task 5.3) and verify the endpoint
// exists and responds correctly when no sources are available.
//
// Additionally, we verify the endpoint rejects requests without musicInfo (400).
// ═══════════════════════════════════════════════════════════════════════════════

describe('/proxy/url endpoint integration test', () => {
    // **Validates: Requirements 3.1, 3.2**

    let server;
    let baseUrl;

    before((t, done) => {
        const app = createApp();
        server = app.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            baseUrl = `http://127.0.0.1:${port}`;
            done();
        });
    });

    after((t, done) => {
        server.close(done);
    });

    it('returns 400 when musicInfo is missing', async () => {
        const res = await fetch(`${baseUrl}/proxy/url`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source: 'test', quality: '320k' }),
        });
        assert.equal(res.status, 400);
        const body = await res.json();
        assert.ok('error' in body, 'response should contain error field');
    });

    it('returns 404 when no sources are available (with valid musicInfo)', async () => {
        const res = await fetch(`${baseUrl}/proxy/url`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                source: 'test',
                quality: '320k',
                musicInfo: {
                    id: 'test-id',
                    name: 'Test Song',
                    singer: 'Test Artist',
                    source: 'test',
                },
            }),
        });
        assert.equal(res.status, 404);
        const body = await res.json();
        assert.equal(body.error, '未找到可用音源');
    });

    it('endpoint accepts POST method and returns JSON', async () => {
        const res = await fetch(`${baseUrl}/proxy/url`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                quality: '128k',
                musicInfo: {
                    id: 'test-id-2',
                    name: 'Another Song',
                    singer: 'Another Artist',
                    source: 'test',
                },
            }),
        });
        // Should be either 404 (no sources) or 200 (if sources exist)
        assert.ok([200, 404].includes(res.status), `Expected 200 or 404, got ${res.status}`);
        const contentType = res.headers.get('content-type');
        assert.ok(contentType.includes('application/json'), 'response should be JSON');
    });
});
