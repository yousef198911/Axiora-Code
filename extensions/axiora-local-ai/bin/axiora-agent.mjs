#!/usr/bin/env node
// Axiora headless CLI agent — same local model config as the editor, no UI needed.
// Usage:
//   axiora-agent "question about this repo"            ask with repo file list as context
//   axiora-agent --diff "review my changes"              include `git diff HEAD`
//   axiora-agent --files a.ts b.ts "explain"             include files
//   axiora-agent --edit src/x.ts "add input validation"  rewrite a file in place (backup .orig)
//   cat log.txt | axiora-agent "why does this fail?"     stdin is included
// Config: AXIORA_BASE_URL / AXIORA_PROVIDER (ollama|openai) / AXIORA_MODEL / AXIORA_API_KEY,
// else read from the editor's settings.json (axiora.ai.*).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

function settings() {
	const dirs = [process.env.AXIORA_USER_DATA, path.join(os.homedir(), '.config', 'Axiora Code'), path.join(os.homedir(), '.config', 'Axiora Code - OSS'), path.join(os.homedir(), 'Library', 'Application Support', 'Axiora Code'), process.env.APPDATA && path.join(process.env.APPDATA, 'Axiora Code')].filter(Boolean);
	for (const d of dirs) { try { return JSON.parse(fs.readFileSync(path.join(d, 'User', 'settings.json'), 'utf8').replace(/^\s*\/\/.*$/gm, '')); } catch { /* next */ } }
	return {};
}
const s = settings();
const provider = process.env.AXIORA_PROVIDER ?? s['axiora.ai.provider'] ?? 'ollama';
const baseUrl = (process.env.AXIORA_BASE_URL ?? s['axiora.ai.baseUrl'] ?? 'http://127.0.0.1:11434').replace(/\/+$/, '');
const model = process.env.AXIORA_MODEL ?? s['axiora.ai.chatModel'] ?? 'qwen2.5-coder:0.5b';
const key = process.env.AXIORA_API_KEY ?? '';
const args = process.argv.slice(2); const opt = { files: [], diff: false, edit: '' }; const rest = [];
for (let i = 0; i < args.length; i++) { const a = args[i]; if (a === '--diff') { opt.diff = true; } else if (a === '--edit') { opt.edit = args[++i]; } else if (a === '--files') { while (args[i + 1] && !args[i + 1].startsWith('--') && fs.existsSync(args[i + 1])) { opt.files.push(args[++i]); } } else if (a === '-h' || a === '--help') { console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 12).map(l => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(0); } else { rest.push(a); } }
let prompt = rest.join(' ');
let stdinText = '';
try { const st = fs.fstatSync(0); if (!process.stdin.isTTY && (st.isFIFO() || st.isFile())) { const inp = fs.readFileSync(0, 'utf8'); stdinText = inp.slice(0, 40000); } } catch { /* no stdin */ }
if (!prompt && stdinText) { prompt = stdinText; stdinText = ''; }
if (!prompt) { console.error('axiora-agent: give a prompt (see --help)'); process.exit(2); }
const sh = (c, a) => { try { return execFileSync(c, a, { encoding: 'utf8', maxBuffer: 32 << 20 }); } catch { return ''; } };
let ctx = '';
const ls = sh('git', ['ls-files']); if (ls) { ctx += `\nRepository files:\n${ls.split('\n').slice(0, 300).join('\n')}`; }
if (opt.diff) { ctx += `\n\nGit diff:\n${sh('git', ['diff', 'HEAD']).slice(0, 40000)}`; }
for (const f of opt.files) { ctx += `\n\n--- ${f}\n${fs.readFileSync(f, 'utf8').slice(0, 20000)}`; }
if (stdinText) { ctx += `\n\nInput:\n${stdinText}`; }
let user = prompt + ctx;
const sys = 'You are Axiora, a precise senior software engineer working headless in a terminal. Be concise.';
if (opt.edit) { user = `Rewrite this file applying: ${prompt}\nOutput ONLY the full new file content, no fences.\n\n--- ${opt.edit}\n${fs.readFileSync(opt.edit, 'utf8')}`; }
const url = provider === 'ollama' ? `${baseUrl}/api/chat` : `${baseUrl}/chat/completions`;
const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify({ model, stream: true, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }] }) }).catch(e => { console.error(`axiora-agent: cannot reach ${baseUrl}: ${e.message}`); process.exit(1); });
if (!r.ok) { console.error(`axiora-agent: ${r.status} ${await r.text()}`); process.exit(1); }
let buf = '', full = ''; const dec = new TextDecoder();
for await (const part of r.body) {
	buf += dec.decode(part, { stream: true }); let i;
	while ((i = buf.indexOf('\n')) >= 0) { let l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (l.startsWith('data:')) { l = l.slice(5).trim(); } if (!l || l === '[DONE]') { continue; } try { const j = JSON.parse(l); const t = provider === 'ollama' ? j.message?.content ?? '' : j.choices?.[0]?.delta?.content ?? ''; if (t) { full += t; if (!opt.edit) { process.stdout.write(t); } } } catch { /* partial */ } }
}
if (opt.edit) { fs.copyFileSync(opt.edit, opt.edit + '.orig'); fs.writeFileSync(opt.edit, full.replace(/^```\w*\n|```\s*$/g, '')); console.log(`axiora-agent: updated ${opt.edit} (backup ${opt.edit}.orig)`); } else { process.stdout.write('\n'); }
