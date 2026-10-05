import type {ActivityDTO,PersonalPlan} from '../../../shared/activity-contract'
import {toMinute} from '../../../shared/time'
export type ReferenceSyncState='saved'|'local'|'pending'|'needs_review'
export const referenceSyncLabels={saved:'已保存到云端',local:'未保存到云端',pending:'待联网保存',needs_review:'需要复核'} as const
export function referenceSyncState(activity:ActivityDTO,sync:ReferenceSync):ReferenceSyncState{return sync.scheduleRevision!==activity.scheduleRevision?'needs_review':sync.dirty?(sync.offline?'pending':'local'):'saved'}
export interface ReferenceSync {dirty:boolean;offline:boolean;scheduleRevision:number;spatialRevision:number}
export function activityReference(activity:ActivityDTO){const event=activity.eventPackage.event;return {id:activity.id,title:event.title,dates:event.days.map(d=>d.date),type:event.eventType||'generic',location:event.location,example:activity.eventPackage.meta?.isExample===true,status:activity.status,hasMap:!!event.extensions?.convention.maps.length}}
export function planReference(activity:ActivityDTO,plan:PersonalPlan,date:string,sync:ReferenceSync){
 const state=referenceSyncState(activity,sync)
 const day=plan.response.busy.filter(b=>b.date===date).slice().sort((a,b)=>a.start.localeCompare(b.start)||a.id.localeCompare(b.id))
 const items=day.map(item=>{let durationMinutes:number|null=null;let conflict=false;try{const start=toMinute(item.start),end=toMinute(item.end,true);durationMinutes=end>start?end-start:null;conflict=day.some(other=>{if(other.id===item.id)return false;try{return start<toMinute(other.end,true)&&toMinute(other.start)<end}catch{return false}})}catch{/* Incomplete drafts stay visible and editable; never round or treat them as confirmed. */}return {...item,durationMinutes,conflict,state}})
 return {items,favoriteCount:plan.favorites.length,routeCount:plan.routes.find(r=>r.date===date)?.stops.length||0,routeNeedsReview:plan.routes.some(r=>r.date===date&&r.spatialRevision!==activity.spatialRevision)}
}
export function invitationTarget(raw:string,origin:string):string{
 let url:URL;try{url=new URL(raw.trim())}catch{throw new Error('请粘贴收到的完整邀请链接')}
 const match=url.pathname.match(/^\/groups\/([a-z0-9_-]+)$/i),hash=new URLSearchParams(url.hash.slice(1)),token=hash.get('invite')
 const date=url.searchParams.get('date'),day=date&&/^\d{4}-\d{2}-\d{2}$/.test(date)?new Date(date+'T00:00:00Z'):undefined
 const validQuery=!url.search||(url.searchParams.size===1&&day&&!Number.isNaN(day.getTime())&&day.toISOString().slice(0,10)===date)
 if(url.origin!==origin||url.username||url.password||!validQuery||!match||hash.size!==1||!token||!/^[a-f0-9]{64}$/.test(token))throw new Error('此处需要当前站点的小队邀请链接，管理或个人恢复链接不能用于加入')
 return `/groups/${match[1]}${date?'?date='+date:''}#invite=${token}`
}
