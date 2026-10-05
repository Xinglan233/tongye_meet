import {test,expect} from '@playwright/test'
import {mkdirSync} from 'node:fs'
import {publishFixture,imageFixture,tab,close} from './activity-fixture'
import {download} from './ui-helpers'

test('Figma活动栏和详情接真实数据，三个动作独立，未保存日程不生成安排',async({browser})=>{
 test.setTimeout(90_000)
 const pack=await publishFixture(browser,'figma-space'),context=await browser.newContext({viewport:{width:390,height:900}}),page=await context.newPage()
 await imageFixture(page);await page.goto(`/events/${pack.event.id}`)
 const header=page.locator('.figma-activity-header')
 await expect(header).toContainText(pack.event.title)
 await header.getByRole('button',{name:'切换活动',exact:true}).click()
 await expect(page.getByRole('dialog',{name:'切换活动'})).toContainText(pack.event.title);await close(page)
 await expect(page.locator('svg image')).toHaveAttribute('href',/^blob:/)
 await expect(page.locator('.activity-place-pane').getByRole('button',{name:/示例地点 A/})).toBeVisible()
 await page.locator('.activity-place-pane').getByRole('button',{name:/示例地点 A/}).click()
 const detail=page.getByRole('dialog',{name:'示例地点 A'})
 await expect(detail.locator('.figma-poi-actions')).toBeVisible()
 await detail.getByRole('button',{name:'加入日程',exact:true}).click()
 const editor=page.getByRole('dialog',{name:'个人安排'})
 await expect(editor.getByLabel('活动名')).toHaveValue('示例地点 A')
 await expect(page.getByRole('dialog')).toHaveCount(1)
 await editor.getByLabel('开始时间',{exact:true}).fill('13:07');await editor.getByLabel('结束时间',{exact:true}).fill('13:52')
 await close(page);await tab(page,'我的');await page.getByRole('button',{name:'恢复与导出'}).click()
 let backup=JSON.parse(await download(page,'导出个人计划'))
 expect(backup.plan.response.busy).toEqual([]);expect(backup.plan.favorites).toEqual([]);expect(backup.plan.routes).toEqual([])
 await close(page);await tab(page,'计划');await page.getByRole('button',{name:'日程',exact:true}).click();await page.getByRole('button',{name:'加入计划',exact:true}).click();await page.getByRole('dialog',{name:'加入计划'}).getByRole('button',{name:/示例地点 A/}).click()
 await expect(editor.getByLabel('活动名')).toHaveValue('示例地点 A');await editor.getByRole('button',{name:'加入计划',exact:true}).click()
 await tab(page,'我的');await page.getByRole('button',{name:'恢复与导出'}).click();backup=JSON.parse(await download(page,'导出个人计划'))
 expect(backup.plan.response.busy[0]).toMatchObject({title:'示例地点 A',start:'13:07',end:'13:52'});expect(backup.plan.favorites).toEqual([]);expect(backup.plan.routes).toEqual([])
 await close(page);await page.locator('.tabbar button').first().click();await page.locator('.activity-place-pane').getByRole('button',{name:/示例地点 A/}).click()
 mkdirSync('/tmp/tongye-figma-product-space',{recursive:true})
 for(const width of [375,390,430])for(const scheme of ['light','dark'] as const){await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:scheme});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await expect.poll(()=>detail.evaluate(e=>Math.round(e.getBoundingClientRect().bottom))).toBe(900);await page.screenshot({animations:'disabled',path:`/tmp/tongye-figma-product-space/detail-${width}-${scheme}.png`})}
 await context.close()
})
