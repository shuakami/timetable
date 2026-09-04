import { CapacitorSQLite, SQLiteConnection, SQLiteDBConnection } from '@capacitor-community/sqlite'
import { hydrate, type Persistence, type State } from '../store'

/* Capacitor 原生端的 SQLite 持久化。整份 State 作为文档存在一张表里，
   写入走事务；Persistence 接口是同步的，所以 load 在 init 时预取，
   save 异步排队（微任务合批已在 Store 层做过）。 */

const DB_NAME = 'timetable'
const TABLE = 'app_state'

function serialize(s: State): string {
  return JSON.stringify(s, (_, v) => (typeof v === 'bigint' ? v.toString() : v))
}

function deserialize(raw: string): State {
  return hydrate(JSON.parse(raw) as State)
}

export async function createSqlitePersistence(): Promise<Persistence> {
  const conn = new SQLiteConnection(CapacitorSQLite)
  let db: SQLiteDBConnection
  const consistency = await conn.checkConnectionsConsistency()
  const exists = (await conn.isConnection(DB_NAME, false)).result
  if (consistency.result && exists) {
    db = await conn.retrieveConnection(DB_NAME, false)
  } else {
    db = await conn.createConnection(DB_NAME, false, 'no-encryption', 1, false)
  }
  await db.open()
  await db.execute(`CREATE TABLE IF NOT EXISTS ${TABLE} (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL);`)

  const res = await db.query(`SELECT json FROM ${TABLE} WHERE id = 1;`)
  const initial: State | null = res.values?.[0]?.json ? deserialize(res.values[0].json as string) : null

  let writing = false
  let queued: string | null = null
  const flush = async (json: string) => {
    writing = true
    try {
      await db.run(`INSERT INTO ${TABLE} (id, json) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json;`, [json])
    } finally {
      writing = false
      if (queued !== null) {
        const next = queued
        queued = null
        void flush(next)
      }
    }
  }

  return {
    load: () => initial,
    save: (s: State) => {
      const json = serialize(s)
      if (writing) queued = json
      else void flush(json)
    },
  }
}
