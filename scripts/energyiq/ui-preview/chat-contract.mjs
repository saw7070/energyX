import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {fixture} from './fixtures.mjs';
const require=createRequire(import.meta.url);const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});const results=[];let sends=0;let running=false;
await page.route('**/api/v1/**',async route=>{const url=new URL(route.request().url());let data=fixture(url.pathname);if(route.request().method()!=='GET'){sends++;await route.fulfill({status:405,json:{success:false,error:{code:'PREVIEW_ONLY',message:'Read-only preview'}}});return;}
if(url.pathname.includes('/events'))data={events:[{sequence:1,time:'2026-09-12T08:00:00Z',type:'tool_started',tool:'run_sql_readonly'},{sequence:2,time:'2026-09-12T08:00:02Z',type:'tool_completed',tool:'run_sql_readonly'},{sequence:3,time:'2026-09-12T08:00:04Z',type:'completed'}].filter(e=>e.sequence>Number(url.searchParams.get('after')||0))};
else if(url.pathname.endsWith('/report-agent/ui-demo'))data={...data,runs:Array.from({length:8},(_,i)=>({...data.runs[0],id:i===7?'report-0':`turn-${i}`,kind:'chat',hasReport:false,prompt:i===0?'Long message. '.repeat(65):`Question ${i+1}: Review energy consumption.`,status:i===7&&running?'running':'succeeded',createdAt:`2026-09-12T08:0${i}:00Z`}))};
await route.fulfill({json:{success:true,data}});});
await page.goto('http://127.0.0.1:3185/energyiq/reports?projectId=ui-demo&sessionId=new',{waitUntil:'networkidle'});
const input=page.getByRole('textbox',{name:'Report instructions'});await input.fill('Check consumption');await input.press('Shift+Enter');assert.equal(sends,0);assert.match(await input.inputValue(),/\n/);await input.dispatchEvent('keydown',{key:'Enter',isComposing:true,bubbles:true});assert.equal(sends,0);await input.press('Enter');await page.getByRole('alert').filter({hasText:'Read-only preview'}).waitFor();assert.equal(sends,1);results.push('Enter sends once; Shift+Enter and IME composition do not send');
await page.goto('http://127.0.0.1:3185/energyiq/reports?projectId=ui-demo&sessionId=demo-chat',{waitUntil:'networkidle'});
const history=page.getByLabel('Conversation history');await history.evaluate(el=>el.scrollTop=0);await page.getByRole('button',{name:'Scroll to latest message'}).waitFor();await page.getByRole('button',{name:'Scroll to latest message'}).click();assert.equal(await history.evaluate(el=>el.scrollHeight-el.scrollTop-el.clientHeight<80),true);results.push('Long transcript scroll and return-to-latest work');
await page.locator('article').last().locator('details').first().locator('summary').click();await page.locator('article').last().locator('li').filter({hasText:'run_sql_readonly'}).first().waitFor();await page.screenshot({path:'artifacts/ui-preview/chat-process-desktop.png'});results.push('Execution disclosure displays returned tool records');
await page.getByRole('button',{name:'This month',exact:true}).click();assert.equal(await page.getByRole('button',{name:'This month',exact:true}).getAttribute('aria-pressed'),'true');await page.locator('details').filter({has:page.getByLabel('Start date',{exact:true})}).locator('summary').click();await page.getByLabel('Start date',{exact:true}).waitFor();results.push('One-click preset and direct custom dates work');

running=true;await page.reload({waitUntil:'networkidle'});await page.getByRole('button',{name:'Stop generating',exact:true}).waitFor();await page.getByRole('button',{name:'Stop generating',exact:true}).click();assert.equal(sends,2);results.push('Active run exposes a working stop action');
writeFileSync('artifacts/ui-preview/chat-contract.json',JSON.stringify(results,null,2));console.log(results);await browser.close();

