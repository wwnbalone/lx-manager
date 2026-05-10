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
    getTodayDir,
} = require('./source-store');
const {
    extractScriptInfo,
    analyzeSourceQuality,
    buildDecoratedSourceFilename,
} = require('./source-quality');

const logger = createLogger('updater');

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
    const commitCutoff = new Date();
    commitCutoff.setMonth(commitCutoff.getMonth() - MAX_COMMIT_AGE_MONTHS);

    const stats = {
        reposScanned: 0,
        filesDownloaded: 0,
        filesFailed: 0,
    };

    logger.info(`[TASK] >>> 开始深度采集 (目标: ${SEARCH_LIMIT} 个仓库) <<<`, {
        todayDir,
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
                    logger.info(`正在处理文件: ${filePath}`, {
                        repo: repo.full_name,
                        commitSha,
                    });
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

                        const legacyLocalName = `${repo.full_name.replace(/\//g, '_')}_${filePath.replace(/\//g, '_')}`;
                        let localName = legacyLocalName;
                        let scriptInfo = null;
                        let qualityInfo = null;

                        try {
                            scriptInfo = extractScriptInfo(content, path.basename(filePath));
                            qualityInfo = analyzeSourceQuality({
                                repoFullName: repo.full_name,
                                filePath,
                                fileName: path.basename(filePath),
                                scriptInfo,
                            });
                            localName = buildDecoratedSourceFilename({
                                repoFullName: repo.full_name,
                                filePath,
                                fileName: path.basename(filePath),
                                scriptInfo,
                                qualityInfo,
                            });
                        } catch (error) {
                            logger.warn('音源元信息解析失败，回退旧文件名', {
                                repo: repo.full_name,
                                filePath,
                                error: error.message,
                            });
                        }

                        const outputPath = path.join(todayDir, localName);
                        fs.writeFileSync(outputPath, content);
                        logger.info('镜像下载成功', {
                            repo: repo.full_name,
                            filePath,
                            outputPath,
                            sourceName: scriptInfo?.name || null,
                            quality: qualityInfo ? {
                                priority: qualityInfo.priority,
                                score: qualityInfo.score,
                                labels: qualityInfo.labels,
                                summary: qualityInfo.summary,
                            } : null,
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
};
