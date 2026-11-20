import { describe, expect, it, vi } from "vitest";
import { CHALKLEE_TOOLS, chalkLeeTools, toolArguments, toolJsonSchema } from "./catalog";

vi.mock("electron", () => ({ nativeImage: {} }));

const names = (surface: "assistant" | "mcp") => chalkLeeTools(surface).map(tool => tool.name).sort();
const SHARED = [
  "content_delete", "content_insert", "content_move", "content_update", "conversion_tasks", "document_create", "document_export", "document_outline", "document_preview", "document_questions",
  "document_show", "document_style_read", "document_style_update", "document_versions", "file_copy", "file_move", "file_organize", "file_trash", "html_update", "plugins",
  "question_basket", "question_insert", "question_search", "question_tags", "question_update", "workspace_create_folder", "workspace_list", "workspace_search"
];

describe("ChalkLee tool catalog", () => {
  it("gives external agents the same everyday tools as ChalkLee AI, plus their own conversion sessions and file access", () => {
    expect(names("mcp")).toEqual([...SHARED,
      "conversion_guide", "conversion_open", "crop_figures", "document_import", "document_info", "document_open", "document_read", "finish", "list_import_sessions", "preview_document",
      "read_draft", "read_source", "write_fragments"
    ].sort());
  });

  it("keeps to ChalkLee AI only what spends the app's model or belongs to the teacher's own assistant", () => {
    expect(names("assistant")).toEqual([...SHARED, "conversion_start", "memory", "web_search"].sort());
  });

  it("gives both surfaces one definition of the shared tools", () => {
    const assistant = names("assistant"), mcp = names("mcp");
    expect(assistant.filter(name => mcp.includes(name))).toEqual(SHARED);
    // Confirmation cards are the assistant's; over MCP a confirming tool is announced as destructive for the client to approve.
    for (const tool of CHALKLEE_TOOLS.filter(tool => tool.confirm && tool.surfaces.includes("mcp"))) expect(tool.kind, tool.name).toBe("destructive");
  });

  it("publishes plain JSON Schema objects that reject unknown fields", () => {
    for (const tool of CHALKLEE_TOOLS) {
      const schema = toolJsonSchema(tool);
      expect(schema.type, tool.name).toBe("object");
      expect(schema.additionalProperties, tool.name).toBe(false);
      expect(tool.label, tool.name).toBeTruthy();
    }
  });

  it("publishes source and crop boxes as fixed-length integer arrays for MCP clients", () => {
    const sessionId = "12345678-1234-4234-8234-123456789abc";
    for (const [name, field] of [["read_source", "sources"], ["crop_figures", "figures"]]) {
      const tool = chalkLeeTools("mcp").find(tool => tool.name === name)!;
      const schema = toolJsonSchema(tool) as any;
      expect(schema.properties[field].items.properties.box).toMatchObject({
        type: "array", items: { type: "integer", minimum: 0 }, minItems: 4, maxItems: 4
      });
      const item = name === "read_source" ? { unitId: "part_1" } : { unitId: "part_1", id: "figure_1", alt: "配图" };
      const args = (box: number[]) => ({ sessionId, [field]: [{ ...item, box }] });
      expect(toolArguments(tool, args([0, 0, 100, 100]))[field]).toHaveLength(1);
      for (const box of [[0, 0, 100], [0, 0, 100, 100, 100], [-1, 0, 100, 100], [0, 0.5, 100, 100]]) {
        expect(() => toolArguments(tool, args(box))).toThrow(`${name} 的参数无效`);
      }
    }
  });

  it("fills declared defaults and explains invalid arguments the same way on both surfaces", () => {
    const write = CHALKLEE_TOOLS.find(tool => tool.name === "write_fragments")!;
    const fragment = { key: "p1", order: 1, unitIds: ["page_1"], blocks: [{ type: "paragraph", text: "正文" }] };
    expect(toolArguments(write, { sessionId: "12345678-1234-4234-8234-123456789abc", expectedRevision: 1, fragments: [fragment] }).fragments)
      .toEqual([{ ...fragment, continuesPrevious: false, warnings: [] }]);
    const update = CHALKLEE_TOOLS.find(tool => tool.name === "question_update")!;
    expect(() => toolArguments(update, { path: "a.chalklee", edits: [{ questionId: "q1", patch: { attrs: { id: "x" } } }] })).toThrow("question_update 的参数无效");
    expect(toolArguments(update, { path: "a.chalklee", edits: [{ questionId: "q1", patch: { attrs: { score: null } } }] })).toMatchObject({ path: "a.chalklee" });
  });
});
