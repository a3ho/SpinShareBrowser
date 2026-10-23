# Design: 音量控件（顶栏播放器）

## 选定方案：图标按钮 + 锚定弹层滑块

```
行1: [封面48] [歌名 · 艺人                        ]
行2: [封面48] [0:00] [══════进度条══════] [3:42] [(🔊)]   ← 音量按钮在总时长后
                                   ┌─────────────┐
 hover/focus/滚轮 时:              │ ▬▬▬▬●▬▬▬▬▬  │  ← 弹层（顶栏之下，110px 滑块）
                                   └─────────────┘
```

**为什么是这个形态**（对齐设计基线的推理）：

- 顶栏空间是稀缺资源且被原生拖动区占用——常驻滑块会吃掉进度条宽度与 ≥32px 拖动留白（DESIGN 硬规则）；弹层方案常态下只占一枚 26px 图标。
- 弹层 = 本项目已确立的"锚定浮层"语言（日历、标签选择器、问号帮助、评论浮层全是同一模式：原生 popover、深色实体面 #2a2b33、圆角 12、短距淡入 + 4px 位移、到边界让位、Esc/外点/失焦收起、preventScroll 归还焦点）。音量弹层完全复用这套词汇，不发明新形态。
- 滚轮直调是桌面应用的天然加成，零视觉成本；与"播放器是桌面工具控件"的气质一致。
- 点击=静音是行业共识（YouTube/Spotify/系统播放器），一键可达最高频操作。

**被否方案**：

| 方案 | 否决原因 |
| --- | --- |
| 常驻内联滑块 | 永久吃掉进度条宽度；窄窗违反"不缩小操作按钮/保留拖动留白"；视觉噪音与"控件安静"冲突 |
| 垂直滑块弹层 | 无垂直滑块先例；跨浏览器竖向 range 实现要自己画；收益不成比例 |
| 仅滚轮+图标（无滑块） | 不可发现、无精确可视化反馈，违反"可见状态与可访问名称"精神 |
| 放进右侧窗口控件组 | 语义错组（那是窗口操作区）；DESIGN 明确播放器控件属于播放器 |
| 悬停时行内展开滑块（推移时长） | 推移布局 + 与拖动区排除矩形互相纠缠；悬停抖动 |

## 交互细节

- **开**：pointer 悬停图标（输入模态不限）或图标获得键盘焦点（:focus-visible 判定，与问号帮助同规则）；关闭延迟 160ms（指针在按钮或弹层内则保持——同标签浮层 leaveChartTags 模式）。
- **收**：Escape（焦点回图标 preventScroll）、弹层外 pointerdown、window blur、页面隐藏、模态 dialog 打开、播放器隐藏（错误态/无曲目）、disposePreview。
- **滚轮**：图标或弹层上 `deltaY<0 → +0.05`；preventDefault（passive:false），不传播给页面。
- **静音**：点击图标或 Enter/Space；`previewLastVolume`（会话内最近 >0 值，默认 1）；静音态 = volume 0，持久化的就是 0（重启仍静音，符合"所见即所存"）。
- **持久化**：滑块 input 实时生效；change（松手）与静音点击立即 POST；拖动过程 600ms 防抖兜底。失败静默（下次变更再试），不打断播放。
- **aria**：图标 `aria-label` 动态（"静音"/"取消静音" + 曲目名不必——播放器上下文已明确）+ `aria-pressed`（静音态）；滑块 `aria-label="音量"` + `aria-valuetext="65%"`；弹层 `role="dialog" aria-label="音量"`；静音切换写入 `#preview-player-status`（复用 announce 模式，带曲目签名去重）。

## 视觉规格（对齐 DESIGN tokens）

- 图标：24 viewBox 细描边（stroke 1.7 round），三态 `icon-volume` / `icon-volume-low` / `icon-volume-mute`；堆叠透明度切换 150ms（复用 preview-glyph 手法）。按钮 26×26、图标 16px、色 `--muted` → 悬停 `--text` + 底 `#ffffff0c`（同 search-box button）。
- 弹层：`#2a2b33`、圆角 12、`0 14px 40px #0009`、padding 12px 14px；进入 180ms（opacity + translateY(4px)，cubic-bezier(.16,1,.3,1)）退出 150ms；`popover=manual` + JS 定位（天花板 = 顶栏底 + 8，右对齐图标右缘，视口夹紧）——落在顶栏之下，天然避开原生拖动覆盖层。
- 滑块：复刻 `#preview-player-progress` 配方——高 18px 命中区、3px 轨道、`--volume-level` 百分比品红填充、10px 圆形拇指 `#f3d9e6` + 深色描边阴影、悬停/键盘放大 1.18、step 0.01。
- 减少运动：位移取消，仅保留透明度（与既有 popover 规则一致）。

## 技术落点

| 层 | 改动 |
| --- | --- |
| `web/index.html` | sprite 三枚喇叭图标；时间轴行末尾包 `.global-player-timing`（时长 + 音量按钮）；body 级 `.volume-popover` |
| `web/interface.css` | 上述样式；`.global-player-timeline` 第三列 `32px`→`auto` |
| `web/app.js` | `previewVolume/previewMuted/previewLastVolume` 状态；`setPreviewVolume/togglePreviewMute`；弹层开合/定位/滚轮；防抖 POST `/v1/player-volume`；`publishWindowRegions` excluded 增加 `#preview-player-volume`；announce；`syncPreviewInterface` 错误态联动收起 |
| `src/spinshare_portable.py` | `CONFIG_DEFAULTS.playerVolume=1`、`validate_config` 数值 0–1 校验（拒 bool）、bootstrap 下发、`update_player_volume()`、do_POST/do_OPTIONS 白名单加 `/v1/player-volume` |
| `src/desktop.py` | `valid_frame_layout` excluded 上限 5→6 |
| `src/maintenance.py` | `_parse_config` 补 playerVolume 数值校验（缺省容忍旧配置） |
| `web/locales.json` | en/zh 成对新增：Volume / Mute playback / Unmute playback / Volume muted / Volume restored |
| 测试 | 新 `tests/test_player_volume.py`（端点+校验+迁移，进 build.py SOURCE_FILES）；`test_audio_player.cjs` 补音量用例；`test_window_regions.cjs` 期望 6 矩形；`test_desktop_frame.py` 上限 6 |

### 原生命中区（关键约束）

`publishWindowRegions` 目前排除 5 个选择器（brand/topbar-actions/toggle/progress/retry），后端 `valid_frame_layout` 硬限 ≤5。**决策：上限提到 6**——为一枚新增交互控件扩展预算是最诚实的做法；替代方案（合并到 progress 的矩形、或排除整行时间轴）要么覆盖不了按钮、要么把 DESIGN 明确要求可拖动的时间文字错误地划出拖动区。矩形仍是静态尺寸，不产生逐帧上报（符合"不以文字/进度为更新源"规则）。PRODUCT.md 第 23 行透传清单同步补"音量控件"。

### 版本策略

本任务不改版本号（源码仍 2.1.1）。发布时按 SemVer 升 **2.2.0**（新功能），CHANGELOG 条目草稿留在本目录 `release-notes-draft.md`。
