import {readFileSync} from 'node:fs'
import {renderToStaticMarkup} from 'react-dom/server'
import {createElement} from 'react'
import {describe,it,expect} from 'vitest'
import type {ActivityDTO,PersonalPlan} from '../../shared/activity-contract'
import type {EventPackage} from '../../shared/types'
import {activityDate} from '../../src/online/activity/date-context'
import {FigmaPoiDetails} from '../../src/online/activity/FigmaPoiDetails'
import {FigmaCompanionsEntry} from '../../src/online/activity/FigmaCompanionsEntry'
const eventPackage=JSON.parse(readFileSync('examples/convention-demo.v2.json','utf8')) as EventPackage
const activity:ActivityDTO={id:'demo',revision:1,scheduleRevision:1,spatialRevision:1,status:'published',visibility:'public',eventPackage,updatedAt:'2026-10-03T00:00:00Z'}
const plan:PersonalPlan={response:{name:'我',presence:[],busy:[],bufferMinutes:0},favorites:[],routes:[]}
describe('field activity date context',()=>{
 it('defaults to today in the activity timezone, preserves explicit dates and falls back outside valid days',()=>{
  const event={...eventPackage.event,timezone:'Asia/Shanghai',startDate:'2026-10-03',endDate:'2026-10-04',days:[{date:'2026-10-03',openIntervals:[]},{date:'2026-10-04',openIntervals:[]}]}
  const boundary=new Date('2026-10-03T16:01:00Z')
  expect(activityDate(event,undefined,boundary)).toBe('2026-10-04')
  expect(activityDate(event,'2026-10-03',boundary)).toBe('2026-10-03')
  expect(activityDate({...event,timezone:'America/Los_Angeles'},undefined,boundary)).toBe('2026-10-03')
  expect(activityDate(event,'bad',new Date('2026-10-10T00:00:00Z'))).toBe('2026-10-03')
 })
 it('place details only offer selected-day sessions; favorite remains separate from the plan',()=>{
  const e=structuredClone(activity),poi=e.eventPackage.event.extensions!.convention.pois[3]
  e.eventPackage.event.activities[0].sessions[1].poiId=poi.id
  e.eventPackage.event.activities[0].sessions.push({id:'other-day',date:'2026-10-04',start:'14:00',end:'14:30',poiId:poi.id})
  const html=renderToStaticMarkup(createElement(FigmaPoiDetails,{activity:e,poi,plan:{...plan,favorites:[{poiId:poi.id,visited:false}]},date:'2026-10-03',onFavorite:()=>{},onSchedule:()=>{},onRoute:()=>{},onMap:()=>{},onSession:()=>{}}))
  expect(html).toContain('13:07–13:52')
  expect(html).not.toContain('14:00–14:30')
  expect(html).toContain('加入计划')
  expect(html).toContain('取消收藏')
  expect(html).toContain('aria-label="加入计划" aria-pressed="false"') // A favorite alone does not mark the calendar action as joined.
 })
 it('public team creation needs a title, preserves pending lock, and offers no code gate',()=>{
  const html=renderToStaticMarkup(createElement(FigmaCompanionsEntry,{groups:[],onCreate:()=>{},onOpen:()=>{},creation:{code:'',title:'周六小队',pending:false,error:'',onCode:()=>{},onTitle:()=>{},onSubmit:()=>{}}}))
  expect(html).not.toContain('建队码')
  expect(html).not.toContain('管理员')
  expect(html).toContain('<button>创建</button>')
  const locked=renderToStaticMarkup(createElement(FigmaCompanionsEntry,{groups:[],onCreate:()=>{},onOpen:()=>{},creation:{title:'周六小队',pending:true,error:'',onTitle:()=>{},onSubmit:()=>{}}}))
  expect(locked).toContain('<button disabled="">创建中</button>')
 })
})

 it('source label links to the factual source and preserves the complete wrapping note',()=>{
  const poi={...eventPackage.event.extensions!.convention.pois[0],sourceNote:'公布资料 https://example.com/very-long-source；点位未经现场核实。'}
  const html=renderToStaticMarkup(createElement(FigmaPoiDetails,{activity,poi,plan,date:'2026-10-03',onFavorite:()=>{},onSchedule:()=>{},onRoute:()=>{},onMap:()=>{},onSession:()=>{}}))
  expect(html).toContain('href="https://example.com/very-long-source"')
  expect(html).toContain(poi.sourceNote)
 })
