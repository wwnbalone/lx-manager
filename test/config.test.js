'use strict';

/**
 * Tests for parsePositiveIntEnv (lib/config.js)
 *
 * Task 1.2: Unit tests — 需求 5.4
 */

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');

// parsePositiveIntEnv reads process.env lazily on each call, so we can
// set/restore process.env around each test without re-requiring the module.
const { parsePositiveIntEnv } = require('../lib/config');

// Use a dedicated env var name to avoid polluting real config vars.
const TEST_VAR = 'TEST_PARSE_POSITIVE_INT_ENV';

afterEach(() => {
    delete process.env[TEST_VAR];
});

describe('parsePositiveIntEnv', () => {

    // ── Unset / missing variable ─────────────────────────────────────────────

    it('returns defaultValue when the env var is not set', () => {
        delete process.env[TEST_VAR];
        assert.equal(parsePositiveIntEnv(TEST_VAR, 200), 200);
    });

    // ── Valid positive integers ──────────────────────────────────────────────

    it('returns the parsed value for "1" (minimum positive integer)', () => {
        process.env[TEST_VAR] = '1';
        assert.equal(parsePositiveIntEnv(TEST_VAR, 99), 1);
    });

    it('returns the parsed value for "200"', () => {
        process.env[TEST_VAR] = '200';
        assert.equal(parsePositiveIntEnv(TEST_VAR, 99), 200);
    });

    it('returns the parsed value for "9999"', () => {
        process.env[TEST_VAR] = '9999';
        assert.equal(parsePositiveIntEnv(TEST_VAR, 50), 9999);
    });

    it('returns the parsed value when the string has surrounding whitespace ("  42  ")', () => {
        // Number('  42  ') === 42, which is a positive integer
        process.env[TEST_VAR] = '  42  ';
        assert.equal(parsePositiveIntEnv(TEST_VAR, 99), 42);
    });

    // ── Zero ────────────────────────────────────────────────────────────────

    it('returns defaultValue for "0" (zero is not a positive integer)', () => {
        process.env[TEST_VAR] = '0';
        assert.equal(parsePositiveIntEnv(TEST_VAR, 99), 99);
    });

    // ── Negative integers ────────────────────────────────────────────────────

    it('returns defaultValue for "-1"', () => {
        process.env[TEST_VAR] = '-1';
        assert.equal(parsePositiveIntEnv(TEST_VAR, 99), 99);
    });

    it('returns defaultValue for "-100"', () => {
        process.env[TEST_VAR] = '-100';
        assert.equal(parsePositiveIntEnv(TEST_VAR, 200), 200);
    });

    // ── Decimal / floating-point strings ────────────────────────────────────

    it('returns defaultValue for "1.5" (not an integer)', () => {
        process.env[TEST_VAR] = '1.5';
        assert.equal(parsePositiveIntEnv(TEST_VAR, 99), 99);
    });

    it('returns the parsed value for "200.0" (Number("200.0") === 200, which is a positive integer)', () => {
        // Number('200.0') === 200, Number.isInteger(200) === true → valid
        process.env[TEST_VAR] = '200.0';
        assert.equal(parsePositiveIntEnv(TEST_VAR, 99), 200);
    });

    it('returns defaultValue for "3.14"', () => {
        process.env[TEST_VAR] = '3.14';
        assert.equal(parsePositiveIntEnv(TEST_VAR, 99), 99);
    });

    it('returns defaultValue for "-0.5"', () => {
        process.env[TEST_VAR] = '-0.5';
        assert.equal(parsePositiveIntEnv(TEST_VAR, 99), 99);
    });

    // ── Non-numeric strings ──────────────────────────────────────────────────

    it('returns defaultValue for "abc"', () => {
        process.env[TEST_VAR] = 'abc';
        assert.equal(parsePositiveIntEnv(TEST_VAR, 99), 99);
    });

    it('returns defaultValue for "12abc"', () => {
        process.env[TEST_VAR] = '12abc';
        assert.equal(parsePositiveIntEnv(TEST_VAR, 99), 99);
    });

    it('returns defaultValue for "NaN"', () => {
        process.env[TEST_VAR] = 'NaN';
        assert.equal(parsePositiveIntEnv(TEST_VAR, 99), 99);
    });

    it('returns defaultValue for "Infinity"', () => {
        process.env[TEST_VAR] = 'Infinity';
        assert.equal(parsePositiveIntEnv(TEST_VAR, 99), 99);
    });

    // ── Empty / blank strings ────────────────────────────────────────────────

    it('returns defaultValue for an empty string ""', () => {
        process.env[TEST_VAR] = '';
        assert.equal(parsePositiveIntEnv(TEST_VAR, 99), 99);
    });

    it('returns defaultValue for a whitespace-only string "   "', () => {
        process.env[TEST_VAR] = '   ';
        assert.equal(parsePositiveIntEnv(TEST_VAR, 99), 99);
    });

    // ── Does not throw on invalid input ─────────────────────────────────────

    it('does not throw for any invalid value', () => {
        const invalidValues = ['0', '-1', '-100', 'abc', '12abc', '3.14', '', '  ', 'NaN', 'Infinity'];
        for (const val of invalidValues) {
            process.env[TEST_VAR] = val;
            assert.doesNotThrow(() => parsePositiveIntEnv(TEST_VAR, 200));
        }
    });

    // ── Default value is preserved correctly ────────────────────────────────

    it('uses the provided default value (96) when input is invalid', () => {
        process.env[TEST_VAR] = 'bad';
        assert.equal(parsePositiveIntEnv(TEST_VAR, 96), 96);
    });

    it('uses the provided default value (200) when input is "0"', () => {
        process.env[TEST_VAR] = '0';
        assert.equal(parsePositiveIntEnv(TEST_VAR, 200), 200);
    });
});
