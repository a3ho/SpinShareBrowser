# 谱面上传

> 阶段 8/8 · 依赖 session-client · 优先级 P2 · 创作者面

## Goal

创作者面：原生上传表单（backup zip/tags/description/dlc/publicationStatus/isExplicit）走 POST /upload，我的谱面列表与管理。

## 背景与依据

- 上传表单契约已源码核实（UploadController + 所有者截图）：`form[backupPath|tags|description|isExplicit|dlc|publicationStatus|save]`，Symfony 表单需 CSRF；publicationStatus 0=Public/1=Hide from lists/2=Unlisted；dlc 必填（选项来自公开 `/api/dlcs`）。
- 编辑走 `/song/{id}/update`；删除自己谱面为破坏性操作需强确认。

## Requirements

**做：**
- 原生上传表单：backup .zip 选择/拖放 + 本地预检（zip 结构白名单复用安装器的校验知识）、描述、tags、DLC 下拉、发布状态三选（差异语义在 UI 讲清楚）、explicit 开关。
- 提交：CSRF + multipart POST /upload；服务器表单校验错误映射为中文/英文行内提示；成功后读回校验并进入我的谱面。
- 我的谱面：列表（`GET /api/user/{id}/charts` 公开）+ 编辑（信息/新 zip）+ 删除（强确认）。
- 大文件上传进度与超时处理。

**不做：**
- SpinPlays 视频（可作后续）；他人谱面管理。

## 前端体验要求（所有者最高优先级）

- 上传表单与"我的谱面"面板交互稿先过所有者；表单全状态（校验中/提交中/失败逐字段/成功）；拖放反馈动效；中英同步；截图走查。

## Acceptance Criteria

- [ ] 表单提交/校验错误映射契约测试全绿（fixture 基于模板镜像）。
- [ ] 破坏性删除的多重确认测试。
- [ ] 隔离实例 E2E（所有者协助，可用测试 zip）+ 截图走查。
- [ ] spec 沉淀。

## 风险与开放问题

- 大 zip multipart 超时与重试边界；publicationStatus="Hide from lists" 在客户端目录中的可见性表达。
