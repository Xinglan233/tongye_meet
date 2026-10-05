import {test,expect,type Page} from '@playwright/test'
import {readFileSync} from 'node:fs'
import type {ActivityDTO,PersonalDTO} from '../../shared/activity-contract'
import type {PersonalDraft} from '../../src/online/activity/personal-state'
import type {EventPackage} from '../../shared/types'
import {imageFixture,tab,close} from './activity-fixture'

const pack=JSON.parse(readFileSync('examples/convention-demo.v2.json','utf8')) as EventPackage
function record(id:string,name:string){
 const eventPackage=structuredClone(pack);eventPackage.event.id=id;eventPackage.event.title=id
 const activity:ActivityDTO={id,revision:2,scheduleRevision:2,spatialRevision:2,status:'published',visibility:'public',eventPackage,updatedAt:'2026-10-05T00:00:00Z'}
 const draft:PersonalDraft={eventId:id,personId:'person-'+id,revision:1,scheduleRevision:1,spatialRevision:1,generation:7,dirty:true,plan:{response:{name,presence:[],busy:[],bufferMinutes:0},favorites:[],routes:[]}}
 const remote:PersonalDTO={id:draft.personId,eventId:id,revision:3,scheduleRevision:2,spatialRevision:2,plan:draft.plan,updatedAt:activity.updatedAt}
 return {activity,draft,remote}
}
async function local(page:Page,key:string){return page.evaluate(key=>new Promise<PersonalDraft>(resolve=>{const r=indexedDB.open('coukong-online-v1',1);r.onsuccess=()=>{const q=r.result.transaction('records').objectStore('records').get(key);q.onsuccess=()=>{resolve(q.result);r.result.close()}}}),key)}

for(const scenario of ['edit','switch'] as const)test(`迟到的个人核对GET不能覆盖${scenario==='edit'?'继续编辑的新草稿':'另一活动的当前草稿'}`,async({page})=>{
 const a=record('review-race-a','原稿称呼'),b=record('review-race-b','另一活动称呼')
 let hold=false,started!:()=>void,release!:()=>void
 const waiting=new Promise<void>(resolve=>{started=resolve}),stalled=new Promise<void>(resolve=>{release=resolve})
 await imageFixture(page)
 await page.route('**/api/v1/**',async route=>{
  const path=new URL(route.request().url()).pathname
  if(route.request().method()==='PUT')return route.fulfill({status:409,json:{error:{code:'VERSION_CONFLICT',message:'测试资料版本已更新'}}})
  if(path.endsWith('/links'))return route.fulfill({json:{data:[]}})
  if(path.endsWith(`/personal/${a.remote.id}`)){if(hold){started();await stalled}return route.fulfill({json:{data:a.remote}})}
  if(path.endsWith(`/personal/${b.remote.id}`))return route.fulfill({json:{data:b.remote}})
  if(path.endsWith('/events'))return route.fulfill({json:{data:[a.activity,b.activity]}})
  const activity=path.endsWith('/'+b.activity.id)?b.activity:a.activity
  return route.fulfill({json:{data:activity}})
 })
 await page.goto('/');await expect(page.getByRole('heading',{name:'选择活动'})).toBeVisible()
 await page.evaluate(records=>new Promise<void>(resolve=>{const r=indexedDB.open('coukong-online-v1',1);r.onsuccess=()=>{const t=r.result.transaction('records','readwrite'),store=t.objectStore('records');for(const record of records){store.put(record.draft,`activity-personal:${record.activity.id}`);store.put({eventId:record.activity.id,personId:record.draft.personId,token:'a'.repeat(64),operationId:'fixture-person'},`activity-cap:${record.activity.id}`)}t.oncomplete=()=>{r.result.close();resolve()}}}),[a,b])
 await page.goto(`/events/${a.activity.id}?view=plan&date=2026-10-03`)
 await page.getByRole('button',{name:'保存个人计划',exact:true}).click();await expect(page.getByRole('alert')).toContainText('测试资料版本已更新')
 await tab(page,'我的');await page.getByRole('button',{name:'恢复与导出',exact:true}).click()
 hold=true;page.once('dialog',dialog=>dialog.accept())
 await page.getByRole('button',{name:'已核对，保留草稿',exact:true}).click();await waiting;await close(page)
 if(scenario==='edit'){
  await page.getByLabel('个人称呼').fill('继续编辑的新称呼')
  await expect.poll(async()=>(await local(page,`activity-personal:${a.activity.id}`)).plan.response.name).toBe('继续编辑的新称呼')
 }else{
  await page.getByRole('button',{name:'切换活动',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:new RegExp(b.activity.id)}).click()
  await tab(page,'我的');await expect(page.getByLabel('个人称呼')).toHaveValue('另一活动称呼')
 }
 const late=page.waitForResponse(r=>r.request().method()==='GET'&&new URL(r.url()).pathname.endsWith(`/personal/${a.remote.id}`))
 release();await late
 // A later user action runs after the response handler and checks its persisted result.
 await page.getByRole('button',{name:'恢复与导出',exact:true}).click();await close(page)
 const retained=await local(page,`activity-personal:${a.activity.id}`)
 expect(await local(page,`activity-submit:${a.activity.id}:${a.draft.personId}`)).not.toBeUndefined()
 if(scenario==='edit'){
  await expect(page.getByLabel('个人称呼')).toHaveValue('继续编辑的新称呼')
  expect(retained).toMatchObject({generation:8,scheduleRevision:1,spatialRevision:1,plan:{response:{name:'继续编辑的新称呼'}}})
  await expect(page.getByRole('status').filter({hasText:'重新核对'})).toBeVisible()
 }else{
  await expect(page.getByLabel('个人称呼')).toHaveValue('另一活动称呼')
  expect(retained).toEqual(a.draft)
  expect(await local(page,`activity-personal:${b.activity.id}`)).toEqual(b.draft)
 }
})
