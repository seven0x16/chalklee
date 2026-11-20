/** A hiccup on the way to the model: the same request may well go through a moment later. */
export function isTransientImportFailure(message: string): boolean {
  message = message.replace(/第\s*\d+\s*页/g, "");
  if (/insufficient_quota|allocated quota exceeded/i.test(message)) return false;
  return /timed?\s*out|timeout|ETIMEDOUT|ECONNRESET|EAI_AGAIN|UND_ERR_SOCKET|fetch failed|network error|socket hang up|stream ended without finish_reason|^(?:TypeError:\s*)?terminated$|\b(?:408|429|500|502|503|504)\b|超时|连接中断/i.test(message);
}

const SERVICE_PROBLEMS = [
  [/insufficient.{0,10}(?:quota|balance)|allocated quota exceeded|\b402\b|余额|额度/i, "模型余额或额度不足"],
  [/\b40[13]\b|unauthorized|forbidden|invalid.{0,15}key|api.?key|authentication|鉴权|无权限/i, "模型的 Key 无法使用"],
  [/\b404\b|invalid.{0,15}model|model.{0,20}not.{0,10}(?:found|exist)/i, "所选模型无法使用"]
] as const;

/** Page numbers in a reason are not status codes. */
const withoutPages = (message: string) => message.replace(/第\s*\d+\s*页/g, "");

/** What only the teacher can put right in settings, so running again changes nothing until they do. */
export const conversionServiceProblem = (message: string) => SERVICE_PROBLEMS.find(([pattern]) => pattern.test(withoutPages(message)))?.[1];

/** A failure in the teacher's words; what services and programs report is not meant to be read. */
export function conversionFailureText(message: string): string {
  const problem = conversionServiceProblem(message);
  if (problem) return `${problem}，进度已保存`;
  if (isTransientImportFailure(withoutPages(message))) return "连不上模型服务，进度已保存";
  return /^[^{}]*[一-鿿][^{}]*$/.test(message) ? message.replace(/[。.]$/, "") : "中途出错，可继续转换";
}
