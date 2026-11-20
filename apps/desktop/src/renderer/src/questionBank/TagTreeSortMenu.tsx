import { ArrowDownWideNarrow } from "lucide-react";
import { AppSelect } from "../ui/AppSelect";
import { TAG_TREE_SORT_FIELDS, type TagTreeSort } from "./tagTreeSorting";

/** The tag tree's sort menu: manual order, or by name or question count, either direction. */
export function TagTreeSortMenu({ sort, disabled, onChange }: {
  sort: TagTreeSort;
  disabled: boolean;
  onChange(sort: TagTreeSort): void;
}) {
  const fieldLabel = TAG_TREE_SORT_FIELDS.find(option => option.value === sort.field)!.label;
  const manual = sort.field === "manual";
  const directions = sort.field === "count" ? ["从少到多", "从多到少"] : ["A → Z", "Z → A"];
  const label = manual ? "排序：手动" : `排序：${fieldLabel} · ${sort.direction === "ascending" ? "正序" : "倒序"}`;
  return <AppSelect className="pane-sort-select" label={label} title={label} disabled={disabled}
    triggerIcon={<ArrowDownWideNarrow size={15} aria-hidden="true" />} menuWidth={200}
    value={`field:${sort.field}`} selectedValues={manual ? [`field:${sort.field}`] : [`field:${sort.field}`, `direction:${sort.direction}`]}
    options={[
      ...TAG_TREE_SORT_FIELDS.map(option => ({ value: `field:${option.value}`, label: option.label, group: "排序依据" })),
      ...(manual ? [] : [
        { value: "direction:ascending", label: `正序 · ${directions[0]}`, group: "排列顺序" },
        { value: "direction:descending", label: `倒序 · ${directions[1]}`, group: "排列顺序" }
      ])
    ]}
    onChange={value => {
      const field = TAG_TREE_SORT_FIELDS.find(option => `field:${option.value}` === value);
      if (field) onChange({ ...sort, field: field.value });
      else if (value === "direction:ascending" || value === "direction:descending") {
        onChange({ ...sort, direction: value === "direction:ascending" ? "ascending" : "descending" });
      }
    }} />;
}
