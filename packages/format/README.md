# @chalklee/format

ChalkLee 文档格式：类型定义、归档读写、JSON Schema 与语义校验、规范化和文档样式检查。桌面应用通过 `@chalklee/format` 使用这些能力，本包不依赖应用代码。

```bash
npm run typecheck -w @chalklee/format
```

格式说明见 [ChalkLee 文档格式](../../docs/chalklee-format.md)，机器可读定义位于 [`schema/`](schema/)。格式、归档往返与编辑回归由桌面应用的相关测试覆盖，可在仓库根目录执行 `npm test`。
