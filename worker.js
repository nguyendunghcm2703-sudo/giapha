/* Worker cho app Gia phả.
 * - Mật khẩu là 2 SECRET đặt trong Cloudflare (không nằm trong code hay repo):
 *     VIEW_PASSWORD = mật khẩu để XEM gia phả
 *     EDIT_PASSWORD = mật khẩu để SỬA gia phả (cũng xem được)
 * - Dữ liệu gia phả nằm trong KV (binding GP_KV), khoá "tree".
 * - Các đường dẫn /api/* do Worker xử lý; mọi đường dẫn khác trả về file tĩnh của app (binding ASSETS).
 * Mật khẩu gửi qua header X-Password (không đưa lên URL). */

const enc = new TextEncoder();
const MAX_BODY = 2 * 1024 * 1024;   // 2 MB
const MAX_PEOPLE = 5000;
const FAIL_LIMIT = 8;               // sai quá số lần này trong 10 phút thì tạm khoá theo địa chỉ IP
const FAIL_WINDOW = 600;

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });

// So sánh không lộ độ dài hay vị trí ký tự khác nhau (so băm SHA-256 của hai chuỗi)
async function same(a, b) {
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b))
  ]);
  const x = new Uint8Array(ha), y = new Uint8Array(hb);
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Trả về { role: 'edit' | 'view' } hoặc { error: Response }
async function authenticate(request, env) {
  if (!env.VIEW_PASSWORD || !env.EDIT_PASSWORD) return { error: json({ error: 'config' }, 503) };
  if (!env.GP_KV) return { error: json({ error: 'kv' }, 503) };
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const failKey = 'fail:' + ip;
  let fails = 0;
  try { fails = parseInt((await env.GP_KV.get(failKey)) || '0', 10) || 0; } catch (e) { /* bỏ qua */ }
  if (fails >= FAIL_LIMIT) return { error: json({ error: 'locked' }, 429) };

  let pw = request.headers.get('X-Password') || '';
  try { pw = decodeURIComponent(pw); } catch (e) { /* giữ nguyên */ }
  if (pw && (await same(pw, env.EDIT_PASSWORD))) return { role: 'edit' };
  if (pw && (await same(pw, env.VIEW_PASSWORD))) return { role: 'view' };

  await sleep(400); // làm chậm việc đoán mật khẩu
  try { await env.GP_KV.put(failKey, String(fails + 1), { expirationTtl: FAIL_WINDOW }); } catch (e) { /* hết hạn mức ghi: bỏ qua */ }
  return { error: json({ error: 'password' }, 401) };
}

const emptyTree = () => ({ roots: [], people: [] });
async function load(env) {
  const raw = await env.GP_KV.get('tree');
  if (!raw) return { version: 0, updatedAt: 0, tree: emptyTree() };
  try { return JSON.parse(raw); } catch (e) { return { version: 0, updatedAt: 0, tree: emptyTree() }; }
}

function validTree(t) {
  return t && Array.isArray(t.roots) && Array.isArray(t.people) && t.people.length <= MAX_PEOPLE && t.roots.length <= 200;
}

async function handleApi(request, env, url) {
  const path = url.pathname;
  if (path !== '/api/tree' && path !== '/api/auth') return json({ error: 'not_found' }, 404);
  const auth = await authenticate(request, env);
  if (auth.error) return auth.error;

  if (path === '/api/auth') {
    if (request.method !== 'POST') return json({ error: 'method' }, 405);
    return json({ role: auth.role });
  }

  if (request.method === 'GET') {
    const cur = await load(env);
    if (url.searchParams.get('v') === String(cur.version)) return json({ version: cur.version, role: auth.role, unchanged: true });
    return json({ version: cur.version, role: auth.role, updatedAt: cur.updatedAt, tree: cur.tree });
  }

  if (request.method === 'PUT') {
    if (auth.role !== 'edit') return json({ error: 'forbidden' }, 403);
    const len = parseInt(request.headers.get('content-length') || '0', 10);
    if (len > MAX_BODY) return json({ error: 'too_big' }, 413);
    let body;
    try { body = await request.json(); } catch (e) { return json({ error: 'bad_json' }, 400); }
    if (!body || !validTree(body.tree) || !Number.isInteger(body.base)) return json({ error: 'bad_data' }, 400);
    const cur = await load(env);
    if (cur.version !== body.base) return json({ error: 'conflict', version: cur.version, tree: cur.tree }, 409);
    const next = { version: cur.version + 1, updatedAt: Date.now(), tree: body.tree };
    await env.GP_KV.put('tree', JSON.stringify(next));
    return json({ version: next.version, updatedAt: next.updatedAt });
  }
  return json({ error: 'method' }, 405);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try { return await handleApi(request, env, url); } catch (e) { return json({ error: 'server' }, 500); }
    }
    return env.ASSETS.fetch(request);
  }
};
