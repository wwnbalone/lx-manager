const { UA } = require('./config');

function buildSubscriptionScript(baseUrl) {
    return `/*!
 * @name 本地综合回退源
 * @description 优先使用本地 sources 最近有效目录，并按文件名顺序串行回退
 * @version 1.0.0
 * @author Codex
 */

const BASE_URL = ${JSON.stringify(baseUrl)};
const UA = ${JSON.stringify(UA)};
const REMOTE_SOURCE_IDS = ['kw', 'tx', 'wy', 'kg', 'mg'];
const QUALITYS = ['128k', '320k', 'flac', 'flac24bit', 'master'];

function requestJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    if (!globalThis.lx || typeof globalThis.lx.request !== 'function') {
      reject(new Error('lx.request 不可用'));
      return;
    }

    const requestOptions = {
      method: options.method || 'GET',
      timeout: options.timeout || 15000,
      headers: {
        'User-Agent': UA,
        'Accept': 'application/json',
        ...(options.headers || {}),
      },
    };

    if (options.body != null) {
      requestOptions.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
      if (!requestOptions.headers['Content-Type']) {
        requestOptions.headers['Content-Type'] = 'application/json';
      }
    }

    globalThis.lx.request(url, requestOptions, (err, resp) => {
      if (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }

      try {
        const body = typeof resp.body === 'string' ? JSON.parse(resp.body) : resp.body;
        if (resp.statusCode >= 400) {
          reject(new Error((body && body.error) || ('HTTP ' + resp.statusCode)));
          return;
        }
        resolve(body);
      } catch (parseErr) {
        reject(parseErr);
      }
    });
  });
}

function ensureMusicInfo(musicInfo, source) {
  if (!musicInfo || typeof musicInfo !== 'object') {
    throw new Error('缺少歌曲信息');
  }

  return {
    ...musicInfo,
    source: musicInfo.source || source,
  };
}

function normalizeLyricResult(result) {
  if (typeof result === 'string') {
    return {
      lyric: result,
      tlyric: '',
      rlyric: '',
      lxlyric: '',
    };
  }

  return {
    lyric: (result && result.lyric) || '',
    tlyric: (result && result.tlyric) || '',
    rlyric: (result && result.rlyric) || '',
    lxlyric: (result && result.lxlyric) || '',
  };
}

if (globalThis.lx && globalThis.lx.EVENT_NAMES && typeof globalThis.lx.on === 'function' && typeof globalThis.lx.send === 'function') {
  const { EVENT_NAMES, on, send } = globalThis.lx;

  on(EVENT_NAMES.request, async ({ action, source, info }) => {
    switch (action) {
      case 'musicUrl': {
        const musicInfo = ensureMusicInfo(info && info.musicInfo, source);
        const quality = (info && info.type) || '128k';
        const payload = await requestJson(BASE_URL + '/proxy/url', {
          method: 'POST',
          body: {
            source,
            quality,
            musicInfo,
          },
        });

        if (!payload || !payload.url) throw new Error('未获取到可播放链接');
        return payload.url;
      }
      case 'lyric': {
        if (source !== 'local') throw new Error('仅 local 支持歌词');
        const musicInfo = ensureMusicInfo(info && info.musicInfo, source);
        const payload = await requestJson(BASE_URL + '/proxy/lyric', {
          method: 'POST',
          body: {
            source,
            musicInfo,
          },
        });

        return normalizeLyricResult(payload);
      }
      case 'pic': {
        if (source !== 'local') throw new Error('仅 local 支持封面');
        const musicInfo = ensureMusicInfo(info && info.musicInfo, source);
        const payload = await requestJson(BASE_URL + '/proxy/pic', {
          method: 'POST',
          body: {
            source,
            musicInfo,
          },
        });

        if (!payload || !payload.url) throw new Error('未获取到封面链接');
        return payload.url;
      }
      default:
        throw new Error('不支持的操作');
    }
  });

  const sources = {
    local: {
      name: '综合回退源',
      type: 'music',
      actions: ['musicUrl', 'lyric', 'pic'],
      qualitys: [],
    },
  };

  REMOTE_SOURCE_IDS.forEach(id => {
    sources[id] = {
      name: '综合回退源',
      type: 'music',
      actions: ['musicUrl'],
      qualitys: QUALITYS,
    };
  });

  send(EVENT_NAMES.inited, {
    openDevTools: false,
    sources,
  });
} else {
  const createMusicUrlHandler = source => function(musicInfo, quality) {
    return fetch(BASE_URL + '/proxy/url', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        source,
        quality,
        musicInfo: ensureMusicInfo(musicInfo, source),
      }),
    })
      .then(res => res.json())
      .then(body => {
        if (!body || !body.url) throw new Error('未获取到可播放链接');
        return body.url;
      });
  };

  const createLocalHandler = action => function(musicInfo) {
    return fetch(BASE_URL + '/proxy/' + action, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        source: 'local',
        musicInfo: ensureMusicInfo(musicInfo, 'local'),
      }),
    })
      .then(res => res.json())
      .then(body => {
        if (action === 'lyric') return normalizeLyricResult(body);
        if (!body || !body.url) throw new Error('未获取到结果');
        return body.url;
      });
  };

  const source = {
    name: '本地综合回退源',
    description: '优先使用本地 sources 最近有效目录，并按文件名顺序串行回退',
    version: '1.0.0',
    author: 'Codex',
    sources: {
      local: {
        name: '综合回退源',
        getMusicUrl: createMusicUrlHandler('local'),
        lyric: createLocalHandler('lyric'),
        pic: createLocalHandler('pic'),
      },
    },
  };

  REMOTE_SOURCE_IDS.forEach(id => {
    source.sources[id] = {
      name: '综合回退源',
      getMusicUrl: createMusicUrlHandler(id),
    };
  });

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = source;
  }
}
`;
}

module.exports = {
    buildSubscriptionScript,
};
