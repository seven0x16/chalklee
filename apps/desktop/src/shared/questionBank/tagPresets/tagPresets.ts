import index from "./data/index.json";
import type { PresetNode } from "./tagPresetMerge";

/**
 * Preset tag systems: 学科网's knowledge points and textbook chapters for the main
 * subjects of 小学, 初中 and 高中, built by `apps/desktop/scripts/build-tag-presets.mjs`. Each
 * course loads on demand.
 */
/** `file` is the course data file name under data/. */
export interface PresetCourse { id: string; file: string; stage: PresetStage; subject: string; knowledge: number; textbooks: number; versions: number }
export interface PresetTextbook { version: string; volume: string; tree: PresetNode[] }
export interface PresetCourseData { knowledge: PresetNode[]; textbooks: PresetTextbook[] }

export const PRESET_STAGES = ["小学", "初中", "高中"] as const;
export type PresetStage = typeof PRESET_STAGES[number];

export const PRESET_COURSES = index.courses as PresetCourse[];
export const PRESET_SOURCE = `${index.source} ${index.capturedAt.slice(0, 4)} 年目录`;

/** Shorter names for the subject chips; the group keeps the full course name. */
export const presetSubjectLabel = (subject: string) => subject === "生物学" ? "生物" : subject;

const loaders = import.meta.glob<PresetCourseData>(["./data/*.json", "!./data/index.json"], { import: "default" });
const loaded = new Map<string, Promise<PresetCourseData>>();

export function loadPresetCourse(id: string): Promise<PresetCourseData> {
  let pending = loaded.get(id);
  if (!pending) {
    const course = PRESET_COURSES.find(candidate => candidate.id === id);
    const load = course && loaders[`./data/${course.file}.json`];
    if (!load) return Promise.reject(new Error("没有这个学科的标签体系"));
    pending = load();
    pending.catch(() => loaded.delete(id));
    loaded.set(id, pending);
  }
  return pending;
}
