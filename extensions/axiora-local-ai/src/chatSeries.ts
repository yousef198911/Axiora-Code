/*---------------------------------------------------------------------------------------------
 *  Chat series: every Axiora conversation is saved as a part of a named series ("Youssef 1",
 *  "Youssef 2", ...). When a part reaches `axiora.chat.seriesLimit` messages (both sides) the
 *  assistant silently continues in the next part: the panel title number changes, the model
 *  gets a hidden summary of earlier parts instead of the full history. Nothing else is shown.
 *  Past Conversations: grouped by series, search across all parts, pin, rename, export (MD/PDF),
 *  continue any part in the chat panel, files edited, restore the checkpoint of that time.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as cp from 'child_process';
import * as crypto from 'crypto';
import { contextProviders, register, wsRoot } from './util';
import { chat } from './llm';

type Turn = { who: 'user' | 'axiora'; text: string };
interface Part { id: string; seriesId: string; part: number; created: string; at: string; turns: Turn[]; files: string[]; checkpoint?: string; summary?: string; startIdx: number; title?: string }
interface SeriesMeta { name: string; pinned?: boolean }
let dir = '';
const j = (f: string) => path.join(dir, f);
const readJson = <T>(f: string, d: T): T => { try { return JSON.parse(fs.readFileSync(j(f), 'utf8')); } catch { return d; } };
const writeJson = (f: string, v: unknown) => fs.writeFileSync(j(f), JSON.stringify(v));
const keys = () => readJson<Record<string, string>>('_keys.json', {});
const metas = () => readJson<Record<string, SeriesMeta>>('_series.json', {});
const hash = (s: string) => crypto.createHash('sha1').update(s.trim()).digest('hex').slice(0, 16);

/** All parts; older single-file chats (Round 15/16) are migrated into one-part series on read. */
function parts(): Part[] {
	const m = metas(); let dirty = false; const out: Part[] = [];
	for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json') && !f.startsWith('_'))) {
		let p: any; try { p = JSON.parse(fs.readFileSync(j(f), 'utf8')); } catch { continue; }
		if (!p.seriesId) { p = { id: f.replace(/\.json$/, ''), seriesId: f.replace(/\.json$/, ''), part: 1, created: p.created ?? p.at, at: p.at, turns: p.turns ?? [], files: [], startIdx: 0 } as Part; m[p.seriesId] ??= { name: p.turns?.[0] ? autoName(p.turns[0].text) : 'Conversation' }; dirty = true; fs.writeFileSync(j(f), JSON.stringify(p)); }
		out.push(p);
	}
	if (dirty) { writeJson('_series.json', m); }
	return out;
}
const savePart = (p: Part) => { p.at = new Date().toISOString(); fs.writeFileSync(j(`${p.id}.json`), JSON.stringify({ ...p, title: titleOf(p) })); };
const titleOf = (p: Part) => `${metas()[p.seriesId]?.name ?? 'Conversation'} ${p.part}`;
const seriesParts = (sid: string) => parts().filter(p => p.seriesId === sid).sort((a, b) => a.part - b.part);

const STOP = new Set('a an the and or but of to in on for with is are was be can could would should please me my i you your we it this that what how why do does help hi hello hey axiora name named called reply sentence one short answer just quick tell explain write make create show give about need want'.split(' '));
/** Short topic name from the first message, e.g. "Fix login redirect bug" → "Login Redirect Bug". */
export function autoName(text: string): string {
	const words = text.replace(/@\w+|\/\w+|#\S+|`[^`]*`/g, ' ').replace(/[^\p{L}\p{N}\s\-.]/gu, ' ').split(/\s+/).filter(w => w && !STOP.has(w.toLowerCase()) && !/^\d+$/.test(w));
	const pick = (words.length ? words : text.split(/\s+/)).slice(0, 4).map(w => w[0].toUpperCase() + w.slice(1));
	return (pick.join(' ').slice(0, 32).trim() || 'Conversation');
}

// ---------------------------------------------------------------- per-request lifecycle
let current: Part | undefined; let carried = ''; let editedNow = new Set<string>();
const firstPrompt = (h: readonly (vscode.ChatRequestTurn | vscode.ChatResponseTurn)[], prompt: string) => (h.find(t => t instanceof vscode.ChatRequestTurn) as vscode.ChatRequestTurn | undefined)?.prompt ?? prompt;
const limit = () => vscode.workspace.getConfiguration('axiora.chat').get<number>('seriesLimit', 40);
const checkpoint = (label: string) => vscode.commands.executeCommand<string | undefined>('axiora.checkpoint._create', label).then(x => x, () => undefined);

/** Called before the model is asked. Returns where this part starts in the panel history. */
export async function begin(history: readonly (vscode.ChatRequestTurn | vscode.ChatResponseTurn)[], prompt: string): Promise<number> {
	editedNow = new Set();
	const key = hash(firstPrompt(history, prompt)); const k = keys();
	let p = k[key] ? parts().find(x => x.id === k[key]) : undefined;
	if (!p) {
		const sid = crypto.randomUUID().slice(0, 12); const m = metas(); m[sid] = { name: uniqueName(autoName(prompt)) }; writeJson('_series.json', m);
		p = { id: `${sid}-1`, seriesId: sid, part: 1, created: new Date().toISOString(), at: new Date().toISOString(), turns: history.length ? fromHistory(history) : [], files: [], startIdx: 0 };
		savePart(p); const np = p; checkpoint(titleOf(p)).then(sha => { if (sha) { const cur = parts().find(x => x.id === np.id); if (cur) { cur.checkpoint = sha; savePart(cur); } } }); k[key] = p.id; writeJson('_keys.json', k);
	}
	current = p; carried = p.summary ?? '';
	vscode.commands.executeCommand('axiora.chat.setTitle', titleOf(p)).then(undefined, () => undefined);
	return Math.min(p.startIdx, history.length);
}
function uniqueName(n: string) { const used = new Set(Object.values(metas()).map(m => m.name)); let x = n, i = 2; while (used.has(x)) { x = `${n} (${i++})`; } return x; }
const fromHistory = (h: readonly (vscode.ChatRequestTurn | vscode.ChatResponseTurn)[]): Turn[] => h.map(t => t instanceof vscode.ChatRequestTurn ? { who: 'user' as const, text: t.prompt } : { who: 'axiora' as const, text: (t as vscode.ChatResponseTurn).response.map(r => r instanceof vscode.ChatResponseMarkdownPart ? r.value.value : '').join('') });

/** Called after the reply. Saves the turn and, when the part is full, silently starts the next one. */
export async function end(history: readonly (vscode.ChatRequestTurn | vscode.ChatResponseTurn)[], prompt: string, reply: string) {
	const p = current; if (!p) { return; } current = undefined;
	p.turns.push({ who: 'user', text: prompt }); if (reply.trim()) { p.turns.push({ who: 'axiora', text: reply }); }
	const root = wsRoot()?.fsPath; for (const f of editedNow) { const rel = root && f.startsWith(root) ? path.relative(root, f) : f; if (!p.files.includes(rel)) { p.files.push(rel); } }
	p.checkpoint ??= parts().find(x => x.id === p.id)?.checkpoint; savePart(p);
	const max = limit(); if (!max || max < 2 || p.turns.length < max) { return; }
	const all = seriesParts(p.seriesId); const n = Math.max(...all.map(x => x.part)) + 1;
	const next: Part = { id: `${p.seriesId}-${n}`, seriesId: p.seriesId, part: n, created: new Date().toISOString(), at: new Date().toISOString(), turns: [], files: [], startIdx: history.length + 2, summary: p.summary };
	savePart(next);
	const k = keys(); k[hash(firstPrompt(history, prompt))] = next.id; writeJson('_keys.json', k);
	vscode.commands.executeCommand('axiora.chat.setTitle', titleOf(next)).then(undefined, () => undefined);
	// summary + checkpoint in the background (the reply is already complete; nothing is shown)
	void (async () => { const summary = await summarize(p); const sha = await checkpoint(titleOf(next)); const cur = parts().find(x => x.id === next.id) ?? next; cur.summary = summary; cur.checkpoint ??= sha; savePart(cur); })();
}
async function summarize(p: Part): Promise<string> {
	const text = p.turns.map(t => `${t.who === 'user' ? 'User' : 'Assistant'}: ${t.text}`).join('\n').slice(-12000);
	const prev = p.summary ? `Earlier summary:\n${p.summary}\n\n` : '';
	try {
		const s = await chat([{ role: 'system', content: 'Summarize this conversation so another assistant can continue it seamlessly. Keep: goals, decisions, facts, names, file paths, code identifiers, open questions, the user\'s preferences. Max 250 words, terse bullet points.' }, { role: 'user', content: prev + text }], () => { });
		if (s.trim()) { return s.trim().slice(0, 4000); }
	} catch { /* fall back below */ }
	return (prev + p.turns.slice(-8).map(t => `${t.who}: ${t.text.slice(0, 300)}`).join('\n')).slice(-4000);
}

// ---------------------------------------------------------------- history UI
const ago = (iso: string) => { const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(iso).toLocaleDateString(); };
const preview = (p: Part) => (p.turns.find(t => t.who === 'axiora')?.text ?? p.turns[0]?.text ?? '').replace(/\s+/g, ' ').slice(0, 110);
type Item = vscode.QuickPickItem & { sid?: string; part?: Part };
const B = { pin: { iconPath: new vscode.ThemeIcon('pin'), tooltip: 'Pin to top' }, unpin: { iconPath: new vscode.ThemeIcon('pinned'), tooltip: 'Unpin' }, rename: { iconPath: new vscode.ThemeIcon('edit'), tooltip: 'Rename' }, exp: { iconPath: new vscode.ThemeIcon('export'), tooltip: 'Export...' }, del: { iconPath: new vscode.ThemeIcon('trash'), tooltip: 'Delete' } };

async function browse() {
	const qp = vscode.window.createQuickPick<Item>(); qp.title = vscode.l10n.t("Past Conversations"); qp.placeholder = vscode.l10n.t("Search all conversations and parts"); qp.matchOnDescription = true; qp.matchOnDetail = true;
	const open = new Set<string>();
	const build = () => {
		const ps = parts(); const m = metas(); const q = qp.value.trim().toLowerCase();
		if (!ps.length) { qp.items = [{ label: 'No conversations yet', description: 'They are saved automatically after each reply' }]; return; }
		if (q) {
			const hits = ps.map(p => { const t = p.turns.find(x => x.text.toLowerCase().includes(q)); return t || titleOf(p).toLowerCase().includes(q) ? { p, t } : undefined; }).filter(Boolean) as { p: Part; t?: Turn }[];
			qp.items = hits.sort((a, b) => b.p.at.localeCompare(a.p.at)).map(({ p, t }) => { const i = t ? t.text.toLowerCase().indexOf(q) : -1; return { label: `$(comment-discussion) ${titleOf(p)}`, description: `${ago(p.at)} · ${p.turns.length} messages`, detail: i >= 0 ? `…${t!.text.slice(Math.max(0, i - 40), i + 80).replace(/\s+/g, ' ')}…` : preview(p), alwaysShow: true, part: p }; });
			return;
		}
		const groups = new Map<string, Part[]>(); for (const p of ps) { (groups.get(p.seriesId) ?? groups.set(p.seriesId, []).get(p.seriesId)!).push(p); }
		const sorted = [...groups.entries()].map(([sid, list]) => ({ sid, list: list.sort((a, b) => a.part - b.part), last: list.reduce((a, b) => a.at > b.at ? a : b).at })).sort((a, b) => (+!!m[b.sid]?.pinned - +!!m[a.sid]?.pinned) || b.last.localeCompare(a.last));
		const items: Item[] = []; let pinnedHeader = false, recentHeader = false;
		for (const g of sorted) {
			const pinned = !!m[g.sid]?.pinned;
			if (pinned && !pinnedHeader) { items.push({ label: 'Pinned', kind: vscode.QuickPickItemKind.Separator }); pinnedHeader = true; }
			if (!pinned && !recentHeader) { items.push({ label: 'Recent', kind: vscode.QuickPickItemKind.Separator }); recentHeader = true; }
			const name = m[g.sid]?.name ?? 'Conversation'; const many = g.list.length > 1; const isOpen = open.has(g.sid);
			items.push({ label: `${many ? (isOpen ? '$(chevron-down)' : '$(chevron-right)') : '$(comment-discussion)'} ${many ? name : titleOf(g.list[0])}`, description: `${many ? `${g.list.length} parts · ` : ''}${ago(g.last)}`, detail: preview(g.list[g.list.length - 1]), sid: g.sid, part: many ? undefined : g.list[0], buttons: [pinned ? B.unpin : B.pin, B.rename, B.exp, B.del] });
			if (many && isOpen) { for (const p of g.list) { items.push({ label: `  ${titleOf(p)}`, description: `${ago(p.at)} · ${p.turns.length} messages${p.files.length ? ` · ${p.files.length} files` : ''}`, part: p, sid: g.sid }); } }
		}
		qp.items = items;
	};
	qp.onDidChangeValue(build);
	qp.onDidTriggerItemButton(async e => {
		const sid = e.item.sid!; const m = metas();
		if (e.button === B.pin || e.button === B.unpin) { m[sid].pinned = e.button === B.pin; writeJson('_series.json', m); build(); return; }
		if (e.button === B.del) { for (const p of seriesParts(sid)) { fs.rmSync(j(`${p.id}.json`), { force: true }); } delete m[sid]; writeJson('_series.json', m); build(); return; }
		qp.hide();
		if (e.button === B.rename) { await renameSeries(sid); }
		if (e.button === B.exp) { await exportSeries(sid); }
	});
	qp.onDidAccept(async () => {
		const it = qp.selectedItems[0]; if (!it) { return; }
		if (!it.part && it.sid) { open.has(it.sid) ? open.delete(it.sid) : open.add(it.sid); build(); qp.activeItems = qp.items.filter(x => x.sid === it.sid && !x.part); return; }
		if (it.part) { qp.hide(); await partActions(it.part); }
	});
	qp.onDidHide(() => qp.dispose()); build(); qp.show();
}

async function partActions(p: Part) {
	const m = metas()[p.seriesId];
	const acts: (vscode.QuickPickItem & { id: string })[] = [
		{ label: '$(comment-discussion) Continue in Chat', description: 'Restore this conversation in the chat panel', id: 'chat' },
		{ label: '$(file) Open as Document', id: 'doc' },
		...(p.files.length ? [{ label: `$(files) Files Edited (${p.files.length})`, id: 'files' }] : []),
		...(p.checkpoint ? [{ label: '$(history) Restore Checkpoint...', description: `Workspace files as they were when ${titleOf(p)} started`, id: 'cp' }] : []),
		{ label: '$(edit) Rename Series...', id: 'rename' },
		{ label: m?.pinned ? '$(pinned) Unpin' : '$(pin) Pin to Top', id: 'pin' },
		{ label: '$(export) Export Series...', id: 'export' },
	];
	const a = await vscode.window.showQuickPick(acts, { title: titleOf(p), placeHolder: vscode.l10n.t("{0} messages · {1}", p.turns.length, ago(p.at)) }); if (!a) { return; }
	if (a.id === 'chat') { await continueInChat(p); }
	if (a.id === 'doc') { await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ language: 'markdown', content: toMarkdown([p]) })); }
	if (a.id === 'files') { const root = wsRoot(); const f = await vscode.window.showQuickPick(p.files.map(x => ({ label: path.basename(x), description: x, x })), { title: vscode.l10n.t("Files edited in {0}", titleOf(p)) }); if (f) { await vscode.window.showTextDocument(path.isAbsolute(f.x) || !root ? vscode.Uri.file(f.x) : vscode.Uri.joinPath(root, f.x)); } }
	if (a.id === 'cp') { await vscode.commands.executeCommand('axiora.checkpoint._restoreTo', p.checkpoint, titleOf(p)); }
	if (a.id === 'rename') { await renameSeries(p.seriesId); }
	if (a.id === 'pin') { const all = metas(); all[p.seriesId].pinned = !all[p.seriesId].pinned; writeJson('_series.json', all); }
	if (a.id === 'export') { await exportSeries(p.seriesId); }
}

export async function continueInChat(p: Part) {
	if (!p.turns.length) { vscode.window.showInformationMessage(vscode.l10n.t("This part has no messages yet.")); return; }
	const first = p.turns.find(t => t.who === 'user')?.text ?? '';
	const k = keys(); k[hash(first)] = p.id; writeJson('_keys.json', k);
	p.startIdx = 0; savePart(p);
	await vscode.commands.executeCommand('axiora.chat.restore', { title: titleOf(p), turns: p.turns });
}
async function renameSeries(sid: string) {
	const m = metas(); const n = await vscode.window.showInputBox({ title: vscode.l10n.t("Rename Conversation"), value: m[sid]?.name, prompt: vscode.l10n.t("All parts are renamed (e.g. \"Youssef\" → \"Youssef 1\", \"Youssef 2\")") });
	if (!n?.trim()) { return; } m[sid] = { ...m[sid], name: n.trim() }; writeJson('_series.json', m);
	for (const p of seriesParts(sid)) { savePart(p); }
	if (current?.seriesId === sid) { vscode.commands.executeCommand('axiora.chat.setTitle', titleOf(current)); }
}

// ---------------------------------------------------------------- export
function toMarkdown(ps: Part[]) {
	const name = metas()[ps[0].seriesId]?.name ?? 'Conversation';
	return `# ${name}\n\n` + ps.map(p => `## ${titleOf(p)}\n\n_${new Date(p.created).toLocaleString()} · ${p.turns.length} messages${p.files.length ? ` · files: ${p.files.join(', ')}` : ''}_\n\n` + p.turns.map(t => `**${t.who === 'user' ? 'You' : 'Axiora'}:** ${t.text}`).join('\n\n')).join('\n\n---\n\n') + '\n';
}
const esc = (s: string) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
function mdToHtml(md: string) {
	return md.split(/(```[\s\S]*?```)/g).map(b => b.startsWith('```') ? `<pre><code>${esc(b.replace(/^```\w*\n?|```$/g, ''))}</code></pre>` : esc(b)
		.replace(/^### (.*)$/gm, '<h3>$1</h3>').replace(/^## (.*)$/gm, '<h2>$1</h2>').replace(/^# (.*)$/gm, '<h1>$1</h1>').replace(/^---$/gm, '<hr>')
		.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|\W)_(.+?)_(\W|$)/g, '$1<i>$2</i>$3').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\n\n+/g, '</p><p>').replace(/\n/g, '<br>')).join('');
}
function findBrowser(): string | undefined {
	const c = vscode.workspace.getConfiguration('axiora.browser').get<string>('executablePath', ''); if (c && fs.existsSync(c)) { return c; }
	const cands = process.platform === 'win32' ? [`${process.env['PROGRAMFILES(X86)']}\\Microsoft\\Edge\\Application\\msedge.exe`, `${process.env.PROGRAMFILES}\\Microsoft\\Edge\\Application\\msedge.exe`, `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`]
		: process.platform === 'darwin' ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Chromium.app/Contents/MacOS/Chromium']
			: ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge', '/snap/bin/chromium'];
	return cands.find(x => x && fs.existsSync(x));
}
async function exportSeries(sid: string) {
	const ps = seriesParts(sid).filter(p => p.turns.length); if (!ps.length) { return; }
	const fmt = await vscode.window.showQuickPick([{ label: '$(markdown) Markdown', id: 'md' }, { label: '$(file-pdf) PDF', id: 'pdf' }], { title: vscode.l10n.t("Export \"{0}\"", metas()[sid]?.name) }); if (!fmt) { return; }
	const md = toMarkdown(ps); const safe = (metas()[sid]?.name ?? 'conversation').replace(/[^\w\- ]+/g, '').trim() || 'conversation';
	const root = wsRoot(); const outDir = root ? vscode.Uri.joinPath(root, '.axiora', 'exports') : vscode.Uri.file(path.join(os.homedir(), 'Documents'));
	await vscode.workspace.fs.createDirectory(outDir);
	if (fmt.id === 'md') { const u = vscode.Uri.joinPath(outDir, `${safe}.md`); await vscode.workspace.fs.writeFile(u, new TextEncoder().encode(md)); await vscode.window.showTextDocument(u); return; }
	const exe = findBrowser(); if (!exe) { vscode.window.showWarningMessage(vscode.l10n.t("PDF export needs Chrome or Edge. Set axiora.browser.executablePath, or export as Markdown.")); return; }
	const html = path.join(os.tmpdir(), `axiora-export-${Date.now()}.html`); const pdf = vscode.Uri.joinPath(outDir, `${safe}.pdf`);
	fs.writeFileSync(html, `<!doctype html><meta charset="utf-8"><style>body{font:14px/1.55 -apple-system,Segoe UI,Roboto,sans-serif;max-width:760px;margin:32px auto;color:#222}h1{font-size:24px}h2{font-size:18px;margin-top:28px;border-bottom:1px solid #ddd;padding-bottom:4px}pre{background:#f5f5f5;padding:10px;border-radius:4px;white-space:pre-wrap}code{font-family:Consolas,monospace;font-size:12.5px}hr{border:0;border-top:1px solid #eee;margin:24px 0}</style><p>${mdToHtml(md)}</p>`);
	await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: vscode.l10n.t("Exporting PDF…") }, () => new Promise<void>((res, rej) => cp.execFile(exe, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-pdf-header-footer', `--print-to-pdf=${pdf.fsPath}`, vscode.Uri.file(html).toString()], { timeout: 60000 }, e => e && !fs.existsSync(pdf.fsPath) ? rej(e) : res())));
	const a = await vscode.window.showInformationMessage(vscode.l10n.t("Exported {0}", path.basename(pdf.fsPath)), 'Open', 'Reveal'); if (a === 'Open') { vscode.env.openExternal(pdf); } if (a === 'Reveal') { vscode.commands.executeCommand('revealFileInOS', pdf); }
}

export function activate(c: vscode.ExtensionContext) {
	dir = path.join(c.globalStorageUri.fsPath, 'chats'); fs.mkdirSync(dir, { recursive: true });
	// hidden carried memory for parts after the first
	contextProviders.push(async () => carried ? `\n\nEarlier in this conversation (summary of previous parts — continue seamlessly, do not mention this summary):\n${carried}` : '');
	c.subscriptions.push(vscode.workspace.onDidChangeTextDocument(e => { if (current && e.document.uri.scheme === 'file' && e.contentChanges.length) { editedNow.add(e.document.uri.fsPath); } }));
	c.subscriptions.push(vscode.workspace.onDidCreateFiles(e => { if (current) { e.files.forEach(f => editedNow.add(f.fsPath)); } }));
	register(c, 'axiora.chats.browse', browse);
	register(c, 'axiora.chats.renameCurrent', async () => { const p = parts().sort((a, b) => b.at.localeCompare(a.at))[0]; if (p) { await renameSeries(p.seriesId); } });
}
