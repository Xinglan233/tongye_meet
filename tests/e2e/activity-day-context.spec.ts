import {test,expect} from '@playwright/test'
import {publishFixture,imageFixture,tab,close} from './activity-fixture'

// Functional assertions deliberately use the existing controls and factual content.
test('探索、搜索、地点详情和计划保留所选日期，收藏不占用时间',async({browser})=>{
 const pack=await publishFixture(browser,'field-date',undefined,pack=>{
  pack.event.endDate='2026-10-04';pack.event.days.push({...structuredClone(pack.event.days[0]),date:'2026-10-04'})
  pack.event.activities.push({id:'day-two',title:'第二天专属场次',sessions:[{id:'day-two-session',date:'2026-10-04',start:'14:00',end:'14:30',poiId:'poi-a'}]})
  pack.event.extensions!.convention.pois[0].sourceNote='原始公布资料 https://example.com/'+ 'long-source-path'.repeat(30)+'；点位未经现场复核。'
 })
 const context=await browser.newContext({viewport:{width:390,height:900}}),page=await context.newPage();await imageFixture(page)
 await page.goto(`/events/${pack.event.id}?date=2026-10-04&browse=list`)
 await expect(page.locator('.day-strip .on')).toHaveText('10/04')
 await expect(page.locator('.page .sched-day')).toContainText('第二天专属场次')
 await expect(page.locator('.page .sched-day')).not.toContainText('13:07')
 await page.getByLabel('搜索地点').fill('示例地点 A')
 await page.locator('.activity-place-pane .sched-row').click()
 const detail=page.getByRole('dialog');await expect(detail.locator('.figma-poi-sessions')).toContainText('14:00–14:30')
 await expect(detail.getByRole('link',{name:'资料来源',exact:true})).toBeVisible()
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 await detail.getByRole('button',{name:'收藏',exact:true}).click();await expect(detail.getByRole('button',{name:'取消收藏',exact:true})).toBeVisible();await close(page)
 await tab(page,'计划');await expect(page.locator('.day-strip .on')).toHaveText('10/04');await expect(page.getByText('当天还没有安排',{exact:true})).toBeVisible()
 await tab(page,'探索');await expect(page.getByLabel('搜索地点')).toHaveValue('示例地点 A');await expect(page.locator('.day-strip .on')).toHaveText('10/04')
 await page.getByRole('button',{name:'10/03',exact:true}).click();await expect(page.locator('.page .sched-day')).toContainText('13:07');await expect(page.locator('.page .sched-day')).not.toContainText('第二天专属场次')
 await page.reload();await expect(page.locator('.day-strip .on')).toHaveText('10/03');await expect(page.getByLabel('搜索地点')).toHaveValue('示例地点 A')
 await context.close()
})

test('已缓存活动列表在背景刷新延迟时立即可用',async({page,browser})=>{
 await publishFixture(browser,'field-list-cache')
 await page.goto('/');await expect(page.locator('.figma-event-select')).toBeVisible()
 // Warm the real persistent cache before measuring the separate cached startup.
 await expect.poll(async()=>{
  const cached=await page.evaluate(async()=>new Promise<unknown>(resolve=>{const r=indexedDB.open('coukong-online-v1',1);r.onsuccess=()=>{const q=r.result.transaction('records').objectStore('records').get('published-activity-list');q.onsuccess=()=>{resolve(q.result);r.result.close()}}}))
  return Array.isArray(cached)&&cached.length>0
 }).toBe(true)
 let release!:()=>void;const stalled=new Promise<void>(resolve=>{release=resolve})
 await page.route('**/api/v1/events',async route=>{await stalled;await route.continue().catch(()=>{})})
 try{await page.reload();await expect(page.locator('.activity-list-group .sched-row').first()).toBeVisible({timeout:3000})}finally{release()}
})

test('公开活动直接建队、加入本人并保存管理邀请权限',async({browser})=>{
 const pack=await publishFixture(browser,'field-public-create'),context=await browser.newContext(),page=await context.newPage();await imageFixture(page)
 await page.goto(`/events/${pack.event.id}?view=companions`)
 await expect(page.getByLabel('建队码',{exact:true})).toHaveCount(0)
 await page.getByLabel('小队标题').fill('公开直接小隊')
 const creation=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname.endsWith('/groups'))
 const joined=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname.endsWith('/join'))
 await page.getByRole('button',{name:'创建',exact:true}).click();const result=await creation;expect(result.status()).toBe(200);expect(result.request().postDataJSON()).not.toHaveProperty('creationCode');expect((await joined).status()).toBe(200)
 await expect(page.getByRole('button',{name:'日程设置',exact:true})).toBeVisible();await expect(page.getByLabel('怎么称呼')).toHaveCount(0)
 await context.close()
})

test('创建者加入失败不会重建小队，原加入令牌与操作可重试',async({browser})=>{
 const pack=await publishFixture(browser,'field-create-join-retry'),context=await browser.newContext(),page=await context.newPage();await imageFixture(page)
 await page.goto(`/events/${pack.event.id}?view=companions`)
 const writes:unknown[]=[];let joins=0
 await page.route('**/api/v1/groups/*/join',async route=>{writes.push(route.request().postDataJSON());if(joins++===0)await route.abort('failed');else await route.continue()})
 await page.getByLabel('小队标题').fill('加入可恢复小队')
 let creates=0;page.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname.endsWith('/groups'))creates++})
 await page.getByRole('button',{name:'创建',exact:true}).click()
 await expect(page.getByRole('alert')).toContainText('小队已创建，加入待重试')
 await expect(page.getByLabel('怎么称呼')).toBeVisible()
 const retry=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname.endsWith('/join'))
 await page.getByRole('button',{name:'加入小队',exact:true}).click();expect((await retry).status()).toBe(200)
 expect(writes).toHaveLength(2);expect(writes[1]).toEqual(writes[0]);expect(creates).toBe(1)
 await expect(page.getByRole('button',{name:'日程设置',exact:true})).toBeVisible()
 await context.close()
})
