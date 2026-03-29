const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { __internal } = require('../lib/updater');

test('decorateSourceContent writes provenance header and extractSourceProvenance reads it back', () => {
    const content = __internal.decorateSourceContent('console.log("ok");\n', {
        repoFullName: 'foo/bar',
        commitSha: 'abcdef1234567890',
        filePath: 'src/source.js',
    });

    assert.match(content, /repo-url: https:\/\/github\.com\/foo\/bar/);
    assert.match(content, /commit: abcdef1234567890/);

    assert.deepEqual(__internal.extractSourceProvenance(content), {
        'repo-url': 'https://github.com/foo/bar',
        repo: 'foo/bar',
        commit: 'abcdef1234567890',
        file: 'src/source.js',
    });
});

test('tryReuseDownloadedSource copies yesterday file when repo and commit match', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-manager-updater-'));
    const previousPath = path.join(tempDir, 'previous.js');
    const outputPath = path.join(tempDir, 'today.js');

    fs.writeFileSync(previousPath, __internal.decorateSourceContent('module.exports = {};\n', {
        repoFullName: 'foo/bar',
        commitSha: 'abcdef1234567890',
        filePath: 'src/source.js',
    }));

    const reused = __internal.tryReuseDownloadedSource(previousPath, outputPath, {
        repoFullName: 'foo/bar',
        commitSha: 'abcdef1234567890',
        filePath: 'src/source.js',
    });

    assert.deepEqual(reused, {
        reused: true,
        type: 'previous',
        fromPath: previousPath,
    });
    assert.equal(fs.existsSync(outputPath), true);
    assert.equal(fs.readFileSync(outputPath, 'utf8'), fs.readFileSync(previousPath, 'utf8'));
});

test('tryReuseDownloadedSource refuses files from a different commit', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-manager-updater-'));
    const previousPath = path.join(tempDir, 'previous.js');
    const outputPath = path.join(tempDir, 'today.js');

    fs.writeFileSync(previousPath, __internal.decorateSourceContent('module.exports = {};\n', {
        repoFullName: 'foo/bar',
        commitSha: 'abcdef1234567890',
        filePath: 'src/source.js',
    }));

    const reused = __internal.tryReuseDownloadedSource(previousPath, outputPath, {
        repoFullName: 'foo/bar',
        commitSha: 'fedcba0987654321',
        filePath: 'src/source.js',
    });

    assert.deepEqual(reused, {
        reused: false,
        type: 'mismatch',
    });
    assert.equal(fs.existsSync(outputPath), false);
});

test('tryReuseDownloadedSource skips copy when target already has the same repo and commit', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-manager-updater-'));
    const previousPath = path.join(tempDir, 'previous.js');
    const outputPath = path.join(tempDir, 'today.js');

    const previousContent = __internal.decorateSourceContent('module.exports = { version: "old" };\n', {
        repoFullName: 'foo/bar',
        commitSha: 'abcdef1234567890',
        filePath: 'src/source.js',
    });
    const currentContent = __internal.decorateSourceContent('module.exports = { version: "current" };\n', {
        repoFullName: 'foo/bar',
        commitSha: 'abcdef1234567890',
        filePath: 'src/source.js',
    });

    fs.writeFileSync(previousPath, previousContent);
    fs.writeFileSync(outputPath, currentContent);

    const reused = __internal.tryReuseDownloadedSource(previousPath, outputPath, {
        repoFullName: 'foo/bar',
        commitSha: 'abcdef1234567890',
        filePath: 'src/source.js',
    });

    assert.deepEqual(reused, {
        reused: true,
        type: 'current',
        fromPath: outputPath,
    });
    assert.equal(fs.readFileSync(outputPath, 'utf8'), currentContent);
});

test('tryReuseDownloadedSource keeps target when current file already has a newer commit', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-manager-updater-'));
    const previousPath = path.join(tempDir, 'previous.js');
    const outputPath = path.join(tempDir, 'today.js');

    const previousContent = __internal.decorateSourceContent('module.exports = { version: "old" };\n', {
        repoFullName: 'foo/bar',
        commitSha: 'abcdef1234567890',
        filePath: 'src/source.js',
    });
    const currentContent = __internal.decorateSourceContent('module.exports = { version: "new" };\n', {
        repoFullName: 'foo/bar',
        commitSha: 'fedcba0987654321',
        filePath: 'src/source.js',
    });

    fs.writeFileSync(previousPath, previousContent);
    fs.writeFileSync(outputPath, currentContent);

    const reused = __internal.tryReuseDownloadedSource(previousPath, outputPath, {
        repoFullName: 'foo/bar',
        commitSha: 'abcdef1234567890',
        filePath: 'src/source.js',
    });

    assert.deepEqual(reused, {
        reused: false,
        type: 'mismatch',
    });
    assert.equal(fs.readFileSync(outputPath, 'utf8'), currentContent);
});
