// 存储与缓存相关的通用工具（按用户隔离）

// 内存后备存储：当 localStorage / sessionStorage 不可用或超配额时兜底
const __memLocal = new Map();
const __memSession = new Map();

let __currentUserKey = (function(){
	try {
		return localStorage.getItem('mf:lastUserKey') || 'unknown';
	} catch(_) {
		return 'unknown';
	}
})();

function cacheKeyFor(key){
	return `mf:cache:${__currentUserKey}:${key}`;
}

export function getCurrentUserKey(){
	return __currentUserKey;
}

export function setCurrentUserKey(key){
	__currentUserKey = key || 'unknown';
	try { localStorage.setItem('mf:lastUserKey', __currentUserKey); } catch(_) { }
}

export function cacheSet(key, data){
	const payload = JSON.stringify({ ts: Date.now(), data });
	try{
		localStorage.setItem(cacheKeyFor(key), payload);
	}catch(_){
		// 兜底写入内存
		__memLocal.set(cacheKeyFor(key), payload);
	}
}

export function cacheGet(key, maxAgeMs){
	let raw = null;
	try{ raw = localStorage.getItem(cacheKeyFor(key)); }catch(_){ }
	if (!raw){
		// 尝试内存后备
		raw = __memLocal.get(cacheKeyFor(key)) || null;
	}
	if (!raw) return null;
	try{
		const obj = JSON.parse(raw);
		if (!obj || typeof obj !== 'object') return null;
		if (typeof obj.ts !== 'number') return obj.data ?? null;
		if (typeof maxAgeMs === 'number' && maxAgeMs >= 0 && (Date.now() - obj.ts > maxAgeMs)) return null;
		return obj.data ?? null;
	}catch(_){ return null; }
}

// 读取登录阶段预取的数据（sessionStorage），带简单有效期
export function readPrefetch(key, maxAgeMs = 20000){
	let raw = null;
	try{ raw = sessionStorage.getItem(key); }catch(_){ }
	if (!raw){ raw = __memSession.get(key) || null; }
	if (!raw) return null;
	try{
		const obj = JSON.parse(raw);
		if (!obj || typeof obj !== 'object') return null;
		if (typeof obj.ts !== 'number') return obj.data ?? null;
		if (Date.now() - obj.ts > maxAgeMs) return null;
		return obj.data ?? null;
	}catch(_){ return null; }
}

// 预取阶段写入工具：与 readPrefetch 配套
export function writePrefetch(key, data){
	const payload = JSON.stringify({ ts: Date.now(), data });
	try{ sessionStorage.setItem(key, payload); }catch(_){ __memSession.set(key, payload); }
}

// 删除某个缓存键（当前用户）
export function cacheRemove(key){
	try{ localStorage.removeItem(cacheKeyFor(key)); }catch(_){ }
	__memLocal.delete(cacheKeyFor(key));
}

// 清理当前用户的所有缓存项
export function cacheClearForUser(){
	const prefix = `mf:cache:${__currentUserKey}:`;
	try{
		for (let i = localStorage.length - 1; i >= 0; i--) {
			const k = localStorage.key(i);
			if (k && k.indexOf(prefix) === 0) { localStorage.removeItem(k); }
		}
	}catch(_){ }
	// 同步清理内存后备
	for (const k of Array.from(__memLocal.keys())){
		if (k.indexOf(prefix) === 0) __memLocal.delete(k);
	}
}

// 清空预取会话数据（通常在登录完成或页面跳转后调用）
export function clearPrefetchKeys(keys = []){
	if (!Array.isArray(keys) || !keys.length) return;
	for (const k of keys){
		try{ sessionStorage.removeItem(k); }catch(_){ }
		__memSession.delete(k);
	}
}

// 获取缓存并返回陈旧状态（供需要 SWR 的调用方使用）
export function cacheGetWithMeta(key, maxAgeMs){
	let raw = null;
	try{ raw = localStorage.getItem(cacheKeyFor(key)); }catch(_){ }
	if (!raw){ raw = __memLocal.get(cacheKeyFor(key)) || null; }
	if (!raw) return { data: null, isStale: true, ts: 0 };
	try{
		const obj = JSON.parse(raw);
		const ts = typeof obj.ts === 'number' ? obj.ts : 0;
		const data = obj.data ?? null;
		const isStale = (typeof maxAgeMs === 'number' && maxAgeMs >= 0) ? (Date.now() - ts > maxAgeMs) : false;
		return { data, isStale, ts };
	}catch(_){ return { data: null, isStale: true, ts: 0 }; }
}


