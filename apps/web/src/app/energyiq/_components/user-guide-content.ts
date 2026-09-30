import type { EnergyIqLocale } from "./energyiq-messages";
import type { EnergyIconName } from "./icons";

const FACILITY = "/energyiq/project-configuration";

export type GuidePage = { title: string; href: string; icon: EnergyIconName; purpose: string; points: string[]; group: string };
export type GuideTask = { title: string; steps: string[]; adminOnly?: boolean };
export type GuideTerm = { term: string; meaning: string };
export type GuideQuestion = { question: string; answer: string };
export type GuideStep = { title: string; detail: string };
/** A drawn example of one chart, with what to look at in it. `figure` picks the drawing in user-guide-samples.tsx. */
export type GuideSample = { figure: "heatmap" | "daily" | "ranking" | "plan"; title: string; caption: string; read: string[] };
export type GuideContent = { start: GuideStep[]; samples: GuideSample[]; pages: GuidePage[]; tasks: GuideTask[]; charts: GuideTerm[]; terms: GuideTerm[]; questions: GuideQuestion[] };
/**
 * The guide's words in another language, entry for entry in the same order as the English lists. Links, icons and
 * which tasks are for administrators always come from the English entries, so they cannot drift apart.
 */
export type GuideText = {
  start: GuideStep[];
  samples: Array<Pick<GuideSample, "title" | "caption" | "read">>;
  pages: Array<Pick<GuidePage, "group" | "title" | "purpose" | "points">>;
  tasks: Array<Pick<GuideTask, "title" | "steps">>;
  charts: GuideTerm[];
  terms: GuideTerm[];
  questions: GuideQuestion[];
};

/** The first ten minutes, for someone who has never opened EnergyX. */
export const GUIDE_START: GuideStep[] = [
  { title: "Start on the Overview", detail: "One sentence says what is costing you the most, with the money it involves. If nothing else, read this." },
  { title: "Follow it into Analysis", detail: "The same finding, explained: where the money goes, when energy is used, and what stays on after everyone leaves." },
  { title: "Find the device behind it", detail: "Facility → Devices ranks every device by what it used and cost. “What stands out” names the biggest one for you." },
  { title: "Check when it runs", detail: "On that device, the heatmap shows its busy hours. Colour under “After working hours” means it runs while the site is closed." },
  { title: "Decide and check back", detail: "Switch it off, put it on a timer, or leave it if it must run. Come back in a week and the same figures will show whether it worked." },
];

/** Worked examples: the chart, then what a reader should take from it. */
export const GUIDE_SAMPLES: GuideSample[] = [
  { figure: "heatmap", title: "Heatmap: when a device runs", caption: "Each cell is one hour of the day, averaged over the period. Colour is how hard that device worked compared with its own busiest hour — not compared with other devices.", read: ["Green all night, red in the afternoon: this one follows the working day. Nothing to do.", "A row that stays red across the night is running 24 hours. That is where after-hours money goes.", "Grey stripes mean no readings arrived for that hour."] },
  { figure: "daily", title: "Daily bars: one bar per day", caption: "Energy used each day, with closed days marked underneath so an expected dip is not read as a saving.", read: ["Weekends and holidays are shaded; a tall bar on a shaded day is worth a question.", "A bar much shorter than its neighbours usually means missing readings, not a quiet day.", "Compare like with like: open days against open days."] },
  { figure: "ranking", title: "Where the energy goes", caption: "Every device by share of the site total, largest first, with what it cost.", read: ["The top three usually account for most of the bill: start there.", "“No separate meter” is energy a board recorded that no device meter explains.", "Board totals are not added to the devices on that board, or the energy would be counted twice."] },
  { figure: "plan", title: "Floor plan", caption: "Where each board and device sits. Colours group devices by the board that feeds them.", read: ["Click an area to see only its meters; the Locations list follows along.", "A dashed box is equipment grouped inside a room, such as three display panels.", "It is a sketch for finding things, not a scale drawing."] },
];

export const GUIDE_PAGES: GuidePage[] = [
  { group: "Main pages", title: "Overview", href: "/energyiq/key-points", icon: "spark", purpose: "What matters and what you can do, at a glance.", points: ["The top findings from the latest reviewed analysis, each with what it costs and what to do next.", "A good place for a quick weekly check."] },
  { group: "Main pages", title: "Analysis", href: "/energyiq/analysis", icon: "analysis", purpose: "Where the money went and how to save it.", points: ["Five steps: where the money goes, when energy is used, what stays on after working hours, a health check and a savings plan.", "Choose the dates at the top: the latest 28 days or your own range.", "Open Detailed analysis for the full charts used by facilities teams."] },
  { group: "Main pages", title: "Reports", href: "/energyiq/library", icon: "document", purpose: "Saved reports to read, download or share.", points: ["Every report the advisor has prepared for this site, newest first."] },
  { group: "Facility", title: "Floor layout", href: `${FACILITY}?tab=structure`, icon: "floor", purpose: "Where every area, room, board and device is.", points: ["Click an area or a device on the plan to see its meters; the Locations list and the plan stay in step.", "Administrators can choose Edit layout to draw rooms and drag devices into place."] },
  { group: "Facility", title: "Devices", href: `${FACILITY}?tab=devices`, icon: "meter", purpose: "What every device uses, what it costs and when it runs.", points: ["Show the whole site, one distribution board, or open a single device.", "The heatmap shows each device's busy hours; red after working hours is worth a look."] },
  { group: "Facility", title: "Project notes", href: `${FACILITY}?tab=context`, icon: "info", purpose: "Background, floor plans and operating information.", points: ["The energy advisor reads these notes before it answers or writes a report."] },
  { group: "Facility", title: "Operating hours", href: `${FACILITY}?tab=policies`, icon: "clock", purpose: "When the site is open each day of the week.", points: ["Used everywhere to tell working hours from after working hours."] },
  { group: "Facility", title: "Holidays", href: `${FACILITY}?tab=holidays`, icon: "calendar", purpose: "Public holidays, school holidays, planned closures and special hours.", points: ["These days are marked on charts so an expected dip is not mistaken for a saving or a fault."] },
  { group: "Facility", title: "Electricity rate", href: `${FACILITY}?tab=tariff`, icon: "bolt", purpose: "The price per kWh from your electricity bill.", points: ["Every cost figure in the app uses it. A warning appears when no rate is set for the coming month."] },
  { group: "Energy advisor", title: "Ask the advisor", href: "/energyiq/reports", icon: "ask", purpose: "Ask questions about your energy in plain English, or request a report.", points: ["For example: “Why was last week higher than usual?” or “What is left on at night?”"] },
  { group: "Energy advisor", title: "Advisor guidelines", href: "/energyiq/skills", icon: "spark", purpose: "Instructions the advisor follows when preparing reports.", points: ["Keep the tone, structure and priorities of reports consistent."] },
];

export const GUIDE_TASKS: GuideTask[] = [
  { title: "Find what uses the most energy", steps: ["Open Facility → Devices.", "“What stands out” names the biggest single user and what it cost.", "“Where the energy goes” ranks every device with its share and cost. Click a name to open that device."] },
  { title: "See what is left on after working hours", steps: ["Open Analysis and go to step 3, “What stays on after working hours”.", "Or open Facility → Devices and look at the heatmap: red or orange cells under “After working hours” mean the device is running while the site is closed.", "Items marked “Check first” may need to run all the time, such as fridges or servers."] },
  { title: "Look at one board or one device", steps: ["Open Facility → Devices.", "Under Show, pick a board (for example DB2) to see everything on that board only.", "Or choose Open a device and search for it. Use Previous and Next to step through devices.", "Each view has its own link, so you can copy the address and share it."] },
  { title: "Check a single day, such as a holiday", steps: ["Open Analysis, go to step 2 and choose Single day.", "Click the date to open the calendar. Weekends are shaded, holidays are orange and days with missing readings have a dashed border.", "The chart shows that day hour by hour, with working hours unshaded."] },
  { title: "Understand a peak", steps: ["Open Analysis and find Peak 1h Consumption in the Executive Summary.", "Choose View top 5 to see the busiest hours.", "The breakdown shows each space's share and, for the selected space, a chart of which circuits used the energy."] },
  { adminOnly: true, title: "Update the electricity rate", steps: ["Open Facility → Electricity rate and choose Edit, or Add next rate in the warning.", "Enter the price per kWh and the dates exactly as they appear on your bill, and whether the price is before or including GST.", "Choose Save rate. Every cost figure in the app uses it straight away."] },
  { adminOnly: true, title: "Change operating hours or add a holiday", steps: ["Operating hours: open Facility → Operating hours, choose Edit, set the hours for each day and save.", "Holidays: open Facility → Holidays, click a day or drag across several, choose the type and save.", "Saving updates reports and charts straight away."] },
  { adminOnly: true, title: "Draw the floor plan and place devices", steps: ["Open Facility → Floor layout and choose Edit layout.", "Drag areas and rooms to move them and pull a corner to resize. Use + Area, + Room and + Entrance to add more.", "Choose “Place the rest in their board's area”: each device goes to the room its name mentions. Drag any device to its exact spot.", "Choose Save layout. The plan updates straight away, including in Project notes and for the advisor."] },
  { title: "Get a report or an answer", steps: ["Open Energy advisor → Ask the advisor.", "Type your question in plain English and send it.", "Finished reports are kept in Reports."] },
];

export const GUIDE_CHARTS: GuideTerm[] = [
  { term: "Daily bars", meaning: "One bar per day. A grey strip under the axis marks a closed day. PH is a public holiday, PC a planned closure and SH a day with special hours." },
  { term: "Typical day", meaning: "Average power for each hour of the day. The shaded band shows operating hours." },
  { term: "Heatmap", meaning: "Each cell is one hour. The colour shows how hard the device was working compared with its busiest hour: green is low, red is high. The band above shows operating hours and after working hours." },
  { term: "Every day, hour by hour", meaning: "On a single device, one row per day. All days use the same scale, so a busy day and a quiet day can be compared directly." },
  { term: "Floor plan", meaning: "Each colour is one distribution board. Pins are devices; the label leaves out the room name it sits in. Faded areas are not part of your selection." },
  { term: "Peak breakdown chart", meaning: "How one space's energy split between circuits in that hour. The grey “Not split by circuit” slice is energy the main meters recorded but no circuit meter explains." },
];

export const GUIDE_TERMS: GuideTerm[] = [
  { term: "kWh", meaning: "Energy used over time, and what the bill charges for. A 1 kW load running for one hour uses 1 kWh." },
  { term: "kW", meaning: "Power at a moment: how hard equipment is working right then." },
  { term: "Peak demand", meaning: "The highest 15-minute average power in the period." },
  { term: "Always-on load", meaning: "The power drawn in at least 9 of every 10 hours. It runs whether or not anyone is there." },
  { term: "After working hours", meaning: "Energy used outside the operating hours, including weekends, public holidays and planned closures." },
  { term: "Operating hours", meaning: "When the site is open, set in Facility → Operating hours." },
  { term: "Distribution board (DB)", meaning: "The electrical panel that feeds an area. Each board has its own meters." },
  { term: "Board total", meaning: "A meter that measures a whole board, such as all lighting on DB1. It overlaps the devices on that board, so it is not added to them." },
  { term: "No separate meter", meaning: "Energy a board recorded that no individual device meter explains. Extra metering there would show where it goes." },
  { term: "Readings received", meaning: "The share of expected readings that arrived. Below 95%, totals may be a little low." },
  { term: "Planned closure", meaning: "A day the site is closed on purpose, such as a company shutdown." },
  { term: "Special hours", meaning: "A day with opening hours different from the usual week." },
  { term: "Saving a change", meaning: "Changes you save in Facility apply across the app straight away. If one cannot go live, the Facility page says why and offers Make live now." },
  { term: "Yearly estimate", meaning: "The average day in the period multiplied by 365. A guide, not a forecast." },
  { term: "Savings range", meaning: "The lower figure assumes equipment only drops to its quietest nights; the higher figure assumes it is switched off whenever the site is closed." },
];

export const GUIDE_QUESTIONS: GuideQuestion[] = [
  { question: "Is the data live?", answer: "No. Readings are collected once a day for the previous full day, so pages show the newest complete days. Reload a page to pick up new data." },
  { question: "Why do some days look empty or low?", answer: "Some devices sent no readings, or only some, on those days. They are marked “Readings missing” or with a dashed border, and totals for them may be low." },
  { question: "Why don't the devices add up to the site total?", answer: "Board totals overlap with the devices on them, and some energy has no separate meter. “Where the energy goes” on Devices splits it so the list adds up to the total." },
  { question: "I changed a setting but nothing moved.", answer: "Changes you save in Facility apply straight away, so reload the page you are looking at. If the Facility page says some changes are not live yet, it shows why; choose Make live now to try again." },
  { question: "Who can change settings?", answer: "Administrators can edit rates, hours, holidays, locations and the floor plan. Everyone else can view every page." },
  { question: "Can I switch to dark mode?", answer: "Yes. Use the sun and moon switch in the top bar. Your choice is remembered on this browser." },
];

/**
 * Page names follow the sidebar in each language. Button and heading names quoted in the steps follow the wording the
 * reader sees on that page.
 */
const GUIDE_TEXT: Record<Exclude<EnergyIqLocale, "en">, GuideText> = {
  "zh-Hans": {
    start: [
      { title: "先看“概览”", detail: "一句话说明什么最费钱，以及涉及多少金额。如果只看一处，就看这里。" },
      { title: "点进“用电分析”", detail: "同一个结论，讲清楚：钱花在哪里、什么时候用电、下班后还有什么一直开着。" },
      { title: "找到背后的那台设备", detail: "“场地设施 → 设备”按用电量和费用给每台设备排名，“重点提示”会直接点名最大的那台。" },
      { title: "看它什么时候在运行", detail: "在该设备上，热力图显示它的繁忙时段。“下班后”一栏有颜色，说明场地关闭时它仍在运行。" },
      { title: "做决定，过一周再看", detail: "关掉它、加个定时器，或者确认它必须运行。一周后回来，同样的数字会告诉您是否奏效。" },
    ],
    samples: [
      { title: "热力图：设备什么时候运行", caption: "每个格子代表一天中的一小时，取该时段的平均值。颜色表示这台设备当时的忙碌程度，和它自己最忙的一小时相比，而不是和别的设备相比。", read: ["整夜绿色、下午变红：这台设备跟着上班时间走，无需处理。", "整行在夜间仍然是红色，说明它 24 小时都在运行。下班后的电费多半出在这里。", "灰色条纹表示该小时没有收到读数。"] },
      { title: "每日柱状图：一天一根柱", caption: "每天的用电量，下方标出休息日，避免把本就应该下降的一天误读成节省。", read: ["周末和假期有底色；带底色的日子柱子却很高，就值得问一句。", "某根柱子明显比邻近的矮，通常是读数缺失，而不是当天用得少。", "要同类相比：营业日与营业日比。"] },
      { title: "电费花在哪里", caption: "每台设备占全场总用电的比例，从大到小排列，并显示对应费用。", read: ["前三名通常占了大部分电费：从这里入手。", "“无独立电表”是配电箱记录到、但没有任何设备电表能解释的用电。", "配电箱总表不会与该箱下的设备相加，否则会重复计算。"] },
      { title: "楼层平面图", caption: "每个配电箱和设备的位置。颜色按供电的配电箱分组。", read: ["点击一个区域，只看它的电表；左侧“位置”列表会同步。", "虚线框是房间内成组的设备，例如三块显示屏。", "这是用来找位置的示意图，不是按比例的图纸。"] },
    ],
    pages: [
      { group: "主要页面", title: "概览", purpose: "一眼看清重点，以及您可以采取的行动。", points: ["最近一次经审核的分析中最重要的发现，每项都写明涉及多少费用、下一步该怎么做。", "适合每周快速查看一次。"] },
      { group: "主要页面", title: "用电分析", purpose: "钱花在了哪里，以及如何省钱。", points: ["分五步：钱花在哪里、什么时候用电、非营业时间还开着什么、健康检查和节省计划。", "在页面顶部选择日期：最近 28 天或自选的日期范围。", "打开“详细分析”，查看设施团队使用的完整图表。"] },
      { group: "主要页面", title: "报告", purpose: "已保存的报告，可以阅读、下载或分享。", points: ["顾问为此场地准备的所有报告，最新的排在最前。"] },
      { group: "场地设施", title: "楼层布局", purpose: "每个区域、房间、配电箱和设备的位置。", points: ["点击平面图上的区域或设备即可查看其电表；“位置”列表与平面图会保持同步。", "管理员可以点击“修改布局”来绘制房间，并把设备拖到对应位置。"] },
      { group: "场地设施", title: "设备", purpose: "每台设备用了多少电、花了多少钱、什么时候在运行。", points: ["可以查看整个场地、单个配电箱，或打开单台设备。", "热力图显示每台设备的繁忙时段；非营业时间出现红色就值得查看。"] },
      { group: "场地设施", title: "项目备注", purpose: "项目背景、平面图和运营信息。", points: ["能源顾问在回答问题或撰写报告之前，会先阅读这些备注。"] },
      { group: "场地设施", title: "营业时间", purpose: "场地每周各天的开放时间。", points: ["整个应用都用它来区分营业时间和非营业时间。"] },
      { group: "场地设施", title: "假期", purpose: "公共假期、学校假期、计划停业日和特殊营业时间。", points: ["这些日子会在图表上标出，以免把预期中的用电下降误当成节省或故障。"] },
      { group: "场地设施", title: "电价", purpose: "电费单上的每度电（kWh）价格。", points: ["应用中的每个费用数字都用它来计算。如果下个月还没有设置电价，会显示提醒。"] },
      { group: "能源顾问", title: "咨询顾问", purpose: "用日常用语询问与用电有关的问题，或请求生成报告。", points: ["例如：“为什么上周的用电比平时高？”或“晚上还有什么开着？”"] },
      { group: "能源顾问", title: "顾问指引", purpose: "顾问准备报告时遵循的说明。", points: ["让报告的语气、结构和重点保持一致。"] },
    ],
    tasks: [
      { title: "找出最耗电的设备", steps: ["打开“场地设施 → 设备”。", "“最值得关注”会指出用电最多的单项设备及其费用。", "“电用在了哪里”会列出每台设备的用电占比和费用，按高低排序。点击名称即可打开该设备。"] },
      { title: "查看非营业时间还开着什么", steps: ["打开“用电分析”，进入第 3 步“非营业时间还开着什么”。", "或者打开“场地设施 → 设备”查看热力图：“非营业时间”下方出现红色或橙色格子，表示场地关闭时该设备仍在运行。", "标为“先核实”的项目可能需要一直运行，例如冰箱或服务器。"] },
      { title: "查看单个配电箱或单台设备", steps: ["打开“场地设施 → 设备”。", "在“显示”中选择一个配电箱（例如 DB2），即可只看该配电箱上的设备。", "或者选择“打开设备”并搜索设备名称。用“上一个”和“下一个”逐台查看。", "每个视图都有自己的链接，可以复制网址分享给他人。"] },
      { title: "查看某一天，例如假期", steps: ["打开“用电分析”，进入第 2 步并选择“单日”。", "点击日期打开日历。周末有底色，假期为橙色，读数缺失的日子带虚线边框。", "图表会逐小时显示当天的用电，营业时间部分没有底色。"] },
      { title: "了解用电高峰", steps: ["打开“用电分析”，在“执行摘要”中找到“1 小时峰值用电”。", "点击“查看前 5 名”，查看用电最多的几个小时。", "明细会显示各空间所占的比例，并用图表显示所选空间的电主要用在哪些线路上。"] },
      { title: "更新电价", steps: ["打开“场地设施 → 电价”，点击“修改”，或在提醒中点击“添加下一个电价”。", "按电费单上的内容填写每度电（kWh）价格和日期，并注明价格是未含还是已含消费税（GST）。", "点击“保存电价”。应用中的所有费用数字会立即使用新电价。"] },
      { title: "修改营业时间或添加假期", steps: ["营业时间：打开“场地设施 → 营业时间”，点击“修改”，设置每天的时间后保存。", "假期：打开“场地设施 → 假期”，点击某一天或拖选多天，选择类型后保存。", "保存后，报告和图表会立即使用新的设置。"] },
      { title: "绘制平面图并放置设备", steps: ["打开“场地设施 → 楼层布局”，点击“修改布局”。", "拖动区域和房间可移动位置，拖拉边角可调整大小。用“+ 添加区域”、“+ 房间”和“+ 入口”添加更多内容。", "点击“把其余设备放进所属配电箱的区域”：每台设备会被放进其名称中提到的房间。任何设备都可以再拖到准确位置。", "点击“保存布局”。平面图会立即更新，项目备注和顾问也会马上使用新的平面图。"] },
      { title: "获取报告或答案", steps: ["打开“能源顾问 → 咨询顾问”。", "用日常用语输入您的问题并发送。", "完成的报告会保存在“报告”中。"] },
    ],
    charts: [
      { term: "每日柱状图", meaning: "每天一根柱子。坐标轴下方的灰色条表示当天停业。PH 表示公共假期，PC 表示计划停业，SH 表示当天有特殊营业时间。" },
      { term: "典型一天", meaning: "一天中每个小时的平均功率。有底色的带状区域表示营业时间。" },
      { term: "热力图", meaning: "每个格子代表一小时。颜色表示设备与它最繁忙的那个小时相比有多忙：绿色为低，红色为高。上方的色带标出营业时间和非营业时间。" },
      { term: "每天逐小时", meaning: "单台设备的视图，每天一行。所有日子使用同一刻度，因此可以直接比较忙碌的一天和清闲的一天。" },
      { term: "平面图", meaning: "每种颜色代表一个配电箱。圆点是设备；标签中省略了设备所在房间的名称。颜色变淡的区域不在您的选择范围内。" },
      { term: "高峰明细图", meaning: "某个空间在该小时的用电如何分布在各条线路上。灰色的“未按线路细分”部分，是总电表记录到、但没有任何线路电表能说明去向的用电。" },
    ],
    terms: [
      { term: "kWh", meaning: "一段时间内用掉的电量，也是电费的计费依据。1 kW 的设备运行一小时，用电 1 kWh（即 1 度电）。" },
      { term: "kW", meaning: "某一时刻的功率，也就是设备当时的工作强度。" },
      { term: "峰值需量", meaning: "所选期间内最高的 15 分钟平均功率。" },
      { term: "常开负载", meaning: "每 10 个小时中至少有 9 个小时都在使用的功率。无论有没有人在场，它都在运行。" },
      { term: "非营业时间", meaning: "营业时间以外的用电，包括周末、公共假期和计划停业日。" },
      { term: "营业时间", meaning: "场地开放的时间，在“场地设施 → 营业时间”中设置。" },
      { term: "配电箱（DB）", meaning: "为某个区域供电的配电盘。每个配电箱都有自己的电表。" },
      { term: "配电箱总表", meaning: "测量整个配电箱的电表，例如 DB1 上的全部照明。它与该配电箱上的设备重叠，所以不会再和它们相加。" },
      { term: "无独立电表", meaning: "配电箱记录到、但没有任何单台设备电表能说明去向的用电。在这里加装电表，就能看出这些电用在了哪里。" },
      { term: "已收到的读数", meaning: "实际收到的读数占应收读数的比例。低于 95% 时，总量可能略微偏低。" },
      { term: "计划停业", meaning: "场地有意关闭的日子，例如公司停工。" },
      { term: "特殊营业时间", meaning: "营业时间与平常一周不同的日子。" },
      { term: "保存更改", meaning: "在“场地设施”中保存的更改会立即在整个应用中生效。如果某项更改无法生效，“场地设施”页面会说明原因，并提供“立即生效”按钮。" },
      { term: "全年估算", meaning: "所选期间内平均一天的用电乘以 365。仅供参考，并非预测。" },
      { term: "节省范围", meaning: "较低的数字假设设备只降到它最安静的夜晚的水平；较高的数字假设场地关闭时设备都会关掉。" },
    ],
    questions: [
      { question: "数据是实时的吗？", answer: "不是。读数每天收集一次，内容是前一整天的数据，所以页面显示的是最新的完整日期。重新加载页面即可看到新数据。" },
      { question: "为什么有些日子看起来是空的或偏低？", answer: "那几天有些设备没有发送读数，或只发送了一部分。这些日子会标为“读数缺失”或带虚线边框，它们的总量可能偏低。" },
      { question: "为什么各设备加起来不等于场地总量？", answer: "配电箱总表与其上的设备重叠，而且有些用电没有独立电表。“设备”页中的“电用在了哪里”会把这些拆分开来，让列表加起来正好等于总量。" },
      { question: "我改了设置，但什么都没变。", answer: "在“场地设施”中保存的更改会立即生效，请刷新您正在查看的页面。如果“场地设施”页面显示部分更改尚未生效，页面会说明原因；点击“立即生效”即可重试。" },
      { question: "谁可以修改设置？", answer: "管理员可以修改电价、营业时间、假期、位置和平面图。其他人可以查看所有页面。" },
      { question: "可以切换到深色模式吗？", answer: "可以。使用顶部栏中的太阳和月亮开关。此浏览器会记住您的选择。" },
    ],
  },
  ms: {
    start: [
      { title: "Mula di Gambaran keseluruhan", detail: "Satu ayat memberitahu apa yang paling membebankan kos anda, berserta jumlah wangnya. Jika anda membaca satu perkara sahaja, bacalah ini." },
      { title: "Ikuti ke Analisis", detail: "Penemuan yang sama, dihuraikan: ke mana wang pergi, bila tenaga digunakan, dan apa yang terus hidup selepas semua orang pulang." },
      { title: "Cari peranti di sebaliknya", detail: "Fasiliti → Peranti menyusun setiap peranti mengikut penggunaan dan kosnya. “Perkara ketara” terus menamakan yang terbesar." },
      { title: "Lihat bila ia berjalan", detail: "Pada peranti itu, peta haba menunjukkan waktu sibuknya. Warna di bawah “Selepas waktu bekerja” bermakna ia berjalan semasa tapak tutup." },
      { title: "Buat keputusan dan semak semula", detail: "Matikan, letak pemasa, atau biarkan jika ia memang perlu berjalan. Kembali seminggu kemudian dan angka yang sama akan menunjukkan sama ada ia berkesan." },
    ],
    samples: [
      { title: "Peta haba: bila sesuatu peranti berjalan", caption: "Setiap petak ialah satu jam dalam sehari, dipuratakan sepanjang tempoh. Warna menunjukkan sekuat mana peranti itu bekerja berbanding jam tersibuknya sendiri — bukan berbanding peranti lain.", read: ["Hijau sepanjang malam, merah pada waktu petang: ia mengikut hari bekerja. Tiada apa perlu dibuat.", "Baris yang kekal merah sepanjang malam berjalan 24 jam. Di situlah wang selepas waktu bekerja pergi.", "Jalur kelabu bermakna tiada bacaan diterima untuk jam itu."] },
      { title: "Bar harian: satu bar sehari", caption: "Tenaga digunakan setiap hari, dengan hari tutup ditanda di bawah supaya penurunan yang dijangka tidak dibaca sebagai penjimatan.", read: ["Hujung minggu dan cuti berlorek; bar yang tinggi pada hari berlorek wajar dipersoalkan.", "Bar yang jauh lebih pendek daripada jirannya biasanya bermakna bacaan hilang, bukan hari yang lengang.", "Bandingkan yang setara: hari buka dengan hari buka."] },
      { title: "Ke mana tenaga pergi", caption: "Setiap peranti mengikut bahagiannya daripada jumlah tapak, terbesar dahulu, berserta kosnya.", read: ["Tiga teratas biasanya merangkumi sebahagian besar bil: mulakan di situ.", "“Tiada meter berasingan” ialah tenaga yang direkodkan papan agihan tetapi tiada meter peranti menjelaskannya.", "Jumlah papan tidak ditambah kepada peranti di bawahnya, jika tidak tenaga akan dikira dua kali."] },
      { title: "Pelan lantai", caption: "Kedudukan setiap papan agihan dan peranti. Warna mengumpulkan peranti mengikut papan yang membekalkannya.", read: ["Klik satu kawasan untuk melihat meternya sahaja; senarai Lokasi akan mengikut.", "Kotak putus-putus ialah peralatan yang dikumpulkan dalam sebuah bilik, seperti tiga panel paparan.", "Ia lakaran untuk mencari sesuatu, bukan lukisan berskala."] },
    ],
    pages: [
      { group: "Halaman utama", title: "Gambaran keseluruhan", purpose: "Perkara penting dan tindakan yang boleh anda ambil, secara sepintas lalu.", points: ["Penemuan utama daripada analisis terkini yang telah disemak, setiap satu dengan kosnya dan langkah seterusnya.", "Tempat yang sesuai untuk semakan ringkas setiap minggu."] },
      { group: "Halaman utama", title: "Analisis", purpose: "Ke mana wang dibelanjakan dan cara menjimatkannya.", points: ["Lima langkah: ke mana wang dibelanjakan, bila tenaga digunakan, apa yang masih hidup selepas waktu bekerja, semakan kesihatan dan pelan penjimatan.", "Pilih tarikh di bahagian atas: 28 hari terkini atau julat anda sendiri.", "Buka Analisis terperinci untuk carta penuh yang digunakan oleh pasukan fasiliti."] },
      { group: "Halaman utama", title: "Laporan", purpose: "Laporan yang disimpan untuk dibaca, dimuat turun atau dikongsi.", points: ["Setiap laporan yang disediakan oleh penasihat untuk premis ini, yang terbaharu dahulu."] },
      { group: "Premis", title: "Susun atur lantai", purpose: "Lokasi setiap kawasan, bilik, papan agihan dan peranti.", points: ["Klik kawasan atau peranti pada pelan untuk melihat meternya; senarai Lokasi dan pelan sentiasa seiring.", "Pentadbir boleh memilih Ubah susun atur untuk melukis bilik dan menyeret peranti ke tempatnya."] },
      { group: "Premis", title: "Peranti", purpose: "Penggunaan setiap peranti, kosnya dan bila ia beroperasi.", points: ["Tunjukkan seluruh premis, satu papan agihan, atau buka satu peranti.", "Peta haba menunjukkan waktu sibuk setiap peranti; warna merah selepas waktu bekerja patut diperiksa."] },
      { group: "Premis", title: "Nota projek", purpose: "Latar belakang, pelan lantai dan maklumat operasi.", points: ["Penasihat tenaga membaca nota ini sebelum menjawab soalan atau menulis laporan."] },
      { group: "Premis", title: "Waktu operasi", purpose: "Waktu premis dibuka pada setiap hari dalam seminggu.", points: ["Digunakan di seluruh aplikasi untuk membezakan waktu bekerja daripada selepas waktu bekerja."] },
      { group: "Premis", title: "Cuti", purpose: "Cuti umum, cuti sekolah, penutupan terancang dan waktu khas.", points: ["Hari-hari ini ditandakan pada carta supaya penurunan yang dijangka tidak disalah anggap sebagai penjimatan atau kerosakan."] },
      { group: "Premis", title: "Kadar elektrik", purpose: "Harga setiap kWh daripada bil elektrik anda.", points: ["Setiap angka kos dalam aplikasi menggunakannya. Amaran dipaparkan apabila tiada kadar ditetapkan untuk bulan hadapan."] },
      { group: "Penasihat tenaga", title: "Tanya penasihat", purpose: "Tanya soalan tentang tenaga anda dalam bahasa mudah, atau minta laporan.", points: ["Contohnya: “Mengapa minggu lepas lebih tinggi daripada biasa?” atau “Apa yang masih hidup pada waktu malam?”"] },
      { group: "Penasihat tenaga", title: "Garis panduan penasihat", purpose: "Arahan yang diikuti penasihat semasa menyediakan laporan.", points: ["Memastikan nada, struktur dan keutamaan laporan kekal konsisten."] },
    ],
    tasks: [
      { title: "Cari apa yang paling banyak menggunakan tenaga", steps: ["Buka Premis → Peranti.", "“Yang paling menonjol” menamakan pengguna tunggal terbesar dan kosnya.", "“Ke mana tenaga digunakan” menyusun setiap peranti mengikut bahagian dan kosnya. Klik nama untuk membuka peranti itu."] },
      { title: "Lihat apa yang masih hidup selepas waktu bekerja", steps: ["Buka Analisis dan pergi ke langkah 3, “Apa yang masih hidup selepas waktu bekerja”.", "Atau buka Premis → Peranti dan lihat peta haba: petak merah atau jingga di bawah “Selepas waktu bekerja” bermakna peranti itu berjalan semasa premis ditutup.", "Item bertanda “Semak dahulu” mungkin perlu berjalan sepanjang masa, seperti peti sejuk atau pelayan."] },
      { title: "Lihat satu papan agihan atau satu peranti", steps: ["Buka Premis → Peranti.", "Di bawah Tunjuk, pilih papan (contohnya DB2) untuk melihat semua yang ada pada papan itu sahaja.", "Atau pilih Buka peranti dan cari peranti itu. Gunakan Sebelumnya dan Seterusnya untuk melihat peranti satu demi satu.", "Setiap paparan mempunyai pautannya sendiri, jadi anda boleh menyalin alamat dan berkongsi."] },
      { title: "Semak satu hari, seperti hari cuti", steps: ["Buka Analisis, pergi ke langkah 2 dan pilih Satu hari.", "Klik tarikh untuk membuka kalendar. Hujung minggu berlorek, hari cuti berwarna jingga dan hari yang bacaannya hilang mempunyai sempadan bergaris putus.", "Carta menunjukkan hari itu jam demi jam, dengan waktu bekerja tidak berlorek."] },
      { title: "Fahami waktu puncak", steps: ["Buka Analisis dan cari Penggunaan Puncak 1 Jam dalam Ringkasan Eksekutif.", "Pilih Lihat 5 teratas untuk melihat jam yang paling sibuk.", "Pecahan menunjukkan bahagian setiap ruang dan, bagi ruang yang dipilih, carta litar yang menggunakan tenaga itu."] },
      { title: "Kemas kini kadar elektrik", steps: ["Buka Premis → Kadar elektrik dan pilih Ubah, atau Tambah kadar seterusnya dalam amaran.", "Masukkan harga setiap kWh dan tarikh tepat seperti yang tertera pada bil anda, serta sama ada harga itu sebelum atau termasuk GST.", "Pilih Simpan kadar. Setiap angka kos dalam aplikasi terus menggunakannya."] },
      { title: "Tukar waktu operasi atau tambah hari cuti", steps: ["Waktu operasi: buka Premis → Waktu operasi, pilih Ubah, tetapkan waktu bagi setiap hari dan simpan.", "Cuti: buka Premis → Cuti, klik satu hari atau seret merentasi beberapa hari, pilih jenisnya dan simpan.", "Menyimpan terus mengemas kini laporan dan carta."] },
      { title: "Lukis pelan lantai dan letakkan peranti", steps: ["Buka Premis → Susun atur lantai dan pilih Ubah susun atur.", "Seret kawasan dan bilik untuk mengalihkannya dan tarik sudut untuk mengubah saiz. Gunakan + Kawasan, + Bilik dan + Pintu masuk untuk menambah lagi.", "Pilih “Letakkan selebihnya di kawasan papan masing-masing”: setiap peranti diletakkan di bilik yang disebut dalam namanya. Seret mana-mana peranti ke tempatnya yang tepat.", "Pilih Simpan susun atur. Pelan dikemas kini serta-merta, termasuk dalam Nota projek dan untuk penasihat."] },
      { title: "Dapatkan laporan atau jawapan", steps: ["Buka Penasihat tenaga → Tanya penasihat.", "Taip soalan anda dalam bahasa mudah dan hantar.", "Laporan yang siap disimpan dalam Laporan."] },
    ],
    charts: [
      { term: "Bar harian", meaning: "Satu bar bagi setiap hari. Jalur kelabu di bawah paksi menandakan hari tutup. PH ialah cuti umum, PC penutupan terancang dan SH hari dengan waktu khas." },
      { term: "Hari tipikal", meaning: "Kuasa purata bagi setiap jam dalam sehari. Jalur berlorek menunjukkan waktu operasi." },
      { term: "Peta haba", meaning: "Setiap petak ialah satu jam. Warnanya menunjukkan betapa kuat peranti bekerja berbanding jamnya yang paling sibuk: hijau rendah, merah tinggi. Jalur di atas menunjukkan waktu operasi dan selepas waktu bekerja." },
      { term: "Setiap hari, jam demi jam", meaning: "Untuk satu peranti, satu baris bagi setiap hari. Semua hari menggunakan skala yang sama, jadi hari yang sibuk dan hari yang lengang boleh dibandingkan terus." },
      { term: "Pelan lantai", meaning: "Setiap warna ialah satu papan agihan. Pin ialah peranti; labelnya tidak menyebut nama bilik tempat ia berada. Kawasan yang pudar bukan sebahagian daripada pilihan anda." },
      { term: "Carta pecahan puncak", meaning: "Cara tenaga satu ruang terbahagi antara litar dalam jam itu. Bahagian kelabu “Tidak dipecahkan mengikut litar” ialah tenaga yang direkodkan oleh meter utama tetapi tidak dijelaskan oleh mana-mana meter litar." },
    ],
    terms: [
      { term: "kWh", meaning: "Tenaga yang digunakan dalam satu tempoh, dan itulah yang dicaj dalam bil. Beban 1 kW yang berjalan selama satu jam menggunakan 1 kWh." },
      { term: "kW", meaning: "Kuasa pada satu ketika: betapa kuat peralatan bekerja pada saat itu." },
      { term: "Permintaan puncak", meaning: "Kuasa purata 15 minit yang tertinggi dalam tempoh itu." },
      { term: "Beban sentiasa hidup", meaning: "Kuasa yang digunakan dalam sekurang-kurangnya 9 daripada setiap 10 jam. Ia berjalan sama ada orang ada di situ atau tidak." },
      { term: "Selepas waktu bekerja", meaning: "Tenaga yang digunakan di luar waktu operasi, termasuk hujung minggu, cuti umum dan penutupan terancang." },
      { term: "Waktu operasi", meaning: "Waktu premis dibuka, ditetapkan dalam Premis → Waktu operasi." },
      { term: "Papan agihan (DB)", meaning: "Panel elektrik yang membekalkan kuasa kepada sesuatu kawasan. Setiap papan mempunyai meternya sendiri." },
      { term: "Jumlah papan", meaning: "Meter yang mengukur keseluruhan papan, seperti semua lampu pada DB1. Ia bertindih dengan peranti pada papan itu, jadi ia tidak dicampurkan dengannya." },
      { term: "Tiada meter berasingan", meaning: "Tenaga yang direkodkan oleh papan tetapi tidak dijelaskan oleh mana-mana meter peranti. Meter tambahan di situ akan menunjukkan ke mana tenaga itu pergi." },
      { term: "Bacaan diterima", meaning: "Bahagian bacaan dijangka yang benar-benar diterima. Di bawah 95%, jumlah mungkin sedikit rendah." },
      { term: "Penutupan terancang", meaning: "Hari premis sengaja ditutup, seperti penutupan syarikat." },
      { term: "Waktu khas", meaning: "Hari dengan waktu buka yang berbeza daripada minggu biasa." },
      { term: "Menyimpan perubahan", meaning: "Perubahan yang disimpan dalam Premis terus berkuat kuasa di seluruh aplikasi. Jika sesuatu perubahan tidak dapat berkuat kuasa, halaman Premis menerangkan sebabnya dan menawarkan Kuatkuasakan sekarang." },
      { term: "Anggaran tahunan", meaning: "Purata sehari dalam tempoh itu didarab dengan 365. Sebagai panduan, bukan ramalan." },
      { term: "Julat penjimatan", meaning: "Angka yang lebih rendah menganggap peralatan hanya turun ke tahap malamnya yang paling senyap; angka yang lebih tinggi menganggap ia dimatikan setiap kali premis ditutup." },
    ],
    questions: [
      { question: "Adakah data ini masa nyata?", answer: "Tidak. Bacaan dikumpulkan sekali sehari untuk hari penuh sebelumnya, jadi halaman menunjukkan hari lengkap yang terbaharu. Muat semula halaman untuk mendapatkan data baharu." },
      { question: "Mengapa sesetengah hari kelihatan kosong atau rendah?", answer: "Sesetengah peranti tidak menghantar bacaan, atau hanya sebahagian, pada hari-hari itu. Hari tersebut ditandakan “Bacaan hilang” atau dengan sempadan bergaris putus, dan jumlahnya mungkin rendah." },
      { question: "Mengapa jumlah semua peranti tidak sama dengan jumlah premis?", answer: "Jumlah papan bertindih dengan peranti pada papan itu, dan sesetengah tenaga tiada meter berasingan. “Ke mana tenaga digunakan” dalam Peranti memecahkannya supaya jumlah senarai itu sama dengan jumlah keseluruhan." },
      { question: "Saya telah mengubah tetapan tetapi tiada apa yang berubah.", answer: "Perubahan yang disimpan dalam Premis terus berkuat kuasa, jadi muat semula halaman yang anda lihat. Jika halaman Premis menyatakan sesetengah perubahan belum berkuat kuasa, ia menunjukkan sebabnya; pilih Kuatkuasakan sekarang untuk mencuba semula." },
      { question: "Siapa yang boleh menukar tetapan?", answer: "Pentadbir boleh mengubah kadar, waktu, cuti, lokasi dan pelan lantai. Orang lain boleh melihat setiap halaman." },
      { question: "Bolehkah saya bertukar ke mod gelap?", answer: "Boleh. Gunakan suis matahari dan bulan di bar atas. Pilihan anda diingati pada pelayar ini." },
    ],
  },
};

/** The whole guide in the reader's language; any entry missing a translation falls back to English. */
export function guideContent(locale: EnergyIqLocale): GuideContent {
  if (locale === "en") return { start: GUIDE_START, samples: GUIDE_SAMPLES, pages: GUIDE_PAGES, tasks: GUIDE_TASKS, charts: GUIDE_CHARTS, terms: GUIDE_TERMS, questions: GUIDE_QUESTIONS };
  const text = GUIDE_TEXT[locale];
  return {
    start: GUIDE_START.map((step, index) => text.start[index] ?? step),
    samples: GUIDE_SAMPLES.map((sample, index) => ({ ...sample, ...text.samples[index] })),
    pages: GUIDE_PAGES.map((page, index) => ({ ...page, ...text.pages[index] })),
    tasks: GUIDE_TASKS.map((task, index) => ({ ...task, ...text.tasks[index] })),
    charts: GUIDE_CHARTS.map((item, index) => text.charts[index] ?? item),
    terms: GUIDE_TERMS.map((item, index) => text.terms[index] ?? item),
    questions: GUIDE_QUESTIONS.map((item, index) => text.questions[index] ?? item),
  };
}

/** Lower-case text of every guide entry, for the search box. */
export const searchText = (...parts: Array<string | string[] | undefined>) => parts.flat().filter(Boolean).join(" ").toLowerCase();
