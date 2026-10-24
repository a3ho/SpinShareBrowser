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

## 同步安装（阶段 4，2026-10-24）

- `web/src/js/playlist-sync.js`（27 模块）：入口=歌单面板行"同步到游戏"（需 installDirectoryConfirmed，否则走目录确认流）。预览 = `playlistDetailCached` songIds → `compact(catalog, 全难度无日期)` 建行 → `POST /v1/installations/check` 批量存在性 → {将安装/已装跳过/下架/DLC 标注}。执行 = 复用 `startInstallation`（单装机制全套：视图/活动坞/存在性），逐首 `await installationPending===false` + 1.2s 间隔；**停止=停止后续提交，进行中的永不强杀（红线 9）**；单首失败不中断，末尾汇总。对话框关闭不中止循环（Esc 只关视图）。
- E2E 已验证：两首歌真实下载安装到沙箱目录（隔离实例 config.customDirectory 指沙箱 + installDirectoryConfirmed），srtb 落盘核对，完成态截图走查 PASS。
- 坑：vm 跨 realm 数组断言用 join(',') 比较；新 cjs 测试的 dialog 节点要 mock showModal/close。

## 评论发布删除（阶段 5，2026-10-24）

- 通道事实（生产实证）：表单在 `GET /song/{id}?tab=reviews&action=add`（`reviewRecommended` yes/no + `reviewComment` + `submitReview`，无 CSRF，POST 回同 URL，进门 views+1）；删除 `GET /song/{id}/review/{rid}/delete` 无 CSRF；**自评被服务器静默忽略**（SongController `if(getUser() != uploader)`，无任何报错）——前端按 `row[8].uploader===我的userId` 预拦并提示"不能评价自己的谱面"。
- `src/reviews.py`：`post_review`（前后差集验证新评论 id）/`delete_review`（消失验证）；评论上限 2000 字符。端点 `/v1/reviews/add|delete`。
- 前端 `web/src/js/reviews-write.js`：评论抽屉写作区（推荐勾选 + 文本 + 发布；**成功后局部插入**列表顶部 + 计数 +1 + 缓存失效，不整页重拉）；已评态显示徽标 + 两步删除（局部移除）；会话失效即整体登出 UI。`readReviews` 条目映射补 `id`。
- 坑：异步 click 处理器后半段在微任务——测试要 `setImmediate` 等待；mock Element 的 append 必须设 parentElement、remove 必须真删，setTimeout mock 不能立即执行（两步确认会被瞬间解除）。

## 通知（阶段 6，2026-10-24）

- 无 JSON 端点：解析已登录首页的 `.notification-item` 锚点——**整条即清除链接**（`/notification/clear/{id}?returnUrl=…`），封面 URL 内含 fileReference（`/uploads/thumbnail/{ref}.jpg`）供前端反查目录定位跳转（复用 playlistFilter 机制单曲聚焦）。`/notification/clearAll?returnUrl=…` 清全部。
- `src/notifications.py`：fetch/clear_one/clear_all，清除后从重定向回的首页再解析验证。端点 GET `/v1/notifications`、POST `/v1/notifications/clear|clear-all`。
- 前端 `notifications.js`：顶栏铃铛（登录才显示、未读粉点在首次拉取后）；浮层仅打开时拉取（**零后台零定时器**，红线）；行操作 = 查看谱面（若可反查）/ 清除。
- 教训：**连环 Python 编辑脚本每段要独立落盘 + 段间断言失败会静默丢后续步骤**（本次 manifest/locales 被丢，缺 locale 键使启动链在 setupLanguage 后中断——铃铛不显示的表象）。修复后验证：铃铛显示、浮层空态、生产读取/清全部通过。

## 首页 C2（阶段 7，2026-10-24 所有者选型）

- **所有者裁定**：浏览是主角；歌单是个人资料的一部分（原站心智），不做"主场舞台"。选 **C2 = 顶栏一行直达 + 筛选胶囊化**（演示稿曾误画侧栏——现应用本就是顶部筛选布局）。
- 落地：`filter-pills.css`（难度胶囊化：选中=浅底深字；等级/日期变胶囊行，全部纯 CSS、控件 id 不动）；顶栏**账户胶囊**（头像+用户名，登录才显示）+ 账户菜单（我的歌单/我的谱面/我的评论/退出登录，`web/src/js/account.js`）；书签按钮退役（卡片收藏按钮仍在）；`playlistFilter` 增 `kind` 字段（playlist 视图带"歌单："前缀，个人视图不带）。
- 个人视图：我的谱面（纯本地 catalog 按 uploader 过滤）；我的评论（spinsha.re 公开 API 直连拉 songIds，60s 缓存）。**必须经 `apply()` 全管线**（个人视图跨全部日期——先把 date-preset 可见地归位 'all' 再 apply；只 rebuild 会沿用旧的日期压缩集）。
- 窗口排除矩形：#account-chip 替代 #playlists-open。
