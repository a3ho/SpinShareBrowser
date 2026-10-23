# 评论与标签（reviews / tags）

## 评论数据

`readReviews(id)`：GET `https://spinsha.re/api/song/{id}/reviews`（不计数）；响应宽松点：缺 `reviews` 且 `average===false` 才兼容为空集，其它损坏报错。缓存 `reviewCache`（LRU 128/64KiB）。计数（`reviewCounts`）与正文 DOM 独立：默认收起也后台加载计数；未知/失败显示 `…`/`!`，**永不显示为 0**；确认 0 → 按钮保留外形但禁用展开、无箭头、无悬停，全局展开也跳过；打开后才发现 0 → 安全关闭+清正文+焦点回卡片标题（preventScroll）。

## 队列

`pageDetails.jobs` ≤2 并发；优先级：正打开的 > 已见过的 > 档案；翻页 `prunePageDetails` 回收。评论渲染分批（40 条/帧让出）离屏构建。

## 双呈现

- **临时浮层**（默认）：评论节点留在卡片 DOM 内但 `popover=manual` 顶层固定定位——不占布局、不改页高、不锁滚动；宽≤680 锚定评论按钮，窄窗（≤680px）延伸到距底 12px；内部滚轮全归列表（bindReadingWheel，Ctrl+滚轮放行）；开 220ms/合 150ms（::backdrop 动画尽力而为）；无右上关闭——离开卡片+浮层、再点按钮、Esc、外点、换页均可收。全局同时只有一个浮层（reviewPopoverOwner）。
- **全局内嵌**（"展开所有评论"开关）：同一节点撤掉 popover 属性回到文档流，随内容撑高卡片；开关切换瞬时收起临时浮层。两种模式只以位置/背景区分，无文字标识。

## 60 秒刷新冷却

全部"刷新评论"按钮共享：`reviewRefreshNextAllowedAt` + localStorage `spinshare.reviewRefreshNextAllowedAt`（同源跨页共享、刷新页面不丢）；单一 1s 计时器同步所有按钮倒计时文案；**失败也计入**；首次计数和缓存阅读不占额度。reserve/begin/release 三段防并发绕过。

## 标签

- 联想只来自已有标签目录（indexCatalogTags），忽略大小写，显示"叠加当前搜索+已选标签后的结果数"（tagResultCounts，计数中显示 Counting...）；回车/卡片标签点击添加，飞行动效 280ms 落点脉冲。
- 已选栏非空才显示、滚动吸顶；溢出折叠成 +N 弹层；删除/清空保持视口与页码（captureTagViewport/prepareTagAnchor/restoreTagAnchor 的 anchor 机制：卡锚=滚回该卡，视口锚=原样恢复）。
- 卡片标签条溢出 → 悬停/键盘/触屏弹完整标签浮层（chartTagsPopover，触屏首次点开、再次点才加筛选）。
- 规矩：改其它筛选不清标签；标签不参与说明搜索；作者说明不参与任何搜索。

## 上传者搜索边界

默认范围含 creator：本地字段先匹配；未知上传者账号才按需 POST `/api/searchUsers`（2-80 字符、≥2 个字母数字、禁 % *）；失败保留本地匹配 + 重试条；取消 creator 范围即停联网。提示文案常驻搜索框下（"谱面字段在本地搜索；上传者账号按需联网补全"）。
