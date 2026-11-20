# @chalklee/word

ChalkWord 读取 DOC／DOCX，生成供只读预览使用的文档模型，并在浏览器中排版分页。桌面应用的 Word 预览及 DOC／DOCX 转换都使用此模型；转换时由应用整理为 ChalkLee 的原稿内容引用。本包不依赖应用代码，对外接口见 `src/index.ts`。

## 模块

- `load.ts`、`worker.ts`：在 Web Worker 中解析原稿。
- `docx.ts`、`xml.ts`：DOCX 包、关系、样式、正文、编号、表格和图片。
- `doc.ts`、`docImages.ts`、`compound.ts`：二进制 DOC、OfficeArt 配图与复合文件读取。
- `model.ts`：文字、段落、表格、分节、浮动对象与图片资源。
- `math.ts`：预览中的 OMML 显示；`latex.ts`：转换中的 OMML 公式提取。
- `mathtype.ts`、`mtef.ts`：读取嵌入的 Equation Native 数据及受支持的 MTEF v5 公式。
- 其余模块负责分页、文字测量、表格布局与图片格式处理。

## 内容保留与限制

解析只读，不执行嵌入对象，不加载外部图片，不写回原文件；复合文件、ZIP 与 XML 读取有大小或结构边界检查。预览尽量保留原稿的显示尺寸、分节、页眉页脚与浮动位置，不保证所有 Word 排版特性都能完全还原。无法显示的图片保留原位置占位。

DOCX 转换保留正文、基础格式、编号、合并单元格、图片及受支持的 OMML／MathType 公式。无法可靠解析的旧公式优先保留原稿附带的预览图；缺少可用图像时标记待核对。转换不保留固定分页和浮动定位；嵌套表格按单元格顺序保留内容并提示检查，页眉页脚、脚注尾注及未支持对象也可能需要对照原稿补充。

DOC 转换保留已解析的正文、基础格式、列表编号、表格、段落内配图与浮动配图。图片读取 PNG、JPEG、DIB 及可可靠转换的 WMF；保留图片尺寸、裁剪、镜像和旋转。浮动配图按正文锚点顺序参与转换，暂不还原文字环绕。嵌入公式从对应 ObjectPool 存储读取 Equation Native，复用受支持的 MTEF v5 解码；预览默认使用公式原图，转换设置 `includeEquations: true` 时提取可编辑公式。解析失败的公式优先保留预览图；未支持的矢量图、复杂绘图或缺失对象在对应位置保留待核对标记及提醒。页眉页脚、脚注与批注等限制也会保留提醒。原稿字节保持不变，不执行嵌入对象。

## 验证

在仓库根目录运行：

```bash
npx vitest run packages/word
npm run typecheck -w @chalklee/word
```

测试使用内联合成 DOCX／公式数据及 `test-fixtures/sample.doc`，覆盖内容提取、损坏输入、取消和原稿字节不变等行为，不依赖个人样本。
