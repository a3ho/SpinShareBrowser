# SpinShare 用户系统接入可行性调研报告

日期：2026-10-23 · 调研者：GLM · 方法：官方文档 + 服务端/客户端开源源码（SpinShare/server、SpinShare/client-next）+ 3 次无凭证线上探测

## 一、结论速览

| 功能 | 可行性 | 依据 |
| --- | --- | --- |
| 登录/账号连接 | **有条件可行** | 官方 Connect 体系（6 位码换 token）专为第三方设计，但**必须先向 SpinShare 开发者申请 ConnectApp ApiKey（私下审批制）**，未获批前一切无从谈起 |
| 发表/修改/删除评论与推荐 | **可行**（获批后） | `/api/connect/reviews/{songID}/get|add|remove` 源码实现完整，与本项目评论阅读功能天然衔接 |
| 读取自己的评论 | **可行**（获批后） | 同上 get；另有公开 `/api/user/{id}/reviews` |
| 收藏 | **不可行——功能不存在** | 服务端源码全局检索 favorites/favorite/bookmark 均为 0 命中；Open/Connect API、新旧官方客户端、使用政策中均无此功能。SpinShare 没有收藏系统 |
| 播放列表（读） | **可行**（获批后） | `GET /api/connect/playlists`（自己的）+ 公开 `/api/user/{id}/playlists` |
| 播放列表（写：建列表/加减歌） | **当前不可行** | `savePlaylists/{songID}` 服务端实现**损坏**（逻辑被注释、遗留 var_dump、源码含作者吐槽）；建/删列表端点不存在 |
| 通知（读/清除） | **可行**（获批后） | `/api/connect/notifications`、`clearNotification`、`clearAllNotifications` |
| 当前用户信息 | **可行**（获批后） | `/api/connect/profile`（含 notificationsCount） |
| 上传谱面 / SpinPlays / 举报 / 账号设置 | **不建议** | 仅网站会话（HTML 表单），无 API，绕过即违反政策 |

**一句话**：不存在"完美接入用户系统"——因为对方公开给第三方的用户系统本身就只有 **评论读写 + 播放列表只读 + 通知 + 个人资料** 这一子集，且入口被 ConnectApp ApiKey 审批把门。拿到 ApiKey 后，评论读写可以做到产品级完整；收藏无中生有不可能，最接近的替代是"播放列表当收藏夹"，但播放列表写入端点目前是坏的。

## 二、鉴权机制（Connect 体系，源码核实）

流程（`src/Controller/API/Connect/APIConnectController.php`）：

1. 用户在 spinsha.re 个人设置的 Connect 页拿到 **6 位 ConnectCode**（`/api/connect/generateCode` 生成，页面停留期间每 15 秒轮换，一次性）。
2. 第三方应用调用 `GET /api/connect/getToken?connectCode=XXX&connectAppApiKey=YYY`：
   - `connectAppApiKey` 必须命中数据库 **ConnectApp 实体**（字段仅 id/title/apiKey/connections）——即官方登记过的应用；
   - 成功返回 32 位 hex `connectToken`（`md5(time()*userID)`），并作废该 ConnectCode、建立 Connection 记录；
   - **未登记的 apiKey 一律 404**。文档明言："API access is handled privately as of now"，需到 SpinShare Discord 找开发者申请。
3. token **长期有效直到用户在网站撤销**；用 `GET /api/connect/validateToken?connectToken=...` 校验。
4. 所有 Connect 端点鉴权方式：**token 放查询串 `connectToken`**（无 header/Bearer；网站无 CSRF 顾虑因为它不依赖 Cookie）。

安全含义：token 等同长期凭证、且会出现在 URL（服务端日志可见——对方的设计选择，我们无法改变）。我们若存储必须：仅存状态目录、永不入日志/遥测、提供明确"断开连接"入口、失效（403/404）时引导重连。

## 三、端点清单（服务端路由源码逐条核实）

Connect（全部需 connectToken）：

```
GET  /api/connect/getToken?connectCode=&connectAppApiKey=   # 换 token
GET  /api/connect/validateToken?connectToken=               # 校验
GET  /api/connect/profile                                   # 当前用户 {id,username,isVerified,isPatreon,pronouns,avatar,notificationsCount}
GET  /api/connect/reviews/{songID}/get                      # 我对某歌的评论（404=未评）
POST /api/connect/reviews/{songID}/add   body {recommended:bool, comment:string}  # 新评/更新（源码读 recommended）
GET  /api/connect/reviews/{songID}/remove                   # 删除自己的评论
GET  /api/connect/playlists                                 # 我的播放列表（含 songs 数组）
GET  /api/connect/savePlaylists/{songID}                    # ⚠️ 损坏：不做事，恒返回 200 空数据
GET  /api/connect/notifications                             # 我的通知
GET  /api/connect/clearNotification / clearAllNotifications # 清除
```

公开（本项目已在用同族）：`/api/searchCharts`、`/api/song/{id}/reviews`、`/api/user/{id}`、`/api/searchUsers`、`/api/user/{id}/{charts|playlists|reviews|spinplays}`、songs/promos/playlists/dlcs/discovery。

线上探测（2026-10-23，共 3 次无凭证请求）：端点存活于 `/api/connect/*`；响应为 **HTTP 200 信封** `{version:1,status:<业务码>,data:...}`（假 token→status 404、缺参→status 400）；`Access-Control-Allow-Origin: *`（`src/Listener/CorsListener.php` 对全站 API 生效）→ 我们的 WebView 页面可直接跨域调用，无需本地代理（但见第五节安全权衡）。

## 四、文档 vs 源码差异（接入时以源码为准）

- 评论 add 的布尔参数：文档写 `recommend`，**源码读 `recommended`**（缺省即 422）。
- 新增/更新返回码：文档称 200/201 区分；源码实现两者路径均可见 200（以实测为准，接入时加回归）。
- `savePlaylists` 标注 "TODO: DOCUMENTATION & FIX"，文档干脆没写它——它是坏的。
- 官方 client-next（Electron+Vue）的 API 层只有公开端点 + Connect 登录视图，**没有**任何收藏调用——与"功能不存在"互证。

## 五、若获批：本项目接入方案草图（不实现）

1. **前提**：项目作者（你）在 SpinShare Discord #development 申请 ConnectApp，取得 apiKey（登记 title）。
2. **连接流程 UI**：设置里加"连接 SpinShare 账号"——展示从官网取 6 位码的指引（外链个人设置页）+ 6 位输入框 → 本地服务调 getToken → validateToken → 成功显示用户名/头像，提供断开（本地删 token；提示可在官网撤销）。
3. **凭证存储**：token 存 `config.json` 新字段或独立文件于状态目录（沿用 `_atomic_write` 防护）；按政策"保护用户数据 + 告知访问内容"：连接页明示我们只访问 评论读写/播放列表读取/通知。
4. **调用通道**：CORS `*` 允许前端直连，但建议**经本地 Python 服务代理** Connect 端点：token 不进 WebView（XSS 防纵深）、统一错误分类进现有 APIError/翻译链、天然节流点；前端 CSP 需把 connect-src 保持为 spinsha.re（已允许）。
5. **功能落点**：
   - 评论：卡片评论浮层加"写评论"（推荐开关 + 文本框，60s 冷却同享）；"我评过"高亮；删除自己的评论。
   - 播放列表只读：新视图"我的列表"（或作为"收藏"替代品，明确告知用户这是 SpinShare 的播放列表）。
   - 通知：托盘/顶栏轻提示，**不轮询**——仅打开通知入口时拉取（政策反对刮取）。
6. **礼仪红线延续**：写操作仅用户显式触发；读自己数据按需拉取 + LRU 缓存；失败静默降级不重试风暴；UA 标识 SpinShareBrowser/<版本>。

## 六、风险清单

| 风险 | 等级 | 缓解 |
| --- | --- | --- |
| ApiKey 申请被拒/无回应 | 高（前置） | 无技术缓解；可先做成"无账号功能不变"的可选模块 |
| API 无速率限制但政策禁刮取 | 中 | 一切用户触发 + 缓存，绝不后台轮询 |
| Connect 端点无版本承诺（v1 信封、文档滞后） | 中 | 以源码为准写契约测试；错误码兜底 |
| token 泄露面（URL 查询串） | 中 | 本地代理收敛出口；不入日志 |
| savePlaylists 修复后行为变化 | 低 | 只读接入，不依赖该端点 |
| 用户误以为有"收藏" | — | 产品文案明确用官方术语（播放列表） |

## 七、证据索引

- 文档：spinsha.re/api/docs（Introduction/Usage Policy/Connect/Profile/Reviews/Playlists/Open Users）
- 服务端源码（clone @ HEAD 2026-10-23）：`src/Controller/API/Connect/*`（4 控制器全读）、`src/Listener/CorsListener.php`、`src/Entity/ConnectApp.php`、`templates/apidocs/gettingstarted/usage-policy.html.twig`；全局 `grep -ri favorite|bookmark` = 0
- 客户端源码：github.com/SpinShare/client-next `src/main/api/*`（无用户写功能）
- 线上探测：3 次无凭证 GET（validateToken×2、getToken 缺参），响应与源码一致

## 八、给用户的建议

1. 想要"评论"：值得做，先去 Discord 申请 ApiKey，拿到后我按第五节草图实施（约一个 MINOR 版本的工作量）。
2. 想要"收藏"：接受现实——SpinShare 没有这个功能；如果官方未来加了，端点一出现我就能接。
3. 不建议碰：上传、账号设置、任何模拟网站会话的行当。
