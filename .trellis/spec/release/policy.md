# 发布政策与流程

## 版本（SemVer，AGENTS.md 原文约束）

- 含程序改动的每次发布：PATCH 修复 / MINOR 兼容新功能 / MAJOR 破坏性。纯文档不改版本号。
- 版本号与标签**永不复用**，同版本产物**永不覆盖**；`check_release` 在本地与 origin 双重校验标签。
- 升版本清单：src/spinshare_portable.py VERSION、scripts/build.py VERSION、installer.py UA、前端 validateRuntimeConfig 硬编码、assets/windows-version.txt、README×2、CHANGELOG、docs/build.md×2。

## 只保留最新稳定版（2026-09-14 政策）

GitHub 上只留最新 Release+附件+标签。流程：候选版先对**当前已发布稳定版**完成升级验证 → 发布新版 → 下载公开附件核对哈希（对照 build.json 与 .sha256）→ 通过后删除全部旧 Release/附件/标签。保留 Git 提交历史。

## CI 额度约束（2026-10-23 起的硬性纪律）

**用户的 GitHub Actions 线上时间已耗尽。** `.github/workflows/verify.yml` 的 `on: push/pull_request/workflow_dispatch` 意味着任何 push 都会烧配额。因此：

- 日常开发：一切验证本地跑（见 testing.md），**不 push**。
- 发版时的选择（届时与用户确认）：要么跳过托管 runner 验证（用户自担风险），要么用户明确同意后 dispatch `installer_smoke`（约两个 windows-2022 job）。workflow_dispatch 不开 installer_smoke 时只 build QA 不进 dist。
- 工作树里的提交全部本地完成，等配额恢复或用户允许时再统一 push。

## 发布前检查单

1. 本地：Python 151 测试 + 12 JS 套件全绿；QA 构建 + browser_smoke + installer_cancel_smoke 通过。
2. 文档：中英 README 同步且 Use/使用 保持任务导向（无实现细节）；截图/演示用隔离数据重录；CHANGELOG 双语条目。
3. 构建：干净树 → `build.py --preflight` → 正式构建 → 核对 .sha256 与 source.zip 必含文件（docs/build.md 的 PowerShell 片段）。
4. 验证升级（对现役稳定版）→ 发布四件套 → 核对公开哈希 → 删旧版。
5. `.gitignore` 白名单：新产物类文件要放行才会被跟踪。

## dist/ 现状（2026-10-23）

本地留存 2.0.0/2.0.1/2.1.0/2.1.1 的历史产物与 manifest；线上只有 v2.1.1（已核实：gh release list 仅此一条）。
