# 歌单收藏（src/playlists.py + /v1/playlists* + web/src/js/playlists.js）

2026-10-24 落地（任务 10-23-playlists-favorites）。通道契约与生产实证见 external/spinshare-api.md。

## 生产实证（2026-10-24 真机 E2E，所有者账号）

- 创建：CSRF + multipart（`form[title|description|coverPath|save|_token]`，封面必填）+ **前后差集验证**（不看重定向——生产重定向行为未证实）。生成的封面为纯 Python PNG（512×512 石墨→品红对角渐变，零依赖）。
- **勾选框顺序陷阱（关键）**：`/song/{id}` 浮层的 checkbox 顺序（旧→新）与 `/api/user/{id}/playlists` 列表顺序（新→旧）**相反**。按下标推导会写错歌单（真机踩过：E2E 首轮把歌加进了用户的旧歌单，差集验证拦截了误报但副作用已发生，随即用零浏览量删除路由恢复）。**正确做法：解析浮层 `<label class="playlist-item"><input name="playlist_{i}"><span>标题</span></label>`，按标题映射**（`session_client.parse_playlist_overlay`）。
- 替换集语义：POST `/song/{id}`（`submitPlaylist=1` + 全部勾选态）重写该曲全部成员关系；进门 views+1（GET 解析也 +1 → 每次加歌/移除共 +2，PRD 已知成本）。解析页的 checked 态即写前真值（省去 N 次详情预读）。
- 移除歌曲专用路由 `GET /playlist/{id}/song/{songId}/delete` 零浏览量（恢复误写时也用它）。
- 删除歌单：`GET /playlist/{id}/delete` 无 CSRF，一击即删，差集验证。
- E2E 全序列（建→加两首→移除一首→删）已在生产通过，用户原歌单全程未被触碰、事后复原。

## 架构

- `src/playlists.py`：读（`my_playlists`/`playlist_detail` 公开 API 不计数）、写（`create_playlist`/`delete_playlist`/`set_song_membership` 全走 `session_client.submit_write` 串行队列）。写操作统一"写前真值（解析页/差集）→ POST → 只验证变更集 → 不匹配抛 `PlaylistConflict` 绝不盲目重试"。
- 端点：GET `/v1/playlists`（409 session_disconnected 未登录）、GET `/v1/playlists/{id}`、POST `/v1/playlists/create|delete|song`。错误码映射 `playlist_failure()`（SessionExpired→session_expired）。
- 前端 `web/src/js/playlists.js`（26 模块）：顶栏"我的歌单"按钮（登录才显示，进窗口拖拽排除矩形）；歌单面板（封面/标题/计数/打开/两步删除确认/新建表单）；卡片 metrics 行"收藏到歌单"按钮（`render()` 尾部 `refreshPlaylistButtons()` 挂载/卸载——**会话变化或渲染后都要刷**）；锚定浮层（勾选列表+保存+内联新建并预勾选）；歌单筛选视图（`playlistFilter` 附加在 rebuild 的安装筛选之后、标签计数之前，chip 带退出按钮）。
- 前端坑：**rebuild 里的跨模块引用必须 `typeof` 守卫**（抽取式 cjs 测试沙箱里没有 playlists.js 的词法绑定）；vm 跨 realm 断言用原始字段比较；UI 文案禁句号结尾；`validateRuntimeConfig` 的冻结投影必须显式包含新键（session 曾漏——启动时登录态到不了前端）。

## 待办（阶段 4）

- 歌单同步安装（diff 只装缺 + 事务管线 + 取消不强杀 + 只增不删）——`playlist_detail` 的 songIds 即 diff 源。
