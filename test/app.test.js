const test = require('node:test');
const assert = require('node:assert/strict');

const { __internal } = require('../app');

test('normalizeRequestBody unwraps double-encoded JSON request bodies', () => {
    assert.deepEqual(
        __internal.normalizeRequestBody('"{\\"source\\":\\"kg\\",\\"quality\\":\\"128k\\"}"'),
        { source: 'kg', quality: '128k' },
    );
});

test('normalizeRequestBody keeps normal objects unchanged', () => {
    const body = { source: 'kg', quality: '128k' };
    assert.equal(__internal.normalizeRequestBody(body), body);
});
