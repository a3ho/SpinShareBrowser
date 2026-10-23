# Project instructions

SpinShare Browser：Windows 桌面工具，浏览/试听/安装/管理 spinsha.re 谱面。
架构：Python 本地服务（`src/*.py`）+ WebView2 单页界面。前端源码在 `web/src/`（25 个 JS 模块 + 13 个 CSS 层），由 `scripts/build_web.py` 按清单拼接生成 `web/app.js` 与 `web/interface.css`（签入仓库的产物，`--check` 验证无漂移）；运行时仍由服务端内联成单文件 browser.html。

## 前端质量（所有者最高优先级）

前端效果、用户体验、交互逻辑是所有者最看重的维度，值得无限时间投入。任何 UI 任务必须做到：设计先行（重要界面交互稿交所有者选型后再实现）；全状态覆盖（加载/空/错误/会话失效/陈旧冲突）；对齐既有设计语言（DESIGN.md）与浮层/动效体系；图标控件带可访问名称（红线 12）；中英双语同步（红线 16）；隔离实例 + 截图视觉走查后才算完成。

## 每次会话的工作方式（Trellis）

- 本仓库由 Trellis 工作流管理（`.trellis/`），开发者身份 `glm`（即我本人，GLM）。
- 动代码之前先读 `.trellis/spec/index.md`，按需加载相关层的 spec；这些 spec 是我对本项目的深度认知库，比从源码重新推导快得多。
- 任务生命周期用 `.trellis/scripts/task.py`（create/start/finish/archive/list）；会话结束把记录追加到 `.trellis/workspace/glm/journal-*.md`。
- 学到的长期教训要提升回 `.trellis/spec/`，不要只留在任务目录或日志里。

## 验证纪律（硬性）

- **GitHub Actions 线上额度有限（可能为 0）。未经用户明确同意，不得 push、不得 dispatch workflow。** 一切验证在本地完成：
  - `.\.venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py"`
  - 逐个 `node tests/test_*.cjs`
  - QA 构建：`.venv\Scripts\python.exe scripts\build.py --qa`（正式构建才写 `dist/`）
- 本地起隔离实例做端到端调试的方法见 `.trellis/spec/guides/local-debugging.md`。
- push/发布流程见 `.trellis/spec/release/policy.md`。

## 红线（改代码前必读）

- 完整清单在 `.trellis/spec/guides/red-lines.md`；最关键的三条：
  1. 曲目详情/计数接口不得作为数据源（目录一律本地缓存）；下载仅限用户显式点击。例外：用户本人会话下显式发起的线上歌单管理（建/删歌单、加/移除歌曲，含加歌路由的计数副作用）。完整边界见 red-lines.md。
  2. 冷却/退避/安装事务/恢复机制是刻意设计，绕过即回归。
  3. 安装器绝不强杀有活跃下载/安装任务的进程。

## Release documentation

- Treat `README.md` and `README.zh-CN.md` as user-facing product documentation.
- Keep `Use` / `使用` concise and task-oriented: explain what the user should do, what they will see, and only safety-critical consequences.
- Do not put implementation details there, including hashing or indexing algorithms, queue and concurrency internals, cache invalidation, rollback mechanics, or process-lifecycle design. Put those details in `CHANGELOG.md`, `PRODUCT.md`, `DESIGN.md`, or build documentation as appropriate.
- For every release, update the English and Chinese README together and review both usage sections against this rule before publishing.
- Before publishing, verify that both README screenshots and demonstrations reflect the current interface and visible user actions. Regenerate stale media from isolated data, and never expose local paths or obsolete UI states.

## Release versioning

- Use Semantic Versioning for every formal release containing program changes: increment PATCH for fixes and other compatible maintenance changes, MINOR for compatible new features, and MAJOR for breaking changes.
- Documentation-only updates do not require a version increment.
- Publish changed program builds under a new version and tag. Never reuse a previously released version number or overwrite same-version release artifacts.
- Keep only the latest stable GitHub release, its assets, and its version tag. After a new release passes verification and its public downloads are checked, delete every older release with its assets and version tag. Do not retain old releases. This supersedes the previous rule to preserve existing release assets.
- Complete upgrade verification against the currently published stable release before publishing its replacement and removing the old release. Preserve Git commit history.
