import {customArrangement} from './ui-helpers'
import {settleTheme} from './figma-visual'
import {test,expect} from '@playwright/test'
import {mkdirSync} from 'node:fs'
import {publishFixture,enter,tab,close} from './activity-fixture'
import {download} from './ui-helpers'

test('Figma收藏路线与分钟编辑接真实状态，显式操作才变更相应记录',async({browser})=>{
 test.setTimeout(90_000)
 const pack=await publishFixture(browser,'figma-plan'),context=await browser.newContext({viewport:{width:390,height:900}}),page=await context.newPage()
 mkdirSync('/tmp/tongye-figma-product-plan',{recursive:true})
 async function shot(view:string){for(const width of [375,390,430])for(const scheme of ['light','dark'] as const){await page.setViewportSize({width,height:900});await settleTheme(page,scheme);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({animations:'disabled',path:`/tmp/tongye-figma-product-plan/${view}-${width}-${scheme}.png`})}}
 await enter(page,pack);await page.locator('.activity-place-pane .sched-row').filter({hasText:'示例地点 A'}).click()
 let sheet=page.getByRole('dialog');await sheet.getByRole('button',{name:'收藏',exact:true}).click();await sheet.getByRole('button',{name:'加入路线',exact:true}).click();await close(page)
 await tab(page,'计划');await page.getByRole('button',{name:'收藏',exact:true}).click();await expect(page.locator('.figma-favorite-list')).toContainText('未排日程');await page.getByRole('button',{name:'标记去过',exact:true}).click();await shot('favorites')
 await page.getByRole('button',{name:'路线',exact:true}).click();await expect(page.locator('.figma-route-next')).toContainText('示例地点 A');await page.getByRole('button',{name:'标记已到达',exact:true}).click();await expect(page.getByText('路线已全部完成',{exact:true})).toBeVisible();await shot('route')
 await page.getByRole('button',{name:'日程',exact:true}).click();await expect(page.getByText('当天还没有安排',{exact:true})).toBeVisible();await customArrangement(page);sheet=page.getByRole('dialog',{name:'个人安排'})
 await sheet.getByLabel('活动名').fill('精确分钟编辑');await sheet.getByLabel('开始时间',{exact:true}).fill('13:07');await sheet.getByLabel('结束时间',{exact:true}).fill('13:52');await sheet.getByLabel('地点',{exact:true}).fill('本人地点')
 await expect(sheet.getByText('时长 45 分钟',{exact:true})).toBeVisible();await sheet.getByRole('button',{name:'5 分',exact:true}).click();await sheet.getByRole('button',{name:'开始时间推迟5分钟'}).click();await expect(sheet.getByLabel('开始时间',{exact:true})).toHaveValue('13:12');await sheet.getByRole('button',{name:'开始时间提前5分钟'}).click();await sheet.getByRole('button',{name:'30 分',exact:true}).click();await expect(sheet.getByLabel('开始时间',{exact:true})).toHaveValue('13:07');await expect(sheet.getByLabel('结束时间',{exact:true})).toHaveValue('13:52')
 mkdirSync('/tmp/tongye-figma-product-plan',{recursive:true});for(const width of [375,390,430])for(const scheme of ['light','dark'] as const){await page.setViewportSize({width,height:900});await settleTheme(page,scheme);await expect.poll(()=>sheet.evaluate(e=>Math.round(e.getBoundingClientRect().bottom))).toBe(900);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({animations:'disabled',path:`/tmp/tongye-figma-product-plan/editor-${width}-${scheme}.png`})}
 await close(page);await customArrangement(page);await expect(sheet.getByLabel('开始时间',{exact:true})).toHaveValue('13:07');await expect(sheet.getByLabel('地点',{exact:true})).toHaveValue('本人地点');await sheet.getByRole('button',{name:'加入计划',exact:true}).click()
 await tab(page,'我的');await shot('me');await page.getByRole('button',{name:'恢复与导出',exact:true}).click();let exported=JSON.parse(await download(page,'导出个人计划'));expect(exported.plan.response.busy).toHaveLength(1);expect(exported.plan.response.busy[0]).toMatchObject({start:'13:07',end:'13:52',location:'本人地点'});expect(exported.plan.favorites).toEqual([{poiId:'poi-a',visited:true}]);expect(exported.plan.routes[0].stops).toEqual([{poiId:'poi-a',visited:true}]);await close(page)
 await tab(page,'计划');await page.getByRole('button',{name:'收藏',exact:true}).click();await page.getByRole('button',{name:'取消收藏 示例地点 A'}).click();await tab(page,'我的');await page.getByRole('button',{name:'恢复与导出',exact:true}).click();exported=JSON.parse(await download(page,'导出个人计划'));expect(exported.plan.favorites).toEqual([]);expect(exported.plan.response.busy).toHaveLength(1);expect(exported.plan.routes[0].stops).toHaveLength(1)
 await context.close()
})
