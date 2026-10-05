import {test,expect} from '@playwright/test'
import {publishFixture,enter,tab,close,save} from './activity-fixture'
import {download} from './ui-helpers'
test('停留排队由本人确认，窗口建议不改分钟安排收藏；显式加入后才占时间',async({browser})=>{
 test.setTimeout(90000);const pack=await publishFixture(browser,'route-timing'),context=await browser.newContext({viewport:{width:390,height:900}}),page=await context.newPage();await enter(page,pack)
 await page.locator('.activity-place-pane .sched-row').filter({hasText:'示例地点 D'}).click();await page.getByRole('dialog').getByRole('button',{name:'加入路线',exact:true}).click();await close(page);await tab(page,'计划');await page.getByRole('button',{name:'日程',exact:true}).click();await page.getByRole('button',{name:/本日在场时间/}).click();let d=page.getByRole('dialog');await d.getByLabel('开始时间 1',{exact:true}).fill('13:07');await d.getByLabel('结束时间 1',{exact:true}).fill('13:52');await d.getByRole('button',{name:'保存',exact:true}).click()
 await page.getByRole('button',{name:'路线',exact:true}).click();await page.getByLabel('路线起点').selectOption('poi-a');await expect(page.getByText('请填写每站停留和排队时间；未知通行时间不能判断。',{exact:true})).toBeVisible()
 await page.getByRole('button',{name:'停留与排队 示例地点 D'}).click();d=page.getByRole('dialog',{name:'停留与排队'});await d.getByLabel('停留（分钟）').fill('20');await d.getByLabel('排队（分钟）').fill('-1');await d.getByRole('button',{name:'保存',exact:true}).click();await expect(d.getByRole('alert')).toContainText('0–1440');await d.getByLabel('排队（分钟）').fill('10');await d.getByRole('button',{name:'保存',exact:true}).click();await expect(d).toHaveCount(0)
 await expect(page.getByText('13:07–13:52',{exact:false})).toBeVisible();await expect(page.getByRole('button',{name:'加入计划 13:07–13:42'})).toBeVisible();await save(page);await tab(page,'我的');await page.getByRole('button',{name:'恢复与导出'}).click();const data=JSON.parse(await download(page,'导出个人计划'));expect(data.plan.response.busy).toHaveLength(0);expect(data.plan.favorites).toHaveLength(0);expect(data.plan.routes[0].stops[0]).toMatchObject({stayMinutes:20,queueMinutes:10});expect(data.plan.response.presence[0].intervals).toEqual([{start:'13:07',end:'13:52'}]);await close(page)
 await tab(page,'计划');await page.getByRole('button',{name:'路线',exact:true}).click();await page.getByRole('button',{name:'加入计划 13:07–13:42'}).click();await save(page);await page.reload();await tab(page,'计划');await page.getByRole('button',{name:'日程',exact:true}).click();await expect(page.locator('.sched-row').filter({hasText:'路线游逛'})).toContainText('13:07');await expect(page.locator('.sched-row').filter({hasText:'路线游逛'})).toContainText('13:42');await context.close()
})

test('已走站点后的地图、通道列表和分钟建议均从最后经过地点开始',async({browser})=>{
 test.setTimeout(90000)
 const pack=await publishFixture(browser,'remaining-route-origin'),context=await browser.newContext({viewport:{width:390,height:900}}),page=await context.newPage()
 await enter(page,pack)
 for(const name of ['示例地点 B','示例地点 D']){
  await page.locator('.activity-place-pane .sched-row').filter({hasText:name}).click()
  await page.getByRole('dialog').getByRole('button',{name:'加入路线',exact:true}).click();await close(page)
 }
 await tab(page,'计划');await page.getByRole('button',{name:'日程',exact:true}).click();await page.getByRole('button',{name:/本日在场时间/}).click()
 let d=page.getByRole('dialog');await d.getByLabel('开始时间 1',{exact:true}).fill('13:07');await d.getByLabel('结束时间 1',{exact:true}).fill('13:52');await d.getByRole('button',{name:'保存',exact:true}).click()
 await page.getByRole('button',{name:'路线',exact:true}).click();await page.getByLabel('路线起点').selectOption('poi-a')
 await page.getByRole('button',{name:'标记经过 示例地点 B',exact:true}).click()
 await page.getByRole('button',{name:'停留与排队 示例地点 D',exact:true}).click();d=page.getByRole('dialog',{name:'停留与排队'})
 await d.getByLabel('停留（分钟）').fill('2');await d.getByLabel('排队（分钟）').fill('1');await d.getByRole('button',{name:'保存',exact:true}).click()
 await expect(page.getByRole('button',{name:'加入计划 13:07–13:13',exact:true})).toBeVisible()
 await expect(page.getByText('示例地点 B → 示例地点 D',{exact:true})).toBeVisible()
 await expect(page.getByText('示例地点 A → 示例地点 D',{exact:true})).toHaveCount(0)
 await page.getByRole('button',{name:'查看第 1 段',exact:true}).click()
 d=page.getByRole('dialog',{name:'通道路线'})
 await expect(d.locator('polyline[pointer-events="none"]')).toHaveAttribute('points','200,800 1800,800 1800,200')
 await page.keyboard.press('Escape');await expect(d).toHaveCount(0);await save(page);await page.reload();await tab(page,'计划');await page.getByRole('button',{name:'路线',exact:true}).click()
 await expect(page.getByText('示例地点 B → 示例地点 D',{exact:true})).toBeVisible()
 await tab(page,'我的');await page.getByRole('button',{name:'恢复与导出',exact:true}).click()
 const data=JSON.parse(await download(page,'导出个人计划'))
 expect(data.plan.routes[0]).toMatchObject({startPoiId:'poi-a',stops:[{poiId:'poi-b',visited:true},{poiId:'poi-d',visited:false,stayMinutes:2,queueMinutes:1}]})
 expect(data.plan.response.busy).toEqual([]);expect(data.plan.favorites).toEqual([])
 await context.close()
})
