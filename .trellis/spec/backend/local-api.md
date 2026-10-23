# 本地 HTTP API（PortableHandler）

## 鉴权与请求校验（顺序很重要）

1. `_context_allowed()`：client 必须是 127.0.0.1；`Host` 必须精确等于 `127.0.0.1:<port>`（防 DNS rebinding）；路径不允许 `?`/`#`。放行三类：① `Origin` 精确等于 ui_origin；② native 调用（`Origin: null` + `X-SpinShare-Native: 1` + 无 Sec-Fetch-* 头——供维护脚本/第二实例用）；③ 同源 GET fetch（无 Origin + `Sec-Fetch-Site: same-origin` + Dest: empty——供页面内 fetch）。
2. `_authenticated()`：`X-SpinShare-Key` 必须唯一且 HMAC 比较等于 config token。
3. UI 页面 GET 例外：只要 Host/loopback/Sec-Fetch-Site 合法即可（页面本身不带 token，bootstrap 里注入）。响应带 `X-Frame-Options: DENY`、`frame-ancestors 'none'`、`Referrer-Policy: no-referrer`。
4. 音频流 `/v1/preview/audio/<48hex>` 例外：媒体元素带不了自定义头，靠 Sec-Fetch-Dest: audio + 随机单文件短时效 URL。
5. POST body：拒绝 Transfer-Encoding；Content-Length 唯一且 ≤16KiB；Content-Type 必须 application/json；`_parse_json` 拒绝重复键。
6. 4xx/5xx 响应后 `_discard_rejected_body()`：把未读的 POST body 读完（≤0.25s）再关连接，防 Windows socket reset 抢在响应前。

## 端点速查

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/ui/<secret>/index.html` | 应用页面（服务端渲染 bootstrap 进 HTML） |
| GET | `/v1/charts`、`/v1/charts/status` | 目录缓存只读（含/不含 data）；status 返回含 activity 进度 |
| POST | `/v1/charts/manual`、`/v1/charts/automatic` | 手动/自动同步（automatic 可带 `afterInstall:true`） |
| POST | `/v1/install` | 安装（需 X-SpinShare-Settings revision 头 + 目录已确认） |
| GET | `/v1/jobs/<32hex>` | 安装任务状态 |
| GET | `/v1/settings`、`/v1/activity`、`/v1/health` | 设置 / 活跃任务 / 健康（native 用） |
| POST | `/v1/settings`（directory:null 恢复默认）、`/v1/directory/select`（弹原生选框） | 目录管理 |
| POST | `/v1/installations/check`（≤30 首）、`/index`（整目录清单）、`/delete` | 安装状态与删除 |
| POST | `/v1/preview/resolve` | 解析游戏音频 → 发放短期 URL |
| GET/HEAD | `/v1/preview/audio/<48hex>` | OGG 只读流（Range 支持、OggS 魔数校验） |
| POST | `/v1/language`、`/v1/close-behavior`、`/v1/player-shortcuts-seen`、`/v1/player-volume`、`/v1/install-directory-confirmation` | 设置项（player-volume 体 `{volume:0-1}`，拒 bool；错误码 invalid_player_volume） |
| POST | `/v1/desktop/window`、`/window/regions`、`/dialog`、`/show`(native)、`/exit` | 窗口协作 |
| POST | `/v1/shutdown` | 空闲时优雅退出（native/维护用） |

## 关键错误码（前端 INSTALLER_ERROR_TEXT 有对应文案）

`settings_changed`(409)、`installer_busy`(409)、`shutting_down`(409)、`directory_confirmation_required`(409)、`request_expired`(410)、`queue_full`(429)、`installation_recovery_required`(409)、`installation_changed`(409)、`delete_partial`、`charts_cooldown`(409)、`charts_cache_error`(500)、`pairing_failed`/`context_rejected`(403)。

## 陷阱

- `do_OPTIONS` 有自己的端点白名单，和 do_POST 的白名单**内容不同**（多了 jobs GET 等）；加端点要同时改两处 + 前端 `installerRequest` 的 permitted 列表（三处同步）。
- `_respond` 每次都 `Connection: close`（`close_connection=True`）：本地 API 故意不做 keep-alive，别"优化"掉。
- health 响应里带 uiPath/targetDirectory/pid/instanceId——只对带 token 的 native 调用有意义。
