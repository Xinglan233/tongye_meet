import {test,expect,type Page} from '@playwright/test'
import {randomUUID} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {publishFixture,enter,tab,close,loginAdmin,adminSession} from './activity-fixture'
import {API_BASE} from './api-base'
import {download} from './ui-helpers'
import type {EventPackage} from '../../shared/types'
import type {MediaAssetDTO,PersonalPlan} from '../../shared/activity-contract'

async function localRecord<T>(page:Page,key:string):Promise<T|undefined>{return page.evaluate(key=>new Promise((resolve,reject)=>{const open=indexedDB.open('coukong-online-v1',1);open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result,read=db.transaction('records').objectStore('records').get(key);read.onsuccess=()=>{db.close();resolve(read.result)};read.onerror=()=>reject(read.error)}}),key)}

test('组队响应丢失保留原幂等请求，重载重试只恢复同一小队',async({browser})=>{
 test.setTimeout(90000)
 const pack=await publishFixture(browser,'create-lost-response'),context=await browser.newContext(),page=await context.newPage(),attempts:unknown[]=[],ids:string[]=[]
 await page.route('**/api/v1/groups',async route=>{if(route.request().method()!=='POST')return route.continue();attempts.push(route.request().postDataJSON());const response=await route.fetch();expect(response.status()).toBe(200);ids.push((await response.json()).data.id);if(attempts.length===1)return route.abort('failed');await route.fulfill({response})})
 const create=async()=>{await page.getByLabel('小队标题').fill('丢响应恢复小队');await page.getByRole('button',{name:'创建',exact:true}).click()}
 await page.goto(`/events/${pack.event.id}?view=companions`);await create();await expect(page.getByRole('alert')).toContainText('连接失败')
 expect(await localRecord(page,`activity-create-group:${pack.event.id}`)).toMatchObject(attempts[0] as Record<string,unknown>);expect(await localRecord(page,`activity-create-group:${pack.event.id}`)).toMatchObject({creatorName:'我'});await page.reload();await create();await expect(page.getByRole('alert')).toContainText('上次创建的小队已恢复');await expect(page.getByLabel('小队标题')).toHaveValue('丢响应恢复小队');await page.getByRole('button',{name:'丢响应恢复小队',exact:true}).click();await expect(page.getByRole('button',{name:'日程设置',exact:true})).toBeVisible()
 expect(attempts).toHaveLength(2);expect(attempts[1]).toEqual(attempts[0]);expect(ids[1]).toBe(ids[0]);await expect.poll(()=>localRecord(page,`activity-create-group:${pack.event.id}`)).toBeUndefined();await context.close()
})

test('明确活动版本冲突清除旧组队请求；刷新后使用新版本与新操作',async({browser,request})=>{
 test.setTimeout(90000)
 const pack=await publishFixture(browser,'create-version-conflict'),context=await browser.newContext(),page=await context.newPage(),token='c'.repeat(64)
 await page.goto(`/events/${pack.event.id}?view=companions`)
 await expect(page.getByLabel('小队标题')).toBeVisible()
 await adminSession(request,token)
 const previous=(await (await request.get(`${API_BASE}/api/v1/events/${pack.event.id}`)).json()).data
 const changed=structuredClone(pack);changed.event.description='同一活动已发布新资料'
 const result=await request.post(`${API_BASE}/api/v1/admin/events`,{headers:{Authorization:'Bearer '+token},data:{eventPackage:changed,status:'published',expectedRevision:previous.revision,operationId:randomUUID()}})
 expect(result.status()).toBe(200);const latest=(await result.json()).data
 const attempts:{operationId:string;sourceEventRevision:number}[]=[]
 await page.route('**/api/v1/groups',async route=>{if(route.request().method()==='POST')attempts.push(route.request().postDataJSON());await route.continue()})
 await page.getByLabel('小队标题').fill('版本冲突后创建')
 let reply=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/groups'));await page.getByRole('button',{name:'创建',exact:true}).click()
 expect((await reply).status()).toBe(409);await expect(page.getByText('活动版本已变化',{exact:true})).toBeVisible()
 await expect.poll(()=>localRecord(page,`activity-create-group:${pack.event.id}`)).toBeUndefined()
 await page.reload();await page.getByLabel('小队标题').fill('版本冲突后创建')
 reply=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/groups'));await page.getByRole('button',{name:'创建',exact:true}).click();expect((await reply).status()).toBe(200)
 expect(attempts).toHaveLength(2);expect(attempts[0].sourceEventRevision).toBe(previous.revision);expect(attempts[1].sourceEventRevision).toBe(latest.revision);expect(attempts[0].operationId).not.toBe(attempts[1].operationId)
 await context.close()
})

for(const originOnly of [false,true])test(`加入另一地图地点不破坏当日路线${originOnly?'（只有起点）':''}，收藏日程独立，同图追加与移出正常`,async({browser})=>{
 test.setTimeout(90000)
 const pack=await publishFixture(browser,originOnly?'cross-map-route-origin':'cross-map-route',undefined,p=>{const c=p.event.extensions!.convention;c.maps.push({...c.maps[0],id:'second-map',title:'第二张虚构地图'});c.pois[1].position!.mapId='second-map';delete c.pois[1].routeNodeId})
 const context=await browser.newContext({viewport:{width:390,height:900}}),page=await context.newPage();await enter(page,pack)
 const open=async(name:string)=>{await page.locator('.activity-place-pane .sched-row').filter({hasText:name}).click();return page.getByRole('dialog')}
 let sheet=await open('示例地点 A');await sheet.getByRole('button',{name:'收藏',exact:true}).click();if(!originOnly)await sheet.getByRole('button',{name:'加入路线',exact:true}).click();await close(page);if(originOnly){await tab(page,'计划');await page.getByRole('button',{name:'路线',exact:true}).click();await page.getByLabel('路线起点',{exact:true}).selectOption('poi-a');await tab(page,'探索')}
 sheet=await open('示例地点 B');await sheet.getByRole('button',{name:'加入路线',exact:true}).click()
 await expect(sheet.getByRole('alert')).toHaveText('这个地点属于另一张地图，请先移除当天原路线，再添加新地图的地点。');await close(page)
 const key=`activity-personal:${pack.event.id}`
 const first=await localRecord<{plan:PersonalPlan}>(page,key);expect(first!.plan.routes[0]).toMatchObject({mapId:'demo-map',...(originOnly?{startPoiId:'poi-a'}:{}),stops:originOnly?[]:[{poiId:'poi-a',visited:false}]});expect(first!.plan.favorites).toEqual([{poiId:'poi-a',visited:false}]);expect(first!.plan.response.busy).toEqual([])
 sheet=await open('示例地点 C');await sheet.getByRole('button',{name:'加入路线',exact:true}).click();await close(page)
 await expect.poll(async()=>((await localRecord<{plan:PersonalPlan}>(page,key))!.plan.routes[0].stops.map(s=>s.poiId))).toEqual(originOnly?['poi-c']:['poi-a','poi-c'])
 sheet=await open('示例地点 A');if(originOnly){await sheet.getByRole('button',{name:'加入路线',exact:true}).click();await expect(sheet.getByRole('button',{name:'移出路线',exact:true})).toBeVisible()}await sheet.getByRole('button',{name:'移出路线',exact:true}).click();await close(page)
 await tab(page,'我的');await page.getByRole('button',{name:'恢复与导出',exact:true}).click();const exported=JSON.parse(await download(page,'导出个人计划'));expect(exported.plan.routes[0]).toMatchObject({mapId:'demo-map',...(originOnly?{startPoiId:'poi-a'}:{}),stops:[{poiId:'poi-c',visited:false}]});expect(exported.plan.favorites).toEqual([{poiId:'poi-a',visited:false}]);expect(exported.plan.response.busy).toEqual([]);await close(page);await tab(page,'计划');await page.getByRole('button',{name:'路线',exact:true}).click();const beforeOrigin=(await localRecord<{plan:PersonalPlan}>(page,key))!.plan;await page.getByLabel('路线起点',{exact:true}).selectOption('poi-b');await expect(page.getByRole('alert')).toHaveText('起点不在当前路线地图，请选择同一地图的起点');expect((await localRecord<{plan:PersonalPlan}>(page,key))!.plan).toEqual(beforeOrigin);await expect(page.getByLabel('路线起点',{exact:true})).toHaveValue(originOnly?'poi-a':'')
 await context.close()
})

for(const originOnly of [false,true])test(`收藏入口跨地图追加${originOnly?'（只有起点）':''}保留原路线；同图追加正常`,async({browser})=>{
 test.setTimeout(90000)
 const pack=await publishFixture(browser,originOnly?'favorite-map-origin':'favorite-cross-map',undefined,p=>{const c=p.event.extensions!.convention;c.maps.push({...c.maps[0],id:'second-map',title:'第二张虚构地图'});c.pois[1].position!.mapId='second-map';delete c.pois[1].routeNodeId})
 const context=await browser.newContext({viewport:{width:390,height:900}}),page=await context.newPage();await enter(page,pack)
 for(const name of ['示例地点 A','示例地点 B','示例地点 C']){await page.locator('.activity-place-pane .sched-row').filter({hasText:name}).click();const d=page.getByRole('dialog');await d.getByRole('button',{name:'收藏',exact:true}).click();if(name==='示例地点 A'&&!originOnly)await d.getByRole('button',{name:'加入路线',exact:true}).click();await close(page)}
 const key=`activity-personal:${pack.event.id}`;await expect.poll(async()=>((await localRecord<{plan:PersonalPlan}>(page,key))!.plan.favorites.length)).toBe(3)
 await tab(page,'计划');if(originOnly){await page.getByRole('button',{name:'路线',exact:true}).click();await page.getByLabel('路线起点',{exact:true}).selectOption('poi-a')}
 await page.getByRole('button',{name:'收藏',exact:true}).click();const before=(await localRecord<{plan:PersonalPlan}>(page,key))!.plan
 await page.locator('.figma-favorite-entry').filter({hasText:'示例地点 B'}).getByRole('button',{name:'加入路线',exact:true}).click();await expect(page.getByRole('alert')).toHaveText('这个地点属于另一张地图，请先移除当天原路线，再添加新地图的地点。')
 expect((await localRecord<{plan:PersonalPlan}>(page,key))!.plan).toEqual(before)
 await page.locator('.figma-favorite-entry').filter({hasText:'示例地点 C'}).getByRole('button',{name:'加入路线',exact:true}).click();await expect(page.locator('.figma-favorite-entry').filter({hasText:'示例地点 C'}).getByRole('button',{name:'已加入今日路线',exact:true})).toBeDisabled()
 const next=(await localRecord<{plan:PersonalPlan}>(page,key))!.plan;expect(next.routes[0].mapId).toBe('demo-map');expect(next.routes[0].stops.map(s=>s.poiId)).toEqual(originOnly?['poi-c']:['poi-a','poi-c']);expect(next.favorites).toEqual(before.favorites);expect(next.response).toEqual(before.response);if(originOnly)expect(next.routes[0].startPoiId).toBe('poi-a')
 await expect(page.getByRole('alert')).toHaveCount(0);await context.close()
})

// Upload/read metadata are isolated fixtures; this verifies editor undo, not cloud Blob upload availability.
test('替换地图撤销同时恢复图片清单、地图和路网，且不撤销已上传资产',async({browser,request})=>{
 test.setTimeout(90000)
 const pack=await publishFixture(browser,'map-manifest-undo'),context=await browser.newContext(),page=await context.newPage(),map=pack.event.extensions!.convention.maps[0],original=pack.assetManifest![0]
 let uploaded:MediaAssetDTO|undefined;let deletes=0;page.on('request',r=>{if(r.method()==='DELETE'&&r.url().includes('/assets')||r.url().endsWith('/api/media/cleanup'))deletes++})
 await page.route('**/api/v1/admin/events/*/assets',async route=>{if(route.request().method()==='POST'){const b=route.request().postDataJSON();uploaded={id:'undo-ready-image',eventId:pack.event.id,assetKey:b.assetKey,state:'ready',mimeType:'image/png',width:map.width,height:map.height,sizeBytes:original.sizeBytes,sha256:'b'.repeat(64),revision:1} as MediaAssetDTO;return route.fulfill({json:{data:{asset:uploaded,pathname:'fixture-map',expiresAt:Date.now()+60000}}})}return route.fulfill({json:{data:[{id:'original-image',eventId:pack.event.id,state:'ready',revision:1,...original},...(uploaded?[uploaded]:[])]}})})
 await page.route('**/api/media/finish',route=>route.fulfill({json:{data:uploaded}}));await page.route('**/api/media/read?**',route=>route.fulfill({contentType:'image/png',body:readFileSync('examples/assets/convention-demo.png')}))
 await page.goto('/admin');await loginAdmin(page);await page.getByRole('button',{name:new RegExp(pack.event.title)}).click();const d=page.getByRole('dialog');await d.getByRole('button',{name:'地图',exact:true}).click();await d.locator('button[aria-expanded]').filter({hasText:'地图与通道'}).click();await d.locator('button[aria-expanded]').filter({hasText:'上传或替换地图'}).click();await d.getByLabel('替换当前地图').check();await d.getByLabel('地图名称').fill('替换后的虚构地图');await d.getByLabel('地图文件').setInputFiles('examples/assets/convention-demo.png')
 await expect(d.getByText('新图已上传。先预览保存新底图，再打开活动校对位置与通道。',{exact:true})).toBeVisible();await expect(d.getByLabel('地图标题')).toHaveValue('替换后的虚构地图')
 await d.getByRole('button',{name:'撤销上一步地图编辑'}).click();await expect(d.getByLabel('地图标题')).toHaveValue(map.title)
 await d.getByRole('button',{name:'导入或导出活动文件'}).click();const exported=JSON.parse(await download(page,'导出活动 JSON')) as EventPackage
 expect(exported.event.extensions!.convention).toEqual(pack.event.extensions!.convention);expect(exported.assetManifest).toEqual(pack.assetManifest);expect(uploaded?.state).toBe('ready');expect(deletes).toBe(0)
 const saved=(await (await request.get(`${API_BASE}/api/v1/events/${pack.event.id}`)).json()).data;expect(saved.eventPackage.assetManifest).toEqual(pack.assetManifest)
 await context.close()
})
