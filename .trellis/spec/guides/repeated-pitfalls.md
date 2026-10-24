# 重复坑清单与全局防线（2026-10-24 所有者指令：踩过两次的坑必须全局根除）

> 指令原文："以后所有遇到两次以上的坑，都要保证全局以后不再犯"

## 1. Bash heredoc 内联大段代码（3 次事故：脚本中断丢步骤 / 巨型 heredoc 截断 / `\\0` 被还原成真实 NUL 字节写进源码）

**防线（硬性）：**
- **禁止在 bash heredoc 里内联任何多行代码/标记/样式内容**。内容一律先用 Write 工具写成临时文件（如 `tmp/snippet.*`），再用小段 python（读文件 → assert 定位 → 插入/替换 → 立即落盘）完成接线，最后删临时文件。
- **每一步编辑独立落盘**：一个 python 脚本只做一处修改；多步 = 多个脚本顺序执行。绝不在一个脚本里堆叠多处 `assert+replace`（中途 assert 失败会让后面的步骤静默丢失——阶段 6/8 各踩一次）。
- heredoc 里需要字面反斜杠/转义序列时（如 Win32 过滤器串），**用 `chr(0)` 等显式拼接，零转义序列**。

## 2. vm 跨 realm 断言（3 次：音量会话、playlists、reviews-write 的 cjs 测试）

**防线：** 沙箱内创建的对象与测试 realm 的对象"结构相同但引用不同"，`assert.deepEqual` 必炸。**跨 realm 断言只比较原始值**：`arr.join(',')`、逐字段 `assert.equal`。新 cjs 测试写断言前先自问：这个值是 vm 里造的吗？

## 3. UI 文案句号结尾 + locale 键缺失（3 次事故：句号 2 次 + 缺键 3 次——session、playlists、阶段 8 的 "Required DLC"≠已有 "Requires DLC"）

**防线（已固化成门禁）：** `tests/test_web_resources.py::UICatalogCompletenessTests` 静态扫描 index.html 的全部 `data-ui-static`/`data-ui-attr-*` 与 js 的全部 `m('…')` 字面量，缺任一语言键即测试失败（源码转义已解码对齐运行时键）。**新增 UI 文案后此门禁兜底**，但写键时仍自查：结尾不带句号；"需要 X" 类键别和已有"动词 X"键搞混。

**防线：** en/zh 值一律不以 `.`/`。` 结尾（`test_system_prompt_copy_omits_terminal_full_stops` 是门禁，但别等门禁——写键时自查）。中英文案完整自然句放在正文中段，结尾停在最后一个词。

## 4. 新 cjs 测试的 DOM mock 检查清单（reviews-write 测试连环 4 修：appendChild / remove / parentElement / setTimeout 立即执行）

**防线：** 造 Element mock 时逐项确认：
- `append`/`appendChild`/`prepend` **必须设置 `node.parentElement=this`**；
- `remove()` **必须真的从 parentElement.children 里删掉**（不能是空函数）；
- 对话框/浮层节点需要 `showModal/close/showPopover/hidePopover/matches(':popover-open')` mock；
- `setTimeout` mock **默认不执行回调**（记录即可）——立即执行会瞬间解除两步确认；
- 异步 click 处理器的后半段在微任务里——断言 DOM 前先 `await new Promise(r=>setImmediate(r))`。

## 5. 大文件 / 生产-镜像分歧类（各 1 次，暂列观察）

- 生产站 HTML/API 形状 ≠ 开源镜像（评论表单位置、歌单 API songs 字段、勾选框顺序）——**解析生产页面前先真机 dump 一次**（用已存会话），镜像只作参考。
- pywebview `get_cookies()` 返回 SimpleCookie——已有 `normalize_webview_cookies`，勿绕过。

## 执行方式

- 每个 cjs/py 测试新文件 PR 前，对照第 2/4 节过一遍。
- 每次连环编辑，对照第 1 节拆步。
- 本文件由 trellis-update-spec 维护；再犯任何一条 = 先补防线再修 bug。

## 6. 隐藏页面的零视口（2026-10-24 新增，关联阶段 1 的老教训；同日修正）

后台/隐藏标签页里 `innerHeight=0`、`clientHeight=0`，而 rect 可能仍是旧值。**视口守卫（"锚点出界即关闭"）必须先判零视口再判边界**——否则后台页会把所有浮层误杀。顶栏锚点（铃铛）天然在 `--top` 之上：出界判定用 0，`--top` 只做定位钳制。

**2026-10-24 修正：守卫里不能含 `document.hidden`。** 隐藏页的几何测量（getBoundingClientRect/offsetWidth）是真实有效的，首次同步定位必须在后台窗口也能跑——`document.hidden` 一挡，浮层就停在 CSS 默认位（"浮窗位置错"2 次事故的共因之一）。零视口守卫只判 `!innerHeight||!clientHeight`；`tests/test_popover_engine.cjs` 有回归门禁。

## 7. 浮层定位被 UA popover 样式表劫持（2026-10-24，账户浮窗"位置依然是错的"根因）

`[popover]:popover-open` 的 UA 样式是 `position:fixed; inset:0; margin:auto`。引擎只内联 `top/left` 时，`bottom:0 + margin:auto` 会把盒子**垂直居中到视口底部与 top 之间**（top 57 的菜单渲染在 438）。**防线（双保险）：** 每个走 popover-engine 的浮层 CSS 必须带 `inset:auto`（playlist-picker/notifications/volume 一直有，account-menu 曾漏）；引擎 reposition 同时内联 `right/bottom:auto; margin:0`。新增引擎浮层两处都要有。

## 8. 冻结的 APP_CONFIG 写入静默失效（2026-10-24，"自动更新开关根本不能用"根因）

`APP_CONFIG` 是 `Object.freeze` 的（安全设计，别改）。对它属性赋值在非严格脚本体里**静默 no-op**——`APP_CONFIG.autoUpdateCharts=result.autoUpdateCharts` 不生效，UI 读旧值把开关弹回。**防线：** 模块可变状态一律用模块级 `let` 从 APP_CONFIG **拷贝初值**（`closeBehavior`/`previewVolume`/`sessionAccount` 全是这个模式），绝不写 `APP_CONFIG.*`。`tests/test_auto_update.cjs` 用冻结 APP_CONFIG 做回归门禁。

## 9. 方法被删但调用还在（2.3.3 事故：`_try_capture_session`/`_close_login_window`）

重构 `desktop.py` 时两个方法被删而调用点保留 → 登录监视线程 20 秒后 AttributeError → cancel_login → 用户输密码时弹"登录超时"，且窗口不关。**防线：** 线程/异步循环必须有**跑真循环的测试**（`tests/test_desktop_login.py` 用假时钟驱动完整 watcher），只测孤立方法测不到"方法不存在"。重构删除任何 `def` 前先 grep 调用点。

## 10. 运行中服务的 bundle 是启动时内联的（2026-10-24 验证踩坑）

服务端把 `web/app.js`/`interface.css` 内联进 browser.html 的时机是**进程启动**。改了 `web/src/*` 并 `build_web.py` 后，正在跑的实例仍然服务旧 bundle——浏览器里 reload 也没用。**防线：** 真机/浏览器验证前先重启实例（`/v1/shutdown` + 重启），再验证。

## 11. 视觉模型的坐标读数不可信（用户"修一遍之后和没修一样"的元教训）

截图喂给视觉模型问坐标，读数可以错 300+ 像素（把设置面板当右侧栏——实际是居中 modal；把帮助图标当复选框）。**防线：** 位置断言只用两种来源——浏览器里的 **DOM rect**（getBoundingClientRect）或真机**像素差分**（前后截图 numpy diff 得 bbox）；视觉模型只用来描述"长什么样"，永远不用来定位点击目标。
