/*---------------------------------------------------------------------------------------------
 *  Context engine additions for @axiora prompts:
 *  - Live user-action awareness: recent edits, open editors, cursor, last terminal commands,
 *    current diagnostics, current git branch (setting axiora.context.liveActions).
 *  - Fast context: keyword retrieval of the most relevant workspace files for the prompt
 *    (git grep, ranked by hit density) — no embeddings needed.
 *  - Multi-repo context: repository maps of extra folders/repos (axiora.context.extraRepos)
 *    and of every additional workspace folder.
 *  - Past chats: every @axiora conversation is saved; "/recall <query>" finds and reuses them,
 *    and "#chat:<words>" in a prompt pulls the best matching past conversation into context.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { chatCommands, contextProviders, run, wsRoot } from './util';

type Edit = { file: string; line: number; text: string; at: number };
const edits: Edit[] = [];
const termCmds: string[] = [];
let lastPrompt = '';
export const setPrompt = (p: string) => { lastPrompt = p; };
const STOP = new Set('the a an and or of to in on for with is are be this that it how why what where when do does can i me my we you your fix add make use using from into file code function please did just change changed now show tell explain write all some any was were has have had not but there here which who should would could will about more like get got need want'.split(' '));
export function keywords(s: string) { return [...new Set((s.match(/[A-Za-z_][A-Za-z0-9_]{2,}/g) ?? []).filter(w => !STOP.has(w.toLowerCase())))].slice(0, 8); }
export async function fastContext(prompt: string, root: string, maxFiles = 4): Promise<string> {
	const kws = keywords(prompt); if (!kws.length) { return ''; }
	let out = '';
	try { out = await run('git', ['grep', '-I', '-n', '-i', '-E', '--untracked', kws.map(k => k.replace(/[^\w]/g, '')).join('|'), '--', '.', ':!*.lock', ':!*.min.js', ':!node_modules'], root); } catch { return ''; }
	const score = new Map<string, { n: number; lines: number[] }>();
	for (const l of out.split('\n')) { const m = /^(.+?):(\d+):/.exec(l); if (m) { const s = score.get(m[1]) ?? { n: 0, lines: [] }; s.n++; s.lines.push(+m[2]); score.set(m[1], s); } }
	const top = [...score.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, maxFiles);
	let ctxt = '';
	for (const [f, s] of top) {
		const lines = fs.readFileSync(path.join(root, f), 'utf8').split('\n');
		const pick = new Set<number>(); s.lines.slice(0, 6).forEach(l => { for (let i = Math.max(1, l - 3); i <= Math.min(lines.length, l + 3); i++) { pick.add(i); } });
		ctxt += `\n--- ${f}\n` + [...pick].sort((a, b) => a - b).map(i => `${i}: ${lines[i - 1]}`).join('\n');
	}
	return ctxt ? `\n\nRelevant code (fast context for: ${kws.join(', ')}):${ctxt.slice(0, 6000)}` : '';
}
function liveSummary(): string {
	const ed = vscode.window.activeTextEditor;
	const open = vscode.window.tabGroups.all.flatMap(g => g.tabs).map(t => (t.input as { uri?: vscode.Uri })?.uri).filter((u): u is vscode.Uri => !!u).map(u => vscode.workspace.asRelativePath(u)).slice(0, 12);
	const diags = vscode.languages.getDiagnostics().flatMap(([u, ds]) => ds.filter(d => d.severity === vscode.DiagnosticSeverity.Error).map(d => `${vscode.workspace.asRelativePath(u)}:${d.range.start.line + 1} ${d.message}`)).slice(0, 8);
	const recent = edits.slice(-8).map(e => `${e.file}:${e.line + 1} ${e.text.trim().slice(0, 80)}`);
	return `\n\nWhat the user is doing right now:\n- Active: ${ed ? `${vscode.workspace.asRelativePath(ed.document.uri)} line ${ed.selection.active.line + 1}${ed.selection.isEmpty ? '' : ` (selected: ${ed.document.getText(ed.selection).slice(0, 200)})`}` : 'none'}\n- Open editors: ${open.join(', ') || 'none'}\n- Recent edits:\n${recent.map(r => '  ' + r).join('\n') || '  none'}\n- Recent terminal commands: ${termCmds.slice(-5).join(' | ') || 'none'}\n- Errors: ${diags.join('; ') || 'none'}`;
}
export function activate(ctx: vscode.ExtensionContext) {
	const cfg = () => vscode.workspace.getConfiguration('axiora.context');
	ctx.subscriptions.push(vscode.workspace.onDidChangeTextDocument(e => {
		if (e.document.uri.scheme !== 'file' || !e.contentChanges.length) { return; }
		const c = e.contentChanges[0]; const line = c.range.start.line;
		const file = vscode.workspace.asRelativePath(e.document.uri); const prev = edits[edits.length - 1];
		const text = e.document.lineAt(Math.min(line, e.document.lineCount - 1)).text;
		if (prev && prev.file === file && prev.line === line) { prev.text = text; prev.at = Date.now(); } else { edits.push({ file, line, text, at: Date.now() }); if (edits.length > 50) { edits.shift(); } }
	}));
	ctx.subscriptions.push(vscode.window.onDidEndTerminalShellExecution?.(e => { termCmds.push(`${e.execution.commandLine.value} (exit ${e.exitCode ?? '?'})`); if (termCmds.length > 20) { termCmds.shift(); } }) ?? { dispose() { /* */ } });
	contextProviders.push(async () => cfg().get('liveActions', true) ? liveSummary() : '');
	contextProviders.push(async () => { const r = wsRoot(); return r && cfg().get('fastContext', true) && lastPrompt ? fastContext(lastPrompt, r.fsPath) : ''; });
	contextProviders.push(async () => {
		const extra = [...cfg().get<string[]>('extraRepos', []), ...(vscode.workspace.workspaceFolders ?? []).slice(1).filter(f => f.uri.scheme === 'file').map(f => f.uri.fsPath)];
		let s = '';
		for (const r of extra.slice(0, 4)) { try { const files = (await run('git', ['ls-files'], r)).split('\n').filter(Boolean); s += `\n--- repo ${path.basename(r)} (${files.length} files)\n${files.slice(0, 150).join('\n')}`; } catch { /* not a git repo */ } }
		return s ? `\n\nOther repositories in scope:${s.slice(0, 5000)}` : '';
	});
	// past chats
	const dir = path.join(ctx.globalStorageUri.fsPath, 'chats'); fs.mkdirSync(dir, { recursive: true });
	const all = () => fs.readdirSync(dir).filter(f => f.endsWith('.json') && !f.startsWith('_')).map(f => ({ f, ...JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as { title: string; at: string; turns: { who: string; text: string }[] } }));
	const find = (q: string) => { const k = keywords(q).map(x => x.toLowerCase()); return all().map(c => ({ c, s: k.reduce((n, w) => n + (c.turns.map(t => t.text).join(' ').toLowerCase().split(w).length - 1), 0) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s).map(x => x.c); };
	contextProviders.push(async () => {
		const m = /#chat:([^\n#]+)/.exec(lastPrompt); if (!m) { return ''; }
		const c = find(m[1])[0]; return c ? `\n\nPast conversation "${c.title}" (${c.at}):\n${c.turns.map(t => `${t.who}: ${t.text}`).join('\n').slice(0, 5000)}` : '';
	});
	chatCommands.set('recall', async (req, stream) => {
		const hits = req.prompt ? find(req.prompt) : all().sort((a, b) => b.at.localeCompare(a.at));
		if (!hits.length) { stream.markdown('No matching past conversations.'); return; }
		stream.markdown(hits.slice(0, 8).map(c => `- **${c.title}** — ${new Date(c.at).toLocaleString()} (${c.turns.length} messages)`).join('\n') + '\n\nUse `#chat:<words>` in a prompt to bring one into context.');
	});
}
