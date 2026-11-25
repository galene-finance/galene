// Run against the guarded synthetic fixture; never a live app.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const origin='http://127.0.0.1:24867',out=process.env.EVIDENCE_DIR;if(!out)throw Error('EVIDENCE_DIR required');fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});const records=[];let passed=false;
const red=process.argv.includes('--red');
try{
 const c=await browser.newContext({javaScriptEnabled:false,viewport:{width:1000,height:1100}});await c.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());const page=await c.newPage();
 const model=async()=> (await(await c.request.get(origin+'/__moveqa')).json()).model;
 const before=await model();assert.equal(before.assignableCents,0);assert.equal(before.cards[0].reservedCents,10000);
 await page.goto(origin+'/__move-native');const mf=page.locator('form[data-feature-form=move]'),rf=page.locator('form[data-feature-form=reserve]');
 await mf.locator('[name=from_category_id]').selectOption('1');await mf.locator('[name=to_category_id]').selectOption('2');await mf.locator('[name=amount]').fill('10.00');
 await rf.locator('[name=direction]').selectOption('release');await rf.locator('[name=amount]').fill('10.00');
 records.push({test:'actual SSR no-JS populated fields',moveDisabled:await mf.locator('button').isDisabled(),releaseDisabled:await rf.locator('button').isDisabled(),releaseText:await rf.locator('button').innerText(),moveValid:await mf.evaluate(e=>e.checkValidity()),reserveValid:await rf.evaluate(e=>e.checkValidity())});
 await page.screenshot({path:path.join(out,'native-populated.png'),fullPage:true});assert.deepEqual(await model(),before);
 if(red){assert.equal(records[0].moveDisabled,false);assert.equal(records[0].releaseDisabled,false);throw Error('Expected original defect to reproduce');}
 assert.equal(records[0].moveDisabled,false);assert.equal(records[0].releaseDisabled,false);assert.equal(records[0].releaseText,'Update reserve');
 async function nativeSave(form,status=200){const [response]=await Promise.all([page.waitForResponse(r=>r.url().includes('/__move-native')&&r.request().method()==='POST'),form.locator('button').click()]);await page.waitForLoadState();assert.equal(response.status(),status);}
 // Zero RTA must still reject adding reserve, even with the usable fallback button.
 await rf.locator('[name=direction]').selectOption('add');await nativeSave(rf,422);assert.deepEqual(await model(),before);assert.match(await page.locator('body').innerText(),/Not enough/);records.push({test:'native financial guard',passed:true});
 await mf.locator('[name=from_category_id]').selectOption('1');await mf.locator('[name=to_category_id]').selectOption('2');await mf.locator('[name=amount]').fill('10.00');await nativeSave(mf);
 let m=await model();assert.equal(m.categories.find(x=>x.id===1).availableCents,29000);assert.equal(m.categories.find(x=>x.id===2).availableCents,61000);assert.equal(m.cashCents,100000);records.push({test:'native move persisted',revision:m.revision});
 await rf.locator('[name=direction]').selectOption('release');await rf.locator('[name=amount]').fill('10.00');await nativeSave(rf);
 await page.goto(origin+'/__move-native');await page.reload();m=await model();assert.equal(m.cards[0].reservedCents,9000);assert.equal(m.readyToAssignCents,1000);assert.equal(m.cashCents,100000);records.push({test:'native release and GET reload',revision:m.revision});await page.screenshot({path:path.join(out,'native-saved.png'),fullPage:true});await c.close();
 const hc=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await hc.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());const hp=await hc.newPage(),errors=[];hp.on('pageerror',e=>errors.push(String(e)));await hp.goto(origin+'/move-money-fixture.html');
 const hm=hp.locator('form[data-feature-form=move]'),hr=hp.locator('form[data-feature-form=reserve]');await hm.waitFor();
 async function hydratedSave(form){await Promise.all([hp.waitForResponse(r=>r.url().includes('/__moveqa')&&r.request().method()==='POST'),form.locator('button').tap()]);await hp.waitForFunction(()=>!document.body.innerText.includes('Saving…'));}
 await hm.locator('[name=from_category_id]').selectOption('2');await hm.locator('[name=to_category_id]').selectOption('1');await hm.locator('[name=amount]').fill('10.00');await hydratedSave(hm);
 await hr.locator('[name=amount]').fill('10.00');assert.equal(await hr.locator('button').innerText(),'Add to reserve');await hydratedSave(hr);
 m=(await(await hc.request.get(origin+'/__moveqa')).json()).model;assert.equal(m.assignableCents,0);assert.equal(m.cards[0].reservedCents,10000);assert.equal(await hr.locator('button').isDisabled(),true);
 await hr.locator('[name=direction]').selectOption('release');await hr.locator('[name=amount]').fill('10.00');assert.equal(await hr.locator('button').isEnabled(),true);assert.equal(await hr.locator('button').innerText(),'Return reserve');await hydratedSave(hr);await hp.reload();await hm.waitFor();
 m=(await(await hc.request.get(origin+'/__moveqa')).json()).model;assert.equal(m.cards[0].reservedCents,9000);assert.equal(m.readyToAssignCents,1000);assert.equal(m.categories.find(x=>x.id===1).availableCents,30000);assert.equal(m.cashCents,100000);assert.equal(errors.length,0);records.push({test:'hydrated trusted-touch move/add/release/reload',revision:m.revision,errors});await hp.screenshot({path:path.join(out,'hydrated-saved.png'),fullPage:true});
 // Hydrated components without an async submit prop must preserve native POST fields.
 for(const kind of ['move','reserve']){
  await hp.goto(origin+'/move-money-fixture.html?native=1');const form=hp.locator(`form[data-feature-form=${kind}]`);await form.waitFor();
  if(kind==='move'){await form.locator('[name=from_category_id]').selectOption('1');await form.locator('[name=to_category_id]').selectOption('2');}else await form.locator('[name=direction]').selectOption('release');
  await form.locator('[name=amount]').fill('1.00');const [response]=await Promise.all([hp.waitForResponse(r=>r.url().includes('/__move-native')&&r.request().method()==='POST'),hp.waitForURL(origin+'/__move-native?kind='+kind,{waitUntil:'domcontentloaded'}),form.locator('button').tap()]);assert.equal(response.status(),200);
 }
 m=(await(await hc.request.get(origin+'/__moveqa')).json()).model;assert.equal(m.categories.find(x=>x.id===1).availableCents,29900);assert.equal(m.cards[0].reservedCents,8900);assert.equal(m.readyToAssignCents,1100);assert.equal(m.cashCents,100000);assert.equal(errors.length,0);records.push({test:'hydrated native POST preserves successful fields for both forms',revision:m.revision});await hc.close();passed=true;
}finally{fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed,red,records},null,2));await browser.close();}
