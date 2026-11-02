// ARN Digital backend for Cloudflare Pages Functions.
// Needs: KV binding named DB, and secret ADMIN_PASSWORD.
const enc = new TextEncoder();
const DEFAULT_SITES = [
  { title: "QUIKO", url: "https://quiko.pages.dev/", desc: "", img: "" },
  { title: "AAVNI DENTAL CLINIC", url: "https://abiram2427.github.io/AAVNI-DENTAL-CLINIC/", desc: "", img: "" },
  { title: "YUM YUM TREE", url: "https://yumyumtree.pages.dev/", desc: "", img: "" }
];
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });

async function same(a, b) {
  const [x, y] = await Promise.all([a || "", b || ""].map(s => crypto.subtle.digest("SHA-256", enc.encode(s))));
  const u = new Uint8Array(x), v = new Uint8Array(y);
  let d = 0;
  for (let i = 0; i < u.length; i++) d |= u[i] ^ v[i];
  return d === 0;
}
async function getStats(kv) {
  const s = JSON.parse((await kv.get("stats")) || "null");
  return s || { visits: 0, visitLog: [], wrong: [] };
}

export async function onRequest({ request, env }) {
  if (!env.DB || !env.ADMIN_PASSWORD) return J({ error: "Server not configured: add KV binding DB and secret ADMIN_PASSWORD" }, 500);
  const path = new URL(request.url).pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
  const m = request.method, kv = env.DB;
  const isAdmin = async () => same(request.headers.get("x-admin"), env.ADMIN_PASSWORD);

  if (path === "sites" && m === "GET") {
    return J({ sites: JSON.parse((await kv.get("sites")) || JSON.stringify(DEFAULT_SITES)) });
  }
  if (path === "visit" && m === "POST") {
    const s = await getStats(kv);
    s.visits++;
    s.visitLog.unshift(Date.now());
    s.visitLog = s.visitLog.slice(0, 50);
    await kv.put("stats", JSON.stringify(s));
    return J({ ok: true });
  }
  if (path === "login" && m === "POST") {
    let body = {};
    try { body = await request.json(); } catch (e) {}
    const s = await getStats(kv);
    const recent = s.wrong.filter(t => Date.now() - t.t < 60000).length;
    if (recent >= 10) return J({ error: "Too many attempts. Wait a minute." }, 429);
    if (await same(String(body.password || ""), env.ADMIN_PASSWORD)) return J({ ok: true });
    s.wrong.unshift({ t: Date.now(), country: (request.cf && request.cf.country) || "" });
    s.wrong = s.wrong.slice(0, 30);
    await kv.put("stats", JSON.stringify(s));
    return J({ error: "Incorrect password" }, 401);
  }
  if (path === "stats" && m === "GET") {
    if (!(await isAdmin())) return J({ error: "Unauthorized" }, 401);
    return J(await getStats(kv));
  }
  if (path === "sites" && m === "POST") {
    if (!(await isAdmin())) return J({ error: "Unauthorized" }, 401);
    let body = {};
    try { body = await request.json(); } catch (e) { return J({ error: "Bad request" }, 400); }
    const list = body.sites;
    if (!Array.isArray(list) || list.length > 50) return J({ error: "Invalid list" }, 400);
    const clean = [];
    for (const x of list) {
      if (!x || typeof x.title !== "string" || typeof x.url !== "string" || !/^https?:\/\//i.test(x.url)) return J({ error: "Invalid site" }, 400);
      clean.push({ title: x.title.slice(0, 80), url: x.url.slice(0, 500), desc: String(x.desc || "").slice(0, 300), img: "" });
    }
    await kv.put("sites", JSON.stringify(clean));
    return J({ ok: true });
  }
  return J({ error: "Not found" }, 404);
}
