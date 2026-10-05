import {test,expect,type Page} from '@playwright/test'
import {mkdirSync} from 'node:fs'
import {settleTheme} from './figma-visual'
import {publishFixture,loginAdmin,close} from './activity-fixture'
import {API_BASE} from './api-base'
import {randomBytes,randomUUID} from 'node:crypto'

test('旧长建队码兼容：管理员生成复制、一次消费、历史状态与撤销',async({browser})=>{
 test.setTimeout(180_000)
 const pack=await publishFixture(browser,'creation-invite-ui')
 const adminContext=await browser.newContext({permissions:['clipboard-read','clipboard-write'],viewport:{width:390,height:900}})
 const leaderContext=await browser.newContext({permissions:['clipboard-read','clipboard-write'],viewport:{width:375,height:900}})
 const admin=await adminContext.newPage(),leader=await leaderContext.newPage()
 await admin.goto('/admin');await loginAdmin(admin);await admin.getByRole('button',{name:new RegExp(pack.event.title)}).click()
 await admin.getByRole('button',{name:'建队码',exact:true}).click()
 const issued=admin.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/admin/creation-invites'))
 await admin.getByRole('button',{name:'生成建队码',exact:true}).click();expect((await issued).status()).toBe(200)
 await admin.getByRole('button',{name:'复制长文字码',exact:true}).click()
 const code=await admin.evaluate(()=>navigator.clipboard.readText());expect(code).toMatch(/^[a-f0-9]{64}$/)
 const directory='/tmp/tongye-meet-private/creation-invites-checkpoint/v18-ui-screens';mkdirSync(directory,{recursive:true})
 async function screen(label:string,page:Page){for(const width of [375,390,430,1440])for(const theme of ['light','dark'] as const){await page.setViewportSize({width,height:900});await settleTheme(page,theme);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`${directory}/${label}-${width}-${theme}.png`,animations:'disabled',mask:[page.getByLabel('新建队码'),page.getByLabel('建队码',{exact:true}),page.getByLabel('管理恢复链接')]})}}
 await screen('admin-code',admin)
 await leader.goto(`/events/${pack.event.id}?view=companions`)
 await expect(leader.getByRole('button',{name:'创建',exact:true})).toBeDisabled()
 await expect(leader.getByLabel('建队码',{exact:true})).toHaveCount(0);await leader.getByLabel('小队标题',{exact:true}).fill('真实文字码小队')
 await screen('create',leader)
 // Public creation is code-free. Explicit older creation grants remain valid
 // at the API boundary and must retain one-use/revocation guarantees.
 const activity=(await (await leaderContext.request.get(`${API_BASE}/api/v1/events/${pack.event.id}`)).json()).data
 const legacyRequest=(creationCode:string)=>({creationCode,sourceEventId:pack.event.id,sourceEventRevision:activity.revision,title:'真实文字码小队',managerToken:randomBytes(32).toString('hex'),inviteToken:randomBytes(32).toString('hex'),operationId:randomUUID()})
 const body=legacyRequest(code),accepted=await leaderContext.request.post(API_BASE+'/api/v1/groups',{data:body});expect(accepted.status()).toBe(200)
 const group=(await accepted.json()).data;await leader.goto(`/groups/${group.id}#manager=${body.managerToken}&invite=${body.inviteToken}`)
 await leader.getByLabel('怎么称呼').fill('队长');await leader.getByRole('button',{name:'加入小队',exact:true}).click()
 await leader.getByRole('button',{name:'邀请队员',exact:true}).click();const dialog=leader.getByRole('dialog',{name:'管理小队'})
 await expect(dialog.locator('svg[width="180"]')).toHaveCount(0)
 await expect(dialog.getByLabel('邀请链接')).toHaveCount(0)
 await screen('manager',leader)
 await dialog.getByRole('button',{name:'复制链接',exact:true}).click();const invite=await leader.evaluate(()=>navigator.clipboard.readText());expect(invite).toContain('#invite=')
 await dialog.getByRole('button',{name:'更换成员邀请',exact:true}).click();await expect(leader.getByRole('dialog',{name:'更换邀请链接'})).toBeVisible()
 await leader.getByRole('button',{name:'取消',exact:true}).click();await expect(dialog).toBeVisible();await close(leader)
 await close(admin);await admin.getByRole('button',{name:new RegExp(pack.event.title)}).click();await admin.getByRole('button',{name:'建队码',exact:true}).click()
 await expect(admin.locator('.creation-invite-history').getByText('已使用',{exact:true})).toBeVisible();await expect(admin.locator('.creation-invite-history')).not.toContainText(code)
 await admin.getByRole('button',{name:'生成建队码',exact:true}).click();await expect(admin.getByRole('button',{name:'撤销该码',exact:true}).first()).toBeVisible()
 await admin.getByRole('button',{name:'复制长文字码',exact:true}).click();const revokedCode=await admin.evaluate(()=>navigator.clipboard.readText())
 await admin.getByRole('button',{name:'撤销该码',exact:true}).first().click();await expect(admin.getByRole('dialog',{name:'撤销建队码'})).toBeVisible()
 await admin.getByRole('button',{name:'取消',exact:true}).click();await expect(admin.getByRole('button',{name:'撤销该码',exact:true}).first()).toBeVisible()
 await admin.getByRole('button',{name:'撤销该码',exact:true}).first().click();const revoked=admin.waitForResponse(r=>r.request().method()==='DELETE'&&r.url().includes('/admin/creation-invites/'))
 await admin.getByRole('button',{name:'确认撤销',exact:true}).click();expect((await revoked).status()).toBe(200)
 await expect(admin.locator('.creation-invite-history').getByText('已撤销',{exact:true})).toBeVisible()
 const outsider=await browser.newContext()
 const used=await outsider.request.post(API_BASE+'/api/v1/groups',{data:legacyRequest(code)});expect(used.status()).toBe(403);expect((await used.json()).error.message).toContain('已被使用')
 const rejected=await outsider.request.post(API_BASE+'/api/v1/groups',{data:legacyRequest(revokedCode)});expect(rejected.status()).toBe(403);expect((await rejected.json()).error.message).toContain('已被撤销');await outsider.close()
 expect(await leader.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 await Promise.all([adminContext.close(),leaderContext.close()])
})

test('管理员发码响应丢失后同操作重试，不重复签发；复制失败不显示成功',async({browser})=>{
 const pack=await publishFixture(browser,'creation-response-loss'),context=await browser.newContext(),page=await context.newPage()
 await page.goto('/admin');await loginAdmin(page);await page.getByRole('button',{name:new RegExp(pack.event.title)}).click();await page.getByRole('button',{name:'建队码',exact:true}).click()
 const requests:unknown[]=[];let dropped=false
 await page.route('**/admin/creation-invites',async route=>{if(route.request().method()!=='POST')return route.continue();requests.push(route.request().postDataJSON());const response=await route.fetch();expect(response.status()).toBe(200);if(!dropped){dropped=true;return route.abort('failed')}await route.fulfill({response})})
 await page.getByRole('button',{name:'生成建队码',exact:true}).click();await expect(page.getByRole('dialog').getByRole('alert')).toContainText('连接失败');await expect(page.getByLabel('新建队码')).toHaveCount(0)
 await page.getByRole('button',{name:'生成建队码',exact:true}).click();await expect(page.getByLabel('新建队码')).toBeVisible();expect(requests).toHaveLength(2);expect(requests[1]).toEqual(requests[0]);await expect(page.locator('.figma-code-history-row')).toHaveCount(1)
 await page.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new Error('test clipboard denied')}}})})
 await page.getByRole('button',{name:'复制长文字码',exact:true}).click();await expect(page.getByRole('dialog').getByRole('alert')).toContainText('复制失败');await expect(page.getByText('建队码已复制',{exact:true})).toHaveCount(0)
 await close(page);await page.getByRole('button',{name:new RegExp(pack.event.title)}).click();await page.getByRole('button',{name:'建队码',exact:true}).click();await expect(page.getByLabel('新建队码')).toHaveCount(0);await expect(page.locator('.figma-code-history-row')).toHaveCount(1);await context.close()
})

test('创建中离开同行页不被晚到响应拉回，小队恢复权限仍保存',async({browser})=>{
 const pack=await publishFixture(browser,'creation-leave-pending'),context=await browser.newContext(),page=await context.newPage()
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve});let observed!:()=>void;const written=new Promise<void>(resolve=>{observed=resolve})
 await page.route('**/api/v1/groups',async route=>{if(route.request().method()!=='POST')return route.continue();const response=await route.fetch();expect(response.status()).toBe(200);observed();await gate;await route.fulfill({response})})
 await page.goto(`/events/${pack.event.id}?view=companions`);await page.getByLabel('小队标题').fill('晚到创建的小队');await page.getByRole('button',{name:'创建',exact:true}).click();await written
 try{await expect(page.getByRole('button',{name:'创建中',exact:true})).toBeDisabled();await expect(page.getByLabel('小队标题')).toBeDisabled();await page.locator('.tabbar').getByRole('button',{name:'我的',exact:true}).click()}finally{release()}
 await expect(page.getByRole('heading',{name:'我的',exact:true})).toBeVisible();await expect(page.getByLabel('怎么称呼')).toHaveCount(0)
 await expect.poll(()=>page.evaluate(()=>location.search)).toContain('view=me')
 await page.locator('.tabbar').getByRole('button',{name:'同行',exact:true}).click();await expect(page.getByRole('button',{name:'晚到创建的小队',exact:true})).toBeVisible();await context.close()
})
