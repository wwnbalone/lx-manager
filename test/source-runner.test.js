const test = require('node:test');
const assert = require('node:assert/strict');

const { __internal } = require('../lib/source-runner');

test('explicit legacy source requests do not fall back to other source keys in the same file', () => {
    const result = __internal.selectLegacySource({
        wy: {
            getMusicUrl() {
                return 'https://example.com/wy.mp3';
            },
        },
    }, 'url', {
        source: 'kg',
        musicInfo: {
            source: 'kg',
        },
    });

    assert.equal(result, null);
});

test('explicit event source requests only match the requested source key', () => {
    const result = __internal.selectEventSource({
        wy: {
            actions: ['musicUrl'],
        },
        kg: {
            actions: ['musicUrl'],
        },
    }, 'url', {
        source: 'kg',
        musicInfo: {
            source: 'kg',
        },
    });

    assert.deepEqual(result, {
        sourceKey: 'kg',
        action: 'musicUrl',
    });
});

test('aggregate local requests can still fall back across source keys', () => {
    const result = __internal.selectEventSource({
        wy: {
            actions: ['musicUrl'],
        },
    }, 'url', {
        source: 'local',
        musicInfo: {
            source: 'kg',
        },
    });

    assert.deepEqual(result, {
        sourceKey: 'wy',
        action: 'musicUrl',
    });
});

test('update request detector matches known source update URLs', () => {
    assert.equal(
        __internal.isSourceUpdateRequest('https://m-api.ceseet.me/script?key=&checkUpdate=abc'),
        true,
    );
    assert.equal(
        __internal.isSourceUpdateRequest('https://88.lxmusic.xn--fiqs8s/script?key=lxmusic'),
        true,
    );
    assert.equal(
        __internal.isSourceUpdateRequest('https://m-api.ceseet.me/url/kg/123/128k'),
        false,
    );
});
