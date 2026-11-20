import { describe, expect, it } from "vitest";
import type { DocumentVersion } from "../../../shared/document/versions";
import { versionDay, versionGroups } from "./DocumentVersions";

describe("version history list", () => {
  const now = new Date(2026, 9, 17, 15).getTime();
  const at = (days: number, hours = 0) => new Date(2026, 9, 17 - days, 15 - hours).getTime();
  it("names days the way a teacher reads them", () => {
    expect(versionDay(at(0, 3), now)).toBe("今天");
    expect(versionDay(at(1), now)).toBe("昨天");
    expect(versionDay(at(2), now)).toBe("10月15日");
    expect(versionDay(new Date(2025, 11, 30).getTime(), now)).toBe("2025年12月30日");
  });
  it("groups versions by day, newest first", () => {
    const version = (id: string, createdAt: number): DocumentVersion => ({ id, createdAt, reason: "edit", label: "编辑中的版本", file: "a.chalklee", size: 1, questionCount: 0 });
    expect(versionGroups([version("a", at(0)), version("b", at(0, 2)), version("c", at(1))], now).map(group => [group.day, group.versions.map(item => item.id)]))
      .toEqual([["今天", ["a", "b"]], ["昨天", ["c"]]]);
  });
});
