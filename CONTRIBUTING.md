# 参与贡献

感谢你关注 ChalkLee。下面说明怎样反馈问题、搭建开发环境和提交代码。

## 反馈问题

使用中遇到问题或有建议，可以加入 QQ 群 **1135963910**，也可以在 [Issues](https://github.com/seven0x16/chalklee/issues) 里提出。反馈问题时请写明：

- 系统和 ChalkLee 版本（在设置 › 关于中查看）；
- 操作步骤、看到的结果和预期的结果；
- 与转换有关时，原稿是 Word 还是 PDF（是否为扫描件），用的是哪个模型。

请不要上传含有学生姓名、成绩等个人信息的资料，必要时换成虚构内容或截取局部。

## 开发环境

需要 Node.js 22.19（22.x）或 24 及以上版本。在仓库根目录执行：

```bash
npm ci
npm run dev
```

仓库使用 npm workspaces：

| 目录 | 内容 |
| --- | --- |
| `apps/desktop/` | Electron 桌面应用，结构见[桌面开发说明](apps/desktop/README.md) |
| `packages/format/` | ChalkLee 文档格式、归档与校验 |
| `packages/word/` | DOC／DOCX 解析与预览排版 |
| `templates/plugin/` | 插件模板 |
| `docs/` | 文档格式、外部 AI 应用连接与插件接口说明 |

应用可以依赖 `packages/` 中的处理库，处理库不依赖应用代码。开发、测试和构建只依赖本仓库，不引用仓库外的资源。

## 编写约定

- 界面文字面向老师，用老师能看懂的中文描述步骤和状态，不出现“Agent”“MCP”等技术说法。
- 颜色只用 `theme/` 映射出的语义变量，跟随浅色、深色和主题色；图标使用 lucide；下拉选择复用 `AppSelect`。
- 涉及保存、覆盖、移动和删除的操作，先保存正在编辑的内容，不覆盖已有文件，重名时另存副本或报错。
- 更改文档格式时，同步更新 [文档格式说明](docs/chalklee-format.md) 和 `packages/format/schema/` 中的 JSON Schema。

## 测试

按改动的影响范围选择测试：

```bash
npm run test:desktop -- workspace/mutations   # 只运行相关测试
npm test                                      # 全部测试
npm run build                                 # 类型检查与桌面构建
```

`build` 已包含类型检查，不必另外运行。涉及保存、覆盖、移动、删除、版本恢复或撤销时，请验证内容不丢失、冲突时不覆盖、失败后能恢复。

测试使用合成样本，不需要真实的模型凭据，也不需要安装外部 AI 命令行工具。必须使用第三方样本时，请注明来源和许可。

## 提交代码

- 一个 Pull Request 解决一个问题，附上必要的测试和文档；改动界面时附上截图。
- 提交标题使用英文 `type(scope): description`，范围可省略，类型为 `feat`、`fix`、`refactor`、`perf`、`docs`、`test`、`build`、`ci` 或 `chore`，例如 `fix(desktop): preserve unsaved content when switching documents`。正文按需说明问题、最终行为和验证方式。
- 合并前把零碎的修补提交整理好，每条提交都能单独审阅。
- 不要提交真实教学资料、凭据、个人工具配置和运行日志。
- 写插件不需要修改本仓库，见 [ChalkLee 插件](docs/plugin-api.md)。内置的待办、日历和插件模板也在本仓库修改，由维护者同步到 [chalklee-plugins](https://github.com/seven0x16/chalklee-plugins)。

## 许可证

ChalkLee 以 AGPL-3.0-only 开源，同时提供商业授权，见 [NOTICE](NOTICE)。

- 外部贡献在合并前需要签署贡献者许可协议（CLA）：你保留著作权，同时授权本项目以 AGPL 和其他许可证（包括商业授权）发布你的贡献。
- 新增依赖须允许在闭源软件中使用，例如 MIT、BSD、ISC、Apache-2.0；不要引入只提供 GPL、AGPL 等许可证的依赖。
- 实际使用的第三方代码和素材须保留许可证与来源声明。
