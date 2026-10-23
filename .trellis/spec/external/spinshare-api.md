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
- **收藏不存在**：favorites/favorite/bookmark 在服务端源码 0 命中；新旧客户端亦无。"收藏"最接近替代 = 播放列表（但写入已坏）。
- 网站独占（无 API，勿模拟会话）：上传、账号设置、建/删播放列表、SpinPlays 提交、举报。

## 政策（Usage Policy）

DO：保护用户数据；告知用户访问了什么；回链 SpinShare（我们页脚已有）。DON'T：拿凭证、营销、转卖数据、**刮取**（缓存除外，我们的目录缓存模式天然合规）。无速率限制但要求自觉 + 缓存。

## 接入要点（若获 ApiKey）

token 按凭证存储（状态目录、可断开、失效引导）；建议本地服务代理 Connect 调用（token 不进 WebView）；写操作仅用户触发；读自己数据按需 + LRU，绝不后台轮询。方案草图见任务归档报告第五节。
