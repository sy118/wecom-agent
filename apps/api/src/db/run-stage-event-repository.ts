import { randomUUID } from 'crypto'
import { db } from './client.js'
import type { RunStageEvent, RunStageName, StallPoint } from '@wecom-platform/types'

function rowToStageEvent(row: Record<string, unknown>): RunStageEvent {
  return {
    id: row.id as string,
    runId: row.run_id as string,
    stage: row.stage as RunStageName,
    sequence: Number(row.sequence),
    startedAt: Number(row.started_at),
    endedAt: (row.ended_at as number | null) ?? null,
    durationMs: (row.duration_ms as number | null) ?? null,
    meta: row.meta ? JSON.parse(row.meta as string) : null,
  }
}

export const RunStageEventRepository = {
  async create(data: {
    runId: string
    stage: RunStageName
    sequence: number
    startedAt: number
    meta?: Record<string, any> | null
  }): Promise<RunStageEvent> {
    const id = randomUUID()
    await db.execute({
      sql: `INSERT INTO run_stage_events (id, run_id, stage, sequence, started_at, ended_at, duration_ms, meta)
            VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)`,
      args: [id, data.runId, data.stage, data.sequence, data.startedAt, data.meta ? JSON.stringify(data.meta) : null],
    })
    return (await this.findById(id))!
  },

  async findById(id: string): Promise<RunStageEvent | null> {
    const res = await db.execute({ sql: 'SELECT * FROM run_stage_events WHERE id = ?', args: [id] })
    return res.rows[0] ? rowToStageEvent(res.rows[0]) : null
  },

  async findByRunId(runId: string): Promise<RunStageEvent[]> {
    const res = await db.execute({
      sql: 'SELECT * FROM run_stage_events WHERE run_id = ? ORDER BY sequence ASC, started_at ASC',
      args: [runId],
    })
    return res.rows.map(rowToStageEvent)
  },

  async end(runId: string, stage: RunStageName, endedAt: number): Promise<void> {
    await db.execute({
      sql: `UPDATE run_stage_events
            SET ended_at = COALESCE(ended_at, ?), duration_ms = COALESCE(duration_ms, ? - started_at)
            WHERE run_id = ? AND stage = ? AND ended_at IS NULL`,
      args: [endedAt, endedAt, runId, stage],
    })
  },

  async markStall(runId: string, stallPoint: StallPoint, at: number): Promise<void> {
    await db.execute({
      sql: `UPDATE bot_response_runs
            SET stall_point = ?, last_activity_at = ?, updated_at = ?
            WHERE id = ?`,
      args: [stallPoint, at, at, runId],
    })
  },
}

export function __testRowToStageEvent(row: Record<string, unknown>): RunStageEvent {
  return rowToStageEvent(row)
}