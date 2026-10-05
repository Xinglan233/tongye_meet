import type {EventData} from '../../../shared/types'

/** Keep an explicit valid day; first entry uses the event's local calendar day. */
export function activityDate(event:Pick<EventData,'timezone'|'startDate'|'days'>,selected?:string|null,now=new Date()):string {
 const valid=(day:string|undefined|null)=>!!day&&event.days.some(d=>d.date===day)
 if(valid(selected))return selected!
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:event.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now)
 const value=(type:string)=>parts.find(p=>p.type===type)?.value
 const today=`${value('year')}-${value('month')}-${value('day')}`
 return valid(today)?today:event.startDate
}
