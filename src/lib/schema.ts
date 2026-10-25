import {
  sqliteTable,
  text,
  integer,
  primaryKey,
} from 'drizzle-orm/sqlite-core';

export const groups = sqliteTable('denil_groups', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  codeHash: text('code_hash').notNull(),
});
export const memories = sqliteTable('denil_memories', {
  id: text('id').primaryKey(),
  date: text('date').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  tags: text('tags').notNull().default('[]'),
  public: integer('public', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
});
export const audiences = sqliteTable(
  'denil_audiences',
  {
    memoryId: text('memory_id')
      .notNull()
      .references(() => memories.id, { onDelete: 'cascade' }),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.memoryId, t.groupId] })],
);
export const photos = sqliteTable('denil_photos', {
  id: text('id').primaryKey(),
  memoryId: text('memory_id')
    .notNull()
    .references(() => memories.id, { onDelete: 'cascade' }),
  filename: text('filename').notNull(),
  mime: text('mime').notNull(),
  size: integer('size').notNull(),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  originalKey: text('original_key').notNull(),
  previewKey: text('preview_key').notNull(),
  thumbKey: text('thumb_key').notNull(),
});
export const sessions = sqliteTable('denil_sessions', {
  hash: text('hash').primaryKey(),
  role: text('role', { enum: ['admin', 'group'] }).notNull(),
  groupId: text('group_id').references(() => groups.id, {
    onDelete: 'cascade',
  }),
  expiresAt: integer('expires_at').notNull(),
  kind: text('kind', { enum: ['session', 'token'] }).notNull(),
  label: text('label').notNull().default(''),
});
export const uploads = sqliteTable('denil_uploads', {
  id: text('id').primaryKey(),
  uploadKey: text('upload_key').notNull(),
  date: text('date').notNull(),
  title: text('title').notNull(),
  size: integer('size').notNull(),
  state: text('state', {
    enum: ['pending', 'processing', 'ready', 'used', 'deleting'],
  })
    .notNull()
    .default('pending'),
  payload: text('payload'),
  expiresAt: integer('expires_at').notNull(),
});
