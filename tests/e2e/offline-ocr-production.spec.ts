import {API_BASE} from './api-base'
import {test,expect} from '@playwright/test'
import {build,preview,type PreviewServer} from 'vite'
import {mkdtempSync,readFileSync,writeFileSync,cpSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join as joinPath} from 'node:path'
import {create,join,closeSheet} from './ui-helpers'
let server:PreviewServer
const output=mkdtempSync(joinPath(tmpdir(),'tongye-ocr-pwa-'))
test.beforeAll(async()=>{process.env.VITE_API_URL=API_BASE;await build({build:{outDir:output,emptyOutDir:false},logLevel:'warn'});server=await preview({build:{outDir:output},preview:{host:'127.0.0.1',port:5174,strictPort:true},logLevel:'warn'})},120000)
test.afterAll(async()=>{server?.httpServer.closeAllConnections();await new Promise<void>(resolve=>server?.httpServer.close(()=>resolve()))})
test('明确准备中文英文引擎后，真实生产SW断网重启仍能截图识别',async({browser})=>{
 test.setTimeout(120000)
 const ownerContext=await browser.newContext(),memberContext=await browser.newContext({serviceWorkers:'allow'}),owner=await ownerContext.newPage(),member=await memberContext.newPage()
 const link=await create(owner,'OCR离线准备','http://localhost:5174');await join(member,link,'离线识别成员');await member.evaluate(async()=>{await navigator.serviceWorker.ready});await member.reload();expect(await member.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true)
 const manifest=JSON.parse(readFileSync(joinPath(output,'ocr-offline-manifest.json'),'utf8'))
 const precacheResources=await member.evaluate(async()=>{const keys=await caches.keys();const urls:string[]=[];for(const key of keys)if(key.includes('precache'))for(const request of await (await caches.open(key)).keys())urls.push(request.url);return urls})
 expect(precacheResources.some(url=>url.includes('traineddata')||/ocr-(engine|recognition)-/.test(url))).toBe(false)
 await member.getByRole('button',{name:'截图识别',exact:true}).click();await member.getByRole('button',{name:'准备离线识别',exact:true}).click();await expect(member.getByRole('status').filter({hasText:'离线识别已准备，可在断网后识别截图'})).toBeVisible({timeout:60000})
 const image=await member.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=1600;canvas.height=700;const ctx=canvas.getContext('2d')!;ctx.fillStyle='white';ctx.fillRect(0,0,1600,700);ctx.fillStyle='black';ctx.font='72px sans-serif';ctx.fillText('12:00-13:00',80,150);ctx.fillText('A-01 Test',80,300);ctx.fillText('Meeting',80,450);return canvas.toDataURL('image/png').split(',')[1]})
 await closeSheet(member);await memberContext.setOffline(true);await member.reload();await member.getByRole('button',{name:'截图识别',exact:true}).click();await expect(member.getByText(/离线识别已准备 ·/)).toBeVisible({timeout:15000})
 const resources: string[]=[];member.on('response',response=>{if(manifest.resources.some((resource:{path:string})=>response.url().endsWith('/'+resource.path)))resources.push(response.url())})
 await member.getByRole('dialog',{name:'截图识别',exact:true}).locator('input[type=file]').setInputFiles({name:'offline-booking.png',mimeType:'image/png',buffer:Buffer.from(image,'base64')})
 await expect(member.getByRole('button',{name:'保存校对结果',exact:true})).toBeVisible({timeout:60000});expect(resources.some(url=>url.endsWith('/chi_sim.traineddata'))).toBe(true);expect(resources.some(url=>url.endsWith('/eng.traineddata'))).toBe(true)
 await ownerContext.close();await memberContext.close()
})

test('A准备后升级同路径B资源，重新准备可恢复完整B并保持离线校验门禁',async({browser})=>{
 test.setTimeout(120000)
 const ownerContext=await browser.newContext(),memberContext=await browser.newContext({serviceWorkers:'allow'}),owner=await ownerContext.newPage(),member=await memberContext.newPage()
 try{
  const link=await create(owner,'OCR升级重准备','http://localhost:5174');await join(member,link,'升级识别成员');await member.evaluate(async()=>{await navigator.serviceWorker.ready});await member.reload()
  await member.getByRole('button',{name:'截图识别',exact:true}).click();await member.getByRole('button',{name:'准备离线识别',exact:true}).click();await expect(member.getByRole('status').filter({hasText:'离线识别已准备，可在断网后识别截图'})).toBeVisible({timeout:15000})
  const before=await member.evaluate(async()=>{const cache=await caches.open('tongye-ocr-state-v1');return (await (await cache.match(location.origin+'/tesseract/offline-ready'))!.json()).manifest.revision})
  await closeSheet(member)
  // A real second production build changes bytes at an unchanged worker URL.
  // Public fixtures are copied so this regression never changes source assets.
  const variant=mkdtempSync(joinPath(tmpdir(),'tongye-ocr-public-b-'));cpSync('public',variant,{recursive:true});const workerPath=joinPath(variant,'tesseract/worker.min.js');writeFileSync(workerPath,readFileSync(workerPath,'utf8')+'\n// OCR upgrade fixture B\n')
  await build({publicDir:variant,build:{outDir:output,emptyOutDir:false},logLevel:'warn'})
  const after=JSON.parse(readFileSync(joinPath(output,'ocr-offline-manifest.json'),'utf8')).revision;expect(after).not.toBe(before)
  await member.evaluate(async()=>{const registration=await navigator.serviceWorker.getRegistration();await registration!.update()})
  await member.waitForFunction(async()=>!!(await navigator.serviceWorker.getRegistration())?.waiting,{},{timeout:15000})
  await member.evaluate(async()=>{const registration=await navigator.serviceWorker.getRegistration();await new Promise<void>(resolve=>{navigator.serviceWorker.addEventListener('controllerchange',()=>resolve(),{once:true});registration!.waiting!.postMessage({type:'SKIP_WAITING'})})})
  await member.reload();await member.getByRole('button',{name:'截图识别',exact:true}).click();await expect(member.getByRole('status').filter({hasText:'离线识别资源不完整'})).toBeVisible({timeout:15000})
  await member.getByRole('button',{name:'准备离线识别',exact:true}).click();await expect(member.getByRole('status').filter({hasText:'离线识别已准备，可在断网后识别截图'})).toBeVisible({timeout:10000})
  const ready=await member.evaluate(async()=>{const cache=await caches.open('tongye-ocr-state-v1');return (await (await cache.match(location.origin+'/tesseract/offline-ready'))!.json()).manifest.revision});expect(ready).toBe(after)
  await closeSheet(member);await memberContext.setOffline(true);await member.reload();await member.getByRole('button',{name:'截图识别',exact:true}).click();await expect(member.getByText(/离线识别已准备 ·/)).toBeVisible()
  const damagedRejected=await member.evaluate(async()=>{const state=await caches.open('tongye-ocr-state-v1'),record=await (await state.match(location.origin+'/tesseract/offline-ready'))!.json(),cache=await caches.open(record.cacheName);await cache.put(location.origin+'/tesseract/worker.min.js',new Response('corrupted worker'));try{await fetch('/tesseract/worker.min.js');return false}catch{return true}});expect(damagedRejected).toBe(true)
 }finally{await ownerContext.close();await memberContext.close()}
})
