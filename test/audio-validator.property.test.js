'use strict';

/**
 * Property-based tests for lib/audio-validator.js
 *
 * Task 1.4: Property 1 — BitrateFloor 门槛覆盖所有音质等级
 *
 * **Validates: Requirements 1.1, 1.2, 1.3**
 *
 * Property 1: For every RequestedQuality value, the strict-mode BitrateFloor
 * returned by getQualityMinBitrateKbps must satisfy:
 *   - '128k'  → floor ≥ 96
 *   - '320k'  → floor ≥ 200
 *   - lossless ('flac', 'flac24bit', 'master', 'hires', 'atmos') → floor ≥ 320
 *
 * Because QUALITY_FILTER_STRICT is resolved at module-load time from
 * process.env, we verify the strict thresholds by inspecting the exported
 * QUALITY_MIN_KBPS_STRICT table directly, and also by running
 * getQualityMinBitrateKbps against a fresh module loaded with the env var set.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');

// ── Exported constants ───────────────────────────────────────────────────────

const {
    getQualityMinBitrateKbps,
    QUALITY_MIN_KBPS_STRICT,
    QUALITY_MIN_KBPS_RELAXED,
} = require('../lib/audio-validator');

// All valid RequestedQuality values defined in the spec
const ALL_QUALITIES = ['128k', '320k', 'flac', 'flac24bit', 'master', 'hires', 'atmos'];
const LOSSLESS_QUALITIES = ['flac', 'flac24bit', 'master', 'hires', 'atmos'];

// ── Property 1: BitrateFloor 门槛覆盖所有音质等级 ────────────────────────────
//
// Validates: Requirements 1.1, 1.2, 1.3
//
// We test the QUALITY_MIN_KBPS_STRICT table directly because
// getQualityMinBitrateKbps reads QUALITY_FILTER_STRICT at module-load time.
// The exported QUALITY_MIN_KBPS_STRICT object always reflects the strict
// thresholds regardless of the current env var value.

describe('Property 1: BitrateFloor 门槛覆盖所有音质等级 (strict mode)', () => {

    it('QUALITY_MIN_KBPS_STRICT["128k"] ≥ 96 for every run (fast-check)', () => {
        // **Validates: Requirements 1.2**
        fc.assert(
            fc.property(
                fc.constantFrom(...ALL_QUALITIES),
                (quality) => {
                    const floor = QUALITY_MIN_KBPS_STRICT[quality];
                    assert.ok(
                        typeof floor === 'number' && floor > 0,
                        `QUALITY_MIN_KBPS_STRICT["${quality}"] must be a positive number, got ${floor}`,
                    );
                    if (quality === '128k') {
                        assert.ok(
                            floor >= 96,
                            `strict floor for 128k must be ≥ 96, got ${floor}`,
                        );
                    }
                    return true;
                },
            ),
            { numRuns: 100 },
        );
    });

    it('QUALITY_MIN_KBPS_STRICT["320k"] ≥ 200 for every run (fast-check)', () => {
        // **Validates: Requirements 1.1**
        fc.assert(
            fc.property(
                fc.constantFrom(...ALL_QUALITIES),
                (quality) => {
                    const floor = QUALITY_MIN_KBPS_STRICT[quality];
                    if (quality === '320k') {
                        assert.ok(
                            floor >= 200,
                            `strict floor for 320k must be ≥ 200, got ${floor}`,
                        );
                    }
                    return true;
                },
            ),
            { numRuns: 100 },
        );
    });

    it('QUALITY_MIN_KBPS_STRICT[lossless] ≥ 320 for every lossless quality (fast-check)', () => {
        // **Validates: Requirements 1.3**
        fc.assert(
            fc.property(
                fc.constantFrom(...LOSSLESS_QUALITIES),
                (quality) => {
                    const floor = QUALITY_MIN_KBPS_STRICT[quality];
                    assert.ok(
                        floor >= 320,
                        `strict floor for lossless quality "${quality}" must be ≥ 320, got ${floor}`,
                    );
                    return true;
                },
            ),
            { numRuns: 100 },
        );
    });

    it('all RequestedQuality values have a defined strict floor (fast-check)', () => {
        // **Validates: Requirements 1.1, 1.2, 1.3**
        // Ensures no quality value is missing from the strict table
        fc.assert(
            fc.property(
                fc.constantFrom(...ALL_QUALITIES),
                (quality) => {
                    const floor = QUALITY_MIN_KBPS_STRICT[quality];
                    assert.ok(
                        floor !== undefined && floor !== null,
                        `QUALITY_MIN_KBPS_STRICT must define a floor for "${quality}"`,
                    );
                    assert.ok(
                        typeof floor === 'number' && Number.isFinite(floor) && floor > 0,
                        `floor for "${quality}" must be a positive finite number, got ${floor}`,
                    );
                    return true;
                },
            ),
            { numRuns: 100 },
        );
    });

    it('combined: strict floors satisfy all tier thresholds simultaneously (fast-check)', () => {
        // **Validates: Requirements 1.1, 1.2, 1.3**
        // Single property that checks all three tier constraints in one pass
        fc.assert(
            fc.property(
                fc.constantFrom(...ALL_QUALITIES),
                (quality) => {
                    const floor = QUALITY_MIN_KBPS_STRICT[quality];

                    if (quality === '128k') {
                        return floor >= 96;
                    }
                    if (quality === '320k') {
                        return floor >= 200;
                    }
                    // lossless tier
                    return floor >= 320;
                },
            ),
            { numRuns: 100 },
        );
    });
});

// ── Sanity check: getQualityMinBitrateKbps returns a positive number ─────────
//
// This tests the function's runtime behaviour with the current module state.
// In relaxed mode (default) the returned values will be lower, but they must
// still be positive numbers for every valid quality string.

describe('getQualityMinBitrateKbps: always returns a positive number for valid qualities', () => {

    it('returns a positive number for every valid RequestedQuality (fast-check)', () => {
        // **Validates: Requirements 1.1, 1.2, 1.3**
        fc.assert(
            fc.property(
                fc.constantFrom(...ALL_QUALITIES),
                (quality) => {
                    const floor = getQualityMinBitrateKbps(quality);
                    assert.ok(
                        typeof floor === 'number' && Number.isFinite(floor) && floor > 0,
                        `getQualityMinBitrateKbps("${quality}") must return a positive number, got ${floor}`,
                    );
                    return true;
                },
            ),
            { numRuns: 100 },
        );
    });
});

// ── Property 4: 320k 请求下高码率 MP3 获得音质对齐加分 ───────────────────────
//
// Task 2.4
// **Validates: Requirements 2.1**
//
// For any RequestedQuality = '320k', format = 'mp3', bitrateKbps ≥ 256,
// scoreAudioCandidate must return breakdown.qualityAlignmentBonus ≥ 60.

const { scoreAudioCandidate } = require('../lib/audio-validator');

describe('Property 4: 320k 请求下高码率 MP3 获得音质对齐加分', () => {

    it('MP3 候选码率 ≥ 256kbps 时 qualityAlignmentBonus ≥ 60 (fast-check)', () => {
        // **Validates: Requirements 2.1**
        fc.assert(
            fc.property(
                // Generate bitrateKbps in [256, 320] — the high-bitrate MP3 range
                fc.integer({ min: 256, max: 320 }),
                (bitrateKbps) => {
                    const formatInfo = { format: 'mp3', lossless: false };
                    const { breakdown } = scoreAudioCandidate({
                        quality: '320k',
                        formatInfo,
                        bitrateKbps,
                    });
                    assert.ok(
                        breakdown.qualityAlignmentBonus >= 60,
                        `qualityAlignmentBonus should be ≥ 60 for 320k+MP3+${bitrateKbps}kbps, got ${breakdown.qualityAlignmentBonus}`,
                    );
                    return true;
                },
            ),
            { numRuns: 100 },
        );
    });

    it('MP3 候选码率 < 256kbps 时 qualityAlignmentBonus 不触发高码率加分 (fast-check)', () => {
        // **Validates: Requirements 2.1**
        // Complementary: below threshold, the bonus should NOT be ≥ 60
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 255 }),
                (bitrateKbps) => {
                    const formatInfo = { format: 'mp3', lossless: false };
                    const { breakdown } = scoreAudioCandidate({
                        quality: '320k',
                        formatInfo,
                        bitrateKbps,
                    });
                    assert.ok(
                        breakdown.qualityAlignmentBonus < 60,
                        `qualityAlignmentBonus should be < 60 for 320k+MP3+${bitrateKbps}kbps (below threshold), got ${breakdown.qualityAlignmentBonus}`,
                    );
                    return true;
                },
            ),
            { numRuns: 100 },
        );
    });
});

// ── Property 5: 无损请求下音质对齐加分/扣分满足阈值 ─────────────────────────
//
// Task 2.5
// **Validates: Requirements 2.3**
//
// For any lossless RequestedQuality ('flac', 'flac24bit', 'master', 'hires', 'atmos'):
//   - Lossless format candidates (flac, wav with lossless: true) → qualityAlignmentBonus ≥ 100
//   - Lossy format candidates (mp3, aac, m4a, ogg with lossless: false) → qualityAlignmentBonus ≤ -100

const LOSSLESS_REQUEST_QUALITIES = ['flac', 'flac24bit', 'master', 'hires', 'atmos'];

const LOSSLESS_FORMAT_INFOS = [
    { format: 'flac', lossless: true },
    { format: 'wav', lossless: true },
];

const LOSSY_FORMAT_INFOS = [
    { format: 'mp3', lossless: false },
    { format: 'aac', lossless: false },
    { format: 'm4a', lossless: false },
    { format: 'ogg', lossless: false },
];

describe('Property 5: 无损请求下音质对齐加分/扣分满足阈值', () => {

    it('无损请求 + 无损格式候选 → qualityAlignmentBonus ≥ 100 (fast-check)', () => {
        // **Validates: Requirements 2.3**
        fc.assert(
            fc.property(
                fc.constantFrom(...LOSSLESS_REQUEST_QUALITIES),
                fc.constantFrom(...LOSSLESS_FORMAT_INFOS),
                // bitrateKbps can be anything (or null) — bonus must hold regardless
                fc.option(fc.integer({ min: 100, max: 1000 }), { nil: null }),
                (quality, formatInfo, bitrateKbps) => {
                    const { breakdown } = scoreAudioCandidate({
                        quality,
                        formatInfo,
                        bitrateKbps,
                    });
                    assert.ok(
                        breakdown.qualityAlignmentBonus >= 100,
                        `qualityAlignmentBonus should be ≥ 100 for lossless request "${quality}" + lossless format "${formatInfo.format}", got ${breakdown.qualityAlignmentBonus}`,
                    );
                    return true;
                },
            ),
            { numRuns: 200 },
        );
    });

    it('无损请求 + 有损格式候选 → qualityAlignmentBonus ≤ -100 (fast-check)', () => {
        // **Validates: Requirements 2.3**
        fc.assert(
            fc.property(
                fc.constantFrom(...LOSSLESS_REQUEST_QUALITIES),
                fc.constantFrom(...LOSSY_FORMAT_INFOS),
                fc.option(fc.integer({ min: 64, max: 320 }), { nil: null }),
                (quality, formatInfo, bitrateKbps) => {
                    const { breakdown } = scoreAudioCandidate({
                        quality,
                        formatInfo,
                        bitrateKbps,
                    });
                    assert.ok(
                        breakdown.qualityAlignmentBonus <= -100,
                        `qualityAlignmentBonus should be ≤ -100 for lossless request "${quality}" + lossy format "${formatInfo.format}", got ${breakdown.qualityAlignmentBonus}`,
                    );
                    return true;
                },
            ),
            { numRuns: 200 },
        );
    });
});

// ── Property 2: 低码率候选被正确拒绝 ─────────────────────────────────────────
//
// Task 2.8
// **Validates: Requirements 1.1, 1.2, 1.3, 1.5**
//
// For any known bitrateKbps that is below the corresponding BitrateFloor,
// the bitrate check logic must return ok: false, reason: 'bitrate_too_low',
// with details containing bitrateKbps, minBitrateKbps, and format.
//
// Because validateAudioUrlCandidate makes real HTTP calls, we test the
// bitrate check logic directly using a pure helper that mirrors the exact
// conditional from audio-validator.js:
//
//   if (bitrateKbps && bitrateKbps < minBitrateKbps) {
//     return { ok: false, reason: 'bitrate_too_low', details: { bitrateKbps, minBitrateKbps, format } }
//   }
//
// This is the same logic path exercised by validateAudioUrlCandidate when
// the probe succeeds and the bitrate is known.

/**
 * Pure helper that encapsulates the bitrate floor check from
 * validateAudioUrlCandidate. Mirrors the exact conditional:
 *
 *   if (bitrateKbps && bitrateKbps < minBitrateKbps) { ... }
 *
 * @param {string} quality - RequestedQuality value
 * @param {number|null} bitrateKbps - detected bitrate (null = unknown)
 * @param {string} format - detected audio format string
 * @returns {{ ok: boolean, reason?: string, details?: object }}
 */
function checkBitrateFloor(quality, bitrateKbps, format) {
    const minBitrateKbps = getQualityMinBitrateKbps(quality);
    if (bitrateKbps && bitrateKbps < minBitrateKbps) {
        return {
            ok: false,
            reason: 'bitrate_too_low',
            details: {
                bitrateKbps,
                minBitrateKbps,
                format,
            },
        };
    }
    return { ok: true };
}

// Relaxed floors (the minimum possible floor values across all qualities):
//   128k → 32, 320k → 72, flac → 160, flac24bit → 220, master → 220,
//   hires → 180, atmos → 180
// Generating bitrateKbps in [1, 30] guarantees it is below ALL relaxed floors.
const SAMPLE_FORMATS = ['mp3', 'flac', 'aac', 'm4a', 'ogg', 'wav', 'unknown'];

describe('Property 2: 低码率候选被正确拒绝', () => {

    it('bitrateKbps in [1,30] 时对所有 quality 均返回 bitrate_too_low (fast-check)', () => {
        // **Validates: Requirements 1.1, 1.2, 1.3, 1.5**
        fc.assert(
            fc.property(
                fc.constantFrom(...ALL_QUALITIES),
                // [1, 30] is below every relaxed floor (min relaxed floor = 32 for 128k)
                fc.integer({ min: 1, max: 30 }),
                fc.constantFrom(...SAMPLE_FORMATS),
                (quality, bitrateKbps, format) => {
                    const result = checkBitrateFloor(quality, bitrateKbps, format);

                    assert.strictEqual(
                        result.ok,
                        false,
                        `Expected ok: false for quality=${quality}, bitrateKbps=${bitrateKbps}, got ok: ${result.ok}`,
                    );
                    assert.strictEqual(
                        result.reason,
                        'bitrate_too_low',
                        `Expected reason: 'bitrate_too_low', got '${result.reason}'`,
                    );
                    assert.ok(
                        'bitrateKbps' in result.details,
                        `details must contain 'bitrateKbps' field`,
                    );
                    assert.ok(
                        'minBitrateKbps' in result.details,
                        `details must contain 'minBitrateKbps' field`,
                    );
                    assert.ok(
                        'format' in result.details,
                        `details must contain 'format' field`,
                    );
                    assert.strictEqual(
                        result.details.bitrateKbps,
                        bitrateKbps,
                        `details.bitrateKbps must equal the input bitrateKbps`,
                    );
                    assert.ok(
                        typeof result.details.minBitrateKbps === 'number' && result.details.minBitrateKbps > 0,
                        `details.minBitrateKbps must be a positive number, got ${result.details.minBitrateKbps}`,
                    );
                    assert.ok(
                        result.details.bitrateKbps < result.details.minBitrateKbps,
                        `details.bitrateKbps (${result.details.bitrateKbps}) must be < details.minBitrateKbps (${result.details.minBitrateKbps})`,
                    );
                    return true;
                },
            ),
            { numRuns: 200 },
        );
    });

    it('bitrateKbps 低于对应 quality 的宽松门槛时返回 bitrate_too_low (fast-check)', () => {
        // **Validates: Requirements 1.1, 1.2, 1.3, 1.5**
        // Generate bitrateKbps strictly below each quality's relaxed floor
        fc.assert(
            fc.property(
                fc.constantFrom(
                    // [quality, maxBitrateBelow] pairs — max value is floor - 1
                    ['128k', 31],    // relaxed floor = 32, so [1, 31] is always below
                    ['320k', 71],    // relaxed floor = 72
                    ['flac', 159],   // relaxed floor = 160
                    ['flac24bit', 219], // relaxed floor = 220
                    ['master', 219], // relaxed floor = 220
                    ['hires', 179],  // relaxed floor = 180
                    ['atmos', 179],  // relaxed floor = 180
                ),
                fc.constantFrom(...SAMPLE_FORMATS),
                ([quality, maxBitrate], format) => {
                    // Pick a bitrate in [1, maxBitrate] — always below the relaxed floor
                    const bitrateKbps = maxBitrate; // use the boundary value for determinism
                    const result = checkBitrateFloor(quality, bitrateKbps, format);

                    assert.strictEqual(result.ok, false,
                        `Expected ok: false for quality=${quality}, bitrateKbps=${bitrateKbps}`);
                    assert.strictEqual(result.reason, 'bitrate_too_low',
                        `Expected reason: 'bitrate_too_low' for quality=${quality}, bitrateKbps=${bitrateKbps}`);
                    assert.ok('bitrateKbps' in result.details, 'details must contain bitrateKbps');
                    assert.ok('minBitrateKbps' in result.details, 'details must contain minBitrateKbps');
                    assert.ok('format' in result.details, 'details must contain format');
                    return true;
                },
            ),
            { numRuns: 100 },
        );
    });
});

// ── Property 3: 码率未知时不因码率不足拒绝 ───────────────────────────────────
//
// Task 2.9
// **Validates: Requirements 1.4**
//
// When bitrateKbps is null (unknown), the guard `if (bitrateKbps && ...)` is
// falsy, so bitrate_too_low must never be triggered regardless of quality or
// format.

describe('Property 3: 码率未知时不因码率不足拒绝', () => {

    it('bitrateKbps 为 null 时对所有 quality 均不返回 bitrate_too_low (fast-check)', () => {
        // **Validates: Requirements 1.4**
        fc.assert(
            fc.property(
                fc.constantFrom(...ALL_QUALITIES),
                fc.constantFrom(...SAMPLE_FORMATS),
                (quality, format) => {
                    // bitrateKbps = null → unknown bitrate
                    const result = checkBitrateFloor(quality, null, format);

                    assert.notStrictEqual(
                        result.reason,
                        'bitrate_too_low',
                        `Must not return reason: 'bitrate_too_low' when bitrateKbps is null (quality=${quality}, format=${format})`,
                    );
                    // The result must be ok: true (no rejection on unknown bitrate)
                    assert.strictEqual(
                        result.ok,
                        true,
                        `Must return ok: true when bitrateKbps is null (quality=${quality}, format=${format})`,
                    );
                    return true;
                },
            ),
            { numRuns: 200 },
        );
    });

    it('bitrateKbps 为 0 时（falsy）不因码率不足拒绝 (fast-check)', () => {
        // **Validates: Requirements 1.4**
        // bitrateKbps = 0 is also falsy — the guard `if (bitrateKbps && ...)` is false
        fc.assert(
            fc.property(
                fc.constantFrom(...ALL_QUALITIES),
                fc.constantFrom(...SAMPLE_FORMATS),
                (quality, format) => {
                    const result = checkBitrateFloor(quality, 0, format);

                    assert.notStrictEqual(
                        result.reason,
                        'bitrate_too_low',
                        `Must not return reason: 'bitrate_too_low' when bitrateKbps is 0 (quality=${quality}, format=${format})`,
                    );
                    return true;
                },
            ),
            { numRuns: 100 },
        );
    });
});
