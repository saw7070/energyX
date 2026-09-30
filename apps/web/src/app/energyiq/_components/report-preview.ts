/** First policy applies before any generated markup; the iframe also has an opaque sandbox origin. */
export function reportPreviewHtml(html: string): string {
  const policy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${policy}"><meta charset="utf-8">${html}`;
}
