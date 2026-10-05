import { it, expect } from 'vitest'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'
import { readFileSync, readdirSync } from 'node:fs'
import { GROUP_LIMITS } from '../../shared/group-contract'

it('group budget migration accounts existing resources and preserves legacy receipts without refusing over-budget data', async () => {
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: 'export default {fetch(){return new Response("migration")}}', compatibilityDate: '2026-09-01', d1Databases: ['DB'] }))
  try {
    const db = await mf.getD1Database('DB')
    for (const m of readdirSync('worker/migrations').filter(x => x.endsWith('.sql') && x < '0009').sort()) await db.exec(readFileSync('worker/migrations/' + m, 'utf8').replace(/\n/g, ' '))
    const now = new Date().toISOString(), pkg = readFileSync('examples/event-minimal.json', 'utf8')
    await db.prepare('INSERT INTO groups(id,title,event_json,manager_hash,invite_hash,create_op,create_digest,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').bind('old-group', '旧小队', pkg, 'manager', 'invite', 'create-old-operation', 'create-digest', now, now).run()
    await db.prepare('INSERT INTO members(id,group_id,name,token_hash,join_op,join_digest,created_at,updated_at,response_json,availability_json) VALUES(?,?,?,?,?,?,?,?,?,?)').bind('old-member', 'old-group', '成员', 'member', 'join-old-operation', 'join-digest', now, now, '{"name":"成员"}', '[]').run()
    const result = JSON.stringify({ member: { id: 'old-member', revision: 3 }, response: { name: '成员' } })
    await db.prepare('INSERT INTO operations(scope,op,digest,result_json,group_id,member_id) VALUES(?,?,?,?,?,?)').bind('old-scope', 'old-response-op', 'digest', result, 'old-group', 'old-member').run()
    await db.prepare('INSERT INTO group_tombstones VALUES(?,?,?,?,?)').bind('old-deleted-group', 'old-manager', 'old-delete-operation', 'delete-digest', now).run()
    const personal = (await db.prepare('SELECT * FROM visitor_storage_budget').all()).results
    await db.exec(readFileSync('worker/migrations/0009_group_storage_budget.sql', 'utf8').replace(/\n/g, ' '))
    const budget = (await db.prepare('SELECT * FROM group_storage_budget').first<any>())!
    const expected = Buffer.byteLength(pkg) + GROUP_LIMITS.groupOverheadBytes + Buffer.byteLength('{"name":"成员"}') + Buffer.byteLength('[]') + GROUP_LIMITS.resourceOverheadBytes + Buffer.byteLength(result) + GROUP_LIMITS.resourceOverheadBytes * 2
    expect(budget).toMatchObject({ used_bytes: expected, max_bytes: GROUP_LIMITS.storageBytes, max_groups: GROUP_LIMITS.groups, max_groups_per_event: GROUP_LIMITS.groupsPerEvent })
    expect((await db.prepare('SELECT result_json,expires_at,created_at FROM operations WHERE op=?').bind('old-response-op').first<any>())!).toMatchObject({ result_json: result })
    expect((await db.prepare('SELECT * FROM visitor_storage_budget').all()).results).toEqual(personal)
    // A migration can run before the new worker version reaches every request.
    // Old INSERT statements omit the new TTL columns and must still retain receipts.
    await db.prepare('INSERT INTO operations(scope,op,digest,result_json,group_id,member_id) VALUES(?,?,?,?,?,?)').bind('old-scope', 'rolling-worker-operation', 'rolling-digest', result, 'old-group', 'old-member').run()
    const rolling = await db.prepare('SELECT * FROM operations WHERE op=?').bind('rolling-worker-operation').first<any>()
    expect(rolling).not.toBeNull(); expect(rolling!.expires_at - rolling!.created_at).toBe(GROUP_LIMITS.receiptTTLSeconds * 1000)

    const beforeShrink = (await db.prepare('SELECT used_bytes FROM group_storage_budget').first<any>())!.used_bytes
    await db.prepare('UPDATE group_storage_budget SET max_bytes=used_bytes-1 WHERE id=1').run()
    await expect(db.prepare('UPDATE members SET response_json=? WHERE id=?').bind('{"name":"增长的成员数据"}', 'old-member').run()).rejects.toThrow('GROUP_STORAGE_BUDGET')
    await db.prepare('UPDATE members SET response_json=NULL,availability_json=NULL WHERE id=?').bind('old-member').run()
    expect((await db.prepare('SELECT used_bytes FROM group_storage_budget').first<any>())!.used_bytes).toBeLessThan(beforeShrink)
    await db.prepare('DELETE FROM groups WHERE id=?').bind('old-group').run()
    expect((await db.prepare('SELECT used_bytes FROM group_storage_budget').first<any>())!.used_bytes).toBe(GROUP_LIMITS.resourceOverheadBytes)
  } finally { await mf.dispose() }
}, 30000)
