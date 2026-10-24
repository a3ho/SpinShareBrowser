# 会话客户端模块 · 技术设计

## 组件与分层（单进程内三层）

```
web/session.js ──/v1/session/*──▶ spinshare_portable(PortableManager)
                                      │ 拥有 SessionStore + SpinShareWeb + WriteQueue
                                      │ set_login_window_opener(fn) ← desktop.py 注册
                                      ▼
                        desktop.SessionLoginWindow（pywebview 运行时开窗）
                        spinsha.re/login → 用户亲手登录 → get_cookies()（真 CookieManager，含 HttpOnly）
                        → clear_cookies() 清理共享 profile → destroy()
```

- **src/session_client.py**（新，不 import desktop/spinshare_portable——被两者 import）：
  - `SessionStore`：`<state>/session.dat`，JSON（identity{userId,username,connectedAt}、cookies[]、userAgent）→ DPAPI CryptProtectData（entropy 固定字节）→ 原子写（os.replace）。读失败（缺失/损坏/解密失败）= 未登录。绝无 cookie 值入日志。
  - `SpinShareWeb`：urllib Opener + CookieJar；`get(url)`/`post(url, fields|multipart)` 返回 (final_url, html)；**会话失效判定** = 最终 URL 落在 /login 或页面含 `_username` 登录表单 → `SessionExpired`；**已登录判定** = 页面含 `user-actions` + `/user/{id}/charts` 链接（base.html.twig 已核实）。UA 用登录时从窗口抓的 `navigator.userAgent` 原样回放（登录浏览器与后端客户端指纹一致）。
  - HTML 解析用 stdlib `html.parser`（零依赖）：`form[_token]` CSRF、`playlist_{N}` 勾选组（含 checked 态）、Symfony 表单字段。
  - `complete_login(cookies, ua)`：verify（带 jar GET spinsha.re 首页判已登录）→ 解析 userId（header `/user/{id}/charts`）→ username（公开 API `/api/user/{id}`）→ 存 store。
  - `WriteQueue`：串行 worker + 最小间隔（默认 1.2s），操作一次性提交、失败即返回不自动重试（无重试风暴）；仅 UI 触发入队（红线）。
- **desktop.py**：`SessionLoginWindow.begin(store_dir, on_done)`——`webview.create_window`（非主线程运行时开窗，pywebview 6.2.1 支持）加载 `https://spinsha.re/login`；看门狗线程每 2s `get_current_url()`，离开 /login 即候选：`get_cookies()` 提取 spinsha.re 域 → 交给 `complete_login` 验证，通过则 `clear_cookies()`（共享 profile 只含我们的 UI，无第三方 cookie，DeleteAllCookies 安全）+ 抓 UA + `destroy()`；超时 10 分钟或用户关窗 = 取消。`--no-browser` 模式无 guilib：opener 未注册，端点返回结构化错误。
- **spinshare_portable.py**：
  - `GET /v1/session/status` → `{connected, username, userId}`
  - `POST /v1/session/login` {} → `{accepted}`；已连接 409 `session_connected`；窗口已开 409 `session_login_busy`；无桌面壳 409 `session_window_unavailable`
  - `POST /v1/session/logout` {} → `{connected:false}`（清 store）
  - bootstrap 加 `session` 节（启动即知状态，UI 不用先请求）

## 前端薄切片

- `web/src/js/session.js`（MANIFEST 登记在 settings-panel 后）：状态 + `syncSessionUI()`（未登录=登录按钮；已连接=“已连接：”+username+断开按钮）+ 登录轮询（POST login 后每 2s GET status，最长 10 分钟，窗口期提示文案）+ 断开。动态 username 走 textContent（用户数据不进 i18n 令牌）。
- index.html 设置面板加一行 field + actions（复用 settings-field/settings-actions/button 既有类，零新设计语言，符合薄切片定位）。
- installerRequest 白名单 + 3 端点。
- locales.json 新键对（en/zh 同步，红线 16）；图标不需要（文本按钮）。

## 测试

- `tests/test_session_client.py`：DPAPI 往返/损坏容忍、cookie 序列化往返、CSRF/勾选组/登录页判定/已登录判定（内联 fixture HTML，结构以 spinshare-server-mirror 模板为准）、WriteQueue 串行+间隔+失败不重试、multipart 构造、端点 409/200 全链路（借 test_player_volume 的 manager 测试模式，opener 用假回调）。
- 真实登录窗 E2E：本任务代码侧只验"窗口能开、能取消"；带真账号的完整登录 = 所有者协助点（登录后 status 显示用户名、cookie 文件为 DPAPI 密文、断开清空）。

## 红线对照

- cookie = 账号本体：DPAPI + 不入日志 + 可断开 ✓；无后台网络行为（登录轮询仅 UI 显式触发）✓；写队列本任务只建骨架不接业务 ✓。
