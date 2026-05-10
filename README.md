# LX Manager

`LX Manager` 是一个给 `LX Music / 洛雪音乐` 自定义源使用的本地聚合服务。

它负责托管订阅脚本、管理本地 `sources` 目录中的真实音源文件，并在搜索、播放、歌词、封面请求到来时，按规则调度这些音源，对结果做筛选和容错，然后把兼容 LX 客户端的结果返回回去。

这个项目的目标不是改造 LX 客户端，而是在客户端无感知的前提下，把音源管理、更新、回退、日志和部署全部放到服务端处理。

## 功能概览

- 托管 LX 可直接订阅的自定义源脚本：`/custom-source.js`（别名 `/subscription`）
- 从本地 `sources/YYYY-MM-DD/` 目录加载音源，优先使用最近日期目录
- 搜索和播放时按文件顺序调度真实音源
- 播放链接支持限时选优，避免把所有音源都串行请求一遍导致播放过慢
- 默认并发 3 个候选，在 4 秒窗口内从已返回结果里挑选可用且更优的链接
- 对可疑音频做探测和过滤，拦截错误提示 MP3、过短文件、低采样率异常文件、码率过低文件
- 严格遵守 LX 客户端传入的"最高音质"限制，不会强制返回更高音质
- 音源质量评估与优先级排序：根据脚本元数据和描述自动打分，优先调度高质量音源
- 质量不匹配检测：返回结果时标注实际音质是否低于请求音质
- 禁用大部分上游音源脚本自带的更新提示检查，减少无意义请求
- 支持从 GitHub 自动抓取和更新音源文件
- 更新时记录 `repo / file / commit` 元数据，相同提交不会重复下载
- 如果昨天已经下载过同一 `repo + file + commit`，今天会直接复用，减少重复流量
- 日志写入文件，并按保留天数、单文件大小、总大小自动清理
- 支持直接运行在 Linux / WSL2 / r2s
- 自带 iStoreOS / OpenWrt LuCI 插件骨架，支持本地安装

## 适用场景

- 你希望把 LX 自定义源统一收口到自己的服务端管理
- 你希望把多个第三方音源做成一个"综合源"
- 你希望优先读取本地每天下载的音源快照，而不是在客户端硬编码远程脚本地址
- 你需要在 r2s / iStoreOS 上长期运行，并希望有日志、更新、定时任务和 LuCI 页面
- 你希望通过 Cloudflare Tunnel、Tailscale 或内网 IP 暴露订阅地址

## 工作方式

### 1. 订阅脚本

服务暴露：

- `GET /custom-source.js`
- `GET /subscription`（别名）

LX 客户端添加这个地址后，后续的搜索、播放、歌词、封面请求都会发到本服务。

### 2. 音源目录

默认音源目录为：

```text
sources/
  2026-03-27/
  2026-03-28/
```

每个日期目录下存放多个 `.js` 音源文件。服务会优先读取最近一天的目录，并按文件名排序后依次调度。

### 3. 搜索

搜索请求会命中本地音源文件中的搜索接口，返回第一个可用结果。

### 4. 播放

播放请求不会无脑把所有源都跑一遍，而是采用"限时 + 并发 + 选优"的策略：

- 默认最多并发 `3` 个候选请求
- 默认最多考察 `6` 个候选文件
- 默认选择窗口 `4` 秒
- 在时间窗口内，从已经返回的候选里选出最优可播放链接

### 5. 播放结果校验

服务端会对候选音频链接做探测，过滤常见异常，例如：

- 返回的是错误提示音频而不是真实歌曲
- 文件大小明显异常
- 估算时长明显过短，例如 9 秒提示音
- 采样率很低且体积很小的可疑 MP3
- 请求 `320k` 却只返回远低于预期的低码率文件
- 请求了较低上限音质，却返回了超出上限的高音质文件

### 6. 音质上限与质量过滤

LX 客户端传入的音质现在会被当作"严格上限"处理，而不是"最低要求"。

例如：

- 客户端设为 `128k`，服务不会返回 `320k / flac / wav`
- 客户端设为 `320k`，服务不会返回 `flac / wav`
- 客户端设为 `flac`，服务允许普通无损，但不会强行升到更高等级的 24bit / master

质量过滤支持严格模式和宽松模式，可通过环境变量 `QUALITY_FILTER_STRICT` 控制。返回结果中会标注 `qualityMismatch` 字段，指示实际音质是否低于请求音质。

### 7. 音源质量评估

服务会根据音源脚本的元数据（`@name`、`@description`、`@author` 等）和文件路径自动评估音源质量：

- 按规则匹配关键词（独家音源、优质、无损、Hi-Res、试听、封禁IP 等）
- 计算综合评分（0-100）和优先级（1-5）
- 高优先级音源在调度时优先被使用
- 更新时自动生成带优先级和标签的文件名，便于排序

## 技术栈

- `Node.js 18+`（建议 20+）
- `Express 5`
- `axios`
- `https-proxy-agent`
- `node-cron`
- `fast-check`（属性测试）
- `LuCI / OpenWrt / iStoreOS` 打包与启动脚本

## 目录结构

```text
.
├── app.js                           # HTTP 服务入口
├── updater.js                       # 手动/定时抓取音源入口
├── lib/
│   ├── audio-validator.js           # 音频探测与异常过滤
│   ├── config.js                    # 环境变量与运行配置
│   ├── logger.js                    # 文件日志与清理策略
│   ├── source-quality.js            # 音源质量评估与优先级排序
│   ├── source-response.js           # 音源返回值兼容处理
│   ├── source-runner.js             # 音源脚本执行与调度
│   ├── source-store.js              # 日期目录与快照管理
│   ├── subscription-script.js       # 输出给 LX 的订阅脚本
│   └── updater.js                   # GitHub 音源抓取逻辑
├── sources/                         # 本地音源快照目录
├── deploy/r2s/                      # r2s / OpenWrt 部署文件
│   ├── lx-manager.env.example       # 环境变量示例
│   ├── lx-manager.openwrt.init      # OpenWrt init 脚本
│   └── lx-manager.service           # systemd 服务文件
├── luci-app-lx-manager/             # iStoreOS / OpenWrt LuCI 插件
├── scripts/
│   ├── deploy-to-r2s.py             # 远程部署到 r2s 脚本
│   ├── install-istoreos-local.sh    # 本地安装到 iStoreOS
│   ├── uninstall-istoreos-local.sh  # 卸载脚本
│   ├── start-r2s.sh                 # r2s 启动脚本
│   ├── _check_fw.py                 # 防火墙检查工具
│   ├── _check_lan.py                # 局域网检查工具
│   └── _check_net.py                # 网络连通性检查工具
├── test/                            # 测试
│   ├── app.test.js                  # 应用接口测试
│   ├── audio-validator.test.js      # 音频校验单元测试
│   ├── audio-validator.property.test.js  # 音频校验属性测试
│   ├── config.test.js               # 配置模块测试
│   ├── source-runner.test.js        # 调度器单元测试
│   └── source-runner.property.test.js    # 调度器属性测试
├── DEPLOY_R2S.md                    # r2s 部署说明
├── INSTALL_ISTOREOS_LOCAL.md        # iStoreOS 本地安装说明
└── ISTOREOS_PLUGIN.md               # LuCI 插件说明
```

## 运行要求

- `Node.js 18+`
- `npm`
- Linux / WSL2 / OpenWrt / iStoreOS 任一运行环境

建议：

- 正式部署优先使用 `Node.js 20`
- `sources` 和 `logs` 最好放在外置存储，不要长期写路由器内置闪存

## 本地开发

### 1. 克隆项目

```bash
git clone https://github.com/wwnbalone/lx-manager.git
cd lx-manager
```

### 2. 安装依赖

```bash
npm install
```

### 3. 启动服务

```bash
npm start
```

默认监听：

```text
http://0.0.0.0:4000
```

### 4. 验证

```bash
curl http://127.0.0.1:4000/health
curl http://127.0.0.1:4000/custom-source.js
```

### 5. 运行测试

```bash
npm test
```

## 常用命令

```bash
npm start      # 启动服务
npm run update # 执行一次音源更新
npm test       # 运行测试
```

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | 监听地址 |
| `PORT` | `4000` | 监听端口 |
| `SOURCE_BASE_DIR` | `./sources` | 音源快照目录 |
| `LOG_DIR` | `./logs` | 日志目录 |
| `GITHUB_TOKEN` | 空 | 可选，提升 GitHub API 抓取额度 |
| `PROXY_URL` | 空 | 可选，服务端出站代理 |
| `MAX_DAYS` | `30` | 保留最近多少天的音源目录 |
| `SEARCH_LIMIT` | `10` | GitHub 搜索仓库数量上限 |
| `MAX_COMMIT_AGE_MONTHS` | `3` | 只考虑最近多少个月有更新的提交 |
| `URL_SELECT_WINDOW_MS` | `4000` | 播放候选选择窗口（毫秒） |
| `URL_MAX_CONCURRENT_REQUESTS` | `3` | 播放候选最大并发数 |
| `URL_MAX_CANDIDATES` | `6` | 单次播放最多考察多少个候选文件 |
| `SOURCE_DISABLE_UPDATE_CHECK` | `true` | 禁用音源脚本自带更新检查 |
| `QUALITY_FILTER_STRICT` | `false` | 严格质量过滤模式（开启后对 320k 使用更高码率阈值） |
| `QUALITY_FILTER_BITRATE_320K` | `200` | 320k 请求的最低码率阈值（kbps） |
| `QUALITY_FILTER_BITRATE_128K` | `96` | 128k 请求的最低码率阈值（kbps） |
| `LOG_RETENTION_DAYS` | `7` | 日志保留天数 |
| `LOG_MAX_TOTAL_SIZE_BYTES` | `52428800` | 日志总大小上限（50MB） |
| `LOG_MAX_FILE_SIZE_BYTES` | `10485760` | 单个日志文件大小上限（10MB） |
| `LOG_CLEANUP_INTERVAL_MS` | `21600000` | 日志清理间隔（6小时） |

## HTTP 接口

### `GET /`

返回服务状态和主要接口列表。

### `GET /health`

健康检查接口。返回质量过滤配置状态。

### `GET /custom-source.js` / `GET /subscription`

返回 LX 可直接订阅的自定义源脚本。支持 `?baseUrl=` 参数指定回调地址。

### `GET /proxy/search?q=<keyword>`

搜索歌曲。

支持参数：

| 参数 | 说明 |
| --- | --- |
| `q` / `keyword` | 搜索关键词（必填） |
| `page` | 页码，默认 1 |
| `limit` | 每页数量，默认 20 |
| `source` | 指定音源平台（可选） |

### `POST /proxy/url`

获取播放链接。

请求体示例：

```json
{
  "source": "kg",
  "quality": "320k",
  "musicInfo": {
    "id": "123",
    "name": "夜曲",
    "singer": "周杰伦",
    "source": "kg"
  }
}
```

返回结果包含 `qualityMismatch` 字段，指示实际音质是否低于请求音质。

### `POST /proxy/lyric`

获取歌词。返回格式：

```json
{
  "lyric": "...",
  "tlyric": "...",
  "rlyric": "...",
  "lxlyric": "..."
}
```

### `POST /proxy/pic`

获取封面。

## 在 LX Music 中使用

把下面地址填到 LX 自定义源：

```text
http://<your-host>:4000/custom-source.js
```

如果你用了 HTTPS 反代、Cloudflare Tunnel 或公网域名：

```text
https://<your-domain>/custom-source.js
```

## 音源更新机制

更新入口：

```bash
npm run update
```

更新逻辑：

- 通过 GitHub 搜索 `lx-music-source` 相关仓库
- 拉取目标仓库中的音源脚本
- 把下载结果写入当天目录，如 `sources/2026-03-29/`
- 自动附加来源元数据：`repo-url / repo / commit / file`
- 自动评估音源质量并生成带优先级标签的文件名
- 如果昨天已经下载过同一 `repo + file + commit`，今天直接复制复用
- 如果今天已存在相同提交版本，不会重复覆盖
- 如果昨天某个文件失败了，今天仍会继续尝试下载
- 自动清理超出保留天数的旧目录

## 日志

日志默认写入 `logs/`，文件名示例：

```text
lx-manager-2026-03-29.log
```

日志特性：

- 文件日志
- 自动分片
- 自动按保留天数清理
- 自动按总大小上限清理
- 对音源脚本里的 `console.log` 也会做统一收口

常见排查重点：

- 搜索是否命中了哪个真实音源文件
- 播放候选为什么被过滤
- 是否命中了 `quality_above_requested_max`
- 是否命中了 `estimated_duration_too_short`
- 是否命中了 `suspicious_low_samplerate_small_mp3`
- 是否出现了 `qualityMismatch`

## 定时更新

如果你希望每天凌晨 4 点执行一次更新，可以在 Linux / OpenWrt 上配置 cron：

```cron
0 4 * * * /etc/init.d/lx-manager update >> /tmp/lx-manager-update.log 2>&1
```

如果你不是通过 init 脚本部署，也可以直接：

```cron
0 4 * * * cd /path/to/lx_manager && /usr/bin/node updater.js >> /tmp/lx-manager-update.log 2>&1
```

## 部署

### r2s / Debian / Armbian

见：

- [DEPLOY_R2S.md](./DEPLOY_R2S.md)

快速部署（需要 Python 3）：

```bash
python scripts/deploy-to-r2s.py
```

### iStoreOS / OpenWrt 本地安装

见：

- [INSTALL_ISTOREOS_LOCAL.md](./INSTALL_ISTOREOS_LOCAL.md)
- [ISTOREOS_PLUGIN.md](./ISTOREOS_PLUGIN.md)

快速安装：

```sh
cd /root/lx_manager
sh scripts/install-istoreos-local.sh
```

安装后可在 LuCI 中打开：

```text
Services -> LX Manager
```

## 通过 Cloudflare Tunnel 暴露订阅地址

如果你不方便直接暴露公网端口，可以使用 Cloudflare Tunnel，把：

```text
http://127.0.0.1:4000
```

映射到类似：

```text
https://lx.example.com
```

然后把 LX 里的订阅地址改成：

```text
https://lx.example.com/custom-source.js
```

注意：

- Cloudflare Tunnel 只负责入口访问
- 服务端访问第三方音源仍然取决于你这台机器本身的网络环境
- 如果用了 OpenClash / Tailscale / 自定义 DNS，先确保 `cloudflared` 的 DNS 解析正确

## 辅助工具

`scripts/` 目录下提供了一些辅助检查脚本：

| 脚本 | 说明 |
| --- | --- |
| `_check_fw.py` | 检查防火墙规则是否放行了服务端口 |
| `_check_lan.py` | 检查局域网设备是否能访问服务 |
| `_check_net.py` | 检查服务器到外部网络的连通性 |

## 已解决的几个关键问题

这个项目当前已经处理了这些在 LX 自定义源场景里很常见的问题：

- 双重 JSON 编码请求体导致服务端解析失败
- 某些错误 MP3 实际是语音提示或假资源
- 某些源的同文件不同平台 key 会错误串台
- 某些音源脚本每次启动都去请求更新提示
- 更新脚本每日重复下载完全相同的音源文件
- iStoreOS 运行目录和开发目录不一致导致"明明改了代码但路由器没生效"
- 请求高音质却返回低码率文件，或请求低音质却返回超规格文件

## 免责声明

本项目仅用于自定义源管理、脚本调度和自建服务部署研究。

第三方音源脚本及其上游接口均不属于本项目控制范围。请自行评估相关来源、可用性、稳定性以及合规性。

## License

本仓库代码使用 `ISC` 协议发布，完整文本见根目录 [LICENSE](./LICENSE)。

需要注意的是：

- 本仓库自身的服务端代码、部署脚本和文档按 `ISC` 许可
- 第三方音源脚本及其上游接口不当然适用本仓库的 `ISC` 协议
- 如果你自行抓取或分发第三方 `sources` 快照，需要自行确认其来源和授权边界
