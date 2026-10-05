import type {ActivityDTO,MediaAssetDTO} from '../../../shared/activity-contract'
import {loadPreparedActivity,type PreparedActivity} from './offline'
import {matchingMapAsset} from './map-asset-identity'
import {fetchMapImage,listAssets} from './media-client'
export interface PublicMapIO {
 prepared:(id:string,scope:string,current:ActivityDTO)=>Promise<PreparedActivity|undefined>
 list:(id:string,signal:AbortSignal)=>Promise<MediaAssetDTO[]>
 fetch:(id:string,assetId:string,signal:AbortSignal)=>Promise<Blob>
 createURL:(blob:Blob)=>string;revokeURL:(url:string)=>void
}
const defaultIO:PublicMapIO={prepared:loadPreparedActivity,list:(id,signal)=>listAssets(id,undefined,signal),fetch:(id,assetId,signal)=>fetchMapImage(id,assetId,undefined,signal),createURL:blob=>URL.createObjectURL(blob),revokeURL:url=>URL.revokeObjectURL(url)}
// Cached bytes are validated by loadPreparedActivity against the entire current
// snapshot before this controller exposes an image beside its coordinate data.
export function startPublicMap(activity:ActivityDTO,mapId:string,callbacks:{show:(url:string)=>void;notice:(message:string)=>void},io:PublicMapIO=defaultIO):{stop:()=>void;retry:()=>void} {
 let controller=new AbortController(),request=0
 const map=activity.eventPackage.event.extensions?.convention.maps.find(m=>m.id===mapId)
 let active=true,fresh=false,shown=false,cachedRelease:(()=>void)|undefined,networkURL='',networkError='',cacheDone=false
 const reportFailure=()=>{if(active&&cacheDone&&networkError)callbacks.notice(shown?(fresh?'当前地图仍可查看，联网刷新未成功，可重试':'正在查看已下载地图，联网刷新未成功，可重试'):networkError)}
 if(map&&activity.visibility!=='private'){
  void io.prepared(activity.id,'public',activity).then(prepared=>{
   if(!prepared)return
   if(!active||fresh||prepared.status!=='ready'||prepared.activity.id!==activity.id||(prepared.activity.visibility||'public')!==(activity.visibility||'public')||!prepared.blobURLs[mapId]){prepared.release();return}
   cachedRelease=prepared.release;shown=true;callbacks.show(prepared.blobURLs[mapId]);callbacks.notice('正在查看已下载地图')
  }).catch(()=>{/* Invalid/incomplete cache never replaces current map data. */}).finally(()=>{cacheDone=true;reportFailure()})
 }else cacheDone=true
 const retry=()=>{if(!active||!map)return;controller.abort();controller=new AbortController();const currentRequest=++request;networkError='';callbacks.notice(shown?(fresh?'当前地图仍可查看，正在联网刷新':'正在查看已下载地图，正在联网刷新'):'');void(async()=>{try{
   const assets=await io.list(activity.id,controller.signal);if(!active||currentRequest!==request)return
   const asset=matchingMapAsset(activity.eventPackage,map,assets);if(!asset)throw new Error('地图版本与活动资料不一致，请刷新活动；地点列表仍可使用')
   const blob=await io.fetch(activity.id,asset.id,controller.signal);if(!active||currentRequest!==request)return
   const url=io.createURL(blob);if(!active){io.revokeURL(url);return}
   const previous=networkURL;networkURL=url;fresh=true;shown=true;callbacks.show(url);callbacks.notice('');if(previous)io.revokeURL(previous);cachedRelease?.();cachedRelease=undefined
  }catch(error){if(active&&currentRequest===request){networkError=error instanceof Error?error.message:'地图读取失败，请联网后重试';reportFailure()}}})()}
 retry()
 return {retry,stop:()=>{active=false;controller.abort();if(networkURL)io.revokeURL(networkURL);cachedRelease?.();cachedRelease=undefined}}
}
