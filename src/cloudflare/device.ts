import type { RenderInput } from '../domain/input.js';
import { toDecision } from '../domain/frame.js';
import { applyDisplayPolicy } from '../domain/display-policy.js';
import { DurableObject } from 'cloudflare:workers';
import type { FaceDecision } from '../domain/types.js';
import { renderer, type AppEnv } from './config.js';
import type { SenderMetadata } from './sender.js';
export interface Snapshot { revision: number; decision: FaceDecision; message: string; nextPollSeconds: number; requiresAck: boolean }
type Row = { revision: number; request_seq: number; decision: string | null; pending: string | null; message: string; active_id: number | null };
/** One coordination boundary per device, with a bounded queue and delivery archive. */
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
    if (!columns.some(column => column.name === 'active_id')) ctx.storage.sql.exec('ALTER TABLE display ADD COLUMN active_id INTEGER');
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, decision TEXT NOT NULL, message TEXT NOT NULL, delivered INTEGER NOT NULL DEFAULT 0)');
    const messageColumns = ctx.storage.sql.exec<{ name: string }>('PRAGMA table_info(messages)').toArray();
    // Legacy timestamps are unknown. Never backfill them with classification or migration time.
    for (const name of ['received_at', 'delivered_at', 'sender']) {
      if (!messageColumns.some(column => column.name === name)) ctx.storage.sql.exec(`ALTER TABLE messages ADD COLUMN ${name} TEXT`);
    }
    ctx.storage.sql.exec('INSERT OR IGNORE INTO display (id) VALUES (1)');
  }
  private row(): Row {
    return this.ctx.storage.sql.exec<Row>('SELECT revision, request_seq, decision, pending, message, active_id FROM display WHERE id = 1').one();
  }
  async read(): Promise<Snapshot | null> {
    const row = this.row();
    return row.decision ? { revision: row.revision, decision: JSON.parse(row.decision), message: row.message, nextPollSeconds: 60, requiresAck: row.active_id !== null } : null;
  }
  async enqueue(input: RenderInput, receivedAt = new Date().toISOString(), sender: SenderMetadata | null = null): Promise<{id: number} | null> {
    if (this.ctx.storage.sql.exec<{n:number}>('SELECT COUNT(*) AS n FROM messages WHERE delivered=0').one().n >= 256) return null;
    const decision = toDecision(await renderer(input.face === undefined ? this.env : { ...this.env, FACE_PROVIDER: 'rules' }).render(input));
    if (this.ctx.storage.sql.exec<{n:number}>('SELECT COUNT(*) AS n FROM messages WHERE delivered=0').one().n >= 256) return null;
    return this.ctx.storage.sql.exec<{id:number}>(
      'INSERT INTO messages (decision,message,received_at,sender) VALUES (?,?,?,?) RETURNING id',
      JSON.stringify(decision), input.message ?? '', receivedAt, sender === null ? null : JSON.stringify(sender),
    ).one();
  }
  async readForDevice(): Promise<Snapshot | null> {
    const current = this.row();
    if (current.active_id !== null) return this.read();
    const next = this.ctx.storage.sql.exec<{id:number;decision:string;message:string}>('SELECT id,decision,message FROM messages WHERE delivered=0 ORDER BY id LIMIT 1').toArray()[0];
    if (!next) return this.read();
    const decision = applyDisplayPolicy(JSON.parse(next.decision), current.decision ? JSON.parse(current.decision) : undefined, 15_000, new Date());
    return this.commit(decision, next.message, next.id);
  }
  acknowledge(revision: number): boolean {
    const current = this.row();
    if (current.revision !== revision) return false;
    if (current.active_id === null) return true;
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec('UPDATE messages SET delivered=1, delivered_at=COALESCE(delivered_at, ?) WHERE id=?', new Date().toISOString(), current.active_id);
      this.ctx.storage.sql.exec('UPDATE display SET active_id=NULL WHERE id=1');
      // Keep a bounded archive; the device also keeps its own offline history.
      this.ctx.storage.sql.exec('DELETE FROM messages WHERE delivered=1 AND id NOT IN (SELECT id FROM messages WHERE delivered=1 ORDER BY id DESC LIMIT 64)');
    });
    return true;
  }

  async update(input: RenderInput): Promise<Snapshot | null> {
    const seq = this.ctx.storage.sql.exec<{ request_seq: number }>(
      'UPDATE display SET request_seq = request_seq + 1 WHERE id = 1 RETURNING request_seq',
    ).one().request_seq;
    const decision = toDecision(await renderer(input.face === undefined ? this.env : { ...this.env, FACE_PROVIDER: 'rules' }).render(input));
    // External classification yields: a newer request may now own this device.
    const current = this.row();
    if (current.request_seq !== seq) return null;
    // Read the display AFTER classification; an alarm may have changed it meanwhile.
    const previous = current.decision ? JSON.parse(current.decision) as FaceDecision : undefined;
    return this.commit(applyDisplayPolicy(decision, previous, 15_000, new Date()), input.message);
  }

  private async commit(decision: FaceDecision, submittedMessage?: string, activeId: number | null = null): Promise<Snapshot> {
    const message = submittedMessage ?? this.row().message;
    const pending = decision.reason === 'minimum-hold' ? JSON.stringify(decision) : null;
    const row = this.ctx.storage.sql.exec<{ revision: number }>(
      'UPDATE display SET revision = revision + 1, decision = ?, pending = ?, message = ?, active_id = ? WHERE id = 1 RETURNING revision',
      JSON.stringify(decision), pending, message, activeId,
    ).one();
    if (pending) await this.ctx.storage.setAlarm(Date.parse(decision.changedAt) + 15_000);
    return { revision: row.revision, decision, message, nextPollSeconds: 60, requiresAck: activeId !== null };
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
