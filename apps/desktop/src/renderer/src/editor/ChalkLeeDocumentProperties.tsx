import { Book, PanelBottom, PanelTop, TableOfContents, type LucideIcon } from "lucide-react";
import type { ChalkLeePageAppearance } from "@chalklee/format";
import { SettingsSwitch } from "../settings/settingsControls";
import { QUESTION_GRADES, questionGradeLabel } from "../../../shared/questionBank/search";
import { AppSelect } from "../ui/AppSelect";
import { ChalkLeePaperProperties } from "./ChalkLeePaperProperties";
import type { ChalkLeePagePatch } from "./pageSettings";
import type { ChalkLeePaperSettings } from "./paperSettings";
import type { ChalkLeePaperElements, ChalkLeePaperElementsPatch } from "./paperElements";

const AUTO = "auto";

export function ChalkLeeDocumentProperties({ skill, page, onPageChange, elements, onElementsChange, paper, detected, onPaperChange }: {
  /** A document in the "技能" folder is a skill: what it is for shows first. */
  skill?: { description: string };
  page: ChalkLeePageAppearance;
  onPageChange?(patch: ChalkLeePagePatch): void;
  elements?: ChalkLeePaperElements;
  onElementsChange?(patch: ChalkLeePaperElementsPatch): void;
  paper?: ChalkLeePaperSettings;
  /** What the paper's title, file name and folders say, used until the teacher picks a value. */
  detected?: { years: number[]; grades: number[] };
  onPaperChange?(patch: Partial<ChalkLeePaperSettings>): void;
}) {
  return <div className="chalklee-document-settings" aria-label="文档属性">
    {skill ? <section className="chalklee-property-group" aria-label="技能">
      <header>技能</header>
      <div className="chalklee-property-card">
        <div className="chalklee-property-row chalklee-skill-use"><span>用途</span><p>{skill.description || "未写用途"}</p></div>
      </div>
    </section> : null}
    {paper && detected ? <ChalkLeePaperContext paper={paper} detected={detected} onChange={onPaperChange} /> : null}
    <section className="chalklee-property-group" aria-label="纸张设置">
      <header>纸张</header>
      <ChalkLeePaperProperties page={page} onChange={onPageChange} />
    </section>
    {elements ? <ChalkLeePaperElementSwitches elements={elements} onChange={onElementsChange} /> : null}
  </div>;
}

/**
 * Common parts of a paper, added in their standard look. Their style is set by selecting them on the paper.
 */
function ChalkLeePaperElementSwitches({ elements, onChange }: {
  elements: ChalkLeePaperElements;
  onChange?(patch: ChalkLeePaperElementsPatch): void;
}) {
  const row = (label: string, Icon: LucideIcon, checked: boolean, patch: (checked: boolean) => ChalkLeePaperElementsPatch) => <div className="chalklee-property-row chalklee-paper-element-row" data-on={checked ? "true" : undefined}>
    <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
    <span>{label}</span>
    <SettingsSwitch label={label} checked={checked} disabled={!onChange} onChange={value => onChange?.(patch(value))} />
  </div>;
  return <section className="chalklee-property-group" aria-label="版面">
    <header>版面</header>
    <div className="chalklee-property-card">
      {row("封面", Book, Boolean(elements.cover), on => ({ cover: on ? {} : null }))}
      {row("目录", TableOfContents, Boolean(elements.tableOfContents), on => ({ tableOfContents: on ? {} : null }))}
      {row("页眉", PanelTop, elements.header, header => ({ header }))}
      {row("页脚", PanelBottom, elements.footer, footer => ({ footer }))}
    </div>
  </section>;
}

/** Year and grade for question search: read from the paper until the teacher sets them here. */
function ChalkLeePaperContext({ paper, detected, onChange }: {
  paper: ChalkLeePaperSettings;
  detected: { years: number[]; grades: number[] };
  onChange?(patch: Partial<ChalkLeePaperSettings>): void;
}) {
  const latest = new Date().getFullYear() + 1;
  const years = Array.from({ length: latest - 1990 + 1 }, (_, index) => latest - index);
  const auto = (values: string[], none: string) => values.length ? `${values.join("/")}（自动）` : none;
  return <section className="chalklee-property-group" aria-label="年份与年级">
    <header>题库</header>
    <div className="chalklee-property-card">
      <div className="chalklee-property-row">
        <span>年份</span>
        <AppSelect className="chalklee-property-select" label="年份" menuWidth="fit" menuAlign="end" value={paper.year == null ? AUTO : String(paper.year)} disabled={!onChange}
          title="用于题库的年份筛选；自动时从文档标题、文件名和文件夹识别"
          options={[{ value: AUTO, label: auto(detected.years.map(String), "未识别") }, ...years.map(year => ({ value: String(year), label: String(year) }))]}
          onChange={value => onChange?.({ year: value === AUTO ? null : Number(value) })} />
      </div>
      <div className="chalklee-property-row">
        <span>年级</span>
        <AppSelect className="chalklee-property-select" label="年级" menuWidth="fit" menuAlign="end" value={paper.grade == null ? AUTO : String(paper.grade)} disabled={!onChange}
          title="用于题库的年级筛选；自动时从文档标题、文件名和文件夹识别"
          options={[{ value: AUTO, label: auto(detected.grades.map(questionGradeLabel), "未识别") },
            ...QUESTION_GRADES.map(grade => ({ value: String(grade.value), label: grade.label, group: grade.stage }))]}
          onChange={value => onChange?.({ grade: value === AUTO ? null : Number(value) })} />
      </div>
    </div>
  </section>;
}
