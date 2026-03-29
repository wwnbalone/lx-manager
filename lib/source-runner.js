const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');

const axios = require('axios');

const {
    UA,
    requestHttpsAgent,
    SOURCE_DISABLE_UPDATE_CHECK,
} = require('./config');
const { createConsoleBridge, createLogger } = require('./logger');
const {
    BASE_DIR,
    copyFolderSources,
    getDateStr,
    getTodayDir,
    listDateFolders,
    listSourceFiles,
} = require('./source-store');

const EXECUTOR_CACHE = new Map();
const EVENT_NAMES = {
    request: 'request',
    inited: 'inited',
    updateAlert: 'updateAlert',
};
const LEGACY_METHOD_MAP = {
    search: ['search', 'musicSearch'],
    url: ['getMusicUrl', 'musicUrl'],
    lyric: ['lyric', 'getLyric'],
    pic: ['pic', 'getPic'],
};
const logger = createLogger('source-runner');

function md5(input) {
    return crypto.createHash('md5').update(String(input)).digest('hex');
}

function sanitizeHeaderValue(value) {
    return String(value).replace(/[^\t\x20-\x7e\x80-\xff]/g, '').trim();
}

function sanitizeHeaders(headers = {}) {
    const normalized = {};

    for (const [key, value] of Object.entries(headers)) {
        if (value == null) continue;
        const sanitized = sanitizeHeaderValue(value);
        if (!sanitized) continue;
        normalized[key] = sanitized;
    }

    if (!normalized['User-Agent']) normalized['User-Agent'] = UA;

    return normalized;
}

function toBuffer(input, encoding = 'utf8') {
    if (Buffer.isBuffer(input)) return input;
    if (input instanceof Uint8Array) return Buffer.from(input);
    if (typeof input === 'string') return Buffer.from(input, encoding);
    if (input == null) return Buffer.alloc(0);
    return Buffer.from(String(input), encoding);
}

function parseScriptInfo(code, filename) {
    const readMeta = field => code.match(new RegExp(`@${field}\\s+([^\\r\\n]+)`))?.[1]?.trim() || '';

    return {
        name: readMeta('name') || filename,
        description: readMeta('description'),
        version: readMeta('version'),
        author: readMeta('author'),
        homepage: readMeta('homepage') || readMeta('repository'),
        rawScript: code,
    };
}

function isIdentifierChar(char) {
    return Boolean(char) && /[A-Za-z0-9_$]/.test(char);
}

function rewriteCheckUpdateInvocations(code) {
    if (!code.includes('checkUpdate()')) {
        return {
            code,
            replacements: 0,
        };
    }

    const replacement = '__lxSafeCheckUpdate(checkUpdate)';
    let replacements = 0;
    let index = 0;
    let output = '';
    let state = 'normal';

    while (index < code.length) {
        const char = code[index];
        const nextChar = code[index + 1];

        if (state === 'line_comment') {
            output += char;
            index += 1;
            if (char === '\n') state = 'normal';
            continue;
        }

        if (state === 'block_comment') {
            output += char;
            index += 1;
            if (char === '*' && nextChar === '/') {
                output += nextChar;
                index += 1;
                state = 'normal';
            }
            continue;
        }

        if (state === 'single_quote' || state === 'double_quote' || state === 'template') {
            output += char;
            index += 1;

            if (char === '\\' && index < code.length) {
                output += code[index];
                index += 1;
                continue;
            }

            if (
                (state === 'single_quote' && char === '\'')
                || (state === 'double_quote' && char === '"')
                || (state === 'template' && char === '`')
            ) {
                state = 'normal';
            }
            continue;
        }

        if (char === '/' && nextChar === '/') {
            output += char + nextChar;
            index += 2;
            state = 'line_comment';
            continue;
        }

        if (char === '/' && nextChar === '*') {
            output += char + nextChar;
            index += 2;
            state = 'block_comment';
            continue;
        }

        if (char === '\'') {
            output += char;
            index += 1;
            state = 'single_quote';
            continue;
        }

        if (char === '"') {
            output += char;
            index += 1;
            state = 'double_quote';
            continue;
        }

        if (char === '`') {
            output += char;
            index += 1;
            state = 'template';
            continue;
        }

        if (
            code.startsWith('checkUpdate()', index)
            && !isIdentifierChar(code[index - 1])
            && !isIdentifierChar(code[index + 'checkUpdate()'.length])
        ) {
            output += replacement;
            index += 'checkUpdate()'.length;
            replacements += 1;
            continue;
        }

        output += char;
        index += 1;
    }

    return {
        code: replacements > 0 ? output : code,
        replacements,
    };
}

function preprocessSourceCode(code) {
    return rewriteCheckUpdateInvocations(code);
}

function formatSandboxError(error) {
    if (error instanceof Error) {
        return {
            message: error.message,
            stack: error.stack,
            code: error.code,
            host: error.host,
            port: error.port,
        };
    }

    return error;
}

function createSafeAsyncInvoker(consoleBridge, label) {
    return callback => {
        if (typeof callback !== 'function') return Promise.resolve(null);

        return Promise.resolve()
            .then(() => callback())
            .catch(error => {
                consoleBridge.warn(`${label} rejected`, formatSandboxError(error));
                return null;
            });
    };
}

function createCheckUpdateInvoker(consoleBridge) {
    if (!SOURCE_DISABLE_UPDATE_CHECK) {
        return createSafeAsyncInvoker(consoleBridge, 'checkUpdate');
    }

    return callback => {
        if (typeof callback === 'function') {
            consoleBridge.debug('checkUpdate skipped by config');
        }
        return Promise.resolve(null);
    };
}

function isSourceUpdateRequest(url) {
    if (!url) return false;

    const text = String(url);
    return text.includes('checkUpdate=')
        || /\/script(?:\?|$)/.test(text);
}

function wrapAsyncCallback(callback, consoleBridge, label) {
    if (typeof callback !== 'function') return callback;

    return (...args) => {
        try {
            const result = callback(...args);

            if (result && typeof result.then === 'function') {
                result.catch(error => {
                    consoleBridge.warn(`${label} rejected`, formatSandboxError(error));
                });
            }

            return result;
        } catch (error) {
            consoleBridge.warn(`${label} threw`, formatSandboxError(error));
            return undefined;
        }
    };
}

function createSafeTimer(setter, consoleBridge, label) {
    return (callback, delay, ...args) => setter(
        wrapAsyncCallback(callback, consoleBridge, label),
        delay,
        ...args,
    );
}

function createUtilsBridge() {
    const runZlib = method => input => new Promise((resolve, reject) => {
        zlib[method](toBuffer(input), (error, buffer) => {
            if (error) reject(error);
            else resolve(buffer);
        });
    });

    return {
        buffer: {
            from: (value, encoding) => Buffer.from(value, encoding),
            bufToString: (value, encoding) => toBuffer(value).toString(encoding),
        },
        crypto: {
            md5,
            randomBytes: size => crypto.randomBytes(Number(size) || 0).toString('hex'),
            aesEncrypt(data, mode, key, iv) {
                const algorithm = String(mode || 'aes-128-cbc').toLowerCase();
                const cipher = crypto.createCipheriv(
                    algorithm,
                    toBuffer(key),
                    algorithm.includes('-ecb') ? null : toBuffer(iv),
                );

                return Buffer.concat([
                    cipher.update(toBuffer(data)),
                    cipher.final(),
                ]);
            },
            rsaEncrypt(data, key) {
                return crypto.publicEncrypt(key, toBuffer(data));
            },
        },
        zlib: {
            inflate: runZlib('inflate'),
            deflate: runZlib('deflate'),
        },
    };
}

function createLxBridge(scriptInfo) {
    const handlers = new Map();
    let initPayload = null;

    const lx = {
        EVENT_NAMES,
        env: 'desktop',
        version: '2.6.0',
        utils: createUtilsBridge(),
        currentScriptInfo: scriptInfo,
        request(url, options = {}, callback = () => {}) {
            if (SOURCE_DISABLE_UPDATE_CHECK && isSourceUpdateRequest(url)) {
                callback(null, {
                    statusCode: 204,
                    headers: {},
                    body: null,
                }, null);
                return () => {};
            }

            const controller = new AbortController();

            axios({
                url,
                method: options.method || 'GET',
                data: options.body,
                timeout: options.timeout || 15000,
                httpsAgent: requestHttpsAgent,
                proxy: false,
                signal: controller.signal,
                headers: sanitizeHeaders({
                    'User-Agent': UA,
                    ...(options.headers || {}),
                }),
            }).then(response => {
                const payload = {
                    statusCode: response.status,
                    headers: response.headers,
                    body: response.data,
                };
                callback(null, payload, payload.body);
            }).catch(error => {
                const payload = {
                    statusCode: error.response?.status || 500,
                    headers: error.response?.headers || {},
                    body: error.response?.data ?? null,
                };
                callback(error, payload, payload.body);
            });

            return () => controller.abort();
        },
        on(eventName, handler) {
            handlers.set(eventName, handler);
        },
        send(eventName, payload) {
            if (eventName === EVENT_NAMES.updateAlert) return;
            if (eventName === EVENT_NAMES.inited) initPayload = payload;
        },
    };

    return {
        lx,
        getRequestHandler() {
            return handlers.get(EVENT_NAMES.request);
        },
        getInitPayload() {
            return initPayload;
        },
    };
}

function buildFallbackMusicInfo(payload = {}) {
    return {
        hash: payload.id,
        songmid: payload.id,
        id: payload.id,
        source: payload.source,
    };
}

function getPreferredSourceKey(payload = {}) {
    return payload.source || payload.musicInfo?.source || null;
}

function shouldPinToPreferredSource(preferredSourceKey) {
    return Boolean(preferredSourceKey && preferredSourceKey !== 'local');
}

function buildCandidateSourceKeys(sources, method, preferredSourceKey) {
    const keys = [];
    const seen = new Set();

    const pushKey = key => {
        if (!key) return;
        if (seen.has(key)) return;
        if (!Object.prototype.hasOwnProperty.call(sources || {}, key)) return;
        seen.add(key);
        keys.push(key);
    };

    pushKey(preferredSourceKey);

    // Explicit platform requests must stay on that platform inside a single file.
    // Aggregate mode (`local`) can still probe other declared source keys.
    if (shouldPinToPreferredSource(preferredSourceKey)) {
        return keys;
    }

    const defaultKeys = method === 'lyric' || method === 'pic'
        ? ['local']
        : ['kw', 'tx', 'wy', 'kg', 'mg', 'local'];

    defaultKeys.forEach(pushKey);
    Object.keys(sources || {}).forEach(pushKey);

    return keys;
}

function findLegacyMethod(sourceConfig, method) {
    const methodNames = LEGACY_METHOD_MAP[method] || [];
    return methodNames.find(name => typeof sourceConfig?.[name] === 'function') || null;
}

function supportsLegacyMethod(sourceConfig, method) {
    return Boolean(findLegacyMethod(sourceConfig, method));
}

function selectLegacySource(sources, method, payload) {
    const preferredSourceKey = getPreferredSourceKey(payload);

    for (const sourceKey of buildCandidateSourceKeys(sources, method, preferredSourceKey)) {
        const sourceConfig = sources[sourceKey];
        const methodName = findLegacyMethod(sourceConfig, method);
        if (!methodName) continue;

        return {
            sourceKey,
            sourceConfig,
            methodName,
        };
    }

    return null;
}

function hasAction(config, action) {
    return Array.isArray(config?.actions) && config.actions.includes(action);
}

function findEventAction(config, method) {
    if (!config) return null;

    switch (method) {
        case 'search':
            if (hasAction(config, 'search')) return 'search';
            if (hasAction(config, 'musicSearch')) return 'musicSearch';
            return null;
        case 'url':
            return hasAction(config, 'musicUrl') ? 'musicUrl' : null;
        case 'lyric':
            return hasAction(config, 'lyric') ? 'lyric' : null;
        case 'pic':
            return hasAction(config, 'pic') ? 'pic' : null;
        default:
            return null;
    }
}

function selectEventSource(sources, method, payload) {
    const preferredSourceKey = getPreferredSourceKey(payload);

    for (const sourceKey of buildCandidateSourceKeys(sources, method, preferredSourceKey)) {
        const action = findEventAction(sources[sourceKey], method);
        if (!action) continue;

        return {
            sourceKey,
            action,
        };
    }

    return null;
}

function createLegacyExecutor(scriptInfo, source) {
    return {
        kind: 'legacy',
        scriptInfo,
        supports(method, payload) {
            return Boolean(selectLegacySource(source.sources || {}, method, payload));
        },
        async invoke(method, payload) {
            const selected = selectLegacySource(source.sources || {}, method, payload);
            if (!selected) return null;

            const handler = selected.sourceConfig[selected.methodName].bind(selected.sourceConfig);

            switch (method) {
                case 'search':
                    return handler(payload.keyword, payload.page, payload.limit);
                case 'url':
                    return handler(payload.musicInfo || buildFallbackMusicInfo(payload), payload.quality);
                case 'lyric':
                case 'pic':
                    return handler(payload.musicInfo || buildFallbackMusicInfo(payload));
                default:
                    return null;
            }
        },
    };
}

function createEventExecutor(scriptInfo, requestHandler, initPayload) {
    const sources = initPayload?.sources || {};

    return {
        kind: 'event',
        scriptInfo,
        supports(method, payload) {
            return Boolean(selectEventSource(sources, method, payload));
        },
        async invoke(method, payload) {
            const selected = selectEventSource(sources, method, payload);
            if (!selected) return null;

            switch (method) {
                case 'search':
                    return requestHandler({
                        action: selected.action,
                        source: selected.sourceKey,
                        info: {
                            keyword: payload.keyword,
                            page: payload.page,
                            limit: payload.limit,
                        },
                    });
                case 'url':
                    return requestHandler({
                        action: selected.action,
                        source: selected.sourceKey,
                        info: {
                            type: payload.quality,
                            musicInfo: payload.musicInfo || buildFallbackMusicInfo(payload),
                        },
                    });
                case 'lyric':
                case 'pic':
                    return requestHandler({
                        action: selected.action,
                        source: selected.sourceKey,
                        info: {
                            musicInfo: payload.musicInfo || buildFallbackMusicInfo(payload),
                        },
                    });
                default:
                    return null;
            }
        },
    };
}

function buildExecutor(filePath) {
    const code = fs.readFileSync(filePath, 'utf8');
    const scriptInfo = parseScriptInfo(code, path.basename(filePath));
    const { code: executableCode, replacements } = preprocessSourceCode(code);
    const bridge = createLxBridge(scriptInfo);
    const sourceConsole = createConsoleBridge(`source:${path.basename(filePath)}`);

    if (replacements > 0) {
        logger.info('applied source safety transforms', {
            file: path.basename(filePath),
            checkUpdateWrappers: replacements,
        });
    }

    const sandbox = {
        console: sourceConsole,
        Buffer,
        URLSearchParams,
        Promise,
        TextEncoder,
        TextDecoder,
        Uint8Array,
        setTimeout: createSafeTimer(setTimeout, sourceConsole, 'setTimeout callback'),
        clearTimeout,
        setInterval: createSafeTimer(setInterval, sourceConsole, 'setInterval callback'),
        clearInterval,
        module: { exports: {} },
        exports: {},
        log: (...args) => logger.info('sandbox log', args),
        lx: bridge.lx,
        __lxSafeCheckUpdate: createCheckUpdateInvoker(sourceConsole),
    };
    sandbox.globalThis = sandbox;

    vm.createContext(sandbox);
    vm.runInContext(executableCode, sandbox, { filename: filePath, timeout: 5000 });

    const legacySource = sandbox.module.exports;
    if (legacySource && typeof legacySource === 'object' && legacySource.sources) {
        return createLegacyExecutor(scriptInfo, legacySource);
    }

    const requestHandler = bridge.getRequestHandler();
    const initPayload = bridge.getInitPayload();
    if (typeof requestHandler === 'function' && initPayload?.sources) {
        return createEventExecutor(scriptInfo, requestHandler, initPayload);
    }

    return null;
}

function loadExecutor(filePath) {
    const stat = fs.statSync(filePath);
    const cached = EXECUTOR_CACHE.get(filePath);

    if (cached && cached.mtimeMs === stat.mtimeMs) {
        return cached.executor;
    }

    let executor = null;
    try {
        executor = buildExecutor(filePath);
    } catch (error) {
        logger.warn(`skip invalid source: ${path.basename(filePath)}`, {
            error: error.message,
        });
    }

    EXECUTOR_CACHE.set(filePath, { mtimeMs: stat.mtimeMs, executor });
    return executor;
}

function isMeaningfulSearchResult(result) {
    if (Array.isArray(result)) return result.length > 0;
    if (Array.isArray(result?.list)) return result.list.length > 0;
    if (Array.isArray(result?.data)) return result.data.length > 0;
    if (Array.isArray(result?.songs)) return result.songs.length > 0;
    return Boolean(result);
}

function isMeaningfulUrlLikeResult(result) {
    if (typeof result === 'string') return result.trim().length > 0;
    if (typeof result?.url === 'string') return result.url.trim().length > 0;
    if (typeof result?.data === 'string') return result.data.trim().length > 0;
    if (typeof result?.data?.url === 'string') return result.data.url.trim().length > 0;
    return Boolean(result);
}

function isMeaningfulResult(method, result) {
    if (result == null) return false;

    switch (method) {
        case 'search':
            return isMeaningfulSearchResult(result);
        case 'url':
        case 'pic':
            return isMeaningfulUrlLikeResult(result);
        case 'lyric':
            if (typeof result === 'string') return result.trim().length > 0;
            if (typeof result?.lyric === 'string') return result.lyric.trim().length > 0;
            return Boolean(result);
        default:
            return Boolean(result);
    }
}

async function evaluateCandidate({ method, payload, options, folder, file, executor, order }) {
    const result = await executor.invoke(method, payload);
    if (!isMeaningfulResult(method, result)) return null;

    const candidate = {
        order,
        result,
        meta: {
            folder,
            file,
            kind: executor.kind,
            scriptInfo: executor.scriptInfo,
        },
        validation: null,
    };

    if (typeof options.validateResult === 'function') {
        const validation = await options.validateResult({
            method,
            payload,
            result,
            meta: candidate.meta,
        });
        candidate.validation = validation || null;

        if (validation && validation.ok === false) {
            logger.warn(`candidate validation failed: ${file}`, {
                reason: validation.reason || 'unknown',
                details: validation.details || null,
            });
            return null;
        }
    }

    return candidate;
}

function compareCandidates(candidate, currentBest, compareValidatedResults) {
    const compareResult = typeof compareValidatedResults === 'function'
        ? compareValidatedResults(candidate, currentBest)
        : (Number(candidate.validation?.score || 0) - Number(currentBest.validation?.score || 0));

    if (compareResult !== 0) return compareResult;
    return currentBest.order - candidate.order;
}

async function selectBestInFolderWithinWindow({ method, payload, options, folder, files }) {
    const maxCandidates = Math.max(1, Number(options.maxCandidates) || files.length);
    const maxConcurrent = Math.max(1, Number(options.maxConcurrentRequests) || 1);
    const selectionWindowMs = Math.max(300, Number(options.selectionWindowMs) || 0);
    const deadlineAt = Date.now() + selectionWindowMs;
    const prepared = [];

    for (const [index, file] of files.entries()) {
        if (prepared.length >= maxCandidates) break;

        const filePath = path.join(path.join(BASE_DIR, folder), file);
        const executor = loadExecutor(filePath);
        if (!executor || !executor.supports(method, payload)) continue;

        prepared.push({
            order: index,
            file,
            executor,
        });
    }

    if (!prepared.length) return null;

    let cursor = 0;
    let bestCandidate = null;
    const running = new Set();

    const launchNext = () => {
        while (cursor < prepared.length && running.size < maxConcurrent && Date.now() < deadlineAt) {
            const current = prepared[cursor++];
            const task = evaluateCandidate({
                method,
                payload,
                options,
                folder,
                file: current.file,
                executor: current.executor,
                order: current.order,
            }).then(candidate => {
                if (candidate) {
                    if (!bestCandidate || compareCandidates(candidate, bestCandidate, options.compareValidatedResults) > 0) {
                        bestCandidate = candidate;
                    }
                }
                return candidate;
            }).catch(error => {
                logger.warn(`candidate invoke failed: ${current.file}`, {
                    error: error.message,
                });
                return null;
            }).finally(() => {
                running.delete(task);
            });

            running.add(task);
        }
    };

    launchNext();

    while (running.size > 0 && Date.now() < deadlineAt) {
        const remainingMs = deadlineAt - Date.now();
        if (remainingMs <= 0) break;

        await Promise.race([
            Promise.race(Array.from(running)),
            new Promise(resolve => setTimeout(resolve, remainingMs)),
        ]);

        launchNext();
    }

    return bestCandidate;
}

async function smartDispatch(method, payload = {}, options = {}) {
    const todayStr = getDateStr(0);
    const todayDir = getTodayDir();
    const dispatchFolders = listDateFolders()
        .map(folder => ({
            folder,
            folderPath: path.join(BASE_DIR, folder),
        }))
        .map(entry => ({
            ...entry,
            files: listSourceFiles(entry.folderPath),
        }))
        .filter(entry => entry.files.length > 0);

    for (const { folder, folderPath, files } of dispatchFolders) {
        logger.info(`dispatch folder ${folder}`, {
            method,
            requestedSource: payload.source || payload.musicInfo?.source || null,
            fileCount: files.length,
        });

        if (options.selectBestResult && options.selectionWindowMs) {
            const bestInFolder = await selectBestInFolderWithinWindow({
                method,
                payload,
                options,
                folder,
                files,
            });

            if (bestInFolder) {
                if (folder !== todayStr && listSourceFiles(todayDir).length === 0) {
                    logger.info(`restoring folder ${folder} into ${todayStr}`);
                    copyFolderSources(folderPath, todayDir);
                }

                logger.info('selected best candidate within window', {
                    folder,
                    file: bestInFolder.meta.file,
                    score: bestInFolder.validation?.score || 0,
                    validation: bestInFolder.validation || null,
                });

                return {
                    result: bestInFolder.result,
                    meta: bestInFolder.meta,
                    validation: bestInFolder.validation,
                };
            }

            continue;
        }

        let bestInFolder = null;

        for (const file of files) {
            const filePath = path.join(folderPath, file);
            const executor = loadExecutor(filePath);
            if (!executor || !executor.supports(method, payload)) continue;

            try {
                const candidate = await evaluateCandidate({
                    method,
                    payload,
                    options,
                    folder,
                    file,
                    executor,
                    order: files.indexOf(file),
                });
                if (!candidate) continue;

                if (!options.selectBestResult) {
                    if (folder !== todayStr && listSourceFiles(todayDir).length === 0) {
                        logger.info(`restoring folder ${folder} into ${todayStr}`);
                        copyFolderSources(folderPath, todayDir);
                    }

                    return {
                        result: candidate.result,
                        meta: candidate.meta,
                        validation: candidate.validation,
                    };
                }

                if (!bestInFolder) {
                    bestInFolder = candidate;
                    continue;
                }

                if (compareCandidates(candidate, bestInFolder, options.compareValidatedResults) > 0) {
                    bestInFolder = candidate;
                }
            } catch (error) {
                logger.warn(`candidate invoke failed: ${file}`, {
                    error: error.message,
                });
            }
        }

        if (bestInFolder) {
            if (folder !== todayStr && listSourceFiles(todayDir).length === 0) {
                logger.info(`restoring folder ${folder} into ${todayStr}`);
                copyFolderSources(folderPath, todayDir);
            }

            logger.info('selected best candidate', {
                folder,
                file: bestInFolder.meta.file,
                score: bestInFolder.validation?.score || 0,
                validation: bestInFolder.validation || null,
            });

            return {
                result: bestInFolder.result,
                meta: bestInFolder.meta,
                validation: bestInFolder.validation,
            };
        }
    }

    return null;
}

module.exports = {
    smartDispatch,
    __internal: {
        buildCandidateSourceKeys,
        isSourceUpdateRequest,
        getPreferredSourceKey,
        selectLegacySource,
        selectEventSource,
        shouldPinToPreferredSource,
    },
};
