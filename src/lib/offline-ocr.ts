interface OcrResource {path:string;sizeBytes:number;sha256:string}
interface OcrManifest {format:1;revision:string;resources:OcrResource[]}
interface OcrRecord {format:1;cacheName:string;manifest:OcrManifest;preparedAt:string;sizeBytes:number}
export type OfflineOcrStatus={state:'unprepared'|'incomplete'}|{state:'ready';preparedAt:string;sizeBytes:number}
interface OcrCache {match:(url:string)=>Promise<Response|undefined>;put:(url:string,response:Response)=>Promise<void>}
export interface OcrPreparationIO {origin:string;base:string;fetch:(url:string)=>Promise<Response>;open:(name:string)=>Promise<OcrCache>;delete:(name:string)=>Promise<boolean>;currentManifest?:()=>Promise<unknown>}
const stateCache='tongye-ocr-state-v1',required=['tesseract/worker.min.js','tesseract/tesseract-core-simd-lstm.wasm.js','tesseract/chi_sim.traineddata','tesseract/eng.traineddata']
function defaultIO():OcrPreparationIO {if(!('caches' in globalThis)||!crypto.subtle)throw new Error('当前浏览器无法保存离线识别资源，请使用联网识别或手动填写');return {origin:location.origin,base:import.meta.env.BASE_URL,fetch:url=>fetch(url,{cache:'no-store',signal:AbortSignal.timeout(120000)}),open:name=>caches.open(name),delete:name=>caches.delete(name),currentManifest:async()=>{const response=await caches.match(new URL(import.meta.env.BASE_URL+'ocr-offline-manifest.json',location.origin).href,{ignoreSearch:true});if(!response)throw new Error('当前版本资源清单未保存');return response.json()}}}
function url(io:OcrPreparationIO,path:string){return new URL(io.base+path,io.origin).href}
// Preparation must reach current server bytes even when an older SW still owns
// the page. Canonical URLs are reserved for verified offline reads.
function preparationURL(io:OcrPreparationIO,path:string,version:string){const target=new URL(url(io,path));target.searchParams.set('ocr-prepare',version);return target.href}
async function hash(bytes:ArrayBuffer){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('')}
async function manifestValid(value:unknown):Promise<OcrManifest>{
 const m=value as OcrManifest
 if(m?.format!==1||!Array.isArray(m.resources)||m.resources.length<6||m.resources.length>100||!/^([a-f0-9]{64})$/.test(m.revision))throw new Error('离线识别资源清单无效，请联网后重试')
 const paths=new Set<string>();let total=0
 for(const r of m.resources){if(!r||!/^((tesseract|assets)\/[a-zA-Z0-9_.-]+)$/.test(r.path)||paths.has(r.path)||!Number.isSafeInteger(r.sizeBytes)||r.sizeBytes<=0||!/^([a-f0-9]{64})$/.test(r.sha256))throw new Error('离线识别资源清单不完整');paths.add(r.path);total+=r.sizeBytes}
 if(total>64*1024*1024||required.some(path=>!paths.has(path))||!m.resources.some(r=>/^assets\/ocr-engine-.*\.js$/.test(r.path))||!m.resources.some(r=>/^assets\/ocr-recognition-.*\.js$/.test(r.path))||await hash(new TextEncoder().encode(JSON.stringify(m.resources)).buffer)!==m.revision)throw new Error('离线识别资源清单不完整或校验失败')
 return m
}
async function verified(response:Response|undefined,resource:OcrResource){if(!response?.ok||response.type==='opaque')throw new Error('离线识别资源下载失败，请联网后重试');const bytes=await response.clone().arrayBuffer();if(bytes.byteLength!==resource.sizeBytes||await hash(bytes)!==resource.sha256)throw new Error('离线识别资源校验失败，请重新准备')}
export async function loadOfflineOcrStatus(options:{io?:OcrPreparationIO}={}):Promise<OfflineOcrStatus>{
 try{const io=options.io||defaultIO(),state=await io.open(stateCache),response=await state.match(url(io,'tesseract/offline-ready'));if(!response)return {state:'unprepared'}
  const record=await response.json() as OcrRecord,manifest=await manifestValid(record.manifest)
  if(io.currentManifest&&(await manifestValid(await io.currentManifest())).revision!==manifest.revision)return {state:'incomplete'}
  if(record.format!==1||!/^tongye-ocr-resources-[a-f0-9]{64}-[a-zA-Z0-9-]+$/.test(record.cacheName)||!record.preparedAt||record.sizeBytes!==manifest.resources.reduce((n,r)=>n+r.sizeBytes,0))return {state:'incomplete'}
  const cache=await io.open(record.cacheName);for(const resource of manifest.resources)await verified(await cache.match(url(io,resource.path)),resource)
  return {state:'ready',preparedAt:record.preparedAt,sizeBytes:record.sizeBytes}
 }catch{return {state:'incomplete'}}
}
let preparing:Promise<OfflineOcrStatus>|undefined
export function prepareOfflineOcr(options:{io?:OcrPreparationIO;onProgress?:(message:string)=>void}={}):Promise<OfflineOcrStatus>{
 if(!options.io&&preparing)return preparing
 const task=(async()=>{const io=options.io||defaultIO(),response=await io.fetch(preparationURL(io,'ocr-offline-manifest.json',crypto.randomUUID()));if(!response.ok)throw new Error('离线识别资源暂不可用，请联网后重试');const manifest=await manifestValid(await response.json()),cacheName=`tongye-ocr-resources-${manifest.revision}-${crypto.randomUUID()}`,cache=await io.open(cacheName),state=await io.open(stateCache),stateURL=url(io,'tesseract/offline-ready');let old:OcrRecord|undefined
  try{old=await (await state.match(stateURL))?.json()}catch{/* A damaged prior marker can be replaced by a complete preparation. */}
  try{for(let i=0;i<manifest.resources.length;i++){const resource=manifest.resources[i];options.onProgress?.(`正在准备离线识别 ${i+1}/${manifest.resources.length}`);const file=await io.fetch(preparationURL(io,resource.path,resource.sha256));await verified(file,resource);await cache.put(url(io,resource.path),file)}
   // Read every stored response before the single ready-marker commit. Quota or
   // interrupted downloads cannot replace the previous complete active cache.
   for(const resource of manifest.resources)await verified(await cache.match(url(io,resource.path)),resource)
   const record:OcrRecord={format:1,cacheName,manifest,preparedAt:new Date().toISOString(),sizeBytes:manifest.resources.reduce((n,r)=>n+r.sizeBytes,0)};await state.put(stateURL,new Response(JSON.stringify(record),{headers:{'Content-Type':'application/json'}}));if(old?.cacheName?.startsWith('tongye-ocr-resources-')&&old.cacheName!==cacheName)await io.delete(old.cacheName).catch(()=>false)
   return {state:'ready',preparedAt:record.preparedAt,sizeBytes:record.sizeBytes} as OfflineOcrStatus
  }catch(error){await io.delete(cacheName).catch(()=>false);throw error instanceof Error?error:new Error('离线识别准备失败，请联网后重试')}
 })();if(!options.io){preparing=task;void task.finally(()=>{preparing=undefined}).catch(()=>{})}return task
}
