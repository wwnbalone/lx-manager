'use strict';

/**
 * Property-based tests for lib/source-runner.js
 *
 * Task 4.3: Property 7 — 候选排序满足 score 降序、priority 升序、原始顺序稳定
 * Task 4.4: Property 8 — 无损请求下含无损标签的音源排在前部
 *
 * **Validates: Requirements 4.1, 4.2, 4.3**
 *
 * Test framework: Node.js built-in `node --test`
 * Property library: fast-check
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');

// comparePreparedSourcesByQuality is exported under __internal
const { comparePreparedSourcesByQuality } = require('../lib/source-runner').__internal;

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a minimal candidate object matching the shape expected by
 * comparePreparedSourcesByQuality:
 *   { file, executor: { sourceQuality: { score, priority, labels } }, originalOrder }
 */
function makeCandidate({ score, priority, labels = [], originalOrder }) {
    return {
        file: `source-${originalOrder}.js`,
        executor: {
            sourceQuality: { score, priority, labels },
        },
        originalOrder,
    };
}

// All lossless RequestedQuality values (must stay in sync with source-runner.js)
const LOSSLESS_QUALITIES = ['flac', 'flac24bit', 'master', 'hires', 'atmos'];
const LOSSY_QUALITIES = ['128k', '320k'];

// ── Property 7: 候选排序满足 score 降序、priority 升序、原始顺序稳定 ──────────
//
// Task 4.3
// **Validates: Requirements 4.1, 4.2**
//
// For any array of candidates, after sorting with comparePreparedSourcesByQuality
// (using a non-lossless requestedQuality so the lossless-label rule is inactive),
// every adjacent pair (a, b) must satisfy:
//   a.score > b.score  OR
//   (a.score === b.score AND a.priority < b.priority)  OR
//   (a.score === b.score AND a.priority === b.priority AND a.originalOrder <= b.originalOrder)

describe('Property 7: 候选排序满足 score 降序、priority 升序、原始顺序稳定', () => {

    it('排序后相邻候选满足三级排序规则 (fast-check)', () => {
        // **Validates: Requirements 4.1, 4.2**
        fc.assert(
            fc.property(
                // Generate an array of candidates with random score/priority/originalOrder.
                // We assign originalOrder from the array index to guarantee uniqueness and
                // to make the "stable original order" assertion deterministic.
                fc.array(
                    fc.record({
                        score: fc.integer({ min: 0, max: 100 }),
                        priority: fc.integer({ min: 1, max: 5 }),
                    }),
                    { minLength: 1, maxLength: 20 },
                ),
                (rawCandidates) => {
                    // Assign stable originalOrder values (0, 1, 2, …)
                    const candidates = rawCandidates.map((c, i) =>
                        makeCandidate({ ...c, originalOrder: i }),
                    );

                    // Use a lossy quality so the lossless-label rule does not interfere
                    const requestedQuality = '320k';

                    const sorted = [...candidates].sort(
                        (a, b) => comparePreparedSourcesByQuality(a, b, requestedQuality),
                    );

                    for (let i = 0; i < sorted.length - 1; i++) {
                        const a = sorted[i];
                        const b = sorted[i + 1];

                        const aScore = a.executor.sourceQuality.score;
                        const bScore = b.executor.sourceQuality.score;
                        const aPriority = a.executor.sourceQuality.priority;
                        const bPriority = b.executor.sourceQuality.priority;
                        const aOrder = a.originalOrder;
                        const bOrder = b.originalOrder;

                        if (aScore !== bScore) {
                            // Rule 1: higher score comes first
                            assert.ok(
                                aScore > bScore,
                                `score 降序违反：sorted[${i}].score=${aScore} should be > sorted[${i + 1}].score=${bScore}`,
                            );
                        } else if (aPriority !== bPriority) {
                            // Rule 2: lower priority number (higher priority) comes first
                            assert.ok(
                                aPriority < bPriority,
                                `priority 升序违反：sorted[${i}].priority=${aPriority} should be < sorted[${i + 1}].priority=${bPriority} (same score=${aScore})`,
                            );
                        } else {
                            // Rule 3: preserve original load order
                            assert.ok(
                                aOrder <= bOrder,
                                `originalOrder 稳定性违反：sorted[${i}].originalOrder=${aOrder} should be ≤ sorted[${i + 1}].originalOrder=${bOrder} (same score=${aScore}, priority=${aPriority})`,
                            );
                        }
                    }

                    return true;
                },
            ),
            { numRuns: 200 },
        );
    });

    it('单元素列表排序结果不变 (fast-check)', () => {
        // **Validates: Requirements 4.1, 4.2**
        // Edge case: a single-element array is trivially sorted
        fc.assert(
            fc.property(
                fc.record({
                    score: fc.integer({ min: 0, max: 100 }),
                    priority: fc.integer({ min: 1, max: 5 }),
                }),
                (raw) => {
                    const candidates = [makeCandidate({ ...raw, originalOrder: 0 })];
                    const sorted = [...candidates].sort(
                        (a, b) => comparePreparedSourcesByQuality(a, b, '320k'),
                    );
                    assert.strictEqual(sorted.length, 1);
                    assert.strictEqual(sorted[0].originalOrder, 0);
                    return true;
                },
            ),
            { numRuns: 100 },
        );
    });

    it('score 相同时 priority 更小的候选排在前面 (fast-check)', () => {
        // **Validates: Requirements 4.1, 4.2**
        // Focused test: two candidates with the same score but different priorities
        fc.assert(
            fc.property(
                fc.integer({ min: 0, max: 100 }),          // shared score
                fc.integer({ min: 1, max: 4 }),             // lower priority number (higher priority)
                fc.integer({ min: 2, max: 5 }).filter(     // higher priority number (lower priority)
                    (hi) => hi > 1,
                ),
                (score, lowPriNum, highPriNum) => {
                    // Ensure lowPriNum < highPriNum
                    if (lowPriNum >= highPriNum) return true; // skip invalid combo

                    const a = makeCandidate({ score, priority: lowPriNum, originalOrder: 0 });
                    const b = makeCandidate({ score, priority: highPriNum, originalOrder: 1 });

                    const cmp = comparePreparedSourcesByQuality(a, b, '320k');
                    assert.ok(
                        cmp < 0,
                        `priority ${lowPriNum} should sort before priority ${highPriNum} (same score=${score}), comparator returned ${cmp}`,
                    );
                    return true;
                },
            ),
            { numRuns: 200 },
        );
    });

    it('score 和 priority 均相同时 originalOrder 更小的候选排在前面 (fast-check)', () => {
        // **Validates: Requirements 4.2**
        fc.assert(
            fc.property(
                fc.integer({ min: 0, max: 100 }),  // shared score
                fc.integer({ min: 1, max: 5 }),    // shared priority
                fc.nat({ max: 100 }),               // originalOrder for a
                fc.nat({ max: 100 }),               // originalOrder for b
                (score, priority, orderA, orderB) => {
                    if (orderA === orderB) return true; // skip equal-order case

                    const a = makeCandidate({ score, priority, originalOrder: orderA });
                    const b = makeCandidate({ score, priority, originalOrder: orderB });

                    const cmp = comparePreparedSourcesByQuality(a, b, '320k');

                    if (orderA < orderB) {
                        assert.ok(
                            cmp < 0,
                            `originalOrder ${orderA} should sort before ${orderB}, comparator returned ${cmp}`,
                        );
                    } else {
                        assert.ok(
                            cmp > 0,
                            `originalOrder ${orderA} should sort after ${orderB}, comparator returned ${cmp}`,
                        );
                    }
                    return true;
                },
            ),
            { numRuns: 200 },
        );
    });
});

// ── Property 8: 无损请求下含无损标签的音源排在前部 ───────────────────────────
//
// Task 4.4
// **Validates: Requirements 4.3**
//
// For any lossless RequestedQuality, when two candidates have the same score
// and priority, the one with '无损' or 'Hi-Res' in its labels must sort before
// the one without those labels.

describe('Property 8: 无损请求下含无损标签的音源排在前部', () => {

    it('无损请求下含无损标签的候选排在不含标签的同分候选之前 (fast-check)', () => {
        // **Validates: Requirements 4.3**
        fc.assert(
            fc.property(
                // Pick a lossless requestedQuality
                fc.constantFrom(...LOSSLESS_QUALITIES),
                // Shared score and priority for both candidates
                fc.integer({ min: 0, max: 100 }),
                fc.integer({ min: 1, max: 5 }),
                // Pick a lossless label for the "lossless" candidate
                fc.constantFrom('无损', 'Hi-Res'),
                // originalOrder: lossless candidate gets a higher index to ensure
                // the test is not trivially passing due to originalOrder
                fc.nat({ max: 50 }),
                (requestedQuality, score, priority, losslessLabel, baseOrder) => {
                    const losslessCandidate = makeCandidate({
                        score,
                        priority,
                        labels: [losslessLabel],
                        originalOrder: baseOrder + 1, // intentionally higher order
                    });
                    const nonLosslessCandidate = makeCandidate({
                        score,
                        priority,
                        labels: [],
                        originalOrder: baseOrder,     // intentionally lower order
                    });

                    const cmp = comparePreparedSourcesByQuality(
                        losslessCandidate,
                        nonLosslessCandidate,
                        requestedQuality,
                    );

                    assert.ok(
                        cmp < 0,
                        `含 "${losslessLabel}" 标签的候选 (originalOrder=${baseOrder + 1}) 应排在不含标签的候选 (originalOrder=${baseOrder}) 之前，` +
                        `requestedQuality="${requestedQuality}", score=${score}, priority=${priority}, comparator returned ${cmp}`,
                    );
                    return true;
                },
            ),
            { numRuns: 200 },
        );
    });

    it('有损请求下无损标签不影响排序（仍按 score/priority/originalOrder）(fast-check)', () => {
        // **Validates: Requirements 4.3** (complementary: rule only applies to lossless requests)
        fc.assert(
            fc.property(
                fc.constantFrom(...LOSSY_QUALITIES),
                fc.integer({ min: 0, max: 100 }),
                fc.integer({ min: 1, max: 5 }),
                fc.constantFrom('无损', 'Hi-Res'),
                fc.nat({ max: 50 }),
                (requestedQuality, score, priority, losslessLabel, baseOrder) => {
                    // Candidate WITH lossless label but HIGHER originalOrder
                    const withLabel = makeCandidate({
                        score,
                        priority,
                        labels: [losslessLabel],
                        originalOrder: baseOrder + 1,
                    });
                    // Candidate WITHOUT lossless label and LOWER originalOrder
                    const withoutLabel = makeCandidate({
                        score,
                        priority,
                        labels: [],
                        originalOrder: baseOrder,
                    });

                    const cmp = comparePreparedSourcesByQuality(
                        withLabel,
                        withoutLabel,
                        requestedQuality,
                    );

                    // For lossy requests, lossless label must NOT override originalOrder.
                    // withLabel has higher originalOrder, so it should sort AFTER withoutLabel.
                    assert.ok(
                        cmp > 0,
                        `有损请求 "${requestedQuality}" 下，无损标签不应覆盖 originalOrder 排序，` +
                        `含标签候选 (originalOrder=${baseOrder + 1}) 应排在不含标签候选 (originalOrder=${baseOrder}) 之后，comparator returned ${cmp}`,
                    );
                    return true;
                },
            ),
            { numRuns: 200 },
        );
    });

    it('无损请求下两个候选均含无损标签时按 score/priority/originalOrder 排序 (fast-check)', () => {
        // **Validates: Requirements 4.3**
        // When both candidates have lossless labels, the lossless-label rule is a tie,
        // so the normal score/priority/originalOrder rules apply.
        fc.assert(
            fc.property(
                fc.constantFrom(...LOSSLESS_QUALITIES),
                fc.record({
                    score: fc.integer({ min: 0, max: 100 }),
                    priority: fc.integer({ min: 1, max: 5 }),
                    originalOrder: fc.nat({ max: 50 }),
                }),
                fc.record({
                    score: fc.integer({ min: 0, max: 100 }),
                    priority: fc.integer({ min: 1, max: 5 }),
                    originalOrder: fc.nat({ max: 50 }),
                }),
                fc.constantFrom('无损', 'Hi-Res'),
                (requestedQuality, rawA, rawB, label) => {
                    const a = makeCandidate({ ...rawA, labels: [label] });
                    const b = makeCandidate({ ...rawB, labels: [label] });

                    const cmp = comparePreparedSourcesByQuality(a, b, requestedQuality);

                    const aScore = rawA.score;
                    const bScore = rawB.score;
                    const aPriority = rawA.priority;
                    const bPriority = rawB.priority;
                    const aOrder = rawA.originalOrder;
                    const bOrder = rawB.originalOrder;

                    if (aScore !== bScore) {
                        // Higher score should come first (cmp < 0 means a before b)
                        if (aScore > bScore) {
                            assert.ok(cmp < 0, `score 降序违反 (both lossless): a.score=${aScore} > b.score=${bScore} but cmp=${cmp}`);
                        } else {
                            assert.ok(cmp > 0, `score 降序违反 (both lossless): a.score=${aScore} < b.score=${bScore} but cmp=${cmp}`);
                        }
                    } else if (aPriority !== bPriority) {
                        if (aPriority < bPriority) {
                            assert.ok(cmp < 0, `priority 升序违反 (both lossless): a.priority=${aPriority} < b.priority=${bPriority} but cmp=${cmp}`);
                        } else {
                            assert.ok(cmp > 0, `priority 升序违反 (both lossless): a.priority=${aPriority} > b.priority=${bPriority} but cmp=${cmp}`);
                        }
                    } else if (aOrder !== bOrder) {
                        if (aOrder < bOrder) {
                            assert.ok(cmp < 0, `originalOrder 稳定性违反 (both lossless): a.order=${aOrder} < b.order=${bOrder} but cmp=${cmp}`);
                        } else {
                            assert.ok(cmp > 0, `originalOrder 稳定性违反 (both lossless): a.order=${aOrder} > b.order=${bOrder} but cmp=${cmp}`);
                        }
                    } else {
                        // Identical in all dimensions — comparator must return 0
                        assert.strictEqual(cmp, 0, `完全相同的候选 comparator 应返回 0，got ${cmp}`);
                    }

                    return true;
                },
            ),
            { numRuns: 200 },
        );
    });

    it('无损请求下两个候选均不含无损标签时按 score/priority/originalOrder 排序 (fast-check)', () => {
        // **Validates: Requirements 4.3**
        // When neither candidate has lossless labels, normal rules apply.
        fc.assert(
            fc.property(
                fc.constantFrom(...LOSSLESS_QUALITIES),
                fc.record({
                    score: fc.integer({ min: 0, max: 100 }),
                    priority: fc.integer({ min: 1, max: 5 }),
                    originalOrder: fc.nat({ max: 50 }),
                }),
                fc.record({
                    score: fc.integer({ min: 0, max: 100 }),
                    priority: fc.integer({ min: 1, max: 5 }),
                    originalOrder: fc.nat({ max: 50 }),
                }),
                (requestedQuality, rawA, rawB) => {
                    const a = makeCandidate({ ...rawA, labels: [] });
                    const b = makeCandidate({ ...rawB, labels: [] });

                    const cmp = comparePreparedSourcesByQuality(a, b, requestedQuality);

                    const aScore = rawA.score;
                    const bScore = rawB.score;
                    const aPriority = rawA.priority;
                    const bPriority = rawB.priority;
                    const aOrder = rawA.originalOrder;
                    const bOrder = rawB.originalOrder;

                    if (aScore !== bScore) {
                        if (aScore > bScore) {
                            assert.ok(cmp < 0, `score 降序违反 (no labels): a.score=${aScore} > b.score=${bScore} but cmp=${cmp}`);
                        } else {
                            assert.ok(cmp > 0, `score 降序违反 (no labels): a.score=${aScore} < b.score=${bScore} but cmp=${cmp}`);
                        }
                    } else if (aPriority !== bPriority) {
                        if (aPriority < bPriority) {
                            assert.ok(cmp < 0, `priority 升序违反 (no labels): a.priority=${aPriority} < b.priority=${bPriority} but cmp=${cmp}`);
                        } else {
                            assert.ok(cmp > 0, `priority 升序违反 (no labels): a.priority=${aPriority} > b.priority=${bPriority} but cmp=${cmp}`);
                        }
                    } else if (aOrder !== bOrder) {
                        if (aOrder < bOrder) {
                            assert.ok(cmp < 0, `originalOrder 稳定性违反 (no labels): a.order=${aOrder} < b.order=${bOrder} but cmp=${cmp}`);
                        } else {
                            assert.ok(cmp > 0, `originalOrder 稳定性违反 (no labels): a.order=${aOrder} > b.order=${bOrder} but cmp=${cmp}`);
                        }
                    } else {
                        assert.strictEqual(cmp, 0, `完全相同的候选 comparator 应返回 0，got ${cmp}`);
                    }

                    return true;
                },
            ),
            { numRuns: 200 },
        );
    });
});
