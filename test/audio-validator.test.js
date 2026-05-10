'use strict';

/**
 * Unit tests for scoreAudioCandidate() in lib/audio-validator.js
 *
 * Task 2.3: 为 scoreAudioCandidate 编写单元测试
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5
 *
 * Covers:
 *   - 320k + MP3 + 320kbps bitrate  → qualityAlignmentBonus >= 60
 *   - 320k + FLAC                   → losslessBonus = 0, qualityAlignmentBonus = 0
 *   - flac + FLAC                   → qualityAlignmentBonus >= 100
 *   - flac + MP3                    → qualityAlignmentBonus <= -100
 *   - 128k + 128kbps (96-160 range) → qualityAlignmentBonus >= 20
 *   - bitrateKbps = null            → bitrateBonus = 0, no crash
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { scoreAudioCandidate } = require('../lib/audio-validator');

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a minimal formatInfo object for MP3.
 * @param {number|null} bitrateKbps
 * @param {object} extra - additional fields to merge
 */
function mp3FormatInfo(bitrateKbps = null, extra = {}) {
    return { format: 'mp3', lossless: false, bitrateKbps, ...extra };
}

/**
 * Build a minimal formatInfo object for FLAC.
 * @param {object} extra - additional fields to merge
 */
function flacFormatInfo(extra = {}) {
    return { format: 'flac', lossless: true, ...extra };
}

// ── Scenario 1: 320k + MP3 + 320kbps ─────────────────────────────────────────
//
// Validates: Requirement 2.1
// When RequestedQuality is '320k' and the candidate is MP3 with bitrate >= 256kbps,
// qualityAlignmentBonus must be >= 60.

describe('scoreAudioCandidate: 320k + MP3 + 320kbps (high-bitrate MP3)', () => {

    it('qualityAlignmentBonus >= 60 for 320k MP3 at 320kbps', () => {
        // **Validates: Requirements 2.1**
        const { score, breakdown } = scoreAudioCandidate({
            quality: '320k',
            formatInfo: mp3FormatInfo(320),
            bitrateKbps: 320,
        });

        assert.ok(
            breakdown.qualityAlignmentBonus >= 60,
            `qualityAlignmentBonus should be >= 60, got ${breakdown.qualityAlignmentBonus}`,
        );
        assert.equal(breakdown.formatBase, 200, 'MP3 formatBase should be 200');
        assert.equal(breakdown.bitrateBonus, 32, 'bitrateBonus should be 320/10 = 32');
        assert.equal(breakdown.total, score, 'score should equal breakdown.total');
    });

    it('qualityAlignmentBonus >= 60 for 320k MP3 at 256kbps (boundary)', () => {
        // **Validates: Requirements 2.1**
        const { breakdown } = scoreAudioCandidate({
            quality: '320k',
            formatInfo: mp3FormatInfo(256),
            bitrateKbps: 256,
        });

        assert.ok(
            breakdown.qualityAlignmentBonus >= 60,
            `qualityAlignmentBonus should be >= 60 at 256kbps boundary, got ${breakdown.qualityAlignmentBonus}`,
        );
    });

    it('breakdown contains all required fields', () => {
        // **Validates: Requirements 2.5**
        const { breakdown } = scoreAudioCandidate({
            quality: '320k',
            formatInfo: mp3FormatInfo(320),
            bitrateKbps: 320,
        });

        const requiredFields = [
            'formatBase',
            'losslessBonus',
            'bitrateBonus',
            'qualityAlignmentBonus',
            'sampleRateAdjust',
            'bitsPerSampleBonus',
            'total',
        ];
        for (const field of requiredFields) {
            assert.ok(
                field in breakdown,
                `breakdown should contain field "${field}"`,
            );
            assert.equal(
                typeof breakdown[field],
                'number',
                `breakdown.${field} should be a number`,
            );
        }
    });
});

// ── Scenario 2: 320k + FLAC ───────────────────────────────────────────────────
//
// Validates: Requirement 2.2
// When RequestedQuality is '320k' and the candidate is lossless (FLAC),
// losslessBonus must be 0 (no lossless bonus for 320k requests),
// and qualityAlignmentBonus must be 0 (no alignment bonus for lossless with 320k).

describe('scoreAudioCandidate: 320k + FLAC (lossless format, lossy request)', () => {

    it('losslessBonus = 0 for 320k request with FLAC format', () => {
        // **Validates: Requirements 2.2**
        const { breakdown } = scoreAudioCandidate({
            quality: '320k',
            formatInfo: flacFormatInfo(),
            bitrateKbps: 900,
        });

        assert.equal(
            breakdown.losslessBonus,
            0,
            `losslessBonus should be 0 for 320k request, got ${breakdown.losslessBonus}`,
        );
    });

    it('qualityAlignmentBonus = 0 for 320k request with FLAC format', () => {
        // **Validates: Requirements 2.2**
        const { breakdown } = scoreAudioCandidate({
            quality: '320k',
            formatInfo: flacFormatInfo(),
            bitrateKbps: 900,
        });

        assert.equal(
            breakdown.qualityAlignmentBonus,
            0,
            `qualityAlignmentBonus should be 0 for 320k+FLAC, got ${breakdown.qualityAlignmentBonus}`,
        );
    });

    it('formatBase = 500 for FLAC format', () => {
        const { breakdown } = scoreAudioCandidate({
            quality: '320k',
            formatInfo: flacFormatInfo(),
            bitrateKbps: 900,
        });

        assert.equal(breakdown.formatBase, 500, 'FLAC formatBase should be 500');
    });
});

// ── Scenario 3: flac + FLAC ───────────────────────────────────────────────────
//
// Validates: Requirement 2.3
// When RequestedQuality is 'flac' and the candidate is lossless (FLAC),
// qualityAlignmentBonus must be >= 100.

describe('scoreAudioCandidate: flac + FLAC (lossless request, lossless format)', () => {

    it('qualityAlignmentBonus >= 100 for flac request with FLAC format', () => {
        // **Validates: Requirements 2.3**
        const { breakdown } = scoreAudioCandidate({
            quality: 'flac',
            formatInfo: flacFormatInfo(),
            bitrateKbps: 900,
        });

        assert.ok(
            breakdown.qualityAlignmentBonus >= 100,
            `qualityAlignmentBonus should be >= 100 for flac+FLAC, got ${breakdown.qualityAlignmentBonus}`,
        );
    });

    it('losslessBonus = 120 for flac request with FLAC format', () => {
        // **Validates: Requirements 2.3**
        // For lossless requests, the lossless bonus is NOT suppressed
        const { breakdown } = scoreAudioCandidate({
            quality: 'flac',
            formatInfo: flacFormatInfo(),
            bitrateKbps: 900,
        });

        assert.equal(
            breakdown.losslessBonus,
            120,
            `losslessBonus should be 120 for flac+FLAC, got ${breakdown.losslessBonus}`,
        );
    });

    it('total score is sum of all breakdown fields', () => {
        const { score, breakdown } = scoreAudioCandidate({
            quality: 'flac',
            formatInfo: flacFormatInfo(),
            bitrateKbps: 900,
        });

        const expectedTotal = Math.round(
            breakdown.formatBase
            + breakdown.losslessBonus
            + breakdown.bitrateBonus
            + breakdown.qualityAlignmentBonus
            + breakdown.sampleRateAdjust
            + breakdown.bitsPerSampleBonus,
        );
        assert.equal(breakdown.total, expectedTotal, 'total should equal sum of all breakdown fields');
        assert.equal(score, breakdown.total, 'score should equal breakdown.total');
    });

    it('qualityAlignmentBonus >= 100 for other lossless qualities (flac24bit, master, hires, atmos)', () => {
        // **Validates: Requirements 2.3**
        const losslessQualities = ['flac24bit', 'master', 'hires', 'atmos'];
        for (const quality of losslessQualities) {
            const { breakdown } = scoreAudioCandidate({
                quality,
                formatInfo: flacFormatInfo(),
                bitrateKbps: 900,
            });
            assert.ok(
                breakdown.qualityAlignmentBonus >= 100,
                `qualityAlignmentBonus should be >= 100 for ${quality}+FLAC, got ${breakdown.qualityAlignmentBonus}`,
            );
        }
    });
});

// ── Scenario 4: flac + MP3 ────────────────────────────────────────────────────
//
// Validates: Requirement 2.3
// When RequestedQuality is 'flac' and the candidate is lossy (MP3),
// qualityAlignmentBonus must be <= -100.

describe('scoreAudioCandidate: flac + MP3 (lossless request, lossy format)', () => {

    it('qualityAlignmentBonus <= -100 for flac request with MP3 format', () => {
        // **Validates: Requirements 2.3**
        const { breakdown } = scoreAudioCandidate({
            quality: 'flac',
            formatInfo: mp3FormatInfo(320),
            bitrateKbps: 320,
        });

        assert.ok(
            breakdown.qualityAlignmentBonus <= -100,
            `qualityAlignmentBonus should be <= -100 for flac+MP3, got ${breakdown.qualityAlignmentBonus}`,
        );
    });

    it('losslessBonus = 0 for MP3 format (not lossless)', () => {
        const { breakdown } = scoreAudioCandidate({
            quality: 'flac',
            formatInfo: mp3FormatInfo(320),
            bitrateKbps: 320,
        });

        assert.equal(
            breakdown.losslessBonus,
            0,
            `losslessBonus should be 0 for MP3 format, got ${breakdown.losslessBonus}`,
        );
    });

    it('qualityAlignmentBonus <= -100 for other lossless qualities with MP3', () => {
        // **Validates: Requirements 2.3**
        const losslessQualities = ['flac24bit', 'master', 'hires', 'atmos'];
        for (const quality of losslessQualities) {
            const { breakdown } = scoreAudioCandidate({
                quality,
                formatInfo: mp3FormatInfo(320),
                bitrateKbps: 320,
            });
            assert.ok(
                breakdown.qualityAlignmentBonus <= -100,
                `qualityAlignmentBonus should be <= -100 for ${quality}+MP3, got ${breakdown.qualityAlignmentBonus}`,
            );
        }
    });
});

// ── Scenario 5: 128k + 128kbps (mid-range bitrate) ───────────────────────────
//
// Validates: Requirement 2.4
// When RequestedQuality is '128k' and the candidate bitrate is in 96-160kbps range,
// qualityAlignmentBonus must be >= 20.

describe('scoreAudioCandidate: 128k + mid-range bitrate (96-160kbps)', () => {

    it('qualityAlignmentBonus >= 20 for 128k request with 128kbps MP3', () => {
        // **Validates: Requirements 2.4**
        const { breakdown } = scoreAudioCandidate({
            quality: '128k',
            formatInfo: mp3FormatInfo(128),
            bitrateKbps: 128,
        });

        assert.ok(
            breakdown.qualityAlignmentBonus >= 20,
            `qualityAlignmentBonus should be >= 20 for 128k+128kbps, got ${breakdown.qualityAlignmentBonus}`,
        );
    });

    it('qualityAlignmentBonus >= 20 for 128k request with 96kbps (lower boundary)', () => {
        // **Validates: Requirements 2.4**
        const { breakdown } = scoreAudioCandidate({
            quality: '128k',
            formatInfo: mp3FormatInfo(96),
            bitrateKbps: 96,
        });

        assert.ok(
            breakdown.qualityAlignmentBonus >= 20,
            `qualityAlignmentBonus should be >= 20 at 96kbps boundary, got ${breakdown.qualityAlignmentBonus}`,
        );
    });

    it('qualityAlignmentBonus >= 20 for 128k request with 160kbps (upper boundary)', () => {
        // **Validates: Requirements 2.4**
        const { breakdown } = scoreAudioCandidate({
            quality: '128k',
            formatInfo: mp3FormatInfo(160),
            bitrateKbps: 160,
        });

        assert.ok(
            breakdown.qualityAlignmentBonus >= 20,
            `qualityAlignmentBonus should be >= 20 at 160kbps boundary, got ${breakdown.qualityAlignmentBonus}`,
        );
    });

    it('bitrateBonus = 12.8 for 128kbps (bitrateKbps / 10)', () => {
        const { breakdown } = scoreAudioCandidate({
            quality: '128k',
            formatInfo: mp3FormatInfo(128),
            bitrateKbps: 128,
        });

        assert.equal(
            breakdown.bitrateBonus,
            12.8,
            `bitrateBonus should be 128/10 = 12.8, got ${breakdown.bitrateBonus}`,
        );
    });
});

// ── Scenario 6: bitrateKbps = null ───────────────────────────────────────────
//
// Validates: Requirement 2.4 (no crash), Requirement 1.4 (bitrateKbps null handling)
// When bitrateKbps is null, bitrateBonus must be 0 and the function must not crash.

describe('scoreAudioCandidate: bitrateKbps = null (unknown bitrate)', () => {

    it('does not throw when bitrateKbps is null', () => {
        assert.doesNotThrow(() => {
            scoreAudioCandidate({
                quality: '320k',
                formatInfo: mp3FormatInfo(null),
                bitrateKbps: null,
            });
        }, 'scoreAudioCandidate should not throw when bitrateKbps is null');
    });

    it('bitrateBonus = 0 when bitrateKbps is null', () => {
        const { breakdown } = scoreAudioCandidate({
            quality: '320k',
            formatInfo: mp3FormatInfo(null),
            bitrateKbps: null,
        });

        assert.equal(
            breakdown.bitrateBonus,
            0,
            `bitrateBonus should be 0 when bitrateKbps is null, got ${breakdown.bitrateBonus}`,
        );
    });

    it('qualityAlignmentBonus = 0 for 320k+MP3 when bitrateKbps is null (cannot confirm alignment)', () => {
        // **Validates: Requirements 2.1**
        // Without a known bitrate, we cannot confirm >= 256kbps, so no alignment bonus
        const { breakdown } = scoreAudioCandidate({
            quality: '320k',
            formatInfo: mp3FormatInfo(null),
            bitrateKbps: null,
        });

        assert.equal(
            breakdown.qualityAlignmentBonus,
            0,
            `qualityAlignmentBonus should be 0 for 320k+MP3 with null bitrate, got ${breakdown.qualityAlignmentBonus}`,
        );
    });

    it('does not throw for flac quality with null bitrateKbps', () => {
        assert.doesNotThrow(() => {
            scoreAudioCandidate({
                quality: 'flac',
                formatInfo: flacFormatInfo(),
                bitrateKbps: null,
            });
        });
    });

    it('does not throw for 128k quality with null bitrateKbps', () => {
        assert.doesNotThrow(() => {
            scoreAudioCandidate({
                quality: '128k',
                formatInfo: mp3FormatInfo(null),
                bitrateKbps: null,
            });
        });
    });

    it('bitrateBonus = 0 for flac+FLAC with null bitrateKbps', () => {
        const { breakdown } = scoreAudioCandidate({
            quality: 'flac',
            formatInfo: flacFormatInfo(),
            bitrateKbps: null,
        });

        assert.equal(
            breakdown.bitrateBonus,
            0,
            `bitrateBonus should be 0 when bitrateKbps is null, got ${breakdown.bitrateBonus}`,
        );
    });

    it('qualityAlignmentBonus still applies for flac+FLAC even with null bitrateKbps', () => {
        // **Validates: Requirements 2.3**
        // Lossless alignment bonus is based on format, not bitrate
        const { breakdown } = scoreAudioCandidate({
            quality: 'flac',
            formatInfo: flacFormatInfo(),
            bitrateKbps: null,
        });

        assert.ok(
            breakdown.qualityAlignmentBonus >= 100,
            `qualityAlignmentBonus should be >= 100 for flac+FLAC even with null bitrate, got ${breakdown.qualityAlignmentBonus}`,
        );
    });
});

// ── Return value structure ────────────────────────────────────────────────────
//
// Validates: Requirement 2.5
// scoreAudioCandidate must always return { score: number, breakdown: ScoringBreakdown }

describe('scoreAudioCandidate: return value structure', () => {

    it('always returns { score, breakdown } with correct types', () => {
        // **Validates: Requirements 2.5**
        const result = scoreAudioCandidate({
            quality: '320k',
            formatInfo: mp3FormatInfo(320),
            bitrateKbps: 320,
        });

        assert.ok(result !== null && typeof result === 'object', 'result should be an object');
        assert.equal(typeof result.score, 'number', 'score should be a number');
        assert.ok(Number.isFinite(result.score), 'score should be finite');
        assert.ok(result.breakdown !== null && typeof result.breakdown === 'object', 'breakdown should be an object');
    });

    it('score equals breakdown.total', () => {
        // **Validates: Requirements 2.5**
        const scenarios = [
            { quality: '320k', formatInfo: mp3FormatInfo(320), bitrateKbps: 320 },
            { quality: '320k', formatInfo: flacFormatInfo(), bitrateKbps: 900 },
            { quality: 'flac', formatInfo: flacFormatInfo(), bitrateKbps: 900 },
            { quality: 'flac', formatInfo: mp3FormatInfo(320), bitrateKbps: 320 },
            { quality: '128k', formatInfo: mp3FormatInfo(128), bitrateKbps: 128 },
            { quality: '320k', formatInfo: mp3FormatInfo(null), bitrateKbps: null },
        ];

        for (const scenario of scenarios) {
            const { score, breakdown } = scoreAudioCandidate(scenario);
            assert.equal(
                score,
                breakdown.total,
                `score (${score}) should equal breakdown.total (${breakdown.total}) for quality=${scenario.quality}`,
            );
        }
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Task 2.7: validateAudioUrlCandidate unit tests
//
// Validates: Requirements 1.4, 1.5, 2.5
//
// Covers:
//   - Success result contains qualityAlignmentBonus (number) and scoringBreakdown (object)
//   - bitrate_too_low failure result contains bitrateKbps, minBitrateKbps, format
//   - null bitrate does NOT return reason: 'bitrate_too_low'
//
// Strategy: spin up a minimal node:http server that serves crafted audio bytes,
// so validateAudioUrlCandidate makes real HTTP calls to localhost — no module
// mocking required, works in CommonJS.
// ═══════════════════════════════════════════════════════════════════════════════

const http = require('node:http');
const { describe: describeV, it: itV, before, after } = require('node:test');

const { validateAudioUrlCandidate } = require('../lib/audio-validator');

// ── Audio buffer helpers ──────────────────────────────────────────────────────

/**
 * Build a buffer that starts with a valid MPEG1 Layer3 frame header.
 * bitrateIndex values (MPEG1 Layer3):
 *   1=32, 2=40, 3=48, 4=56, 5=64, 6=80, 7=96, 8=112, 9=128,
 *   10=160, 11=192, 12=224, 13=256, 14=320
 * sampleRateIndex 0 → 44100 Hz
 *
 * Uses 512KB so estimated duration > 12s at low bitrates and avoids
 * file_too_small / duration_too_short rejections.
 */
function buildMp3Buffer(bitrateIndex) {
    const buf = Buffer.alloc(512 * 1024, 0);
    buf[0] = 0xFF;
    buf[1] = 0xFB; // sync + MPEG1 + Layer3 + no CRC
    buf[2] = (bitrateIndex << 4) | 0x00; // sampleRateIndex=0 (44100Hz)
    buf[3] = 0xC4;
    return buf;
}

/**
 * Build a buffer that starts with the FLAC magic bytes.
 * FLAC has no per-frame bitrate field, so bitrateKbps will be null
 * unless content-length + duration are both provided.
 *
 * Uses 512KB to avoid file_too_small rejection.
 */
function buildFlacBuffer() {
    const buf = Buffer.alloc(512 * 1024, 0);
    buf.write('fLaC', 0, 'ascii');
    return buf;
}

// ── Minimal HTTP test server ──────────────────────────────────────────────────

/**
 * Start a one-shot HTTP server that responds with the given audio bytes.
 * Returns { url, server } — call server.close() when done.
 *
 * @param {object} opts
 * @param {Buffer}  opts.body          - audio bytes to serve
 * @param {string}  [opts.contentType] - Content-Type header
 * @param {number}  [opts.contentLength] - Content-Length header (omit to leave null)
 * @param {number}  [opts.status]      - HTTP status code (default 200)
 */
function startAudioServer({ body, contentType = 'audio/mpeg', contentLength = null, status = 200 }) {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            const headers = { 'Content-Type': contentType, 'Connection': 'close' };
            if (contentLength != null) headers['Content-Length'] = String(contentLength);
            res.writeHead(status, headers);
            res.end(body);
        });
        server.listen(0, '127.0.0.1', () => {
            resolve({ server });
        });
    });
}

// ── Suite 1: success result structure ────────────────────────────────────────

describeV('validateAudioUrlCandidate: success result structure', () => {
    // **Validates: Requirements 2.5, 6.1**
    // A passing candidate must include qualityAlignmentBonus and scoringBreakdown in details.
    // Strategy: make ONE HTTP request in before() and share the result across all tests.

    let server;
    let successResult;

    before(async () => {
        // 320kbps MP3 (bitrateIndex=14), buffer is 512KB which gives ~13s estimated duration
        const body = buildMp3Buffer(14);
        ({ server } = await startAudioServer({
            body,
            contentType: 'audio/mpeg',
            contentLength: body.length,
        }));
        const { port } = server.address();
        const audioUrl = `http://127.0.0.1:${port}/audio`;
        successResult = await validateAudioUrlCandidate(audioUrl, { quality: '320k' });
    });

    after(() => {
        server.close();
    });

    itV('result.ok is true for a valid 320kbps MP3', () => {
        // **Validates: Requirements 2.5**
        assert.equal(
            successResult.ok,
            true,
            `Expected ok=true, got ok=${successResult.ok}, reason=${successResult.reason}`,
        );
    });

    itV('details.qualityAlignmentBonus is a number', () => {
        // **Validates: Requirements 2.5**
        assert.equal(successResult.ok, true, `Expected ok=true, got reason=${successResult.reason}`);
        assert.equal(
            typeof successResult.details.qualityAlignmentBonus,
            'number',
            `qualityAlignmentBonus should be a number, got ${typeof successResult.details.qualityAlignmentBonus}`,
        );
    });

    itV('details.scoringBreakdown is an object with required fields', () => {
        // **Validates: Requirements 2.5, 6.1**
        assert.equal(successResult.ok, true, `Expected ok=true, got reason=${successResult.reason}`);

        const bd = successResult.details.scoringBreakdown;
        assert.ok(bd !== null && typeof bd === 'object', 'scoringBreakdown should be an object');

        const requiredFields = ['formatBase', 'losslessBonus', 'bitrateBonus', 'qualityAlignmentBonus', 'total'];
        for (const field of requiredFields) {
            assert.ok(field in bd, `scoringBreakdown should contain field "${field}"`);
            assert.equal(typeof bd[field], 'number', `scoringBreakdown.${field} should be a number`);
        }
    });

    itV('details.qualityAlignmentBonus matches scoringBreakdown.qualityAlignmentBonus', () => {
        // **Validates: Requirements 2.5**
        assert.equal(successResult.ok, true, `Expected ok=true, got reason=${successResult.reason}`);
        assert.equal(
            successResult.details.qualityAlignmentBonus,
            successResult.details.scoringBreakdown.qualityAlignmentBonus,
            'details.qualityAlignmentBonus should equal scoringBreakdown.qualityAlignmentBonus',
        );
    });
});

// ── Suite 2: bitrate_too_low failure details ──────────────────────────────────

describeV('validateAudioUrlCandidate: bitrate_too_low failure details', () => {
    // **Validates: Requirements 1.5**
    // When a candidate is rejected for low bitrate, details must contain
    // bitrateKbps, minBitrateKbps, and format.
    // Strategy: make ONE HTTP request in before() and share the result across all tests.

    let server;
    let lowBitrateResult;

    before(async () => {
        // 32kbps MP3 (bitrateIndex=1) — below the 72kbps relaxed floor for 320k.
        // Buffer is 512KB which gives ~131s estimated duration at 32kbps, passing all checks.
        const body = buildMp3Buffer(1);
        ({ server } = await startAudioServer({
            body,
            contentType: 'audio/mpeg',
            contentLength: body.length,
        }));
        const { port } = server.address();
        const audioUrl = `http://127.0.0.1:${port}/audio`;
        lowBitrateResult = await validateAudioUrlCandidate(
            audioUrl,
            { quality: '320k' },
        );
    });

    after(() => {
        server.close();
    });

    itV('returns ok=false with reason bitrate_too_low for 32kbps MP3 with 320k quality', () => {
        // **Validates: Requirements 1.1, 1.5**
        assert.equal(lowBitrateResult.ok, false, 'Expected ok=false');
        assert.equal(
            lowBitrateResult.reason,
            'bitrate_too_low',
            `Expected reason=bitrate_too_low, got ${lowBitrateResult.reason}`,
        );
    });

    itV('bitrate_too_low details contains bitrateKbps', () => {
        // **Validates: Requirements 1.5**
        assert.equal(lowBitrateResult.reason, 'bitrate_too_low');
        assert.ok('bitrateKbps' in lowBitrateResult.details, 'details should contain bitrateKbps');
    });

    itV('bitrate_too_low details contains minBitrateKbps', () => {
        // **Validates: Requirements 1.5**
        assert.equal(lowBitrateResult.reason, 'bitrate_too_low');
        assert.ok('minBitrateKbps' in lowBitrateResult.details, 'details should contain minBitrateKbps');
        assert.equal(
            typeof lowBitrateResult.details.minBitrateKbps,
            'number',
            'minBitrateKbps should be a number',
        );
    });

    itV('bitrate_too_low details contains format', () => {
        // **Validates: Requirements 1.5**
        assert.equal(lowBitrateResult.reason, 'bitrate_too_low');
        assert.ok('format' in lowBitrateResult.details, 'details should contain format');
        assert.equal(typeof lowBitrateResult.details.format, 'string', 'format should be a string');
    });
});

// ── Suite 3: null bitrate does not trigger bitrate_too_low ───────────────────

describeV('validateAudioUrlCandidate: null bitrate does not trigger bitrate_too_low', () => {
    // **Validates: Requirements 1.4**
    // When bitrateKbps cannot be determined (FLAC magic bytes, no content-length,
    // no musicInfo.duration), the validator must NOT return reason: 'bitrate_too_low'.
    // Strategy: make TWO HTTP requests in before() (one per quality) and share results.

    let server;
    let result320k;
    let resultFlac;

    before(async () => {
        // FLAC buffer: no per-frame bitrate. With Content-Length matching the 512KB buffer,
        // bitrateKbps will be null (FLAC has no frame-level bitrate and no duration to derive it).
        const body = buildFlacBuffer();
        ({ server } = await startAudioServer({
            body,
            contentType: 'audio/flac',
            contentLength: body.length,
        }));
        const { port } = server.address();
        const audioUrl = `http://127.0.0.1:${port}/audio`;
        [result320k, resultFlac] = await Promise.all([
            validateAudioUrlCandidate(audioUrl, { quality: '320k' }),
            validateAudioUrlCandidate(audioUrl, { quality: 'flac' }),
        ]);
    });

    after(() => {
        server.close();
    });

    itV('does not return reason bitrate_too_low when bitrateKbps is null (320k quality)', () => {
        // **Validates: Requirements 1.4**
        assert.notEqual(
            result320k.reason,
            'bitrate_too_low',
            `Should not return bitrate_too_low when bitrate is unknown, got reason=${result320k.reason}`,
        );
    });

    itV('does not return reason bitrate_too_low when bitrateKbps is null (flac quality)', () => {
        // **Validates: Requirements 1.4**
        assert.notEqual(
            resultFlac.reason,
            'bitrate_too_low',
            `Should not return bitrate_too_low when bitrate is unknown`,
        );
    });
});
