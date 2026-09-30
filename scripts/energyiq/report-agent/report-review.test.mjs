import { it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reviewReport, checkCustomerReportContent } from './report-review.mjs';

it('detects internal replay prose without banning site tests, display demonstrations or estimates', () => {
 expect(checkCustomerReportContent('<p>The implementation was a <b>QA</b> replay.</p>').issues).toHaveLength(1);
 expect(checkCustomerReportContent('<p>Historical QA/demo records are not customer evidence.</p>').issues).toHaveLength(1);
 expect(checkCustomerReportContent('<p>Confirm showroom demonstrations. Simulated savings need a site test.</p><!-- QA replay --><script>"QA replay"</script>').issues).toHaveLength(0);
});

it('blocks a model pass when internal test prose survives the one revision', async () => {
 const directory=mkdtempSync(join(tmpdir(),'review-customer-'));
 try {
  writeFileSync(join(directory,'report.html'),'<p>Implementation was a QA replay.</p>');
  let calls=0;
  const result=await reviewReport({directory,method:'review',event:()=>{},prompt:async()=>{calls++;writeFileSync(join(directory,'review.json'),JSON.stringify({status:'pass',checks:[{evidence:'numbers checked'}],issues:[]}));}});
  expect(calls).toBe(2);
  expect(result.status).toBe('blocked');
  expect(result.issues.some(i=>i.problem.includes('Internal test history'))).toBe(true);
 } finally {rmSync(directory,{recursive:true,force:true});}
});

it('skips ordinary chat and revises a report once with archived evidence', async () => {
 const directory = mkdtempSync(join(tmpdir(), 'review-test-'));
 try {
  let calls = 0; const events = [];
  const prompt = async () => {
   calls++;
   if (calls === 2) writeFileSync(join(directory,'report.html'), '<html>Corrected</html>');
   writeFileSync(join(directory,'review.json'), JSON.stringify({status:calls===1?'revise':'pass',checks:[{evidence:'facts.csv'}],issues:[{problem:'wrong total',resolved:calls===2}]}));
  };
  expect(await reviewReport({directory,prompt,event:e=>events.push(e)})).toBeUndefined();
  expect(calls).toBe(0);
  writeFileSync(join(directory,'report.html'),'<html>Draft</html>');
  const result = await reviewReport({directory,prompt,method:'review',event:e=>events.push(e)});
  expect(calls).toBe(2); expect(result.status).toBe('pass');
  expect(readFileSync(join(directory,'report-draft.html'),'utf8')).toContain('Draft');
  expect(events).toEqual(['review_started','revision_started','review_passed']);
 } finally { rmSync(directory,{recursive:true,force:true}); }
});
it('keeps blocked drafts and rejects a false pass with unresolved issues', async () => {
 const directory=mkdtempSync(join(tmpdir(),'review-test-'));
 try {
  writeFileSync(join(directory,'report.html'),'<html>Draft</html>');
  for (const status of ['blocked','pass']) {
   const action=reviewReport({directory,method:'review',event:()=>{},prompt:async()=>writeFileSync(join(directory,'review.json'),JSON.stringify({status,checks:['source missing'],issues:[{resolved:false}]}))});
   if(status==='blocked') expect((await action).status).toBe('blocked');
   else await expect(action).rejects.toThrow('REPORT_REVIEW_INVALID');
  }
 } finally {rmSync(directory,{recursive:true,force:true});}
});

it('blocks a claimed pass when final browser validation still fails', async () => {
 const directory=mkdtempSync(join(tmpdir(),'review-browser-'));
 try {
  writeFileSync(join(directory,'report.html'),'<html>Overflow</html>');
  let calls=0;
  const browserCheck=async()=>{const result={checks:[{evidence:'390px measured 600px'}],issues:[{problem:'overflow',resolved:false}]};writeFileSync(join(directory,'browser-check.json'),JSON.stringify(result));return result;};
  const result=await reviewReport({directory,method:'review',event:()=>{},browserCheck,prompt:async()=>{calls++;writeFileSync(join(directory,'review.json'),JSON.stringify({status:'pass',checks:[{evidence:'numbers checked'}],issues:[]}));}});
  expect(calls).toBe(2);expect(result.status).toBe('blocked');expect(result.issues.some(i=>i.problem==='overflow')).toBe(true);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
