import type { createWorker } from 'tesseract.js'
import {loadOfflineOcrStatus} from './offline-ocr'
import type { DayKey, RawBooking, RecognitionGroup } from '../types'
import { matchSession } from './catalog'

const VALID_DAYS: DayKey[] = ['10-02', '10-03', '10-04', '10-05', '10-06']

const TIME_RANGE =
  /(\d{1,2})\s*[:：;]\s*(\d{2})\s*[-–—~～ー=]+\s*(\d{1,2})\s*[:：;]\s*(\d{2})/

const DATE_RE = /(\d{1,2})\s*月\s*(\d{1,2})\s*日/g

const BOOTH_RE = /([A-Za-zＡ-Ｚ])\s*[-–—一~]\s*(\d{1,2})/

const STATUS_WORDS = /已预约|取消预约|心愿单|我的预约|活动规则|去绑定|绑定门票|当日已预约|加入心愿单|我知道了|查看预约|^GO$/

function dayFrom(month: number, day: number): DayKey | null {
  const key = `10-${String(day).padStart(2, '0')}` as DayKey
  return month === 10 && VALID_DAYS.includes(key) ? key : null
}

function normTime(h: string, m: string): string {
  return `${String(Number(h)).padStart(2, '0')}:${m}`
}

function parseBooth(line: string): { booth: string; ip: string } | null {
  const bm = line.match(BOOTH_RE)
  if (!bm) return null
  const booth = `${bm[1].toUpperCase()}-${String(bm[2]).padStart(2, '0')}`
  const after = line.slice((bm.index ?? 0) + bm[0].length)
  const ip = after.replace(/^[·•・.．,，:：|｜\s]+/, '').trim()
  return { booth, ip }
}

function enrich(b: RawBooking): RawBooking {
  if (!b.day) return b
  const hit = matchSession(b.day, b.booth, b.start)
  if (hit) {
    return {
      ...b,
      start: hit.session.start,
      end: hit.session.end,
      booth: hit.activity.booth,
      ip: hit.activity.ip,
      title: hit.activity.title,
      confidence: 1
    }
  }
  return b
}

export function parseText(text: string): { bookings: RawBooking[]; multiDay: boolean } {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

  const dates: DayKey[] = []
  DATE_RE.lastIndex = 0
  let dm: RegExpExecArray | null
  while ((dm = DATE_RE.exec(text))) {
    const dk = dayFrom(Number(dm[1]), Number(dm[2]))
    if (dk && !dates.includes(dk)) dates.push(dk)
  }

  const isPopup = /预约成功/.test(text) || /场次/.test(text)
  const raws: RawBooking[] = []

  if (isPopup) {
    for (let i = 0; i < lines.length; i++) {
      const tm = lines[i].match(TIME_RANGE)
      if (!tm) continue
      const inlineDate = lines[i].match(DATE_RE)
      let day: DayKey | null = null
      if (inlineDate) day = dayFrom(Number(inlineDate[1]), Number(inlineDate[2]))
      if (!day && dates.length) day = dates[0]

      let booth: string | undefined
      let ip: string | undefined
      for (let j = i; j < Math.min(lines.length, i + 3); j++) {
        const parsed = parseBooth(lines[j])
        if (parsed) {
          booth = parsed.booth
          ip = parsed.ip
          break
        }
      }

      let title = ''
      for (let j = i - 1; j >= Math.max(0, i - 4); j--) {
        const l = lines[j]
        if (l.length <= 12 && !TIME_RANGE.test(l) && !/恭喜|预约成功|地点|场次|RED ?LAND/.test(l)) {
          title = l
          break
        }
      }

      raws.push({
        day,
        start: normTime(tm[1], tm[2]),
        end: normTime(tm[3], tm[4]),
        booth,
        ip,
        title: title || '展台活动',
        confidence: booth ? 0.9 : 0.5
      })
      break
    }
  } else {
    for (let i = 0; i < lines.length; i++) {
      const tm = lines[i].match(TIME_RANGE)
      if (!tm) continue

      let booth: string | undefined
      let ip: string | undefined
      const here = parseBooth(lines[i])
      if (here) {
        booth = here.booth
        ip = here.ip
      } else {
        for (let j = i + 1; j < Math.min(lines.length, i + 3); j++) {
          const p = parseBooth(lines[j])
          if (p) {
            booth = p.booth
            ip = p.ip
            break
          }
        }
      }

      let title = ''
      for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
        const l = lines[j]
        if (!STATUS_WORDS.test(l) && !TIME_RANGE.test(l) && !parseBooth(l)) {
          title = l
          break
        }
      }

      raws.push({
        day: dates.length === 1 ? dates[0] : null,
        start: normTime(tm[1], tm[2]),
        end: normTime(tm[3], tm[4]),
        booth,
        ip,
        title: title || '未命名活动',
        confidence: booth ? 0.85 : 0.45
      })
    }
  }

  const enriched = raws.map(enrich)
  return { bookings: enriched, multiDay: dates.length > 1 }
}

type OcrWorker = Awaited<ReturnType<typeof createWorker>>
let workerPromise: Promise<OcrWorker> | null = null

async function getWorker(
  onProgress?: (progress: number, status: string) => void
): Promise<OcrWorker> {
  if (!workerPromise) {
    const base = import.meta.env.BASE_URL
    workerPromise = (async()=>{
      if(!navigator.onLine&&(await loadOfflineOcrStatus()).state!=='ready')throw new Error('离线识别尚未准备或资源不完整，请联网后准备；也可手动填写')
      const {createWorker}=await import('tesseract.js')
      return createWorker(['chi_sim', 'eng'], 1, {
      workerPath: `${base}tesseract/worker.min.js`,
      corePath: `${base}tesseract/tesseract-core-simd-lstm.wasm.js`,
      langPath: `${base}tesseract`,
      gzip: false,
      cacheMethod: 'none',
      logger: (m: { status: string; progress: number }) => {
        if (onProgress) onProgress(m.progress, m.status)
      }
    })
    })().catch(error=>{workerPromise=null;throw error})
  }
  return workerPromise
}

export async function recognizeFiles(
  files: File[],
  onProgress?: (progress: number, status: string) => void
): Promise<RecognitionGroup[]> {
  const worker = await getWorker(onProgress)
  const groups: RecognitionGroup[] = []
  for (const file of files) {
    const { data } = await worker.recognize(file)
    const parsed = parseText(data.text)
    groups.push({ fileName: file.name, bookings: parsed.bookings, multiDay: parsed.multiDay })
  }
  return groups
}

export async function terminateWorker(): Promise<void> {
  const current = workerPromise
  if (current) {
    workerPromise = null
    const w = await current
    await w.terminate()
  }
}
