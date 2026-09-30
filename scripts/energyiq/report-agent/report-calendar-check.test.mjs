import { it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reviewReport, checkReportDates } from './report-review.mjs';
it('does not publish a model-approved report with an incorrect visible weekday', async () => {
 const directory=mkdtempSync(join(tmpdir(),'report-calendar-'));
 try {
  writeFileSync(join(directory,'report.html'),'<html><body>Generated: <strong>Sun</strong> 14 Sep 2026</body></html>');
  const result=await reviewReport({directory,method:'review',event:()=>{},prompt:async()=>writeFileSync(join(directory,'review.json'),JSON.stringify({status:'pass',checks:[{evidence:'checked'}],issues:[]}))});
  expect(result.status).toBe('blocked');
 } finally {rmSync(directory,{recursive:true,force:true});}
});

it('accepts calculated weekdays and ignores script examples',()=>{
 expect(checkReportDates('<html><body>Mon, 14 September 2026; Monday September 14, 2026; Mon 2026-09-14<script>"Sun 14 Sep 2026"</script></body></html>').issues).toEqual([]);
 expect(checkReportDates('SUN 14 SEP 2026').issues).toHaveLength(1);
});
it('accepts a revision only after the incorrect date is actually corrected',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'report-calendar-repair-'));let calls=0;
 try {
 writeFileSync(join(directory,'report.html'),'<html><body>Sun 14 Sep 2026</body></html>');
 const result=await reviewReport({directory,method:'review',event:()=>{},prompt:async()=>{calls++;if(calls===2)writeFileSync(join(directory,'report.html'),'<html><body>Mon 14 Sep 2026</body></html>');writeFileSync(join(directory,'review.json'),JSON.stringify({status:'pass',checks:[{evidence:'calendar checked'}],issues:[]}));}});
 expect(calls).toBe(2);expect(result.status).toBe('pass');
 }finally{rmSync(directory,{recursive:true,force:true});}
});
