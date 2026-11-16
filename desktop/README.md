# Juben Windows 桌面版

双击 `Juben-Setup-1.1.0-Windows-x64.exe`，以独立桌面窗口运行原项目。软件内置 Electron 界面引擎、React 界面、Python 运行时与 FastAPI 后端；使用者无需安装浏览器、Node.js 或 Python。

## 开始使用

1. 双击安装 EXE，按向导选择安装目录；安装后从桌面或开始菜单启动 Juben。
2. 选择「文件 → 连接设置」，默认模型服务选「自定义 API（OpenAI 兼容）」，填写 API 基础地址、API Key 和准确的模型 ID，保存后自动重启。也可选择 DeepSeek 或智谱。
3. 进入作品页创建作品。通过「文件 → 打开数据目录」查看本地作品、配置和日志。

API Key 对应的模型请求仍需网络和模型服务。软件没有内置大模型权重。

本地作品文件可直接保存。原项目中的 PostgreSQL 历史会话、笔记、统计、Milvus 向量检索、Neo4j 图谱、飞书等功能仍需要各自的服务和配置。此版本未把这些数据库服务打入 EXE，也未将其全部改为 SQLite。

配置和作品保存在 `%APPDATA%\juben-desktop\workspace`，实际位置以「打开数据目录」为准。安装器支持升级和卸载；卸载保留作品和配置。连接配置按原项目方式保存在当前 Windows 用户的数据目录中。

## 用 GitHub 构建 EXE

把本源码放入自己的 GitHub 仓库后，在 Actions 中运行 **Build Windows EXE**：

1. 打开自己的仓库，进入 Actions。
2. 选择 Build Windows EXE，点击 Run workflow。
3. 等待 `windows-exe` 作业成功。
4. 在该次运行的 Artifacts 下载 `Juben-Installer-Windows-x64`，解压后获得 EXE、SHA256SUMS 和预览图。

工作流也会在 main、master、desktop/** 分支上的代码推送时触发。只改 Markdown、pictures 或 data 不触发自动构建；手动运行仍可用。

工作流只上传构建产物，不自动创建 Release。构建流程没有配置代码签名证书。

上游 data 目录含 Windows 不支持的冒号文件名。工作流用稀疏检出排除此目录，构建中不带入上游用户、会话、作品和运行历史。Windows 检查点文件名另做编码处理。

## 本机重新构建

要求 Windows x64、Python 3.12、Node.js 24；以下命令从仓库根目录执行：

```powershell
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r desktop/requirements-lock.txt
.venv/Scripts/python.exe -m pip check
$env:VITE_DESKTOP = 'true'
$env:VITE_API_BASE_URL = ''
npx --yes pnpm@9.15.9 --dir frontend install --frozen-lockfile
npx --yes pnpm@9.15.9 --dir frontend run build
npm --prefix desktop ci
node desktop/check_backend.cjs
.venv/Scripts/python.exe desktop/test_windows_checkpoint.py
.venv/Scripts/python.exe -m PyInstaller --noconfirm --distpath dist/backend --workpath build/backend desktop/backend.spec
npm --prefix desktop run pack
$env:JUBEN_EXE = (Resolve-Path 'dist/desktop/win-unpacked/Juben.exe').Path
npm --prefix desktop run smoke
npm --prefix desktop run dist
$env:JUBEN_EXE = (Resolve-Path 'dist/desktop/Juben-Setup-1.1.0-Windows-x64.exe').Path
$env:JUBEN_INSTALLER = $env:JUBEN_EXE
node desktop/installer-smoke.cjs
```

产物在 `dist/desktop/`。安装向导支持选择目录、创建桌面和开始菜单快捷方式；程序安装一次，后续直接启动。作品保存在单独的用户数据目录。所有资源均来自构建包；启动不下载 Python 或浏览器。

## 验证范围

`check_backend.cjs` 验证本地登录、私有请求校验、SPA 深层路径、新建作品、数据写入和退出释放端口。

`smoke.cjs` 用 Playwright 的 Electron 驱动直接测试桌面应用，验证独立窗口、自动登录、渲染进程隔离、设置窗口、IPC 来源校验、作品保存、页面刷新、应用重启和前端本地设置保留。此过程不启动 Chrome 或 Edge。

`installer-smoke.cjs` 执行静默安装、启动已安装程序、自定义 API 大纲生成、重启、覆盖升级、静默卸载，并确认卸载保留数据。`test_custom_api.py` 验证普通对话、SSE 流式和工具调用协议。

自定义接口通过本机模拟的 OpenAI 兼容 HTTP 服务验证，确认基础地址、Bearer 密钥和模型 ID 实际生效；真实服务商、付费调用与外部数据库集成需要实际服务和密钥才能验证。交付验证记录会明确区分本机结果与 GitHub Actions 结果。

## 排查启动问题

「文件 → 打开数据目录」中的 `logs/desktop-backend.log` 包含后端启动信息，`logs/desktop-launch.log` 记录启动器异常。配置保存后会自动重启软件。

服务仅监听本机回环地址，并要求由桌面进程提供的随机会话标记。窗口禁止跳转到外站和创建额外网页窗口；渲染进程未开放 Node.js。

本地服务优先复用先前端口，以保留前端设置。原端口被占用时会分配新端口；作品文件仍保留，前端视图偏好可能需要重新设置。

## 来源与回滚

上游：https://github.com/VanGong1999/juben ，MIT 许可证，基线提交 `5f56075fecbaa780d5158274f387332fc71de7f0`。

桌面适配新增 `desktop/` 和 `.github/workflows/windows-exe.yml`，修改前端入口、API 地址、类型声明、日志路径及 Windows 检查点文件名。没有修改上游服务端部署入口。用交付的补丁文件反向应用可撤销源码适配；回滚前先备份自己的新改动及用户数据目录。

## 自定义 API 地址

填写服务商提供的 Chat Completions 基础地址，例如 `https://api.example.com/v1`，不附加 `/chat/completions`。本地免密的兼容服务可留空 Key。仅支持 OpenAI 兼容的 Chat Completions 协议；Anthropic Messages、Responses 等不同协议需要兼容网关。选择自定义模式后，文本创作统一使用该地址和模型，历史会话中的旧模型名称不会覆盖此设置。图片、语音、搜索等独立服务仍按上游各自配置。
