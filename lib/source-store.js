const fs = require('fs');
const path = require('path');

const {
    BASE_DIR,
    MAX_DAYS,
} = require('./config');

function ensureBaseDir() {
    if (!fs.existsSync(BASE_DIR)) fs.mkdirSync(BASE_DIR, { recursive: true });
    return BASE_DIR;
}

function getDateStr(offset = 0) {
    const d = new Date();
    d.setDate(d.getDate() - offset);
    return d.toISOString().split('T')[0];
}

function getDateDir(dateStr, { create = false } = {}) {
    ensureBaseDir();
    const dir = path.join(BASE_DIR, dateStr);
    if (create && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function getTodayDir() {
    return getDateDir(getDateStr(0), { create: true });
}

function getPreviousDateDir(offset = 1) {
    return getDateDir(getDateStr(offset));
}

function listDateFolders() {
    ensureBaseDir();
    return fs.readdirSync(BASE_DIR)
        .filter(name => /^\d{4}-\d{2}-\d{2}$/.test(name))
        .sort((a, b) => b.localeCompare(a));
}

function listSourceFiles(dir) {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
        .filter(name => name.endsWith('.js'))
        .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN', {
            numeric: true,
            sensitivity: 'base',
        }));
}

function copyFolderSources(fromDir, toDir) {
    if (!fs.existsSync(fromDir)) return;
    if (!fs.existsSync(toDir)) fs.mkdirSync(toDir, { recursive: true });

    for (const file of listSourceFiles(fromDir)) {
        fs.copyFileSync(path.join(fromDir, file), path.join(toDir, file));
    }
}

function cleanupOldFolders() {
    ensureBaseDir();
    console.log(`[INFO] 正在检查过期目录 (保留最近 ${MAX_DAYS} 天)...`);

    try {
        const folders = listDateFolders();
        const keepDates = Array.from({ length: MAX_DAYS }, (_, i) => getDateStr(i));

        for (const folder of folders) {
            if (keepDates.includes(folder)) continue;
            fs.rmSync(path.join(BASE_DIR, folder), { recursive: true, force: true });
            console.log(`[SUCCESS] 已清理过期目录: ${folder}`);
        }
    } catch (error) {
        console.error(`[ERROR] 清理失败: ${error.message}`);
    }
}

module.exports = {
    BASE_DIR,
    ensureBaseDir,
    getDateStr,
    getDateDir,
    getTodayDir,
    getPreviousDateDir,
    listDateFolders,
    listSourceFiles,
    copyFolderSources,
    cleanupOldFolders,
};
