import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import schema from "../schema/document.schema.json";

const FRAGMENT_SCHEMA_ID = `${schema.$id}/import-fragment`;
export const BOX_STYLE_SCHEMA_REF = `${schema.$id}#/$defs/boxStyle`;
let compiler: Ajv2020 | undefined;
let documentValidator: ValidateFunction | undefined;
let fragmentValidator: ValidateFunction | undefined;

export function createChalkLeeSchemaCompiler(standalone = false) {
  // Only the bundled schemas enter this registry. The schema tests validate
  // both definitions against the metaschema.
  return addFormats(new Ajv2020({
    allErrors: true, strict: false, validateSchema: false,
    code: { source: standalone, esm: standalone }
  })).addSchema(schema);
}

export function getChalkLeeSchemaCompiler() {
  return compiler ??= createChalkLeeSchemaCompiler();
}

// A fragment is part of a document still being assembled: its question
// regions may be empty until the remaining content arrives.
export function createChalkLeeFragmentSchema() {
  const fragment = structuredClone(schema);
  fragment.$id = FRAGMENT_SCHEMA_ID;
  for (const type of ["question", "questionGroup"] as const) {
    const content = fragment.$defs[type].properties.content;
    content.minItems = 1;
    for (const rule of content.allOf) rule.minContains = 0;
  }
  for (const type of ["questionStem", "questionMaterial", "subQuestionList"] as const) fragment.$defs[type].properties.content.minItems = 0;
  return fragment;
}

const describeError = (error: ErrorObject, prefix = "") => {
  const detail = error.keyword === "additionalProperties" ? `不允许属性 ${error.params.additionalProperty}`
    : error.keyword === "required" ? `缺少属性 ${error.params.missingProperty}`
      : error.keyword === "enum" ? `只能是 ${(error.params.allowedValues as unknown[]).join("、")}` : error.message;
  return `${prefix}${error.instancePath}: ${detail}`;
};

/**
 * Block content is a oneOf over node types, so the raw errors list a mismatch
 * for every alternative and can name an unrelated attribute. Re-check each typed
 * node on the failing paths against its own definition and explain the deepest
 * one that fails: either its own attributes, or a child that is valid by itself
 * but not allowed in that place.
 */
function explainSchemaErrors(ajv: Ajv2020, document: unknown, errors: ErrorObject[], schemaId: string): string[] {
  let deepest: { path: string; node: any; errors: ErrorObject[] } | null = null;
  const checked = new Set<string>();
  for (const error of errors) {
    const parts = error.instancePath.split("/").slice(1);
    let node: any = document;
    for (let depth = 0; depth <= parts.length && node && typeof node === "object"; node = node[parts[depth++]]) {
      const path = parts.slice(0, depth).map(part => `/${part}`).join("");
      if (checked.has(path) || typeof node.type !== "string") continue;
      checked.add(path);
      const own = ajv.getSchema(`${schemaId}#/$defs/${node.type === "text" ? "textNode" : node.type}`);
      if (own && !own(node) && (!deepest || depth > deepest.path.split("/").length - 1)) deepest = { path, node, errors: own.errors ?? [] };
    }
  }
  if (!deepest) return [];
  const { path, node } = deepest;
  const misplaced = new Set<string>();
  return deepest.errors.filter(error => !["anyOf", "oneOf"].includes(error.keyword)).flatMap(error => {
    // Errors inside a typed child come from trying it against each alternative.
    let child: { path: string; type: string } | null = null, value: any = node, childPath = "";
    for (const part of error.instancePath.split("/").slice(1)) {
      value = value?.[part]; childPath += `/${part}`;
      if (typeof value?.type === "string") { child = { path: childPath, type: value.type }; break; }
    }
    if (!child) return [describeError(error, path)];
    if (misplaced.has(child.path)) return [];
    misplaced.add(child.path);
    return [`${path}${child.path}: ${node.type} 中不能放 ${child.type}${child.type === "heading" ? "，标题请作为独立块放在题目之外" : ""}`];
  });
}

/**
 * Checks a document against the JSON Schema and returns readable messages, at
 * most five. A fragment may still have empty question regions.
 */
export function chalkLeeSchemaErrors(document: unknown, { fragment = false }: { fragment?: boolean } = {}): string[] {
  const ajv = getChalkLeeSchemaCompiler();
  const check = fragment ? (fragmentValidator ??= ajv.compile(createChalkLeeFragmentSchema())) : (documentValidator ??= ajv.compile(schema));
  if (check(document)) return [];
  const explained = explainSchemaErrors(ajv, document, check.errors ?? [], fragment ? FRAGMENT_SCHEMA_ID : schema.$id);
  const specific = check.errors?.filter(error => !["anyOf", "oneOf", "const", "additionalProperties", "required", "type"].includes(error.keyword)) ?? [];
  const errors = explained.length ? explained : (specific.length ? specific : check.errors?.filter(error => !["anyOf", "oneOf"].includes(error.keyword)) ?? []).map(error => describeError(error));
  return [...new Set(errors)].slice(0, 5);
}
