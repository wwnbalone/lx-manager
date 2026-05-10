'use strict';

/**
 * Unit tests for comparePreparedSourcesByQuality() in lib/source-runner.js
 *
 * Task 4.2: 为 comparePreparedSourcesByQuality 编写单元测试
 *
 * Validates: Requirements 4.1, 4.2, 4.3
 *
 * Covers:
 *   1. Different scores: higher score sorts first
 *   2. Same score, different priority: lower priority number sorts first
 *   3. Same score and priority: lower originalOrder sorts first
 *   4. Lossless request + lossless label: source with '无损' or 'Hi-Res' label sorts
 *      before same-score source without label
 *   5. Non-lossless request: lossless labels have no effect on sort order
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { __internal } = require('../lib/source-runner');
const { comparePreparedSourcesByQuality } = __internal;

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a minimal candidate object matching the shape expected by
 * comparePreparedSourcesByQuality.
 *
 * @param {object} opts
 * @param {number} opts.score
 * @param {number} opts.priority
 * @param {number} opts.originalOrder
 * @param {string[]} [opts.labels]
 * @param {string} [opts.file]
 */
function makeCandidate({ score, priority, originalOrder, labels = [], file = 'source.js' }) {
    return {
        file,
        executor: {
            sourceQuality: {
                score,
                priority,
                labels,
            },
        },
        originalOrder,
    };
}

/**
 * Sort an array of candidates using comparePreparedSourcesByQuality and return
 * the sorted copy (does not mutate the original).
 */
function sortCandidates(candidates, requestedQuality) {
    return [...candidates].sort((a, b) => comparePreparedSourcesByQuality(a, b, requestedQuality));
}

// ── Scenario 1: Different scores ─────────────────────────────────────────────
//
// Validates: Requirement 4.1
// Higher score should sort first (descending order).

describe('comparePreparedSourcesByQuality: different scores', () => {

    it('higher score sorts before lower score', () => {
        // **Validates: Requirements 4.1**
        const low = makeCandidate({ score: 50, priority: 1, originalOrder: 0 });
        const high = makeCandidate({ score: 80, priority: 1, originalOrder: 1 });

        const result = comparePreparedSourcesByQuality(high, low, '320k');
        assert.ok(result < 0, `high-score candidate should sort before low-score (got ${result})`);
    });

    it('lower score sorts after higher score', () => {
        // **Validates: Requirements 4.1**
        const low = makeCandidate({ score: 30, priority: 1, originalOrder: 0 });
        const high = makeCandidate({ score: 90, priority: 1, originalOrder: 1 });

        const result = comparePreparedSourcesByQuality(low, high, '320k');
        assert.ok(result > 0, `low-score candidate should sort after high-score (got ${result})`);
    });

    it('sorted array places highest score first', () => {
        // **Validates: Requirements 4.1**
        const candidates = [
            makeCandidate({ score: 40, priority: 1, originalOrder: 0, file: 'a.js' }),
            makeCandidate({ score: 90, priority: 1, originalOrder: 1, file: 'b.js' }),
            makeCandidate({ score: 60, priority: 1, originalOrder: 2, file: 'c.js' }),
        ];

        const sorted = sortCandidates(candidates, '320k');
        assert.equal(sorted[0].file, 'b.js', 'highest score (90) should be first');
        assert.equal(sorted[1].file, 'c.js', 'second highest score (60) should be second');
        assert.equal(sorted[2].file, 'a.js', 'lowest score (40) should be last');
    });

    it('score comparison is independent of priority when scores differ', () => {
        // **Validates: Requirements 4.1**
        // Even if left has worse priority, higher score wins
        const highScoreBadPriority = makeCandidate({ score: 80, priority: 5, originalOrder: 0 });
        const lowScoreGoodPriority = makeCandidate({ score: 20, priority: 1, originalOrder: 1 });

        const result = comparePreparedSourcesByQuality(highScoreBadPriority, lowScoreGoodPriority, '320k');
        assert.ok(result < 0, 'higher score should win regardless of priority');
    });
});

// ── Scenario 2: Same score, different priority ────────────────────────────────
//
// Validates: Requirement 4.1
// When scores are equal, lower priority number (higher priority) sorts first.

describe('comparePreparedSourcesByQuality: same score, different priority', () => {

    it('lower priority number sorts before higher priority number', () => {
        // **Validates: Requirements 4.1**
        const highPri = makeCandidate({ score: 70, priority: 1, originalOrder: 0 });
        const lowPri = makeCandidate({ score: 70, priority: 3, originalOrder: 1 });

        const result = comparePreparedSourcesByQuality(highPri, lowPri, '320k');
        assert.ok(result < 0, `priority 1 should sort before priority 3 (got ${result})`);
    });

    it('higher priority number sorts after lower priority number', () => {
        // **Validates: Requirements 4.1**
        const highPri = makeCandidate({ score: 70, priority: 1, originalOrder: 0 });
        const lowPri = makeCandidate({ score: 70, priority: 5, originalOrder: 1 });

        const result = comparePreparedSourcesByQuality(lowPri, highPri, '320k');
        assert.ok(result > 0, `priority 5 should sort after priority 1 (got ${result})`);
    });

    it('sorted array places lowest priority number first when scores are equal', () => {
        // **Validates: Requirements 4.1**
        const candidates = [
            makeCandidate({ score: 70, priority: 3, originalOrder: 0, file: 'a.js' }),
            makeCandidate({ score: 70, priority: 1, originalOrder: 1, file: 'b.js' }),
            makeCandidate({ score: 70, priority: 2, originalOrder: 2, file: 'c.js' }),
        ];

        const sorted = sortCandidates(candidates, '320k');
        assert.equal(sorted[0].file, 'b.js', 'priority 1 should be first');
        assert.equal(sorted[1].file, 'c.js', 'priority 2 should be second');
        assert.equal(sorted[2].file, 'a.js', 'priority 3 should be last');
    });

    it('priority tiebreak only applies when scores are equal', () => {
        // **Validates: Requirements 4.1**
        // Score difference overrides priority
        const highScoreHighPriority = makeCandidate({ score: 80, priority: 5, originalOrder: 0 });
        const lowScoreLowPriority = makeCandidate({ score: 50, priority: 1, originalOrder: 1 });

        const result = comparePreparedSourcesByQuality(highScoreHighPriority, lowScoreLowPriority, '320k');
        assert.ok(result < 0, 'score difference should override priority tiebreak');
    });
});

// ── Scenario 3: Same score and priority, different originalOrder ──────────────
//
// Validates: Requirement 4.2
// When both score and priority are equal, lower originalOrder sorts first
// (preserves original load order for deterministic results).

describe('comparePreparedSourcesByQuality: same score and priority, different originalOrder', () => {

    it('lower originalOrder sorts before higher originalOrder', () => {
        // **Validates: Requirements 4.2**
        const first = makeCandidate({ score: 70, priority: 2, originalOrder: 0 });
        const second = makeCandidate({ score: 70, priority: 2, originalOrder: 5 });

        const result = comparePreparedSourcesByQuality(first, second, '320k');
        assert.ok(result < 0, `originalOrder 0 should sort before originalOrder 5 (got ${result})`);
    });

    it('higher originalOrder sorts after lower originalOrder', () => {
        // **Validates: Requirements 4.2**
        const first = makeCandidate({ score: 70, priority: 2, originalOrder: 0 });
        const second = makeCandidate({ score: 70, priority: 2, originalOrder: 10 });

        const result = comparePreparedSourcesByQuality(second, first, '320k');
        assert.ok(result > 0, `originalOrder 10 should sort after originalOrder 0 (got ${result})`);
    });

    it('sorted array preserves original load order when score and priority are equal', () => {
        // **Validates: Requirements 4.2**
        const candidates = [
            makeCandidate({ score: 60, priority: 2, originalOrder: 2, file: 'c.js' }),
            makeCandidate({ score: 60, priority: 2, originalOrder: 0, file: 'a.js' }),
            makeCandidate({ score: 60, priority: 2, originalOrder: 1, file: 'b.js' }),
        ];

        const sorted = sortCandidates(candidates, '320k');
        assert.equal(sorted[0].file, 'a.js', 'originalOrder 0 should be first');
        assert.equal(sorted[1].file, 'b.js', 'originalOrder 1 should be second');
        assert.equal(sorted[2].file, 'c.js', 'originalOrder 2 should be last');
    });

    it('returns 0 for identical score, priority, and originalOrder', () => {
        // **Validates: Requirements 4.2**
        const a = makeCandidate({ score: 70, priority: 2, originalOrder: 3 });
        const b = makeCandidate({ score: 70, priority: 2, originalOrder: 3 });

        const result = comparePreparedSourcesByQuality(a, b, '320k');
        assert.equal(result, 0, 'identical candidates should compare as equal (0)');
    });
});

// ── Scenario 4: Lossless request + lossless label ─────────────────────────────
//
// Validates: Requirement 4.3
// When requestedQuality is a lossless tier, sources with '无损' or 'Hi-Res' labels
// should sort before same-score sources without those labels.

describe('comparePreparedSourcesByQuality: lossless request + lossless label priority', () => {

    it('source with 无损 label sorts before same-score source without label (flac request)', () => {
        // **Validates: Requirements 4.3**
        const withLabel = makeCandidate({ score: 70, priority: 2, originalOrder: 1, labels: ['无损'] });
        const withoutLabel = makeCandidate({ score: 70, priority: 2, originalOrder: 0 });

        const result = comparePreparedSourcesByQuality(withLabel, withoutLabel, 'flac');
        assert.ok(result < 0, '无损 label should sort before no-label source (got ${result})');
    });

    it('source with Hi-Res label sorts before same-score source without label (flac request)', () => {
        // **Validates: Requirements 4.3**
        const withLabel = makeCandidate({ score: 70, priority: 2, originalOrder: 1, labels: ['Hi-Res'] });
        const withoutLabel = makeCandidate({ score: 70, priority: 2, originalOrder: 0 });

        const result = comparePreparedSourcesByQuality(withLabel, withoutLabel, 'flac');
        assert.ok(result < 0, 'Hi-Res label should sort before no-label source');
    });

    it('lossless label priority applies for all lossless quality tiers', () => {
        // **Validates: Requirements 4.3**
        const losslessQualities = ['flac', 'flac24bit', 'master', 'hires', 'atmos'];

        for (const quality of losslessQualities) {
            const withLabel = makeCandidate({ score: 70, priority: 2, originalOrder: 1, labels: ['无损'] });
            const withoutLabel = makeCandidate({ score: 70, priority: 2, originalOrder: 0 });

            const result = comparePreparedSourcesByQuality(withLabel, withoutLabel, quality);
            assert.ok(
                result < 0,
                `无损 label should sort first for quality=${quality} (got ${result})`,
            );
        }
    });

    it('sorted array places lossless-labeled sources first for flac request', () => {
        // **Validates: Requirements 4.3**
        const candidates = [
            makeCandidate({ score: 70, priority: 2, originalOrder: 0, file: 'a.js', labels: [] }),
            makeCandidate({ score: 70, priority: 2, originalOrder: 1, file: 'b.js', labels: ['无损'] }),
            makeCandidate({ score: 70, priority: 2, originalOrder: 2, file: 'c.js', labels: ['Hi-Res'] }),
            makeCandidate({ score: 70, priority: 2, originalOrder: 3, file: 'd.js', labels: [] }),
        ];

        const sorted = sortCandidates(candidates, 'flac');

        // Labeled sources (b, c) should come before unlabeled (a, d)
        const labeledFiles = sorted.slice(0, 2).map(c => c.file).sort();
        const unlabeledFiles = sorted.slice(2).map(c => c.file).sort();

        assert.deepEqual(labeledFiles, ['b.js', 'c.js'], 'labeled sources should be in first two positions');
        assert.deepEqual(unlabeledFiles, ['a.js', 'd.js'], 'unlabeled sources should be in last two positions');
    });

    it('lossless label takes priority over score difference for lossless request', () => {
        // **Validates: Requirements 4.3**
        // The lossless label check is the FIRST sort criterion (before score).
        // A labeled source sorts before an unlabeled source regardless of score difference.
        const highScoreNoLabel = makeCandidate({ score: 90, priority: 2, originalOrder: 0, labels: [] });
        const lowScoreWithLabel = makeCandidate({ score: 50, priority: 2, originalOrder: 1, labels: ['无损'] });

        const result = comparePreparedSourcesByQuality(lowScoreWithLabel, highScoreNoLabel, 'flac');
        assert.ok(result < 0, 'lossless label is the first sort criterion and beats score for lossless request');
    });

    it('two sources both with lossless labels fall back to score/priority/order tiebreak', () => {
        // **Validates: Requirements 4.3**
        const a = makeCandidate({ score: 70, priority: 1, originalOrder: 0, labels: ['无损'] });
        const b = makeCandidate({ score: 70, priority: 2, originalOrder: 1, labels: ['Hi-Res'] });

        const result = comparePreparedSourcesByQuality(a, b, 'flac');
        assert.ok(result < 0, 'when both have lossless labels, lower priority number should win');
    });

    it('two sources both without lossless labels fall back to score/priority/order tiebreak', () => {
        // **Validates: Requirements 4.3**
        const a = makeCandidate({ score: 70, priority: 1, originalOrder: 0, labels: [] });
        const b = makeCandidate({ score: 70, priority: 2, originalOrder: 1, labels: [] });

        const result = comparePreparedSourcesByQuality(a, b, 'flac');
        assert.ok(result < 0, 'when neither has lossless labels, lower priority number should win');
    });
});

// ── Scenario 5: Non-lossless request — lossless labels have no effect ─────────
//
// Validates: Requirement 4.3 (by negation)
// When requestedQuality is NOT a lossless tier (128k, 320k), lossless labels
// should NOT affect sort order — only score, priority, and originalOrder matter.

describe('comparePreparedSourcesByQuality: non-lossless request ignores lossless labels', () => {

    it('无损 label has no effect for 320k request', () => {
        // **Validates: Requirements 4.3**
        // Without lossless request, label should not override originalOrder tiebreak
        const withLabel = makeCandidate({ score: 70, priority: 2, originalOrder: 1, labels: ['无损'] });
        const withoutLabel = makeCandidate({ score: 70, priority: 2, originalOrder: 0 });

        const result = comparePreparedSourcesByQuality(withLabel, withoutLabel, '320k');
        // originalOrder 0 should win since labels are ignored for 320k
        assert.ok(result > 0, '无损 label should not affect sort for 320k request; originalOrder should decide');
    });

    it('Hi-Res label has no effect for 128k request', () => {
        // **Validates: Requirements 4.3**
        const withLabel = makeCandidate({ score: 70, priority: 2, originalOrder: 1, labels: ['Hi-Res'] });
        const withoutLabel = makeCandidate({ score: 70, priority: 2, originalOrder: 0 });

        const result = comparePreparedSourcesByQuality(withLabel, withoutLabel, '128k');
        assert.ok(result > 0, 'Hi-Res label should not affect sort for 128k request; originalOrder should decide');
    });

    it('sorted array for 320k request ignores lossless labels and uses score/priority/order', () => {
        // **Validates: Requirements 4.3**
        const candidates = [
            makeCandidate({ score: 70, priority: 2, originalOrder: 0, file: 'a.js', labels: [] }),
            makeCandidate({ score: 70, priority: 2, originalOrder: 1, file: 'b.js', labels: ['无损'] }),
            makeCandidate({ score: 70, priority: 2, originalOrder: 2, file: 'c.js', labels: ['Hi-Res'] }),
        ];

        const sorted = sortCandidates(candidates, '320k');
        // For 320k, labels are ignored; originalOrder determines order
        assert.equal(sorted[0].file, 'a.js', 'originalOrder 0 should be first for 320k');
        assert.equal(sorted[1].file, 'b.js', 'originalOrder 1 should be second for 320k');
        assert.equal(sorted[2].file, 'c.js', 'originalOrder 2 should be last for 320k');
    });

    it('undefined requestedQuality does not apply lossless label boost', () => {
        // **Validates: Requirements 4.3**
        const withLabel = makeCandidate({ score: 70, priority: 2, originalOrder: 1, labels: ['无损'] });
        const withoutLabel = makeCandidate({ score: 70, priority: 2, originalOrder: 0 });

        const result = comparePreparedSourcesByQuality(withLabel, withoutLabel, undefined);
        assert.ok(result > 0, 'undefined quality should not apply lossless label boost; originalOrder should decide');
    });
});

// ── Combined multi-level sort ─────────────────────────────────────────────────
//
// Validates: Requirements 4.1, 4.2, 4.3
// Verify all three sort levels work together correctly.

describe('comparePreparedSourcesByQuality: combined multi-level sort', () => {

    it('full sort: lossless label > score > priority > originalOrder for flac request', () => {
        // **Validates: Requirements 4.1, 4.2, 4.3**
        // The lossless label check is the FIRST sort criterion for lossless requests.
        // Labeled sources sort before all unlabeled sources, regardless of score.
        const candidates = [
            makeCandidate({ score: 50, priority: 1, originalOrder: 0, file: 'low-score-labeled.js', labels: ['无损'] }),
            makeCandidate({ score: 90, priority: 5, originalOrder: 3, file: 'high-score-no-label.js', labels: [] }),
            makeCandidate({ score: 70, priority: 3, originalOrder: 1, file: 'mid-no-label.js', labels: [] }),
            makeCandidate({ score: 70, priority: 2, originalOrder: 2, file: 'mid-with-label.js', labels: ['Hi-Res'] }),
        ];

        const sorted = sortCandidates(candidates, 'flac');

        // Labeled sources come first (lossless label is first criterion)
        const labeledFiles = sorted.slice(0, 2).map(c => c.file).sort();
        assert.deepEqual(
            labeledFiles,
            ['low-score-labeled.js', 'mid-with-label.js'],
            'labeled sources should occupy the first two positions',
        );

        // Among labeled: mid-with-label (score=70) beats low-score-labeled (score=50)
        assert.equal(sorted[0].file, 'mid-with-label.js', 'higher-score labeled source should be first');
        assert.equal(sorted[1].file, 'low-score-labeled.js', 'lower-score labeled source should be second');

        // Unlabeled sources come after: high-score (90) then mid-no-label (70)
        assert.equal(sorted[2].file, 'high-score-no-label.js', 'highest-score unlabeled should be third');
        assert.equal(sorted[3].file, 'mid-no-label.js', 'lower-score unlabeled should be last');
    });

    it('full sort for 320k request: score > priority > originalOrder (labels ignored)', () => {
        // **Validates: Requirements 4.1, 4.2**
        const candidates = [
            makeCandidate({ score: 70, priority: 2, originalOrder: 0, file: 'a.js', labels: [] }),
            makeCandidate({ score: 70, priority: 1, originalOrder: 1, file: 'b.js', labels: ['无损'] }),
            makeCandidate({ score: 80, priority: 3, originalOrder: 2, file: 'c.js', labels: [] }),
        ];

        const sorted = sortCandidates(candidates, '320k');

        assert.equal(sorted[0].file, 'c.js', 'highest score (80) should be first');
        assert.equal(sorted[1].file, 'b.js', 'priority 1 should beat priority 2 at same score');
        assert.equal(sorted[2].file, 'a.js', 'priority 2 should be last');
    });
});
