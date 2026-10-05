import {test,expect} from '@playwright/test'
import {API_BASE} from './api-base'
import {publishFixture,imageFixture,tab} from './activity-fixture'

const token=()=>crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','')
test('本人计划一次更新本队空闲，不写个人备份、不公开私人备注，邀请保留日期',async({browser,request})=>{
 test.setTimeout(60000)
 const manager=token(),invite=token(),personal=token()
 const pack=await publishFixture(browser,'field-team',undefined,pack=>{pack.event.endDate='2026-10-04';if(!pack.event.days.some(d=>d.date==='2026-10-04'))pack.event.days.push({...structuredClone(pack.event.days[0]),date:'2026-10-04'})})
 let result=await request.get(`${API_BASE}/api/v1/events/${pack.event.id}`)
 expect(result.status()).toBe(200);const activity=(await result.json()).data
 result=await request.post(API_BASE+'/api/v1/groups',{data:{sourceEventId:pack.event.id,sourceEventRevision:activity.revision,creationCode:'test-create',title:'现场小队',managerToken:manager,inviteToken:invite,operationId:crypto.randomUUID()}})
 expect(result.status()).toBe(200);const group=(await result.json()).data
 result=await request.post(`${API_BASE}/api/v1/events/${pack.event.id}/personal`,{data:{personalToken:personal,name:'私人名字',operationId:crypto.randomUUID()}})
 expect(result.status()).toBe(200);const own=(await result.json()).data
 own.plan.response.presence=[{date:'2026-10-03',intervals:[{start:'13:00',end:'18:00'}]}]
 own.plan.response.busy=[{id:'exact-minute',date:'2026-10-03',start:'13:07',end:'13:52',title:'私人安排',source:'manual',note:'不应复制的私人备注'}]
 result=await request.put(`${API_BASE}/api/v1/events/${pack.event.id}/personal/${own.id}`,{headers:{Authorization:'Bearer '+personal},data:{plan:own.plan,expectedRevision:own.revision,scheduleRevision:own.scheduleRevision,spatialRevision:own.spatialRevision,operationId:crypto.randomUUID()}})
 expect(result.status()).toBe(200)
 const context=await browser.newContext({viewport:{width:390,height:900}}),page=await context.newPage();await imageFixture(page)
 const ownerContext=await browser.newContext({permissions:['clipboard-read','clipboard-write']}),ownerPage=await ownerContext.newPage();await imageFixture(ownerPage)
 await ownerPage.goto(`/groups/${group.id}?date=2026-10-04#manager=${manager}&invite=${invite}`)
 await ownerPage.getByRole('button',{name:'邀请队员',exact:true}).click()
 await ownerPage.getByRole('dialog',{name:'管理小队'}).getByRole('button',{name:'复制链接',exact:true}).click()
 const generatedInvite=await ownerPage.evaluate(()=>navigator.clipboard.readText())
 expect(new URL(generatedInvite).searchParams.get('date')).toBe('2026-10-04')
 expect(new URLSearchParams(new URL(generatedInvite).hash.slice(1)).get('invite')).toBe(invite)
 expect(new URLSearchParams(new URL(generatedInvite).hash.slice(1)).has('manager')).toBe(false)
 await ownerContext.close()
 await page.goto(generatedInvite)
 await expect(page.getByLabel('怎么称呼')).toBeVisible()
 await expect(page).toHaveURL(new RegExp(`events/${pack.event.id}.*date=2026-10-04`),{timeout:5000})
 await page.getByLabel('怎么称呼').fill('本队称呼');await page.getByRole('button',{name:'加入小队',exact:true}).click()
 await expect(page.getByRole('button',{name:'日程设置',exact:true})).toBeVisible()
 await page.goto(`/events/${pack.event.id}?group=${group.id}&view=companions&date=2026-10-03#personal=${personal}&personId=${own.id}`)
 await expect(page.getByRole('button',{name:'更新本队空闲',exact:true})).toBeVisible({timeout:5000})
 const writes:string[]=[];page.on('request',r=>{if(r.method()==='PUT')writes.push(r.url())})
 const submitted=page.waitForResponse(r=>r.request().method()==='PUT'&&r.url().endsWith('/response'))
 await page.getByRole('button',{name:'更新本队空闲',exact:true}).click()
 const accepted=await submitted;expect(accepted.status()).toBe(200)
 const submittedBody=accepted.request().postDataJSON()
 expect(submittedBody.response.name).toBe('本队称呼')
 expect(submittedBody.response.busy[0]).toMatchObject({start:'13:07',end:'13:52'})
 expect(JSON.stringify(submittedBody)).not.toContain('不应复制的私人备注')
 expect(writes).toHaveLength(1);expect(writes[0]).toContain('/response')
 await expect(page.getByRole('status').filter({hasText:'已提交'})).toBeVisible()
 const visible=await request.get(`${API_BASE}/api/v1/groups/${group.id}/availability`,{headers:{Authorization:'Bearer '+manager}})
 expect(visible.status()).toBe(200);expect(JSON.stringify(await visible.json())).not.toMatch(/私人安排|私人备注|favorites|routes/)
 await tab(page,'我的');await expect(page.getByLabel('个人称呼')).toHaveValue('私人名字')
 await context.close()
})

test('本机草稿写入等待期间的新编辑不被旧本队提交标记或清除',async({browser,request})=>{
 test.setTimeout(60000)
 const manager=token(),invite=token(),personal=token()
 const pack=await publishFixture(browser,'field-team-race',undefined,pack=>{pack.event.endDate='2026-10-04';if(!pack.event.days.some(d=>d.date==='2026-10-04'))pack.event.days.push({...structuredClone(pack.event.days[0]),date:'2026-10-04'})})
 let result=await request.get(`${API_BASE}/api/v1/events/${pack.event.id}`)
 expect(result.status()).toBe(200);const activity=(await result.json()).data
 result=await request.post(API_BASE+'/api/v1/groups',{data:{sourceEventId:pack.event.id,sourceEventRevision:activity.revision,creationCode:'test-create',title:'现场小队',managerToken:manager,inviteToken:invite,operationId:crypto.randomUUID()}})
 expect(result.status()).toBe(200);const group=(await result.json()).data
 result=await request.post(`${API_BASE}/api/v1/events/${pack.event.id}/personal`,{data:{personalToken:personal,name:'私人名字',operationId:crypto.randomUUID()}})
 expect(result.status()).toBe(200);const own=(await result.json()).data
 own.plan.response.presence=[{date:'2026-10-03',intervals:[{start:'13:00',end:'18:00'}]}]
 own.plan.response.busy=[{id:'exact-minute',date:'2026-10-03',start:'13:07',end:'13:52',title:'私人安排',source:'manual',note:'不应复制的私人备注'}]
 result=await request.put(`${API_BASE}/api/v1/events/${pack.event.id}/personal/${own.id}`,{headers:{Authorization:'Bearer '+personal},data:{plan:own.plan,expectedRevision:own.revision,scheduleRevision:own.scheduleRevision,spatialRevision:own.spatialRevision,operationId:crypto.randomUUID()}})
 expect(result.status()).toBe(200)
 const context=await browser.newContext({viewport:{width:390,height:900}}),page=await context.newPage();await imageFixture(page)
 const ownerContext=await browser.newContext({permissions:['clipboard-read','clipboard-write']}),ownerPage=await ownerContext.newPage();await imageFixture(ownerPage)
 await ownerPage.goto(`/groups/${group.id}?date=2026-10-04#manager=${manager}&invite=${invite}`)
 await ownerPage.getByRole('button',{name:'邀请队员',exact:true}).click()
 await ownerPage.getByRole('dialog',{name:'管理小队'}).getByRole('button',{name:'复制链接',exact:true}).click()
 const generatedInvite=await ownerPage.evaluate(()=>navigator.clipboard.readText())
 expect(new URL(generatedInvite).searchParams.get('date')).toBe('2026-10-04')
 expect(new URLSearchParams(new URL(generatedInvite).hash.slice(1)).get('invite')).toBe(invite)
 expect(new URLSearchParams(new URL(generatedInvite).hash.slice(1)).has('manager')).toBe(false)
 await ownerContext.close()
 await page.goto(generatedInvite)
 await expect(page.getByLabel('怎么称呼')).toBeVisible()
 await expect(page).toHaveURL(new RegExp(`events/${pack.event.id}.*date=2026-10-04`),{timeout:5000})
 await page.getByLabel('怎么称呼').fill('本队称呼');await page.getByRole('button',{name:'加入小队',exact:true}).click()
 await expect(page.getByRole('button',{name:'日程设置',exact:true})).toBeVisible()
 await page.goto(`/events/${pack.event.id}?group=${group.id}&view=companions&date=2026-10-03#personal=${personal}&personId=${own.id}`)
 await expect(page.getByRole('button',{name:'更新本队空闲',exact:true})).toBeVisible({timeout:5000})

 await page.evaluate(()=>{
  const state=window as typeof window&{__draftGate?:boolean;__draftHeld?:boolean;__releaseDraft?:()=>void};state.__draftGate=true
  const put=IDBObjectStore.prototype.put,completion=Object.getOwnPropertyDescriptor(IDBTransaction.prototype,'oncomplete')!
  const held=new WeakSet<IDBTransaction>()
  IDBObjectStore.prototype.put=function(value:unknown,key?:IDBValidKey){if(state.__draftGate&&typeof key==='string'&&key.startsWith('draft:')){state.__draftGate=false;held.add(this.transaction)}return put.call(this,value,key!)}
  Object.defineProperty(IDBTransaction.prototype,'oncomplete',{...completion,set(handler:(event:Event)=>void){completion.set!.call(this,function(this:IDBTransaction,event:Event){if(held.has(this)){state.__draftHeld=true;state.__releaseDraft=()=>handler.call(this,event)}else handler.call(this,event)})}})
 })
 await page.getByRole('button',{name:'更新本队空闲',exact:true}).click()
 await expect.poll(()=>page.evaluate(()=>(window as typeof window&{__draftHeld?:boolean}).__draftHeld)).toBe(true)
 await page.getByRole('button',{name:'日程设置',exact:true}).click()
 await page.getByRole('dialog',{name:'日程设置'}).getByLabel('怎么称呼').fill('保存等待期间的新编辑')
 await page.getByRole('dialog',{name:'日程设置'}).getByRole('button',{name:'完成',exact:true}).click()
 const submitted=page.waitForResponse(r=>r.request().method()==='PUT'&&r.url().endsWith('/response'))
 await page.evaluate(()=>(window as typeof window&{__releaseDraft?:()=>void}).__releaseDraft?.())
 expect((await submitted).request().postDataJSON().response.name).toBe('本队称呼')
 await expect(page.getByRole('status').filter({hasText:'未提交'})).toBeVisible()
 await page.reload();await page.getByRole('button',{name:'日程设置',exact:true}).click()
 await expect(page.getByRole('dialog',{name:'日程设置'}).getByLabel('怎么称呼')).toHaveValue('保存等待期间的新编辑')
 await context.close()
})
