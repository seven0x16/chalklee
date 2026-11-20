/** Turn provider errors (often raw JSON with a status code) into something a teacher can act on. */
export function assistantErrorView(raw: string): { title: string; detail: string | null; settings: boolean } {
  const status = Number(raw.match(/\b([45]\d\d)\b/)?.[1] ?? 0);
  let detail: string | null = raw.trim();
  const json = raw.match(/\{[\s\S]*\}/)?.[0];
  if (json) {
    try {
      const value = JSON.parse(json);
      const message = value?.error?.message ?? value?.message ?? value?.msg;
      if (typeof message === "string" && message.trim()) detail = message.trim();
    } catch { /* Keep the raw text. */ }
  }
  if (detail && detail.length > 240) detail = `${detail.slice(0, 240)}…`;
  // A command-line tool's own explanations are already written for the teacher; a missing one is fixed in settings.
  if (/^没有找到 .+?。请先安装/.test(raw)) return { title: raw, detail: null, settings: true };
  // Signing in happens in the tool itself; a failure with a provider's JSON error is explained like any other.
  if (/^[^。]+? 尚未登录/.test(raw) || /^[^。]+? 运行失败/.test(raw) && !json) return { title: raw.length > 240 ? `${raw.slice(0, 240)}…` : raw, detail: null, settings: false };
  if (status === 401 || /invalid.{0,20}(api.?key|token)|unauthori[sz]ed|incorrect api key/i.test(raw)) return { title: "API Key 无效或已过期，请在 ChalkLee AI 设置中重新填写。", detail, settings: true };
  if (status === 403 || /access.{0,20}denied|forbidden|unpurchased|not.{0,20}(allowed|permitted)/i.test(raw)) return { title: "当前账号无权使用这个模型，请在 ChalkLee AI 设置中更换模型，或在服务商处开通权限。", detail, settings: true };
  if (/(image|vision|multi-?modal|图片|图像).{0,40}(not.{0,10}support|unsupported|only supported|不支持)|(not.{0,10}support|unsupported|不支持).{0,40}(image|vision|multi-?modal|图片|图像)|variant `?image_url/i.test(raw)) return { title: "当前模型不支持图片，请在输入框左下角换一个支持图片输入的模型，或去掉图片后重新发送。", detail, settings: true };
  if (status === 404 || /model.{0,30}(not.?found|does not exist)/i.test(raw)) return { title: "找不到这个模型，请在 ChalkLee AI 设置中检查服务地址和模型名称。", detail, settings: true };
  if (status === 429 || /quota|rate.?limit|insufficient/i.test(raw)) return { title: "请求过于频繁或额度不足，请稍后重试。", detail, settings: false };
  if (status >= 500 || /timed?\s*out|timeout|ECONNRESET|ETIMEDOUT|fetch failed|network|超时/i.test(raw)) return { title: "模型服务暂时不可用，请稍后重试。", detail, settings: false };
  return { title: raw.length > 160 ? `${raw.slice(0, 160)}…` : raw, detail: null, settings: false };
}
