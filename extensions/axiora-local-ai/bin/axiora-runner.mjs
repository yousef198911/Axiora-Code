#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Axiora self-hosted agent runner — run this on YOUR OWN machine / VM / server (no paid
 *  services). The editor sends tasks (git bundle of your branch + uncommitted changes, prompt,
 *  chat history, environment template); the runner works in an isolated per-task workspace,
 *  runs the environment setup, an autonomous write→test→fix loop against your own model
 *  endpoint, and returns a patch the editor can apply.
 *
 *  AXIORA_RUNNER_TOKEN=secret AXIORA_BASE_URL=http://127.0.0.1:11434 AXIORA_MODEL=qwen2.5-coder \
 *    node axiora-runner.mjs --port 7788 [--name my-box] [--dir /var/lib/axiora-runner]
 *
 *  Endpoints (Bearer token): GET /health · POST /tasks · GET /tasks · GET /tasks/:id
 *  POST /prebuild {bundle, branch, setup} · POST /webhook/github (issue comments with "@axiora")
 *  POST /rum (no auth, from your site's RUM snippet) · GET /rum · GET /dashboard (mobile web UI)
 *--------------------------------------------------------------------------------------------*/
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const PORT = +arg('--port', process.env.AXIORA_RUNNER_PORT || 7788), NAME = arg('--name', os.hostname());
const ROOT = arg('--dir', path.join(os.tmpdir(), 'axiora-runner')); fs.mkdirSync(ROOT, { recursive: true });
const TOKEN = process.env.AXIORA_RUNNER_TOKEN || '';
if (!TOKEN) { console.error('Set AXIORA_RUNNER_TOKEN'); process.exit(1); }
const BASE = process.env.AXIORA_BASE_URL || 'http://127.0.0.1:11434', MODEL = process.env.AXIORA_MODEL || 'qwen2.5-coder', PROVIDER = process.env.AXIORA_PROVIDER || 'ollama';
const CAP = +(process.env.AXIORA_RUNNER_CAPACITY || 2);
const tasks = new Map(); const rum = []; const prebuilds = new Map();
const sh = (cmd, args, cwd, input) => new Promise(res => { const p = execFile(cmd, args, { cwd, maxBuffer: 64 << 20, timeout: 15 * 60_000 }, (e, so, se) => res({ ok: !e, out: `${so}${se}` })); if (input) { p.stdin.end(input); } });
async function ask(messages) {
	const url = PROVIDER === 'ollama' ? `${BASE}/api/chat` : `${BASE}/chat/completions`;
	const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...(process.env.AXIORA_API_KEY ? { authorization: `Bearer ${process.env.AXIORA_API_KEY}` } : {}) }, body: JSON.stringify({ model: MODEL, messages, stream: false }) });
	// accept JSON or streamed NDJSON / SSE from servers that ignore stream:false
	let out = ''; for (let l of (await r.text()).split('\n')) { l = l.trim().replace(/^data:\s*/, ''); if (!l || l === '[DONE]') { continue; } try { const j = JSON.parse(l); out += PROVIDER === 'ollama' ? j.message?.content ?? '' : j.choices?.[0]?.message?.content ?? j.choices?.[0]?.delta?.content ?? ''; } catch { /* */ } }
	return out;
}
const files = s => [...s.matchAll(/<<<FILE\s+([^>\n]+?)>>>\n([\s\S]*?)\n?<<<END>>>/g)].map(m => ({ file: m[1].trim(), body: m[2] }));
async function checkout(t, dir) {
	const key = `${t.repoKey}|${t.branch}`;
	if (prebuilds.has(key) && fs.existsSync(prebuilds.get(key))) { t.log.push(`using prebuild ${key}`); fs.cpSync(prebuilds.get(key), dir, { recursive: true }); }
	if (t.bundle) { const b = path.join(dir + '.bundle'); fs.writeFileSync(b, Buffer.from(t.bundle, 'base64')); if (!fs.existsSync(path.join(dir, '.git'))) { await sh('git', ['clone', '-q', b, dir], ROOT); } else { await sh('git', ['fetch', '-q', b, 'refs/axiora/handoff:refs/axiora/handoff'], dir); } const r = await sh('git', ['checkout', '-q', '-B', 'axiora-task', 'refs/axiora/handoff'], dir); if (!r.ok) { await sh('git', ['fetch', '-q', b, 'refs/axiora/handoff:refs/axiora/handoff'], dir); await sh('git', ['checkout', '-q', '-B', 'axiora-task', 'refs/axiora/handoff'], dir); } }
	else if (t.repo) { await sh('git', ['clone', '-q', '--depth', '50', ...(t.branch ? ['-b', t.branch] : []), t.repo, dir], ROOT); }
	else { fs.mkdirSync(dir, { recursive: true }); await sh('git', ['init', '-q'], dir); }
}
async function runTask(t) {
	const dir = path.join(ROOT, t.id); t.state = 'running'; t.dir = dir;
	try {
		await checkout(t, dir); t.log.push('workspace ready');
		for (const c of t.env?.setup ?? []) { const r = await sh('bash', ['-lc', c], dir); t.log.push(`$ ${c} → ${r.ok ? 'ok' : 'failed'}`); }
		const test = t.test || t.env?.test || '';
		let feedback = ''; const listing = (await sh('git', ['ls-files'], dir)).out.split('\n').slice(0, 300).join('\n');
		for (let i = 1; i <= (t.maxIterations || 4); i++) {
			const reply = await ask([{ role: 'system', content: 'You are Axiora running autonomously on a self-hosted runner. Output complete files ONLY as blocks:\n<<<FILE relative/path>>>\n<full content>\n<<<END>>>\nThen "DONE" when the goal is met.' }, ...(t.history ?? []), { role: 'user', content: `Goal: ${t.prompt}\n\nFiles:\n${listing}${feedback ? `\n\nLast verification failed:\n${feedback}` : ''}` }]);
			const fsx = files(reply);
			for (const f of fsx) { const p = path.resolve(dir, f.file); if (!p.startsWith(dir + path.sep)) { continue; } fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, f.body); }
			t.log.push(`iteration ${i}: ${fsx.length} file(s)`); t.summary = reply.replace(/<<<FILE[\s\S]*?<<<END>>>/g, '').trim().slice(0, 2000);
			if (!test) { break; }
			const r = await sh('bash', ['-lc', `${test} 2>&1`], dir); t.log.push(`verify: ${r.ok ? 'passed' : 'failed'}`);
			if (r.ok || !fsx.length) { break; } feedback = r.out.slice(-3000);
		}
		await sh('git', ['add', '-A'], dir); t.patch = (await sh('git', ['diff', '--cached', '--binary'], dir)).out; t.state = 'done';
		if (t.reply) { await t.reply(t); }
	} catch (e) { t.state = 'failed'; t.log.push(String(e?.message ?? e)); }
}
function pump() { const running = [...tasks.values()].filter(t => t.state === 'running').length; for (const t of tasks.values()) { if (running >= CAP) { break; } if (t.state === 'queued') { void runTask(t).then(pump); return pump(); } } }
function enqueue(b) { const t = { id: crypto.randomUUID().slice(0, 8), state: 'queued', created: new Date().toISOString(), log: [], ...b, repoKey: b.repoKey || b.repo || 'bundle' }; tasks.set(t.id, t); pump(); return t; }
const pub = t => ({ id: t.id, state: t.state, prompt: t.prompt, created: t.created, log: t.log, summary: t.summary, source: t.source || 'editor', patch: t.patch });
const body = req => new Promise(r => { let s = ''; req.on('data', d => s += d); req.on('end', () => { try { r(JSON.parse(s || '{}')); } catch { r({}); } }); });
http.createServer(async (req, res) => {
	const json = (c, o) => { res.writeHead(c, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(o)); };
	const u = new URL(req.url, 'http://x');
	if (u.pathname === '/rum' && req.method === 'POST') { const b = await body(req); rum.push({ ...b, at: new Date().toISOString() }); if (rum.length > 5000) { rum.shift(); } return json(204, {}); }
	if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type' }); return res.end(); }
	if (u.pathname === '/webhook/github' && req.method === 'POST') {
		const raw = await new Promise(r => { let s = ''; req.on('data', d => s += d); req.on('end', () => r(s)); });
		const secret = process.env.AXIORA_WEBHOOK_SECRET; if (secret) { const sig = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex'); if (req.headers['x-hub-signature-256'] !== sig) { return json(401, { error: 'bad signature' }); } }
		const b = JSON.parse(raw || '{}'); const text = b.comment?.body ?? '';
		if (!/@axiora\b/i.test(text)) { return json(200, { ignored: true }); }
		const t = enqueue({ prompt: `${b.issue?.title ?? ''}\n${b.issue?.body ?? ''}\n\nRequest: ${text.replace(/@axiora/ig, '').trim()}`, repo: b.repository?.clone_url, source: `github:${b.repository?.full_name}#${b.issue?.number}`,
			reply: async t => { const gh = process.env.GITHUB_TOKEN; if (!gh || !b.issue?.comments_url) { return; } await fetch(b.issue.comments_url, { method: 'POST', headers: { authorization: `Bearer ${gh}`, 'content-type': 'application/json' }, body: JSON.stringify({ body: `**Axiora** finished (${t.state}).\n\n${t.summary ?? ''}\n\n<details><summary>patch</summary>\n\n\`\`\`diff\n${(t.patch ?? '').slice(0, 60000)}\n\`\`\`\n</details>` }) }); } });
		return json(202, { task: t.id });
	}
	if (u.pathname === '/dashboard') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(`<!doctype html><meta name=viewport content="width=device-width"><title>Axiora runner ${NAME}</title><style>body{font-family:system-ui;margin:12px;background:#111;color:#eee}.t{border:1px solid #333;border-radius:8px;padding:10px;margin:8px 0}small{opacity:.6}</style><h3>Axiora runner · ${NAME}</h3><input id=k placeholder="token" type=password style="width:100%;padding:8px"><div id=l></div><script>const k=document.getElementById('k');k.value=localStorage.t||'';async function f(){localStorage.t=k.value;const r=await fetch('/tasks',{headers:{authorization:'Bearer '+k.value}});if(!r.ok)return;const j=await r.json();document.getElementById('l').innerHTML=j.map(t=>'<div class=t><b>'+t.state+'</b> '+t.prompt.replace(/</g,'&lt;').slice(0,140)+'<br><small>'+t.id+' · '+t.source+' · '+t.created+'</small></div>').join('')}setInterval(f,3000);f()</script>`); }
	if (req.headers.authorization !== `Bearer ${TOKEN}`) { return json(401, { error: 'unauthorized' }); }
	if (u.pathname === '/health') { return json(200, { name: NAME, os: `${os.platform()} ${os.release()}`, cpus: os.cpus().length, capacity: CAP, running: [...tasks.values()].filter(t => t.state === 'running').length, queued: [...tasks.values()].filter(t => t.state === 'queued').length, prebuilds: [...prebuilds.keys()] }); }
	if (u.pathname === '/tasks' && req.method === 'POST') { const b = await body(req); if (!b.prompt) { return json(400, { error: 'prompt required' }); } return json(202, pub(enqueue({ ...b, source: b.source || 'editor' }))); }
	if (u.pathname === '/tasks') { return json(200, [...tasks.values()].reverse().map(t => ({ ...pub(t), patch: undefined, hasPatch: !!t.patch }))); }
	const m = /^\/tasks\/(\w+)$/.exec(u.pathname); if (m) { const t = tasks.get(m[1]); return t ? json(200, pub(t)) : json(404, { error: 'not found' }); }
	if (u.pathname === '/prebuild' && req.method === 'POST') { const b = await body(req); const key = `${b.repoKey || 'bundle'}|${b.branch || ''}`; const dir = path.join(ROOT, 'prebuild-' + crypto.createHash('sha1').update(key).digest('hex').slice(0, 10)); fs.rmSync(dir, { recursive: true, force: true }); const t = { log: [], ...b }; await checkout(t, dir); for (const c of b.setup ?? []) { await sh('bash', ['-lc', c], dir); } prebuilds.set(key, dir); return json(200, { prebuilt: key }); }
	if (u.pathname === '/rum') { const by = {}; for (const r of rum) { for (const k of ['lcp', 'fcp', 'cls', 'inp', 'ttfb']) { if (typeof r[k] === 'number') { (by[k] ??= []).push(r[k]); } } } const p = (a, q) => a.sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * q))]; return json(200, { samples: rum.length, pages: [...new Set(rum.map(r => r.page))].slice(0, 50), metrics: Object.fromEntries(Object.entries(by).map(([k, a]) => [k, { p50: p(a, .5), p75: p(a, .75), p95: p(a, .95), n: a.length }])) }); }
	json(404, { error: 'not found' });
}).listen(PORT, process.env.AXIORA_RUNNER_HOST || '0.0.0.0', () => console.log(`Axiora runner "${NAME}" on :${PORT} (workspaces in ${ROOT}, model ${MODEL} @ ${BASE})`));
