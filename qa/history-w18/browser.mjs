import {chromium} from 'playwright';import assert from 'node:assert/strict';import {mkdirSync,writeFileSync} from 'node:fs';
const origin=process.env.HISTORY_ORIGIN??'http://127.0.0.1:4198';const output=process.env.HISTORY_EVIDENCE_DIR;if(!output)throw new Error('Set HISTORY_EVIDENCE_DIR');mkdirSync(output,{recursive:true});
const browser=await chromium.launch({headless:true,channel:process.env.HISTORY_BROWSER_CHANNEL??'chrome'});const results=[];
try{
 for(const width of [390,768,1440])for(const theme of ['graphite','ocean','dark']){
  const context=await browser.newContext({viewport:{width,height:950},hasTouch:width===390,isMobile:width===390});
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  const page=await context.newPage();await page.goto(`${origin}/?theme=${theme}`);
  await page.getByRole('heading',{name:'Net worth over time'}).waitFor();
  assert.equal(await page.locator('svg circle').count(),3);
  const summary=page.locator('.history-day summary').first();await summary.focus();await page.keyboard.press('Enter');assert.equal(await page.locator('.history-day').first().getAttribute('open'),'');
  assert.ok(await page.getByText('Known subtotal: USD 1,250.00').isVisible());
  const geometry=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,buttons:[...document.querySelectorAll('button')].map(b=>b.getBoundingClientRect().height)}));assert.ok(geometry.scroll<=geometry.width,JSON.stringify(geometry));assert.ok(geometry.buttons.every(h=>h>=44));
  const contrasts=await page.locator('.financial-badge').evaluateAll(nodes=>nodes.map(node=>{const style=getComputedStyle(node);const lum=c=>{const rgb=c.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722};const a=lum(style.color),b=lum(style.backgroundColor);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);}));assert.ok(contrasts.every(c=>c>=4.5),JSON.stringify(contrasts));
  await page.screenshot({path:`${output}/${theme}-${width}.png`,fullPage:true});results.push({theme,width,overflow:false,minimumBadgeContrast:Math.min(...contrasts),keyboardDisclosure:true});await context.close();
 }
 const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});const page=await context.newPage();
 await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 await page.goto(origin);
 // Native date validation blocks submit before any network request.
 const date=page.locator('[name=date_from]');await date.fill('2026-11-26');assert.equal(await date.evaluate(n=>n.checkValidity()),false);await date.fill('2026-11-21');
 await page.evaluate(()=>{window.touchEvidence=[];for(const event of ['touchstart','touchend'])document.addEventListener(event,e=>window.touchEvidence.push({type:e.type,trusted:e.isTrusted}),{passive:true});});
 const touch=[];page.on('console',()=>{});await page.exposeFunction('recordTouch',event=>touch.push(event));await page.evaluate(()=>document.addEventListener('touchstart',e=>window.recordTouch({type:e.type,trusted:e.isTrusted}),{passive:true}));
 await Promise.all([page.waitForURL('**saved=1'),page.getByRole('button',{name:'Save balance evidence for Synthetic debt'}).tap()]);
 assert.ok(touch.some(e=>e.trusted));assert.ok(await page.getByText('Evidence saved and reloaded from the synthetic database.').isVisible());
 await page.reload();assert.equal(await page.locator('svg circle').count(),4);await page.locator('.history-day summary').first().click();assert.ok(await page.getByText('Synthetic accepted debt estimate; statement plus allocated payments. Not a bank-verified balance.').first().isVisible());
 assert.match(await page.locator('header').first().innerText(),/-USD\s+50\.00/);
 await page.locator('[name=date_from]').fill('2026-11-24');await Promise.all([page.waitForURL('**date_from=2026-11-24**'),page.getByRole('button',{name:'Show history'}).tap()]);assert.equal(await page.locator('.history-day').count(),2);await page.reload();assert.equal(await page.locator('[name=date_from]').inputValue(),'2026-11-24');
 for(const mode of ['readonly','unsupported','denied']){await page.goto(`${origin}/?mode=${mode}`);assert.equal(await page.locator('form[method=POST]').count(),0);}
 await page.goto(`${origin}/?mode=mixed`);assert.equal(await page.locator('svg circle').count(),0);assert.ok(await page.getByText('Different currencies',{exact:true}).isVisible());
 await page.goto(`${origin}/?date_from=2026-02-30&date_to=2026-11-25`);assert.ok(await page.getByRole('alert').isVisible());
 const denied=await context.request.post(`${origin}/?mode=readonly`,{headers:{Origin:origin},form:{history_offer:'synthetic-debt-25',revision:'8',key:'denied'}});assert.equal(denied.status(),400);
 const csrf=await context.request.post(origin,{headers:{Origin:'https://invalid.example'},form:{}});assert.equal(csrf.status(),403);
 results.push({nativeTouchCapture:true,touch,fullBrowserReload:true,sqliteReopenedEachRequest:true,negativeNetWorth:'USD -50.00',nativeDateValidation:true,unsupportedReadOnlyHidden:true,mixedCurrencyHidden:true,originDenied:true});await context.close();
 writeFileSync(`${output}/results.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
}finally{await browser.close();}
