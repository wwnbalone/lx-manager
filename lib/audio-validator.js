const axios = require('axios');

const {
    UA,
    requestHttpsAgent,
    QUALITY_FILTER_STRICT,
    QUALITY_FILTER_BITRATE_320K,
    QUALITY_FILTER_BITRATE_128K,
} = require('./config');

const SAMPLE_BYTES = 64 * 1024;
const ABSOLUTE_MIN_BYTES = 96 * 1024;
const MIN_ESTIMATED_DURATION_WITHOUT_METADATA_SECONDS = 12;
const LOW_SAMPLE_RATE_MP3_HZ = 32000;
const LOW_SAMPLE_RATE_SMALL_MP3_BYTES = 256 * 1024;
const DURATION_MIN_SIZE_RULES = [
    { minDuration: 60, minBytes: 256 * 1024 },
    { minDuration: 120, minBytes: 512 * 1024 },
    { minDuration: 180, minBytes: 768 * 1024 },
    { minDuration: 240, minBytes: 1024 * 1024 },
];
// QualityTier enum
const QUALITY_TIER = {
    LOSSY_LOW: 'lossy_low',   // 128k
    LOSSY_HIGH: 'lossy_high', // 320k
    LOSSLESS: 'lossless',     // flac, flac24bit, master, hires, atmos
};

// Mapping from RequestedQuality to QualityTier
const QUALITY_TO_TIER = {
    '128k': QUALITY_TIER.LOSSY_LOW,
    '320k': QUALITY_TIER.LOSSY_HIGH,
    'flac': QUALITY_TIER.LOSSLESS,
    'flac24bit': QUALITY_TIER.LOSSLESS,
    'master': QUALITY_TIER.LOSSLESS,
    'hires': QUALITY_TIER.LOSSLESS,
    'atmos': QUALITY_TIER.LOSSLESS,
};

// Relaxed bitrate floors (legacy behaviour, QUALITY_FILTER_STRICT = false)
const QUALITY_MIN_KBPS_RELAXED = {
    '128k': 32,
    '320k': 72,
    'flac': 160,
    'flac24bit': 220,
    'master': 220,
    'hires': 180,
    'atmos': 180,
};

// Strict bitrate floors (QUALITY_FILTER_STRICT = true)
const QUALITY_MIN_KBPS_STRICT = {
    '128k': QUALITY_FILTER_BITRATE_128K,  // default 96
    '320k': QUALITY_FILTER_BITRATE_320K,  // default 200
    'flac': 320,
    'flac24bit': 320,
    'master': 320,
    'hires': 320,
    'atmos': 320,
};

const LOSSLESS_QUALITYS = new Set(['flac', 'flac24bit', 'master', 'hires', 'atmos']);
const LOSSLESS_QUALITIES = new Set(['flac', 'flac24bit', 'master', 'hires', 'atmos']);
const MPEG1_LAYER3_BITRATES = [null, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, null];
const MPEG2_LAYER3_BITRATES = [null, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, null];
const MPEG1_SAMPLE_RATES = [44100, 48000, 32000, null];
const MPEG2_SAMPLE_RATES = [22050, 24000, 16000, null];
const MPEG25_SAMPLE_RATES = [11025, 12000, 8000, null];

function parsePositiveNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) && num > 0 ? num : null;
}

function parseDurationSeconds(value) {
    if (value == null) return null;

    if (typeof value === 'string') {
        const text = value.trim();
        if (!text) return null;

        if (/^\d{1,2}:\d{2}(?::\d{2})?$/.test(text)) {
            const parts = text.split(':').map(part => Number(part));
            if (parts.some(part => !Number.isFinite(part))) return null;
            return parts.reduce((total, part) => (total * 60) + part, 0);
        }
    }

    const num = parsePositiveNumber(value);
    if (!num) return null;
    if (num > 10000) return num / 1000;
    return num;
}

function normalizeDurationSeconds(musicInfo = {}) {
    const candidates = [
        musicInfo.duration,
        musicInfo.interval,
        musicInfo.dt,
        musicInfo.length,
        musicInfo.meta?.duration,
        musicInfo.meta?.interval,
        musicInfo.songInfo?.duration,
        musicInfo.songInfo?.interval,
        musicInfo._raw?.duration,
        musicInfo._raw?.interval,
        musicInfo._raw?.dt,
        musicInfo._raw?.length,
        musicInfo._raw?.meta?.duration,
        musicInfo._raw?.meta?.interval,
    ];

    for (const candidate of candidates) {
        const value = parseDurationSeconds(candidate);
        if (!value) continue;
        return value;
    }

    return null;
}

function parseContentRangeTotal(contentRange) {
    if (!contentRange || typeof contentRange !== 'string') return null;
    const total = contentRange.match(/\/(\d+)\s*$/)?.[1];
    return total ? Number(total) : null;
}

function extractTotalBytes(headers = {}, sampleLength = 0) {
    const contentRangeTotal = parseContentRangeTotal(headers['content-range']);
    if (contentRangeTotal) return contentRangeTotal;

    const contentLength = parsePositiveNumber(headers['content-length']);
    if (contentLength) return contentLength;

    return sampleLength > 0 ? sampleLength : null;
}

function deriveBitrateKbps(totalBytes, durationSeconds) {
    if (!totalBytes || !durationSeconds) return null;
    return (totalBytes * 8) / durationSeconds / 1000;
}

function estimateDurationSeconds(totalBytes, bitrateKbps) {
    if (!totalBytes || !bitrateKbps) return null;
    return (totalBytes * 8) / (bitrateKbps * 1000);
}

function getQualityMinBitrateKbps(quality) {
    const key = String(quality || '').trim();
    const table = QUALITY_FILTER_STRICT ? QUALITY_MIN_KBPS_STRICT : QUALITY_MIN_KBPS_RELAXED;
    return table[key] || 24;
}

function looksLikeTextPayload(sampleBuffer) {
    if (!sampleBuffer?.length) return false;

    const asciiSample = sampleBuffer.subarray(0, Math.min(sampleBuffer.length, 512)).toString('utf8').trimStart();
    return asciiSample.startsWith('<')
        || asciiSample.startsWith('{')
        || asciiSample.startsWith('[')
        || asciiSample.startsWith('error')
        || asciiSample.startsWith('Error');
}

function parseId3v2Size(buffer) {
    if (buffer.length < 10) return 0;
    if (buffer.subarray(0, 3).toString('ascii') !== 'ID3') return 0;

    return 10
        + ((buffer[6] & 0x7f) << 21)
        + ((buffer[7] & 0x7f) << 14)
        + ((buffer[8] & 0x7f) << 7)
        + (buffer[9] & 0x7f);
}

function parseMp3FrameHeader(buffer) {
    const startOffset = parseId3v2Size(buffer);

    for (let offset = startOffset; offset <= buffer.length - 4; offset++) {
        const b1 = buffer[offset];
        const b2 = buffer[offset + 1];
        const b3 = buffer[offset + 2];

        if (b1 !== 0xff || (b2 & 0xe0) !== 0xe0) continue;

        const versionBits = (b2 >> 3) & 0x03;
        const layerBits = (b2 >> 1) & 0x03;
        const bitrateIndex = (b3 >> 4) & 0x0f;
        const sampleRateIndex = (b3 >> 2) & 0x03;

        if (layerBits !== 0x01) continue;
        if (bitrateIndex === 0 || bitrateIndex === 0x0f) continue;
        if (sampleRateIndex === 0x03) continue;

        let bitrateKbps = null;
        let sampleRate = null;
        let version = null;

        if (versionBits === 0x03) {
            bitrateKbps = MPEG1_LAYER3_BITRATES[bitrateIndex];
            sampleRate = MPEG1_SAMPLE_RATES[sampleRateIndex];
            version = 'mpeg1';
        } else if (versionBits === 0x02) {
            bitrateKbps = MPEG2_LAYER3_BITRATES[bitrateIndex];
            sampleRate = MPEG2_SAMPLE_RATES[sampleRateIndex];
            version = 'mpeg2';
        } else if (versionBits === 0x00) {
            bitrateKbps = MPEG2_LAYER3_BITRATES[bitrateIndex];
            sampleRate = MPEG25_SAMPLE_RATES[sampleRateIndex];
            version = 'mpeg2.5';
        }

        if (!bitrateKbps || !sampleRate) continue;

        return {
            format: 'mp3',
            version,
            bitrateKbps,
            sampleRate,
            lossless: false,
        };
    }

    return null;
}

function parseWavInfo(buffer) {
    if (buffer.length < 16) return null;
    if (buffer.subarray(0, 4).toString('ascii') !== 'RIFF') return null;
    if (buffer.subarray(8, 12).toString('ascii') !== 'WAVE') return null;

    let offset = 12;

    while (offset + 8 <= buffer.length) {
        const chunkId = buffer.subarray(offset, offset + 4).toString('ascii');
        const chunkSize = buffer.readUInt32LE(offset + 4);
        const chunkDataStart = offset + 8;

        if (chunkId === 'fmt ' && chunkDataStart + 16 <= buffer.length) {
            const audioFormat = buffer.readUInt16LE(chunkDataStart);
            const channels = buffer.readUInt16LE(chunkDataStart + 2);
            const sampleRate = buffer.readUInt32LE(chunkDataStart + 4);
            const byteRate = buffer.readUInt32LE(chunkDataStart + 8);
            const bitsPerSample = buffer.readUInt16LE(chunkDataStart + 14);

            return {
                format: 'wav',
                audioFormat,
                channels,
                sampleRate,
                bitsPerSample,
                bitrateKbps: byteRate ? (byteRate * 8) / 1000 : null,
                lossless: audioFormat === 1 || audioFormat === 3,
            };
        }

        offset = chunkDataStart + chunkSize + (chunkSize % 2);
    }

    return {
        format: 'wav',
        lossless: true,
    };
}

function sniffFormatByContentType(contentType) {
    if (!contentType) return null;

    if (contentType.includes('flac')) return { format: 'flac', lossless: true };
    if (contentType.includes('wav') || contentType.includes('wave')) return { format: 'wav', lossless: true };
    if (contentType.includes('mpeg') || contentType.includes('mp3')) return { format: 'mp3', lossless: false };
    if (contentType.includes('aac')) return { format: 'aac', lossless: false };
    if (contentType.includes('mp4') || contentType.includes('m4a')) return { format: 'm4a', lossless: false };
    if (contentType.includes('ogg')) return { format: 'ogg', lossless: false };
    return null;
}

function sniffFormatByUrl(url) {
    const extension = String(url || '').split('?')[0].split('#')[0].match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
    if (!extension) return null;

    if (extension === 'flac') return { format: 'flac', lossless: true };
    if (extension === 'wav') return { format: 'wav', lossless: true };
    if (extension === 'mp3') return { format: 'mp3', lossless: false };
    if (extension === 'm4a' || extension === 'mp4') return { format: 'm4a', lossless: false };
    if (extension === 'ogg' || extension === 'opus') return { format: 'ogg', lossless: false };
    if (extension === 'aac') return { format: 'aac', lossless: false };
    return null;
}

function sniffAudioCharacteristics(sampleBuffer, contentType, url) {
    if (!sampleBuffer?.length) {
        return sniffFormatByContentType(contentType) || sniffFormatByUrl(url) || { format: 'unknown', lossless: false };
    }

    if (sampleBuffer.subarray(0, 4).toString('ascii') === 'fLaC') {
        return {
            format: 'flac',
            lossless: true,
        };
    }

    const wavInfo = parseWavInfo(sampleBuffer);
    if (wavInfo) return wavInfo;

    const mp3Info = parseMp3FrameHeader(sampleBuffer);
    if (mp3Info) return mp3Info;

    if (sampleBuffer.subarray(0, 4).toString('ascii') === 'OggS') {
        return {
            format: 'ogg',
            lossless: false,
        };
    }

    if (sampleBuffer.length >= 12 && sampleBuffer.subarray(4, 8).toString('ascii') === 'ftyp') {
        return {
            format: 'm4a',
            lossless: false,
        };
    }

    return sniffFormatByContentType(contentType) || sniffFormatByUrl(url) || {
        format: 'unknown',
        lossless: false,
    };
}

/**
 * Score an audio candidate and return a detailed breakdown.
 *
 * @param {{ quality: string, formatInfo: object, bitrateKbps: number|null }} param0
 * @returns {{ score: number, breakdown: ScoringBreakdown }}
 *
 * @typedef {Object} ScoringBreakdown
 * @property {number} formatBase          - Base score for the audio format
 * @property {number} losslessBonus       - Bonus for lossless format (0 for 320k requests)
 * @property {number} bitrateBonus        - Bonus based on bitrate (bitrateKbps / 10)
 * @property {number} qualityAlignmentBonus - Bonus/penalty for quality alignment with requested quality
 * @property {number} sampleRateAdjust    - Adjustment based on sample rate
 * @property {number} bitsPerSampleBonus  - Bonus for high bit depth
 * @property {number} total               - Final total score (rounded)
 */
function scoreAudioCandidate({ quality, formatInfo, bitrateKbps }) {
    const format = formatInfo?.format || 'unknown';
    const normalizedQuality = String(quality || '').trim();
    const requestedTier = QUALITY_TO_TIER[normalizedQuality] || null;
    const isLosslessRequest = requestedTier === QUALITY_TIER.LOSSLESS;
    const is320kRequest = normalizedQuality === '320k';
    const is128kRequest = normalizedQuality === '128k';
    const isLosslessFormat = Boolean(formatInfo?.lossless);

    // 1. Format base score
    let formatBase = 0;
    switch (format) {
        case 'flac':   formatBase = 500; break;
        case 'wav':    formatBase = 460; break;
        case 'm4a':    formatBase = 260; break;
        case 'aac':    formatBase = 240; break;
        case 'ogg':    formatBase = 230; break;
        case 'mp3':    formatBase = 200; break;
        default:       formatBase = 100; break;
    }

    // 2. Lossless bonus — suppressed for 320k requests (per design: remove existing +120 for 320k)
    let losslessBonus = 0;
    if (isLosslessFormat && !is320kRequest) {
        losslessBonus = 120;
    }

    // 3. Bits-per-sample bonus
    let bitsPerSampleBonus = 0;
    if (formatInfo?.bitsPerSample >= 24) bitsPerSampleBonus = 40;

    // 4. Sample rate adjustment
    let sampleRateAdjust = 0;
    if (formatInfo?.sampleRate >= 96000) sampleRateAdjust = 20;
    else if (formatInfo?.sampleRate >= 48000) sampleRateAdjust = 10;
    else if (formatInfo?.sampleRate && formatInfo.sampleRate < LOW_SAMPLE_RATE_MP3_HZ) sampleRateAdjust = -50;

    // 5. Bitrate bonus
    const bitrateBonus = bitrateKbps ? Math.min(bitrateKbps, 1000) / 10 : 0;

    // 6. Quality alignment bonus/penalty
    let qualityAlignmentBonus = 0;

    if (isLosslessRequest) {
        // Lossless request: reward lossless format, penalise lossy
        if (isLosslessFormat) {
            qualityAlignmentBonus = 120;  // >= 100 per spec
        } else {
            qualityAlignmentBonus = -120; // <= -100 per spec
        }
    } else if (is320kRequest) {
        // 320k request: reward high-bitrate MP3; no bonus for lossless (already suppressed above)
        if (format === 'mp3' && bitrateKbps != null && bitrateKbps >= 256) {
            qualityAlignmentBonus = 80;   // >= 60 per spec
        }
        // lossless format with 320k request: qualityAlignmentBonus stays 0
    } else if (is128kRequest) {
        // 128k request: reward mid-range bitrate
        if (bitrateKbps != null && bitrateKbps >= 96 && bitrateKbps <= 160) {
            qualityAlignmentBonus = 30;   // >= 20 per spec
        }
    }

    const rawTotal = formatBase + losslessBonus + bitsPerSampleBonus + sampleRateAdjust + bitrateBonus + qualityAlignmentBonus;
    const total = Math.round(rawTotal);

    const breakdown = {
        formatBase,
        losslessBonus,
        bitrateBonus,
        qualityAlignmentBonus,
        sampleRateAdjust,
        bitsPerSampleBonus,
        total,
    };

    return { score: total, breakdown };
}

async function probeAudioCandidate(url) {
    const response = await axios({
        url,
        method: 'GET',
        responseType: 'arraybuffer',
        timeout: 8000,
        maxRedirects: 5,
        httpsAgent: requestHttpsAgent,
        proxy: false,
        validateStatus: () => true,
        headers: {
            'User-Agent': UA,
            'Accept': 'audio/*,*/*;q=0.8',
            'Range': `bytes=0-${SAMPLE_BYTES - 1}`,
        },
    });

    const sampleBuffer = Buffer.from(response.data || []);
    return {
        status: response.status,
        headers: response.headers || {},
        sampleBuffer,
        totalBytes: extractTotalBytes(response.headers || {}, sampleBuffer.length),
    };
}

async function validateAudioUrlCandidate(url, context = {}) {
    try {
        const probe = await probeAudioCandidate(url);
        const contentType = String(probe.headers['content-type'] || '').toLowerCase();
        const expectedDurationSeconds = normalizeDurationSeconds(context.musicInfo);
        const formatInfo = sniffAudioCharacteristics(probe.sampleBuffer, contentType, url);
        const derivedBitrateKbps = deriveBitrateKbps(probe.totalBytes, expectedDurationSeconds);
        const bitrateKbps = formatInfo?.bitrateKbps || derivedBitrateKbps;
        const estimatedDurationSeconds = estimateDurationSeconds(probe.totalBytes, formatInfo?.bitrateKbps);
        const minBitrateKbps = getQualityMinBitrateKbps(context.quality);

        if (probe.status >= 400) {
            return {
                ok: false,
                reason: `probe_status_${probe.status}`,
                details: {
                    status: probe.status,
                },
            };
        }

        if (contentType && !contentType.includes('audio') && !contentType.includes('octet-stream')) {
            return {
                ok: false,
                reason: 'non_audio_content_type',
                details: {
                    contentType,
                },
            };
        }

        if (looksLikeTextPayload(probe.sampleBuffer)) {
            return {
                ok: false,
                reason: 'text_like_payload',
                details: {
                    contentType,
                },
            };
        }

        if (probe.totalBytes && probe.totalBytes < ABSOLUTE_MIN_BYTES) {
            return {
                ok: false,
                reason: 'file_too_small',
                details: {
                    totalBytes: probe.totalBytes,
                    expectedDurationSeconds,
                    bitrateKbps,
                    format: formatInfo?.format,
                },
            };
        }

        for (const rule of DURATION_MIN_SIZE_RULES) {
            if (!expectedDurationSeconds || expectedDurationSeconds < rule.minDuration) continue;
            if (probe.totalBytes && probe.totalBytes < rule.minBytes) {
                return {
                    ok: false,
                    reason: 'duration_size_mismatch',
                    details: {
                        totalBytes: probe.totalBytes,
                        expectedDurationSeconds,
                        minExpectedBytes: rule.minBytes,
                        format: formatInfo?.format,
                    },
                };
            }
        }

        if (!expectedDurationSeconds && estimatedDurationSeconds && estimatedDurationSeconds < MIN_ESTIMATED_DURATION_WITHOUT_METADATA_SECONDS) {
            return {
                ok: false,
                reason: 'estimated_duration_too_short_without_metadata',
                details: {
                    estimatedDurationSeconds,
                    minEstimatedDurationSeconds: MIN_ESTIMATED_DURATION_WITHOUT_METADATA_SECONDS,
                    totalBytes: probe.totalBytes,
                    bitrateKbps,
                    format: formatInfo?.format,
                    sampleRate: formatInfo?.sampleRate || null,
                },
            };
        }

        if (estimatedDurationSeconds && expectedDurationSeconds) {
            const minExpectedDuration = Math.max(12, expectedDurationSeconds * 0.35);
            if (expectedDurationSeconds >= 60 && estimatedDurationSeconds < minExpectedDuration) {
                return {
                    ok: false,
                    reason: 'estimated_duration_too_short',
                    details: {
                        expectedDurationSeconds,
                        estimatedDurationSeconds,
                        totalBytes: probe.totalBytes,
                        bitrateKbps: formatInfo?.bitrateKbps,
                        format: formatInfo?.format,
                    },
                };
            }
        }

        if (
            formatInfo?.format === 'mp3'
            && formatInfo?.sampleRate
            && formatInfo.sampleRate < LOW_SAMPLE_RATE_MP3_HZ
            && probe.totalBytes
            && probe.totalBytes < LOW_SAMPLE_RATE_SMALL_MP3_BYTES
        ) {
            return {
                ok: false,
                reason: 'suspicious_low_samplerate_small_mp3',
                details: {
                    totalBytes: probe.totalBytes,
                    estimatedDurationSeconds,
                    bitrateKbps,
                    sampleRate: formatInfo.sampleRate,
                    minSampleRate: LOW_SAMPLE_RATE_MP3_HZ,
                    maxTotalBytes: LOW_SAMPLE_RATE_SMALL_MP3_BYTES,
                    format: formatInfo.format,
                },
            };
        }

        if (bitrateKbps && bitrateKbps < minBitrateKbps) {
            return {
                ok: false,
                reason: 'bitrate_too_low',
                details: {
                    bitrateKbps,
                    minBitrateKbps,
                    totalBytes: probe.totalBytes,
                    expectedDurationSeconds,
                    estimatedDurationSeconds,
                    format: formatInfo?.format,
                },
            };
        }

        const { score, breakdown } = scoreAudioCandidate({
            quality: context.quality,
            formatInfo,
            bitrateKbps,
        });

        return {
            ok: true,
            score,
            details: {
                status: probe.status,
                contentType,
                totalBytes: probe.totalBytes,
                expectedDurationSeconds,
                estimatedDurationSeconds,
                bitrateKbps,
                derivedBitrateKbps,
                format: formatInfo?.format,
                lossless: Boolean(formatInfo?.lossless),
                sampleRate: formatInfo?.sampleRate || null,
                bitsPerSample: formatInfo?.bitsPerSample || null,
                qualityAlignmentBonus: breakdown.qualityAlignmentBonus,
                scoringBreakdown: breakdown,
            },
        };
    } catch (error) {
        return {
            ok: true,
            skipped: true,
            score: 0,
            reason: 'probe_failed',
            details: {
                message: error.message,
            },
        };
    }
}

module.exports = {
    validateAudioUrlCandidate,
    getQualityMinBitrateKbps,
    scoreAudioCandidate,
    QUALITY_TIER,
    QUALITY_TO_TIER,
    QUALITY_MIN_KBPS_RELAXED,
    QUALITY_MIN_KBPS_STRICT,
    LOSSLESS_QUALITIES,
};
