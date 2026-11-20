/** Sent from an empty answer or analysis when the teacher asks ChalkLee AI to write it. */
export const CHALKLEE_REGION_ASSISTANT_EVENT = "chalklee-region-assistant";

export type ChalkLeeRegionAssistantPart = "answer" | "analysis";
export type ChalkLeeRegionAssistantDetail = { questionId: string; part: ChalkLeeRegionAssistantPart };

const SVG = "http://www.w3.org/2000/svg";
// lucide "sparkles", the icon used for ChalkLee AI suggestions elsewhere.
const SPARKLES = [
  "M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z",
  "M20 3v4", "M22 5h-4", "M4 17v2", "M5 18H3"
];

function sparkles() {
  const svg = document.createElementNS(SVG, "svg");
  for (const [name, value] of Object.entries({
    viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "2",
    "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true"
  })) svg.setAttribute(name, value);
  for (const d of SPARKLES) {
    const path = document.createElementNS(SVG, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

/**
 * The button after the "输入答案" / "输入解析" placeholder of an empty answer or analysis. It lies outside
 * the text, takes no room on the page, and is shown only where ChalkLee AI is available.
 */
export function chalkLeeRegionAssistantWidget(questionId: string, part: ChalkLeeRegionAssistantPart) {
  const holder = document.createElement("span");
  holder.className = "chalklee-region-assistant";
  holder.contentEditable = "false";
  const button = document.createElement("button");
  button.type = "button";
  const label = `用 ChalkLee AI 写${part === "answer" ? "答案" : "解析"}`;
  button.setAttribute("aria-label", label);
  button.append(sparkles(), document.createTextNode(label));
  button.addEventListener("mousedown", event => event.preventDefault());
  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    button.dispatchEvent(new CustomEvent<ChalkLeeRegionAssistantDetail>(CHALKLEE_REGION_ASSISTANT_EVENT, {
      bubbles: true,
      detail: { questionId, part }
    }));
  });
  holder.append(button);
  return holder;
}
