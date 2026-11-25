import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const origin=process.env.QA_ORIGIN??'http://127.0.0.1:24869';
const out=resolve(process.env.QA_OUTPUT??'supporting-qa-results');mkdirSync(out,{recursive:true});
const baseline=process.env.QA_BASELINE==='1', results=[];
const browser=await chromium.launch({channel:'chrome',headless:true});
async function record(name,fn){try{await fn();results.push({name,pass:true});}catch(e){results.push({name,pass:false,error:String(e)});}writeFileSync(resolve(out,'results.json'),JSON.stringify(results,null,2));}
function check(value,message){if(!value)throw Error(message);}
try{
for(const theme of baseline?['graphite']:['graphite','ocean','dark'])for(const width of baseline?[390]:[390,1280]){
 const context=await browser.newContext({viewport:{width,height:900},hasTouch:width===390,isMobile:width===390});
 const page=await context.newPage();page.setDefaultTimeout(6000);
 await page.addInitScript(()=>{window.__qaTouches=[];document.addEventListener('touchstart',e=>window.__qaTouches.push({type:e.type,trusted:e.isTrusted}),true);});
 await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 const tag=`${theme}-${width}`;
 await record(`${tag}: cashflow detail hierarchy and filled semantic amounts`,async()=>{
  await page.goto(`${origin}/cashflow?theme=${theme}`);await page.getByRole('heading',{name:'Cashflow',exact:true}).waitFor();
  const drillButton=page.getByRole('row').filter({hasText:'Sample groceries'}).getByRole('button').first();
  const target=await drillButton.boundingBox();check(target.height>=44&&target.width>=44,'Drilldown touch target below44px');
  if(width===390)await drillButton.tap();else{await drillButton.focus();await page.keyboard.press('Enter');}
  const dialog=page.getByRole('dialog');await dialog.waitFor();
  await page.screenshot({path:resolve(out,`${tag}-cashflow-detail.png`),fullPage:false});
  check(await dialog.locator('.financial-badge').count()>=2,'Actual contribution badges absent');
  check((await dialog.innerText()).includes('Included refund'),'Refund is not separately labelled');
  check(await dialog.locator('time').count()===2,'Dates are not semantic subordinate time elements');
  check((await dialog.getByRole('link',{name:'Open in activity'}).getAttribute('href')).includes('status=posted'),'Posted activity scope lost');
  const layout=await dialog.locator('li').first().evaluate(el=>{const a=el.querySelector('a').getBoundingClientRect(),t=el.querySelector('time').getBoundingClientRect();return t.top>=a.bottom-1;});check(layout,'Date is not below name');
  await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
 });
 await record(`${tag}: calendar popup Escape, date selection, empty day and form`,async()=>{
  await page.goto(`${origin}/calendar?month=2026-11&theme=${theme}`);await page.getByRole('heading',{name:'November 2026'}).waitFor();
  if(width===390){
   await page.getByRole('button',{name:'Select 2026-11-15',exact:true}).first().tap();
   const item=page.getByRole('article',{name:'Selected day'}).getByRole('button').filter({hasText:'Sample market'});await item.tap();
  }else{await page.getByRole('button').filter({hasText:'Sample market'}).first().focus();}
  await page.locator('#calendar-pill-popup').waitFor();
  if(width===390)check(await page.evaluate(()=>window.__qaTouches.some(e=>e.trusted)),'No trusted touch event');
  await page.screenshot({path:resolve(out,`${tag}-calendar-popup.png`),fullPage:false});
  await page.keyboard.press('Escape');await page.locator('#calendar-pill-popup').waitFor({state:'hidden'});
  check(await page.locator('[aria-describedby="calendar-pill-popup"]').count()===0,'Stale accessible popup description');
  if(width===390){check(await page.getByRole('group',{name:'Week days'}).count()===1,'Week selection falsely advertises tabs');await page.getByRole('button',{name:'Select 2026-11-02',exact:true}).first().tap();check((await page.getByRole('article',{name:'Selected day'}).innerText()).includes('Nothing on this day'),'Empty day unavailable');}
  const add=page.getByRole('button',{name:'+ New scheduled',exact:true});await add.focus();await page.keyboard.press('Enter');await page.getByRole('dialog').waitFor();check(await page.getByRole('dialog').locator('input').count()>0,'Scheduled form absent');await page.keyboard.press('Escape');
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Page horizontally overflows');
 });
 await record(`${tag}: forecast detail and failed filter recovery`,async()=>{
  await page.goto(`${origin}/cashflow?theme=${theme}`);
  const button=page.getByRole('row').filter({hasText:'Sample salary'}).getByRole('button').first();
  await button.focus();await page.keyboard.press('Enter');
  const dialog=page.getByRole('dialog');await dialog.waitFor();
  check((await dialog.innerText()).includes('Scheduled expectation'),'Forecast label absent');
  check(await dialog.locator('.financial-badge[data-tone="neutral"]').count()>0,'Forecast is not neutral');
  check(await dialog.locator('time').count()>0,'Forecast date absent');
  await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
  await page.getByRole('button',{name:'Cashflow filters',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Save',exact:true}).click();
  await page.getByRole('alert').waitFor();check((await page.getByRole('alert').innerText()).includes('Could not confirm'),'Disabled save did not expose failure');
  await page.getByRole('button',{name:'Review filters',exact:true}).click();await page.getByRole('dialog').waitFor();await page.getByRole('button',{name:'Cancel',exact:true}).click();
 });
 await record(`${tag}: unchanged Accounts/Activity/Settings smoke`,async()=>{
  await page.goto(`${origin}/accounts?theme=${theme}`);await page.getByRole('heading',{name:'Accounts',exact:true}).waitFor();
  const search=page.getByPlaceholder('Search accounts');await search.fill('not-a-real-account');await page.getByText('No matching accounts',{exact:true}).waitFor();await search.fill('checking');
  await page.locator('a[href="/accounts/1"]').click();await page.waitForURL('**/accounts/1');check((await page.locator('main').innerText()).includes('Sample checking'),'Account detail missing');
  await page.goto(`${origin}/transactions?q=not-a-real-merchant&theme=${theme}`);await page.getByRole('heading',{name:'Activity',exact:true}).waitFor();check((await page.locator('main').innerText()).toLowerCase().includes('no '),'No empty activity state');
  await page.goto(`${origin}/transactions/2?theme=${theme}`);check(await page.locator('main').getByText('Sample market',{exact:true}).count()>0,'Transaction detail missing');
  await page.goto(`${origin}/settings?theme=${theme}`);await page.getByRole('heading',{name:'Settings',exact:true}).waitFor();check(await page.locator('main a[href="/settings/accounts"]').count()===1,'Native settings destination missing');
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Settings horizontally overflows');
 });
 await context.close();
}
}finally{await browser.close();}
console.log(JSON.stringify(results,null,2));if(results.some(r=>!r.pass))process.exitCode=1;
