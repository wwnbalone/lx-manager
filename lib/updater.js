const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const axios = require('axios');

const {
    GITHUB_TOKEN,
    PROXY_URL,
    SEARCH_LIMIT,
    MAX_COMMIT_AGE_MONTHS,
    UA,
    requestHttpsAgent,
} = require('./config');
const { createLogger } = require('./logger');
const {
    cleanupOldFolders,
    getPreviousDateDir,
    getTodayDir,
} = require('./source-store');

const logger = createLogger('updater');
const SOURCE_PROVENANCE_MARKER = '/* lx-manager-source-meta';

const gh = axios.create({
    timeout: 30000,
    httpsAgent: requestHttpsAgent,
    proxy: false,
    headers: {
        'User-Agent': UA,
        'Accept': 'application/vnd.github.v3+json',
        ...(GITHUB_TOKEN ? { 'Authorization': `token ${GITHUB_TOKEN}` } : {}),
    },
});

let isUpdating = false;

if (!GITHUB_TOKEN) {
    logger.warn('未设置 GITHUB_TOKEN，GitHub API 请求将使用匿名访问，可能更容易触发限流');
}

function encodeGitHubPath(filePath) {
    return filePath.split('/').map(segment => encodeURIComponent(segment)).join('/');
}

function buildMirrorUrls(repoFullName, ref, filePath) {
    const encodedRef = encodeURIComponent(ref);
    const encodedFilePath = encodeGitHubPath(filePath);
    const rawUrl = `https://raw.githubusercontent.com/${repoFullName}/${encodedRef}/${encodedFilePath}`;

    return [
        { name: 'GitHub Raw', url: rawUrl },
        { name: 'JSDelivr', url: `https://fastly.jsdelivr.net/gh/${repoFullName}@${encodedRef}/${encodedFilePath}` },
        { name: 'GHP.CI Proxy', url: `https://ghp.ci/${rawUrl}` },
    ];
}

function buildRepoUrl(repoFullName) {
    return `https://github.com/${repoFullName}`;
}

function buildLocalSourceName(repoFullName, filePath) {
    return `${repoFullName.replace(/\//g, '_')}_${filePath.replace(/\//g, '_')}`;
}

function stripSourceProvenance(content) {
    return String(content || '').replace(/^\/\* lx-manager-source-meta\r?\n[\s\S]*?\*\/\s*/u, '');
}

function decorateSourceContent(content, { repoFullName, commitSha, filePath }) {
    const cleanContent = stripSourceProvenance(content);

    return [
        SOURCE_PROVENANCE_MARKER,
        `repo-url: ${buildRepoUrl(repoFullName)}`,
        `repo: ${repoFullName}`,
        `commit: ${commitSha}`,
        `file: ${filePath}`,
        '*/',
        '',
        cleanContent,
    ].join('\n');
}

function extractSourceProvenance(content) {
    const match = String(content || '').match(/^\/\* lx-manager-source-meta\r?\n([\s\S]*?)\*\/\s*/u);
    if (!match) return null;

    const meta = {};

    for (const rawLine of match[1].split(/\r?\n/u)) {
        const line = rawLine.trim();
        if (!line) continue;

        const separatorIndex = line.indexOf(':');
        if (separatorIndex === -1) continue;

        const key = line.slice(0, separatorIndex).trim();
        const value = line.slice(separatorIndex + 1).trim();
        if (!key || !value) continue;
        meta[key] = value;
    }

    if (!meta.repo || !meta.commit || !meta.file) return null;
    return meta;
}

function tryReuseDownloadedSource(fromPath, toPath, expectedMeta) {
    if (fs.existsSync(toPath)) {
        const currentContent = fs.readFileSync(toPath, 'utf8');
        const currentMeta = extractSourceProvenance(currentContent);

        if (
            currentMeta
            && currentMeta.repo === expectedMeta.repoFullName
            && currentMeta.commit === expectedMeta.commitSha
            && currentMeta.file === expectedMeta.filePath
        ) {
            return {
                reused: true,
                type: 'current',
                fromPath: toPath,
            };
        }
        if (currentMeta) {
            return {
                reused: false,
                type: 'mismatch',
            };
        }
    }

    if (!fs.existsSync(fromPath)) {
        return {
            reused: false,
            type: 'missing',
        };
    }

    const content = fs.readFileSync(fromPath, 'utf8');
    const storedMeta = extractSourceProvenance(content);
    if (!storedMeta) {
        return {
            reused: false,
            type: 'missing_meta',
        };
    }

    if (
        storedMeta.repo !== expectedMeta.repoFullName
        || storedMeta.commit !== expectedMeta.commitSha
        || storedMeta.file !== expectedMeta.filePath
    ) {
        return {
            reused: false,
            type: 'mismatch',
        };
    }

    fs.copyFileSync(fromPath, toPath);
    return {
        reused: true,
        type: 'previous',
        fromPath,
    };
}

function looksLikeSourceScript(content) {
    if (!content || typeof content !== 'string') return false;

    const isHtml = content.includes('<!DOCTYPE') || content.includes('<html');
    if (isHtml) return false;

    return [
        'globalThis.lx',
        'EVENT_NAMES.inited',
        'module.exports',
        'sources: {',
        'sources:{',
    ].some(marker => content.includes(marker));
}

function downloadFile(url) {
    const curlArgs = [
        '-k',
        '-L',
        '--http1.1',
        '--fail',
        '--silent',
        '--show-error',
        '--connect-timeout', '30',
        '--retry', '2',
        '-m', '60',
        '-H', `User-Agent: ${UA}`,
    ];

    if (GITHUB_TOKEN) {
        curlArgs.push('-H', `Authorization: token ${GITHUB_TOKEN}`);
    }

    if (PROXY_URL) {
        curlArgs.push('-x', PROXY_URL);
    }

    curlArgs.push(url);

    try {
        logger.debug(`下载尝试: ${new URL(url).hostname}`);
        const stdout = execFileSync('curl', curlArgs, {
            stdio: ['ignore', 'pipe', 'pipe'],
            maxBuffer: 1024 * 1024 * 5,
        }).toString();

        return looksLikeSourceScript(stdout) ? stdout : null;
    } catch (error) {
        const stderr = error.stderr ? error.stderr.toString().trim() : '';
        logger.warn(`下载失败: ${url} | status=${error.status ?? 'unknown'} signal=${error.signal ?? 'none'}${stderr ? ` | stderr=${stderr}` : ''}`);
        return null;
    }
}

async function triggerGlobalUpdate() {
    if (isUpdating) {
        logger.info('抓取任务已在执行中，跳过本次触发');
        return { skipped: true };
    }

    isUpdating = true;
    const todayDir = getTodayDir();
    const previousDayDir = getPreviousDateDir(1);
    const commitCutoff = new Date();
    commitCutoff.setMonth(commitCutoff.getMonth() - MAX_COMMIT_AGE_MONTHS);

    const stats = {
        reposScanned: 0,
        filesDownloaded: 0,
        filesFailed: 0,
        filesReused: 0,
    };

        logger.info(`[TASK] >>> 开始深度采集 (目标: ${SEARCH_LIMIT} 个仓库) <<<`, {
            todayDir,
            previousDayDir,
            searchLimit: SEARCH_LIMIT,
            proxyEnabled: Boolean(PROXY_URL),
        });

    try {
        const searchRes = await gh.get('https://api.github.com/search/repositories?q=lx-music-source&sort=updated');
        const repos = searchRes.data.items.slice(0, SEARCH_LIMIT);
        logger.info('GitHub 仓库搜索完成', {
            totalMatched: Array.isArray(searchRes.data.items) ? searchRes.data.items.length : 0,
            reposSelected: repos.length,
        });

        for (const repo of repos) {
            stats.reposScanned += 1;
            logger.info(`[审计仓库] ${repo.full_name}`);

            try {
                const commitsRes = await gh.get(`https://api.github.com/repos/${repo.full_name}/commits?per_page=5`);
                const latestCommit = commitsRes.data[0];
                const latestCommitDate = latestCommit?.commit?.author?.date || latestCommit?.commit?.committer?.date;

                if (!latestCommitDate || new Date(latestCommitDate) < commitCutoff) {
                    logger.info(`最近 commit 超过 ${MAX_COMMIT_AGE_MONTHS} 个月，跳过`, {
                        repo: repo.full_name,
                        latestCommitDate: latestCommitDate || null,
                    });
                    continue;
                }

                const filesToDownload = new Map();

                for (const commit of commitsRes.data) {
                    const commitDate = commit?.commit?.author?.date || commit?.commit?.committer?.date;
                    if (!commitDate || new Date(commitDate) < commitCutoff) continue;

                    const detail = await gh.get(`https://api.github.com/repos/${repo.full_name}/commits/${commit.sha}`);
                    for (const file of detail.data.files || []) {
                        if (!file.filename.endsWith('.js')) continue;
                        if (/test|config|readme|ignore/i.test(file.filename)) continue;
                        if (!filesToDownload.has(file.filename)) {
                            filesToDownload.set(file.filename, commit.sha);
                        }
                    }

                    if (filesToDownload.size >= 3) break;
                }

                if (!filesToDownload.size) {
                    logger.info('该仓库最近提交不含 JS 音源，跳过', {
                        repo: repo.full_name,
                    });
                    continue;
                }

                for (const [filePath, commitSha] of filesToDownload.entries()) {
                    const localName = buildLocalSourceName(repo.full_name, filePath);
                    const outputPath = path.join(todayDir, localName);
                    const previousOutputPath = path.join(previousDayDir, localName);

                    logger.info(`正在处理文件: ${filePath}`, {
                        repo: repo.full_name,
                        commitSha,
                        outputPath,
                    });

                    const reuseResult = tryReuseDownloadedSource(previousOutputPath, outputPath, {
                        repoFullName: repo.full_name,
                        commitSha,
                        filePath,
                    });

                    if (reuseResult.reused) {
                        stats.filesReused += 1;
                        logger.info(reuseResult.type === 'current' ? '跳过同 commit 已存在文件' : '复用昨日已下载文件', {
                            repo: repo.full_name,
                            filePath,
                            commitSha,
                            fromPath: reuseResult.fromPath,
                            outputPath,
                            reuseType: reuseResult.type,
                        });
                        continue;
                    }

                    const mirrors = buildMirrorUrls(repo.full_name, commitSha, filePath);

                    let success = false;
                    for (const mirror of mirrors) {
                        logger.info(`尝试镜像 [${mirror.name}]`, {
                            repo: repo.full_name,
                            filePath,
                            url: mirror.url,
                        });
                        const content = downloadFile(mirror.url);

                        if (!content) {
                            continue;
                        }

                        const decoratedContent = decorateSourceContent(content, {
                            repoFullName: repo.full_name,
                            commitSha,
                            filePath,
                        });
                        fs.writeFileSync(outputPath, decoratedContent);
                        logger.info('镜像下载成功', {
                            repo: repo.full_name,
                            filePath,
                            commitSha,
                            outputPath,
                        });
                        stats.filesDownloaded += 1;
                        success = true;
                        break;
                    }

                    if (!success) {
                        stats.filesFailed += 1;
                        logger.warn(`文件 [${filePath}] 在所有镜像源均下载失败`, {
                            repo: repo.full_name,
                        });
                    }
                }
            } catch (error) {
                logger.error(`仓库访问异常: ${error.message}`, {
                    repo: repo.full_name,
                    stack: error.stack,
                });
            }
        }

        cleanupOldFolders();
        return stats;
    } finally {
        isUpdating = false;
        logger.info('[INFO] >>> 采集任务结束 <<<', stats);
    }
}

module.exports = {
    triggerGlobalUpdate,
    __internal: {
        buildLocalSourceName,
        buildRepoUrl,
        decorateSourceContent,
        extractSourceProvenance,
        tryReuseDownloadedSource,
        stripSourceProvenance,
    },
};
