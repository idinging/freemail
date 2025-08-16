// 存储与缓存相关的通用工具（按用户隔离）

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
	try{
		localStorage.setItem(cacheKeyFor(key), JSON.stringify({ ts: Date.now(), data }));
	}catch(_){ }
}

export function cacheGet(key, maxAgeMs){
	try{
		const raw = localStorage.getItem(cacheKeyFor(key));
		if (!raw) return null;
		const obj = JSON.parse(raw);
		if (!obj || typeof obj !== 'object') return null;
		if (typeof obj.ts !== 'number') return obj.data ?? null;
		if (typeof maxAgeMs === 'number' && maxAgeMs >= 0 && (Date.now() - obj.ts > maxAgeMs)) return null;
		return obj.data ?? null;
	}catch(_){ return null; }
}

// 读取登录阶段预取的数据（sessionStorage），带简单有效期
export function readPrefetch(key, maxAgeMs = 20000){
	try{
		const raw = sessionStorage.getItem(key);
		if (!raw) return null;
		const obj = JSON.parse(raw);
		if (!obj || typeof obj !== 'object') return null;
		if (typeof obj.ts !== 'number') return obj.data ?? null;
		if (Date.now() - obj.ts > maxAgeMs) return null;
		return obj.data ?? null;
	}catch(_){ return null; }
}


