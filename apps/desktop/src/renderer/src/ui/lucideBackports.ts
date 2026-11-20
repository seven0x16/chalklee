import { createLucideIcon } from "lucide-react";

// Icons from lucide-static 1.59.0 (ISC) that the installed lucide-react 0.468 predates.
// Swap each for the lucide-react export of the same name after upgrading.

export const Tags = createLucideIcon("Tags", [
  ["path", { d: "M13.172 2a2 2 0 0 1 1.414.586l6.71 6.71a2.4 2.4 0 0 1 0 3.408l-4.592 4.592a2.4 2.4 0 0 1-3.408 0l-6.71-6.71A2 2 0 0 1 6 9.172V3a1 1 0 0 1 1-1z", key: "front" }],
  ["path", { d: "M2 7v6.172a2 2 0 0 0 .586 1.414l6.71 6.71a2.4 2.4 0 0 0 3.191.193", key: "back" }],
  ["circle", { cx: "10.5", cy: "6.5", r: ".5", fill: "currentColor", key: "dot" }]
]);

export const TagPlus = createLucideIcon("TagPlus", [
  ["path", { d: "M16 13h6", key: "plus-h" }],
  ["path", { d: "m16.5 6.5-3.914-3.914A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l1.79-1.79", key: "body" }],
  ["path", { d: "M19 10v6", key: "plus-v" }],
  ["circle", { cx: "7.5", cy: "7.5", r: ".5", fill: "currentColor", key: "dot" }]
]);

export const ListChevronsUpDown = createLucideIcon("ListChevronsUpDown", [
  ["path", { d: "M3 5h8", key: "line-1" }],
  ["path", { d: "M3 12h8", key: "line-2" }],
  ["path", { d: "M3 19h8", key: "line-3" }],
  ["path", { d: "m15 8 3-3 3 3", key: "up" }],
  ["path", { d: "m15 16 3 3 3-3", key: "down" }]
]);

export const ListChevronsDownUp = createLucideIcon("ListChevronsDownUp", [
  ["path", { d: "M3 5h8", key: "line-1" }],
  ["path", { d: "M3 12h8", key: "line-2" }],
  ["path", { d: "M3 19h8", key: "line-3" }],
  ["path", { d: "m15 5 3 3 3-3", key: "down" }],
  ["path", { d: "m15 19 3-3 3 3", key: "up" }]
]);

export const DatabaseSearch = createLucideIcon("DatabaseSearch", [
  ["path", { d: "M21 11.693V5", key: "right" }],
  ["path", { d: "m22 22-1.875-1.875", key: "handle" }],
  ["path", { d: "M3 12a9 3 0 0 0 8.697 2.998", key: "middle" }],
  ["path", { d: "M3 5v14a9 3 0 0 0 9.28 2.999", key: "body" }],
  ["circle", { cx: "18", cy: "18", r: "3", key: "lens" }],
  ["ellipse", { cx: "12", cy: "5", rx: "9", ry: "3", key: "top" }]
]);
