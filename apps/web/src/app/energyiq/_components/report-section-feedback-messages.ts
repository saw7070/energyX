import { defineMessages } from "./energyiq-messages";

/** Wording for feedback given on one section of the energy review, from the section itself. */
export const sectionFeedbackMessages = defineMessages({
  button: "Give feedback",
  buttonAria: "Give feedback on {title}",
  onThis: "Give feedback on this",
  heading: "Feedback on {title}",
  quoted: "You highlighted",
  placeholder: "What is wrong or missing here? e.g. This block's lights are on a timer, so the drop at 7 am is normal.",
  cancel: "Cancel",
  close: "Close",
  seeAll: "See everything the AI remembers →",
}, {
  "zh-Hans": {
    button: "反馈",
    buttonAria: "对「{title}」提出反馈",
    onThis: "对这段提出反馈",
    heading: "对「{title}」的反馈",
    quoted: "你选中的内容",
    placeholder: "这里有什么不对或遗漏？例如：这栋楼的灯由定时器控制，所以早上 7 点下降是正常的。",
    cancel: "取消",
    close: "关闭",
    seeAll: "查看 AI 记住的全部内容 →",
  },
  ms: {
    button: "Beri maklum balas",
    buttonAria: "Beri maklum balas tentang {title}",
    onThis: "Beri maklum balas tentang ini",
    heading: "Maklum balas tentang {title}",
    quoted: "Anda menyerlahkan",
    placeholder: "Apa yang salah atau tertinggal di sini? cth. Lampu blok ini menggunakan pemasa, jadi penurunan pada 7 pagi adalah biasa.",
    cancel: "Batal",
    close: "Tutup",
    seeAll: "Lihat semua yang diingati AI →",
  },
});
