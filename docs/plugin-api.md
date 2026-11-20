# ChalkLee 插件

插件是运行在 ChalkLee 插件中心里的网页小工具，放独立的工作流程，比如点名、细目表、课表。插件不能嵌入编辑器，也不能改变文档格式：删除插件后，所有文档照常打开。

## 开始

1. 复制 [chalklee-plugins](https://github.com/seven0x16/chalklee-plugins) 仓库中的 [`template/`](https://github.com/seven0x16/chalklee-plugins/tree/main/template)，改好 `plugin.json`。文件夹里的 `AGENTS.md` 告诉 AI 编程工具该怎么写。完整的例子可以看同一仓库中的[待办](https://github.com/seven0x16/chalklee-plugins/tree/main/todo)和[日历](https://github.com/seven0x16/chalklee-plugins/tree/main/calendar)。这些示范都使用 MIT 许可证；只通过本文接口与 ChalkLee 交互的插件可以自选许可证，不受 ChalkLee 的 AGPL 约束，见 [NOTICE](../NOTICE)。
2. 在 ChalkLee 中进入插件中心，右键“导入插件”，选“打开开发中的插件文件夹”。保存文件后页面自动刷新。
3. 检查并打包：

```bash
npm run plugin -- check path/to/my-plugin
npm run plugin -- pack path/to/my-plugin
```

打包得到一个 `.chalkleeplugin` 文件，发给同事后拖进插件中心即可安装。放在 GitHub 上时，把这个文件上传到仓库的 Release，在 README 中给出下载链接；GitHub 页面上的源码 ZIP 不能直接安装。

也可以直接在 ChalkLee 里说“帮我做一个插件”，由 ChalkLee AI 写好，你试用满意后安装。

## 包格式

`.chalkleeplugin` 是 zip 文件，根目录放 `plugin.json` 和网页文件。上限为 500 个文件、解压后 50 MB。支持网页、样式、脚本、JSON、图片、字体和音视频文件，以及不带扩展名的 `LICENSE`、`README` 等说明文件。`chalklee-plugin.js` 由应用提供，包里不能有同名文件。

`plugin.json` 不接受表外的字段，写错字段名时会报错。字段定义见 [JSON Schema](plugin-manifest.schema.json)，在 `$schema` 中引用后，编辑器和 AI 工具都能据此检查。

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | 是 | 写成“发布者.插件名”，如 `li-laoshi.random-picker`，发布后不再改动 |
| `publisher` | 是 | 发布者标识，小写字母、数字和连字符，与 `id` 的前半段相同。`chalklee` 留给内置插件 |
| `name` | 是 | 名称，40 字以内 |
| `version` | 是 | 三段数字，如 `1.0.0` |
| `apiVersion` | 是 | 接口版本，当前为 `1` |
| `summary` | 是 | 一句话说明，80 字以内 |
| `author` | 是 | 显示给老师的作者名 |
| `entry` | 否 | 入口页面，默认 `index.html` |
| `description` | 否 | 详细说明 |
| `license` | 否 | 许可证名称，如 `MIT` |
| `repository` | 否 | 源码地址，需为 https |
| `permissions` | 否 | 需要的权限，默认为空 |

## 运行环境

插件在沙箱中运行，彼此隔离，也与应用隔离：

- 不能联网。外部请求、外部资源、跳转和弹窗都会被拦截。
- 只能加载自己包里的文件。
- 不能使用 `localStorage`、Cookie 和内嵌 frame。

同一个 `id` 再次导入就是更新，保存的数据保留。作者不同时，确认框会提醒老师。内置插件（发布者 `chalklee`）的文件导入时恢复应用自带的那一份，文件里的内容不会被安装；比应用自带的更新的版本需要先更新 ChalkLee。

## 接口

页面加载时 `window.chalklee` 已经可用，所有方法都返回 Promise，失败时的错误信息可以直接显示给老师。

### 保存数据

不需要权限。数据随工作区保存在 `.chalklee/plugins/<id>/`，每个插件上限 5 MB，分享插件时不会带走。

```js
await chalklee.storage.set("班级", ["七年级（2）班"]);
await chalklee.storage.get("班级");   // 没有时为 null
await chalklee.storage.remove("班级");
await chalklee.storage.keys();
```

### 文档

| 方法 | 权限 | 说明 |
|---|---|---|
| `document.current()` | `document.read` | 当前文档的 `name` 和 `path`，没有时为 `null` |
| `document.questions({ query, limit, offset })` | `document.read` | 当前文档的题目 |
| `document.show(questionId)` | `document.read` | 打开当前文档并定位到题目 |
| `document.open(path, questionId)` | `document.read` | 打开工作区里的文档，`questionId` 可省略 |
| `document.create({ name, blocks })` | `document.create` | 新建 ChalkLee，重名不覆盖 |

`questions` 返回 `{ total, truncated, questions }`，每道题含 `id`、`parentId`、`number`、`section`、`text`、`kind`、`score`、`difficulty` 和 `tags`。公式在 `text` 中写作 `$LaTeX$`。

### 题库与选题篮

| 方法 | 权限 | 说明 |
|---|---|---|
| `bank.search({ query, year, grade, type, difficulty, tags, limit })` | `question-bank.read` | 搜索当前工作区的题库 |
| `basket.add([{ path, questionId }])` | `basket.write` | 加入选题篮 |

### ChalkLee AI

| 方法 | 权限 | 说明 |
|---|---|---|
| `assistant.draft(text)` | `assistant.draft` | 把一段话填进 ChalkLee AI 输入框，由老师看过后发送 |

### 保存文件

不需要权限。弹出保存窗口，由老师选择位置，返回是否保存。只能在老师点击插件里的按钮后调用，否则会报错。

```js
await chalklee.files.save("七年级（2）班成绩.csv", "姓名,分数\n小明,90");
await chalklee.files.save("细目表.xlsx", blob);   // Blob、ArrayBuffer、Uint8Array 都可以
```

文件名须带扩展名，可用 `txt`、`csv`、`tsv`、`json`、`xml`、`ics`、`pdf`、`docx`、`xlsx`、`pptx`、`png`、`jpg`、`jpeg`、`gif`、`webp`、`svg`，单个文件上限 20 MB。以文字保存的 CSV、TSV 会自动加上 UTF-8 标记，Excel 打开时中文不乱码。不能保存到工作区的 `.chalklee/` 文件夹。

### 外观

页面可以直接使用这些颜色变量，它们随浅色和深色变化：`--chalklee-background`、`--chalklee-surface`、`--chalklee-text`、`--chalklee-muted`、`--chalklee-border`、`--chalklee-accent`、`--chalklee-on-accent`、`--chalklee-hover`、`--chalklee-selection`、`--chalklee-danger`。

`chalklee.theme` 是当前外观，`chalklee.onThemeChange(listener)` 监听变化。

## 权限

权限在安装时列给老师，由老师一次批准。更新时新增的权限会单独标出。

| 权限 | 老师看到的说法 |
|---|---|
| `document.read` | 读取当前打开的文档 |
| `document.create` | 新建文档 |
| `question-bank.read` | 搜索这个工作区的题库 |
| `basket.write` | 把题目加入选题篮 |
| `assistant.draft` | 请 ChalkLee AI 帮忙 |

插件读不到 API Key 和其他配置、`.chalklee/` 内部文件、其他插件的数据，也不能修改已有文档或删除文件。
