import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
mkdirSync('artifacts/ui-preview',{recursive:true});
for(const [name,path] of [['chat','reports?projectId=ui-demo&sessionId=new'],['library','library?projectId=ui-demo'],['skills','skills?projectId=ui-demo'],['configuration','project-configuration?projectId=ui-demo'],['preview','reports?projectId=ui-demo&sessionId=demo-chat']]){
 await page.goto('http://127.0.0.1:3185/energyiq/'+path,{waitUntil:'networkidle',timeout:120000});
 await page.screenshot({path:'artifacts/ui-preview/'+name+'-desktop.png'});
 console.log(name,(await page.locator('body').innerText()).slice(0,1100));
 if(name==='preview' && await page.getByRole('button',{name:/Weekly energy review/}).count()) {await page.getByRole('button',{name:/Weekly energy review/}).first().click();await page.waitForTimeout(800);await page.screenshot({path:'artifacts/ui-preview/preview-desktop.png'});}
}
await page.setViewportSize({width:390,height:844});
await page.evaluate(()=>localStorage.setItem('energyiq:sidebar-collapsed:v1','true'));
for(const [name,path] of [['chat','reports?projectId=ui-demo&sessionId=new'],['library','library?projectId=ui-demo'],['skills','skills?projectId=ui-demo'],['configuration','project-configuration?projectId=ui-demo']]){
 await page.goto('http://127.0.0.1:3185/energyiq/'+path,{waitUntil:'networkidle',timeout:120000});
 await page.screenshot({path:'artifacts/ui-preview/'+name+'-mobile.png'});
 console.log(name,'overflow',await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth));
}
writeFileSync('artifacts/ui-preview/errors.json',JSON.stringify(errors,null,2));await browser.close();
