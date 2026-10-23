# 全局播放器（web/app.js preview* + 后端 audio-preview）

## 唯一性

页面只有一个 `<audio id="preview-audio">`、一个顶栏播放器；每张卡片只有封面上的播放按钮（cover-play），点它 = `toggleChartPreview(row)`。

## 状态机

`previewState`: idle|loading|paused|playing|ended|error；配合 `previewWantsPlay`（用户意图）与 `previewPlaybackConfirmed`（媒体真的进入 playing 才置）。
- `startChartPreview`：换曲 → `previewGeneration++`（一切旧回调作废的令牌）→ 置 loading → `setPreviewSource('ogg')`。
- `setPreviewSource`：清旧监听（previewSourceCleanup）、防重入（previewPlayAttempt 计数）、arm 15s watchdog。
- `attemptPreviewPlay` 的 promise 被拒：NotSupportedError → 走回退链；其它 → 回 paused。
- `handlePreviewSourceFailure`：ogg→mp3→`resolvePreviewSource`（POST /v1/preview/resolve，20s AbortController）→ 都不行 `failPreview(code)`。回退保留进度（resumeAt）。
- `confirmPreviewPlaying` 只在 'playing' 事件且 previewWantsPlay 时确认——网络成功不算 playing。
- `finishPreview`：到真实终点进 ended；从进度条拖回可继续（ended→paused 语义）。

## 快捷键（handlePreviewSpace / handlePreviewSeekKey）

- Space 全局播放/暂停；左右 ±5s。让位规则（previewSpaceReserved/previewSeekReserved）：编辑输入、原生键盘控件（按钮/summary/各种 role）、阅读浮层内容、有选区时（左右键）、组合键修饰。无当前曲目不拦截默认行为，也**绝不**把悬停卡片当待播曲目。
- 反馈规则（刻意精调）：暂停立即在封面显示状态、恢复要等真 playing；900ms 后淡出；等待/拒绝/重复键不显示；快捷键后进度条不留焦点环（blur）。
- 首次播放弹一次性快捷键提示（6500ms，持久化到 config.playerShortcutHintShown）。

## 目录换代与生命周期

- `reconcilePreviewCatalog(data)`：新目录里曲目缺失 / fileReference 或 updateHash 变了 → `disposePreview()` 立即释放旧源。
- 页面隐藏/窗口最小化（hostVisible=false → pausePreview）暂停且**恢复可见不自动续播**；pagehide → disposePreview（清源、监听、计时器、动画帧、双封面槽）。
- 换曲封面：双槽位交叉淡化（previewArtworkSlot 翻转），加载失败回落占位图，全动画绑定 previewCoverToken。

## 出错呈现

error 态：进度条替换为错误行（简短恢复方向 + Retry 按钮，原有高度不变）；完整原因走 aria-description；Retry 成功后焦点回封面按钮（preventScroll）。错误码 → 文案映射 `previewErrorText`：game_audio_not_found="检查游戏文件"、preview_lookup_failed="无法加载音频"、其它="音频不可用"。
