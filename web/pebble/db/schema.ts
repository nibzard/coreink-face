import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
export const sendGate = sqliteTable('send_gate', {
  key: text('key').primaryKey(),
  nextAt: integer('next_at').notNull().default(0),
});
