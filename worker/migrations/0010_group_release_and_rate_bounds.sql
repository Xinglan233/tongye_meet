/* Incremental repair for databases that already applied 0009.
A CAS-qualified tombstone INSERT is now the atomic group deletion statement.
Its 1024-byte receipt releases at least the group's 2048-byte overhead plus its
snapshot in the same trigger. This allows net release even while migrated usage
remains over budget, while orphan receipts and all ordinary growth stay capped.
Existing under-budget delete-first workers remain compatible during rollout. */
DROP TRIGGER group_tombstone_budget_insert;
CREATE TRIGGER group_tombstone_budget_insert AFTER INSERT ON group_tombstones BEGIN
 DELETE FROM group_tombstones WHERE deleted_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now','-7 days');
 DELETE FROM group_tombstones WHERE rowid NOT IN(SELECT rowid FROM group_tombstones ORDER BY deleted_at DESC,rowid DESC LIMIT 10000);
 SELECT RAISE(ABORT,'GROUP_STORAGE_BUDGET') WHERE (SELECT used_bytes+1024>max_bytes FROM group_storage_budget WHERE id=1) AND NOT EXISTS(SELECT 1 FROM groups WHERE id=NEW.id AND manager_hash=NEW.manager_hash);
 UPDATE group_storage_budget SET used_bytes=used_bytes+1024 WHERE id=1;
 DELETE FROM groups WHERE id=NEW.id AND manager_hash=NEW.manager_hash;
END;
/* Rate scopes retain their entire current-minute counters through member churn.
The worker independently reaps at most 128 expired scopes before each limit check.
Personal creation daily scopes expire by day, all other scopes expire by minute.
Global SQL admission bounds new scopes to 10000 rows and 256 UTF-8 key bytes.
Allow 1024 bytes per record, a separate 10 MiB application metadata allowance.
Migrated current-window counters remain intact even if already above this cap.
No new scope can increase such an existing excess. */
CREATE INDEX rate_limits_window ON rate_limits(window);
DELETE FROM rate_limits WHERE window<CASE WHEN key LIKE 'personal-create-day:%' THEN CAST(strftime('%s','now') AS INTEGER)/86400 ELSE CAST(strftime('%s','now') AS INTEGER)/60 END;
CREATE TRIGGER rate_limit_scope_insert BEFORE INSERT ON rate_limits BEGIN
 SELECT RAISE(ABORT,'RATE_SCOPE_LIMIT') WHERE length(CAST(NEW.key AS BLOB))>256;
 SELECT RAISE(ABORT,'RATE_SCOPE_LIMIT') WHERE (SELECT count(*) FROM rate_limits)>=10000 AND NOT EXISTS(SELECT 1 FROM rate_limits WHERE key=NEW.key);
END;
