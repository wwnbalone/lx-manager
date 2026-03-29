const { createLogger, startLogMaintenance } = require('./lib/logger');
const { triggerGlobalUpdate } = require('./lib/updater');

startLogMaintenance();
const logger = createLogger('updater-entry');

(async () => {
    const stats = await triggerGlobalUpdate();
    if (stats?.skipped) return;
    logger.info(`抓取完成: repos=${stats.reposScanned}, downloaded=${stats.filesDownloaded}, reused=${stats.filesReused}, failed=${stats.filesFailed}`);
})().catch(error => {
    logger.error(`更新失败: ${error.message}`, {
        stack: error.stack,
    });
    process.exitCode = 1;
});
