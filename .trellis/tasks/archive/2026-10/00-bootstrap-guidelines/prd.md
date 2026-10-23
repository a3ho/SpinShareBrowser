# PRD: Build GLM deep project knowledge base

## 背景

项目已由 ChatGPT 完全移交 GLM（2026-10-23）。GLM 已完成一次全量精读（全部文档、5 个后端模块约 5600 行、前端四文件约 5600 行、构建/安装器/CI、全部测试），并现场演示过端到端调试能力（隔离实例 → 密钥 UI → 浏览器交互 → 截图）。本任务把这次认知**持久化**，让以后每个会话不必从源码重新推导。

## 需求

1. 以 `.trellis/spec/` 为载体，建立分层知识库（层 = 目录 + index.md）：
   - `backend/`：Python 宿主五个模块的机制、不变量、坑
   - `frontend/`：`web/` 四文件的状态模型、渲染管线、交互规则
   - `release/`：构建、安装器、发布政策、测试地图
   - `guides/`：本地调试手册、红线清单
2. 删除 init 生成的与本项目无关的占位 spec（数据库、React hooks 等模板）。
3. `AGENTS.md` 改造为会话第一入口：Trellis 用法 + 本地验证纪律 + 红线索引。
4. 根 `.gitignore`（白名单式）放行 `.trellis/` 与 `.zcode/`。
5. 所有既有测试保持通过（本任务不改产品代码）。

## 验收标准

- [x] `.trellis/` 初始化完成（`--zcode` 适配，开发者 glm）
- [x] 占位 spec 全部替换为本项目真实 spec，每个层有 index.md
- [x] AGENTS.md 指向 spec 索引，含验证纪律与红线
- [x] 151 个 Python 测试 + 12 个 JS 套件本地全绿
- [x] 变更本地提交（不 push——线上 CI 额度受限）

## 边界

- 不修改 `src/`、`web/`、`scripts/`、`.github/` 任何产品代码。
- spec 内容必须来自已验证的源码阅读，不写猜测；关键机制标注源函数名（不标行号，行号会漂移）。
