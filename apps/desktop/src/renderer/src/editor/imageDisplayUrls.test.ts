import { Fragment, Schema } from "@tiptap/pm/model";
import { parseHTML } from "linkedom";
import { describe, expect, it, vi } from "vitest";
import { createChalkLeeImageClipboardSerializer, createChalkLeeImageDisplayUrls } from "./imageDisplayUrls";

describe("image display URLs", () => {
  it("shares the original image bytes and releases the URL with the editor", async () => {
    const images = createChalkLeeImageDisplayUrls();
    const source = "data:image/png;base64,AQID";
    const url = images.get(source);
    try {
      expect(url).toMatch(/^blob:/);
      expect(images.get(source)).toBe(url);
      const response = await fetch(url);
      expect(response.headers.get("content-type")).toBe("image/png");
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    } finally { images.clear(); }
    await expect(fetch(url)).rejects.toThrow();
  });

  it("preserves other sources and embedded formats the browser handles directly", () => {
    const images = createChalkLeeImageDisplayUrls();
    const sources = ["https://example.com/picture.png", "data:image/svg+xml,%3Csvg%2F%3E", "data:image/png;base64,%"];
    expect(sources.map(source => images.get(source))).toEqual(sources);
  });

  it("shares the display URL created straight from an asset and revokes it on close", async () => {
    const read = vi.fn(() => ({ data: new Uint8Array([4, 5, 6]), mediaType: "image/png" }));
    const images = createChalkLeeImageDisplayUrls(read);
    const url = images.getAsset("picture")!;
    try {
      expect(images.getAsset("picture")).toBe(url);
      expect(read).toHaveBeenCalledTimes(1);
      const response = await fetch(url);
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([4, 5, 6]));
    } finally { images.clear(); }
    await expect(fetch(url)).rejects.toThrow();
  });
});

it("embeds referenced images for copying and carries pasted sources through as supplied", () => {
  const { document } = parseHTML("<html></html>");
  const schema = new Schema({ nodes: {
    doc: { content: "picture*" }, text: {},
    picture: {
      attrs: { assetId: {}, src: { default: null } },
      toDOM: node => ["figure", { "data-chalklee-image": "", "data-asset-id": node.attrs.assetId }, ["img", { src: node.attrs.src }]]
    }
  } });
  const picture = (assetId: string, src?: string) => schema.nodes.picture.create({ assetId, src });
  const content = Fragment.fromArray([picture("paper"), picture("paper"), picture("paper", "data:image/png;base64,/w=="), picture("missing")]);
  const read = vi.fn((id: string) => id === "paper" ? { mediaType: "image/png", data: new Uint8Array([1, 2, 3]) } : undefined);
  const serializer = createChalkLeeImageClipboardSerializer(schema, read);
  const copied = serializer.serializeFragment(content, { document });
  expect(Array.from(copied.querySelectorAll("img"), image => image.getAttribute("src"))).toEqual([
    "data:image/png;base64,AQID", "data:image/png;base64,AQID", "data:image/png;base64,/w==", null
  ]);
  expect(read.mock.calls).toEqual([["paper"], ["missing"]]);
  expect(content.firstChild?.attrs.src).toBeNull();
});
