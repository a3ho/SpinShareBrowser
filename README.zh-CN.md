# SpinShare Browser

[English](README.md) | **简体中文**

用于浏览和安装 [SpinShare](https://spinsha.re/) 谱面的第三方 Windows 工具。

![SpinShare Browser 谱面浏览界面](docs/images/overview-zh-CN.png)

## 功能

- 按难度和上传日期筛选谱面。
- 在筛选结果内按歌名、副标题、艺人或上传者 / 谱师搜索。
- 按上传日期、难度等级、浏览量、下载量、评论数量或歌名排序。
- 查看封面和完整评论，下载并安装谱面，识别安装状态。
- 支持简体中文和 English 界面。

## 安装

**[下载 Windows 安装包](https://github.com/a3ho/SpinShareBrowser/releases/latest)**

1. 在发布页的 **Assets** 中下载 `SpinShareBrowser-1.0.0-windows-x64-setup.exe`。源码包供自行构建使用。
2. 运行安装包，按向导完成安装。程序为当前 Windows 用户安装，创建开始菜单入口，并提供桌面快捷方式选项。

需要 **Windows 10 1903 或更高版本、Windows 11（x64）**，以及 **.NET Framework 4.8 或更高版本**。安装包包含 Python 和程序所需的库。

安装程序会复用已有的 **Microsoft Edge WebView2 Runtime 123.0.2420.47 或更高版本**。缺少或版本较旧时，通过随包附带的微软引导程序联网下载安装；下载失败可重试。需要离线安装时，请先安装微软 [Evergreen 独立运行时](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)。浏览 SpinShare 需要联网。WebView2 包含 Microsoft Defender SmartScreen，数据处理方式见[微软隐私声明](https://aka.ms/privacy)。

## 使用

1. 选择难度和上传日期，点击“筛选谱面”。默认值为 **XD、0–99** 和 **近 1 周**。自定义日期可只填写开始日期、只填写结束日期，或同时填写两端。
2. 使用筛选器下方的搜索框搜索当前结果。“搜索范围”可选择一项或多项：歌名、副标题、艺人、上传者 / 谱师。
3. 点击“下载并安装”。谱面默认安装到 Spin Rhythm XD 的 `Custom` 目录，可在“设置 → 选择文件夹”中更改。

![筛选、搜索并安装谱面](docs/images/workflow-zh-CN.gif)

**安装会覆盖同名文件。** “已安装”表示本地谱面文件与列表中的版本一致。DLC 谱面在系统默认浏览器中打开 SpinShare 官网，完成授权和下载。

每页可选 **10 条、20 条或 30 条**，也可跳转到指定页码；选择“不限制”后，向下滚动会分批显示更多谱面。搜索、排序和翻页使用已加载的谱面列表，点击“更新数据”可获取 SpinShare 的最新数据。

关闭窗口时会询问“完全退出”或“最小化到系统托盘”。勾选“记住我的选择”后保存偏好，也可在设置中更改。设置和托盘中的“完全退出”会退出程序；下载或安装期间可选择等待当前任务完成后退出。

语言、谱面目录、关闭偏好、窗口大小或最大化状态会自动保存。首次启动以最大化窗口打开。

## 升级与卸载

运行新版安装包即可保留设置并升级。通过 Windows“设置 → 应用”或控制面板“程序和功能”卸载。卸载会删除工具及其设置、缓存等本地数据，保留下载或安装的谱面以及共享 WebView2 运行时。

程序默认安装到 `%LOCALAPPDATA%\Programs\SpinShareBrowser`，设置和内嵌浏览器数据存放在 `%LOCALAPPDATA%\SpinShareBrowser`，谱面存放在所选游戏目录中。

## 许可证

原创代码采用 [MIT 许可证](LICENSE)。第三方组件与美术资源遵循各自的许可证，详见[第三方许可声明](licenses/)和[美术资源署名](assets/README.zh-CN.md)。

[从源码构建](docs/build.zh-CN.md)

<sub>Developed by Liu Yishou</sub>
