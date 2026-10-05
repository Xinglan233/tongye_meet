import {afterEach,expect,it,vi} from 'vitest'
import {fetchMapImage} from '../../src/online/activity/media-client'
afterEach(()=>vi.unstubAllGlobals())
it('aborted map reads report an actionable Chinese error and respect caller cleanup',async()=>{const controller=new AbortController();vi.stubGlobal('fetch',vi.fn((_url,options)=>new Promise((_resolve,reject)=>{options.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')))})));const pending=fetchMapImage('event','asset',undefined,controller.signal);controller.abort();await expect(pending).rejects.toThrow('地图连接中断或等待超时，请联网后重试')})
it('HTTP map failure stays actionable while successful bytes remain available',async()=>{vi.stubGlobal('fetch',vi.fn(async()=>new Response('',{status:503})));await expect(fetchMapImage('event','asset')).rejects.toThrow('地点列表和计划仍可使用');vi.stubGlobal('fetch',vi.fn(async()=>new Response('map')));expect(await (await fetchMapImage('event','asset')).text()).toBe('map')})
