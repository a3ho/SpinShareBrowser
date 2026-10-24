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
