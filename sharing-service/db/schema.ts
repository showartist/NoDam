import {sqliteTable,text,integer} from 'drizzle-orm/sqlite-core';
export const shares=sqliteTable('live_shares',{id:text('id').primaryKey(),revision:integer('revision').notNull(),snapshot:text('snapshot').notNull(),updatedAt:text('updated_at').notNull()});
