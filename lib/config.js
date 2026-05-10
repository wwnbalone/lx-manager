const path = require('path');
const dns = require('dns');
const https = require('https');

if (dns.setDefaultResultOrder) dns.setDefaultResultOrder('ipv4first');

/**
 * Parse an environment variable as a positive integer.
 * - If the variable is not set, returns defaultValue.
 * - If the parsed value is a positive integer (> 0), returns it.
 * - Otherwise logs a warn-level startup message and returns defaultValue.
 *
 * @param {string} name - Environment variable name
 * @param {number} defaultValue - Fallback value
 * @returns {number}
 */
function parsePositiveIntEnv(name, defaultValue) {
    const raw = process.env[name];
    if (raw === undefined || raw === null || raw.trim() === '') {
        return defaultValue;
    }
    const parsed = Number(raw);
    if (Number.isInteger(parsed) && parsed > 0) {
        return parsed;
    }
    const timestamp = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
    process.stderr.write(
        `[${timestamp}] [WARN] [config] invalid value for ${name}: "${raw.trim()}", using default ${defaultValue}\n`
    );
    return defaultValue;
}

const HOST = (process.env.HOST || '0.0.0.0').trim() || '0.0.0.0';
const PORT = Number(process.env.PORT || 4000);
const BASE_DIR = path.resolve(process.env.SOURCE_BASE_DIR || path.join(__dirname, '..', 'sources'));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const GITHUB_TOKEN = (process.env.GITHUB_TOKEN || '').trim();
const PROXY_URL = (process.env.PROXY_URL || '').trim();
const MAX_DAYS = Number(process.env.MAX_DAYS || 30);
const SEARCH_LIMIT = Number(process.env.SEARCH_LIMIT || 10);
const MAX_COMMIT_AGE_MONTHS = Number(process.env.MAX_COMMIT_AGE_MONTHS || 3);
const URL_SELECT_WINDOW_MS = Number(process.env.URL_SELECT_WINDOW_MS || 4000);
const URL_MAX_CONCURRENT_REQUESTS = Number(process.env.URL_MAX_CONCURRENT_REQUESTS || 3);
const URL_MAX_CANDIDATES = Number(process.env.URL_MAX_CANDIDATES || 6);
const SOURCE_DISABLE_UPDATE_CHECK = !['0', 'false', 'off'].includes(
    String(process.env.SOURCE_DISABLE_UPDATE_CHECK || 'true').trim().toLowerCase(),
);
const LOG_DIR = path.resolve(process.env.LOG_DIR || path.join(__dirname, '..', 'logs'));
const LOG_RETENTION_DAYS = Number(process.env.LOG_RETENTION_DAYS || 7);
const LOG_MAX_TOTAL_SIZE_BYTES = Number(process.env.LOG_MAX_TOTAL_SIZE_BYTES || (50 * 1024 * 1024));
const LOG_MAX_FILE_SIZE_BYTES = Number(process.env.LOG_MAX_FILE_SIZE_BYTES || (10 * 1024 * 1024));
const LOG_CLEANUP_INTERVAL_MS = Number(process.env.LOG_CLEANUP_INTERVAL_MS || (6 * 60 * 60 * 1000));

const QUALITY_FILTER_STRICT = ['true', '1', 'on'].includes(
    String(process.env.QUALITY_FILTER_STRICT || 'false').trim().toLowerCase()
);

const QUALITY_FILTER_BITRATE_320K = parsePositiveIntEnv('QUALITY_FILTER_BITRATE_320K', 200);
const QUALITY_FILTER_BITRATE_128K = parsePositiveIntEnv('QUALITY_FILTER_BITRATE_128K', 96);

const proxyAgent = PROXY_URL
    ? new (require('https-proxy-agent'))(PROXY_URL)
    : null;
const requestHttpsAgent = proxyAgent || new https.Agent({ family: 4, rejectUnauthorized: false });

module.exports = {
    HOST,
    PORT,
    BASE_DIR,
    UA,
    GITHUB_TOKEN,
    PROXY_URL,
    MAX_DAYS,
    SEARCH_LIMIT,
    MAX_COMMIT_AGE_MONTHS,
    URL_SELECT_WINDOW_MS,
    URL_MAX_CONCURRENT_REQUESTS,
    URL_MAX_CANDIDATES,
    SOURCE_DISABLE_UPDATE_CHECK,
    LOG_DIR,
    LOG_RETENTION_DAYS,
    LOG_MAX_TOTAL_SIZE_BYTES,
    LOG_MAX_FILE_SIZE_BYTES,
    LOG_CLEANUP_INTERVAL_MS,
    QUALITY_FILTER_STRICT,
    QUALITY_FILTER_BITRATE_320K,
    QUALITY_FILTER_BITRATE_128K,
    proxyAgent,
    requestHttpsAgent,
    parsePositiveIntEnv,
};
