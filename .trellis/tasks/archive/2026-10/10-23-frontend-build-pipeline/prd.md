# 前端构建管线：模块化源码与构建期拼装

> 阶段 1/8 · 无依赖 · 优先级 P1 · 所有后续 UI 任务的铺路石

## Goal

用真正的构建管线替换 web/ 四文件运行时内联拼装：模块化源码在构建期打包，运行时产物保持单文件 browser.html 契约不变，为会话功能带来的 UI 面积扩张铺路。

## 背景与依据

- 现状：`web/` 四文件（index.html / interface.css / app.js / locales.json）由 `assemble_web_template` 在运行时内联拼装成单文件 browser.html。当年为可移植/可检视做的决定。
- 会话蓝图（阶段 2-8）将带来登录、歌单、上传、通知、我的首页等大量新 UI，四文件单体会成为维护税。这是全蓝图中唯一"现在不做、以后加倍还债"的点。
- 关键约束：**运行时产物契约不变**——本地服务仍只吐单个 HTML，安全模型（密钥 UI、无外部资源加载）不变。

## Requirements

**做：**
- 前端源码模块化（JS 按功能分模块、CSS 可分层），构建期打包为现有的四文件形状或直接产出最终内联产物。
- `scripts/build.py` 与 QA 构建路径接入新管线；产物字节契约（内联顺序、i18n 令牌机制、无外部引用）与现状等价。
- 现有全部 .cjs 测试（跑真实 app.js 的 vm harness）继续通过，必要时按新源码布局迁移 harness 的文件加载路径。
- dev 体验：改前端源码后能一条命令重建产物并本地起隔离实例验证。

**不做：**
- 不引入运行时框架/依赖打包器生态（esbuild 等二进制依赖需评估；首选零依赖的 Python/Node 脚本拼接方案，除非论证必要）。
- 不改任何用户可见行为、不趁机改 UI。
- 不动 i18n 令牌机制（\u0001spinshare-…\u0002）。

## Acceptance Criteria

- [ ] `web/` 下源码按模块组织，单文件不再超可维护规模（app.js 拆分）。
- [ ] 构建产物与改造前在功能上逐项等价：全部单测（Python + .cjs）通过。
- [ ] 隔离实例端到端冒烟：目录浏览、试听、安装、音量全部正常。
- [ ] build.py --qa 路径正常，正式构建产物入 dist/ 的流程不受影响。
- [ ] spec（frontend/app-map 等）同步更新源码地图。

## 风险与开放问题

- 拆分 app.js 的粒度：建议按状态域（catalog/player/installer/dialog/…）切，具体在 design.md 定。
- locales.json 保持单文件（它是数据不是代码）。

## 验证方式

本地全量：unittest discover + 逐个 node tests/test_*.cjs + build.py --qa + 隔离实例冒烟（见 guides/local-debugging.md）。无线上流水线。
