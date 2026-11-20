import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PLUGIN_EXTENSION } from "../src/shared/plugins/manifest";
import { pluginSourceProblems, readPluginFolder, writePluginPackage } from "../src/main/plugins/package";

const [command, folder, output] = process.argv.slice(2).filter(argument => argument !== "--");

async function main() {
  if (!folder || (command !== "check" && command !== "pack")) throw new Error("用法：npm run plugin -- check <插件文件夹>，或 pack <插件文件夹> [输出文件]");
  const contents = await readPluginFolder(folder);
  const problems = pluginSourceProblems(contents);
  if (problems.length) throw new Error(problems.join("\n"));
  const { id, name, version, permissions } = contents.manifest;
  console.log(`${name} ${version}：${contents.files.size} 个文件，${(contents.bytes / 1024).toFixed(1)} KB，权限：${permissions.join("、") || "无"}`);
  if (command === "check") return;
  const file = path.resolve(output ?? `${id}-${version}.${PLUGIN_EXTENSION}`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, await writePluginPackage(contents));
  console.log(`已打包：${file}`);
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
