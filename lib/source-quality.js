const DEFAULT_SCRIPT_NAME = '未命名音源';
const DEFAULT_LABEL = '未标注';
const DEFAULT_SCORE = 45;
const PRIORITY_LABELS = {
    1: '极高',
    2: '高',
    3: '标准',
    4: '谨慎',
    5: '回退',
};

const QUALITY_RULES = [
    {
        label: '独家音源',
        pattern: /独家音源|独家(?![\u4e00-\u9fa5])/iu,
        weight: 35,
        reason: '通常代表更完整或更高权限的线路能力',
    },
    {
        label: '优质',
        pattern: /优质|高品质|高质量|稳定可用|稳定线路/iu,
        weight: 24,
        reason: '描述中明确标记为优质或稳定',
    },
    {
        label: '无损',
        pattern: /无损|flac|ape|母带/iu,
        weight: 18,
        reason: '支持无损或更高规格音质',
    },
    {
        label: 'Hi-Res',
        pattern: /hi[\s-]?res|高解析|高解析度/iu,
        weight: 16,
        reason: '支持 Hi-Res 或高解析度音质',
    },
    {
        label: '320k',
        pattern: /320k|320kbps/iu,
        weight: 12,
        reason: '明确支持 320k 音质',
    },
    {
        label: '一般',
        pattern: /一般|普通|基础版/iu,
        weight: -8,
        reason: '描述中明确标记为一般或普通',
    },
    {
        label: '试听',
        pattern: /试听|仅供试听|仅试听/iu,
        weight: -16,
        reason: '仅限试听通常意味着完整能力受限',
    },
    {
        label: '禁止批量下载',
        pattern: /禁止批量下载|批量下载会被封|勿批量下载/iu,
        weight: -20,
        reason: '明确限制批量下载行为',
    },
    {
        label: '封禁IP',
        pattern: /封禁\s*ip|封ip|ip已被封|block\s*ip/iu,
        weight: -26,
        reason: '频繁请求或违规使用存在封禁风险',
    },
];

function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function takeBasename(value) {
    const text = normalizeText(value);
    if (!text) return '';
    return text.split(/[\\/]/).pop() || '';
}

function stripExtension(value) {
    const text = normalizeText(value);
    return text.replace(/\.[^.]+$/, '');
}

function readMetaField(header, field) {
    const pattern = new RegExp(`(?:^|[\\r\\n])\\s*(?:\\/\\/+|\\/\\*+|\\*+|#+|;+)?\\s*@${field}\\s+([^\\r\\n]+)`, 'i');
    const match = header.match(pattern);

    if (!match) return '';

    return match[1]
        .replace(/\*\/\s*$/, '')
        .trim();
}

function extractScriptInfo(code, fallbackName = '') {
    const text = typeof code === 'string' ? code : '';
    const header = text.slice(0, 8000);
    const normalizedFallback = stripExtension(takeBasename(fallbackName));
    const homepage = readMetaField(header, 'homepage') || readMetaField(header, 'homepageURL');
    const repository = readMetaField(header, 'repository');

    return {
        name: readMetaField(header, 'name') || normalizedFallback || DEFAULT_SCRIPT_NAME,
        description: readMetaField(header, 'description'),
        version: readMetaField(header, 'version'),
        author: readMetaField(header, 'author'),
        homepage: homepage || repository,
        repository,
    };
}

function getQualityFields(input = {}) {
    const scriptInfo = input.scriptInfo && typeof input.scriptInfo === 'object'
        ? input.scriptInfo
        : {};

    return [
        { field: 'description', value: scriptInfo.description },
        { field: 'name', value: scriptInfo.name },
        { field: 'filePath', value: input.filePath },
        { field: 'fileName', value: input.fileName },
        { field: 'repoFullName', value: input.repoFullName },
        { field: 'homepage', value: scriptInfo.homepage },
        { field: 'repository', value: scriptInfo.repository },
    ].filter(item => normalizeText(item.value));
}

function clampScore(score) {
    if (score < 0) return 0;
    if (score > 100) return 100;
    return Math.round(score);
}

function resolvePriority(score) {
    if (score >= 85) return 1;
    if (score >= 60) return 2;
    if (score >= 40) return 3;
    if (score >= 20) return 4;
    return 5;
}

function sortEvidence(a, b) {
    const aPositive = a.weight >= 0;
    const bPositive = b.weight >= 0;

    if (aPositive !== bPositive) return aPositive ? -1 : 1;
    if (Math.abs(a.weight) !== Math.abs(b.weight)) {
        return Math.abs(b.weight) - Math.abs(a.weight);
    }

    return a.index - b.index;
}

function uniqLabelsFromEvidence(evidence) {
    const labels = [];
    const seen = new Set();

    for (const item of [...evidence].sort(sortEvidence)) {
        if (seen.has(item.label)) continue;
        seen.add(item.label);
        labels.push(item.label);
    }

    return labels;
}

function buildSummary(priority, score, evidence) {
    if (!evidence.length) {
        return `${PRIORITY_LABELS[priority]}优先，评分 ${score}。未命中显式质量描述，按默认规则处理。`;
    }

    const orderedLabels = uniqLabelsFromEvidence(evidence);
    const positive = orderedLabels.filter(label => evidence.some(item => item.label === label && item.weight > 0));
    const negative = orderedLabels.filter(label => evidence.some(item => item.label === label && item.weight < 0));
    const parts = [`${PRIORITY_LABELS[priority]}优先`, `评分 ${score}`];

    if (positive.length) {
        parts.push(`正向标签：${positive.join('、')}`);
    }
    if (negative.length) {
        parts.push(`限制标签：${negative.join('、')}`);
    }

    return `${parts.join('，')}。`;
}

function analyzeSourceQuality(input = {}) {
    const fields = getQualityFields(input);
    const evidence = [];
    let rawScore = DEFAULT_SCORE;

    QUALITY_RULES.forEach((rule, index) => {
        for (const entry of fields) {
            const match = normalizeText(entry.value).match(rule.pattern);
            if (!match) continue;

            rawScore += rule.weight;
            evidence.push({
                index,
                label: rule.label,
                matched: match[0],
                field: entry.field,
                weight: rule.weight,
                reason: rule.reason,
            });
            break;
        }
    });

    const score = clampScore(rawScore);
    const priority = resolvePriority(score);
    const labels = uniqLabelsFromEvidence(evidence);

    return {
        score,
        priority,
        labels: labels.length ? labels : [DEFAULT_LABEL],
        summary: buildSummary(priority, score, evidence),
        evidence: evidence.map(({ index, ...item }) => item),
    };
}

function sanitizeFilenameSegment(value, fallback, maxLength) {
    let text = normalizeText(value)
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_')
        .replace(/[. ]+$/g, '')
        .replace(/^[_\-. ]+|[_\-. ]+$/g, '');

    if (!text) text = fallback;

    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(text)) {
        text = `${text}_source`;
    }

    if (maxLength && text.length > maxLength) {
        text = text.slice(0, maxLength).replace(/^[_\-. ]+|[_\-. ]+$/g, '');
    }

    return text || fallback;
}

function sameSegment(a, b) {
    return normalizeText(a).toLowerCase() === normalizeText(b).toLowerCase();
}

function buildDecoratedSourceFilename(input = {}) {
    const scriptInfo = input.scriptInfo && typeof input.scriptInfo === 'object'
        ? input.scriptInfo
        : extractScriptInfo('', input.fileName || input.filePath || '');
    const qualityInfo = input.qualityInfo && typeof input.qualityInfo === 'object'
        ? input.qualityInfo
        : analyzeSourceQuality({
            repoFullName: input.repoFullName,
            filePath: input.filePath,
            fileName: input.fileName,
            scriptInfo,
        });

    const prioritySegment = String(
        Math.max(1, Math.min(99, Number(qualityInfo.priority) || 3)),
    ).padStart(2, '0');
    const labelSegment = sanitizeFilenameSegment(
        (qualityInfo.labels || [])
            .filter(label => label && label !== DEFAULT_LABEL)
            .slice(0, 3)
            .join('-'),
        DEFAULT_LABEL,
        24,
    );
    const repoSegment = sanitizeFilenameSegment(
        normalizeText(input.repoFullName).replace(/[\\/]+/g, '_'),
        'unknown_repo',
        40,
    );
    const nameSegment = sanitizeFilenameSegment(
        scriptInfo.name || stripExtension(takeBasename(input.fileName || input.filePath || '')),
        DEFAULT_SCRIPT_NAME,
        40,
    );
    const pathSegment = sanitizeFilenameSegment(
        stripExtension(normalizeText(input.filePath || input.fileName || 'source')).replace(/[\\/]+/g, '_'),
        'source',
        36,
    );

    const parts = [
        prioritySegment,
        labelSegment,
        repoSegment,
        nameSegment,
    ];

    if (!sameSegment(pathSegment, nameSegment)) {
        parts.push(pathSegment);
    }

    return `${parts.join('__')}.js`;
}

module.exports = {
    extractScriptInfo,
    analyzeSourceQuality,
    buildDecoratedSourceFilename,
};
