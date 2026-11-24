import { createContext } from "react";
import { Extension } from "@tiptap/core";
import { DOMSerializer, type Fragment, type Schema } from "@tiptap/pm/model";
import { Plugin } from "@tiptap/pm/state";

const imageDataPrefix = /^data:(image\/[\w.+-]+);base64,/i;
const fromBase64 = (Uint8Array as typeof Uint8Array & { fromBase64?(value: string): Uint8Array<ArrayBuffer> }).fromBase64;

/** False where a picture's bytes cannot change, as on a question library card: no crop or replace there. */
export const ChalkLeeImagePictureEditingContext = createContext(true);

export type ChalkLeeImageAsset = { mediaType: string; data: Uint8Array };
type ReadImageAsset = (id: string) => ChalkLeeImageAsset | undefined;

export function imageAssetDataUrl(asset: ChalkLeeImageAsset) {
  return `data:${asset.mediaType};base64,${base64(asset.data)}`;
}

export function base64(data: Uint8Array) {
  const nativeEncode = (data as Uint8Array & { toBase64?: () => string }).toBase64;
  if (nativeEncode) return nativeEncode.call(data);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < data.length; offset += chunkSize) {
    binary += String.fromCharCode(...data.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

/** Share short DOM URLs. Archived images can use their verified bytes directly. */
export function createChalkLeeImageDisplayUrls(readAsset?: ReadImageAsset) {
  const urls = new Map<string, string>();
  const assets = new Map<string, string>();
  return {
    getAsset(id: string) {
      const cached = assets.get(id);
      if (cached) return cached;
      const asset = readAsset?.(id);
      if (!asset) return undefined;
      const url = URL.createObjectURL(new Blob([asset.data as BlobPart], { type: asset.mediaType }));
      assets.set(id, url);
      return url;
    },
    get(source: string) {
      const cached = urls.get(source);
      if (cached) return cached;
      const prefix = imageDataPrefix.exec(source);
      if (!prefix) return source;
      try {
        const encoded = source.slice(prefix[0].length);
        const bytes = fromBase64 ? fromBase64(encoded) : Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([bytes], { type: prefix[1] }));
        urls.set(source, url);
        return url;
      } catch { return source; }
    },
    clear() {
      for (const url of assets.values()) URL.revokeObjectURL(url);
      for (const url of urls.values()) URL.revokeObjectURL(url);
      assets.clear();
      urls.clear();
    }
  };
}

/** Embed actual image bytes when copying or dragging content out of the editor. */
export function createChalkLeeImageClipboardSerializer(schema: Schema, readAsset: ReadImageAsset): DOMSerializer {
  const serializer = DOMSerializer.fromSchema(schema);
  return new class extends DOMSerializer {
    serializeFragment(fragment: Fragment, options?: { document?: Document }, target?: HTMLElement | DocumentFragment) {
      const result = serializer.serializeFragment(fragment, options, target);
      const sources = new Map<string, string>();
      for (const image of result.querySelectorAll("[data-chalklee-image][data-asset-id] > img:not([src])")) {
        const id = image.parentElement!.getAttribute("data-asset-id")!;
        let source = sources.get(id);
        if (!source) {
          const asset = readAsset(id);
          if (!asset) continue;
          source = imageAssetDataUrl(asset);
          sources.set(id, source);
        }
        image.setAttribute("src", source);
      }
      return result;
    }
  }(serializer.nodes, serializer.marks);
}

export function chalkLeeImageClipboardExtension(readAsset: ReadImageAsset) {
  return Extension.create({
    name: "chalkLeeImageClipboard",
    addProseMirrorPlugins() {
      return [new Plugin({ props: { clipboardSerializer: createChalkLeeImageClipboardSerializer(this.editor.schema, readAsset) } })];
    }
  });
}

export const ChalkLeeImageDisplayContext = createContext<ReturnType<typeof createChalkLeeImageDisplayUrls> | null>(null);
