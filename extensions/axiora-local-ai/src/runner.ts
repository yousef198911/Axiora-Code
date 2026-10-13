/*---------------------------------------------------------------------------------------------
 *  Self-hosted agent runners (your own machines — no paid cloud). Pairs with
 *  bin/axiora-runner.mjs. Machines are listed in axiora.runner.machines [{name,url}], tokens
 *  live in SecretStorage.
 *  - Runner Machines: health/capacity of each host (remote agent hosts / self-hosted machines).
 *  - "/cloud <task>": run on a runner in an isolated per-task workspace (git bundle of HEAD +
 *    uncommitted changes); "/handoff [note]": hand the current chat + branch over to a runner.
 *  - Runner Tasks: status/log → Apply Patch Locally (hand back), mobile dashboard link.
 *  - Prebuild Branch on Runner; environment templates (.axiora/environment.json: setup, test)
 *    are applied by the runner and locally ("Apply Environment Template").
 *  - Real-user metrics: RUM snippet for your site → runner /rum → "Show Real-User Metrics".
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { chatCommands, register, wsRoot, run } from './util';

type M = { name: string; url: string };
const machines = () => vscode.workspace.getConfiguration('axiora.runner').get<M[]>('machines', []);
export async function bundleWorkspace(root: string): Promise<string> {
	let sha = (await run('git', ['stash', 'create', 'axiora handoff'], root)).trim();
	if (!sha) { sha = (await run('git', ['rev-parse', 'HEAD'], root)).trim(); }
	await run('git', ['update-ref', 'refs/axiora/handoff', sha], root);
	const f = path.join(os.tmpdir(), `axiora-${Date.now()}.bundle`);
	await run('git', ['bundle', 'create', '-q', f, 'refs/axiora/handoff'], root);
	const b = fs.readFileSync(f).toString('base64'); fs.rmSync(f, { force: true }); return b;
}
export function activate(ctx: vscode.ExtensionContext) {
	const tok = (m: M) => ctx.secrets.get(`axiora.runner.${m.name}`);
	const api = async (m: M, p: string, body?: unknown) => {
		const r = await fetch(m.url.replace(/\/$/, '') + p, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${await tok(m) ?? ''}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(body ? 120_000 : 8000) });
		if (!r.ok) { throw new Error(`${m.name}: HTTP ${r.status} ${await r.text()}`); } return r.status === 204 ? {} : r.json() as Promise<any>;
	};
	const env = async () => { const r = wsRoot(); if (!r) { return undefined; } try { return JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(r, '.axiora', 'environment.json')))); } catch { return undefined; } };
	const pick = async () => { const ms = machines(); if (!ms.length) { const a = await vscode.window.showInformationMessage('No runner machines configured.', 'Add Runner'); if (a) { await vscode.commands.executeCommand('axiora.runner.add'); } return undefined; } if (ms.length === 1) { return ms[0]; } return (await vscode.window.showQuickPick(ms.map(m => ({ label: m.name, description: m.url, m })), { placeHolder: 'Runner machine' }))?.m; };
	const submit = async (m: M, prompt: string, history: { role: string; content: string }[] = []) => {
		const r = wsRoot(); const e = await env();
		const bundle = r ? await bundleWorkspace(r.fsPath).catch(() => undefined) : undefined;
		const branch = r ? (await run('git', ['branch', '--show-current'], r.fsPath).catch(() => '')).trim() : '';
		return api(m, '/tasks', { prompt, history, bundle, branch, repoKey: r ? path.basename(r.fsPath) : 'bundle', env: e, test: e?.test });
	};
	register(ctx, 'axiora.runner.add', async () => {
		const name = await vscode.window.showInputBox({ prompt: 'Runner name', value: 'my-server' }); if (!name) { return; }
		const url = await vscode.window.showInputBox({ prompt: 'Runner URL (your own machine running bin/axiora-runner.mjs)', value: 'http://127.0.0.1:7788' }); if (!url) { return; }
		const t = await vscode.window.showInputBox({ prompt: 'Runner token (AXIORA_RUNNER_TOKEN)', password: true }); if (t === undefined) { return; }
		await ctx.secrets.store(`axiora.runner.${name}`, t);
		await vscode.workspace.getConfiguration('axiora.runner').update('machines', [...machines().filter(m => m.name !== name), { name, url }], vscode.ConfigurationTarget.Global);
		vscode.window.showInformationMessage(`Runner "${name}" added.`);
	});
	register(ctx, 'axiora.runner.machines', async () => {
		const ms = machines(); if (!ms.length) { await pick(); return; }
		const rows = await Promise.all(ms.map(async m => { try { const h = await api(m, '/health'); return { label: `$(vm-active) ${m.name}`, description: `${h.os} · ${h.cpus} CPU · ${h.running}/${h.capacity} running, ${h.queued} queued`, detail: `${m.url}${h.prebuilds?.length ? ` · prebuilds: ${h.prebuilds.join(', ')}` : ''}`, m }; } catch (e) { return { label: `$(vm-outline) ${m.name}`, description: 'offline', detail: (e as Error).message, m }; } }));
		const p = await vscode.window.showQuickPick(rows, { placeHolder: 'Runner machines (self-hosted agent hosts)' });
		if (p) { const a = await vscode.window.showQuickPick(['Send Task...', 'Show Tasks', 'Open Mobile Dashboard', 'Prebuild Current Branch', 'Remove'], { placeHolder: p.m.name }); if (a === 'Send Task...') { await vscode.commands.executeCommand('axiora.runner.send', p.m); } else if (a === 'Show Tasks') { await vscode.commands.executeCommand('axiora.runner.tasks', p.m); } else if (a === 'Open Mobile Dashboard') { await vscode.env.openExternal(vscode.Uri.parse(p.m.url.replace(/\/$/, '') + '/dashboard')); } else if (a === 'Prebuild Current Branch') { await vscode.commands.executeCommand('axiora.runner.prebuild', p.m); } else if (a === 'Remove') { await vscode.workspace.getConfiguration('axiora.runner').update('machines', machines().filter(m => m.name !== p.m.name), vscode.ConfigurationTarget.Global); } }
	});
	register(ctx, 'axiora.runner.send', async (mm?: M) => { const m = mm ?? await pick(); if (!m) { return; } const p = await vscode.window.showInputBox({ prompt: `Task for runner "${m.name}"` }); if (!p) { return; } const t = await submit(m, p); vscode.window.showInformationMessage(`Task ${t.id} queued on ${m.name}.`, 'Show Tasks').then(a => a && vscode.commands.executeCommand('axiora.runner.tasks', m)); });
	chatCommands.set('cloud', async (req, stream) => {
		const m = machines()[0]; if (!m) { stream.markdown('No runner configured. **Axiora AI: Add Runner Machine...** then start `node bin/axiora-runner.mjs` on your own machine.'); stream.button({ command: 'axiora.runner.add', title: 'Add Runner' }); return; }
		stream.progress(`Sending to ${m.name}…`); const t = await submit(m, req.prompt);
		stream.markdown(`Queued **task ${t.id}** on runner **${m.name}** (isolated workspace with your branch + uncommitted changes). You can keep working.`); stream.button({ command: 'axiora.runner.tasks', title: 'Runner Tasks', arguments: [m] });
	});
	chatCommands.set('handoff', async (req, stream, _t, chatCtx) => {
		const m = machines()[0]; if (!m) { stream.markdown('No runner configured.'); stream.button({ command: 'axiora.runner.add', title: 'Add Runner' }); return; }
		const history = (chatCtx?.history ?? []).map(h => h instanceof vscode.ChatRequestTurn ? { role: 'user', content: h.prompt } : { role: 'assistant', content: (h as vscode.ChatResponseTurn).response.map(p => p instanceof vscode.ChatResponseMarkdownPart ? p.value.value : '').join('') });
		const t = await submit(m, req.prompt || 'Continue the work from this conversation and finish it.', history);
		stream.markdown(`Handed off this session (${history.length} turns + branch state) to **${m.name}** as task **${t.id}**. Bring the result back with **Apply Patch Locally**.`); stream.button({ command: 'axiora.runner.tasks', title: 'Runner Tasks', arguments: [m] });
	});
	register(ctx, 'axiora.runner.tasks', async (mm?: M) => {
		const m = mm ?? await pick(); if (!m) { return; }
		const ts = await api(m, '/tasks') as any[]; if (!ts.length) { vscode.window.showInformationMessage(`No tasks on ${m.name}.`); return; }
		const ic: Record<string, string> = { queued: '$(clock)', running: '$(sync~spin)', done: '$(pass)', failed: '$(error)' };
		const p = await vscode.window.showQuickPick(ts.map(t => ({ label: `${ic[t.state] ?? ''} ${t.id} ${t.prompt.split('\n')[0].slice(0, 70)}`, description: `${t.state} · ${t.source}`, detail: t.log.slice(-2).join(' · '), t })), { placeHolder: `Tasks on ${m.name}` });
		if (!p) { return; } const full = await api(m, `/tasks/${p.t.id}`);
		const acts = full.patch ? ['Apply Patch Locally', 'Show Patch', 'Show Log'] : ['Show Log'];
		const a = await vscode.window.showQuickPick(acts, { placeHolder: `${full.id} — ${full.state}` });
		if (a === 'Show Log' || a === 'Show Patch') { await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ language: a === 'Show Patch' ? 'diff' : 'markdown', content: a === 'Show Patch' ? full.patch : `# Task ${full.id} (${full.state})\n\n${full.prompt}\n\n## Log\n${full.log.map((l: string) => `- ${l}`).join('\n')}\n\n## Summary\n${full.summary ?? ''}` })); }
		if (a === 'Apply Patch Locally') { const r = wsRoot()!; const f = path.join(os.tmpdir(), `axiora-${full.id}.patch`); fs.writeFileSync(f, full.patch); await vscode.commands.executeCommand('axiora.checkpoint.create').then(undefined, () => undefined); await run('git', ['apply', '--3way', f], r.fsPath).catch(() => run('git', ['apply', f], r.fsPath)); vscode.window.showInformationMessage(`Applied runner patch ${full.id} (checkpoint created first).`); }
	});
	register(ctx, 'axiora.runner.prebuild', async (mm?: M) => { const m = mm ?? await pick(); const r = wsRoot(); if (!m || !r) { return; } const e = await env(); const branch = (await run('git', ['branch', '--show-current'], r.fsPath)).trim(); await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Prebuilding ${branch} on ${m.name}…` }, async () => api(m, '/prebuild', { bundle: await bundleWorkspace(r.fsPath), branch, repoKey: path.basename(r.fsPath), setup: e?.setup ?? [] })); vscode.window.showInformationMessage(`Prebuild ready for ${branch} on ${m.name}; tasks on this branch start from it.`); });
	register(ctx, 'axiora.env.apply', async () => {
		const r = wsRoot(); if (!r) { return; } const e = await env();
		if (!e) { const u = vscode.Uri.joinPath(r, '.axiora', 'environment.json'); await vscode.workspace.fs.writeFile(u, new TextEncoder().encode(JSON.stringify({ name: path.basename(r.fsPath), setup: ['npm ci || npm install'], test: 'npm test --silent', env: { NODE_ENV: 'development' } }, null, 2))); await vscode.window.showTextDocument(u); vscode.window.showInformationMessage('Created a shareable environment template — commit it so teammates and runners use the same setup.'); return; }
		const t = vscode.window.createTerminal({ name: `Env: ${e.name ?? 'template'}`, env: e.env ?? {} }); t.show(); for (const c of e.setup ?? []) { t.sendText(c); }
	});
	register(ctx, 'axiora.rum.snippet', async () => {
		const m = machines()[0]; const url = (m?.url ?? 'https://your-server:7788').replace(/\/$/, '') + '/rum';
		const s = `<script>/* Axiora RUM: Core Web Vitals → your own runner */(()=>{const d={page:location.pathname,ua:navigator.userAgent.slice(0,80)};const send=()=>navigator.sendBeacon('${url}',new Blob([JSON.stringify(d)],{type:'application/json'}));new PerformanceObserver(l=>{for(const e of l.getEntries())d.lcp=Math.round(e.startTime)}).observe({type:'largest-contentful-paint',buffered:true});new PerformanceObserver(l=>{for(const e of l.getEntries())if(e.name==='first-contentful-paint')d.fcp=Math.round(e.startTime)}).observe({type:'paint',buffered:true});let c=0;new PerformanceObserver(l=>{for(const e of l.getEntries())if(!e.hadRecentInput)c+=e.value;d.cls=+c.toFixed(3)}).observe({type:'layout-shift',buffered:true});new PerformanceObserver(l=>{for(const e of l.getEntries())d.inp=Math.max(d.inp||0,Math.round(e.duration))}).observe({type:'event',buffered:true,durationThreshold:16});const n=performance.getEntriesByType('navigation')[0];if(n)d.ttfb=Math.round(n.responseStart);addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')send()})})();</script>`;
		const ed = vscode.window.activeTextEditor; if (ed) { await ed.edit(b => b.insert(ed.selection.active, s)); } else { await vscode.env.clipboard.writeText(s); vscode.window.showInformationMessage('RUM snippet copied.'); }
	});
	register(ctx, 'axiora.rum.show', async () => {
		const m = await pick(); if (!m) { return; } const j = await api(m, '/rum');
		const g: Record<string, [number, number]> = { lcp: [2500, 4000], fcp: [1800, 3000], inp: [200, 500], ttfb: [800, 1800], cls: [0.1, 0.25] };
		const rows = Object.entries(j.metrics as Record<string, any>).map(([k, v]) => `| ${k.toUpperCase()} | ${v.p50} | ${v.p75} | ${v.p95} | ${v.n} | ${v.p75 <= g[k][0] ? '🟢 good' : v.p75 <= g[k][1] ? '🟡 needs work' : '🔴 poor'} |`);
		await vscode.commands.executeCommand('markdown.showPreview', await vscode.workspace.openTextDocument({ language: 'markdown', content: `# Real-user metrics — ${m.name}\n\n${j.samples} samples · pages: ${j.pages.join(', ') || '—'}\n\n| Metric | p50 | p75 | p95 | n | p75 rating |\n|---|---|---|---|---|---|\n${rows.join('\n') || '| — | | | | | |'}\n` }).then(d => d.uri));
	});
}
