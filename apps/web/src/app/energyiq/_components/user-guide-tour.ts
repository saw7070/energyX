import type { EnergyIqLocale } from "./energyiq-messages";
import { TOUR_SHOTS, type TourShot } from "./user-guide-tour-shots";

const FACILITY = "/energyiq/project-configuration";

/** One numbered part of a page picture: the same number is drawn on the picture. */
export type TourPart = { title: string; text: string };
/** A page explained with a picture of the sample site, its numbered parts and where to find it. */
export type TourPage = { id: string; href?: string; title: string; where: string; intro: string; parts: TourPart[] };
export type TourEntry = TourPage & { image: string; shot: TourShot };
type TourText = Pick<TourPage, "title" | "where" | "intro" | "parts">;

/**
 * The page-by-page tour. Pictures come from the prototype's made-up sample site and are made by
 * energyX-prototype/tools/shoot-guide.mjs, which also records where each number sits. The parts below are listed in
 * the same order as that tool's markers, so add or remove a part in both places.
 */
export const TOUR_PAGES: TourPage[] = [
  { id: "frame", title: "Finding your way around", where: "On every page", intro: "The menu on the left and the bar along the top stay the same on every page, so you can always get back to where you were.", parts: [
    { title: "Main menu", text: "Portfolio, Overview, Analysis, Reports and Team, then Facility and Energy advisor, which open to show their own pages. The page you are on is highlighted." },
    { title: "Hide the menu", text: "Shrinks the menu to icons for more room. Click it again to bring the names back." },
    { title: "Client and site", text: "Shows the client and the site you are looking at. Click it to switch to another site, or choose All sites to see the Portfolio." },
    { title: "Language", text: "Switch between English, 中文 and Bahasa Melayu. Your choice is remembered on this browser." },
    { title: "Light or dark", text: "Switch between a light and a dark screen. Also remembered on this browser." },
    { title: "Alerts", text: "The bell counts things that need a look, such as a budget heading over, a meter that stopped sending or a new report. Click one to go straight to it." },
    { title: "Your account", text: "Your initials. Open it for My profile, this User guide, Legal & security, or to sign out." },
  ] },
  { id: "portfolio", href: "/energyiq/portfolio", title: "Portfolio", where: "Main menu → Portfolio, or All sites in the site picker", intro: "Every site of your organisation side by side for the same dates, so you can see which one needs attention first.", parts: [
    { title: "Dates", text: "Last month, this month, the last 3 months, this year or your own dates. Every figure on the page follows your choice." },
    { title: "Downloads", text: "Download PDF gives a one-page summary for management. Carbon report (CSV) gives the carbon figures as a spreadsheet for sustainability reporting." },
    { title: "Totals", text: "Energy, cost and Scope 2 carbon for all sites together, with the change against the period before. Costs in different currencies are kept apart, never added together." },
    { title: "Budgets", text: "How many sites are heading over their monthly budget this month." },
    { title: "One row per site", text: "Energy, change, cost, peak demand, the share used after working hours, energy per m² and carbon. Click a column name to sort by it; click a site to open its Overview." },
    { title: "Budget status", text: "On track, Heading over or Over budget, from this month's forecast against the budget set in Facility → Budget & carbon." },
    { title: "How carbon is worked out", text: "Opens the grid emission factor used for each country and where it comes from." },
  ] },
  { id: "overview", href: "/energyiq/key-points", title: "Overview", where: "Main menu → Overview", intro: "The one thing that matters most at this site right now, in plain words, with the money it involves. A good place for a quick weekly check.", parts: [
    { title: "The headline", text: "The biggest finding from the latest report, with the energy and money involved. If you read one thing, read this." },
    { title: "Next month", text: "What next month is likely to use and cost. See the forecast opens the detail in Analysis." },
    { title: "See why in Analysis", text: "Opens Analysis on the same dates to show where the money goes and what to change." },
    { title: "Live now", text: "For sites with a live connection: power in use right now and the energy used so far today, refreshed every few minutes." },
    { title: "Where the figures come from", text: "Which saved report the page is based on, the dates it covers and how complete the readings were. A note appears when newer readings have arrived." },
    { title: "The full report", text: "The whole report, with every chart and table, right on the page. Download keeps a copy." },
  ] },
  { id: "analysis", href: "/energyiq/analysis", title: "Analysis", where: "Main menu → Analysis", intro: "Explains where the money went, when energy is used and what to change. Your own Analysis page shows the same parts, arranged a little differently.", parts: [
    { title: "Dates", text: "The latest 4 weeks, a whole month, or your own start and end dates." },
    { title: "How complete the readings are", text: "Says when meters missed readings, so you know how far to trust the figures." },
    { title: "The three numbers", text: "What was spent, how much of it was after working hours, and what could be saved each year if the suggested changes are made." },
    { title: "See the savings plan", text: "Jumps to the list of changes, largest saving first, each with what it would save." },
    { title: "Steps on this page", text: "Jump to any step: where the money goes, when energy is used, what stays on after working hours, a health check, the savings plan and next month's forecast. Detailed analysis has every chart." },
    { title: "Where the money goes", text: "Cost by area, by circuit or by type of use. The longest bar is the place to look first." },
    { title: "Download data", text: "The readings behind the page as an Excel file." },
  ] },
  { id: "reports", href: "/energyiq/library", title: "Reports", where: "Main menu → Reports", intro: "Every report prepared for this site, newest first, to read, download or share.", parts: [
    { title: "Create a report", text: "Asks the energy advisor for a report on any dates or question. It is saved here when it is finished." },
    { title: "Automatic reports", text: "Weekly and monthly reports prepared on their own, around 8 am. If your role allows it, choose which ones and who receives them." },
    { title: "Materials and context", text: "For administrators: Project materials are files the advisor reads, such as bills; Project context is background about the site." },
    { title: "Search", text: "Find a report by its title or a date, for example “Sep 2026”." },
    { title: "Show and length", text: "Show all reports, only automatic ones or only the ones someone asked for, and filter by the length they cover, such as a week or a month." },
    { title: "Latest report", text: "The newest report sits on top. Each row says whether it was automatic or custom, the dates it covers, when it was made and by whom." },
    { title: "Open or download", text: "Open shows the report beside the list; the arrow downloads a copy." },
  ] },
  { id: "team", href: "/energyiq/team", title: "Team", where: "Main menu → Team", intro: "Everyone who can open your organisation's sites, and what each person is allowed to do. Shown to people who manage access.", parts: [
    { title: "At a glance", text: "How many people have access, how many are active and how many have not joined yet." },
    { title: "AI for your organisation", text: "Whether the energy advisor is switched on, which model it uses and how many AI requests are left this month. AI use policy explains how your data is handled." },
    { title: "Find someone", text: "Search by name, email or role, or show only active, invited or disabled people." },
    { title: "Role", text: "Each person's role decides what they can see and change." },
    { title: "Status and actions", text: "Active shows when someone last signed in. Invited people have not joined yet: Resend invite sends a new link. Remove takes away their access." },
    { title: "Invite someone", text: "Enter a name and email to create a one-time link. They choose a password and join as a Viewer." },
    { title: "What each role can do", text: "Every role in use and what it allows." },
  ] },
  { id: "floor", href: `${FACILITY}?tab=structure`, title: "Facility and Floor layout", where: "Main menu → Facility → Floor layout", intro: "Facility holds the site's setup. The top part is the same on every Facility tab; Floor layout shows where every area, board and device is.", parts: [
    { title: "Facility actions", text: "Upload data adds meter files (CSV or Excel). Live connection links meters for live readings. Ask the advisor opens a chat about this site's setup. Shown to people who can change the setup." },
    { title: "The site", text: "The site's name and time zone, how many locations and meters it has, and whether saved changes are in use yet." },
    { title: "Facility tabs", text: "Each part of the setup has its own tab. A number shows how many items a tab holds." },
    { title: "Suggestions", text: "Appears when something could be clearer, for example meters that could be sorted by what they power, so charts can show where the energy goes by type." },
    { title: "Locations", text: "Every area and distribution board, with how many meters each has. Click one to see its meters." },
    { title: "Floor plan", text: "A sketch of where each board and device sits. Click an area or a device to select it; the Locations list follows. Edit layout lets administrators draw rooms and place devices." },
  ] },
  { id: "devices", href: `${FACILITY}?tab=devices`, title: "Devices", where: "Main menu → Facility → Devices", intro: "What every device uses, what it costs and when it runs.", parts: [
    { title: "Show", text: "The whole site, one distribution board, or a single device: choose Open a device and search for it by name." },
    { title: "Summary", text: "Energy, cost, a yearly estimate, the share used after working hours, peak demand and how many devices are sending readings, for the latest 28 days." },
    { title: "What stands out", text: "The biggest single user, anything that mostly runs after working hours or never switches off, and energy no meter explains. Open device goes straight to it." },
    { title: "When each device runs", text: "A heatmap: one row per device, one square per hour of the day. Darker means it was working harder. Dark squares outside the operating-hours band mean it runs while the site is closed. Point at a square for kW; click a name to open the device." },
    { title: "Where the energy goes", text: "Every device ranked by its share of the site, largest first, with what it cost. Click a name to open that device." },
    { title: "Full screen", text: "Shows the devices on their own, for a wall screen or a meeting." },
  ] },
  { id: "availability", href: `${FACILITY}?tab=availability`, title: "Data availability", where: "Main menu → Facility → Data availability", intro: "Whether every meter's readings arrived, so you know the figures elsewhere can be trusted.", parts: [
    { title: "Period", text: "How far back to check, such as the last 30 days." },
    { title: "Readings received", text: "The share of expected readings that arrived for the whole site, against a 95% target, the level many contracts ask for." },
    { title: "Problems in numbers", text: "How many meters fell below 95%, how many gaps lasted an hour or more, and how much energy was estimated while a meter was offline." },
    { title: "Readings that need a look", text: "Meters that look stuck or silent, described in plain words so someone can check them." },
    { title: "Every meter", text: "One row per meter, the ones needing attention first, with a strip showing which days arrived." },
    { title: "Download for Excel", text: "The availability figures as a spreadsheet, for example for a contract report." },
  ] },
  { id: "notes", href: `${FACILITY}?tab=context`, title: "Project notes", where: "Main menu → Facility → Project notes", intro: "What the energy advisor should know about the site but cannot see in the readings. It reads these notes before every answer and report.", parts: [
    { title: "Things the advisor should know", text: "Short facts such as cleaning hours, equipment that must stay on, a recent change or something coming up." },
    { title: "Saved facts", text: "Each fact has a coloured label and the date it was added. Edit or Remove changes it straight away." },
    { title: "Add a fact", text: "Pick a label, type the fact and choose Add. You can also tell the advisor in a chat, for example “Remember that the server room must run 24/7”." },
    { title: "Floor layout and boards", text: "The floor plan drawn from the site's documents, with the areas each board feeds. Enlarge shows it full size." },
    { title: "Project brief", text: "Background about the site and how it runs." },
  ] },
  { id: "hours", href: `${FACILITY}?tab=policies`, title: "Operating hours", where: "Main menu → Facility → Operating hours", intro: "When the site is open each day. Everything used outside these hours counts as after working hours across the app.", parts: [
    { title: "Status", text: "Published means these hours are in use everywhere in the app." },
    { title: "Summary", text: "The open days, the hours per week and the dates these hours apply." },
    { title: "The week", text: "Each day's opening hours as a bar on a 24-hour line, with the times and the hours on the right." },
    { title: "Edit", text: "If your role allows it, change the hours here. Reports and charts use the new hours straight away." },
    { title: "Holidays and special days", text: "The next few holidays and days with different hours. View calendar opens the Holidays tab." },
  ] },
  { id: "holidays", href: `${FACILITY}?tab=holidays`, title: "Holidays", where: "Main menu → Facility → Holidays", intro: "Public holidays, planned closures and days with special hours. They are marked on charts so an expected dip is not mistaken for a saving or a fault.", parts: [
    { title: "Add day", text: "Add a public holiday, a planned closure or a day with special hours. You can also click a day on the calendar, or drag across several." },
    { title: "Counts and next up", text: "How many of each kind are saved, and the next one coming up." },
    { title: "Month or year", text: "Switch between one month and the whole year. The arrows move between months; Today comes back to now." },
    { title: "Calendar", text: "Holidays show as coloured bars across their days. Weekends and other closed days are shaded. Click a bar to change it." },
    { title: "The year's list", text: "Every entry for the year, month by month. Click one to change or remove it." },
    { title: "Colour key", text: "What each colour on the calendar means." },
  ] },
  { id: "rate", href: `${FACILITY}?tab=tariff`, title: "Electricity rate", where: "Main menu → Facility → Electricity rate", intro: "The price per kWh from your electricity bill. Every cost figure in the app uses it.", parts: [
    { title: "Current rate", text: "The price in use, before and with GST, and the tariff or plan it comes from." },
    { title: "Summary", text: "Which meters it covers, the dates it applies and an example cost for 1,000 kWh." },
    { title: "Rate periods", text: "Every rate saved, newest first. Costs use the rate in effect on each day, so past months keep their old prices." },
    { title: "Edit", text: "If your role allows it, enter the price and dates exactly as they appear on the bill. A warning appears when no rate is set for the coming month." },
  ] },
  { id: "budget", href: `${FACILITY}?tab=targets`, title: "Budget & carbon", where: "Main menu → Facility → Budget & carbon", intro: "What the site should spend each month, how its carbon is worked out, and when to warn about unusual use overnight. Alerts show in the bell and are emailed to the people who run the site.", parts: [
    { title: "Monthly budget", text: "Set a monthly spending limit. The bar shows spend so far and the month-end forecast against it." },
    { title: "This month so far", text: "Spent so far, the forecast at month end, and how far over or under the budget it is likely to be." },
    { title: "Carbon emissions", text: "The grid emission factor used to turn electricity into Scope 2 carbon, with its official source. How it's worked out shows the formula." },
    { title: "Unusual overnight use", text: "Switch on to be told when a night uses much more than usual, and choose how much above usual counts." },
    { title: "Last flagged", text: "The last night that was flagged, with what it used against a normal night." },
  ] },
  { id: "ask", href: "/energyiq/reports", title: "Ask the advisor", where: "Main menu → Energy advisor → Ask the advisor", intro: "Ask about your energy in your own words, or ask for a report. Answers come from the site's real readings.", parts: [
    { title: "Chat, library and preferences", text: "The chat, the report library and your report preferences. Review facility setup asks the advisor to check the site's setup." },
    { title: "Starter questions", text: "Ready-made questions to get going. Click one to ask it." },
    { title: "Your question", text: "Type in your own words. Enter sends; Shift+Enter starts a new line." },
    { title: "Attach file", text: "Add a bill, a service report or a spreadsheet for the advisor to read." },
    { title: "Analysis method", text: "Leave it on Automatic, or choose a saved method from Advisor guidelines." },
    { title: "Dates", text: "The dates the advisor looks at unless you name others in your question." },
    { title: "Conversations", text: "Earlier chats, so you can carry on where you left off." },
  ] },
  { id: "guidelines", href: "/energyiq/skills", title: "Advisor guidelines", where: "Main menu → Energy advisor → Advisor guidelines", intro: "The instructions the advisor follows when it answers and writes reports, so they stay consistent.", parts: [
    { title: "Instructions and capabilities", text: "Instructions are the methods the advisor follows. Capabilities lists what it can do with your data." },
    { title: "Reuse an analysis method", text: "How to read a method, use it in a conversation and save one that worked." },
    { title: "Open energy advisor", text: "Starts a new conversation." },
    { title: "Groups", text: "Built in methods come with EnergyX, Shared ones are for everyone on this site, and Only for you are your own." },
    { title: "A method", text: "Its type, whether it is the default, what it is for and its version. Click it to read the full instructions." },
  ] },
];

const TOUR_TEXT: Record<Exclude<EnergyIqLocale, "en">, TourText[]> = {
  "zh-Hans": [
    { title: "如何找到各个页面", where: "每个页面都有", intro: "左侧菜单和顶部栏在每个页面都相同，随时可以回到原来的位置。", parts: [
      { title: "主菜单", text: "所有站点、概览、用电分析、报告和团队，以及可展开的“场地设施”和“能源顾问”。当前页面会高亮显示。" },
      { title: "收起菜单", text: "把菜单缩成图标，腾出更多空间。再点一次即可恢复名称。" },
      { title: "客户和站点", text: "显示当前查看的客户和站点。点击可切换到其他站点，或选择“所有站点”查看全部站点。" },
      { title: "语言", text: "在 English、中文 和 Bahasa Melayu 之间切换。此浏览器会记住您的选择。" },
      { title: "浅色或深色", text: "切换浅色或深色界面，同样会记在此浏览器中。" },
      { title: "提醒", text: "铃铛显示需要关注的事项数量，例如预算即将超支、电表停止发送数据或有新报告。点击即可直接前往。" },
      { title: "您的账户", text: "您的姓名缩写。打开后可进入“我的资料”、本用户指南、“法律与安全”，或退出登录。" },
    ] },
    { title: "所有站点", where: "主菜单 → 所有站点，或在站点选择器中选择“所有站点”", intro: "同一时段内并排查看机构的所有站点，一眼看出哪个最需要关注。", parts: [
      { title: "日期", text: "上个月、本月、最近 3 个月、今年或自定义日期。页面上的所有数字都会随之更新。" },
      { title: "下载", text: "“下载 PDF”生成给管理层的一页摘要；“碳排放报告（CSV）”以表格形式提供碳排放数据，用于可持续发展报告。" },
      { title: "合计", text: "所有站点合计的用电量、费用和范围二碳排放，以及与上一时段相比的变化。不同币种的费用分开显示，不会相加。" },
      { title: "预算", text: "本月有多少个站点可能超出月度预算。" },
      { title: "每个站点一行", text: "用电量、变化、费用、峰值需量、非工作时间用电占比、单位面积用电和碳排放。点击列名可排序；点击站点可打开其概览。" },
      { title: "预算状态", text: "“正常”“可能超支”或“已超支”，依据本月预测与“场地设施 → 预算与碳排放”中设定的预算比较得出。" },
      { title: "碳排放如何计算", text: "显示每个国家使用的电网排放因子及其来源。" },
    ] },
    { title: "概览", where: "主菜单 → 概览", intro: "用通俗的话说明此站点当前最重要的一件事，以及涉及的金额。适合每周快速查看。", parts: [
      { title: "要点", text: "最新报告中最重要的发现，以及涉及的电量和金额。如果只看一处，就看这里。" },
      { title: "下个月", text: "下个月可能的用电量和费用。“查看预测”会在“用电分析”中打开详情。" },
      { title: "在用电分析中查看原因", text: "以相同日期打开“用电分析”，查看钱花在哪里以及该改变什么。" },
      { title: "实时数据", text: "适用于已接入实时连接的站点：当前功率和今天至今的用电量，每隔几分钟刷新一次。" },
      { title: "数据来源", text: "页面所依据的已保存报告、覆盖的日期以及读数的完整程度。有更新的读数时会显示提示。" },
      { title: "完整报告", text: "完整报告（含所有图表和表格）直接显示在页面上。“下载”可保存一份。" },
    ] },
    { title: "用电分析", where: "主菜单 → 用电分析", intro: "说明钱花在哪里、何时用电以及该改变什么。您自己的“用电分析”页面包含相同内容，只是排列略有不同。", parts: [
      { title: "日期", text: "最近 4 周、整月，或自定义开始和结束日期。" },
      { title: "读数完整程度", text: "说明哪些电表缺少读数，让您了解数字的可信程度。" },
      { title: "三个数字", text: "总花费、其中非工作时间的花费，以及采纳建议后每年可节省的金额。" },
      { title: "查看节能计划", text: "跳到改进清单，按节省金额从大到小排列，并注明每项可节省多少。" },
      { title: "本页步骤", text: "可跳到任一步骤：钱花在哪里、何时用电、非工作时间仍在运行的设备、健康检查、节能计划和下月预测。“详细分析”包含所有图表。" },
      { title: "钱花在哪里", text: "按区域、回路或用途显示费用。最长的那一条最值得先看。" },
      { title: "下载数据", text: "以 Excel 文件下载本页所依据的读数。" },
    ] },
    { title: "报告", where: "主菜单 → 报告", intro: "为此站点准备的所有报告，最新的排在最前，可阅读、下载或分享。", parts: [
      { title: "创建报告", text: "请能源顾问针对任意日期或问题撰写报告，完成后会保存在这里。" },
      { title: "自动报告", text: "每周和每月自动生成的报告，约在早上 8 点生成。若您的角色允许，可选择生成哪些报告以及由谁接收。" },
      { title: "资料和背景", text: "供管理员使用：“项目资料”是顾问会阅读的文件，例如电费单；“项目背景”是有关站点的背景说明。" },
      { title: "搜索", text: "按标题或日期查找报告，例如“2026年9月”。" },
      { title: "显示与时长", text: "显示全部报告、仅自动报告或仅自定义报告，并按覆盖时长（如一周或一个月）筛选。" },
      { title: "最新报告", text: "最新的报告排在最上方。每一行注明是自动还是自定义、覆盖的日期、生成时间及生成人。" },
      { title: "打开或下载", text: "“打开”会在列表旁显示报告；箭头可下载一份。" },
    ] },
    { title: "团队", where: "主菜单 → 团队", intro: "可以打开机构站点的所有人，以及每个人能做什么。仅向负责管理访问权限的人显示。", parts: [
      { title: "概况", text: "有多少人拥有访问权限、多少人正在使用、多少人尚未加入。" },
      { title: "机构的 AI", text: "能源顾问是否开启、使用哪个模型，以及本月剩余多少次 AI 请求。“AI 使用政策”说明您的数据如何处理。" },
      { title: "查找成员", text: "按姓名、电子邮件或角色搜索，或只显示活跃、已邀请或已停用的成员。" },
      { title: "角色", text: "每个人的角色决定其可查看和更改的内容。" },
      { title: "状态和操作", text: "“活跃”显示最近一次登录时间。“已邀请”表示尚未加入：“重新发送邀请”会发送新链接。“移除”会取消其访问权限。" },
      { title: "邀请成员", text: "输入姓名和电子邮件，生成一次性链接。对方设置密码后以“查看者”身份加入。" },
      { title: "各角色权限", text: "列出所有在用的角色及其权限。" },
    ] },
    { title: "场地设施与楼层布局", where: "主菜单 → 场地设施 → 楼层布局", intro: "“场地设施”保存站点的设置。顶部区域在每个“场地设施”标签页中都相同；“楼层布局”显示每个区域、配电箱和设备的位置。", parts: [
      { title: "场地设施操作", text: "“上传数据”用于添加电表文件（CSV 或 Excel）。“实时连接”用于接入电表实时读数。“咨询顾问”会打开关于此站点设置的对话。仅向可更改设置的人显示。" },
      { title: "站点", text: "站点名称和时区、位置和电表数量，以及已保存的更改是否已生效。" },
      { title: "场地设施标签页", text: "设置的每个部分都有自己的标签页，数字表示该标签页中的项目数。" },
      { title: "建议", text: "在可以改进时出现，例如有些电表可按所供电的设备分类，这样图表就能按用途显示用电去向。" },
      { title: "位置", text: "所有区域和配电箱，以及各自的电表数量。点击即可查看其电表。" },
      { title: "平面图", text: "显示每个配电箱和设备所在位置的示意图。点击区域或设备即可选中，“位置”列表会同步。“编辑布局”供管理员绘制房间和放置设备。" },
    ] },
    { title: "设备", where: "主菜单 → 场地设施 → 设备", intro: "每台设备的用电量、费用以及运行时间。", parts: [
      { title: "显示", text: "整个站点、某个配电箱，或单台设备：选择“打开设备”并按名称搜索。" },
      { title: "摘要", text: "最近 28 天的用电量、费用、全年估算、非工作时间用电占比、峰值需量，以及正在发送读数的设备数量。" },
      { title: "值得注意", text: "单项最大用电设备、主要在非工作时间运行或从不关闭的设备，以及无法由电表解释的用电。“打开设备”可直接查看。" },
      { title: "各设备运行时间", text: "热力图：每台设备一行，每个小时一格。颜色越深表示运行越吃力。营业时间带以外的深色格子表示站点关闭时仍在运行。把鼠标移到格子上可看千瓦数；点击名称可打开该设备。" },
      { title: "用电去向", text: "所有设备按占站点用电的比例排列，从大到小，并附费用。点击名称可打开该设备。" },
      { title: "全屏", text: "单独显示设备页面，适合挂墙屏幕或会议使用。" },
    ] },
    { title: "数据可用率", where: "主菜单 → 场地设施 → 数据完整性", intro: "每个电表的读数是否都已收到，让您知道其他页面上的数字是否可信。", parts: [
      { title: "时段", text: "要检查多长时间，例如最近 30 天。" },
      { title: "已收到的读数", text: "全站点已收到的读数占应收读数的比例，以 95% 为目标，这也是许多合同要求的水平。" },
      { title: "问题汇总", text: "低于 95% 的电表数量、持续一小时或更长的中断次数，以及电表离线期间估算的电量。" },
      { title: "需要查看的读数", text: "看起来卡住或没有数据的电表，以通俗的话说明，方便有人去检查。" },
      { title: "所有电表", text: "每个电表一行，需要关注的排在最前，并用色条显示哪些日子的数据已收到。" },
      { title: "下载 Excel", text: "以表格形式下载数据可用率数字，例如用于合同报告。" },
    ] },
    { title: "项目备注", where: "主菜单 → 场地设施 → 项目备注", intro: "能源顾问应了解、但从读数中看不出的站点信息。顾问在每次回答和撰写报告前都会先阅读这些备注。", parts: [
      { title: "顾问需要了解的事项", text: "简短的事实，例如清洁时间、必须保持运行的设备、最近的变化或即将发生的事。" },
      { title: "已保存的事项", text: "每条事项都有彩色标签和添加日期。“编辑”或“删除”会立即生效。" },
      { title: "添加事项", text: "选择标签、输入事项后点“添加”。也可以在对话中告诉顾问，例如“请记住服务器机房必须全天候运行”。" },
      { title: "楼层布局和配电箱", text: "根据站点文件绘制的平面图，以及每个配电箱供电的区域。“放大”可全尺寸查看。" },
      { title: "项目简介", text: "有关站点及其运作方式的背景信息。" },
    ] },
    { title: "营业时间", where: "主菜单 → 场地设施 → 营业时间", intro: "站点每天的营业时间。在此时间以外的用电，在整个应用中都计为非工作时间用电。", parts: [
      { title: "状态", text: "“已发布”表示这些时间已在整个应用中使用。" },
      { title: "摘要", text: "营业日、每周营业小时数以及这些时间适用的日期。" },
      { title: "一周", text: "每天的营业时间显示为 24 小时时间轴上的一条横条，右侧注明时间和小时数。" },
      { title: "编辑", text: "若您的角色允许，可在此更改时间。报告和图表会立即使用新的时间。" },
      { title: "假日和特殊日子", text: "接下来的几个假日和营业时间不同的日子。“查看日历”会打开“假期”标签页。" },
    ] },
    { title: "假期", where: "主菜单 → 场地设施 → 假期", intro: "公共假日、计划停业和营业时间特殊的日子。它们会在图表上标出，避免把预期中的下降误认为节省或故障。", parts: [
      { title: "添加日期", text: "添加公共假日、计划停业或营业时间特殊的日子。也可以在日历上点击某天，或拖动选择多天。" },
      { title: "数量和下一个", text: "每种类型已保存的数量，以及下一个即将到来的日子。" },
      { title: "月或年", text: "在单月和全年视图之间切换。箭头用于前后翻月，“今天”可回到当前。" },
      { title: "日历", text: "假日以彩色横条横跨其日期显示。周末和其他停业日以阴影标示。点击横条即可修改。" },
      { title: "全年清单", text: "按月列出全年的所有条目。点击即可修改或删除。" },
      { title: "颜色说明", text: "日历上每种颜色的含义。" },
    ] },
    { title: "电价", where: "主菜单 → 场地设施 → 电价", intro: "电费单上的每千瓦时价格。应用中所有费用数字都使用它。", parts: [
      { title: "当前电价", text: "正在使用的价格（含税前和含消费税），以及其所属的电价方案。" },
      { title: "摘要", text: "适用的电表、适用的日期，以及 1,000 千瓦时的示例费用。" },
      { title: "电价时段", text: "所有已保存的电价，最新的在前。费用按每天当时有效的电价计算，因此过去月份保留原来的价格。" },
      { title: "编辑", text: "若您的角色允许，请按电费单上的价格和日期填写。若下个月尚未设定电价，会显示提醒。" },
    ] },
    { title: "预算与碳排放", where: "主菜单 → 场地设施 → 预算与碳排放", intro: "站点每月应花多少钱、碳排放如何计算，以及何时提醒夜间用电异常。提醒会显示在铃铛中，并通过电子邮件发送给负责站点的人。", parts: [
      { title: "月度预算", text: "设定每月支出上限。横条显示目前的花费和月底预测与预算的对比。" },
      { title: "本月至今", text: "目前已花费、月底预测，以及可能超出或低于预算多少。" },
      { title: "碳排放", text: "用于把用电量换算为范围二碳排放的电网排放因子及其官方来源。“计算方式”会显示公式。" },
      { title: "夜间用电异常", text: "开启后，当某晚用电明显高于平常时会通知您，并可选择高出多少才算异常。" },
      { title: "最近一次标记", text: "最近一次被标记的夜晚，以及其用电与正常夜晚的对比。" },
    ] },
    { title: "咨询顾问", where: "主菜单 → 能源顾问 → 咨询顾问", intro: "用自己的话询问用电情况，或请求生成报告。回答均来自站点的真实读数。", parts: [
      { title: "对话、报告库和偏好", text: "对话、报告库和您的报告偏好。“检查设施设置”会请顾问检查站点的设置。" },
      { title: "推荐问题", text: "现成的问题，方便您开始。点击即可提问。" },
      { title: "您的问题", text: "用自己的话输入。按 Enter 发送；按 Shift+Enter 换行。" },
      { title: "附加文件", text: "添加电费单、维修报告或表格，供顾问阅读。" },
      { title: "分析方法", text: "保持“自动”，或从“顾问指引”中选择已保存的方法。" },
      { title: "日期", text: "除非您在问题中指定其他日期，否则顾问会查看这些日期。" },
      { title: "对话记录", text: "以前的对话，方便您接着上次继续。" },
    ] },
    { title: "顾问指引", where: "主菜单 → 能源顾问 → 顾问指引", intro: "顾问在回答和撰写报告时遵循的说明，确保结果保持一致。", parts: [
      { title: "说明和能力", text: "“说明”是顾问遵循的方法；“能力”列出它可以对您的数据做什么。" },
      { title: "重复使用分析方法", text: "如何阅读方法、在对话中使用，以及保存一个有效的方法。" },
      { title: "打开能源顾问", text: "开始新的对话。" },
      { title: "分组", text: "“内置”方法随 EnergyX 提供，“共享”方法供此站点所有人使用，“仅限您本人”是您自己的方法。" },
      { title: "一个方法", text: "显示其类型、是否为默认、用途和版本。点击即可阅读完整说明。" },
    ] },
  ],
  ms: [
    { title: "Mencari jalan", where: "Di setiap halaman", intro: "Menu di sebelah kiri dan bar di bahagian atas sama di setiap halaman, jadi anda sentiasa boleh kembali ke tempat tadi.", parts: [
      { title: "Menu utama", text: "Portfolio, Gambaran keseluruhan, Analisis, Laporan dan Pasukan, diikuti Premis dan Penasihat tenaga yang boleh dibuka untuk melihat halamannya. Halaman semasa diserlahkan." },
      { title: "Sembunyikan menu", text: "Mengecilkan menu kepada ikon untuk ruang yang lebih luas. Klik sekali lagi untuk memaparkan semula nama." },
      { title: "Pelanggan dan premis", text: "Menunjukkan pelanggan dan premis yang sedang dilihat. Klik untuk bertukar ke premis lain, atau pilih Semua premis untuk melihat Portfolio." },
      { title: "Bahasa", text: "Tukar antara English, 中文 dan Bahasa Melayu. Pilihan anda diingati pada pelayar ini." },
      { title: "Cerah atau gelap", text: "Tukar antara skrin cerah dan gelap. Juga diingati pada pelayar ini." },
      { title: "Amaran", text: "Loceng mengira perkara yang perlu dilihat, seperti bajet yang hampir terlebih, meter yang berhenti menghantar data atau laporan baharu. Klik satu untuk terus ke situ." },
      { title: "Akaun anda", text: "Inisial anda. Buka untuk Profil saya, Panduan pengguna ini, Undang-undang & keselamatan, atau untuk log keluar." },
    ] },
    { title: "Portfolio", where: "Menu utama → Portfolio, atau Semua premis dalam pemilih premis", intro: "Semua premis organisasi anda bersebelahan untuk tarikh yang sama, supaya anda nampak yang mana perlu diberi perhatian dahulu.", parts: [
      { title: "Tarikh", text: "Bulan lepas, bulan ini, 3 bulan lepas, tahun ini atau tarikh pilihan anda. Setiap angka di halaman mengikut pilihan anda." },
      { title: "Muat turun", text: "Muat turun PDF memberi ringkasan satu halaman untuk pengurusan. Laporan karbon (CSV) memberi angka karbon sebagai hamparan untuk laporan kelestarian." },
      { title: "Jumlah", text: "Tenaga, kos dan karbon Skop 2 bagi semua premis bersama, dengan perubahan berbanding tempoh sebelumnya. Kos dalam mata wang berbeza diasingkan, tidak dicampur." },
      { title: "Bajet", text: "Berapa banyak premis yang mungkin melebihi bajet bulanan bulan ini." },
      { title: "Satu baris setiap premis", text: "Tenaga, perubahan, kos, permintaan puncak, bahagian yang digunakan selepas waktu bekerja, tenaga per m² dan karbon. Klik nama lajur untuk menyusun; klik premis untuk membuka Gambaran keseluruhannya." },
      { title: "Status bajet", text: "Mengikut sasaran, Hampir terlebih atau Terlebih bajet, berdasarkan ramalan bulan ini berbanding bajet yang ditetapkan dalam Premis → Bajet & karbon." },
      { title: "Cara karbon dikira", text: "Membuka faktor pelepasan grid yang digunakan bagi setiap negara dan sumbernya." },
    ] },
    { title: "Gambaran keseluruhan", where: "Menu utama → Gambaran keseluruhan", intro: "Perkara paling penting di premis ini sekarang, dalam bahasa mudah, dengan jumlah wang yang terlibat. Sesuai untuk semakan mingguan yang cepat.", parts: [
      { title: "Tajuk utama", text: "Penemuan terbesar daripada laporan terkini, dengan tenaga dan wang yang terlibat. Jika anda hanya membaca satu perkara, bacalah ini." },
      { title: "Bulan depan", text: "Anggaran penggunaan dan kos bulan depan. Lihat ramalan membuka butirannya dalam Analisis." },
      { title: "Lihat sebabnya dalam Analisis", text: "Membuka Analisis bagi tarikh yang sama untuk menunjukkan ke mana wang pergi dan apa yang perlu diubah." },
      { title: "Langsung sekarang", text: "Untuk premis dengan sambungan langsung: kuasa yang sedang digunakan dan tenaga yang digunakan setakat hari ini, dikemas kini setiap beberapa minit." },
      { title: "Sumber angka", text: "Laporan tersimpan yang menjadi asas halaman ini, tarikh yang diliputi dan sejauh mana bacaan lengkap. Nota muncul apabila bacaan lebih baharu tiba." },
      { title: "Laporan penuh", text: "Laporan lengkap dengan setiap carta dan jadual terus di halaman. Muat turun menyimpan satu salinan." },
    ] },
    { title: "Analisis", where: "Menu utama → Analisis", intro: "Menerangkan ke mana wang pergi, bila tenaga digunakan dan apa yang perlu diubah. Halaman Analisis anda menunjukkan bahagian yang sama, disusun sedikit berbeza.", parts: [
      { title: "Tarikh", text: "4 minggu terkini, sebulan penuh, atau tarikh mula dan tamat pilihan anda." },
      { title: "Kelengkapan bacaan", text: "Memberitahu apabila meter terlepas bacaan, supaya anda tahu sejauh mana angka boleh dipercayai." },
      { title: "Tiga angka", text: "Jumlah perbelanjaan, berapa banyak daripadanya selepas waktu bekerja, dan berapa yang boleh dijimatkan setahun jika perubahan yang dicadangkan dibuat." },
      { title: "Lihat pelan penjimatan", text: "Terus ke senarai perubahan, penjimatan terbesar dahulu, setiap satu dengan jumlah yang dijimatkan." },
      { title: "Langkah di halaman ini", text: "Lompat ke mana-mana langkah: ke mana wang pergi, bila tenaga digunakan, apa yang kekal hidup selepas waktu bekerja, semakan kesihatan, pelan penjimatan dan ramalan bulan depan. Analisis terperinci mengandungi setiap carta." },
      { title: "Ke mana wang pergi", text: "Kos mengikut kawasan, litar atau jenis penggunaan. Bar paling panjang ialah tempat pertama untuk dilihat." },
      { title: "Muat turun data", text: "Bacaan di sebalik halaman ini sebagai fail Excel." },
    ] },
    { title: "Laporan", where: "Menu utama → Laporan", intro: "Setiap laporan yang disediakan untuk premis ini, terbaharu dahulu, untuk dibaca, dimuat turun atau dikongsi.", parts: [
      { title: "Buat laporan", text: "Meminta penasihat tenaga menyediakan laporan bagi apa-apa tarikh atau soalan. Ia disimpan di sini apabila siap." },
      { title: "Laporan automatik", text: "Laporan mingguan dan bulanan yang disediakan sendiri, sekitar 8 pagi. Jika peranan anda membenarkan, pilih laporan mana dan siapa yang menerimanya." },
      { title: "Bahan dan konteks", text: "Untuk pentadbir: Bahan projek ialah fail yang dibaca penasihat, seperti bil; Konteks projek ialah latar belakang premis." },
      { title: "Cari", text: "Cari laporan mengikut tajuk atau tarikh, contohnya “Sep 2026”." },
      { title: "Tunjuk dan tempoh", text: "Tunjuk semua laporan, hanya yang automatik atau hanya yang diminta seseorang, dan tapis mengikut tempoh yang diliputi, seperti seminggu atau sebulan." },
      { title: "Laporan terkini", text: "Laporan terbaharu berada di atas. Setiap baris menyatakan sama ada automatik atau tersuai, tarikh yang diliputi, bila dibuat dan oleh siapa." },
      { title: "Buka atau muat turun", text: "Buka memaparkan laporan di sebelah senarai; anak panah memuat turun satu salinan." },
    ] },
    { title: "Pasukan", where: "Menu utama → Pasukan", intro: "Semua orang yang boleh membuka premis organisasi anda, dan apa yang setiap orang dibenarkan lakukan. Dipaparkan kepada mereka yang mengurus akses.", parts: [
      { title: "Sepintas lalu", text: "Berapa ramai yang mempunyai akses, berapa ramai yang aktif dan berapa ramai yang belum menyertai." },
      { title: "AI untuk organisasi anda", text: "Sama ada penasihat tenaga dihidupkan, model yang digunakan dan baki permintaan AI bulan ini. Dasar penggunaan AI menerangkan cara data anda dikendalikan." },
      { title: "Cari seseorang", text: "Cari mengikut nama, e-mel atau peranan, atau tunjuk hanya orang yang aktif, dijemput atau dinyahdayakan." },
      { title: "Peranan", text: "Peranan setiap orang menentukan apa yang boleh dilihat dan diubah." },
      { title: "Status dan tindakan", text: "Aktif menunjukkan bila seseorang kali terakhir log masuk. Orang yang dijemput belum menyertai: Hantar semula jemputan menghantar pautan baharu. Alih keluar menarik balik akses mereka." },
      { title: "Jemput seseorang", text: "Masukkan nama dan e-mel untuk membuat pautan sekali guna. Mereka memilih kata laluan dan menyertai sebagai Pemerhati." },
      { title: "Apa yang setiap peranan boleh lakukan", text: "Setiap peranan yang digunakan dan apa yang dibenarkannya." },
    ] },
    { title: "Premis dan Susun atur lantai", where: "Menu utama → Premis → Susun atur lantai", intro: "Premis menyimpan tetapan premis anda. Bahagian atas sama pada setiap tab Premis; Susun atur lantai menunjukkan lokasi setiap kawasan, papan agihan dan peranti.", parts: [
      { title: "Tindakan premis", text: "Muat naik data menambah fail meter (CSV atau Excel). Sambungan langsung menyambungkan meter untuk bacaan langsung. Tanya penasihat membuka perbualan tentang tetapan premis ini. Dipaparkan kepada mereka yang boleh mengubah tetapan." },
      { title: "Premis", text: "Nama dan zon waktu premis, bilangan lokasi dan meter, dan sama ada perubahan yang disimpan sudah digunakan." },
      { title: "Tab premis", text: "Setiap bahagian tetapan mempunyai tab sendiri. Nombor menunjukkan bilangan item dalam tab itu." },
      { title: "Cadangan", text: "Muncul apabila sesuatu boleh dijelaskan lagi, contohnya meter yang boleh diisih mengikut apa yang dikuasakan, supaya carta dapat menunjukkan ke mana tenaga pergi mengikut jenis." },
      { title: "Lokasi", text: "Setiap kawasan dan papan agihan, dengan bilangan meter masing-masing. Klik satu untuk melihat meternya." },
      { title: "Pelan lantai", text: "Lakaran lokasi setiap papan dan peranti. Klik kawasan atau peranti untuk memilihnya; senarai Lokasi turut mengikut. Edit susun atur membolehkan pentadbir melukis bilik dan meletakkan peranti." },
    ] },
    { title: "Peranti", where: "Menu utama → Premis → Peranti", intro: "Berapa banyak tenaga yang digunakan setiap peranti, kosnya dan bila ia beroperasi.", parts: [
      { title: "Tunjuk", text: "Seluruh premis, satu papan agihan atau satu peranti: pilih Buka peranti dan cari mengikut nama." },
      { title: "Ringkasan", text: "Tenaga, kos, anggaran setahun, bahagian yang digunakan selepas waktu bekerja, permintaan puncak dan bilangan peranti yang menghantar bacaan, bagi 28 hari terkini." },
      { title: "Yang menonjol", text: "Pengguna tunggal terbesar, apa-apa yang kebanyakannya beroperasi selepas waktu bekerja atau tidak pernah dimatikan, dan tenaga yang tidak dijelaskan oleh mana-mana meter. Buka peranti terus ke situ." },
      { title: "Bila setiap peranti beroperasi", text: "Peta haba: satu baris setiap peranti, satu petak setiap jam. Lebih gelap bermaksud ia bekerja lebih kuat. Petak gelap di luar jalur waktu operasi bermaksud ia beroperasi semasa premis ditutup. Halakan pada petak untuk melihat kW; klik nama untuk membuka peranti." },
      { title: "Ke mana tenaga pergi", text: "Setiap peranti disusun mengikut bahagiannya dalam premis, terbesar dahulu, dengan kosnya. Klik nama untuk membuka peranti itu." },
      { title: "Skrin penuh", text: "Memaparkan peranti secara tersendiri, untuk skrin dinding atau mesyuarat." },
    ] },
    { title: "Ketersediaan data", where: "Menu utama → Premis → Ketersediaan data", intro: "Sama ada bacaan setiap meter telah tiba, supaya anda tahu angka di halaman lain boleh dipercayai.", parts: [
      { title: "Tempoh", text: "Sejauh mana ke belakang untuk disemak, seperti 30 hari lepas." },
      { title: "Bacaan diterima", text: "Bahagian bacaan yang dijangka yang telah tiba bagi seluruh premis, berbanding sasaran 95%, tahap yang diminta oleh banyak kontrak." },
      { title: "Masalah dalam angka", text: "Berapa meter di bawah 95%, berapa jurang yang berlanjutan sejam atau lebih, dan berapa banyak tenaga dianggarkan semasa meter di luar talian." },
      { title: "Bacaan yang perlu dilihat", text: "Meter yang kelihatan tersekat atau senyap, diterangkan dalam bahasa mudah supaya seseorang boleh menyemaknya." },
      { title: "Setiap meter", text: "Satu baris setiap meter, yang perlu perhatian dahulu, dengan jalur yang menunjukkan hari mana data tiba." },
      { title: "Muat turun untuk Excel", text: "Angka ketersediaan sebagai hamparan, contohnya untuk laporan kontrak." },
    ] },
    { title: "Nota projek", where: "Menu utama → Premis → Nota projek", intro: "Perkara yang patut diketahui penasihat tenaga tentang premis tetapi tidak dapat dilihat dalam bacaan. Ia membaca nota ini sebelum setiap jawapan dan laporan.", parts: [
      { title: "Perkara yang perlu diketahui penasihat", text: "Fakta ringkas seperti waktu pembersihan, peralatan yang mesti terus hidup, perubahan terkini atau sesuatu yang akan berlaku." },
      { title: "Fakta tersimpan", text: "Setiap fakta mempunyai label berwarna dan tarikh ia ditambah. Edit atau Alih keluar berkuat kuasa serta-merta." },
      { title: "Tambah fakta", text: "Pilih label, taip fakta dan pilih Tambah. Anda juga boleh memberitahu penasihat dalam perbualan, contohnya “Ingat bahawa bilik pelayan mesti beroperasi 24/7”." },
      { title: "Susun atur lantai dan papan", text: "Pelan lantai yang dilukis daripada dokumen premis, dengan kawasan yang dibekalkan setiap papan. Besarkan memaparkannya dalam saiz penuh." },
      { title: "Ringkasan projek", text: "Latar belakang tentang premis dan cara ia beroperasi." },
    ] },
    { title: "Waktu operasi", where: "Menu utama → Premis → Waktu operasi", intro: "Bila premis dibuka setiap hari. Semua penggunaan di luar waktu ini dikira sebagai selepas waktu bekerja di seluruh aplikasi.", parts: [
      { title: "Status", text: "Diterbitkan bermaksud waktu ini digunakan di seluruh aplikasi." },
      { title: "Ringkasan", text: "Hari dibuka, jam seminggu dan tarikh waktu ini berkuat kuasa." },
      { title: "Seminggu", text: "Waktu dibuka setiap hari sebagai bar pada garis 24 jam, dengan masa dan jam di sebelah kanan." },
      { title: "Edit", text: "Jika peranan anda membenarkan, ubah waktu di sini. Laporan dan carta menggunakan waktu baharu serta-merta." },
      { title: "Cuti dan hari istimewa", text: "Beberapa cuti dan hari dengan waktu berbeza yang akan datang. Lihat kalendar membuka tab Cuti." },
    ] },
    { title: "Cuti", where: "Menu utama → Premis → Cuti", intro: "Cuti umum, penutupan terancang dan hari dengan waktu istimewa. Ia ditanda pada carta supaya penurunan yang dijangka tidak disangka penjimatan atau kerosakan.", parts: [
      { title: "Tambah hari", text: "Tambah cuti umum, penutupan terancang atau hari dengan waktu istimewa. Anda juga boleh klik satu hari pada kalendar, atau seret merentasi beberapa hari." },
      { title: "Bilangan dan seterusnya", text: "Berapa banyak setiap jenis telah disimpan, dan yang seterusnya akan tiba." },
      { title: "Bulan atau tahun", text: "Tukar antara satu bulan dan setahun penuh. Anak panah bergerak antara bulan; Hari ini kembali ke masa kini." },
      { title: "Kalendar", text: "Cuti dipaparkan sebagai bar berwarna merentasi harinya. Hujung minggu dan hari tutup lain berlorek. Klik bar untuk mengubahnya." },
      { title: "Senarai setahun", text: "Setiap entri bagi tahun itu, bulan demi bulan. Klik satu untuk mengubah atau mengalih keluarnya." },
      { title: "Petunjuk warna", text: "Maksud setiap warna pada kalendar." },
    ] },
    { title: "Kadar elektrik", where: "Menu utama → Premis → Kadar elektrik", intro: "Harga per kWh daripada bil elektrik anda. Setiap angka kos dalam aplikasi menggunakannya.", parts: [
      { title: "Kadar semasa", text: "Harga yang digunakan, sebelum dan termasuk GST, dan tarif atau pelan asalnya." },
      { title: "Ringkasan", text: "Meter yang diliputi, tarikh ia berkuat kuasa dan contoh kos bagi 1,000 kWh." },
      { title: "Tempoh kadar", text: "Setiap kadar yang disimpan, terbaharu dahulu. Kos menggunakan kadar yang berkuat kuasa pada setiap hari, jadi bulan lepas mengekalkan harga lamanya." },
      { title: "Edit", text: "Jika peranan anda membenarkan, masukkan harga dan tarikh tepat seperti dalam bil. Amaran muncul apabila tiada kadar ditetapkan untuk bulan akan datang." },
    ] },
    { title: "Bajet & karbon", where: "Menu utama → Premis → Bajet & karbon", intro: "Berapa yang patut dibelanjakan premis setiap bulan, cara karbonnya dikira, dan bila memberi amaran tentang penggunaan luar biasa pada waktu malam. Amaran dipaparkan pada loceng dan dihantar melalui e-mel kepada mereka yang mengendalikan premis.", parts: [
      { title: "Bajet bulanan", text: "Tetapkan had perbelanjaan bulanan. Bar menunjukkan perbelanjaan setakat ini dan ramalan hujung bulan berbanding bajet." },
      { title: "Bulan ini setakat ini", text: "Perbelanjaan setakat ini, ramalan pada hujung bulan, dan sejauh mana ia mungkin melebihi atau kurang daripada bajet." },
      { title: "Pelepasan karbon", text: "Faktor pelepasan grid yang digunakan untuk menukar elektrik kepada karbon Skop 2, dengan sumber rasminya. Cara ia dikira menunjukkan formulanya." },
      { title: "Penggunaan malam luar biasa", text: "Hidupkan untuk dimaklumkan apabila satu malam menggunakan jauh lebih banyak daripada biasa, dan pilih berapa lebih daripada biasa yang dikira." },
      { title: "Kali terakhir ditanda", text: "Malam terakhir yang ditanda, dengan penggunaannya berbanding malam biasa." },
    ] },
    { title: "Tanya penasihat", where: "Menu utama → Penasihat tenaga → Tanya penasihat", intro: "Tanya tentang tenaga anda dengan perkataan sendiri, atau minta laporan. Jawapan datang daripada bacaan sebenar premis.", parts: [
      { title: "Sembang, pustaka dan keutamaan", text: "Sembang, pustaka laporan dan keutamaan laporan anda. Semak tetapan premis meminta penasihat menyemak tetapan premis." },
      { title: "Soalan permulaan", text: "Soalan sedia ada untuk bermula. Klik satu untuk bertanya." },
      { title: "Soalan anda", text: "Taip dengan perkataan sendiri. Enter menghantar; Shift+Enter memulakan baris baharu." },
      { title: "Lampirkan fail", text: "Tambah bil, laporan servis atau hamparan untuk dibaca penasihat." },
      { title: "Kaedah analisis", text: "Biarkan pada Automatik, atau pilih kaedah tersimpan daripada Garis panduan penasihat." },
      { title: "Tarikh", text: "Tarikh yang dilihat penasihat melainkan anda menyebut tarikh lain dalam soalan." },
      { title: "Perbualan", text: "Sembang terdahulu, supaya anda boleh menyambung dari tempat tadi." },
    ] },
    { title: "Garis panduan penasihat", where: "Menu utama → Penasihat tenaga → Garis panduan penasihat", intro: "Arahan yang diikuti penasihat semasa menjawab dan menulis laporan, supaya hasilnya konsisten.", parts: [
      { title: "Arahan dan keupayaan", text: "Arahan ialah kaedah yang diikuti penasihat. Keupayaan menyenaraikan apa yang boleh dilakukannya dengan data anda." },
      { title: "Guna semula kaedah analisis", text: "Cara membaca kaedah, menggunakannya dalam perbualan dan menyimpan kaedah yang berkesan." },
      { title: "Buka penasihat tenaga", text: "Memulakan perbualan baharu." },
      { title: "Kumpulan", text: "Kaedah Terbina dalam disertakan dengan EnergyX, yang Dikongsi untuk semua orang di premis ini, dan Anda sahaja ialah milik anda." },
      { title: "Satu kaedah", text: "Jenisnya, sama ada lalai, tujuannya dan versinya. Klik untuk membaca arahan penuh." },
    ] },
  ],
};

const IMAGE_DIR: Record<EnergyIqLocale, string> = { en: "en", "zh-Hans": "zh", ms: "ms" };

/** The tour in the reader's language, with each page's picture and numbered marker positions for that language. */
export function guideTour(locale: EnergyIqLocale): TourEntry[] {
  const text = locale === "en" ? null : TOUR_TEXT[locale];
  const shots = TOUR_SHOTS[locale] ?? TOUR_SHOTS.en!;
  return TOUR_PAGES.flatMap((page, index) => {
    const shot = shots[page.id] ?? TOUR_SHOTS.en?.[page.id];
    if (!shot) return [];
    return [{ ...page, ...(text?.[index] ?? {}), image: `/guide/${IMAGE_DIR[locale]}/${page.id}.webp`, shot }];
  });
}
