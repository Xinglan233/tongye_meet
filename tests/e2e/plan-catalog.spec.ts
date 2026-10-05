import {test,expect} from '@playwright/test'
import {readFileSync,mkdirSync} from 'node:fs'
import {randomUUID} from 'node:crypto'
import {API_BASE} from './api-base'
import {adminSession,tab,close,save,publishFixture,enter} from './activity-fixture'
import {download} from './ui-helpers'
import {settleTheme} from './figma-visual'
import type {EventPackage} from '../../shared/types'

test('真实公布场次带准确日期分钟与位置，跨日进入正确日程且收藏路线不联动',async({page,request})=>{
 const pack=JSON.parse(readFileSync('examples/event-demo.json','utf8')) as EventPackage
 pack.event.id='catalog-session-'+randomUUID();pack.event.title='来源选择隔离场次验收'
 pack.event.endDate='2026-10-04';pack.event.days.push({date:'2026-10-04',openIntervals:[{start:'13:00',end:'18:00'}]})
 pack.event.activities[0].sessions[1].date='2026-10-04'
 const token='b'.repeat(64);await adminSession(request,token)
 const published=await request.post(`${API_BASE}/api/v1/admin/events`,{headers:{Authorization:'Bearer '+token},data:{eventPackage:pack,status:'published',expectedRevision:0,operationId:randomUUID()}})
 expect(published.status()).toBe(200)
 await page.goto('/events/'+pack.event.id)
 await expect(page.locator('.sched-row').filter({hasText:'13:07'})).toHaveCount(0)
 await page.getByRole('button',{name:'10/04',exact:true}).click()
 await page.locator('.sched-row').filter({hasText:'13:07'}).click()
 await expect(page.getByRole('dialog')).toContainText('2026-10-04 13:07–13:52')
 await page.getByRole('button',{name:'加入计划',exact:true}).click()
 await expect(page.getByRole('dialog')).toHaveCount(0)
 await expect(page.locator('.day-strip [aria-pressed=true]')).toHaveText('10/04')
 await expect(page.locator('.figma-plan-timeline')).toContainText('13:07–13:52')
 await save(page);await page.reload()
 await expect(page.locator('.figma-plan-timeline')).toContainText('13:07–13:52')
 await tab(page,'我的');await page.getByRole('button',{name:'恢复与导出',exact:true}).click()
 const backup=JSON.parse(await download(page,'导出个人计划'))
 expect(backup.plan.response.busy).toHaveLength(1)
 expect(backup.plan.response.busy[0]).toMatchObject({source:'session',sessionId:'demo-workshop-1003-02',date:'2026-10-04',start:'13:07',end:'13:52',title:'手作体验示例',location:'示例 A 区'})
 expect(backup.plan.favorites).toEqual([]);expect(backup.plan.routes).toEqual([])
 await close(page);await tab(page,'活动');await page.locator('.sched-row').filter({hasText:'13:07'}).click();await expect(page.getByRole('button',{name:'已加入计划',exact:true})).toBeDisabled();await close(page)
 await tab(page,'我的');await page.getByRole('button',{name:'恢复与导出',exact:true}).click()
 expect(JSON.parse(await download(page,'导出个人计划')).plan.response.busy).toHaveLength(1)
})

test('计划直接选择已公布场次，预填后明确保存，刷新导出保留关联且不改变收藏路线',async({browser})=>{
 const pack=await publishFixture(browser,'plan-source-session'),context=await browser.newContext({viewport:{width:390,height:900}}),page=await context.newPage()
 await enter(page,pack);await tab(page,'计划')
 await page.getByRole('button',{name:'加入计划',exact:true}).click()
 const picker=page.getByRole('dialog',{name:'加入计划'});await expect(picker.getByPlaceholder('搜索摊位、地点或场次')).toBeVisible()
 mkdirSync('/tmp/tongye-figma-product-picker',{recursive:true});for(const width of [375,390,430])for(const scheme of ['light','dark'] as const){await page.setViewportSize({width,height:900});await settleTheme(page,scheme);await expect.poll(()=>picker.evaluate(e=>Math.round(e.getBoundingClientRect().bottom))).toBe(900);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({animations:'disabled',path:`/tmp/tongye-figma-product-picker/picker-${width}-${scheme}.png`})}
 await page.setViewportSize({width:390,height:900});await settleTheme(page,'light')
 await picker.getByRole('button',{name:/手作体验示例.*13:07.*13:52/}).click()
 let editor=page.getByRole('dialog',{name:'个人安排'})
 await expect(editor.getByLabel('活动名')).toHaveValue('手作体验示例');await expect(editor.getByLabel('开始时间',{exact:true})).toHaveValue('13:07');await expect(editor.getByLabel('结束时间',{exact:true})).toHaveValue('13:52');await expect(editor.getByLabel('地点',{exact:true})).toHaveValue('示例 A 区')
 await close(page);await expect(page.getByText('当天还没有安排',{exact:true})).toBeVisible()
 await page.getByRole('button',{name:'加入计划',exact:true}).click();await picker.getByRole('button',{name:/手作体验示例.*13:07.*13:52/}).click();await editor.getByRole('button',{name:'加入计划',exact:true}).click();await expect(editor).toHaveCount(0)
 await save(page);await page.reload();await expect(page.locator('.figma-plan-timeline')).toContainText('13:07–13:52')
 await page.getByRole('button',{name:'加入计划',exact:true}).click();await picker.getByRole('button',{name:/手作体验示例.*13:07.*13:52/}).click();editor=page.getByRole('dialog',{name:'个人安排'});await expect(editor.getByRole('button',{name:'完成',exact:true})).toBeVisible();await close(page)
 await tab(page,'我的');await page.getByRole('button',{name:'恢复与导出',exact:true}).click();const backup=JSON.parse(await download(page,'导出个人计划'))
 expect(backup.plan.response.busy).toHaveLength(1);expect(backup.plan.response.busy[0]).toMatchObject({source:'session',sessionId:'demo-workshop-1003-02',date:'2026-10-03',start:'13:07',end:'13:52',location:'示例 A 区'});expect(backup.plan.favorites).toEqual([]);expect(backup.plan.routes).toEqual([])
 await context.close()
})

test('无公布时间地点需本人填写，不误用另一来源草稿，搜索空态仍可自定义',async({browser})=>{
 const pack=await publishFixture(browser,'plan-source-place'),context=await browser.newContext({viewport:{width:375,height:900}}),page=await context.newPage()
 await enter(page,pack);await tab(page,'计划');await page.getByRole('button',{name:'加入计划',exact:true}).click()
 const picker=page.getByRole('dialog',{name:'加入计划'})
 await picker.getByPlaceholder('搜索摊位、地点或场次').fill('不会匹配的来源');await expect(picker.getByText('没有匹配的地点或场次',{exact:true})).toBeVisible();await expect(picker.getByRole('button',{name:'添加自定义安排',exact:true})).toBeVisible()
 await picker.getByPlaceholder('搜索摊位、地点或场次').fill('示例地点 A');await picker.getByRole('button',{name:/示例地点 A/}).click()
 const editor=page.getByRole('dialog',{name:'个人安排'});await expect(editor.getByLabel('活动名')).toHaveValue('示例地点 A');await expect(editor.getByLabel('开始时间',{exact:true})).toHaveValue('');await expect(editor.getByLabel('结束时间',{exact:true})).toHaveValue('');await expect(editor.getByRole('button',{name:'加入计划',exact:true})).toBeDisabled()
 await editor.getByLabel('开始时间',{exact:true}).fill('13:07');await editor.getByLabel('结束时间',{exact:true}).fill('13:52');await close(page)
 await page.getByRole('button',{name:'加入计划',exact:true}).click();await picker.getByRole('button',{name:/示例地点 B/}).click();await expect(editor.getByLabel('活动名')).toHaveValue('示例地点 B');await expect(editor.getByLabel('开始时间',{exact:true})).toHaveValue('');await close(page)
 await page.reload();await page.getByRole('button',{name:'加入计划',exact:true}).click();await picker.getByRole('button',{name:/示例地点 A/}).click();await expect(editor.getByLabel('开始时间',{exact:true})).toHaveValue('13:07');await expect(editor.getByLabel('结束时间',{exact:true})).toHaveValue('13:52');await editor.getByRole('button',{name:'加入计划',exact:true}).click();await expect(editor).toHaveCount(0)
 await tab(page,'我的');await page.getByRole('button',{name:'恢复与导出',exact:true}).click();const backup=JSON.parse(await download(page,'导出个人计划'));expect(backup.plan.response.busy).toHaveLength(1);expect(backup.plan.response.busy[0]).toMatchObject({source:'manual',title:'示例地点 A',start:'13:07',end:'13:52'});expect(backup.plan.favorites).toEqual([]);expect(backup.plan.routes).toEqual([])
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await context.close()
})


test('来源选择按日期过滤；无场次日仍可选地点与自定义，且不新增任何安排',async({browser,request})=>{
 const pack=await publishFixture(browser,'plan-source-date'),updated=structuredClone(pack);updated.event.endDate='2026-10-04';updated.event.days.push({date:'2026-10-04',openIntervals:[{start:'13:00',end:'18:00'}]})
 const token='b'.repeat(64);await adminSession(request,token);expect((await request.post(`${API_BASE}/api/v1/admin/events`,{headers:{Authorization:'Bearer '+token},data:{eventPackage:updated,status:'published',expectedRevision:2,operationId:randomUUID()}})).status()).toBe(200)
 const context=await browser.newContext({viewport:{width:390,height:900}}),page=await context.newPage();await enter(page,updated);await tab(page,'计划');await page.getByRole('button',{name:'加入计划',exact:true}).click();let picker=page.getByRole('dialog',{name:'加入计划'});await expect(picker.getByRole('button',{name:/手作体验示例.*13:07.*13:52/})).toBeVisible();await close(page)
 await page.getByRole('button',{name:'10/04',exact:true}).click();await page.getByRole('button',{name:'加入计划',exact:true}).click();picker=page.getByRole('dialog',{name:'加入计划'});await expect(picker.getByRole('button',{name:/手作体验示例/})).toHaveCount(0);await expect(picker.getByText('该日暂无已公布场次，可选地点后设置时间',{exact:true})).toBeVisible();await expect(picker.getByRole('button',{name:/示例地点 A/})).toBeVisible();await picker.getByRole('button',{name:'添加自定义安排',exact:true}).click();const editor=page.getByRole('dialog',{name:'个人安排'});await expect(editor.getByLabel('活动名')).toHaveValue('');await expect(editor.getByLabel('地点',{exact:true})).toHaveValue('');await expect(editor.getByLabel('开始时间',{exact:true})).toHaveValue('');await expect(editor.getByLabel('结束时间',{exact:true})).toHaveValue('');await expect(editor.getByRole('button',{name:'加入计划',exact:true})).toBeDisabled();await close(page);await expect(page.getByText('当天还没有安排',{exact:true})).toBeVisible();await context.close()
})
