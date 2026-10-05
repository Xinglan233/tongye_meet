// Application safeguards, independent of provider quotas and the personal/media budgets.
// Keep SQL defaults in worker/migrations/0009_group_storage_budget.sql in sync.
export const GROUP_LIMITS = {
  storageBytes: 64 * 1024 * 1024,
  groups: 1000,
  groupsPerEvent: 100,
  membersPerGroup: 50,
  receiptsPerScope: 64,
  receiptTTLSeconds: 24 * 60 * 60,
  tombstones: 10000,
  // Fixed-size, server-generated audit metadata has a separate finite ring.
  // Reserve 1 KiB per retained record (10 MiB total); this is not a provider quota.
  auditRecords: 10000,
  auditMetadataBytes: 10 * 1024 * 1024,
  tombstoneTTLSeconds: 7 * 24 * 60 * 60,
  groupOverheadBytes: 2048,
  resourceOverheadBytes: 1024,
} as const
