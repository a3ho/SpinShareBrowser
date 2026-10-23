# 测试地图（本地全离线，不碰 spinsha.re）

## 运行方式（Git Bash / PowerShell 皆可）

```bash
.venv/Scripts/python.exe -m unittest discover -s tests -p "test_*.py"   # 151 用例
for f in tests/test_*.cjs; do node "$f"; done                           # 12 套件
# 无头浏览器冒烟（需要先 npm install --prefix build/browser-tools playwright@1.62.1）
NODE_PATH="$(ls -d build/browser-tools/node_modules)" node scripts/browser_smoke.cjs
# 安装器取消回归（需要构建工具）
.venv/Scripts/python.exe scripts/installer_cancel_smoke.py --compiler build/tools/inno-7.1.0/ISCC.exe --prove-regression
```

## Python（unittest，全部临时目录+fixture）

| 文件 | 覆盖 |
| --- | --- |
| test_chart_cache (35) | 冷却预约协议、双通道、迁移、失败分类 |
| test_chart_deletion (19) | 删除暂存/回滚/部分失败/哈希窗口 |
| test_install_recovery (13) | 事务恢复各中断点、外部修改冲突 |
| test_download_transport (10) | 重定向白名单、截断、大小限、UA |
| test_desktop_notifications (11) | toast 布局/文案、同步通知去重、全屏抑制 |
| test_web_resources (11) | locales 键集合、CSP、模板标记、UA 一致 |
| test_build (8) | SOURCE_FILES 存在性、requirements 钉死、release 门禁 |
| test_windows_installer (8) | iss 关键行、消息、退出码映射 |
| test_install_pipeline / queue / installation_status / install_directory_confirmation / audio_preview / audio_service / desktop_frame / external_links | 各自领域 |

## JavaScript（自研 harness，Node vm 跑**真实拼装后的页面代码**）

`read_web_template.cjs` 复刻后端拼装 → vm 内执行 + 模拟 DOM/fetch/timer 工厂。覆盖：audio_player(31 用例)、review_drawers(35)、catalog_sync、catalog_ui、installation_filters、chart_deletion、date_picker、tag_filters、choice_menus、focus_modality、window_regions、install_directory_confirmation。

## 测试哲学

- 无网络：评论/目录请求全部拦截或注入 fixture；绝不真连 spinsha.re。
- 关键回归都有"故意复活旧 bug 的 fixture 必须被测出"的负向检查（installer_cancel_smoke --prove-regression）。
- 改动对应模块先跑同名测试文件；改协议/管线先跑 chart_cache/install_recovery。

## CI 等价物（.github/workflows/verify.yml）

push/PR：依赖预检 + 双套件 + browser_smoke + QA 构建 + cancel_smoke；dispatch installer_smoke 才走正式构建+双基线（current/previous）真实装/升/卸验收（windows_smoke 拒绝工作站）。**额度耗尽期间不触发**（见 policy.md）。
