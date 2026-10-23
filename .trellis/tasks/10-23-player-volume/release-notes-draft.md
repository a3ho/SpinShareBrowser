# CHANGELOG 草稿（发布 2.2.0 时并入；本任务不 bump 版本号）

## 2.2.0 — <发布日期>

- Add a volume control to the header player. A quiet speaker button at the end
  of the timeline row opens an anchored slider popover; the wheel adjusts in 5%
  steps, clicking toggles mute with the last level remembered, and the keyboard
  works natively on the slider. The level is saved locally and restored across
  restarts. The button is excluded from the native title-bar drag region
  (budget raised to six rectangles).
- 为顶栏播放器加入音量调节。时间行右端的喇叭按钮展开锚定滑块浮层，
  支持滚轮 ±5% 步进、点击静音并记忆最近音量、滑块键盘调节；音量本地
  保存并跨启动恢复。按钮区域加入原生命中排除矩形（上限扩至六）。
