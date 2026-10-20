/** Storage entry point: see src/storage/common.ts for the interface. */
import { PostgresDb } from './storage/postgres'
import { SqliteDb } from './storage/sqlite'
import type { Db } from './storage/common'

export * from './storage/common'

/** PostgreSQL + TimescaleDB when `databaseUrl` is set, else SQLite at `dbPath`. Connection and
 *  migrations happen in `init()`, which every call awaits. */
export function makeDb(opts: { databaseUrl?: string; dbPath: string }): Db {
  return opts.databaseUrl ? new PostgresDb(opts.databaseUrl) : new SqliteDb(opts.dbPath)
}
