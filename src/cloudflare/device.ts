import { applyDisplayPolicy } from '../domain/display-policy.js';
import { DurableObject } from 'cloudflare:workers';
import type { FaceDecision, State } from '../domain/types.js';
import { engine, type AppEnv } from './config.js';
export interface Snapshot { revision: number; decision: FaceDecision; message: string; nextPollSeconds: number }
type Row = { revision: number; request_seq: number; decision: string | null; pending: string | null; message: string };
/** One coordination boundary per device. Only display decisions and the submitted display message are stored. */
export class Device extends DurableObject<AppEnv> {
  constructor(ctx: DurableObjectState, env: AppEnv) {
    super(ctx, env);
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS display (
      id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL DEFAULT 0,
      request_seq INTEGER NOT NULL DEFAULT 0, decision TEXT, pending TEXT
    )`);
    // Upgrade existing deployed databases without losing their current face.
    const columns = ctx.storage.sql.exec<{ name: string }>('PRAGMA table_info(display)').toArray();
    if (!columns.some(column => column.name === 'message')) {
      ctx.storage.sql.exec("ALTER TABLE display ADD COLUMN message TEXT NOT NULL DEFAULT ''");
    }
    ctx.storage.sql.exec('INSERT OR IGNORE INTO display (id) VALUES (1)');
  }
  private row(): Row {
    return this.ctx.storage.sql.exec<Row>('SELECT revision, request_seq, decision, pending, message FROM display WHERE id = 1').one();
  }
  async read(): Promise<Snapshot | null> {
    const row = this.row();
    return row.decision ? { revision: row.revision, decision: JSON.parse(row.decision), message: row.message, nextPollSeconds: 60 } : null;
  }
  async update(state: State, message?: string): Promise<Snapshot | null> {
    const seq = this.ctx.storage.sql.exec<{ request_seq: number }>(
      'UPDATE display SET request_seq = request_seq + 1 WHERE id = 1 RETURNING request_seq',
    ).one().request_seq;
    const decision = await engine(this.env).decide(message === undefined ? state : { ...state, message });
    // External classification yields: a newer request may now own this device.
    const current = this.row();
    if (current.request_seq !== seq) return null;
    // Read the display AFTER classification; an alarm may have changed it meanwhile.
    const previous = current.decision ? JSON.parse(current.decision) as FaceDecision : undefined;
    return this.commit(applyDisplayPolicy(decision, previous, 15_000, new Date()), message);
  }

  private async commit(decision: FaceDecision, submittedMessage?: string): Promise<Snapshot> {
    const message = submittedMessage ?? this.row().message;
    const pending = decision.reason === 'minimum-hold' ? JSON.stringify(decision) : null;
    const row = this.ctx.storage.sql.exec<{ revision: number }>(
      'UPDATE display SET revision = revision + 1, decision = ?, pending = ?, message = ? WHERE id = 1 RETURNING revision',
      JSON.stringify(decision), pending, message,
    ).one();
    if (pending) await this.ctx.storage.setAlarm(Date.parse(decision.changedAt) + 15_000);
    return { revision: row.revision, decision, message, nextPollSeconds: 60 };
  }
  async alarm(): Promise<void> {
    const row = this.row();
    if (!row.pending) return;
    const pending = JSON.parse(row.pending) as FaceDecision;
    const due = Date.parse(pending.changedAt) + 15_000;
    if (Date.now() < due) { await this.ctx.storage.setAlarm(due); return; }
    const decision: FaceDecision = { ...pending, face: pending.candidate, reason: 'selected', changedAt: new Date().toISOString() };
    this.ctx.storage.sql.exec(
      'UPDATE display SET revision = revision + 1, decision = ?, pending = NULL WHERE id = 1', JSON.stringify(decision),
    );
  }
}
