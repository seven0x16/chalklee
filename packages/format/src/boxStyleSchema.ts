import { BOX_STYLE_SCHEMA_REF, getChalkLeeSchemaCompiler } from "./schema";
import type { ValidateFunction } from "ajv/dist/2020.js";
import type { ChalkLeeBoxStyle } from "./types";

let validator: ValidateFunction<ChalkLeeBoxStyle> | undefined;

/** Check a saved box style against the document schema. Desktop builds precompile this validator. */
export function isChalkLeeBoxStyleShape(style: unknown): style is ChalkLeeBoxStyle {
  const check = validator ??= getChalkLeeSchemaCompiler().getSchema<ChalkLeeBoxStyle>(BOX_STYLE_SCHEMA_REF)!;
  return check(style) === true;
}
