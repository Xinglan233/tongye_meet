import {test,expect} from '@playwright/test'
import {mkdirSync} from 'node:fs'
import {publishFixture,close,loginAdmin} from './activity-fixture'
import {download} from './ui-helpers'
import {settleTheme} from './figma-visual'
import {API_BASE} from './api-base'

test('共享小队复用分钟编辑器，步长不改原值，刷新导出保留本人安排',async({browser})=>{
 const pack=await publishFixture(browser,'figma-shared-editor'),context=await browser.newContext({viewport:{width:390,height:900}}),page=await context.newPage()
 await page.goto(`/events/${pack.event.id}?view=companions`)
 await page.getByLabel('小队标题').fill('共享编辑验收');await page.getByRole('button',{name:'创建',exact:true}).click()
 await expect(page.getByRole('button',{name:'日程设置',exact:true})).toBeVisible()
 await page.getByRole('button',{name:'手动添加',exact:true}).click();const d=page.getByRole('dialog',{name:'安排',exact:true});await d.getByRole('button',{name:'自定义',exact:true}).click()
 await d.getByLabel('活动名').fill('本人分钟安排');await d.getByLabel('开始时间',{exact:true}).fill('13:07');await d.getByLabel('结束时间',{exact:true}).fill('13:52');await expect(d.getByText('时长 45 分钟',{exact:true})).toBeVisible()
 await d.getByRole('button',{name:'开始时间推迟15分钟'}).click();await expect(d.getByLabel('开始时间',{exact:true})).toHaveValue('13:22');await d.getByRole('button',{name:'开始时间提前15分钟'}).click()
 await d.getByLabel('私密备注').fill('仅本人可见');mkdirSync('/tmp/tongye-figma-workbench',{recursive:true})
 for(const scheme of ['light','dark'] as const){await settleTheme(page,scheme);await page.screenshot({animations:'disabled',path:`/tmp/tongye-figma-workbench/shared-editor-390-${scheme}.png`})}
 await d.getByRole('button',{name:'保存',exact:true}).click();await expect(d).toHaveCount(0);await expect(page.locator('.sched-row').filter({hasText:'本人分钟安排'})).toBeVisible();await page.reload();await expect(page.locator('.sched-row').filter({hasText:'本人分钟安排'})).toBeVisible();await page.getByRole('button',{name:'成员',exact:true}).click();await page.getByRole('button',{name:'我的入口与备份',exact:true}).click()
 const backup=JSON.parse(await download(page,'导出个人安排'));expect(backup.response.busy[0]).toMatchObject({start:'13:07',end:'13:52',note:'仅本人可见'});await close(page);await context.close()
})

test('管理员真实编辑预览与草稿发布分开，预览不写库，帮助使用相同控件',async({page})=>{
 await page.setViewportSize({width:390,height:900})
 let writes=0;page.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname.endsWith('/admin/events'))writes++})
 await page.goto('/admin');await loginAdmin(page);await page.getByRole('button',{name:'新建活动',exact:true}).click();let d=page.getByRole('dialog',{name:'编辑活动'})
 await d.getByLabel('活动名称',{exact:true}).fill('真实工作台预览');await d.getByRole('button',{name:'预览',exact:true}).click();await expect(d.locator('.figma-admin-readonly')).toContainText('真实工作台预览');await expect(d.getByLabel('活动名称',{exact:true})).toHaveCount(0);expect(writes).toBe(0)
 await d.getByRole('button',{name:'编辑',exact:true}).click();await expect(d.getByLabel('活动名称',{exact:true})).toHaveValue('真实工作台预览');await d.getByRole('button',{name:'保存草稿',exact:true}).click();await expect(page.getByRole('dialog',{name:'确认活动资料'})).toContainText('草稿');expect(writes).toBe(0);await page.getByRole('button',{name:'确认保存',exact:true}).click()
 await page.getByRole('button',{name:/真实工作台预览/}).click();d=page.getByRole('dialog',{name:'编辑活动'});await d.getByRole('button',{name:'发布',exact:true}).click();await expect(page.getByRole('dialog',{name:'确认活动资料'})).toContainText('已发布');const published=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname.endsWith('/admin/events'));await page.getByRole('button',{name:'确认保存',exact:true}).click();expect((await published).status()).toBe(200);await expect(page.getByRole('dialog')).toHaveCount(0)
 const events=(await (await page.request.get(`${API_BASE}/api/v1/events`)).json()).data;expect(events.some((e:{eventPackage:{event:{title:string}}})=>e.eventPackage.event.title==='真实工作台预览')).toBe(true)
 await page.getByRole('button',{name:/真实工作台预览/}).click();d=page.getByRole('dialog',{name:'编辑活动'});await d.getByRole('button',{name:'预览',exact:true}).click();await settleTheme(page,'dark');mkdirSync('/tmp/tongye-figma-workbench',{recursive:true});await page.screenshot({animations:'disabled',path:'/tmp/tongye-figma-workbench/admin-preview-390-dark.png'})
 await page.goto('/help/');await expect(page.locator('.help-shell.figma-shell')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({animations:'disabled',path:'/tmp/tongye-figma-workbench/help-390-dark.png'})
})
