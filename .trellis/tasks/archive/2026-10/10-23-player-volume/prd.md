# Add volume control to the header player

## Goal

为顶栏全局播放器加入音量调节；呈现方式必须符合本项目"克制的深色谱面客户端"设计基线。

## Requirements

1. **可见形态**：播放器第二行（时间轴行）右端、总时长之后放置一枚喇叭图标按钮（约 26px 命中区，细描边风格与现有图标一致）。
2. **调节方式**（全部可用）：
   - 悬停/键盘聚焦图标 → 图标下方弹出锚定浮层，内含水平滑块（约 110px），拖动实时调节；
   - 鼠标滚轮悬停在图标或浮层上 → ±5% 步进；
   - 点击图标 = 静音/取消静音（记忆最近一次非零音量）；
   - 滑块获得键盘焦点后用方向键/PgUp/PgDn 调节（原生 range 行为）。
3. **图标三态**：高音量（两道弧）、低音量（一道弧）、静音（喇叭+叉），淡入淡出切换，不用原生 title 提示，用动态 aria-label。
4. **持久化**：音量存入 `config.json` 新字段 `playerVolume`（0–1，默认 1），新端点 `POST /v1/player-volume`；拖动防抖持久化，静音切换立即持久化；重启后恢复。
5. **原生窗口协作**：音量按钮区域必须从顶栏拖动命中区排除（`publishWindowRegions` 上报），后端排除矩形上限 5→6；弹层定位在顶栏之下（不在拖动区内）。
6. **布局纪律**：不增高顶栏；窄窗时文字让位、按钮不缩小；错误态随时间轴行一起隐藏；无曲目时播放器整体隐藏（现状不变）。
7. **无障碍**：滑块 aria-label + aria-valuetext（百分比）；图标按钮动态 aria-label 与 aria-pressed（静音态）；静音切换播报到现有 sr-only live region；Escape/外点/窗口失焦/页面隐藏/对话框打开时收起弹层并正确归还焦点。
8. **基线同步**：PRODUCT.md、DESIGN.md、`.trellis/spec/`（player/local-api/architecture/desktop-host）同步更新；新 locales 键中英成对。

## Acceptance Criteria

- [x] 播放器可见曲目时出现音量按钮；三种调节方式全部有效且互相一致（图标/滑块/aria 同步）
- [x] 刷新/重启实例后音量保持；config.json 出现合法 playerVolume；旧 config 自动迁移默认值
- [x] 窗口区域上报包含音量按钮（共 6 个排除矩形），拖动顶栏空白仍正常（真机验证）
- [x] 错误态/无曲目态不残留弹层；Escape 归还焦点不滚动页面
- [x] 151 Python + 12 JS 套件 + 新增用例全绿；真机浏览器截图过目
- [x] 文档与 spec 同步更新；不做版本号 bump（留待发布任务按 SemVer 升 2.2.0）

## Notes

- 设计决策与被否方案见 design.md。
- 发布时 CHANGELOG 需补 2.2.0 双语条目（本任务只在任务目录留草稿）。
