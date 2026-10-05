import {test,expect} from '@playwright/test'
import {publishFixture,loginAdmin,close,tab} from './activity-fixture'

test('旧发码页面迟到响应不能删除新操作材料；第二枚响应丢失可重载回收',async({browser})=>{
 test.setTimeout(90000)
 const pack=await publishFixture(browser,'grant-late-reply'),context=await browser.newContext(),page=await context.newPage()
 await page.goto('/admin');await loginAdmin(page)
 const open=async()=>{await page.getByRole('button',{name:new RegExp(pack.event.title)}).click();await page.getByRole('button',{name:'建队码',exact:true}).click();await expect(page.getByRole('button',{name:'生成建队码',exact:true})).toBeEnabled()}
 let releaseOld!:()=>void,releaseSecond!:()=>void,oldWritten!:()=>void,secondWritten!:()=>void
 const oldGate=new Promise<void>(r=>{releaseOld=r}),secondGate=new Promise<void>(r=>{releaseSecond=r}),firstWritten=new Promise<void>(r=>{oldWritten=r}),nextWritten=new Promise<void>(r=>{secondWritten=r})
 const bodies:unknown[]=[]
 await page.route('**/admin/creation-invites',async route=>{if(route.request().method()!=='POST')return route.continue();bodies.push(route.request().postDataJSON());const n=bodies.length,response=await route.fetch();expect(response.status()).toBe(200);if(n===1){oldWritten();await oldGate}else if(n===3){secondWritten();await secondGate;return route.abort('failed')}await route.fulfill({response})})
 try{
  await open();await page.getByRole('button',{name:'生成建队码',exact:true}).click();await firstWritten;await close(page)
  await open();await page.getByRole('button',{name:'生成建队码',exact:true}).click();await expect(page.getByLabel('新建队码')).toBeVisible();expect(bodies[1]).toEqual(bodies[0])
  await page.getByRole('button',{name:'生成建队码',exact:true}).click();await nextWritten
  const oldReply=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/admin/creation-invites'));releaseOld();await oldReply
  await expect.poll(()=>page.evaluate(()=>Object.keys(sessionStorage).filter(k=>k.startsWith('pending-admin-creation:')).length)).toBe(1)
  releaseSecond();await expect(page.getByRole('dialog').getByRole('alert')).toContainText('连接失败')
  await page.reload();await open();await page.getByRole('button',{name:'生成建队码',exact:true}).click();await expect(page.getByLabel('新建队码')).toBeVisible()
  expect(bodies).toHaveLength(4);expect(bodies[3]).toEqual(bodies[2]);expect(bodies[2]).not.toEqual(bodies[0]);await expect(page.locator('.figma-code-history-row')).toHaveCount(2)
 }finally{releaseOld();releaseSecond();await context.close()}
})

for(const failA of [false,true])test(`创建A期间切B保持独立busy，A${failA?'失败':'成功'}不解锁B的新请求`,async({browser})=>{
 test.setTimeout(90000)
 const a=await publishFixture(browser,`create-switch-a-${failA}`),b=await publishFixture(browser,`create-switch-b-${failA}`),context=await browser.newContext(),page=await context.newPage()
 let releaseA!:()=>void,releaseB!:()=>void,wroteA!:()=>void,wroteB!:()=>void
 const gateA=new Promise<void>(r=>{releaseA=r}),gateB=new Promise<void>(r=>{releaseB=r}),writtenA=new Promise<void>(r=>{wroteA=r}),writtenB=new Promise<void>(r=>{wroteB=r})
 const attempts:{sourceEventId:string;operationId:string}[]=[]
 await page.route('**/api/v1/groups',async route=>{if(route.request().method()!=='POST')return route.continue();const body=route.request().postDataJSON();attempts.push(body);const firstA=body.sourceEventId===a.event.id&&attempts.filter(x=>x.sourceEventId===a.event.id).length===1;if(firstA&&failA){wroteA();await gateA;return route.fulfill({status:403,json:{error:{code:'FORBIDDEN',message:'测试中的明确拒绝，可纠正后重试'}}})}const response=await route.fetch();expect(response.status()).toBe(200);if(firstA){wroteA();await gateA}else if(body.sourceEventId===b.event.id){wroteB();await gateB}await route.fulfill({response})})
 const switchTo=async(title:string)=>{await page.getByRole('button',{name:'切换活动',exact:true}).click();await page.getByRole('dialog',{name:'切换活动'}).getByRole('button',{name:new RegExp(title)}).click();await tab(page,'同行')}
 try{
  await page.goto(`/events/${a.event.id}?view=companions`);await page.getByLabel('小队标题').fill('A待创建小队');await page.getByRole('button',{name:'创建',exact:true}).click();await writtenA
  await switchTo(b.event.title);await expect(page.getByLabel('小队标题')).toBeEnabled();await page.getByLabel('小队标题').fill('B新请求小队');await expect(page.getByRole('button',{name:'创建',exact:true})).toBeEnabled()
  await page.getByRole('button',{name:'创建',exact:true}).click();await writtenB
  const oldReply=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/groups'));releaseA();await oldReply
  await expect(page.getByRole('button',{name:'创建中',exact:true})).toBeDisabled();await expect(page.getByLabel('小队标题')).toBeDisabled();expect(attempts.filter(x=>x.sourceEventId===b.event.id)).toHaveLength(1)
  releaseB();await expect(page.getByRole('button',{name:'日程设置',exact:true})).toBeVisible();await switchTo(a.event.title)
  if(failA){await page.getByLabel('小队标题').fill('A待创建小队');await expect(page.getByRole('button',{name:'创建',exact:true})).toBeEnabled();await page.getByRole('button',{name:'创建',exact:true}).click();await expect(page.getByRole('button',{name:'日程设置',exact:true})).toBeVisible();const xs=attempts.filter(x=>x.sourceEventId===a.event.id);expect(xs).toHaveLength(2);expect(xs[0].operationId).not.toBe(xs[1].operationId)}else{await expect(page.getByRole('button',{name:'A待创建小队',exact:true})).toBeVisible();expect(attempts.filter(x=>x.sourceEventId===a.event.id)).toHaveLength(1)}
 }finally{releaseA();releaseB();await context.close()}
})

test('管理员换活动和会话隔离待发码；注销后旧响应不能复活材料',async({browser})=>{
 test.setTimeout(90000)
 const a=await publishFixture(browser,'grant-scope-a'),b=await publishFixture(browser,'grant-scope-b'),context=await browser.newContext(),page=await context.newPage()
 await page.goto('/admin');await loginAdmin(page)
 let release!:()=>void,wrote!:()=>void;const gate=new Promise<void>(r=>{release=r}),written=new Promise<void>(r=>{wrote=r}),bodies:{eventId:string;operationId:string}[]=[]
 await page.route('**/admin/creation-invites',async route=>{if(route.request().method()!=='POST')return route.continue();bodies.push(route.request().postDataJSON());const response=await route.fetch();expect(response.status()).toBe(200);if(bodies.length===1){wrote();await gate}await route.fulfill({response})})
 const open=async(title:string)=>{await page.getByRole('button',{name:new RegExp(title)}).click();await page.getByRole('button',{name:'建队码',exact:true}).click();await expect(page.getByRole('button',{name:'生成建队码',exact:true})).toBeEnabled()}
 try{
  await open(a.event.title);await page.getByRole('button',{name:'生成建队码',exact:true}).click();await written;await close(page)
  await open(b.event.title);await page.getByRole('button',{name:'生成建队码',exact:true}).click();await expect(page.getByLabel('新建队码')).toBeVisible();expect(bodies[0].eventId).toBe(a.event.id);expect(bodies[1].eventId).toBe(b.event.id);expect(bodies[0].operationId).not.toBe(bodies[1].operationId);await close(page)
  await expect.poll(()=>page.evaluate(()=>Object.keys(sessionStorage).filter(k=>k.startsWith('pending-admin-creation:')).length)).toBe(1)
  await page.getByRole('button',{name:'退出登录',exact:true}).click();await expect(page.getByLabel('管理员密码')).toBeVisible()
  expect(await page.evaluate(()=>Object.keys(sessionStorage).filter(k=>k.startsWith('pending-admin-creation:')).length)).toBe(0)
  const oldReply=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/admin/creation-invites'));release();await oldReply
  await loginAdmin(page);await open(a.event.title);await page.getByRole('button',{name:'生成建队码',exact:true}).click();await expect(page.getByLabel('新建队码')).toBeVisible();expect(bodies[2].eventId).toBe(a.event.id);expect(bodies[2].operationId).not.toBe(bodies[0].operationId);await expect(page.locator('.figma-code-history-row')).toHaveCount(2)
 }finally{release();await context.close()}
})
