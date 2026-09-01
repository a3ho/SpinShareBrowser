# Changelog

SpinShare Browser maintains and distributes only the latest stable release. Historical installers are unavailable; install the current release to receive updates and support.

SpinShare Browser 仅维护和提供最新稳定版，历史安装包不再提供下载；请安装当前版本以获得更新与问题支持。

## 2.0.0 — 2026-09-01

Version 2.0.0 is a major update to browsing, playback, data synchronization, comments, and installation reliability.

### English

#### Interface and chart browsing

- Rebuilt the Windows interface with a responsive, high-density layout, clearer typography, consistent focus treatment, refined motion, and cohesive loading, empty, pagination, and footer states.
- Added local-first keyword search, tag combinations, sorting, date and difficulty filters, and views for all, installed, or uninstalled charts.
- Improved chart cards with larger covers, selectable song titles, a separate official-page link, concise metadata, and anchored author-note previews.

#### Full-song player

- Added one global header player for complete chart audio, with cover controls, song and artist information, elapsed and total time, and a draggable progress bar.
- Added Space to pause or resume and Left / Right to seek by 5 seconds when those keys do not belong to an editor or another native control.
- Fixed Left / Right seeking after selecting a chart cover or focusing the player timeline, so each key press moves exactly 5 seconds.
- Added robust OGG playback with one MP3 fallback, bounded loading time, state preservation across local browsing operations, and clear playback feedback.

#### Descriptions, reviews, and focus

- Long author notes now grow downward from their original region into an anchored floating card, then shrink back along the same path without moving surrounding charts.
- Review counts load independently in the background and remain visible. Zero-count controls cannot expand; unknown counts are never presented as zero.
- Added focused floating review panels with contained wheel scrolling, responsive placement, click-again and Escape dismissal, and a shared 60-second manual refresh interval.

#### Local data and synchronization

- Persisted the full chart catalog locally so filtering, search, tags, sorting, installation status, and paging do not require another full server request.
- Added automatic synchronization when local data is missing or more than 12 hours old, plus a separate foreground update action with a restart-resistant 10-minute interval.
- Added classified network, access, rate-limit, server, transfer, response, and local-storage errors; automatic retries use backoff, while eligible explicit retries remain available.
- Added startup synchronization focus panels and compact, no-focus tray notices for background completion or failure.

#### Installation and reliability

- Added a one-time folder confirmation before the first chart installation, with the same directory picker used by Settings.
- Added a bounded 128-task queue, up to two concurrent downloads, serialized installation, complete ZIP validation, staged replacement, and rollback safeguards.
- The installer now presents existing installations as an overwrite update. Program files are replaced while settings and locally installed charts remain unchanged.
- Updated the packaged Windows runtime, compatibility checks, local cache handling, keyboard behavior, and automated coverage for the 2.0.0 release.

---

2.0.0 是一次覆盖浏览、播放、数据同步、评论与安装可靠性的大版本更新。

### 简体中文

#### 界面与谱面浏览

- 重新设计 Windows 界面，采用自适应高密度布局，统一字体、焦点反馈与动效，并整理加载、空状态、分页和页脚表现。
- 新增本地优先的关键词搜索、标签组合、排序、日期与难度筛选，以及全部、仅已安装和仅未安装三种视图。
- 优化谱面卡片，使用更大封面、可选择复制的歌名、独立官网入口、紧凑元数据和锚定式作者说明预览。

#### 完整歌曲播放器

- 新增顶栏全局播放器，播放谱面的完整歌曲，显示封面、歌名、艺人、当前与总时间，并提供可拖动进度条。
- 当编辑器或原生控件不占用按键时，Space 可暂停或继续，左右方向键可后退或快进 5 秒。
- 修复点击谱面封面或聚焦播放器进度条后左右方向键失效或只移动少量时间的问题，现在每次精确移动 5 秒。
- 完善 OGG 播放与单次 MP3 回退、加载超时、浏览状态保留和播放反馈。

#### 作者说明、评论与聚焦体验

- 较长的作者说明从原区域向下扩展为锚定浮动卡片，收起时沿同一路径缩回，不推移周围谱面。
- 评论数量在后台独立加载并始终可见；零评论按钮无法展开，未知状态不会显示成 0。
- 新增聚焦式评论浮层、浮层内独立滚动、自适应定位、再次点击或 Escape 收起，以及所有谱面共用的 60 秒手动更新间隔。

#### 本地谱面数据与同步

- 将完整谱面数据持久保存在本地，筛选、搜索、标签、排序、安装状态和翻页不会再次请求服务器全量数据。
- 本地谱面数据不存在或超过 12 小时未更新时自动同步；前台手动更新独立使用重启后仍有效的 10 分钟间隔。
- 区分网络、访问拒绝、限流、服务器、传输、响应和本地存储错误；自动重试采用退避，符合条件的主动重试仍可立即执行。
- 新增启动同步聚焦卡片，以及后台同步完成或失败时不抢焦点的紧凑托盘提示。

#### 安装与可靠性

- 首次安装谱面前新增一次目录确认，并复用设置中的目录选择器。
- 新增最多 128 项任务的有界队列、最多两个并发下载、串行安装、完整 ZIP 校验、暂存替换与回滚保护。
- 安装程序会将现有安装明确呈现为覆盖更新：替换程序文件，同时保留设置和本地已安装谱面。
- 更新 Windows 打包运行环境、兼容性检查、本地缓存处理、键盘交互和 2.0.0 自动化测试覆盖。
