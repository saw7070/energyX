import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
const require=createRequire(import.meta.url);const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});const results=[];
await page.goto('http://127.0.0.1:3185/energyiq/reports?projectId=ui-demo&sessionId=new',{waitUntil:'networkidle'});
await page.getByRole('button',{name:'Create an energy report',exact:true}).click();
assert.equal(await page.locator('textarea').inputValue(),'Create an energy report for the selected period.');
assert.equal(await page.locator('textarea').evaluate(el=>document.activeElement===el),true);results.push('Starter fills and focuses composer without sending');
await page.screenshot({path:'artifacts/ui-preview/chat-mobile-composer.png'});
assert.equal(await page.getByRole('button',{name:'Send message',exact:true}).evaluate(el=>getComputedStyle(el).transitionDuration),'0s');results.push('Reduced motion disables button transitions');
await page.getByRole('button',{name:'Expand sidebar',exact:true}).click();assert.equal(await page.getByRole('link',{name:'New conversation',exact:true}).isVisible(),true);await page.getByRole('button',{name:'Close navigation overlay'}).click({position:{x:370,y:40}});results.push('Mobile navigation overlay opens and closes');
await page.goto('http://127.0.0.1:3185/energyiq/library?projectId=ui-demo',{waitUntil:'networkidle'});await page.getByRole('button',{name:'Open Weekly energy review · Demo',exact:true}).click();await page.getByRole('dialog').waitFor();await page.locator('iframe[title="HTML report preview"]').waitFor();await page.screenshot({path:'artifacts/ui-preview/preview-mobile.png'});await page.getByRole('button',{name:'Source',exact:true}).click();assert.equal(await page.getByRole('dialog').locator('pre').count(),1);await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);results.push('Mobile report opens in modal, Source works and Escape closes');
await page.goto('http://127.0.0.1:3185/energyiq/skills?projectId=ui-demo',{waitUntil:'networkidle'});await page.getByRole('tab',{name:'Tools',exact:true}).click();await page.getByText('run_sql_readonly',{exact:true}).waitFor();results.push('Tools tab shows fixture-provided tools');
await page.getByRole('tab',{name:'Skills',exact:true}).click();await page.getByRole('button',{name:'Open Skill Energy investigation',exact:true}).click();await page.getByRole('dialog').waitFor();await page.keyboard.press('Escape');results.push('Skill detail dialog opens and dismisses');
await page.route('**/api/v1/energy/report-library/**',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({success:false,error:{code:'UNAVAILABLE',message:'Visual test: unavailable'}})}));
await page.goto('http://127.0.0.1:3185/energyiq/library?projectId=ui-demo',{waitUntil:'networkidle'});assert.match(await page.locator('body').innerText(),/unavailable/i);results.push('Library request failure is visibly reported');
writeFileSync('artifacts/ui-preview/interactions.json',JSON.stringify(results,null,2));console.log(results);await browser.close();

