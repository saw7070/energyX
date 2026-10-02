import { defineMessages } from "./energyiq-messages";

/**
 * Plain wording shown in place of server error codes and browser network text (see friendly-error.ts). Each sentence
 * says what happened and what the reader can do; codes and technical text never reach the page.
 */
export const friendlyErrorMessages = defineMessages({
  network: "We couldn't reach EnergyX. Check your connection and try again.",
  sessionEnded: "Your session has ended. Please sign in again.",
  forbidden: "You don't have access to this. Ask your administrator if you need it.",
  notFound: "We couldn't find this. It may have been moved or deleted.",
  conflict: "Someone else changed this at the same time. Refresh and try again.",
  busy: "EnergyX is busy right now. Wait a moment and try again.",
  reportAlreadyRunning: "A report is already being prepared for this site. Please wait for it to finish.",
  advisorNotSetUp: "The advisor isn't set up yet. Ask your administrator to choose an AI model in the Admin console.",
  fileTypeUnsupported: "This file type isn't supported. Use PDF, Excel, CSV, PowerPoint or a text file.",
  fileTooLarge: "This file is too large. Try a smaller file.",
  dataNotReady: "This site's meter data isn't ready yet. Upload readings or finish matching meters first.",
  setupIncomplete: "Some locations or meters still need setting up. Check Floor layout.",
  linkExpired: "This link has expired or is no longer valid. Ask for a new one.",
  generic: "Something went wrong. Please try again.",
  "access.loadFailed": "We couldn't load your EnergyX access. Refresh the page to try again.",
  "notifications.failed": "Couldn't load notifications.",
  tryAgain: "Try again",
}, {
  "zh-Hans": {
    network: "无法连接 EnergyX。请检查网络连接后重试。",
    sessionEnded: "您的登录已失效，请重新登录。",
    forbidden: "您没有查看此内容的权限。如有需要，请联系管理员。",
    notFound: "找不到该内容，可能已被移动或删除。",
    conflict: "其他人刚刚也修改了此内容。请刷新后重试。",
    busy: "EnergyX 当前较为繁忙，请稍候再试。",
    reportAlreadyRunning: "此站点已有一份报告正在生成，请等待完成后再试。",
    advisorNotSetUp: "能源顾问尚未设置。请联系管理员在管理控制台中选择 AI 模型。",
    fileTypeUnsupported: "不支持此文件类型。请使用 PDF、Excel、CSV、PowerPoint 或文本文件。",
    fileTooLarge: "文件过大，请换一个较小的文件。",
    dataNotReady: "此站点的电表数据尚未就绪。请先上传读数或完成电表匹配。",
    setupIncomplete: "部分位置或电表尚未设置完成，请前往“楼层布局”检查。",
    linkExpired: "此链接已过期或已失效，请重新获取。",
    generic: "出现问题，请重试。",
    "access.loadFailed": "无法加载您的 EnergyX 访问权限。请刷新页面重试。",
    "notifications.failed": "无法加载通知。",
    tryAgain: "重试",
  },
  ms: {
    network: "Kami tidak dapat menghubungi EnergyX. Semak sambungan anda dan cuba lagi.",
    sessionEnded: "Sesi anda telah tamat. Sila log masuk semula.",
    forbidden: "Anda tiada akses kepada kandungan ini. Hubungi pentadbir anda jika anda memerlukannya.",
    notFound: "Kami tidak dapat menemuinya. Ia mungkin telah dipindahkan atau dipadam.",
    conflict: "Orang lain telah mengubahnya pada masa yang sama. Muat semula dan cuba lagi.",
    busy: "EnergyX sedang sibuk. Tunggu sebentar dan cuba lagi.",
    reportAlreadyRunning: "Laporan untuk tapak ini sedang disediakan. Sila tunggu sehingga ia selesai.",
    advisorNotSetUp: "Penasihat belum disediakan. Minta pentadbir anda memilih model AI dalam Konsol pentadbir.",
    fileTypeUnsupported: "Jenis fail ini tidak disokong. Gunakan fail PDF, Excel, CSV, PowerPoint atau teks.",
    fileTooLarge: "Fail ini terlalu besar. Cuba fail yang lebih kecil.",
    dataNotReady: "Data meter tapak ini belum sedia. Muat naik bacaan atau lengkapkan padanan meter dahulu.",
    setupIncomplete: "Beberapa lokasi atau meter masih perlu disediakan. Semak Susun atur lantai.",
    linkExpired: "Pautan ini telah tamat tempoh atau tidak lagi sah. Minta pautan baharu.",
    generic: "Berlaku masalah. Sila cuba lagi.",
    "access.loadFailed": "Kami tidak dapat memuatkan akses EnergyX anda. Muat semula halaman untuk cuba lagi.",
    "notifications.failed": "Pemberitahuan tidak dapat dimuatkan.",
    tryAgain: "Cuba lagi",
  },
});

/**
 * Plain labels for the advisor's activity log. The service records English event names ("tool_execution_end",
 * "agent_start"); readers see these labels instead.
 */
export const activityMessages = defineMessages({
  started: "Started",
  stepDone: "Step completed",
  finished: "Finished",
  previousReport: "Previous report reviewed",
  keyPoints: "Key points updated",
  actionsAdded: "Actions added to the Action plan",
  actionsNeedReview: "Some actions need a closer look",
  reportSaved: "Report saved",
}, {
  "zh-Hans": {
    started: "已开始",
    stepDone: "步骤已完成",
    finished: "已完成",
    previousReport: "已查阅上一份报告",
    keyPoints: "要点已更新",
    actionsAdded: "行动已加入行动计划",
    actionsNeedReview: "部分行动需要进一步查看",
    reportSaved: "报告已保存",
  },
  ms: {
    started: "Dimulakan",
    stepDone: "Langkah selesai",
    finished: "Selesai",
    previousReport: "Laporan sebelumnya disemak",
    keyPoints: "Perkara utama dikemas kini",
    actionsAdded: "Tindakan ditambah ke Pelan tindakan",
    actionsNeedReview: "Beberapa tindakan perlu disemak dengan lebih teliti",
    reportSaved: "Laporan disimpan",
  },
});
