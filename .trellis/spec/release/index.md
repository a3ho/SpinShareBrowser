# Release 层索引（构建/安装器/发布/测试）

| 文件 | 主题 |
| --- | --- |
| [build.md](build.md) | scripts/build.py 全解：QA vs 正式、门禁、manifest |
| [installer.md](installer.md) | windows.iss：覆盖更新、维护协作、WebView2 引导 |
| [policy.md](policy.md) | 版本政策、只留最新 Release、CI 额度约束下的发布流程 |
| [testing.md](testing.md) | 测试地图与本地运行方法 |

## 产物命名（版本 V）

`SpinShareBrowser-V-windows-x64-setup.exe` + `.sha256` + `-source.zip` + `-build.json`；QA 输出 `build/qa/`（或 `.qa/<dir>`），正式输出 `dist/`。源码版本号同时出现在：`src/spinshare_portable.py VERSION`、`scripts/build.py VERSION`、`installer.py` 的 UA 串、前端 `validateRuntimeConfig` 校验、`assets/windows-version.txt`、README/CHANGELOG——**升版本要一起改**（前端校验 config.version==='x.y.z' 是硬编码）。

## 一句话流程（细节在 policy.md）

本地全绿 → 正式构建（干净树+未用版本号）→ 升级验证（托管 runner，需用户同意）→ 发布 → 核对公开哈希 → 删旧 Release/标签 → 不 push 触发 CI 除非用户点头。
