# D1 数据库行读取分析

## 为什么会有 400 万行读取？

即使用户不多，也可能产生大量行读取。以下是可能的原因：

### 1. **COUNT 查询扫描全表**

```sql
-- 这个查询会扫描整个 mailboxes 表
SELECT COUNT(1) AS count FROM mailboxes;
-- 如果有 10000 个邮箱，计费：10000 行读取
```

**项目中的 COUNT 查询**：
- `getTotalMailboxCount()` - 每次超级管理员查看配额时触发
- `getCachedUserQuota()` - 用户配额查询中的 COUNT
- `listUsersWithCounts()` - 子查询中的 COUNT(1)

**解决方案**：已添加缓存，但仍需注意

---

### 2. **JOIN 查询的行数叠加**

```sql
-- listUsersWithCounts 中的查询
SELECT u.*, COALESCE(cnt.c, 0) AS mailbox_count
FROM users u
LEFT JOIN (
  SELECT user_id, COUNT(1) AS c 
  FROM user_mailboxes 
  GROUP BY user_id
) cnt ON cnt.user_id = u.id;
```

**计费**：
- 扫描 users 表：假设 100 个用户
- 扫描 user_mailboxes 表：假设 5000 条记录
- 总计：5100 行读取（每次查询用户列表）

---

### 3. **频繁的初始化查询**

每次 Worker 冷启动或重启时都会执行：
- 多次 `PRAGMA table_info()` - 每次扫描表的列定义
- `SELECT name FROM sqlite_master` - 扫描系统表
- 表结构检查和迁移

**估算**：
- 如果 Worker 每天重启 50 次
- 每次初始化产生约 200 行读取
- 每天：10,000 行读取

---

### 4. **没有 LIMIT 或 LIMIT 过大的查询**

优化前的查询：
```sql
-- 每次查询 50 封邮件
SELECT * FROM messages WHERE mailbox_id = ? ORDER BY received_at DESC LIMIT 50;
```

如果有 100 个活跃用户，每天查看 10 次邮件：
- 100 用户 × 10 次 × 50 行 = 50,000 行/天

---

### 5. **索引扫描也计入行读取**

即使使用了索引，扫描的索引行也会计入：

```sql
-- 即使有索引，仍会扫描匹配的所有行
SELECT * FROM messages WHERE mailbox_id = 123 ORDER BY received_at DESC;
-- 如果该邮箱有 1000 封邮件，计费：1000 行读取
```

---

### 6. **批量操作的累积效应**

```sql
-- 批量切换邮箱登录权限（优化前）
-- 100 个邮箱 = 100 次查询 × 平均扫描行数
```

---

## 实际案例估算

假设你的项目有以下数据量：
- 邮箱数：10,000 个
- 邮件数：100,000 封
- 用户数：50 个
- 每日活跃用户：10 人

### 每日行读取估算：

| 操作 | 频率 | 单次读取 | 每日总计 |
|------|------|----------|----------|
| Worker 初始化 | 50 次 | 200 行 | 10,000 |
| 查看邮件列表 | 10 用户 × 20 次 | 20 行 | 4,000 |
| 查看邮件详情 | 10 用户 × 50 次 | 1 行 | 500 |
| 管理员查看用户列表 | 5 次 | 5,050 行 | 25,250 |
| 超管查看配额（COUNT） | 10 次 | 10,000 行 | 100,000 |
| 接收新邮件 | 200 封 | 5 行 | 1,000 |
| 用户配额查询 | 100 次 | 100 行 | 10,000 |
| **每日总计** | - | - | **~150,750 行** |

**一个月**：150,750 × 30 = **4,522,500 行**（452 万行）

---

## 高行读取的主要原因

### 🔴 1. 超管查看配额时的 COUNT 全表扫描
```javascript
// getTotalMailboxCount() - 每次扫描所有邮箱
SELECT COUNT(1) AS count FROM mailboxes;
// 10,000 个邮箱 = 10,000 行读取
```

### 🔴 2. 管理员频繁查看用户列表
```javascript
// listUsersWithCounts() - 包含 JOIN 和子查询
// 每次查询扫描 users + user_mailboxes 的所有行
```

### 🔴 3. Worker 频繁冷启动
- 每次冷启动都要检查表结构
- PRAGMA 查询虽然已缓存，但 Worker 重启后缓存丢失

### 🔴 4. 没有合理的分页和缓存
- 某些列表查询可能返回过多数据
- 缓存失效后重复查询

---

## 进一步优化建议

### 1. **缓存 COUNT 结果**
```javascript
// 缓存邮箱总数，10分钟刷新一次
let cachedMailboxCount = null;
let cachedMailboxCountTime = 0;

export async function getTotalMailboxCount(db) {
  const now = Date.now();
  if (cachedMailboxCount !== null && now - cachedMailboxCountTime < 600000) {
    return cachedMailboxCount;
  }
  
  const result = await db.prepare('SELECT COUNT(1) AS count FROM mailboxes').all();
  cachedMailboxCount = result?.results?.[0]?.count || 0;
  cachedMailboxCountTime = now;
  return cachedMailboxCount;
}
```

### 2. **优化用户列表查询**
```javascript
// 只在需要时才计算邮箱数量，而不是每次都 JOIN
// 或者使用缓存的统计数据
```

### 3. **使用 Cloudflare Durable Objects 存储统计数据**
- 将 COUNT 等统计数据存储在 DO 中
- 异步更新，不影响主流程
- 大幅减少 COUNT 查询

### 4. **添加请求去重**
- 同一个请求在短时间内不重复执行
- 使用 Request ID 或 Hash 作为缓存 Key

### 5. **监控和日志**
```javascript
// 添加查询监控
const queryStats = {
  totalQueries: 0,
  estimatedRows: 0
};

// 记录每次查询
function logQuery(query, estimatedRows) {
  queryStats.totalQueries++;
  queryStats.estimatedRows += estimatedRows;
}
```

---

## Cloudflare D1 免费配额

- **每日行读取**：500 万行
- **每日行写入**：10 万行
- **存储空间**：5 GB

如果超出配额：
- Worker 会返回错误
- 需要升级到付费计划

---

## 总结

400 万行读取主要来自：
1. ✅ **COUNT 查询**（已部分缓存）
2. ✅ **JOIN 查询**（需进一步优化）
3. ✅ **频繁的初始化**（已优化表结构缓存）
4. ✅ **没有合理的 LIMIT**（已优化）
5. ⚠️ **超管频繁查看配额**（需要添加更长的缓存）
6. ⚠️ **Worker 频繁重启**（考虑使用持久化缓存）

建议优先优化超管配额查询的缓存时间！

