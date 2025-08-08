export async function initDatabase(db) {
  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS emails (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mailbox TEXT NOT NULL,
        sender TEXT NOT NULL,
        subject TEXT NOT NULL,
        content TEXT NOT NULL,
        html_content TEXT,
        received_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_read INTEGER DEFAULT 0
      );
      
      CREATE INDEX IF NOT EXISTS idx_mailbox ON emails(mailbox);
      CREATE INDEX IF NOT EXISTS idx_received_at ON emails(received_at DESC);
    `);
  } catch (error) {
    console.error('Database initialization error:', error);
  }
}

