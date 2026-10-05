import {customArrangement} from './ui-helpers'
import {API_BASE} from './api-base'
import {test,expect} from '@playwright/test'
import {tab,close,save} from './activity-fixture'
import {download} from './ui-helpers'
test('清理私人活动删除未提交编辑和排队写入，仅清当前活动，不删除小队入口',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'发起日常活动',exact:true}).click();await page.getByLabel('活动名称').fill('私人草稿清理演练');await page.getByLabel('站点创建码').fill('test-create');await page.getByRole('button',{name:'确认创建',exact:true}).click()
 await expect(page).toHaveURL(/\/events\/[^/?#]+/);const id=new URL(page.url()).pathname.split('/')[2]
 await tab(page,'我的');await page.getByRole('button',{name:'编辑活动资料',exact:true}).click();const d=page.getByRole('dialog',{name:'编辑活动资料'});await d.getByLabel('活动标题',{exact:true}).fill('不应残留的私人标题');await d.getByLabel('活动说明',{exact:true}).fill('不应残留的私人说明');await d.getByRole('button',{name:'导入活动 JSON'}).click();await d.getByLabel('粘贴活动 JSON').fill('{"private":"未提交私人原文"}');await close(page)
 const queued=await page.evaluate(async(eventId)=>{
  const path='/src/online/storage.ts',toolsPath='/src/online/activity/activity-tools.ts',s=await import(path),tools=await import(toolsPath),key='activity-owner-edit:'+eventId;await s.flushLocalWrites()
  const stored=await s.readLocal(key);if(!stored||stored.raw!=='{"private":"未提交私人原文"}')throw new Error('真实编辑稿未保存')
  await s.writeLocal('activity-owner-edit:'+eventId+'-other',{private:'另一个活动'})
  await s.writeLocal('capabilities',[{groupId:'retained-group',role:'member',token:'isolated-fixture'}])
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve})
  // A draft scheduled behind an unfinished predecessor has not opened IDB yet.
  const waiting=s.writeLocal(key,{...stored,raw:'隔离测试：延迟写入'},gate)
  let cleared=false;const cleanup=s.removeLocalWhere((k:string)=>tools.activityLocalKey(k,eventId)).then(()=>{cleared=true})
  await new Promise(resolve=>setTimeout(resolve,30));const waited=!cleared;release();await Promise.all([waiting,cleanup])
  const removed=await s.readLocal(key),other=await s.readLocal('activity-owner-edit:'+eventId+'-other'),groups=await s.readLocal('capabilities')
  // Seed another draft so the actual product button is independently exercised.
  await s.writeLocal(key,{...stored,pending:{operationId:'isolated-operation',expectedRevision:1,eventPackage:stored.pack}})
  return {waited,removed:removed===undefined,other,groups}
 },id)
 expect(queued).toMatchObject({waited:true,removed:true,other:{private:'另一个活动'},groups:[{groupId:'retained-group'}]})
 page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'移除此设备资料',exact:true}).click();await expect(page.getByRole('heading',{name:'选择活动',exact:true})).toBeVisible();await page.reload()
 const remaining=await page.evaluate(async(eventId)=>{const path='/src/online/storage.ts',s=await import(path);return{removed:(await s.readLocal('activity-owner-edit:'+eventId))===undefined,owner:(await s.readLocal('activity-owner:'+eventId))===undefined,other:await s.readLocal('activity-owner-edit:'+eventId+'-other'),groups:await s.readLocal('capabilities')}},id)
 expect(remaining).toMatchObject({removed:true,owner:true,other:{private:'另一个活动'},groups:[{groupId:'retained-group'}]})
})
test('私人活动管理入口保留未保存修改，确认后只更新资料，不公开活动',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'发起日常活动',exact:true}).click();await page.getByLabel('活动名称').fill('私人资料编辑演练');await page.getByLabel('站点创建码').fill('test-create');await page.getByRole('button',{name:'确认创建',exact:true}).click()
 await expect(page).toHaveURL(/\/events\/[^/?#]+/);const id=new URL(page.url()).pathname.split('/')[2]
 await tab(page,'我的');await page.getByRole('button',{name:'编辑活动资料',exact:true}).click()
 let d=page.getByRole('dialog',{name:'编辑活动资料'});await d.getByLabel('活动标题',{exact:true}).fill('保留的资料修改');await close(page);await page.reload();await tab(page,'我的');await page.getByRole('button',{name:'编辑活动资料',exact:true}).click();d=page.getByRole('dialog',{name:'编辑活动资料'});await expect(d.getByLabel('活动标题',{exact:true})).toHaveValue('保留的资料修改')
 await d.getByRole('button',{name:'预览修改',exact:true}).click();await d.getByRole('button',{name:'确认保存活动资料',exact:true}).click();await expect(d.getByRole('status')).toHaveText('已保存');await close(page);await page.reload();await tab(page,'活动');await expect(page.locator('.figma-activity-header').getByText('保留的资料修改',{exact:true})).toBeVisible()
 expect((await page.request.get(`${API_BASE}/api/v1/events/${id}`)).status()).toBe(404);expect(JSON.stringify((await (await page.request.get(`${API_BASE}/api/v1/events`)).json()).data)).not.toContain('保留的资料修改')
})
test('日常活动不公开可独立排分钟计划，之后建队关联不丢个人计划；邀请直达活动上下文',async({browser})=>{
 test.setTimeout(120000);const owner=await browser.newContext({viewport:{width:390,height:900}}),page=await owner.newPage();await page.goto('/');await page.getByRole('button',{name:'发起日常活动',exact:true}).click();await page.getByLabel('活动名称').fill('私人约饭');await page.getByLabel('站点创建码').fill('test-create');await page.getByRole('button',{name:'确认创建',exact:true}).click();await expect(page.locator('.tabbar').getByRole('button',{name:'活动',exact:true})).toBeVisible();const eventId=new URL(page.url()).pathname.split('/')[2];expect((await page.request.get(`${API_BASE}/api/v1/events/${eventId}`)).status()).toBe(404);expect(JSON.stringify((await (await page.request.get(`${API_BASE}/api/v1/events`)).json()).data)).not.toContain('私人约饭')
 await tab(page,'计划');await page.getByRole('button',{name:'日程',exact:true}).click();await customArrangement(page);let d=page.getByRole('dialog');await d.getByLabel('活动名').fill('已有个人安排');await d.getByLabel('开始时间',{exact:true}).fill('13:07');await d.getByLabel('结束时间',{exact:true}).fill('13:52');await d.getByRole('button',{name:'加入计划',exact:true}).click();await save(page)
 await tab(page,'同行');await page.getByRole('button',{name:'创建小队',exact:true}).click();d=page.getByRole('dialog',{name:'创建小队'});await d.getByLabel('小队标题').fill('朋友约饭');await d.getByLabel('站点创建码').fill('test-create');await d.getByRole('button',{name:'确认创建'}).click();await page.getByLabel('怎么称呼').fill('队长');await page.getByRole('button',{name:'加入小队',exact:true}).click();await page.getByRole('button',{name:'关联个人计划',exact:true}).click();page.once('dialog',x=>x.accept());await page.getByRole('button',{name:'同步本人计划到此小队',exact:true}).click();await page.getByRole('button',{name:'提交',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'已提交'})).toBeVisible();await expect(page.getByText('个人计划已关联',{exact:true})).toBeVisible();await page.getByRole('button',{name:'成员',exact:true}).click();await page.getByRole('button',{name:'管理小队'}).click();await page.context().grantPermissions(['clipboard-read','clipboard-write']);await page.getByRole('button',{name:'复制链接',exact:true}).click();const invitation=await page.evaluate(()=>navigator.clipboard.readText());await close(page)
 const friend=await browser.newContext(),second=await friend.newPage();await second.goto(invitation);await expect(second.locator('.tabbar').getByRole('button',{name:'同行',exact:true})).toBeVisible();await expect(second.getByText('私人约饭',{exact:true})).toBeVisible();expect(second.url()).not.toContain('#');await second.getByLabel('怎么称呼').fill('队员');await second.getByRole('button',{name:'加入小队',exact:true}).click();await expect(second.getByRole('button',{name:'同步本人计划到此小队',exact:true})).toHaveCount(0)
 await tab(page,'我的');await page.getByRole('button',{name:'恢复与导出'}).click();const plan=JSON.parse(await download(page,'导出个人计划'));expect(plan.plan.response.busy[0]).toMatchObject({start:'13:07',end:'13:52'});expect(JSON.stringify(plan)).not.toMatch(/token|owner/);await close(page);await page.reload();await tab(page,'同行');await expect(page.getByText('个人计划已关联',{exact:true})).toBeVisible();await friend.close();await owner.close()
})
