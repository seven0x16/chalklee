import { DEFAULT_SIDEBAR_WIDTHS, normalizeSidebarWidths } from "./sidebarSizing";
import type { SidebarWidths } from "./sidebarSizing";
import type { RecentDocument } from "./tabs";

export const SESSION_KEY = "chalklee.session";
export const EXPANDED_KEY = "chalklee.expanded";
export const RECENT_DOCUMENTS_KEY = "chalklee.recent-documents";
export const SIDEBAR_WIDTHS_KEY = "chalklee.sidebar-widths";
export const MAX_RECENT_DOCUMENTS = 8;

export function loadSession(): { paths: string[]; activePath: string | null } {
  try {
    const parsed = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "{}") as { paths?: unknown; activePath?: unknown };
    return {
      paths: Array.isArray(parsed.paths) ? parsed.paths.filter((item): item is string => typeof item === "string") : [],
      activePath: typeof parsed.activePath === "string" ? parsed.activePath : null
    };
  } catch {
    return { paths: [], activePath: null };
  }
}

export function loadRecentDocuments(): RecentDocument[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_DOCUMENTS_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is RecentDocument => Boolean(item)
        && typeof item === "object"
        && typeof (item as RecentDocument).path === "string"
        && typeof (item as RecentDocument).openedAt === "number")
      .slice(0, MAX_RECENT_DOCUMENTS);
  } catch {
    return [];
  }
}

export function loadSidebarWidths(): SidebarWidths {
  try {
    return normalizeSidebarWidths(JSON.parse(localStorage.getItem(SIDEBAR_WIDTHS_KEY) ?? "{}") as Partial<SidebarWidths>);
  } catch {
    return DEFAULT_SIDEBAR_WIDTHS;
  }
}

export function loadExpanded(rootPath: string): Set<string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(`${EXPANDED_KEY}:${rootPath}`) ?? "[]") as unknown;
    return new Set([rootPath, ...(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [])]);
  } catch {
    return new Set([rootPath]);
  }
}
