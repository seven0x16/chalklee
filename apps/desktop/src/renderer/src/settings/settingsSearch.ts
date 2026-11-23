import { AI_CLI_DEFAULT_MODEL, AI_PROVIDER_PRESETS, aiProviderPreset, isAiCliProvider, type AiProviderId, type AiServiceView } from "../../../shared/settings/aiProviders";
import { THEME_COLOR_OPTIONS } from "../theme/palette";

export type SettingsPage = "general" | "ai" | "mcp" | "about";
export type McpClientTab = "workbuddy" | "doubao-work" | "qwen-work" | "codex" | "json";

export const SETTINGS_PAGES: readonly { id: SettingsPage; label: string }[] = [
  { id: "general", label: "通用" },
  { id: "ai", label: "ChalkLee AI" },
  { id: "mcp", label: "外部连接" },
  { id: "about", label: "关于" }
];

/** Where a search result leads: a page, optionally a view inside it, and the row to highlight. */
export interface SettingsTarget {
  page: SettingsPage;
  aiSection?: "search" | "ocr";
  /** data-setting-id of the row to scroll to. */
  anchor: string;
  /** AI rows that live on a configuration's form open the current (or given) one; "new" opens an empty form. */
  service?: "current" | "new" | string;
  /** A provider-specific setting opens its configuration, or a new form for that provider. */
  provider?: AiProviderId;
  mcpTab?: McpClientTab;
}

export interface SettingsSearchItem {
  id: string;
  title: string;
  description: string;
  keywords: readonly string[];
  target: SettingsTarget;
}

const ai = (anchor: string, title: string, description: string, keywords: string[], service?: "current" | "new"): SettingsSearchItem =>
  ({ id: anchor, title, description, keywords, target: { page: "ai", anchor, ...(service ? { service } : {}) } });
const mcp = (anchor: string, title: string, description: string, keywords: string[], mcpTab?: McpClientTab): SettingsSearchItem =>
  ({ id: anchor, title, description, keywords, target: { page: "mcp", anchor, ...(mcpTab ? { mcpTab } : {}) } });
const general = (anchor: string, title: string, description: string, keywords: string[]): SettingsSearchItem =>
  ({ id: anchor, title, description, keywords, target: { page: "general", anchor } });
const about = (anchor: string, title: string, description: string, keywords: string[]): SettingsSearchItem =>
  ({ id: anchor, title, description, keywords, target: { page: "about", anchor } });

export const SETTINGS_SEARCH_ITEMS: readonly SettingsSearchItem[] = [
  { id: "search-key", title: "添加或修改联网搜索配置", description: "填写联网搜索的 API Key", keywords: ["联网", "搜索", "search", "fetch", "API Key", "密钥", "添加", "修改", "元宝", "腾讯", "wsa", "豆包搜索", "智谱联网搜索", "博查"], target: { page: "ai", aiSection: "search", anchor: "search-key" } },
  { id: "search-base-urls", title: "搜索和网页读取地址", description: "分别配置联网搜索和网页读取的 Base URL", keywords: ["Base URL", "Search", "Fetch", "endpoint", "接口地址", "搜索地址", "网页读取"], target: { page: "ai", aiSection: "search", anchor: "search-base-urls" } },
  { id: "ocr-keys", title: "添加或修改文字识别配置", description: "填写文字识别服务的 Key", keywords: ["ocr", "文字识别", "deepseek", "百度", "paddleocr", "glm-ocr", "qwen-ocr", "mineru", "本地部署", "服务地址", "业务空间", "api token", "api key", "secret key", "密钥", "添加", "修改"], target: { page: "ai", aiSection: "ocr", anchor: "ocr-keys" } },
  general("general-language", "语言", "界面显示的语言", ["language", "中文", "english", "英文", "简体"]),
  general("general-appearance", "外观模式", "浅色、深色或跟随系统", ["外观", "浅色", "深色", "暗色", "夜间", "跟随系统", "dark", "light", "mode"]),
  general("general-theme-color", "主题色", "界面的强调色", ["颜色", "主题", "配色", "color", "theme", ...THEME_COLOR_OPTIONS.flatMap(theme => [theme.light.name, theme.dark.name])]),
  ai("ai-services", "模型和服务", "已添加的 AI 大模型、文字识别和联网搜索，以及它们的 API Key", ["配置", "服务", "列表", "删除", "模型配置"]),
  ai("ai-chat-model", "对话模型", "ChalkLee AI 对话使用的模型，也可在输入框左下角切换", ["对话", "聊天", "模型", "对话模型", "大模型", "助手"]),
  ai("ai-conversion-model", "转换模型", "转换 PDF、Word、LaTeX 原稿和 Markdown 使用的模型，需支持图片输入", ["转换", "原稿", "模型", "转换模型", "大模型", "转换原稿", "pdf", "word", "docx", "latex", "tex", "markdown", "md", "识图", "图像", "视觉", "内置"]),
  ai("ai-conversion-ocr", "文字识别（OCR）", "转换扫描件、图片版 PDF 时，由 AI 大模型或添加的 OCR 模型识别", ["ocr", "文字识别", "图片识别", "扫描", "扫描件", "图片版", "识别", "deepseek", "自定义", "百度", "paddleocr", "mineru", "本地部署", "转换"]),
  ai("ai-search", "联网搜索", "让 ChalkLee AI 上网找原题、找资料和阅读网页", ["联网", "搜题", "试卷", "资料", "搜索", "网页", "DeepSeek", "OpenAI", "自带", "search", "开关", "开启", "关闭", "停用"]),
  ai("ai-conversion-tags", "自动打知识点标签", "转换原稿时为题目打知识点标签", ["标签", "知识点", "转换", "tag"]),
  // Opens an empty AI model configuration at its provider dropdown.
  { ...ai("ai-provider", "添加 AI 大模型配置", "DeepSeek、Kimi、智谱、MiniMax、OpenAI 等 AI 大模型", ["添加配置", "新增", "新建", "类型", "AI 大模型", "AI 模型", "大模型", "服务商", "provider", "OCR", "百度", "Claude", "GLM", "兼容服务", "命令行", "cli", ...AI_PROVIDER_PRESETS.map(preset => preset.label)], "new"), id: "ai-add" },
  ai("ai-name", "配置名称", "选择模型时显示，默认使用提供商名称，手动输入后保持不变", ["名称", "重名", "改名"], "current"),
  ai("ai-provider", "提供商", "配置使用的服务商", ["服务商", "提供商", "provider", "切换"], "current"),
  { ...ai("ai-bailian-plan", "服务方案", "阿里云百炼按量付费或 Token Plan", ["百炼", "token plan", "套餐", "方案", "计费"], "current"),
    target: { page: "ai", anchor: "ai-bailian-plan", service: "current", provider: "bailian" } },
  ai("ai-region", "服务区域", "Kimi、智谱、MiniMax、百炼等的中国大陆站或国际站", ["区域", "地区", "国际", "中国", "大陆", "新加坡", "region", "z.ai", "byteplus"], "current"),
  ai("ai-key", "API Key", "在服务商控制台创建，加密保存在本机", ["密钥", "key", "token", "凭据", "秘钥"], "current"),
  ai("ai-base-url", "接口地址", "Base URL，选择提供商后自动填好", ["endpoint", "base url", "url", "地址", "服务地址", "接口"], "current"),
  ai("ai-model", "模型", "配置使用的模型，需支持图片输入；自定义服务可直接填写模型 ID", ["model", "模型 ID", "模型id", "模型名称", "模型列表", "切换", "图像", "视觉", "识图", "截图", "图片"], "current"),
  ai("ai-api", "接口格式", "OpenAI 与 OpenAI Compatible 可选 Chat Completions 或 Responses，自定义服务也可选 Anthropic Messages", ["api", "协议", "兼容", "格式", "completions", "responses"], "current"),
  ai("ai-command", "程序位置", "Claude Code、Codex 等命令行工具的安装位置，留空时自动查找", ["cli", "命令行", "路径", "安装位置", "可执行文件", "claude", "codex"], "current"),
  ai("ai-proxy", "网络代理", "不使用代理、跟随系统代理或自定义代理", ["proxy", "代理", "socks", "http", "vpn", "网络"], "current"),
  ai("ai-test", "测试连接", "向所选模型发送一条简短消息，检查 Key、地址和模型是否可用", ["测试", "连接", "检查", "test"], "current"),
  mcp("mcp-enabled", "允许外部 AI 应用连接", "WorkBuddy、豆包工作、千问办公、Codex 等连接并使用 ChalkLee", ["mcp", "开关", "开启", "关闭", "打开", "agent", "外部", "连接"]),
  mcp("mcp-status", "连接状态", "本机连接服务的地址和运行状态", ["状态", "端口", "地址", "127.0.0.1", "status", "port"]),
  mcp("mcp-workbuddy", "在 WorkBuddy 中添加", "连接器 → 自定义连接器 → 添加 MCP", ["workbuddy", "codebuddy", "腾讯", "连接器"], "workbuddy"),
  mcp("mcp-doubao-work", "在豆包工作中添加", "插件 → 添加 → 新建自定义连接器，选择 STDIO", ["doubao", "豆包", "字节", "插件", "连接器", "stdio"], "doubao-work"),
  mcp("mcp-qwen-work", "在千问办公中添加", "扩展 → 连接器 → 添加 → 粘贴 JSON 配置", ["qwenwork", "qwen", "千问", "阿里", "连接器"], "qwen-work"),
  mcp("mcp-codex", "在 Codex 中添加", "设置 → 插件 → 添加 → 添加自定义 MCP 服务器，选择 STDIO", ["codex", "openai", "客户端", "插件", "stdio"], "codex"),
  mcp("mcp-json", "在其他 AI 应用中添加", "通用 JSON 配置、命令与参数，以及 Claude Code 和 HTTP 的接入说明", ["json", "mcpservers", "通用", "cherry", "trae", "配置", "stdio", "claude", "claude code", "anthropic", "cursor", "mcp.json", "http", "streamable", "url", "token", "凭据"], "json"),
  about("about-version", "版本", "ChalkLee 当前版本", ["version", "版本号", "更新"]),
  about("about-runtime", "运行环境", "Electron、Chromium、Node.js 与系统版本", ["electron", "chromium", "chrome", "node", "系统", "macos", "windows"]),
  about("about-data", "数据目录", "ChalkLee AI 设置、外部 AI 应用的连接信息和转换任务的存放位置", ["数据", "目录", "文件夹", "位置", "userdata", "访达", "finder"]),
  about("about-copy", "复制版本信息", "反馈问题时附上版本和运行环境", ["复制", "反馈", "bug", "问题"]),
  about("about-logs", "问题记录", "反馈问题时一起发送的运行日志", ["日志", "log", "logs", "反馈", "bug", "问题", "崩溃", "排查", "诊断"]),
  about("about-license", "许可证", "开源许可证与版权信息", ["许可", "license", "agpl", "开源", "版权", "第三方"])
];

export function settingsPageLabel(page: SettingsPage): string {
  return SETTINGS_PAGES.find(item => item.id === page)?.label ?? page;
}

/** Configured services are searchable by their own names and models. */
export function serviceSearchItems(services: readonly AiServiceView[]): SettingsSearchItem[] {
  return services.map(service => ({
    id: `service:${service.id}`, title: service.name,
    description: service.models.length ? service.models.map(model => model === AI_CLI_DEFAULT_MODEL && isAiCliProvider(service.provider) ? "默认模型" : model).join("、") : "未添加模型",
    // A command-line tool has no key; its form opens at the model.
    keywords: [service.baseUrl, aiProviderPreset(service.provider).label, "模型配置"], target: { page: "ai", anchor: isAiCliProvider(service.provider) ? "ai-model" : "ai-key", service: service.id }
  }));
}

const fold = (value: string) => value.toLocaleLowerCase().replace(/\s+/g, " ").trim();

/** Every word of the query must appear somewhere; title hits rank first. */
export function searchSettings(query: string, items: readonly SettingsSearchItem[]): SettingsSearchItem[] {
  const words = fold(query).split(" ").filter(Boolean);
  if (!words.length) return [];
  const scored = items.flatMap((item, index) => {
    const title = fold(item.title);
    const haystack = [title, fold(item.description), fold(settingsPageLabel(item.target.page)), ...item.keywords.map(fold)].join("\n");
    if (!words.every(word => haystack.includes(word))) return [];
    const phrase = words.join(" ");
    const score = title === phrase ? 0 : title.startsWith(phrase) ? 1 : title.includes(phrase) ? 2 : words.every(word => title.includes(word)) ? 3 : 4;
    return [{ item, score, index }];
  });
  return scored.sort((left, right) => left.score - right.score || left.index - right.index).map(entry => entry.item);
}
