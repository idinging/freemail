/**
 * 数据库连接辅助模块
 * @module db/connection
 */

import { initDatabase } from './init.js';

/**
 * 获取数据库连接并验证有效性
 * @param {object} env - 环境变量对象
 * @returns {Promise<object>} 数据库连接对象
 * @throws {Error} 当数据库未配置或连接失败时抛出异常
 */
export async function getDatabaseWithValidation(env) {
  const db = env.TEMP_MAIL_DB;
  
  if (!db) {
    throw new Error('数据库未配置，请检查 wrangler.toml 中的 [[d1_databases]] 绑定');
  }
  
  // 验证数据库连接
  try {
    await db.prepare('SELECT 1').all();
  } catch (error) {
    throw new Error(`数据库连接失败: ${error.message}`);
  }
  
  return db;
}

/**
 * 获取数据库连接并初始化
 * @param {object} env - 环境变量对象
 * @returns {Promise<object>} 初始化后的数据库连接对象
 */
export async function getInitializedDatabase(env) {
  const db = await getDatabaseWithValidation(env);
  
  // 缓存数据库初始化，避免每次请求重复执行
  if (!globalThis.__DB_INITED__) {
    await initDatabase(db);
    globalThis.__DB_INITED__ = true;
  }
  
  return db;
}
