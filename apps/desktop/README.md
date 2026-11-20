# ChalkLee 桌面应用

基于 Electron、React 和 Tiptap 的桌面应用，包含资料目录、PDF 与 Word 预览、ChalkLee 文档和 Markdown 编辑、题库与选题篮、版本记录、ChalkLee AI、插件中心以及外部 AI 应用连接。

## 开发

以下命令在仓库根目录执行，常用命令也可以在本目录执行：

```bash
npm ci
npm run dev            # 启动开发版
npm run test:desktop   # 桌面应用测试
npm run build          # 类型检查与构建
npm start              # 预览已构建的应用
```

测试原稿转换效果时，可以让每次新转换（含“重新转换”）都重新识别，不复用以前转换同一原稿留下的结果：

```bash
CHALKLEE_CONVERSION_CACHE=fresh npm run dev
```

继续转换、自动继续和校对仍沿用这次转换的进度。转换缓存保存在应用数据目录的 `conversion-cache/import-cache/` 中，30 天未使用后自动清理。

## 代码结构

```text
src/main/          主进程：窗口、本地文件与后台服务
  agent/           ChalkLee AI、外部 AI 应用连接（MCP）和两者共用的工具
  conversion/      原稿转换流程与转换任务
  plugins/         插件包、沙箱服务、插件数据与内置插件
  questionBank/    题库索引与后台线程
  workspace/       工作区文件、版本和内部存储
  settings/        模型、文字识别、联网搜索与应用设置
  dev/             开发时使用的界面自动化，打包后不启用
src/preload/       渲染进程可用的桌面接口
src/renderer/src/  界面：app、editor、markdown、viewers、workspace、conversion、
                   assistant、questionBank、plugins、inspector、outline、settings、
                   ui、theme、styles
src/shared/        两个进程共用的类型与纯逻辑，按同样的功能划分
src/test-fixtures/ 编辑器测试使用的合成文档
scripts/           MCP 配置、插件检查与打包、标签预设、第三方许可证汇总
resources/         应用图标、文档图标和安装界面背景
```

主进程、共用代码和界面中的同名目录对应同一功能。界面通用控件放在 `ui/`，颜色映射位于 `theme/`，全局样式位于 `styles/`。

ChalkLee AI 和外部 AI 应用使用的工具在 `src/main/agent/tools/` 中只定义一次，用 `surfaces` 标明提供给哪一方，两边共用的工具不要各写一份。

AI 会话和模型传输库在第一次打开对话或执行模型任务时才加载，MCP SDK 在收到第一个外部请求时加载，题库线程在第一次使用时创建。新增功能时保留这些延迟加载的入口，不要在主进程启动时提前导入。

## 原稿预览、LaTeX 与 Markdown

DOC 和 DOCX 使用 ChalkWord 只读预览，不修改原稿。转换复用同一套解析器，提取正文、编号、表格、图片及受支持的可编辑公式，再由 ChalkLee AI 按原稿引用整理成题目。支持范围见 [Word 模块说明](../../packages/word/README.md)。

LaTeX（`.tex`）也是原稿，只转换，不编辑、不编译，打开时显示只读源码。转换前主进程读取它用 `\input`、`\include`、`\subfile` 引用的子文件和 `\includegraphics` 的图片（只读工作区内的普通文件），连同原稿交给转换窗口；`src/shared/latex/` 依次解码（UTF-8、GB18030、UTF-16）、去注释、展开文件中的自定义命令，再把正文解析成与 Word 相同的只读模型，交给同一套原稿引用流程。exam-zh 和 exam 文档类的题目、选项、`\paren`／`\fillin` 中的答案和解析按编译后的样子写出题号和【答案】【解析】。PDF 格式的插图在转换窗口按约 300 DPI 渲染；TikZ 等代码绘图不编译，保留待补图标记和原代码。被另一份 `.tex` 引用的子文件不在目录中单独显示。

Markdown（`.md`、`.markdown`，UTF-8，最大 10 MB）不算原稿，用 CodeMirror 直接编辑原文件，边写边显示排版效果。支持标题、强调、列表、待办、引用、表格、代码、链接以及 `$…$`、`$$…$$`、`\(…\)`、`\[…\]` 公式；原始 HTML 作为文字显示，图片只显示说明和地址。

保存时保留原文件的 BOM、换行符和行尾空格，写入前先把原文存为版本；文件在外部被修改过时拒绝覆盖。“转换为 ChalkLee”把保存后的文件另存为一份独立的 ChalkLee 文档，之后修改 Markdown 不会同步过去。Markdown 不参加文件夹的批量转换。

## 打包与发布

在仓库根目录运行 `npm run package:mac` 生成 macOS DMG，在 Windows 上运行 `npm run package:win` 生成 x64 NSIS 安装包，产物位于 `dist/`。`npm run package:dir` 生成当前平台的应用目录，供本地验证。三个命令都会先检查类型并构建，默认不发布。正式分发时按目标系统配置代码签名，macOS 还需要公证。

前端库和编译时使用的工作区包放在 `devDependencies`，由 Vite 编译进产物；`dependencies` 只保留主进程运行时仍需从 `node_modules` 加载的库。MathLive 的服务端公式处理也编译进主进程，并保留界面所需的字体和资源。打包时排除依赖的源码映射，Electron 语言资源只保留英文、简体中文和繁体中文。

构建时把编译进主进程和界面的第三方包许可证及随应用分发的素材声明汇总为 `out/THIRD_PARTY_LICENSES.txt`，打包时与仓库的 `LICENSE`、`NOTICE` 一起放进应用资源目录。

从 Release 标签指向的提交构建安装包，并在同一 Release 中提供该提交的对应源码下载。
GitHub 的 `Source code` 下载项取自这个标签。若安装包另有下载页面，也在那里给出对应源码入口。

## 文件关联与图标

macOS 应用包声明 `com.chalklee.document` 文件类型，Windows 安装程序注册 `.chalklee`。安装后可以在系统的“打开方式”中选择 ChalkLee，默认应用沿用系统和用户的选择。

双击文件、拖到 macOS 的 Dock 图标以及 Windows 的启动参数都走同一个打开流程，应用已运行时复用现有窗口。当前工作区内的文件已打开时切换到对应标签；其他位置的文件先保存当前工作区的编辑，再以文件所在文件夹为工作区打开，保存失败时留在原工作区，编辑内容不丢失。不存在的文件和 `.chalklee/` 内部文件拒绝打开。

开发模式不注册文件关联，构建后可以运行 `npx electron apps/desktop /absolute/path/to/document.chalklee` 检查打开入口。

应用图标与界面中的 `src/renderer/src/assets/logo.svg` 图形相同：macOS 使用 `resources/icon.*`，按系统图标网格在 1024 画布中放 824 的底板并带投影；Windows 使用铺满画布的 `resources/icon-windows.*`。文档图标 `resources/chalklee-document.*` 与目录树中的 `DocumentFileIcon` 一致。修改时同步更新这些 SVG，并重新导出 PNG 等位图。

## 外部 AI 应用连接

在设置的“外部连接”中开启后，按应用复制配置即可连接。开发时可以运行 `npm run mcp:config`，生成指向当前仓库的配置。接口说明见 [外部 AI 应用连接](../../docs/external-agent-mcp.md)。
