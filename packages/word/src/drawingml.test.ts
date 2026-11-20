import { describe, expect, it } from "vitest";
import { readDrawingShapes } from "./drawingml";
import { createThemeResolver } from "./theme";
import { child, descendants, readXml } from "./xml";

const theme = createThemeResolver(readXml('<a:theme xmlns:a="urn:a"><a:themeElements><a:clrScheme><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:accent3><a:srgbClr val="FFCC00"/></a:accent3></a:clrScheme></a:themeElements></a:theme>'), undefined);
const anchor = (body: string, width = 952500, height = 952500) => child(readXml(`<wp:anchor xmlns:wp="urn:wp" xmlns:a="urn:a" xmlns:wps="urn:wps" xmlns:wpg="urn:wpg" xmlns:w="urn:w"><wp:extent cx="${width}" cy="${height}"/><a:graphic><a:graphicData>${body}</a:graphicData></a:graphic></wp:anchor>`), "anchor")!;
const rect = (paint: string, other = "", geometry = "rect") => `<wps:wsp><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm><a:prstGeom prst="${geometry}"><a:avLst/></a:prstGeom>${paint}<a:ln><a:noFill/></a:ln></wps:spPr>${other}</wps:wsp>`;

describe("DrawingML shape decorations", () => {
  it("renders a right brace with bounded preset adjustments and an uncropped physical stroke", () => {
    const node = anchor('<wps:wsp><wps:spPr><a:prstGeom prst="rightBrace"><a:avLst><a:gd name="adj1" fmla="val 8333"/><a:gd name="adj2" fmla="val 25000"/></a:avLst></a:prstGeom><a:noFill/><a:ln w="12700"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:ln></wps:spPr></wps:wsp>', 95250, 381000);
    const original = structuredClone(node), shape = readDrawingShapes(node, theme)![0]!, svg = readXml(new TextDecoder().decode(shape.decoration)), paths = descendants(svg, "path");
    expect(shape.width).toBeCloseTo(10 + 4 / 3); expect(shape.height).toBeCloseTo(40 + 4 / 3);
    expect(shape.left).toBeCloseTo(-2 / 3); expect(shape.top).toBeCloseTo(-2 / 3);
    expect(paths).toHaveLength(1); expect(paths[0]!.attrs.fill).toBe("none");
    expect(paths[0]!.attrs.stroke).toBe("#000000"); expect(Number(paths[0]!.attrs["stroke-width"])).toBeCloseTo(4 / 3);
    expect(paths[0]!.attrs.d).toContain("10 10"); // adjusted waist at one quarter of the height
    expect(node).toEqual(original);
    expect(readDrawingShapes(anchor('<wps:wsp><wps:spPr><a:prstGeom prst="rightBrace"><a:avLst><a:gd name="adj1" fmla="*/ w 1 2"/></a:avLst></a:prstGeom><a:solidFill><a:srgbClr val="123456"/></a:solidFill><a:ln><a:noFill/></a:ln></wps:spPr></wps:wsp>'), theme)).toBeUndefined();
  });

  it("restores a solid cover mask without inventing a picture reference or modifying the source", () => {
    const node = anchor(rect('<a:solidFill><a:srgbClr val="EBEB03"/></a:solidFill>')), original = structuredClone(node);
    const shapes = readDrawingShapes(node, theme)!;
    expect(shapes).toHaveLength(1); expect(shapes[0]).toMatchObject({ left: 0, top: 0, width: 100, height: 100 });
    const svg = readXml(new TextDecoder().decode(shapes[0]!.decoration));
    expect(descendants(svg, "rect")[0]!.attrs.fill).toBe("#EBEB03");
    expect(descendants(svg, "image")).toEqual([]); expect(node).toEqual(original);
  });

  it("maps nested group child offsets and extents into the anchored frame, keeping text separate", () => {
    const text = '<wps:txbx><w:txbxContent><w:p><w:r><w:t>姓名：</w:t></w:r></w:p></w:txbxContent></wps:txbx><wps:bodyPr lIns="0" rIns="0"/>';
    const node = anchor(`<wpg:wgp><wpg:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="200" cy="100"/><a:chOff x="10" y="20"/><a:chExt cx="200" cy="100"/></a:xfrm></wpg:grpSpPr><wpg:wgp><wpg:grpSpPr><a:xfrm><a:off x="110" y="45"/><a:ext cx="100" cy="50"/><a:chOff x="5" y="10"/><a:chExt cx="100" cy="50"/></a:xfrm></wpg:grpSpPr>${rect('<a:noFill/>', text).replace('x="0" y="0"', 'x="5" y="10"')}</wpg:wgp></wpg:wgp>`, 3810000, 1905000);
    const shape = readDrawingShapes(node, theme)![0]!;
    expect(shape).toMatchObject({ left: 200, top: 50, width: 200, height: 200 });
    expect(descendants(shape.textbox, "t")[0]!.text).toBe("姓名："); expect(shape.decoration).toBeUndefined();
  });

  it("retains transparent fills and theme luminance transforms on shape backgrounds", () => {
    const source = anchor(rect('<a:solidFill><a:schemeClr val="accent3"><a:lumMod val="20000"/><a:lumOff val="80000"/><a:alpha val="66000"/></a:schemeClr></a:solidFill>', "", "roundRect"));
    const shape = readDrawingShapes(source, theme)![0]!, svg = readXml(new TextDecoder().decode(shape.decoration)), box = descendants(svg, "rect")[0]!;
    expect(box.attrs.fill).toBe("#fff5cc"); expect(box.attrs["fill-opacity"]).toBe("0.66");
    expect(Number(box.attrs.rx)).toBeGreaterThan(0);
  });

  it("keeps unsupported geometry, transforms, paints and oversized groups on the compatibility path", () => {
    const fill = '<a:solidFill><a:srgbClr val="123456"/></a:solidFill>';
    for (const body of [rect(fill, "", "star5"), rect(fill).replace('<a:xfrm>', '<a:xfrm rot="60000">'), rect(fill).replace('<a:xfrm>', '<a:xfrm flipH="1">'), rect('<a:gradFill/>'), rect(fill.replace('123456', 'url(https://example.com/x)'))]) {
      expect(readDrawingShapes(anchor(body), theme)).toBeUndefined();
    }
    expect(readDrawingShapes(anchor(rect(fill), 952500000), theme)).toBeUndefined();
    const transparent = readDrawingShapes(anchor(rect('<a:noFill/>')), theme)!;
    expect(transparent[0]!.decoration).toBeUndefined();
  });
});
