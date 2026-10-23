# SpinShare API 事实表（2026-10-23 源码核实）

## 信封与 CORS

- 所有 `/api/*` 响应：HTTP 200 + `{version:1, status:<业务码>, data:...}`；业务码 200/400/403/404/422。
- `Access-Control-Allow-Origin: *`（CorsListener 全站生效）——任意源可直连；鉴权不靠 Cookie。
- 服务端源码：github.com/SpinShare/server（Symfony）；客户端：client-next（Electron）。

## 我们已用的公开端点

`POST /api/searchCharts`（全量目录，不计数）· `GET /api/song/{id}/reviews`（不计数）· `GET /api/user/{id}` · `POST /api/searchUsers` · `GET /api/song/{id}/download`（计数，仅用户显式下载）。其它公开：`/api/user/{id}/{charts|playlists|reviews|spinplays}`、songs/promos/playlists/dlcs/discovery。

## Connect（第三方账号体系）

- **流程**：用户官网个人设置取 6 位 ConnectCode（15s 轮换、一次性）→ `GET /api/connect/getToken?connectCode=&connectAppApiKey=` → 32hex `connectToken`（长期有效至用户撤销，`validateToken` 校验）。token 走**查询串**。
- **硬门槛**：`connectAppApiKey` 必须命中官方登记的 ConnectApp（私下审批，Discord #development 申请）。未登记一律 404。
- 端点：`profile`（当前用户+通知数）· `reviews/{songID}/get|add|remove`（add body `{recommended:bool, comment:string}`——源码读 **recommended**，文档误写 recommend）· `playlists`（只读）· `notifications|clearNotification|clearAllNotifications` · `savePlaylists/{songID}`（**服务端损坏**：逻辑注释、恒 200 空数据，勿用）。
- **收藏不存在**：favorites/favorite/bookmark 在服务端源码 0 命中；新旧客户端亦无。**用户需求中的"收藏"即指 Playlists**（2026-10-23 用户澄清）→ 读可行、写被官方坏端点卡死；本地收藏（状态目录存储）是现成替代方向，上游修复后可加同步。savePlaylists 损坏状态 2026-10-23 复核 master 依旧（逻辑全注释 + 活的 var_dump + 作者 "FUCK THIS, THIS IS BROKEN" 留言）；Connect API 无建/删列表端点，网站的 create/edit/delete/歌曲增删全走会话表单路由（`/playlist/*`、`PlaylistController`）。
- 网站独占（无 API，勿模拟会话）：上传、账号设置、建/删播放列表、SpinPlays 提交、举报。
- **网站 UI 实证（2026-10-23 用户登录截图核对）**：头像下拉 = My Charts / My Playlists / My Reviews / My SpinPlays / Settings / Logout，**无收藏入口**（佐证 favorites 不存在）；铃铛面板 = NOTIFICATIONS + CLEAR ALL（即 `clearAllNotifications` 的 UI）；Upload 页为纯网站表单（backup ZIP 拖放 + Markdown 描述 + 逗号分隔 tags + DLC/发布状态下拉 + explicit 复选），无 API 对应。

## 网站表单通道（歌单写操作，2026-10-23 源码核实，红线 1 例外已获所有者裁定）

写操作走"本人会话 + 官方表单端点"（红线修订见 guides/red-lines.md）。服务端真实机制：

- **创建** `POST /playlist/create`：Symfony 表单（需先 GET 页面取 `form[_token]` CSRF），字段 `form[title|description|coverPath|save]`。**致命细节：persist 写在 `if($coverFile)` 里面——不上传封面 = 静默 no-op（重渲染表单、无错误）**。客户端必须生成并 multipart 上传一张封面 PNG；新歌单 id 从重定向 Location 取。`SongPlaylist` 实体**无 visibility 字段，歌单一律公开**显示在用户主页（"收藏夹=公开"是产品事实）。
- **删除歌单** `GET /playlist/{id}/delete`：无 CSRF、无确认（确认分支被官方注释掉），一次 GET 即删，owner 校验。
- **加歌** `POST /song/{id}`（songDetail 动作，`submitPlaylist`）：**进门无条件 `views+1`（GET/POST 都加，无法绕过）**；**替换集语义**——先把歌从用户全部歌单移除，再把 `playlist_{index}=on` 勾选的加回；**键是服务端 findBy 结果的数组下标而非歌单 id**，稳妥做法 = 解析渲染页 checkbox（名称+标题+勾选态）。表单是手写 HTML 非 Symfony Form，**无 CSRF 字段**。陈旧缓存写入会复活已删成员关系 → **写前强制新鲜读**。
- **移除歌曲** `GET /playlist/{playlistId}/song/{songId}/delete`：无 CSRF，owner/版主校验，**不经过 /song/{id}，零浏览量成本**。加歌才烧 views，移除免费。
- **读回（公开无鉴权）**：`GET /api/user/{id}/playlists`（全部歌单）、`GET /api/playlist/{id}`（单列表写后校验）；getJSON 含 songs[]/cover URL/user。
- 会话：内嵌登录窗（独立 WebView2）建会话，CoreWebView2 CookieManager 取 cookie，本地加密存储、可断开；写响应返回登录页 HTML/重定向 = 会话失效信号。

## 政策（Usage Policy）

DO：保护用户数据；告知用户访问了什么；回链 SpinShare（我们页脚已有）。DON'T：拿凭证、营销、转卖数据、**刮取**（缓存除外，我们的目录缓存模式天然合规）。无速率限制但要求自觉 + 缓存。

## 接入要点（若获 ApiKey）

token 按凭证存储（状态目录、可断开、失效引导）；建议本地服务代理 Connect 调用（token 不进 WebView）；写操作仅用户触发；读自己数据按需 + LRU，绝不后台轮询。方案草图见任务归档报告第五节。
