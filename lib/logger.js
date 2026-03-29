const fs = require('fs');
const path = require('path');
const util = require('util');

const {
    LOG_DIR,
    LOG_RETENTION_DAYS,
    LOG_MAX_TOTAL_SIZE_BYTES,
    LOG_MAX_FILE_SIZE_BYTES,
    LOG_CLEANUP_INTERVAL_MS,
} = require('./config');

const LEVELS = ['DEBUG', 'INFO', 'WARN', 'ERROR'];
let cleanupTimer = null;
const CONSOLE_MAX_DEPTH = 4;
const CONSOLE_MAX_KEYS = 20;
const CONSOLE_MAX_ARRAY = 10;
const CONSOLE_MAX_STRING = 1200;

function ensureLogDir() {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
}

function pad(value) {
    return String(value).padStart(2, '0');
}

function getDateParts(date = new Date()) {
    return {
        year: date.getFullYear(),
        month: pad(date.getMonth() + 1),
        day: pad(date.getDate()),
        hour: pad(date.getHours()),
        minute: pad(date.getMinutes()),
        second: pad(date.getSeconds()),
    };
}

function getLogDateString(date = new Date()) {
    const { year, month, day } = getDateParts(date);
    return `${year}-${month}-${day}`;
}

function getTimestamp(date = new Date()) {
    const { year, month, day, hour, minute, second } = getDateParts(date);
    return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

function listLogFiles() {
    ensureLogDir();
    return fs.readdirSync(LOG_DIR)
        .filter(name => /^lx-manager-\d{4}-\d{2}-\d{2}(?:-\d+)?\.log$/.test(name))
        .map(name => {
            const filePath = path.join(LOG_DIR, name);
            const stat = fs.statSync(filePath);
            return {
                name,
                filePath,
                size: stat.size,
                mtimeMs: stat.mtimeMs,
            };
        })
        .sort((a, b) => a.mtimeMs - b.mtimeMs);
}

function selectLogFilePath(date = new Date()) {
    ensureLogDir();
    const dateString = getLogDateString(date);

    for (let index = 0; index < 1000; index += 1) {
        const suffix = index === 0 ? '' : `-${index}`;
        const filename = `lx-manager-${dateString}${suffix}.log`;
        const filePath = path.join(LOG_DIR, filename);

        if (!fs.existsSync(filePath)) return filePath;

        const stat = fs.statSync(filePath);
        if (stat.size < LOG_MAX_FILE_SIZE_BYTES) return filePath;
    }

    return path.join(LOG_DIR, `lx-manager-${dateString}-overflow.log`);
}

function cleanupLogs() {
    try {
        const files = listLogFiles();
        const cutoff = Date.now() - (LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);

        for (const file of files) {
            if (file.mtimeMs < cutoff) {
                fs.rmSync(file.filePath, { force: true });
            }
        }

        let remaining = listLogFiles();
        let totalSize = remaining.reduce((sum, file) => sum + file.size, 0);

        while (totalSize > LOG_MAX_TOTAL_SIZE_BYTES && remaining.length > 1) {
            const file = remaining.shift();
            fs.rmSync(file.filePath, { force: true });
            totalSize -= file.size;
        }
    } catch (error) {
        process.stderr.write(`[LOGGER] cleanup failed: ${error.message}\n`);
    }
}

function formatMeta(meta) {
    if (meta == null) return '';
    if (typeof meta === 'string') return ` | ${meta}`;
    return ` | ${util.inspect(meta, {
        depth: 6,
        breakLength: 160,
        maxArrayLength: 20,
        compact: true,
    })}`;
}

function writeLine(level, message, meta) {
    ensureLogDir();
    const line = `[${getTimestamp()}] [${level}] ${message}${formatMeta(meta)}\n`;
    fs.appendFileSync(selectLogFilePath(), line, 'utf8');

    if (level === 'ERROR') process.stderr.write(line);
    else process.stdout.write(line);
}

function truncateString(value, maxLength = CONSOLE_MAX_STRING) {
    const text = String(value);
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength)}... <truncated ${text.length - maxLength} chars>`;
}

function summarizeConsoleValue(value, depth = 0, seen = new WeakSet()) {
    if (value == null) return value;
    if (typeof value === 'string') return truncateString(value);
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value === 'bigint') return `${value}n`;
    if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`;
    if (Buffer.isBuffer(value)) return `<Buffer length=${value.length}>`;

    if (value instanceof Error) {
        return {
            name: value.name,
            message: value.message,
            code: value.code,
            host: value.host,
            port: value.port,
            stack: value.stack ? truncateString(value.stack, CONSOLE_MAX_STRING * 2) : undefined,
            cause: value.cause && depth < CONSOLE_MAX_DEPTH
                ? summarizeConsoleValue(value.cause, depth + 1, seen)
                : undefined,
        };
    }

    if (Array.isArray(value)) {
        if (depth >= CONSOLE_MAX_DEPTH) return `[Array length=${value.length}]`;

        const items = value
            .slice(0, CONSOLE_MAX_ARRAY)
            .map(item => summarizeConsoleValue(item, depth + 1, seen));

        if (value.length > CONSOLE_MAX_ARRAY) {
            items.push(`... ${value.length - CONSOLE_MAX_ARRAY} more items`);
        }

        return items;
    }

    if (typeof value === 'object') {
        if (seen.has(value)) return '[Circular]';
        if (depth >= CONSOLE_MAX_DEPTH) return `[Object keys=${Object.keys(value).length}]`;

        seen.add(value);

        const entries = Object.entries(value);
        const output = {};

        for (const [key, entryValue] of entries.slice(0, CONSOLE_MAX_KEYS)) {
            output[key] = summarizeConsoleValue(entryValue, depth + 1, seen);
        }

        if (entries.length > CONSOLE_MAX_KEYS) {
            output.__truncatedKeys = entries.length - CONSOLE_MAX_KEYS;
        }

        seen.delete(value);
        return output;
    }

    return truncateString(util.inspect(value, {
        depth: 1,
        breakLength: 120,
        maxArrayLength: 10,
        compact: true,
    }));
}

function sanitizeConsoleArgs(args) {
    return args.map(arg => summarizeConsoleValue(arg));
}

function normalizeArgs(args) {
    if (!args.length) return { message: '', meta: undefined };
    if (args.length === 1) return { message: String(args[0]), meta: undefined };

    const [first, ...rest] = args;
    if (typeof first === 'string') {
        return {
            message: first,
            meta: rest.length === 1 ? rest[0] : rest,
        };
    }

    return {
        message: util.format(...args),
        meta: undefined,
    };
}

function logWithLevel(level, ...args) {
    const { message, meta } = normalizeArgs(args);
    writeLine(level, message, meta);
}

function createLogger(scope) {
    const prefix = scope ? `[${scope}] ` : '';

    return {
        debug: (...args) => logWithLevel('DEBUG', prefix + normalizeArgs(args).message, normalizeArgs(args).meta),
        info: (...args) => logWithLevel('INFO', prefix + normalizeArgs(args).message, normalizeArgs(args).meta),
        warn: (...args) => logWithLevel('WARN', prefix + normalizeArgs(args).message, normalizeArgs(args).meta),
        error: (...args) => logWithLevel('ERROR', prefix + normalizeArgs(args).message, normalizeArgs(args).meta),
        child(childScope) {
            return createLogger(scope ? `${scope}:${childScope}` : childScope);
        },
    };
}

function createConsoleBridge(scope) {
    const logger = createLogger(scope);

    return {
        log: (...args) => logger.info(...sanitizeConsoleArgs(args)),
        info: (...args) => logger.info(...sanitizeConsoleArgs(args)),
        warn: (...args) => logger.warn(...sanitizeConsoleArgs(args)),
        error: (...args) => logger.error(...sanitizeConsoleArgs(args)),
        debug: (...args) => logger.debug(...sanitizeConsoleArgs(args)),
        group: (...args) => logger.info(...sanitizeConsoleArgs(args)),
        groupCollapsed: (...args) => logger.info(...sanitizeConsoleArgs(args)),
        groupEnd: () => {},
    };
}

function startLogMaintenance() {
    ensureLogDir();
    cleanupLogs();

    if (cleanupTimer) return;
    cleanupTimer = setInterval(cleanupLogs, LOG_CLEANUP_INTERVAL_MS);
    if (typeof cleanupTimer.unref === 'function') cleanupTimer.unref();
}

module.exports = {
    cleanupLogs,
    createConsoleBridge,
    createLogger,
    startLogMaintenance,
    LOG_RULES: {
        dir: LOG_DIR,
        retentionDays: LOG_RETENTION_DAYS,
        maxTotalSizeBytes: LOG_MAX_TOTAL_SIZE_BYTES,
        maxFileSizeBytes: LOG_MAX_FILE_SIZE_BYTES,
        cleanupIntervalMs: LOG_CLEANUP_INTERVAL_MS,
    },
};
