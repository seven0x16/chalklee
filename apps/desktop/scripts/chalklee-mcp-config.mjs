import path from "node:path";
import { fileURLToPath } from "node:url";

const bridge = fileURLToPath(new URL("../out/main/mcp-bridge.js", import.meta.url));
const args = [bridge];
const connectionIndex = process.argv.indexOf("--connection");
if (connectionIndex >= 0) args.push("--connection", path.resolve(process.argv[connectionIndex + 1]));
process.stdout.write(JSON.stringify({ mcpServers: { chalklee: { command: process.execPath, args } } }, null, 2) + "\n");
