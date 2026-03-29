const express = require('express');

const {
    HOST,
    PORT,
    URL_SELECT_WINDOW_MS,
    URL_MAX_CONCURRENT_REQUESTS,
    URL_MAX_CANDIDATES,
} = require('./lib/config');
const { validateAudioUrlCandidate } = require('./lib/audio-validator');
const { createLogger, startLogMaintenance, LOG_RULES } = require('./lib/logger');
const { normalizeUrlResult, unwrapKnownEnvelope } = require('./lib/source-response');
const { smartDispatch } = require('./lib/source-runner');
const { buildSubscriptionScript } = require('./lib/subscription-script');

const logger = createLogger('app');
startLogMaintenance();
let processHandlersRegistered = false;
const runtimeInstanceId = `${process.pid}-${Date.now()}`;

function captureRawBody(req, res, buffer, encoding) {
    req.rawBody = buffer?.length
        ? buffer.toString(encoding || 'utf8')
        : '';
}

function getRawBodyPreview(rawBody, maxLength = 600) {
    if (typeof rawBody !== 'string') return undefined;
    const trimmed = rawBody.trim();
    if (!trimmed) return undefined;
    if (trimmed.length <= maxLength) return trimmed;
    return `${trimmed.slice(0, maxLength)}... <truncated ${trimmed.length - maxLength} chars>`;
}

function normalizeRequestBody(body) {
    let value = body;

    for (let depth = 0; depth < 3; depth += 1) {
        if (typeof value !== 'string') break;

        const trimmed = value.trim();
        if (!trimmed) break;
        if (!/^[\[{"]/.test(trimmed)) break;

        try {
            value = JSON.parse(trimmed);
        } catch {
            break;
        }
    }

    return value;
}

function getRequestBody(req) {
    return normalizeRequestBody(req.body);
}

function getClientIp(req) {
    const forwardedFor = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    return forwardedFor || req.ip || req.socket?.remoteAddress || '';
}

function summarizeRequestMusicInfo(musicInfo) {
    if (!musicInfo || typeof musicInfo !== 'object') return null;

    return {
        id: musicInfo.id,
        songmid: musicInfo.songmid,
        hash: musicInfo.hash,
        name: musicInfo.name,
        singer: musicInfo.singer,
        interval: musicInfo.interval || musicInfo.duration || musicInfo.dt || null,
        source: musicInfo.source,
    };
}

function getBaseUrl(req) {
    const requestedBaseUrl = String(req.query.baseUrl || '').trim();
    if (requestedBaseUrl) return requestedBaseUrl.replace(/\/+$/, '');

    const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
    const protocol = forwardedProto || req.protocol || 'http';
    return `${protocol}://${req.get('host')}`.replace(/\/+$/, '');
}

function normalizeMusicInfo(musicInfo, source) {
    if (!musicInfo || typeof musicInfo !== 'object') return null;

    return {
        ...musicInfo,
        source: musicInfo.source || source,
    };
}

function normalizeLyricResult(result) {
    const unwrapped = unwrapKnownEnvelope(result);
    if (!unwrapped.ok) return null;

    const value = unwrapped.value;
    if (!value) return null;
    if (typeof value === 'string') {
        return {
            lyric: value,
            tlyric: '',
            rlyric: '',
            lxlyric: '',
        };
    }

    return {
        lyric: typeof value.lyric === 'string' ? value.lyric : '',
        tlyric: typeof value.tlyric === 'string' ? value.tlyric : '',
        rlyric: typeof value.rlyric === 'string' ? value.rlyric : '',
        lxlyric: typeof value.lxlyric === 'string' ? value.lxlyric : '',
    };
}

function createApp() {
    const app = express();

    app.disable('x-powered-by');
    app.use(express.json({
        limit: '1mb',
        strict: false,
        verify: captureRawBody,
    }));

    app.use((req, res, next) => {
        if (!req.path.startsWith('/proxy/')) {
            next();
            return;
        }

        const requestBody = getRequestBody(req);
        logger.info('proxy request received', {
            instanceId: runtimeInstanceId,
            method: req.method,
            path: req.path,
            ip: getClientIp(req),
            query: req.query,
            body: req.method === 'POST'
                ? {
                    source: requestBody?.source,
                    quality: requestBody?.quality,
                    keyword: requestBody?.keyword,
                    musicInfo: summarizeRequestMusicInfo(requestBody?.musicInfo),
                }
                : undefined,
        });

        next();
    });

    app.get('/', (req, res) => {
        res.json({
            name: 'lx-manager',
            ok: true,
            endpoints: {
                health: '/health',
                customSource: '/custom-source.js',
                proxyUrl: '/proxy/url',
                proxyLyric: '/proxy/lyric',
                proxyPic: '/proxy/pic',
                proxySearch: '/proxy/search',
            },
        });
    });

    app.get('/health', (req, res) => {
        res.json({ ok: true });
    });

    app.get(['/custom-source.js', '/subscription'], (req, res) => {
        const baseUrl = getBaseUrl(req);
        res.type('application/javascript; charset=utf-8').send(buildSubscriptionScript(baseUrl));
    });

    app.get('/proxy/search', async (req, res, next) => {
        try {
            const keyword = String(req.query.q || req.query.keyword || '').trim();
            if (!keyword) {
                res.status(400).json({ error: '缺少搜索关键词' });
                return;
            }

            const page = Math.max(Number(req.query.page) || 1, 1);
            const limit = Math.max(Number(req.query.limit) || 20, 1);
            const source = String(req.query.source || '').trim() || undefined;

            const response = await smartDispatch('search', {
                keyword,
                page,
                limit,
                source,
            });

            if (!response) {
                res.status(404).json({ error: '未找到可用搜索源' });
                return;
            }

            res.json({
                ok: true,
                meta: response.meta,
                data: response.result,
            });
            logger.info('search resolved', {
                keyword,
                page,
                limit,
                source,
                meta: response.meta,
            });
        } catch (error) {
            next(error);
        }
    });

    app.post('/proxy/url', async (req, res, next) => {
        try {
            const body = getRequestBody(req);
            const source = String(body?.source || '').trim() || undefined;
            const quality = String(body?.quality || '128k').trim() || '128k';
            const musicInfo = normalizeMusicInfo(body?.musicInfo, source);

            if (!musicInfo) {
                res.status(400).json({ error: '缺少歌曲信息' });
                return;
            }

            const response = await smartDispatch('url', {
                source,
                quality,
                musicInfo,
            }, {
                selectBestResult: true,
                selectionWindowMs: URL_SELECT_WINDOW_MS,
                maxConcurrentRequests: URL_MAX_CONCURRENT_REQUESTS,
                maxCandidates: URL_MAX_CANDIDATES,
                validateResult: async ({ result, meta }) => {
                    const unwrapped = unwrapKnownEnvelope(result);
                    if (!unwrapped.ok) {
                        return {
                            ok: false,
                            reason: unwrapped.reason,
                            details: unwrapped.details,
                        };
                    }

                    const candidateUrl = normalizeUrlResult(result);
                    if (!candidateUrl) {
                        return {
                            ok: false,
                            reason: 'invalid_candidate_url',
                        };
                    }

                    const validation = await validateAudioUrlCandidate(candidateUrl, {
                        quality,
                        musicInfo,
                    });

                    if (!validation.ok) {
                        logger.warn('filtered suspicious audio candidate', {
                            sourceFile: meta.file,
                            reason: validation.reason,
                            details: validation.details,
                        });
                    }

                    return validation;
                },
                compareValidatedResults: (candidate, currentBest) => {
                    return Number(candidate.validation?.score || 0) - Number(currentBest.validation?.score || 0);
                },
            });

            if (!response) {
                res.status(404).json({ error: '未找到可用音源' });
                return;
            }

            const url = normalizeUrlResult(response.result);
            if (!url) {
                res.status(502).json({ error: '音源返回了无效的播放链接', meta: response.meta });
                return;
            }

            res.json({
                ok: true,
                meta: response.meta,
                url,
            });
            logger.info('url resolved', {
                source,
                quality,
                musicInfo: {
                    id: musicInfo.id,
                    songmid: musicInfo.songmid,
                    hash: musicInfo.hash,
                    name: musicInfo.name,
                    singer: musicInfo.singer,
                },
                meta: response.meta,
                validation: response.validation || null,
                url,
            });
        } catch (error) {
            next(error);
        }
    });

    app.post('/proxy/lyric', async (req, res, next) => {
        try {
            const body = getRequestBody(req);
            const source = String(body?.source || 'local').trim() || 'local';
            const musicInfo = normalizeMusicInfo(body?.musicInfo, source);

            if (!musicInfo) {
                res.status(400).json({ error: '缺少歌曲信息' });
                return;
            }

            const response = await smartDispatch('lyric', {
                source,
                musicInfo,
            });

            if (!response) {
                res.status(404).json({ error: '未找到可用歌词源' });
                return;
            }

            const lyric = normalizeLyricResult(response.result);
            if (!lyric) {
                res.status(502).json({ error: '歌词源返回了无效数据', meta: response.meta });
                return;
            }

            res.json(lyric);
            logger.info('lyric resolved', {
                source,
                musicInfo: {
                    id: musicInfo.id,
                    songmid: musicInfo.songmid,
                    hash: musicInfo.hash,
                    name: musicInfo.name,
                    singer: musicInfo.singer,
                },
                meta: response.meta,
            });
        } catch (error) {
            next(error);
        }
    });

    app.post('/proxy/pic', async (req, res, next) => {
        try {
            const body = getRequestBody(req);
            const source = String(body?.source || 'local').trim() || 'local';
            const musicInfo = normalizeMusicInfo(body?.musicInfo, source);

            if (!musicInfo) {
                res.status(400).json({ error: '缺少歌曲信息' });
                return;
            }

            const response = await smartDispatch('pic', {
                source,
                musicInfo,
            });

            if (!response) {
                res.status(404).json({ error: '未找到可用封面源' });
                return;
            }

            const url = normalizeUrlResult(response.result);
            if (!url) {
                res.status(502).json({ error: '封面源返回了无效链接', meta: response.meta });
                return;
            }

            res.json({
                ok: true,
                meta: response.meta,
                url,
            });
            logger.info('pic resolved', {
                source,
                musicInfo: {
                    id: musicInfo.id,
                    songmid: musicInfo.songmid,
                    hash: musicInfo.hash,
                    name: musicInfo.name,
                    singer: musicInfo.singer,
                },
                meta: response.meta,
                url,
            });
        } catch (error) {
            next(error);
        }
    });

    app.use((error, req, res, next) => {
        logger.error('request failed', {
            method: req.method,
            path: req.path,
            query: req.query,
            error: error.message,
            stack: error.stack,
            rawBodyPreview: error.type === 'entity.parse.failed'
                ? getRawBodyPreview(req.rawBody)
                : undefined,
        });
        res.status(500).json({
            error: error.message || '服务器内部错误',
        });
    });

    return app;
}

function registerProcessHandlers() {
    if (processHandlersRegistered) return;
    processHandlersRegistered = true;

    process.on('unhandledRejection', (reason, promise) => {
        logger.error('unhandled rejection captured', {
            reason: reason instanceof Error
                ? { message: reason.message, stack: reason.stack, code: reason.code, host: reason.host, port: reason.port }
                : reason,
        });
    });

    process.on('uncaughtException', error => {
        logger.error('uncaught exception captured', {
            error: {
                message: error.message,
                stack: error.stack,
                code: error.code,
                host: error.host,
                port: error.port,
            },
        });
    });
}

function startServer(port = PORT) {
    registerProcessHandlers();
    const app = createApp();
    const server = app.listen(port, HOST, () => {
        const address = server.address();
        const listenHost = typeof address === 'object' && address?.address
            ? address.address
            : HOST;
        const formattedHost = listenHost && listenHost.includes(':')
            ? `[${listenHost}]`
            : listenHost;

        logger.info(`lx-manager listening on http://${formattedHost}:${port}`, {
            instanceId: runtimeInstanceId,
            pid: process.pid,
            host: HOST,
            port,
            logRules: LOG_RULES,
        });
    });

    return server;
}

if (require.main === module) {
    startServer();
}

module.exports = {
    createApp,
    startServer,
    __internal: {
        normalizeRequestBody,
    },
};
