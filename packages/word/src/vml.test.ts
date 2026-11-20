import { describe, expect, it } from "vitest";
import { child, descendants, readXml } from "./xml";
import { readVmlGraphic } from "./vml";
const pict = (content: string) => child(readXml(`<w:pict xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:v="urn:schemas-microsoft-com:vml">${content}</w:pict>`), "pict")!;
const frame = '<v:group style="position:absolute;margin-left:0pt;margin-top:11.8617pt;mso-position-horizontal-relative:text;mso-position-vertical-relative:text;width:166pt;height:35.5pt;z-index:251658240" coordsize="3320,710" filled="false" stroked="false"><v:shape style="left:0;top:0;width:3320;height:710" coordsize="3320,710" path="m,l0,709l3319,709l3319,0e" filled="false" strokeweight="0.25pt"><v:stroke joinstyle="miter"/></v:shape><v:shape style="left:0;top:0;width:3320;height:0" coordsize="3320,0" path="m3319,0l0,0e" filled="false" strokeweight="0.50pt"/></v:group>';

describe("VML straight-shape graphics", () => {
  it("restores grouped frame strokes, including omitted zeros and a zero-height top rule, without moving source text", () => {
    const source = pict(frame), before = JSON.stringify(source), graphic = readVmlGraphic(source)!;
    expect(graphic).toMatchObject({ floating: true, behind: false, order: 251658240, x: { relative: "column" }, y: { relative: "paragraph" } });
    expect(graphic.width).toBeCloseTo(222); expect(graphic.height).toBeCloseTo(48);
    expect(graphic.x.offset).toBeCloseTo(-1 / 3); expect(graphic.y.offset).toBeCloseTo(11.8617 * 4 / 3 - 1 / 3);
    const svg = readXml(new TextDecoder().decode(graphic.bytes)), paths = descendants(svg, "path");
    expect(paths.map(p => p.attrs.d)).toEqual(["M0 0 L0 47.26667 L221.26667 47.26667 L221.26667 0", "M221.26667 0 L0 0"]);
    expect(paths.map(p => p.attrs["stroke-width"])).toEqual(["0.33333", "0.66667"]);
    expect(paths.every(p => p.attrs.fill === "none")).toBe(true);
    expect(JSON.stringify(source)).toBe(before);
  });

  it("composes nested group origins and relative line commands without scaling the physical pen width", () => {
    const source = pict('<v:group style="position:absolute;width:100px;height:50px;margin-left:-2pt" coordsize="1000,500" coordorigin="100,50"><v:group style="left:200;top:100;width:400;height:200" coordsize="40,20"><v:shape style="left:0;top:0;width:40;height:20" coordsize="40,20" path="m0,0r40,0,0,20xe" filled="false" strokeweight="1pt"/></v:group></v:group>');
    const graphic = readVmlGraphic(source)!, paths = descendants(readXml(new TextDecoder().decode(graphic.bytes)), "path");
    expect(paths[0]!.attrs.d).toBe("M10 5 L50 5 L50 25 Z");
    expect(paths[0]!.attrs["stroke-width"]).toBe("1.33333");
    expect(graphic.x.offset).toBeCloseTo(-10 / 3);
  });

  it("handles plain inline rectangles and page-relative floating frames as inert SVG only", () => {
    const source = pict('<v:rect style="width:20pt;height:10pt" filled="false" strokeweight="1px" strokecolor="#123456"/>');
    const inline = readVmlGraphic(source)!; expect(inline.floating).toBe(false);
    expect(descendants(readXml(new TextDecoder().decode(inline.bytes)), "path")[0]!.attrs.stroke).toBe("#123456");
    const positioned = readVmlGraphic(pict('<v:rect style="position:absolute;width:20pt;height:10pt;margin-top:-3pt;mso-position-horizontal-relative:page;mso-position-vertical-relative:page;z-index:-1" filled="false"/>'))!;
    expect(positioned).toMatchObject({ behind: true, x: { relative: "page" }, y: { relative: "page" } });
    expect(positioned.y.offset).toBeLessThan(-4);
  });

  it("rejects unsupported geometry/effects and external or executable values rather than emitting source markup", () => {
    for (const content of [frame.replace('m,l0,709l3319,709l3319,0e', 'm0,0c1,2,3,4,5,6e'), frame.replace('m,l0,709l3319,709l3319,0e', 'm@0,0l10,10e'), frame.replace('strokeweight="0.25pt"', 'strokecolor="url(https://example.com/x)"'), frame.replace('position:absolute', 'position:absolute;rotation:90'), '<v:shape style="width:100px;height:50px"><v:imagedata src="https://example.com/x"/></v:shape>']) {
      expect(readVmlGraphic(pict(content))).toBeUndefined();
    }
    expect(readVmlGraphic(pict(frame.replace('width:166pt', 'width:100000pt')))).toBeUndefined();
  });
});
