import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'
import { build } from 'esbuild'
import { readFileSync, readdirSync } from 'node:fs'
import { randomBytes, randomUUID } from 'node:crypto'

let mf: Miniflare, db: D1Database, event: any
const token = () => randomBytes(32).toString('hex')
const root = token(), admin = token()
const pkg = JSON.parse(readFileSync('examples/event-minimal.json', 'utf8')); pkg.event.id = 'public-group-budget'
async function api(path: string, method = 'GET', auth = '', body?: unknown) {
  const res = await mf.dispatchFetch('http://localhost/api/v1' + path, { method, headers: { ...(auth ? { Authorization: 'Bearer ' + auth } : {}), 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
  return { status: res.status, ...await res.json() as any }
}
const creation = (changes: any = {}) => ({ sourceEventId: event.id, sourceEventRevision: event.revision, title: '同行小队', managerToken: token(), inviteToken: token(), operationId: randomUUID(), ...changes })
const response = (name = '成员') => ({ name, presence: [{ date: '2026-10-03', intervals: [{ start: '13:07', end: '13:52' }] }], busy: [], bufferMinutes: 0 })
const scalar = async (sql: string, ...args: any[]) => (await db.prepare(sql).bind(...args).first<any>())!.n
beforeAll(async () => {
  const built = await build({ entryPoints: ['worker/src/index.ts'], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' })
  mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: built.outputFiles[0].text, compatibilityDate: '2026-09-01', d1Databases: ['DB'], bindings: { CREATION_MODE: 'invite', CREATION_CODE: 'test-create', ADMIN_ROOT_SECRET: root, ALLOWED_ORIGINS: 'http://localhost:5173', BUILD_VERSION: 'group-budget' } }))
  db = await mf.getD1Database('DB')
  for (const m of readdirSync('worker/migrations').filter(x => x.endsWith('.sql')).sort()) await db.exec(readFileSync('worker/migrations/' + m, 'utf8').replace(/\n/g, ' '))
  expect((await api('/admin/session', 'POST', '', { rootToken: root, sessionToken: admin })).status).toBe(200)
  event = (await api('/admin/events', 'POST', admin, { eventPackage: pkg, status: 'published', expectedRevision: 0, operationId: randomUUID() })).data
}, 30000)
afterAll(async () => { await mf?.dispose() })
beforeEach(async () => { await db.prepare('UPDATE rate_limits SET count=0').run() })

describe.sequential('public event groups and atomic application budget', () => {
  it('anonymous creation without a code retains independent invite/manager capabilities and idempotency', async () => {
    const body = creation({ eventPackage: { unsafeClientSnapshot: true } }), [first, concurrent] = await Promise.all([api('/groups', 'POST', '', body), api('/groups', 'POST', '', body)])
    expect(first.status).toBe(200); expect(concurrent.status).toBe(200)
    expect(concurrent.data.id).toBe(first.data.id)
    expect(first.data.eventPackage).toEqual(pkg)
    expect(first.data).toMatchObject({ title: body.title, sourceEventId: event.id, sourceEventRevision: event.revision })
    expect(JSON.stringify(first.data)).not.toContain(body.managerToken)
    expect((await api('/groups', 'POST', '', { ...body, title: '改内容' })).status).toBe(409)
    expect((await api(`/groups/${first.data.id}`, 'PATCH', body.inviteToken, { status: 'closed', expectedRevision: 0, operationId: randomUUID() })).status).toBe(403)
    expect((await api(`/groups/${first.data.id}/join`, 'POST', body.managerToken, { name: '队长', memberToken: token(), operationId: randomUUID() })).status).toBe(403)
    for (const creationCode of [undefined, 'test-create']) expect((await api('/groups', 'POST', '', creation({ creationCode, inviteToken: body.managerToken, managerToken: body.managerToken }))).status).toBe(401)
    expect((await api(`/groups/${first.data.id}/invite/rotate`, 'POST', body.managerToken, { inviteToken: body.managerToken, expectedRevision: 0, operationId: randomUUID() })).status).toBe(401)
  })
  it('custom and private sources still require old protection; drafts, archived and stale sources cannot create', async () => {
    expect((await api('/groups', 'POST', '', creation({ sourceEventId: undefined, eventPackage: pkg }))).status).toBe(403)
    expect((await api('/groups', 'POST', '', creation({ sourceEventRevision: 0 }))).status).toBe(409)
    expect((await api('/groups', 'POST', '', creation({ sourceEventId: undefined, eventPackage: pkg, creationCode: 'test-create' }))).status).toBe(200)
    const privateBody = { ownerToken: token(), personalToken: token(), name: '本人', eventPackage: pkg, operationId: randomUUID() }
    expect((await api('/private-events', 'POST', '', privateBody)).status).toBe(403)
    const privateEvent = (await api('/private-events', 'POST', '', { ...privateBody, creationCode: 'test-create' })).data.activity
    expect((await api('/groups', 'POST', '', creation({ sourceEventId: privateEvent.id, sourceEventRevision: privateEvent.revision, sourceEventToken: privateBody.ownerToken }))).status).toBe(403)
    expect((await api('/events/' + privateEvent.id)).status).toBe(404)
    expect((await api('/groups', 'POST', '', creation({ sourceEventId: privateEvent.id, sourceEventRevision: privateEvent.revision, sourceEventToken: privateBody.ownerToken, creationCode: 'test-create' }))).status).toBe(200)
    for (const status of ['draft', 'archived', 'cancelled']) {
      const pack = structuredClone(pkg); pack.event.id = 'restricted-' + status
      expect((await api('/admin/events', 'POST', admin, { eventPackage: pack, status, expectedRevision: 0, operationId: randomUUID() })).status).toBe(200)
      expect((await api('/groups', 'POST', '', creation({ sourceEventId: pack.event.id, sourceEventRevision: 1 }))).status).toBeGreaterThanOrEqual(400)
    }
  })
  it('two creations racing last bytes permit only one; over-cap replay does not duplicate charges', async () => {
    const ledger = await db.prepare('SELECT * FROM group_storage_budget WHERE id=1').first<any>()
    expect(ledger.max_bytes).toBe(64 * 1024 * 1024)
    const cost = Buffer.byteLength(JSON.stringify(pkg)) + 2048
    await db.prepare('UPDATE group_storage_budget SET max_bytes=used_bytes+? WHERE id=1').bind(cost).run()
    const requests = [creation(), creation()], results = await Promise.all(requests.map(b => api('/groups', 'POST', '', b)))
    expect(results.map(r => r.status).sort()).toEqual([200, 507])
    const after = await scalar('SELECT used_bytes AS n FROM group_storage_budget WHERE id=1')
    const winningBody = requests[results.findIndex(r => r.status === 200)]
    expect((await api('/groups', 'POST', '', winningBody)).status).toBe(200)
    expect(await scalar('SELECT used_bytes AS n FROM group_storage_budget WHERE id=1')).toBe(after)
    await db.prepare('UPDATE group_storage_budget SET max_bytes=? WHERE id=1').bind(ledger.max_bytes).run()
  })
  it('per-event and global group caps are atomic, replay remains valid, and delete releases counts', async () => {
    const body = creation(), created = await api('/groups', 'POST', '', body); expect(created.status).toBe(200)
    await db.prepare('UPDATE group_storage_budget SET max_groups=(SELECT count(*) FROM groups)+1,max_groups_per_event=(SELECT count(*) FROM groups WHERE source_event_id=?)+1 WHERE id=1').bind(event.id).run()
    const results = await Promise.all([api('/groups', 'POST', '', creation()), api('/groups', 'POST', '', creation())])
    expect(results.map(r => r.status).sort()).toEqual([200, 429])
    expect((await api('/groups', 'POST', '', body)).status).toBe(200)
    expect((await api(`/groups/${created.data.id}`, 'DELETE', body.managerToken, { confirm: created.data.id, expectedRevision: 0, operationId: randomUUID() })).status).toBe(200)
    expect((await api('/groups', 'POST', '', creation())).status).toBe(200)
    await db.prepare('UPDATE group_storage_budget SET max_groups=1000,max_groups_per_event=100 WHERE id=1').run()
  })
  it('member writes and receipt growth roll back together; smaller writes and deletion release capacity', async () => {
    const body = creation({ creationCode: 'test-create' }), group = (await api('/groups', 'POST', '', body)).data, memberToken = token()
    const joined = (await api(`/groups/${group.id}/join`, 'POST', body.inviteToken, { name: '成员', memberToken, operationId: randomUUID() })).data
    const path = `/groups/${group.id}/members/${joined.id}/response`, update = { response: response(), expectedRevision: 0, scheduleRevision: 0, operationId: randomUUID() }
    const initial = await scalar('SELECT used_bytes AS n FROM group_storage_budget WHERE id=1')
    const memberGrowth = Buffer.byteLength(JSON.stringify(update.response)) + Buffer.byteLength('[{\"date\":\"2026-10-03\",\"start\":\"13:07\",\"end\":\"13:52\"}]')
    await db.prepare('UPDATE group_storage_budget SET max_bytes=used_bytes+? WHERE id=1').bind(memberGrowth).run()
    expect((await api(path, 'PUT', memberToken, update)).status).toBe(507)
    expect((await api(path, 'GET', memberToken)).data.member.revision).toBe(0)
    expect(await scalar('SELECT count(*) AS n FROM operations WHERE member_id=?', joined.id)).toBe(0)
    expect(await scalar('SELECT used_bytes AS n FROM group_storage_budget WHERE id=1')).toBe(initial)
    await db.prepare('UPDATE group_storage_budget SET max_bytes=67108864 WHERE id=1').run()
    expect((await api(path, 'PUT', memberToken, update)).status).toBe(200)
    expect((await api(path, 'PUT', memberToken, update)).status).toBe(200)
    expect((await api(path, 'GET', body.managerToken)).status).toBe(403)
    expect((await api(path, 'PUT', memberToken, { ...update, operationId: randomUUID() })).status).toBe(409)
    await db.prepare('UPDATE group_storage_budget SET max_bytes=used_bytes WHERE id=1').run()
    const deletion = { confirm: group.id, expectedRevision: 0, operationId: randomUUID() }
    expect((await api(`/groups/${group.id}`, 'DELETE', body.managerToken, deletion)).status).toBe(200)
    expect((await api(`/groups/${group.id}`, 'DELETE', body.managerToken, deletion)).status).toBe(200)
    expect(await scalar('SELECT used_bytes AS n FROM group_storage_budget WHERE id=1')).toBeLessThan(initial)
    expect(await scalar('SELECT count(*) AS n FROM operations WHERE group_id=?', group.id)).toBe(0)
    await db.prepare('UPDATE group_storage_budget SET max_bytes=67108864 WHERE id=1').run()
  })
  it('group operation receipts remain bounded; expired known retries fail explicitly without reapplying', async () => {
    const body = creation({ creationCode: 'test-create' }), group = (await api('/groups', 'POST', '', body)).data
    let revision = 0, last: any, first: any
    for (let i = 0; i < 70; i++) {
      last = { status: i % 2 ? 'closed' : 'open', expectedRevision: revision, operationId: randomUUID() }; first ??= last
      const saved = await api(`/groups/${group.id}`, 'PATCH', body.managerToken, last); expect(saved.status).toBe(200); revision = saved.data.revision
    }
    expect(await scalar('SELECT count(*) AS n FROM operations WHERE group_id=?', group.id)).toBe(64)
    expect((await api(`/groups/${group.id}`, 'PATCH', body.managerToken, first)).status).toBe(409)
    expect((await api(`/groups/${group.id}`, 'PATCH', body.managerToken, last)).data.revision).toBe(revision)
    await db.prepare('UPDATE operations SET expires_at=0 WHERE group_id=?').bind(group.id).run()
    expect((await api(`/groups/${group.id}`, 'PATCH', body.managerToken, last)).error.code).toBe('IDEMPOTENCY_EXPIRED')
    const next = await api(`/groups/${group.id}`, 'PATCH', body.managerToken, { status: 'open', expectedRevision: revision, operationId: randomUUID() }); expect(next.status).toBe(200)
    expect(await scalar('SELECT count(*) AS n FROM operations WHERE group_id=?', group.id)).toBe(1)
  })
  it('member creation races last resource bytes without partial joins', async () => {
    const body = creation(), group = (await api('/groups', 'POST', '', body)).data
    await db.prepare('UPDATE group_storage_budget SET max_bytes=used_bytes+1024 WHERE id=1').run()
    const requests = [0, 1].map(() => ({ name: '并发加入', memberToken: token(), operationId: randomUUID() }))
    const results = await Promise.all(requests.map(request => api(`/groups/${group.id}/join`, 'POST', body.inviteToken, request)))
    expect(results.map(r => r.status).sort()).toEqual([200, 507])
    expect(await scalar('SELECT count(*) AS n FROM members WHERE group_id=?', group.id)).toBe(1)
    await db.prepare('UPDATE group_storage_budget SET max_bytes=67108864 WHERE id=1').run()
    expect((await api(`/groups/${group.id}`, 'GET', body.managerToken)).status).toBe(200)
    expect((await api(`/groups/${group.id}`, 'GET', body.inviteToken)).status).toBe(200)
    const retry = await api(`/groups/${group.id}/join`, 'POST', body.inviteToken, requests[results.findIndex(r => r.status === 507)])
    expect(retry.status).toBe(200)
    expect(await scalar('SELECT count(*) AS n FROM members WHERE group_id=?', group.id)).toBe(2)
  })
  it('failed snapshot receipt growth rolls back the group version and event snapshot', async () => {
    const body = creation({ sourceEventId: undefined, eventPackage: pkg, creationCode: 'test-create' }), group = (await api('/groups', 'POST', '', body)).data
    const changed = structuredClone(pkg); changed.event.title = pkg.event.title + '更新'
    await db.prepare('UPDATE group_storage_budget SET max_bytes=used_bytes+6 WHERE id=1').run()
    expect((await api(`/groups/${group.id}/event-import/commit`, 'POST', body.managerToken, { eventPackage: changed, expectedRevision: 0, operationId: randomUUID() })).status).toBe(507)
    const read = (await api(`/groups/${group.id}`, 'GET', body.managerToken)).data
    expect(read.revision).toBe(0); expect(read.eventPackage).toEqual(pkg)
    expect(await scalar('SELECT count(*) AS n FROM operations WHERE group_id=?', group.id)).toBe(0)
    await db.prepare('UPDATE group_storage_budget SET max_bytes=67108864 WHERE id=1').run()
  })
  it('event and global caps protect their independent scopes', async () => {
    await db.prepare('UPDATE group_storage_budget SET max_groups_per_event=(SELECT count(*) FROM groups WHERE source_event_id=?) WHERE id=1').bind(event.id).run()
    expect((await api('/groups', 'POST', '', creation())).status).toBe(429)
    const other = structuredClone(pkg); other.event.id = 'another-count-scope'
    const published = await api('/admin/events', 'POST', admin, { eventPackage: other, status: 'published', expectedRevision: 0, operationId: randomUUID() }); expect(published.status).toBe(200)
    expect((await api('/groups', 'POST', '', creation({ sourceEventId: other.event.id, sourceEventRevision: published.data.revision }))).status).toBe(200)
    await db.prepare('UPDATE group_storage_budget SET max_groups_per_event=100,max_groups=(SELECT count(*) FROM groups) WHERE id=1').run()
    expect((await api('/groups', 'POST', '', creation({ sourceEventId: other.event.id, sourceEventRevision: published.data.revision }))).status).toBe(429)
    await db.prepare('UPDATE group_storage_budget SET max_groups=1000,max_groups_per_event=100 WHERE id=1').run()
  })
  it('source publication changing after the read cannot leave a group from a stale snapshot', async () => {
    const pack = structuredClone(pkg); pack.event.id = 'source-state-race'
    expect((await api('/admin/events', 'POST', admin, { eventPackage: pack, status: 'published', expectedRevision: 0, operationId: randomUUID() })).status).toBe(200)
    let observed!: () => void, release!: () => void
    const started = new Promise<void>(resolve => { observed = resolve }), gate = new Promise<void>(resolve => { release = resolve })
    const delayedDB = new Proxy(db, { get(target, key) {
      if (key === 'prepare') return (sql: string) => {
        const statement = target.prepare(sql)
        if (!sql.startsWith('SELECT v.*,e.visibility FROM events')) return statement
        const wrap = (stmt: D1PreparedStatement): D1PreparedStatement => new Proxy(stmt, { get(t, k) {
          if (k === 'bind') return (...args: any[]) => wrap(t.bind(...args))
          if (k === 'first') return async () => { const row = await t.first(); observed(); await gate; return row }
          const value = Reflect.get(t, k); return typeof value === 'function' ? value.bind(t) : value
        } })
        return wrap(statement)
      }
      const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value
    } })
    const worker = (await import('../../worker/src/index')).default
    const pending = worker.fetch(new Request('http://localhost/api/v1/groups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(creation({ sourceEventId: pack.event.id, sourceEventRevision: 1 })) }), { DB: delayedDB, CREATION_MODE: 'invite', CREATION_CODE: 'test-create', ADMIN_ROOT_SECRET: root, ALLOWED_ORIGINS: 'http://localhost:5173', BUILD_VERSION: 'source-race' })
    await started
    try { expect((await api('/admin/events', 'POST', admin, { eventPackage: pack, status: 'archived', expectedRevision: 1, operationId: randomUUID() })).status).toBe(200) } finally { release() }
    expect((await pending).status).toBe(409)
    expect(await scalar('SELECT count(*) AS n FROM groups WHERE source_event_id=?', pack.event.id)).toBe(0)
  })
  it('retention never lets a pruned unchanged refresh operation silently execute again', async () => {
    const body = creation(), group = (await api('/groups', 'POST', '', body)).data
    let revision = 0, first: any
    for (let i = 0; i < 66; i++) {
      const update = { expectedRevision: revision, sourceEventRevision: event.revision, operationId: randomUUID() }; first ??= update
      const saved = await api(`/groups/${group.id}/source-refresh`, 'POST', body.managerToken, update); expect(saved.status).toBe(200); revision = saved.data.revision
    }
    expect((await api(`/groups/${group.id}/source-refresh`, 'POST', body.managerToken, first)).status).toBe(409)
  })
  it('expired group receipts release capacity atomically for another anonymous creation', async () => {
    const body = creation(), group = (await api('/groups', 'POST', '', body)).data
    expect((await api(`/groups/${group.id}`, 'PATCH', body.managerToken, { status: 'closed', expectedRevision: 0, operationId: randomUUID() })).status).toBe(200)
    await db.prepare('UPDATE operations SET expires_at=0 WHERE group_id=?').bind(group.id).run()
    await db.prepare('UPDATE group_storage_budget SET max_bytes=used_bytes+2048 WHERE id=1').run()
    expect((await api('/groups', 'POST', '', creation())).status).toBe(200)
    expect(await scalar('SELECT count(*) AS n FROM operations WHERE group_id=?', group.id)).toBe(0)
    await db.prepare('UPDATE group_storage_budget SET max_bytes=67108864 WHERE id=1').run()
  })
  it('anonymous group audit history has a finite ring and preserves unrelated event/admin audit records', async () => {
    const unrelated = await scalar('SELECT count(*) AS n FROM audit WHERE group_id IS NULL')
    await db.prepare("WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<10001) INSERT INTO audit(action,group_id,resource_id,created_at) SELECT 'group.updated','audit-ring-fixture','audit-ring-fixture',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM n").run()
    expect(await scalar('SELECT count(*) AS n FROM audit WHERE group_id IS NOT NULL')).toBe(10000)
    expect(await scalar('SELECT count(*) AS n FROM audit WHERE group_id IS NULL')).toBe(unrelated)
    await db.prepare("DELETE FROM audit WHERE group_id='audit-ring-fixture'").run()
  })
  it('member count 50 is still enforced in SQLite, and budget exactly equals retained resources', async () => {
    const body = creation({ creationCode: 'test-create' }), group = (await api('/groups', 'POST', '', body)).data
    for (let i = 0; i < 50; i++) expect((await api(`/groups/${group.id}/join`, 'POST', body.inviteToken, { name: '成员', memberToken: token(), operationId: randomUUID() })).status).toBe(200)
    expect((await api(`/groups/${group.id}/join`, 'POST', body.inviteToken, { name: '第51人', memberToken: token(), operationId: randomUUID() })).status).toBe(409)
    const actual = await scalar('SELECT COALESCE((SELECT SUM(length(CAST(event_json AS BLOB))+2048) FROM groups),0)+COALESCE((SELECT SUM(COALESCE(length(CAST(response_json AS BLOB)),0)+COALESCE(length(CAST(availability_json AS BLOB)),0)+1024) FROM members),0)+COALESCE((SELECT SUM(length(CAST(result_json AS BLOB))+1024) FROM operations WHERE group_id IS NOT NULL),0)+COALESCE((SELECT count(*)*1024 FROM group_tombstones),0) AS n')
    expect(await scalar('SELECT used_bytes AS n FROM group_storage_budget WHERE id=1')).toBe(actual)
  })
})
