/** Packaging check for static resource references; not an HTML security sanitizer. */
export function assertSelfContainedReport(html: string): void {
  const source=html.replace(/<!--[\s\S]*?-->/g, "");
  for(const tag of source.matchAll(/<(?:img|script|link|source|video|audio|iframe|object|embed|image|use)\b[^>]*>/gi)) {
    for(const attr of tag[0].matchAll(/\b(?:src|href|xlink:href|poster|data|srcset)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
      const value=(attr[1]??attr[2]??attr[3]??"").trim();
      if(value && !value.startsWith("#") && !/^data:/i.test(value)) throw new Error("REPORT_REVIEW_ASSET_DEPENDENCY");
    }
  }
  for(const match of source.matchAll(/url\(\s*["']?([^\s)'";]+)["']?\s*\)/gi)) {
    const value=match[1]!;
    if(!value.startsWith("#") && !/^data:/i.test(value))throw new Error("REPORT_REVIEW_ASSET_DEPENDENCY");
  }
}
