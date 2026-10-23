# 前端构建管线 · 技术设计

## 核心决策

1. **运行时契约零改动**：`web/index.html`（模板+3 标记）、`web/interface.css`、`web/chart-card.js`、`web/app.js`、`web/locales.json` 五文件仍是被服务端 `load_web_template` 读取、被测试加载、被打包的规范产物。本任务只改"这些产物从哪来"。
2. **源码 → 产物，字节级等价**：`web/src/js/*.js`（25 模块）与 `web/src/css/*.css`（13 层）按固定顺序拼接 = 原文件逐字节相同。拆分只在顶层语句边界下刀，拼接即还原，等价性可用 `--check` 机器验证，无需人眼review语义。
3. **构建器零依赖**：`scripts/build_web.py`（纯标准库），内置清单（artifact → 模块顺序表），`--check` 模式重建后与产物比对、漂移即非零退出。产物签入仓库（应用不跑构建也能运行），产物首行带"generated"横幅注释。
4. chart-card.js（155 行，本就独立）与 index.html（292 行结构）、locales.json（数据）不拆。

## 模块边界（app.js 3169 行 → 25 模块）

按行序（字节等价约束下顺序不可变）：prologue 1 / i18n 8 / core-state 48 / motion 99 / status 158 / settings 191 / dialogs 233 / settings-panel 312 / window-regions 422 / filters 534 / search-tags 745 / choice-menus 981 / format-covers 1095 / preview-player 1221 / chart-popovers 1543 / installer-client 1790 / installation 1850 / activity 2168 / reviews 2230 / pagination 2452 / render 2553 / catalog-sync 2615 / json-response 2876 / page-details 2892 / apply-boot 3111。

CSS 13 层按既有分节注释：base / desktop-shell / title-bar / volume / filters / search / cards / tag-layer / window-chrome / queue-dock / catalog-sync / utility / reflow。

## 改动面

- 新增：`web/src/**`（38 模块）、`scripts/build_web.py`。
- 修改：`scripts/build.py` SOURCE_FILES 加 web/src 全部 + build_web.py（源码 zip 完整性）；`.gitignore` 白名单放行 `/web/src/`。
- 不动：`src/spinshare_portable.py` 拼装逻辑、五产物路径、全部测试加载路径、QA/正式构建流程。

## 验证链

拆分器字节比对 → build_web.py --check → node 13 个 .cjs → python 17 个 test_*.py → build.py --qa → 隔离实例冒烟（目录/试听/音量/安装入口）。

## 将来收益

阶段 2-8 的新 UI 在 `web/src/` 按域新增模块文件（如 `session.js`、`playlists.js`），清单一处登记；不再有 3000 行单文件。
