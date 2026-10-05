import {test,expect} from '@playwright/test'
import type {PersonalPlan} from '../../shared/activity-contract'
import {publishFixture,imageFixture,tab,close,save} from './activity-fixture'

test('正常建队后地点加入个人计划，刷新和返回保留计划视图与原小队上下文',async({page,browser})=>{
 const pack=await publishFixture(browser,'group-plan-context');await imageFixture(page)
 await page.goto(`/events/${pack.event.id}?view=companions&date=2026-10-03`)
 await page.getByLabel('小队标题').fill('视图恢复隔离小队');await page.getByRole('button',{name:'创建',exact:true}).click()
 await expect(page.getByRole('button',{name:'日程设置',exact:true})).toBeVisible()
 const group=new URL(page.url()).searchParams.get('group');expect(group).toBeTruthy()
 await tab(page,'探索');await page.locator('.activity-place-pane').getByRole('button',{name:/示例地点 A/}).click()
 await page.getByRole('dialog').getByRole('button',{name:'加入计划',exact:true}).click()
 const editor=page.getByRole('dialog',{name:'个人安排'});await editor.getByLabel('开始时间',{exact:true}).fill('13:07');await editor.getByLabel('结束时间',{exact:true}).fill('13:52');await editor.getByRole('button',{name:'加入计划',exact:true}).click();await save(page)
 const assertPlan=async()=>{const query=new URL(page.url()).searchParams;expect(query.get('view')).toBe('plan');expect(query.get('group')).toBe(group);expect(query.get('date')).toBe('2026-10-03');await expect(page.locator('.tabbar').getByRole('button',{name:'计划',exact:true})).toHaveAttribute('aria-current','page');await expect(page.locator('.figma-plan-timeline')).toContainText('13:07–13:52');await expect(page.locator('.figma-plan-timeline')).toContainText('示例地点 A')}
 await assertPlan();await page.reload();await assertPlan()
 await page.getByRole('button',{name:'返回活动列表',exact:true}).click();await expect(page.getByRole('heading',{name:'选择活动',exact:true})).toBeVisible();await page.goBack();await assertPlan()
 await tab(page,'同行');expect(new URL(page.url()).searchParams.get('group')).toBe(group)
 const crew=page.getByLabel('小队页面');await expect(crew.getByRole('button',{name:'小队日程',exact:true})).toBeVisible();await expect(crew.getByRole('button',{name:'共同空闲',exact:true})).toBeVisible();await expect(crew.getByRole('button',{name:'凑空',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'日程设置',exact:true})).toBeVisible()
})

test('现有个人安排关闭仅保留编辑稿，完成才更新同一条目，云保存独立',async({page,browser})=>{
 const pack=await publishFixture(browser,'existing-plan-editor');await imageFixture(page)
 const writes:{plan:PersonalPlan}[]=[];page.on('request',r=>{if(r.method()==='PUT'&&/\/personal\//.test(r.url()))writes.push(r.postDataJSON())})
 await page.goto(`/events/${pack.event.id}?view=plan&date=2026-10-03`);await page.getByRole('button',{name:'加入计划',exact:true}).click();await page.getByRole('dialog',{name:'加入计划'}).getByRole('button',{name:'添加自定义安排',exact:true}).click()
 const editor=page.getByRole('dialog',{name:'个人安排'});await editor.getByLabel('活动名').fill('原分钟安排');await editor.getByLabel('开始时间',{exact:true}).fill('13:07');await editor.getByLabel('结束时间',{exact:true}).fill('13:52');await editor.getByRole('button',{name:'加入计划',exact:true}).click();await save(page)
 const original=writes[0].plan.response.busy[0],timeline=page.locator('.figma-plan-timeline')
 await timeline.getByRole('button',{name:/原分钟安排/}).click();await editor.getByLabel('活动名').fill('待完成的修改');await editor.getByLabel('开始时间',{exact:true}).fill('14:07');await editor.getByLabel('结束时间',{exact:true}).fill('14:52');await close(page)
 await expect(timeline).toContainText('原分钟安排');await expect(timeline).toContainText('13:07–13:52');await expect(timeline).not.toContainText('14:07');expect(writes).toHaveLength(1)
 await page.reload();await expect(timeline).toContainText('13:07–13:52');await timeline.getByRole('button',{name:/原分钟安排/}).click();await expect(editor.getByLabel('活动名')).toHaveValue('待完成的修改');await expect(editor.getByLabel('开始时间',{exact:true})).toHaveValue('14:07');await expect(editor.getByLabel('结束时间',{exact:true})).toHaveValue('14:52')
 await editor.getByRole('button',{name:'完成',exact:true}).click();await expect(timeline).toContainText('待完成的修改');await expect(timeline).toContainText('14:07–14:52');await expect(page.locator('p[role=status]')).toContainText('未保存');expect(writes).toHaveLength(1)
 await save(page);expect(writes).toHaveLength(2);expect(writes[1].plan.response.busy).toHaveLength(1);expect(writes[1].plan.response.busy[0]).toMatchObject({...original,title:'待完成的修改',start:'14:07',end:'14:52'})
 await page.reload();await expect(timeline).toContainText('14:07–14:52');await timeline.getByRole('button',{name:/待完成的修改/}).click();await editor.getByRole('button',{name:'移出计划',exact:true}).click();await expect(timeline.getByRole('button',{name:/待完成的修改/})).toHaveCount(0);await save(page);await page.reload();await expect(page.getByText('当天还没有安排',{exact:true})).toBeVisible()
})
