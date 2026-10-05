import { beforeAll, afterAll, afterEach, it, expect } from 'vitest'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'
import { build } from 'esbuild'
import { readFileSync, readdirSync } from 'node:fs'
import { randomBytes, randomUUID, createHash } from 'node:crypto'
let mf: Miniflare, db: D1Database
const token = () => randomBytes(32).toString('hex')
const pkg = JSON.parse(readFileSync('examples/event-minimal.json', 'utf8'))
const demo = JSON.parse(readFileSync('examples/event-demo.json', 'utf8'))
async function api(path: string, method = 'GET', auth = '', body?: unknown) {
  const res = await mf.dispatchFetch('http://localhost/api/v1' + path, { method, headers: { ...(auth ? { Authorization: 'Bearer ' + auth } : {}), 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
  return { status: res.status, ...await res.json() as any }
}
const createBody = (eventPackage = pkg) => ({ eventPackage, creationCode: 'test-create', managerToken: token(), inviteToken: token(), operationId: randomUUID() })
const scalar = async (sql: string, ...args: any[]) => (await db.prepare(sql).bind(...args).first<any>())!.n
const largePackage = (count: number) => {
  const pack = structuredClone(demo)
  pack.event.activities = Array.from({ length: count }, (_, i) => ({ ...structuredClone(demo.event.activities[0]), id: 'large-' + i, description: 'X'.repeat(5000), sessions: demo.event.activities[0].sessions.map((session: any, j: number) => ({ ...session, id: 'large-session-' + i + '-' + j })) }))
  return pack
}
beforeAll(async () => {
  const built = await build({ entryPoints: ['worker/src/index.ts'], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' })
  mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: built.outputFiles[0].text, compatibilityDate: '2026-09-01', d1Databases: ['DB'], bindings: { CREATION_MODE: 'invite', CREATION_CODE: 'test-create', ALLOWED_ORIGINS: 'http://localhost:5173', BUILD_VERSION: 'group-release' } }))
  db = await mf.getD1Database('DB')
  for (const m of readdirSync('worker/migrations').filter(x => x.endsWith('.sql')).sort()) await db.exec(readFileSync('worker/migrations/' + m, 'utf8').replace(/\n/g, ' '))
}, 30000)
afterEach(async () => { await db.prepare('UPDATE group_storage_budget SET max_bytes=67108864').run(); await db.prepare('UPDATE rate_limits SET count=0').run(); await db.prepare("DELETE FROM operations WHERE scope LIKE 'expiry-fixture-%'").run() })
afterAll(async () => { await mf?.dispose() })

it('small and large group deletion releases bytes and retains retry receipts while migrated usage remains above the cap', async () => {
  const bodies = [createBody(), createBody(largePackage(10)), createBody(largePackage(20))], groups = []
  for (const body of bodies) { const result = await api('/groups', 'POST', '', body); expect(result.status).toBe(200); groups.push(result.data) }
  // Model already-accounted migrated data above its configured allowance.
  await db.prepare('UPDATE group_storage_budget SET max_bytes=1').run()
  try {
    for (let i = 0; i < 2; i++) {
      const before = await scalar('SELECT used_bytes AS n FROM group_storage_budget')
      const cost = await scalar('SELECT length(CAST(event_json AS BLOB))+2048 AS n FROM groups WHERE id=?', groups[i].id)
      const body = { confirm: groups[i].id, expectedRevision: 0, operationId: randomUUID() }
      expect((await api(`/groups/${groups[i].id}`, 'DELETE', bodies[i].managerToken, body)).status).toBe(200)
      expect(await scalar('SELECT used_bytes AS n FROM group_storage_budget')).toBe(before - cost + 1024)
      expect(await scalar('SELECT used_bytes AS n FROM group_storage_budget')).toBeGreaterThan(1)
      expect((await api(`/groups/${groups[i].id}`, 'DELETE', bodies[i].managerToken, body)).status).toBe(200)
      expect((await api('/groups', 'POST', '', createBody())).status).toBe(507)
    }
    await expect(db.prepare('INSERT INTO group_tombstones VALUES(?,?,?,?,?)').bind('orphan-receipt', 'unrelated-manager', randomUUID(), 'digest', new Date().toISOString()).run()).rejects.toThrow('GROUP_STORAGE_BUDGET')
    expect((await api(`/groups/${groups[2].id}`, 'GET', bodies[2].managerToken)).status).toBe(200)
  } finally { await db.prepare('UPDATE group_storage_budget SET max_bytes=67108864').run() }
})

it('CAS conflicts and deletion-trigger failures leave group, members, receipt and ledger atomic', async () => {
  const owner = createBody(), group = await api('/groups', 'POST', '', owner); expect(group.status).toBe(200)
  const memberToken = token(), member = await api(`/groups/${group.data.id}/join`, 'POST', owner.inviteToken, { name: '保留成员', memberToken, operationId: randomUUID() }); expect(member.status).toBe(200)
  const before = await scalar('SELECT used_bytes AS n FROM group_storage_budget'), removal = { confirm: group.data.id, expectedRevision: 0, operationId: randomUUID() }
  await db.prepare('UPDATE group_storage_budget SET max_bytes=1').run()
  expect((await api(`/groups/${group.data.id}`, 'DELETE', owner.managerToken, { ...removal, expectedRevision: 1 })).status).toBe(409)
  expect(await scalar('SELECT used_bytes AS n FROM group_storage_budget')).toBe(before)
  await db.exec("CREATE TRIGGER deletion_test_abort BEFORE DELETE ON groups BEGIN SELECT RAISE(ABORT,'isolated delete failure'); END")
  try {
    expect((await api(`/groups/${group.data.id}`, 'DELETE', owner.managerToken, removal)).status).toBe(503)
    expect(await scalar('SELECT count(*) AS n FROM group_tombstones WHERE id=?', group.data.id)).toBe(0)
    expect(await scalar('SELECT count(*) AS n FROM members WHERE group_id=?', group.data.id)).toBe(1)
    expect(await scalar('SELECT used_bytes AS n FROM group_storage_budget')).toBe(before)
    expect((await api(`/groups/${group.data.id}`, 'GET', owner.managerToken)).status).toBe(200)
  } finally { await db.exec('DROP TRIGGER deletion_test_abort') }
  expect((await api(`/groups/${group.data.id}`, 'DELETE', owner.managerToken, removal)).status).toBe(200)
  expect(await scalar('SELECT count(*) AS n FROM members WHERE group_id=?', group.data.id)).toBe(0)
  expect(await scalar('SELECT count(*) AS n FROM group_tombstones WHERE id=?', group.data.id)).toBe(1)
})

it('expired receipt cleanup makes durable bounded progress even when the business mutation still exceeds capacity', async () => {
  const owner = createBody(), group = await api('/groups', 'POST', '', owner); expect(group.status).toBe(200)
  const now = Date.now(), result = JSON.stringify({ payload: 'X'.repeat(1000) })
  await db.batch(Array.from({ length: 200 }, (_, i) => db.prepare('INSERT INTO operations(scope,op,digest,result_json,group_id,created_at,expires_at) VALUES(?,?,?,?,?,?,?)').bind('expiry-fixture-' + i, 'expired-operation-' + i, 'digest', result, group.data.id, now, now + 86400000)))
  await db.prepare('UPDATE operations SET expires_at=0 WHERE scope LIKE ?').bind('expiry-fixture-%').run()
  const before = await scalar('SELECT used_bytes AS n FROM group_storage_budget')
  await db.prepare('UPDATE group_storage_budget SET max_bytes=used_bytes').run()
  const oversized = createBody(largePackage(90))
  expect((await api('/groups', 'POST', '', oversized)).status).toBe(507)
  expect(await scalar('SELECT count(*) AS n FROM operations WHERE scope LIKE ?', 'expiry-fixture-%')).toBeLessThan(200)
  expect(await scalar('SELECT used_bytes AS n FROM group_storage_budget')).toBeLessThan(before)
  expect((await api('/groups', 'POST', '', oversized)).status).toBe(507)
  expect(await scalar('SELECT count(*) AS n FROM operations WHERE scope LIKE ?', 'expiry-fixture-%')).toBe(0)
  const smaller = createBody(largePackage(60)), accepted = await api('/groups', 'POST', '', smaller)
  expect(accepted.status).toBe(200)
  expect((await api('/groups', 'POST', '', smaller)).data.id).toBe(accepted.data.id)
})

it('invalid member writes retain current-window limits through churn, while global scope capacity and expiry stay bounded', async () => {
  const owner = createBody(), group = await api('/groups', 'POST', '', owner); expect(group.status).toBe(200)
  const baseline = await scalar('SELECT used_bytes AS n FROM group_storage_budget')
  const day = Math.floor(Date.now() / 86400000)
  await db.prepare('INSERT INTO rate_limits VALUES(?,?,?)').bind('personal-create-day:current-fixture', day, 1000).run()
  await db.prepare('INSERT INTO rate_limits VALUES(?,?,?)').bind('personal-create-day:expired-fixture', day - 1, 1000).run()
  let lastToken = ''
  for (let i = 0; i < 80; i++) {
    lastToken = token()
    const member = await api(`/groups/${group.data.id}/join`, 'POST', owner.inviteToken, { name: '循环成员', memberToken: lastToken, operationId: randomUUID() }); expect(member.status).toBe(200)
    expect((await api(`/groups/${group.data.id}/members/${member.data.id}/response`, 'PUT', lastToken, {})).status).toBe(400)
    expect((await api(`/groups/${group.data.id}/members/${member.data.id}`, 'DELETE', owner.managerToken)).status).toBe(200)
  }
  expect(await scalar('SELECT count(*) AS n FROM members WHERE group_id=?', group.data.id)).toBe(0)
  expect(await scalar('SELECT used_bytes AS n FROM group_storage_budget')).toBe(baseline)
  expect((await db.prepare("SELECT count FROM rate_limits WHERE key='personal-create-day:current-fixture'").first<any>())!.count).toBe(1000)
  expect(await scalar("SELECT count(*) AS n FROM rate_limits WHERE key='personal-create-day:expired-fixture'")).toBe(0)
  // Deleting/rejoining with the same capability must not reset this minute's counter.
  const rejoined = await api(`/groups/${group.data.id}/join`, 'POST', owner.inviteToken, { name: '重入', memberToken: lastToken, operationId: randomUUID() }); expect(rejoined.status).toBe(200)
  const responsePath = `/groups/${group.data.id}/members/${rejoined.data.id}/response`
  for (let i = 0; i < 59; i++) expect((await api(responsePath, 'PUT', lastToken, {})).status).toBe(400)
  expect((await api(responsePath, 'PUT', lastToken, {})).status).toBe(429)
  const knownKey = 'write:' + createHash('sha256').update(lastToken).digest('hex')
  const known = await db.prepare('SELECT * FROM rate_limits WHERE key=?').bind(knownKey).first<any>(); expect(known!.count).toBe(61)
  const freshToken = token(), fresh = await api(`/groups/${group.data.id}/join`, 'POST', owner.inviteToken, { name: '新范围', memberToken: freshToken, operationId: randomUUID() }); expect(fresh.status).toBe(200)
  const activeWindow = Math.floor(Date.now() / 60000), present = await scalar('SELECT count(*) AS n FROM rate_limits')
  await db.prepare("WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<?) INSERT INTO rate_limits(key,window,count) SELECT 'rate-fixture-'||i,?,0 FROM n").bind(10000 - present, activeWindow).run()
  const freshPath = `/groups/${group.data.id}/members/${fresh.data.id}/response`
  expect((await api(freshPath, 'PUT', freshToken, {})).status).toBe(429)
  expect(await scalar('SELECT count(*) AS n FROM rate_limits')).toBe(10000)
  expect((await api(responsePath, 'PUT', lastToken, {})).status).toBe(429)
  expect((await db.prepare('SELECT count FROM rate_limits WHERE key=?').bind(knownKey).first<any>())!.count).toBe(62)
  await db.prepare("UPDATE rate_limits SET window=? WHERE key LIKE 'rate-fixture-%'").bind(activeWindow - 1).run()
  expect((await api(freshPath, 'PUT', freshToken, {})).status).toBe(400)
  expect(await scalar('SELECT count(*) AS n FROM rate_limits')).toBeLessThan(10000)
  expect((await db.prepare('SELECT count FROM rate_limits WHERE key=?').bind(knownKey).first<any>())!.count).toBe(62)
  await expect(db.prepare('INSERT INTO rate_limits VALUES(?,?,1)').bind('X'.repeat(257), activeWindow).run()).rejects.toThrow('RATE_SCOPE_LIMIT')
})
