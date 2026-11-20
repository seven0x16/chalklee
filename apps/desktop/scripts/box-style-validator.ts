import { resolve } from "node:path";
import standaloneCode from "ajv/dist/standalone/index.js";
import { normalizePath, type Plugin } from "vite";
import { BOX_STYLE_SCHEMA_REF, createChalkLeeSchemaCompiler } from "../../../packages/format/src/schema";

/** Generate the validator used by the main process when reading or saving a box style. */
export function precompileBoxStyleValidator(): Plugin {
  const validatorPath = normalizePath(resolve("../../packages/format/src/boxStyleSchema.ts"));
  return {
    name: "chalklee-box-style-validator",
    apply: "build",
    enforce: "pre",
    load(id) {
      if (id !== validatorPath) return;
      const code = standaloneCode(createChalkLeeSchemaCompiler(true), { isChalkLeeBoxStyleShape: BOX_STYLE_SCHEMA_REF })
        .replaceAll('require("ajv/dist/runtime/ucs2length").default', "unicodeLength");
      if (/\brequire\(/.test(code)) throw new Error("The box style validator has an unsupported runtime import.");
      return `import unicodeLength from "ajv/dist/runtime/ucs2length.js";\n${code}`;
    }
  };
}
