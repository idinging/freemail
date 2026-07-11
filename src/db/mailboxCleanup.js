function changedRows(result) {
  return Number(result?.meta?.changes || 0);
}

function chunks(items, size = 90) {
  const result = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function maxMessageId(rows) {
  return (rows || []).reduce((maxId, row) => Math.max(maxId, Number(row?.id || 0)), 0);
}

const SENT_FROM_ADDRESS_SQL = `LOWER(TRIM(CASE
  WHEN instr(from_addr, '<') > 0 AND instr(from_addr, '>') > instr(from_addr, '<')
    THEN substr(from_addr, instr(from_addr, '<') + 1, instr(from_addr, '>') - instr(from_addr, '<') - 1)
  ELSE from_addr
END))`;

async function deleteStoredMessages(storage, storedMessages) {
  const seen = new Set();
  for (const row of storedMessages || []) {
    const key = String(row?.r2_object_key || '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const deleted = storage?.available
      ? await storage.delete(key, row?.r2_bucket || '')
      : false;
    if (!deleted) throw new Error(`邮件对象删除失败: ${key}`);
  }
}

export async function purgeMailboxData({ db, mailboxId, address, storage = null, deleteMailbox = false }) {
  const normalized = String(address || '').trim().toLowerCase();
  const id = Number(mailboxId || 0);
  if (!id || !normalized) throw new Error('无效的邮箱');

  const { results: mailboxMessages } = await db.prepare(
    'SELECT id, r2_bucket, r2_object_key FROM messages WHERE mailbox_id = ?'
  ).bind(id).all();
  const { results: owners } = await db.prepare(
    'SELECT user_id FROM user_mailboxes WHERE mailbox_id = ?'
  ).bind(id).all();

  const messageSnapshotMaxId = maxMessageId(mailboxMessages);
  await deleteStoredMessages(storage, mailboxMessages);

  const statements = [
    db.prepare('DELETE FROM messages WHERE mailbox_id = ? AND id <= ?').bind(id, messageSnapshotMaxId),
    db.prepare(`DELETE FROM sent_emails WHERE ${SENT_FROM_ADDRESS_SQL} = ?`).bind(normalized)
  ];
  if (deleteMailbox) {
    statements.push(db.prepare('DELETE FROM mailboxes WHERE id = ?').bind(id));
  }

  const results = await db.batch(statements);

  return {
    inboxDeletedCount: changedRows(results?.[0]),
    sentDeletedCount: changedRows(results?.[1]),
    mailboxDeleted: deleteMailbox ? changedRows(results?.[2]) > 0 : false,
    ownerUserIds: [...new Set((owners || []).map(row => Number(row.user_id || 0)).filter(Boolean))]
  };
}

export async function purgeMailboxesData({ db, mailboxes, storage = null }) {
  const list = (mailboxes || []).map(mailbox => ({
    id: Number(mailbox?.id || 0),
    address: String(mailbox?.address || '').trim().toLowerCase()
  })).filter(mailbox => mailbox.id && mailbox.address);
  if (!list.length) return { byMailbox: new Map(), ownerUserIds: [] };

  const ids = list.map(mailbox => mailbox.id);
  const addresses = list.map(mailbox => mailbox.address);
  const storedMessages = [];
  const sentCounts = new Map();
  const ownerUserIds = new Set();
  const inboxCounts = new Map();
  const messageSnapshots = [];

  for (const idChunk of chunks(ids)) {
    const placeholders = idChunk.map(() => '?').join(',');
    const { results } = await db.prepare(
      `SELECT id, mailbox_id, r2_bucket, r2_object_key FROM messages WHERE mailbox_id IN (${placeholders})`
    ).bind(...idChunk).all();
    const rows = results || [];
    messageSnapshots.push({
      ids: idChunk,
      maxId: maxMessageId(rows)
    });
    for (const row of rows) {
      storedMessages.push(row);
      const mailboxId = Number(row.mailbox_id || 0);
      inboxCounts.set(mailboxId, (inboxCounts.get(mailboxId) || 0) + 1);
    }

    const { results: owners } = await db.prepare(
      `SELECT user_id FROM user_mailboxes WHERE mailbox_id IN (${placeholders})`
    ).bind(...idChunk).all();
    for (const row of owners || []) {
      const userId = Number(row.user_id || 0);
      if (userId) ownerUserIds.add(userId);
    }
  }

  for (const addressChunk of chunks(addresses)) {
    const placeholders = addressChunk.map(() => '?').join(',');
    const { results } = await db.prepare(
      `SELECT ${SENT_FROM_ADDRESS_SQL} AS address, COUNT(*) AS count
       FROM sent_emails
       WHERE ${SENT_FROM_ADDRESS_SQL} IN (${placeholders})
       GROUP BY address`
    ).bind(...addressChunk).all();
    for (const row of results || []) sentCounts.set(String(row.address || ''), Number(row.count || 0));
  }

  await deleteStoredMessages(storage, storedMessages);

  const messageDeletes = [];
  const sentDeletes = [];
  const mailboxDeletes = [];
  for (const snapshot of messageSnapshots) {
    const placeholders = snapshot.ids.map(() => '?').join(',');
    messageDeletes.push(
      db.prepare(`DELETE FROM messages WHERE mailbox_id IN (${placeholders}) AND id <= ?`)
        .bind(...snapshot.ids, snapshot.maxId)
    );
    mailboxDeletes.push(db.prepare(`DELETE FROM mailboxes WHERE id IN (${placeholders})`).bind(...snapshot.ids));
  }
  for (const addressChunk of chunks(addresses)) {
    const placeholders = addressChunk.map(() => '?').join(',');
    sentDeletes.push(db.prepare(`DELETE FROM sent_emails WHERE ${SENT_FROM_ADDRESS_SQL} IN (${placeholders})`).bind(...addressChunk));
  }
  await db.batch([...messageDeletes, ...sentDeletes, ...mailboxDeletes]);

  const byMailbox = new Map(list.map(mailbox => [mailbox.address, {
    inboxDeletedCount: inboxCounts.get(mailbox.id) || 0,
    sentDeletedCount: sentCounts.get(mailbox.address) || 0,
    mailboxDeleted: true
  }]));
  return { byMailbox, ownerUserIds: [...ownerUserIds] };
}
