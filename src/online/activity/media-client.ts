import { uploadPresigned } from '@vercel/blob/client'
import { api,ApiFailure } from '../api'
import { ACTIVITY_LIMITS,type MediaAssetDTO } from '../../../shared/activity-contract'
const key='tongye.media.pending.v1'
const pendingPrefix=key+':'
interface Pending {eventId:string;assetId?:string;assetKey:string;uploadToken:string;operationId:string;sizeBytes:number;mimeType:string;fileSha256?:string;createdAt?:number}
function pendingKey(pending:Pending){return pendingPrefix+pending.operationId}
function storePending(pending:Pending){localStorage.setItem(pendingKey(pending),JSON.stringify(pending))}
function pendingUploads():Pending[]{
 const legacy=localStorage.getItem(key);if(legacy){try{const value=JSON.parse(legacy) as Pending;if(value.operationId&&value.eventId&&value.uploadToken){if(!localStorage.getItem(pendingKey(value)))storePending(value);localStorage.removeItem(key)}}catch{/* Keep an unreadable legacy recovery record intact. */}}
 const found:Pending[]=[];for(let i=0;i<localStorage.length;i++){const name=localStorage.key(i);if(!name?.startsWith(pendingPrefix))continue;try{const pending=JSON.parse(localStorage.getItem(name)||'null') as Pending;if(pending?.eventId&&pending.operationId&&pending.uploadToken)found.push(pending)}catch{/* An unrelated malformed record must not erase another upload. */}}
 return found.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0))
}
function clearPending(pending:Pending){const value=localStorage.getItem(pendingKey(pending));if(value){try{const current=JSON.parse(value) as Pending;if(current.eventId===pending.eventId&&current.uploadToken===pending.uploadToken)localStorage.removeItem(pendingKey(pending))}catch{/* Retain unknown recovery data. */}}}
const token=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('')
export const mediaReadURL=(eventId:string,assetId:string)=>`/api/media/read?eventId=${encodeURIComponent(eventId)}&assetId=${encodeURIComponent(assetId)}`
export const listAssets=(eventId:string,adminToken?:string,signal?:AbortSignal)=>api<MediaAssetDTO[]>(`${adminToken?'/admin':''}/events/${encodeURIComponent(eventId)}/assets`,adminToken,undefined,'GET',signal)
export async function fetchMapImage(eventId:string,assetId:string,adminToken?:string,signal?:AbortSignal):Promise<Blob>{
 const controller=new AbortController(),abort=()=>controller.abort();if(signal?.aborted)controller.abort();else signal?.addEventListener('abort',abort,{once:true});const timeout=setTimeout(abort,30000)
 try{const response=await fetch(mediaReadURL(eventId,assetId),{headers:adminToken?{Authorization:'Bearer '+adminToken}:{},cache:'no-store',signal:controller.signal});if(!response.ok)throw new ApiFailure('MEDIA_UNAVAILABLE','地图读取失败，请重试；地点列表和计划仍可使用',response.status);return await response.blob()}
 catch(error){if(error instanceof ApiFailure)throw error;throw new ApiFailure('MEDIA_UNAVAILABLE','地图连接中断或等待超时，请联网后重试；地点列表和计划仍可使用',0)}
 finally{clearTimeout(timeout);signal?.removeEventListener('abort',abort)}
}
export async function finishMapUpload(pending:Pending):Promise<MediaAssetDTO>{const res=await fetch('/api/media/finish',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({eventId:pending.eventId,assetId:pending.assetId,uploadToken:pending.uploadToken}),signal:AbortSignal.timeout(60000)}),result=await res.json();if(!res.ok)throw new ApiFailure(result.error?.code||'MEDIA_UNAVAILABLE',result.error?.message||'地图处理失败，请保留原文件重试',res.status);clearPending(pending);return result.data}
export function pendingMapUploads(eventId?:string):Pending[]{return pendingUploads().filter(pending=>!eventId||pending.eventId===eventId)}
export function pendingMapUpload(eventId?:string):Pending|undefined{return pendingMapUploads(eventId)[0]}
async function transferMap(pending:Pending,adminToken:string,file:File):Promise<MediaAssetDTO>{
 const ticket=await api<{asset:MediaAssetDTO;pathname:string;expiresAt:number}>(`/admin/events/${encodeURIComponent(pending.eventId)}/assets`,adminToken,{operationId:pending.operationId,uploadToken:pending.uploadToken,assetKey:pending.assetKey,sizeBytes:pending.sizeBytes,mimeType:pending.mimeType})
 pending.assetId=ticket.asset.id;storePending(pending)
 if(ticket.asset.state==='failed'||ticket.asset.state==='revoked')throw new ApiFailure('INVALID_MEDIA','此次地图上传失败，请重新选择地图',409)
 if(ticket.asset.state==='pending'){
  try{await uploadPresigned(ticket.pathname,file,{access:'private',contentType:file.type,handleUploadUrl:'/api/media/upload',abortSignal:AbortSignal.timeout(120000),clientPayload:JSON.stringify({eventId:pending.eventId,assetId:pending.assetId,uploadToken:pending.uploadToken})})}catch{
   // An upload response may be lost after the private object exists; finish verifies actual bytes.
   return finishMapUpload(pending)
  }
 }
 return finishMapUpload(pending)
}
export async function uploadMap(eventId:string,adminToken:string,file:File,assetKey?:string):Promise<MediaAssetDTO>{
 if(file.size<1||file.size>ACTIVITY_LIMITS.sourceBytes)throw new ApiFailure('LIMIT_EXCEEDED','每张地图源图上限12 MiB',413)
 if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw new ApiFailure('INVALID_MEDIA','请选择PNG/JPEG/WebP地图',400)
 const fileSha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer())),b=>b.toString(16).padStart(2,'0')).join(''),prior=pendingUploads().find(p=>p.eventId===eventId&&p.fileSha256===fileSha256&&(!assetKey||assetKey===p.assetKey))
 const pending:Pending=prior&&prior.eventId===eventId&&prior.fileSha256===fileSha256&&(prior.createdAt||0)>Date.now()-15*60*1000&&(!assetKey||assetKey===prior.assetKey)?prior:{eventId,assetKey:assetKey||'map-'+crypto.randomUUID()+'.'+({ 'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[file.type]),uploadToken:token(),operationId:crypto.randomUUID(),sizeBytes:file.size,mimeType:file.type,fileSha256,createdAt:Date.now()}
 // Persist recovery material before requesting server state; lost responses replay this operation.
 storePending(pending)
 try{return await transferMap(pending,adminToken,file)}catch(e){if(e instanceof ApiFailure&&e.code==='INVALID_MEDIA')clearPending(pending);throw e}
}
export interface MediaUsage {budgetBytes:number;chargedBytes:number;remainingBytes:number;basis:string}
export const mediaUsage=(eventId:string,adminToken:string)=>api<MediaUsage>(`/admin/events/${encodeURIComponent(eventId)}/assets/usage`,adminToken)
export async function cleanupMapUploads(eventId:string,adminToken:string,confirmDelete:boolean):Promise<{results:{assetId:string;cleaned:boolean;deletedObjects?:number}[];usage:MediaUsage}>{if(!confirmDelete)throw new ApiFailure('INVALID_REQUEST','清理失败和过期上传不可恢复，请先确认',400);const response=await fetch('/api/media/cleanup',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+adminToken},body:JSON.stringify({eventId,confirmDelete:true}),signal:AbortSignal.timeout(60000)}),payload=await response.json();if(!response.ok)throw new ApiFailure(payload.error?.code||'MEDIA_UNAVAILABLE',payload.error?.message||'清理失败，请重试',response.status);return payload.data}
