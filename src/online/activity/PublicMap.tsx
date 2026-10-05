import {useEffect,useRef,useState} from 'react'
import type {ActivityDTO} from '../../../shared/activity-contract'
import type {PathResult} from '../../../shared/routing'
import {mapImageIdentity} from './map-asset-identity'
import {MapCanvas} from './MapCanvas'
import {startPublicMap} from './public-map-loading'
export function PublicMap({activity,mapId,selectedPoiId,favoriteIds,onSelectPoi,route,visiblePoiIds}:{activity:ActivityDTO;mapId:string;selectedPoiId?:string;favoriteIds:string[];onSelectPoi:(id:string)=>void;route?:PathResult;visiblePoiIds?:string[]}){
 const [url,setUrl]=useState(''),[urlIdentity,setUrlIdentity]=useState(''),[error,setError]=useState('')
 const loading=useRef<ReturnType<typeof startPublicMap>>()
 const convention=activity.eventPackage.event.extensions?.convention,map=convention?.maps.find(m=>m.id===mapId),imageIdentity=mapImageIdentity(activity.eventPackage,map),identity=JSON.stringify([activity.id,activity.revision,activity.scheduleRevision,activity.spatialRevision,activity.status,activity.visibility,activity.eventPackage,imageIdentity])
 useEffect(()=>{setUrl('');setError('');if(!map)return;const controller=startPublicMap(activity,mapId,{show:value=>{setUrl(value);setUrlIdentity(identity)},notice:setError});loading.current=controller;return()=>{controller.stop();loading.current=undefined}},[identity])
 if(!convention||!map)return <p className="notice">地图资料未提供</p>
 const retry=error&&error!=='正在查看已下载地图'?<button className="btn btn-surface" onClick={()=>loading.current?.retry()}>重试地图</button>:null
 if(!url||urlIdentity!==identity)return <><p className="notice" role="status">{error||'正在载入地图'}</p>{retry}</>
 return <>{error&&<p className="page-sub" role="status">{error}</p>}{retry}<MapCanvas convention={convention} mapId={mapId} assetUrl={url} selectedPoiId={selectedPoiId} favoriteIds={favoriteIds} onSelectPoi={onSelectPoi} route={route} visiblePoiIds={visiblePoiIds}/></>
}
