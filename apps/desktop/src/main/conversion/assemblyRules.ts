/**
 * How referenced source paragraphs become a paper: layout and structure rules
 * written once for ChalkLee AI and external AI applications. Both sides compile
 * fragments with the same program, so they follow the same rules; tool names,
 * reading order and call syntax stay in each side's own instructions.
 */

export const ASSEMBLY_LAYOUT_RULES = `ref 除 stripPrefix 外还可以带以下设置，只改版式不改文字：

- \`as\` 与 \`level\`：不沿用原稿的标题级别，按试卷层级重新指定。
  - 试卷名 \`{"as":"heading","level":1}\`，全卷只有一个，程序自动居中。
  - 试卷名下的年级学科、考试时间、满分等卷首信息不做标题，用 \`{"as":"paragraph","align":"center"}\`，和试卷名一起居中。
  - 大题标题（如“I. 词汇测试”“二、阅读理解”“V. 书面表达”）level 2。
  - 大题下单独成行的小节名（如“第一节 阅读理解”）level 3。小节名和一长段答题说明连在同一段时（如“第二节以下是一篇短文，请阅读全文……”“i. 从下面每小题……”），整段作说明用 \`{"as":"paragraph"}\`，不做标题。
  - 阅读理解各篇的篇号（如单独一行的“A”“B”“C”）\`{"as":"heading","level":4,"align":"center"}\`，放在该篇题组之前、题组之外。短文自己的题目（如“"I" People and "E" People”）放在 material 开头，\`{"align":"center"}\`。
  - 标题只用于短的标题行，不超过约 30 字。
  - 标题只能放在题目和题组之外。
- \`align\`：\`left\`、\`center\` 或 \`right\`。写了 as 的段落不沿用原稿的对齐，需要居中或右对齐时写明。正文中间被误设为右对齐、居中的段落用 left；书信结尾的落款（如“Yours,”“Li Hua”）用 right。
- \`join\`：\`true\` 表示把这一段接到同一区域内紧挨着的上一段末尾，合成一段。用于被拆断的句子和条目：上一段在句子中间断开（没有句末标点），这一段接着说（如“better.”“student from Australia.He likes”）；从表格拆出的人物描述、选项若跨了几行，后面几行都接到该条目第一行。短文中，没有“首行缩进”、紧跟在上一段之后的段落多半是被拆开的同一段，读意思判断是否接上。两段须在同一区域且相邻。标为“首行缩进”的新段落和材料中的“加粗短行”小标题保留独立段落，不能为了紧凑把整篇阅读材料合成一段。
- \`omit\`：\`true\` 表示略去这一段，只用于页码、页眉页脚（如“七年级英语 第 3 页 共 7 页”），不得用于其他内容。
- \`blanks\`：题号直接印在正文里、没有显示成 ____46____ 的编号填空时（如语法填空的“falls 46 May”，完形中的“(13)”），写 \`"blanks":["46"]\` 把该段中这个题号换成填空线。每个题号在该段中只能出现一次；已经显示为 ____46____ 的不用写。`;

export const ASSEMBLY_STRUCTURE_RULES = `- 原稿段落：\`{"ref":"s1"}\`，用于标题、说明和不属于题目的正文。
- 题目：\`{"type":"question","number":"3","kind":"choice","score":3,"stem":[ref...],"options":[{"label":"A","content":[ref...]}],"answer":[ref...],"analysis":[ref...]}\`。\`kind\` 为 \`choice\`（选择）、\`fill-blank\`（填空）、\`free-response\`（解答）或 \`writing\`（书面表达）；原稿标明单选、多选、判断时也可用 \`single-choice\`、\`multiple-choice\`、\`true-false\`。没有的字段省略。
- 题组：\`{"type":"questionGroup","number":"","kind":"reading","material":[ref...],"options":[共用选项...],"questions":[题目...]}\`。\`question\` 不能嵌套 \`questions\`。按题型选 kind：
  - 带 (1)(2) 或 ①② 小问的题：\`composite\`，公共题干放 material，每个小问是一道 \`number\` 为 "(1)" 的题目。实验填空也一样，不能因有空线就把所有小问合成一道 fill-blank；其中的小问若有 A/B/C/D 选项，单独作为 choice 并保留 options。
  - 配图按题意归属：公共题干引用的图放 material；某个小问明确写“如图”“图像”时，其图放该小问 stem。浮动图在原文顺序中靠近上一小问，不代表属于上一小问；选项图仍放对应选项。
  - 完形填空 \`cloze\`、阅读理解 \`reading\`、语法填空 \`grammar-fill\`：短文放 material，各小题放 questions。
  - 七选五、句子还原 \`sentence-restoration\`：短文放 material，方框里的 A–G 句子作为题组共用的 \`options\`，各空是 questions 中 stem 为 [] 的小题。
  - 信息匹配 \`matching\`：说明放 material，每个人物或需求是一道小题（题干是该段描述），右栏的项目 A–F 作为题组共用的 \`options\`。
  - 材料中的编号填空 ____26____ 对应 questions 中 \`number\` 为 "26" 的小题；小题没有自己的题干时 \`stem\` 写 []。
  - 题组本身没有题号时 \`number\` 为 ""。
- 书面表达：一道 \`kind\` 为 \`writing\` 的题目，要求、提示、开头结尾和作答横线（原文中显示为“[作答横线 N 行]”）都按原顺序放在 stem。
- 表格：\`{"type":"table","rows":[[[ref...]],[[ref...]]]}\`，每个单元格是 ref 数组。原稿用方框圈起的几行对照说明（如“"I"=introverted(内向的)”“"E"=extroverted(外向的)”这类“X=…”行）做成一列表格，每行一格；表格可以放在 material 或 stem 中。表内已有完整 A/B/C 等选项的对照表也放 stem，不能把整表包装成单独一个 A 选项。
- 已有表格直接引用。跨页的同一表格按原顺序放在同一区域，后一表 ref 加 \`join:true\` 接续行；若分页打断同一行（如上一页末格“mobile”、下一页首格“payment)”），用 \`join:"row"\` 逐列接回该行。独立表格不合并。
- 集中答案：卷末或章末集中给出的答案，每题一个 \`{"type":"answerEntry","number":"3","answer":[ref...],"analysis":[ref...]}\`，放在原来的位置；小问的答案加 \`"parentNumbers":["20"]\`。题目后紧跟的【答案】【解析】直接放进该题的 \`answer\`、\`analysis\`。
- 作文范文按原稿作文题号归入答案；作文没有题号时，范文用 \`number:"书面表达"\`，不加 parentNumbers。评分细则、阅卷说明及其编号条目作为独立原稿段落保留，条目号不是题号，不能做 answerEntry。
- 题组后的答案按原稿题号分别归入各小题；【N题详解】及后续正文归第 N 题的 \`analysis\`，【导语】归题组的 \`analysis\`。明确标为答案、解析的片段必须归入对应区域，不能留作普通正文。
- 原稿漏印题号时，新题用 number:"" 保持无题号，不沿用上一题的题号，也不按顺序或答案表猜补。原稿确实错印或重复题号时照原样保留。因原稿缺号而无法唯一关联的答案留在原答案位置；说明具体原稿问题后完成，不反复改号来强行匹配。
- 卷末先列简答、后补部分题目的详解时，后面的详解仍属于原题，不沿用上一页最后一个大题的章节。若集中答案关联提示章节不一致或同题已有答案，读取相关题目片段，将这些原稿 ref 直接并入唯一对应题目的 answer/analysis，并移除原 answerEntry，保留同一区域内各段原来的先后顺序；不能以“原稿本来如此”保留待关联结果。`;
