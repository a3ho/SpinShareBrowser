# app.js 地图（3076 行，无模块化的单作用域）

## 核心状态（顶部分组声明）

- **查询管线**：`currentRows`（已按基础筛选压缩的行）→ `filtered`（标签+搜索+安装筛选后）→ `page/visibleCount`（分页/连续）→ `render()`。`applied`=已提交的基础筛选，`lastAppliedCriteria` 变化时清空文字搜索。`phase`: idle|loading|ready|error。`controller`=当前查询 AbortController。
- **目录同步**：`catalog`（数据数组）`cacheGeneration`（目录换代号，一切派生缓存的失效开关）`catalogFetchedAt`、`catalogNextAllowedAt`（手动冷却）/`catalogAutomaticNextAllowedAt`、`catalogInstallRecheck`（2.1.1：安装后差异→提前重核标志）、`catalogStartupBusy/ManualBusy/AutomaticBusy`。
- **安装/删除**：`installationStates`（每首歌提交态：job/running/requesting/rejected/expired/problem）、`deletionStates`+`deletionQueue`（前端串行队列）、`installedCharts`（presence 记录 {key,value,pending}）、`presenceQueue`、`installationIndex`（整目录清单）、`installationActivityIds`（后端 activity ↔ 前端状态对账）。
- **评论/档案**：`reviewCounts`/`reviewCache`/`profileCache`/`userSearchCache`（LRU，remember() 限 128 条/64KiB）、`pageDetails`（当前页任务队列：≤2 并发评论+档案）。
- **UI 全局**：`hostVisible`（窗口状态）、`appExiting`、`settingsBusy/Stale/Revision`、`showChartReviews`、`reviewPopoverOwner`、`previewTrack` 等（见 player.md）。

## 渲染管线

`apply()`（提交筛选）→ 读目录缓存（无则 GET /v1/charts 兜底）→ `compact()` → `rebuild()`：
1. 文字搜索（本地字段匹配 + 上传者集合）+ 标签 AND → `installationCandidates`；
2. 安装筛选模式 ≠ all → `installationPresence()` 过滤（pending 的先排队核对，见 presence.md）；
3. `tagResultCounts`（标签候选计数）→ `sortRows` → `render()`。

`render(append)` 做卡片差量更新（cardViews 复用、退场 retire），入口动画 IntersectionObserver 分批（queueEntry），封面懒加载队列（coverViews，2 并发、HEAD 探测 404/410 区分 missing/error）。

## 事件绑定集中在文件尾（约 3044 行起）+ setupRuntime

`setup*` 系列在启动时一次挂好：setupInputModality（pointer/keyboard 焦点环切换）、setupMotion、setupLanguage、setupChoiceMenus（原生 select 增强为自绘 listbox：键盘/typeahead/浮层全支持）、setupAudioPreview、setupWindowControls（窗口状态事件 + 布局上报 ResizeObserver/MutationObserver → scheduleWindowRegions）、setupAppDialogs、setupCloseHelp、setupCatalogSyncUI、setupActivity、setupScrolling（滚动条 hover 命中）、setupTagFilters、setupPageControls（回顶部+评论开合+storage 同步）。启动序列：`setupTagFilters(); setupRuntime(); setupPageControls(); applyDatePreset(); render(); syncFilters(); startCatalogRuntime();`

## installerRequest（本地 API 客户端）

- 端点白名单（前端又一份！改端点三处同步：do_OPTIONS/do_POST/这里）；`/v1/install` 必须带 settings revision 头；超时分级（directory/select 600s、preview/resolve 20s、其余 10s）；`targetAddressSpace:'loopback'`；409 settings_changed 自动置 settingsStale 提示用户。
- 读响应 `readJSONResponse`：流式、限额、进度回调（250ms 节流）。

## 差量对账要点（改安装相关代码必读）

- 后端 `/v1/activity`（窗口 focus + 1.5s 轮询）→ `refreshInstallationActivity`：以 job.id 对账，完成的清 installedCharts 触发重核。
- `installationKey` = settingsRevision+fileReference+updateHash——目录换代/换目录自动失效。
- `installationMutationGeneration`：安装/删除发生时 +1，正在飞的 index 批次回来若代号不匹配会重新排队（防旧清单覆盖新事实）。
- `noteInstallationMutation(row, installed)` 只在布尔值时改写内存 index；'different' 不写（不能把 catalog 哈希写进清单）。

## 坑

- `m()` 返回的是带随机前缀的令牌不是文案；任何要落 DOM 的文本经 element/uiText/uiAttr，直接 textContent 赋值会让该节点失去语言切换能力。
- `number()` 是令牌（千分位随语言渲染），不是 toLocaleString。
- `rememberEntry(key)` 全局只放一次入场动画（2 万条上限）。
- 文件顶部 `const APP_CONFIG=validateRuntimeConfig(...)` 失败会直接写 status 并 throw——页面死而不白屏。
