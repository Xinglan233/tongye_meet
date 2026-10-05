import {useEffect,useState} from 'react'
import {loadOfflineOcrStatus,prepareOfflineOcr,type OfflineOcrStatus} from './lib/offline-ocr'
export function OfflineOcrPreparation(){
 const [status,setStatus]=useState<OfflineOcrStatus>({state:'unprepared'}),[busy,setBusy]=useState(false),[message,setMessage]=useState('')
 useEffect(()=>{let active=true;void loadOfflineOcrStatus().then(value=>{if(active)setStatus(value)});return()=>{active=false}},[])
 async function prepare(){setBusy(true);setMessage('');try{setStatus(await prepareOfflineOcr({onProgress:setMessage}));setMessage('离线识别已准备，可在断网后识别截图')}catch(error){setMessage(error instanceof Error?error.message:'准备失败，请联网后重试');setStatus(await loadOfflineOcrStatus())}finally{setBusy(false)}}
 return <><p className="page-sub">{status.state==='ready'?`离线识别已准备 · ${(status.sizeBytes/1024/1024).toFixed(1)} MiB`:'离线识别需单独准备中文、英文和识别引擎；地图下载不包含这些资源。'}</p><button className="btn btn-surface btn-block" disabled={busy} onClick={()=>void prepare()}>{busy?'正在准备离线识别':status.state==='ready'?'重新准备离线识别':'准备离线识别'}</button>{(message||status.state==='incomplete')&&<p className="notice" role="status">{message||'离线识别资源不完整，请联网后重新准备；仍可手动填写。'}</p>}</>
}
