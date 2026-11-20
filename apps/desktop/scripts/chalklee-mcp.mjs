// Compatibility entry for existing development-client configurations.
// The bridge is built and distributed with the ChalkLee desktop application.
try {
  await import("../out/main/mcp-bridge.js");
} catch (error) {
  process.stderr.write(`ChalkLee MCP 桥接启动失败：${error.message}。请先运行 npm run build:desktop。\n`);
  process.exitCode = 1;
}
