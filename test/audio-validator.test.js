const test = require('node:test');
const assert = require('node:assert/strict');

const { __internal } = require('../lib/audio-validator');

test('quality ceiling rejects lossless candidates when requested max is 320k', () => {
    const result = __internal.evaluateRequestedQualityCeiling({
        quality: '320k',
        formatInfo: {
            format: 'flac',
            lossless: true,
            bitsPerSample: 16,
            sampleRate: 44100,
        },
        bitrateKbps: 900,
    });

    assert.deepEqual(result, {
        requestedQuality: '320k',
        requestedRank: 3,
        actualQuality: 'flac',
        actualRank: 4,
        exceeds: true,
    });
});

test('quality ceiling keeps 16-bit wav within flac max quality', () => {
    const result = __internal.evaluateRequestedQualityCeiling({
        quality: 'flac',
        formatInfo: {
            format: 'wav',
            lossless: true,
            bitsPerSample: 16,
            sampleRate: 44100,
        },
        bitrateKbps: 1411,
    });

    assert.equal(result.exceeds, false);
    assert.equal(result.actualQuality, 'flac');
});

test('quality ceiling rejects 24-bit lossless when requested max is flac', () => {
    const result = __internal.evaluateRequestedQualityCeiling({
        quality: 'flac',
        formatInfo: {
            format: 'wav',
            lossless: true,
            bitsPerSample: 24,
            sampleRate: 48000,
        },
        bitrateKbps: 2304,
    });

    assert.deepEqual(result, {
        requestedQuality: 'flac',
        requestedRank: 4,
        actualQuality: 'flac24bit',
        actualRank: 5,
        exceeds: true,
    });
});

test('quality ceiling rejects lossy candidates above 128k max quality', () => {
    const result = __internal.evaluateRequestedQualityCeiling({
        quality: '128k',
        formatInfo: {
            format: 'mp3',
            lossless: false,
            sampleRate: 44100,
        },
        bitrateKbps: 192,
    });

    assert.equal(result.exceeds, true);
    assert.equal(result.actualQuality, '192k');
});

test('quality aliases normalize mp3 requests to the 320k ceiling', () => {
    const result = __internal.evaluateRequestedQualityCeiling({
        quality: 'mp3',
        formatInfo: {
            format: 'mp3',
            lossless: false,
            sampleRate: 44100,
        },
        bitrateKbps: 320,
    });

    assert.equal(result.requestedQuality, '320k');
    assert.equal(result.exceeds, false);
});
