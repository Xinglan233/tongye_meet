/* Finite application safeguards, not Cloudflare quota/cost estimates. Personal
(visitor_storage_budget) and media retain their independent existing budgets.
64 MiB includes UTF-8 event snapshots, member responses/availability, full group
operation receipts and tombstones, plus conservative row/index overhead.
Existing rows are accounted even when already above a limit， reads/deletes and
shrinking writes remain possible, while further growth fails atomically.
Receipt replay is retained for 24h, at most 64 per scope. Create/join receipts
stay on their owning row. Delete retries retain at most 10,000 tombstones / 7d.
Group/member audit metadata separately retains only the newest 10,000 records，
server-generated action/UUID/timestamp fields reserve 1 KiB per record (10 MiB
additional application metadata allowance). Event/admin audits are unaffected.
Constants are mirrored in shared/group-contract.ts. */
ALTER TABLE operations ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE operations ADD COLUMN expires_at INTEGER NOT NULL DEFAULT 0;
UPDATE operations SET created_at=CAST(strftime('%s','now') AS INTEGER)*1000,expires_at=CAST(strftime('%s','now') AS INTEGER)*1000+86400000 WHERE group_id IS NOT NULL;
CREATE INDEX group_receipts_expiry ON operations(expires_at) WHERE group_id IS NOT NULL;
CREATE INDEX group_receipts_recent ON operations(scope,created_at DESC) WHERE group_id IS NOT NULL;
DELETE FROM operations WHERE group_id IS NOT NULL AND rowid NOT IN(SELECT r.rowid FROM operations r WHERE r.scope=operations.scope ORDER BY created_at DESC,rowid DESC LIMIT 64);
DELETE FROM group_tombstones WHERE deleted_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now','-7 days');
DELETE FROM group_tombstones WHERE rowid NOT IN(SELECT rowid FROM group_tombstones ORDER BY deleted_at DESC,rowid DESC LIMIT 10000);
CREATE INDEX group_tombstones_manager ON group_tombstones(manager_hash);
CREATE TABLE group_storage_budget(id INTEGER PRIMARY KEY CHECK(id=1),used_bytes INTEGER NOT NULL CHECK(used_bytes>=0),max_bytes INTEGER NOT NULL CHECK(max_bytes>0),max_groups INTEGER NOT NULL CHECK(max_groups>0),max_groups_per_event INTEGER NOT NULL CHECK(max_groups_per_event>0));
INSERT INTO group_storage_budget SELECT 1,COALESCE((SELECT SUM(length(CAST(event_json AS BLOB))+2048) FROM groups),0)+COALESCE((SELECT SUM(COALESCE(length(CAST(response_json AS BLOB)),0)+COALESCE(length(CAST(availability_json AS BLOB)),0)+1024) FROM members),0)+COALESCE((SELECT SUM(length(CAST(result_json AS BLOB))+1024) FROM operations WHERE group_id IS NOT NULL),0)+COALESCE((SELECT COUNT(*)*1024 FROM group_tombstones),0),67108864,1000,100;
CREATE TRIGGER group_count_insert AFTER INSERT ON groups BEGIN
 SELECT RAISE(ABORT,'GROUP_COUNT_LIMIT') WHERE (SELECT count(*) FROM groups)>(SELECT max_groups FROM group_storage_budget WHERE id=1);
 SELECT RAISE(ABORT,'GROUP_COUNT_LIMIT') WHERE NEW.source_event_id IS NOT NULL AND (SELECT count(*) FROM groups WHERE source_event_id=NEW.source_event_id)>(SELECT max_groups_per_event FROM group_storage_budget WHERE id=1);
END;
CREATE TRIGGER group_budget_insert AFTER INSERT ON groups BEGIN
 DELETE FROM operations WHERE rowid IN(SELECT rowid FROM operations WHERE group_id IS NOT NULL AND expires_at<=CAST(strftime('%s','now') AS INTEGER)*1000 ORDER BY expires_at LIMIT 128);
 DELETE FROM group_tombstones WHERE rowid IN(SELECT rowid FROM group_tombstones WHERE deleted_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now','-7 days') ORDER BY deleted_at LIMIT 128);
 SELECT RAISE(ABORT,'GROUP_STORAGE_BUDGET') WHERE (SELECT used_bytes+(length(CAST(NEW.event_json AS BLOB)))+2048>max_bytes FROM group_storage_budget WHERE id=1);
 UPDATE group_storage_budget SET used_bytes=used_bytes+(length(CAST(NEW.event_json AS BLOB)))+2048 WHERE id=1;
END;
CREATE TRIGGER group_budget_update BEFORE UPDATE OF event_json ON groups BEGIN
 DELETE FROM operations WHERE rowid IN(SELECT rowid FROM operations WHERE group_id IS NOT NULL AND expires_at<=CAST(strftime('%s','now') AS INTEGER)*1000 ORDER BY expires_at LIMIT 128);
 DELETE FROM group_tombstones WHERE rowid IN(SELECT rowid FROM group_tombstones WHERE deleted_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now','-7 days') ORDER BY deleted_at LIMIT 128);
 SELECT RAISE(ABORT,'GROUP_STORAGE_BUDGET') WHERE (length(CAST(NEW.event_json AS BLOB)))>(length(CAST(OLD.event_json AS BLOB))) AND (SELECT used_bytes+(length(CAST(NEW.event_json AS BLOB)))-(length(CAST(OLD.event_json AS BLOB)))>max_bytes FROM group_storage_budget WHERE id=1);
 UPDATE group_storage_budget SET used_bytes=used_bytes+(length(CAST(NEW.event_json AS BLOB)))-(length(CAST(OLD.event_json AS BLOB))) WHERE id=1;
END;
CREATE TRIGGER group_budget_delete AFTER DELETE ON groups BEGIN
 UPDATE group_storage_budget SET used_bytes=used_bytes-(length(CAST(OLD.event_json AS BLOB)))-2048 WHERE id=1;
END;
CREATE TRIGGER group_member_budget_insert AFTER INSERT ON members BEGIN
 DELETE FROM operations WHERE rowid IN(SELECT rowid FROM operations WHERE group_id IS NOT NULL AND expires_at<=CAST(strftime('%s','now') AS INTEGER)*1000 ORDER BY expires_at LIMIT 128);
 DELETE FROM group_tombstones WHERE rowid IN(SELECT rowid FROM group_tombstones WHERE deleted_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now','-7 days') ORDER BY deleted_at LIMIT 128);
 SELECT RAISE(ABORT,'GROUP_STORAGE_BUDGET') WHERE (SELECT used_bytes+(COALESCE(length(CAST(NEW.response_json AS BLOB)),0)+COALESCE(length(CAST(NEW.availability_json AS BLOB)),0))+1024>max_bytes FROM group_storage_budget WHERE id=1);
 UPDATE group_storage_budget SET used_bytes=used_bytes+(COALESCE(length(CAST(NEW.response_json AS BLOB)),0)+COALESCE(length(CAST(NEW.availability_json AS BLOB)),0))+1024 WHERE id=1;
END;
CREATE TRIGGER group_member_budget_update BEFORE UPDATE OF response_json,availability_json ON members BEGIN
 DELETE FROM operations WHERE rowid IN(SELECT rowid FROM operations WHERE group_id IS NOT NULL AND expires_at<=CAST(strftime('%s','now') AS INTEGER)*1000 ORDER BY expires_at LIMIT 128);
 DELETE FROM group_tombstones WHERE rowid IN(SELECT rowid FROM group_tombstones WHERE deleted_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now','-7 days') ORDER BY deleted_at LIMIT 128);
 SELECT RAISE(ABORT,'GROUP_STORAGE_BUDGET') WHERE (COALESCE(length(CAST(NEW.response_json AS BLOB)),0)+COALESCE(length(CAST(NEW.availability_json AS BLOB)),0))>(COALESCE(length(CAST(OLD.response_json AS BLOB)),0)+COALESCE(length(CAST(OLD.availability_json AS BLOB)),0)) AND (SELECT used_bytes+(COALESCE(length(CAST(NEW.response_json AS BLOB)),0)+COALESCE(length(CAST(NEW.availability_json AS BLOB)),0))-(COALESCE(length(CAST(OLD.response_json AS BLOB)),0)+COALESCE(length(CAST(OLD.availability_json AS BLOB)),0))>max_bytes FROM group_storage_budget WHERE id=1);
 UPDATE group_storage_budget SET used_bytes=used_bytes+(COALESCE(length(CAST(NEW.response_json AS BLOB)),0)+COALESCE(length(CAST(NEW.availability_json AS BLOB)),0))-(COALESCE(length(CAST(OLD.response_json AS BLOB)),0)+COALESCE(length(CAST(OLD.availability_json AS BLOB)),0)) WHERE id=1;
END;
CREATE TRIGGER group_member_budget_delete AFTER DELETE ON members BEGIN
 UPDATE group_storage_budget SET used_bytes=used_bytes-(COALESCE(length(CAST(OLD.response_json AS BLOB)),0)+COALESCE(length(CAST(OLD.availability_json AS BLOB)),0))-1024 WHERE id=1;
END;
CREATE TRIGGER group_receipt_budget_insert AFTER INSERT ON operations WHEN NEW.group_id IS NOT NULL BEGIN
 UPDATE operations SET created_at=CAST(strftime('%s','now') AS INTEGER)*1000,expires_at=CAST(strftime('%s','now') AS INTEGER)*1000+86400000 WHERE scope=NEW.scope AND op=NEW.op AND created_at=0 AND expires_at=0;
 DELETE FROM operations WHERE rowid IN(SELECT rowid FROM operations WHERE group_id IS NOT NULL AND expires_at<=CAST(strftime('%s','now') AS INTEGER)*1000 ORDER BY expires_at LIMIT 128);
 DELETE FROM group_tombstones WHERE rowid IN(SELECT rowid FROM group_tombstones WHERE deleted_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now','-7 days') ORDER BY deleted_at LIMIT 128);
 DELETE FROM operations WHERE scope=NEW.scope AND group_id IS NOT NULL AND rowid NOT IN(SELECT rowid FROM operations WHERE scope=NEW.scope AND group_id IS NOT NULL ORDER BY created_at DESC,rowid DESC LIMIT 64);
 SELECT RAISE(ABORT,'GROUP_STORAGE_BUDGET') WHERE (SELECT used_bytes+(length(CAST(NEW.result_json AS BLOB)))+1024>max_bytes FROM group_storage_budget WHERE id=1);
 UPDATE group_storage_budget SET used_bytes=used_bytes+(length(CAST(NEW.result_json AS BLOB)))+1024 WHERE id=1;
END;
CREATE TRIGGER group_receipt_budget_update BEFORE UPDATE OF result_json ON operations WHEN NEW.group_id IS NOT NULL BEGIN
 SELECT RAISE(ABORT,'GROUP_STORAGE_BUDGET') WHERE (length(CAST(NEW.result_json AS BLOB)))>(length(CAST(OLD.result_json AS BLOB))) AND (SELECT used_bytes+(length(CAST(NEW.result_json AS BLOB)))-(length(CAST(OLD.result_json AS BLOB)))>max_bytes FROM group_storage_budget WHERE id=1);
 UPDATE group_storage_budget SET used_bytes=used_bytes+(length(CAST(NEW.result_json AS BLOB)))-(length(CAST(OLD.result_json AS BLOB))) WHERE id=1;
END;
CREATE TRIGGER group_receipt_budget_delete AFTER DELETE ON operations WHEN OLD.group_id IS NOT NULL BEGIN
 UPDATE group_storage_budget SET used_bytes=used_bytes-(length(CAST(OLD.result_json AS BLOB)))-1024 WHERE id=1;
END;
CREATE TRIGGER group_tombstone_budget_insert AFTER INSERT ON group_tombstones BEGIN
 DELETE FROM group_tombstones WHERE deleted_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now','-7 days');
 DELETE FROM group_tombstones WHERE rowid NOT IN(SELECT rowid FROM group_tombstones ORDER BY deleted_at DESC,rowid DESC LIMIT 10000);
 SELECT RAISE(ABORT,'GROUP_STORAGE_BUDGET') WHERE (SELECT used_bytes+(0)+1024>max_bytes FROM group_storage_budget WHERE id=1);
 UPDATE group_storage_budget SET used_bytes=used_bytes+(0)+1024 WHERE id=1;
END;
CREATE TRIGGER group_tombstone_budget_delete AFTER DELETE ON group_tombstones BEGIN
 UPDATE group_storage_budget SET used_bytes=used_bytes-(0)-1024 WHERE id=1;
END;

/* Bound metadata generated by anonymous group/member churn without changing
unrelated event/admin audit history. The index keeps the retained ring ordered. */
CREATE INDEX group_audit_recent ON audit(id DESC) WHERE group_id IS NOT NULL;
DELETE FROM audit WHERE group_id IS NOT NULL AND id<(SELECT id FROM audit WHERE group_id IS NOT NULL ORDER BY id DESC LIMIT 1 OFFSET 9999);
CREATE TRIGGER group_audit_ring AFTER INSERT ON audit WHEN NEW.group_id IS NOT NULL BEGIN
 DELETE FROM audit WHERE group_id IS NOT NULL AND id<(SELECT id FROM audit WHERE group_id IS NOT NULL ORDER BY id DESC LIMIT 1 OFFSET 9999);
END;
