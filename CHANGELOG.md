# Changelog

SpinShare Browser retains, maintains, and supports only the latest stable release. Older releases, downloadable assets, and version tags are removed after the replacement is verified and published. The entries below remain as development history.

SpinShare Browser 仅保留、维护和支持最新稳定版。新版验证并发布后，删除全部旧版发布页、下载附件和版本标签，旧版本不再保留。以下条目仅记录开发历史。

## 2.4.0 — 2026-10-25

- Playlists are viewed, not opened: a large floating panel grows over the current page with the playlist's charts — full cards with real stats, no filters, the player keeps playing. Close with the button, Escape, or a click outside.
- 歌单从“打开”改为“查看”：当前页面直接长出一个大浮窗浏览歌单内全部谱面——完整卡片带真实统计、没有筛选器、播放器照常工作；按钮、Esc 或点外部均可关闭。
- Reviews on a profile are clickable: pick any review and the reviewed chart opens in the same floating browser.
- 主页里的评论可点击：点任意评论，被评论的谱面在同一浮窗中展开。
- Notification "Go to chart" opens the same floating browser instead of navigating away.
- 通知里的“前往谱面”同样改为浮窗打开，不再跳转。
- The profile banner no longer clips the avatar, the profile has a visible close button that returns to where you were, and its chart cards show views, downloads and review counts.
- 主页横幅不再裁切头像；主页有清晰可见的返回按钮；主页谱面卡片补齐浏览量、下载量与评论数。
- Own charts can be managed (deleted) from wherever their cards appear, including your profile.
- 自己的谱面在任意出现其卡片的位置（含个人主页）均可管理（删除）。

## 2.3.5 — 2026-10-25

- The top-bar player works again in every window state once a song is playing. A stale limit in the native window layer silently rejected the layout that appears when you are signed in, leaving the player covered by the drag region.
- 播放歌曲后，顶栏播放器在任意窗口状态下恢复可用。此前的原生窗口层存在一个过期的数量上限，登录状态下会把播放器所在区域错误地留给窗口拖拽。
- Signing out immediately gates reviews: the publish entry disappears, charts without reviews can no longer be opened, and disabled review buttons no longer react to clicks.
- 退出登录立即收敛评论区：发布入口消失、无评论谱面不再可点、禁用状态的评论按钮不再有点击反馈。
- "My profile" opens again; the question-mark help beside Chart auto-update now anchors next to its button like every other help, and "Update data" is now "Sync chart library" with a help note that says exactly that.
- “我的主页”恢复正常打开；“谱面自动更新”旁的问号说明改为与其它帮助浮层一致的锚定样式；“更新数据”更名为“同步谱面库”，说明文字同步更新。
- Choosing a backup .zip for upload works again.
- 上传谱面时选择 backup.zip 恢复正常。

## 2.3.4 — 2026-10-25

- Sign-in is reliable again: the sign-in window always opens inside the app, stays open while you type your password or a two-factor code, and no longer reports a timeout early.
- 登录恢复可靠：登录窗口始终在应用内打开，输入密码或两步验证码期间保持等待，不再提前提示超时。
- In a maximized window, every top-bar player control is clickable again.
- 最大化窗口时，顶栏播放器的全部控件恢复可点击。
- The chart auto-update switch sits on a single line and stays where you set it.
- 谱面自动更新开关独占一行，切换后保持所选状态。
- Signed in, charts without any review open their review panel so you can be the first to comment; signed out, the review button is disabled.
- 登录后，还没有评论的谱面也能打开评论面板成为第一位评论者；未登录时评论按钮置灰。
- The account menu opens right under your avatar, and the "Add to playlist" popover opens instantly with your playlists already loaded.
- 账户菜单在头像正下方打开；"收藏到歌单"浮层即时弹出，歌单已预先加载。
- Expanded inline reviews are visually separated from the chart information.
- 展开的行内评论与谱面信息有清晰的视觉分界。

## 2.3.0 — 2026-10-24

- In-app user profiles: click any charter name or review author to see their charts, playlists, reviews and SpinPlays. Each profile has a unique gradient banner; your own profile includes an Upload chart shortcut. Opening someone's playlist also offers one-click sync to the game.
- 应用内用户主页：点击谱师名或评论作者查看其谱面、歌单、评论与 SpinPlays；每个主页有独特渐变横幅；自己的主页含上传谱面入口；他人歌单同样支持一键同步到游戏。
- The "Add to playlist" popover now opens instantly, follows its anchor while scrolling, and updates checkboxes in place. The notifications popover matches the same quality.
- "收藏到歌单"浮层即时打开、滚动时跟随锚点、勾选状态原位刷新；通知浮窗同规格。
- The filter bar is honest: Reset lives beside Filter charts, and both stay quiet until the criteria actually change.
- 筛选区更诚实：重置按钮移至"筛选谱面"旁边，两个按钮在条件未变时保持安静禁用。
- Settings gains an OK button (replacing Quit app and the corner close), clearer section spacing, a topbar free of the language selector, and a new "Keep installed charts up to date" switch that automatically reinstalls installed charts when publishers release new versions — locally modified files are never touched.
- 设置面板新增 OK 按钮（替代完全退出与右上角关闭）、分区间距更清晰、顶栏移除语言选择器，并新增"保持已安装谱面为最新"开关：发布者发布新版本时自动重装，本地手动修改的文件永不触碰。

## 2.2.0 — 2026-10-24

- Sign in to spinsha.re from Settings. Sign-in happens on the real website inside a dedicated window (two-factor included); the session is stored encrypted on this computer only and can be signed out at any time. Browsing and installing keep working without signing in.
- 在设置中登录 spinsha.re。登录在专属窗口内的官方网站完成（支持两步验证）；会话仅加密保存在本机，可随时断开。不登录不影响浏览与安装。
- Manage playlists: create and delete playlists, add or remove charts, and open any playlist as a focused view of the catalog. Playlist covers are generated automatically; operations are verified against the website after every change.
- 歌单管理：创建与删除歌单、添加或移除谱面，并可将任意歌单作为目录的聚焦视图打开。歌单封面自动生成；每次修改都会与网站核对结果。
- One-click playlist sync: pick a playlist, review what is missing, and install everything through the same verified pipeline as manual installs. Stop only cancels the remaining queue; an in-flight install is never interrupted.
- 歌单一键同步：选择歌单、查看缺口清单后，用与手动安装相同的验证管线批量安装。停止只取消后续任务，绝不打断进行中的安装。
- Read and write reviews in the chart review panel: post a recommendation with your comment (shown immediately), delete your own review, and see your own state per chart. Reviews on your own charts are blocked, matching the website.
- 在谱面评论面板中读写评论：发布推荐与评论（即时显示）、删除自己的评论、查看自己的评论状态。与网站一致，不能评价自己的谱面。
- The top bar gains a notifications bell (checked only when opened, never in the background), an account chip with your playlists, charts and reviews, and an upload entry.
- 顶栏新增通知铃铛（仅打开时检查，绝无后台轮询）、账户入口（歌单／我的谱面／我的评论）与上传入口。
- Upload charts: pick an SRXD backup .zip, describe and tag it, choose the required DLC and publication status, and publish — all from the app. Manage your uploaded charts in the "My charts" view.
- 上传谱面：选择 SRXD backup .zip、填写描述与标签、选择所需 DLC 与发布状态后直接发布。在“我的谱面”视图中管理已上传作品。
- The volume slider appears in the header player and persists across restarts; filters render as a compact pill row.
- 顶栏播放器新增音量调节并在重启后保持；筛选区重塑为紧凑的胶囊行。
- Internal: web sources are authored in modular files and assembled at build time; the session channel runs all website writes through one serial, spaced queue with before/after verification.
- 内部：前端源码模块化并改为构建期拼装；网站写操作统一经过串行、留间隔并带前后核对的会话通道。

## 2.1.1 — 2026-09-14

- Recheck the catalog when a newly installed chart differs from its cached version. Batch these automatic checks, retain refresh cooldowns and failure backoff, and compare the actual local hash again after refreshing. New cache generations also invalidate displayed installation states when returned by cache-only or cooldown responses.
- 新下载的谱面与缓存列表不一致时，自动更新列表再核对实际文件；合并批量安装的更新请求，保留刷新间隔与失败退避。只读缓存或冷却响应带回新版列表时，也同步更新安装状态，避免旧哈希造成误报。

## 2.1.0 — 2026-09-06

### English

- Fix the installer continuing after Cancel in a preparation failure prompt. Keep the preparation error until Inno Setup restores cancellation, then exit without copying application files. Show separate extraction, running-app and file-check phases; allow up to five seconds for a requested app exit before returning to Retry/Cancel.
- Distinguish exact installations, locally differing chart contents, missing charts, and failed checks. The installed filter includes differing local charts; the dedicated filter finds them without presenting every difference as an available update. Reinstallation explains that local edits will be replaced; one-click deletion still requires an exact match.
- File-sharing locks, permission errors and read failures no longer produce successful "not installed" results. All browsing modes expose actual inventory failures and Retry while retaining the last confirmed state.
- Clarify that chart fields are searched locally while unknown uploader accounts are looked up online as needed. Failed uploader lookups preserve local matches and remain retryable; regression checks cover the default search scopes.
- Persist an installation transaction before replacing originals. Interrupted installs can recover on startup or a later idle operation; conflicts preserve backups and explain recovery failure. Committed transactions only finish cleanup. Existing unrecorded legacy temporary files and chart deletion transactions are not migrated.
- Add exact dependency preflight, clean-source and unpublished-version release gates, exclusive build locking, compilation from the source snapshot, and a build manifest with source, environment, tool and artifact hashes. Repeatable unpublished builds use a separate QA output directory.
- Add Windows CI for offline regressions, isolated headless Edge interface checks, and packaging. Dedicated hosted-runner checks exercise real installation, upgrade, desktop hosting and uninstallation without operating a developer's desktop.

### 简体中文

- 修复安装准备失败弹窗点击“取消”后仍继续安装的问题：保留准备失败状态，等 Inno Setup 恢复取消操作后退出，不复制程序文件。分别显示解压、运行状态和文件检查阶段；请求程序退出后最多等待五秒，再返回“重试／取消”。
- 区分精确已安装、本地内容不同、未安装与核对失败。“仅已安装”包含内容不同的本地谱面，另提供独立筛选，不把所有差异都称为可用更新。重装说明会覆盖个人修改，一键删除仍要求精确匹配。
- 文件共享锁、权限和读取错误不再成功返回“未安装”；所有浏览模式均显示实际核对失败与重试，并保留最近确认的状态。
- 明确谱面字段本地搜索、未知上传者账号按需联网补全的边界；补全失败保留本地匹配并可重试，回归检查覆盖默认搜索范围。
- 替换原文件前持久保存安装事务，启动或后续空闲操作可恢复中断安装；冲突时保留备份并说明恢复失败。已提交事务仅完成清理。不迁移旧版没有映射的临时文件，也不改变谱面删除事务。
- 新增精确依赖预检、干净源码与未发布版本门禁、构建互斥、源码快照编译，以及记录来源、环境、工具和产物哈希的构建清单。可重复的未发布构建使用独立 QA 输出目录。
- 新增 Windows CI，覆盖离线回归、隔离无界面 Edge 界面检查和打包；专用托管 runner 检查真实安装、升级、桌面宿主和卸载，不操作开发者的桌面。

## 2.0.1 — 2026-09-05

### English

- Restored dragging from the empty title-bar space between the player and the right-hand controls, with at least 32px of reserved drag space. The player adapts to narrow windows; its text and background can also drag the window, while the cover button, timeline, and Retry remain interactive. Stable hit regions retain the native window-freeze fix without following track-change animations.
- Fixed a reproducible window freeze when activating, moving, or resizing the app with a changing header player. Window dragging and resizing now use a single host-owned native hit region instead of WebView2's changing non-client regions. Player controls remain interactive, and title-bar double-click behavior is preserved.
- Fixed previews for charts such as **The Kraken** and **FOREVER NOW**, whose public audio URLs are absent because they reference music supplied with the game. After both normal CDN formats fail, the app reads the static chart reference and streams the exact OGG from the user's Steam game or installed DLC, with seeking. It does not modify, copy, convert, or redistribute game audio; the required game resources must be installed.
- Added bounded, cancellable audio resolution, version-aware caching, isolated concurrency, and same-origin range streaming. Fast switching, pausing, hiding, and exiting cannot revive an obsolete playback request. Working CDN audio keeps its existing direct path.
- Playback failures now show a concise recovery message and **Retry** in the existing player height, with full accessible error detail and keyboard focus recovery. Settings, activity, and window-exit notifications share idempotent media cleanup.

### 简体中文

- 恢复播放器与右侧控件之间空白标题栏的拖动，并保留至少 32px 的可拖动留白；窄窗由播放器自适应让出空间。播放器内除封面按钮、进度条和重试按钮以外的区域也可拖动，保留原生窗口防卡死修复与稳定命中区域，不随换曲动画反复更新。
- 修复播放器更新时激活、拖动或缩放窗口可复现的卡死。窗口拖动和缩放改由宿主维护单个原生命中区域，不再使用 WebView2 动态非客户区；播放器控件保持可操作，标题栏双击行为保留。
- 修复 **The Kraken**、**FOREVER NOW** 等引用游戏音乐、没有公开音频文件的谱面无法试听的问题。两个常规 CDN 格式均失败后，按静态谱面引用读取本机 Steam 游戏或已安装 DLC 中的精确 OGG，并支持进度定位。不修改、复制、转码或分发游戏音频；本机需已安装所需游戏资源。
- 音频解析可取消、有超时，并采用绑定谱面版本的缓存、独立并发和同源分段读取。快速切歌、暂停、隐藏和退出不会被迟到请求恢复旧播放；正常 CDN 音频仍沿用原有直连路径。
- 播放失败在播放器原有高度中显示简短恢复说明与“重试”，补齐完整无障碍原因和键盘焦点返回。设置、活动与窗口退出通知共用幂等媒体清理。

## 2.0.0 maintenance refresh — 2026-09-02

This maintenance reissue replaces the September 1 release assets with the installation, deletion, DLC, filtering, and Windows-update improvements below.

本次维护重发以以下安装、删除、DLC、筛选与 Windows 更新改进替换 9 月 1 日发布资产。

### English

#### Interface and chart cards

- Result-toolbar controls now show complete English and Chinese values and options. On narrower windows, whole fields wrap instead of truncating labels such as sort direction.
- Song titles remain complete. Subtitles and artists that exceed two lines now use the same anchored disclosure language as long author notes: a one-and-a-half-line preview opens into a floating full-text card without increasing the chart card's height.
- Selection behavior is now consistent: ordinary content text can be copied, while any text that performs an action is click-only. Collapsed long-content previews are click-only; their expanded non-link text is selectable, while links and controls remain click-only.
- Fully closing a floating content card now resets its internal scroll position, so the next opening starts at the top instead of leaving a scrolled preview over tags or actions.

#### Installation status checks

- Each full installation-status refresh now enumerates the actual `.srtb` files once and returns a hash inventory that the interface matches against the current catalog in memory, instead of probing each catalog candidate. Returning the window to the foreground still refreshes this local inventory automatically.
- A completed chart now receives one targeted local hash check and updates its card immediately, even while other downloads or installations remain active; it no longer waits for the whole queue to become idle.
- Installs and deletions invalidate the affected chart status, while changing the install folder invalidates the previous folder's whole inventory. DLC charts now use the same installed/not-installed matching, progress, filters, installation, reinstallation, and deletion flow as other charts. A genuine check failure keeps the last successful result visible and can be retried.
- Returning from another window or restoring from the tray now keeps a fully cached installation refresh silent, so the temporary progress row no longer shifts pagination and chart cards. First-time checks, unknown states, and genuine failures remain visible.
- DLC cards retain their catalog metadata and show a compact requirement label. A strictly valid Steam app-store address makes the label an accessible external link; malformed metadata falls back to a non-blocking generic DLC requirement.
- Changing already-applied base filters no longer inserts a wrapping message into the action column. The stable submit button changes from **Filter charts** to **Apply changes**, while the full status remains available to assistive technology.

#### Local chart deletion

- Added a one-click **Delete** action for charts whose local installation exactly matches the listed version, including DLC charts. It permanently removes the matching custom `.srtb`, cover, and optional audio files without confirmation, while leaving ZIP archives, unrelated temporary files, shared directories, and Steam's official DLC files untouched.
- Deletions stage files for simple rollback, run as short serialized local transactions, and keep independent progress on every card so multiple charts can be queued for deletion. Installation and deletion remain mutually exclusive, including while an installation request's result is unknown. Failures attempt to restore staged files, prioritize restoring the `.srtb`, explicitly report partial recovery, and recheck the actual installation state.
- Successful deletion now refreshes all and installed-only views, result counts, tag suggestions, and paging. Focus is repaired only when the focused card is removed; transitions follow the existing typography, control styling, short motion scale, and reduced-motion behavior.

#### Windows updates

- Setup now waits for the original idle app process to exit before replacing files. Maintenance runs without its own dialogs and returns bounded status codes to Setup; active downloads or installations are never force-terminated.
- A still-closing app or locked program file now stays in a retry/cancel flow, so releasing the lock and selecting **Retry** continues the same update instead of entering a terminal or apparently frozen page.

---

### 简体中文

#### 界面与谱面卡片

- 结果工具栏现在完整显示中英文当前值和所有选项；窄窗口按完整字段换行，不再把“排序方向”等内容截断为省略号。
- 歌曲标题继续完整显示；超过两行的副标题和艺人改为复用长作者说明的锚定披露语言，以一行半预览打开不增高谱面卡片的浮动全文卡片。
- 文字选择行为统一为：普通内容文字可复制，任何承担操作的文字只可点击。折叠的长内容预览只可点击，展开后的非链接正文可选择，链接与控件仍只可点击。
- 浮动内容卡片完整收起时会重置内部滚动位置，下次从顶部打开，不再让滚到底部后的旧位置在预览中覆盖标签或操作。

#### 安装状态核对

- 每次完整安装状态刷新改为一次枚举实际存在的 `.srtb` 文件并返回哈希清单，再由界面在内存中与当前谱面数据匹配，不再逐个探测 catalog 候选；窗口重新回到前台时仍会自动刷新这份本地清单。
- 单首谱面安装完成后改为立即执行一次定向本地哈希核对；即使其它下载或安装仍在进行，对应卡片也会马上更新，不再等待整个队列空闲。
- 安装和删除只使对应谱面状态失效，修改安装目录会使旧目录的整份清单失效。DLC 现在与普通谱面共用已安装／未安装核对、进度、筛选、安装、重新安装和删除链；真正的核对失败会保留上次成功结果，并可重试。
- 从其它窗口返回或从托盘恢复时，已有完整缓存的安装状态刷新现在会静默进行，不再由临时进度行推动分页和谱面卡片上下跳动；首次核对、未知状态和真正的失败仍会显示。
- DLC 卡片保留目录中的完整元数据并显示紧凑的要求标识。只有严格合法的 Steam 应用商店地址会使标识成为无障碍外链；异常元数据退化为不阻塞操作的通用 DLC 要求。
- 修改已经应用的基础筛选条件时，不再向操作列插入会换行的提示；稳定的提交按钮从“筛选谱面”切换为“应用更改”，完整状态仍会向辅助技术播报。

#### 本地谱面删除

- 为本地安装与列表版本精确一致的谱面（包括 DLC）新增一键“删除”。点击后不弹确认，立即永久删除对应自定义 `.srtb`、封面和可选音频，同时保留 ZIP、无关临时文件、共享目录和 Steam 官方 DLC 文件。
- 删除先暂存文件以便简单回滚，并由本地服务以短事务串行执行；每张卡片独立显示进度，可连续将多个谱面加入删除队列；安装与删除彼此互斥，安装请求结果尚未明确时也不会开放删除。失败时尝试恢复暂存文件并优先恢复 `.srtb`；若部分资源无法恢复，会明确提示检查安装目录并重新核对实际安装状态。
- 删除成功后同步刷新全部与仅已安装视图、结果数、标签候选和页码；只有聚焦卡片被移除时才修复焦点。交互沿用现有字体、控件样式、短动效节奏与减少运动规则。

#### Windows 覆盖更新

- 安装程序会在替换文件前等待原空闲工具进程真正退出；维护模式不显示自己的错误窗口，只以有界退出码向安装向导报告状态，正在下载或安装时绝不强制结束工具。
- 工具仍在退出或程序文件被占用时保持“重试／取消”流程；释放占用后点击“重试”即可继续同一次更新，不再进入终止页或呈现为卡死。

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
