import { ArrowDownWideNarrow } from "lucide-react";
import { AppSelect } from "../ui/AppSelect";
import { WORKSPACE_SORT_FIELDS, type WorkspaceTreeSort } from "./sorting";

export function WorkspaceSortMenu({ sort, disabled, onChange }: {
  sort: WorkspaceTreeSort;
  disabled: boolean;
  onChange(sort: WorkspaceTreeSort): void;
}) {
  const fieldLabel = WORKSPACE_SORT_FIELDS.find(option => option.value === sort.field)!.label;
  const directions = sort.field === "modifiedAt" ? ["从旧到新", "从新到旧"]
    : sort.field === "size" ? ["从小到大", "从大到小"] : ["A → Z", "Z → A"];
  const label = `排序：${fieldLabel} · ${sort.direction === "ascending" ? "正序" : "倒序"}`;
  return <AppSelect className="pane-sort-select" label={label} title={label} disabled={disabled}
    triggerIcon={<ArrowDownWideNarrow size={15} aria-hidden="true" />} menuWidth={200}
    value={`field:${sort.field}`} selectedValues={[`field:${sort.field}`, `direction:${sort.direction}`]}
    options={[
      ...WORKSPACE_SORT_FIELDS.map(option => ({ value: `field:${option.value}`, label: option.label, group: "排序依据" })),
      { value: "direction:ascending", label: `正序 · ${directions[0]}`, group: "排列顺序" },
      { value: "direction:descending", label: `倒序 · ${directions[1]}`, group: "排列顺序" }
    ]}
    onChange={value => {
      const field = WORKSPACE_SORT_FIELDS.find(option => `field:${option.value}` === value);
      if (field) onChange({ ...sort, field: field.value });
      else if (value === "direction:ascending" || value === "direction:descending") {
        onChange({ ...sort, direction: value === "direction:ascending" ? "ascending" : "descending" });
      }
    }} />;
}
