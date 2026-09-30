import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const deliveryReply = `Your last assistant message is displayed directly to the facilities manager, not an engineer. Keep it under 140 words: say what report is ready and its analysis dates, give one or two useful findings, and state material data limitations. If blocked, explain what is missing instead of claiming the report is ready. Do not list review corrections, test counts, scripts, file paths, JSON status, hashes, or browser implementation details. Those belong only in review.json and supporting files. The interface provides the report preview card. This reply limit does not limit the HTML report.`;

export async function reviewReport({ directory, prompt, method, event, browserCheck }) {
  const report = join(directory, 'report.html');
  if (!existsSync(report)) return undefined;
  const verdictPath = join(directory, 'review.json');
  if (existsSync(verdictPath)) unlinkSync(verdictPath);
  writeFileSync(join(directory, 'report-draft.html'), readFileSync(report));
  const readVerdict = () => {
    const value = JSON.parse(readFileSync(verdictPath, 'utf8'));
    if (!['pass', 'revise', 'blocked'].includes(value.status) || !Array.isArray(value.issues)
        || !Array.isArray(value.checks) || !value.checks.length) throw Error('REPORT_REVIEW_INVALID');
    if (value.status === 'pass' && value.issues.some(issue => issue.resolved !== true)) throw Error('REPORT_REVIEW_INVALID');
    return value;
  };
  const appendCalendarChecks = (verdict) => {
    const html = readFileSync(report, 'utf8');
    const calendar = checkReportDates(html);
    const customer = checkCustomerReportContent(html);
    const checks = {checks:[...calendar.checks,...customer.checks],issues:[...calendar.issues,...customer.issues]};
    verdict.checks.push(...checks.checks);
    verdict.issues.push(...checks.issues);
    return checks.issues.length > 0;
  };
  event('review_started');
  if (browserCheck) await browserCheck(directory);
  await prompt(`${method}\nReview the draft now. Do not edit report.html in this review step. Save /workspace/outputs/review.json as {"status":"pass|revise|blocked","checks":[{"claim":"...","evidence":"file and calculation"}],"issues":[{"problem":"...","correction":"...","resolved":false}]}. Read source evidence and execute checks before deciding.\n${deliveryReply}`);
  let verdict = readVerdict();
  if (appendCalendarChecks(verdict) && verdict.status === 'pass') verdict.status = 'revise';
  if (browserCheck) {
    const browser = JSON.parse(readFileSync(join(directory, 'browser-check.json'), 'utf8'));
    verdict.checks.push(...browser.checks);
    verdict.issues.push(...browser.issues);
    if (browser.issues.length && verdict.status === 'pass') verdict.status = 'revise';
    writeFileSync(verdictPath, JSON.stringify(verdict, null, 2));
  }
  writeFileSync(verdictPath, JSON.stringify(verdict, null, 2));
  writeFileSync(join(directory, 'review-initial.json'), JSON.stringify(verdict, null, 2));
  if (verdict.status === 'revise') {
    event('revision_started');
    await prompt(`Correct the issues in /workspace/outputs/review.json in report.html. Verify the corrected calculations. Update review.json with checks, resolved issues and final status pass or blocked. Do not start another broad review or change project settings.\n${deliveryReply}`);
    verdict = readVerdict();
    if (verdict.status === 'revise') verdict.status = 'blocked';
  }
  if (browserCheck) {
    const browser = await browserCheck(directory);
    verdict.checks.push(...browser.checks);
    verdict.issues.push(...browser.issues);
    if (browser.issues.length) verdict.status = 'blocked';
  }
  if (appendCalendarChecks(verdict)) verdict.status = 'blocked';
  writeFileSync(verdictPath, JSON.stringify(verdict, null, 2));
  const receipt = { ...verdict, reportHash: createHash('sha256').update(readFileSync(report)).digest('hex') };
  writeFileSync(join(directory, 'review-receipt.json'), JSON.stringify(receipt, null, 2));
  event(verdict.status === 'pass' ? 'review_passed' : 'review_blocked');
  return receipt;
}

/** Narrow guard for internal test history leaking into customer reports. */
export function checkCustomerReportContent(html) {
  const text = html.replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;|&#xA0;/gi, ' ').replace(/\s+/g, ' ');
  const matches = [...text.matchAll(/\b(?:QA\s+(?:replay|test(?:ing)?|run|record)s?|QA\s*\/\s*demo(?:\s+records?)?|software[ -]validation(?:\s+replay)?|test[ -]fixture)\b/gi)];
  return {
    checks:[{claim:'Customer-facing content',evidence:`Internal test-history phrase scan: ${matches.length} matches; this narrow check does not replace editorial review.`}],
    issues:matches.map(match=>({problem:`Internal test history in customer prose: ${match[0]}`,correction:'Keep software validation history in supporting audit files. In the customer report describe only genuine operational progress and evidence; if no physical intervention is confirmed, say that without discussing internal tests. Preserve real data limitations and clearly label hypothetical estimates.',resolved:false})),
  };
}


/** Check visible English calendar labels, including labels split by inline markup. */
export function checkReportDates(html) {
  const text = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;|&#xA0;/gi, ' ').replace(/\s+/g, ' ');
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const day = '(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sun|Mon|Tue|Wed|Thu|Fri|Sat)';
  const month = '(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)';
  const patterns = [
    {regex:new RegExp('\\b'+day+'[,\\s]+(\\d{1,2})\\s+'+month+'[\\s,]+(\\d{4})\\b','gi'), parts:m=>[m[1],m[4],months.findIndex(x=>x.toLowerCase()===m[3].slice(0,3).toLowerCase())+1,m[2]]},
    {regex:new RegExp('\\b'+day+'[,\\s]+(\\d{4})-(\\d{2})-(\\d{2})\\b','gi'), parts:m=>[m[1],m[2],m[3],m[4]]},
    {regex:new RegExp('\\b'+day+'[,\\s]+'+month+'\\s+(\\d{1,2})[\\s,]+(\\d{4})\\b','gi'), parts:m=>[m[1],m[4],months.findIndex(x=>x.toLowerCase()===m[2].slice(0,3).toLowerCase())+1,m[3]]},
  ];
  const issues=[]; let count=0;
  for (const {regex,parts} of patterns) for (const match of text.matchAll(regex)) {
    const [label,y,m,d]=parts(match); const date=new Date(Date.UTC(+y,+m-1,+d)); count++;
    const expected=days[date.getUTCDay()];
    if (date.getUTCMonth()!==+m-1 || date.getUTCDate()!==+d || label.slice(0,3).toLowerCase()!==expected.toLowerCase())
      issues.push({problem:`Incorrect calendar label: ${match[0]}`, correction:`Recalculate the date and weekday; expected ${expected} for ${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}. Use manifest.calendarLabels.`,resolved:false});
  }
  return {checks:[{claim:'Visible weekday/date consistency',evidence:`Deterministic English date scan: ${count} labels checked; absence of labels does not validate other date formats.`}],issues};
}
