import {API_BASE} from './api-base'
import {settleTheme} from './figma-visual'
import {test,expect,type Page} from '@playwright/test'
import {mkdirSync} from 'node:fs'
import {publishFixture,tab,close} from './activity-fixture'

test('加入请求未返回时邀请入口不可操作，身份恢复后可正常打开',async({browser})=>{
 const pack=await publishFixture(browser,'joining-invite-gate'),context=await browser.newContext({viewport:{width:390,height:900}}),page=await context.newPage()
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve});let observed!:()=>void;const started=new Promise<void>(resolve=>{observed=resolve})
 await page.route('**/groups/*/join',async route=>{if(route.request().method()!=='POST')return route.continue();const response=await route.fetch();observed();await gate;await route.fulfill({response})})
 await page.goto(`/events/${pack.event.id}?view=companions`);await page.getByLabel('小队标题').fill('加入与邀请竞态');await page.getByRole('button',{name:'创建',exact:true}).click();await started
 try{await expect(page.getByRole('button',{name:'创建中',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'邀请队员',exact:true})).toHaveCount(0)}finally{release()}
 await expect(page.getByRole('button',{name:'邀请队员',exact:true})).toBeEnabled();await page.getByRole('button',{name:'邀请队员',exact:true}).click();await expect(page.getByRole('dialog',{name:'管理小队'})).toBeVisible()
 await context.close()
})

test('加入后的本人资料尚未恢复时不暴露会被重置的邀请面板',async({browser})=>{
 const pack=await publishFixture(browser,'identity-hydration'),context=await browser.newContext({viewport:{width:390,height:900}}),page=await context.newPage()
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve});let observed!:()=>void;const started=new Promise<void>(resolve=>{observed=resolve})
 await page.route('**/members/*/response',async route=>{if(route.request().method()!=='GET')return route.continue();const response=await route.fetch();observed();await gate;await route.fulfill({response})})
 await page.goto(`/events/${pack.event.id}?view=companions`);await page.getByLabel('小队标题').fill('身份恢复验收');await page.getByRole('button',{name:'创建',exact:true}).click();await started
 try{expect(await page.getByRole('button',{name:'邀请队员',exact:true}).count()).toBe(0)}finally{release()}
 await expect(page.getByRole('button',{name:'邀请队员',exact:true})).toBeVisible()
 for(let i=0;i<3;i++){await page.getByRole('button',{name:'邀请队员',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();await close(page)}
 await context.close()
})

test('Figma同行接三独立身份：未提交不显示全员空闲，邀请和成员权限分开',async({browser})=>{
 test.setTimeout(120_000)
 const pack=await publishFixture(browser,'figma-roles')
 const contexts=await Promise.all([0,1,2].map(()=>browser.newContext({viewport:{width:390,height:900}})))
 const [leader,a,b]=await Promise.all(contexts.map(c=>c.newPage()))
 await leader.goto(`/events/${pack.event.id}?view=companions`)
 await expect(leader.locator('.figma-companions-entry')).toBeVisible()
 await leader.getByLabel('小队邀请链接').fill('123456');await leader.getByRole('button',{name:'加入',exact:true}).click();await expect(leader.getByRole('alert')).toContainText('完整邀请链接')
 await tab(leader,'我的');await leader.getByLabel('个人称呼').fill('队长');await tab(leader,'同行')
 await leader.getByLabel('小队标题').fill('真实三身份小队');await leader.getByRole('button',{name:'创建',exact:true}).click()
 await expect(leader.getByRole('button',{name:'日程设置',exact:true})).toBeVisible()
 await leader.getByRole('button',{name:'邀请队员',exact:true}).click();await leader.context().grantPermissions(['clipboard-read','clipboard-write']);await leader.getByRole('button',{name:'复制链接',exact:true}).click();const invitation=await leader.evaluate(()=>navigator.clipboard.readText());await close(leader)
 for(const [page,name] of [[a,'队员 A'],[b,'队员 B']] as const){await page.goto(invitation);await page.getByLabel('怎么称呼').fill(name);const joined=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/join'));await page.getByRole('button',{name:'加入小队',exact:true}).click();expect((await joined).status()).toBe(200);await expect(page.getByRole('button',{name:/本日在场时间/})).toBeVisible();await expect(page.getByRole('button',{name:'邀请队员',exact:true})).toHaveCount(0)}
 await leader.getByRole('button',{name:'共同空闲',exact:true}).click();await leader.getByRole('button',{name:'刷新',exact:true}).click();await expect(leader.getByText(/等待 .*队员 A.*队员 B.*提交/)).toBeVisible();await expect(leader.locator('.free-row')).toHaveCount(0)
 async function confirmTime(page:Page){await page.getByRole('button',{name:'小队日程',exact:true}).click();await page.getByRole('button',{name:/本日在场时间/}).click();const d=page.getByRole('dialog');await d.getByLabel('开始时间 1',{exact:true}).fill('13:07');await d.getByLabel('结束时间 1',{exact:true}).fill('13:52');await d.getByRole('button',{name:'保存',exact:true}).click();const reply=page.waitForResponse(r=>r.request().method()==='PUT'&&r.url().endsWith('/response'));await page.getByRole('button',{name:'提交',exact:true}).click();expect((await reply).status()).toBe(200)}
 for(const page of [leader,a,b])await confirmTime(page)
 await leader.getByRole('button',{name:'共同空闲',exact:true}).click();await leader.getByRole('button',{name:'刷新',exact:true}).click();await expect(leader.locator('.free-range').filter({hasText:'13:07–13:52'})).toBeVisible()
 await leader.getByRole('button',{name:'成员',exact:true}).click();await expect(leader.locator('.figma-crew-member')).toHaveCount(3);await expect(leader.locator('.figma-crew-member').filter({hasText:'未提交'})).toHaveCount(0)
 mkdirSync('/tmp/tongye-figma-product-roles',{recursive:true})
 for(const width of [375,390,430])for(const scheme of ['light','dark'] as const){await leader.setViewportSize({width,height:900});await settleTheme(leader,scheme);expect(await leader.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await leader.screenshot({animations:'disabled',path:`/tmp/tongye-figma-product-roles/companions-${width}-${scheme}.png`})}
 await a.getByRole('button',{name:'小队日程',exact:true}).click();await a.getByRole('button',{name:/本日在场时间/}).click();const presenceSheet=a.getByRole('dialog',{name:/在场时间/});await presenceSheet.getByRole('button',{name:'不能参加',exact:true}).click();await presenceSheet.getByRole('button',{name:'保存',exact:true}).click();await expect(a.getByRole('button',{name:/本日在场时间/})).toContainText('未同步')
 await leader.getByRole('button',{name:'共同空闲',exact:true}).click();await leader.getByRole('button',{name:'刷新',exact:true}).click();await expect(leader.locator('.free-range').filter({hasText:'13:07–13:52'})).toBeVisible()
 const absentPut=a.waitForResponse(r=>r.request().method()==='PUT'&&r.url().endsWith('/response'));await a.getByRole('button',{name:'提交',exact:true}).click();expect((await absentPut).status()).toBe(200);await expect(a.getByRole('button',{name:/本日在场时间/})).toContainText('已确认')
 await leader.getByRole('button',{name:'刷新',exact:true}).click();await expect(leader.locator('.free-row')).toHaveCount(0);await expect(leader.getByText('当天凑不出整块时间')).toBeVisible()
 await a.reload();await a.getByRole('button',{name:/本日在场时间/}).click();const restoredPresence=a.getByRole('dialog',{name:/在场时间/});await restoredPresence.getByRole('button',{name:'在场',exact:true}).click();await expect(restoredPresence.getByLabel('开始时间 1',{exact:true})).toHaveValue('13:07');await expect(restoredPresence.getByLabel('结束时间 1',{exact:true})).toHaveValue('13:52');await close(a);await a.reload();await expect(a.getByRole('button',{name:/本日在场时间/})).toContainText('不能参加');await expect(a.getByRole('button',{name:/本日在场时间/})).toContainText('已确认')
 await tab(a,'同行');await a.getByRole('button',{name:'成员',exact:true}).click();await expect(a.getByRole('button',{name:'管理小队',exact:true})).toHaveCount(0);await expect(a.getByRole('button',{name:/^移除 队/})).toHaveCount(0)
 await Promise.all(contexts.map(c=>c.close()))
})


test('私密活动建队明确403后改正使用新操作和有效权限',async({browser})=>{
 const context=await browser.newContext(),page=await context.newPage()
 await page.goto('/create?personal=1');await page.getByLabel('活动名称').fill('私密创建码改正重试');await page.getByLabel('站点创建码').fill('test-create');await page.getByRole('button',{name:'确认创建',exact:true}).click();await expect(page).toHaveURL(/\/events\//);await tab(page,'同行');await page.getByRole('button',{name:'创建小队',exact:true}).click();await page.getByLabel('小队标题').fill('创建码改正重试')
 await page.getByLabel('站点创建码',{exact:true}).fill('wrong-test-code');let response=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname.endsWith('/groups'))
 await page.getByRole('button',{name:'确认创建',exact:true}).click();const denied=await response;expect(denied.status()).toBe(403);const first=denied.request().postDataJSON();await expect(page.getByRole('alert')).toContainText('创建码未通过');await expect(page.getByRole('alert')).toContainText('核对后重试')
 await page.getByLabel('站点创建码',{exact:true}).fill('test-create');response=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname.endsWith('/groups'))
 await page.getByRole('button',{name:'确认创建',exact:true}).click();const accepted=await response;expect(accepted.status()).toBe(200);const retry=accepted.request().postDataJSON()
 expect(retry.operationId).not.toBe(first.operationId);expect(retry.managerToken).not.toBe(first.managerToken);expect(retry.inviteToken).not.toBe(first.inviteToken);const g=(await accepted.json()).data;expect((await page.request.get(`${API_BASE}/api/v1/groups/${g.id}`,{headers:{Authorization:'Bearer '+retry.managerToken}})).status()).toBe(200);expect((await page.request.get(`${API_BASE}/api/v1/groups/${g.id}`,{headers:{Authorization:'Bearer '+retry.inviteToken}})).status()).toBe(200)
 await expect(page.getByLabel('怎么称呼')).toBeVisible();await context.close()
})
