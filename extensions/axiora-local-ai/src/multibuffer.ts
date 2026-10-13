/*---------------------------------------------------------------------------------------------
 *  Multibuffer (Zed-style) / editable search results: search the workspace, get one editable
 *  buffer of excerpts from many files; saving writes every changed excerpt back to its file.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { register, run, wsRoot } from './util';

type Ex = { file: string; start: number; lines: string[] };
const HDR = /^── (.+?) :(\d+) ──$/;
const ctxLines = 2;
export function activate(ctx: vscode.ExtensionContext) {
	const bufs = new Map<string, Ex[]>();
	const em = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
	const render = (ex: Ex[]) => ex.map(e => `── ${e.file} :${e.start + 1} ──\n${e.lines.join('\n')}`).join('\n\n') + '\n';
	ctx.subscriptions.push(vscode.workspace.registerFileSystemProvider('axiora-multi', {
		onDidChangeFile: em.event, watch: () => new vscode.Disposable(() => undefined),
		stat: () => ({ type: vscode.FileType.File, ctime: 0, mtime: Date.now(), size: 0 }),
		readDirectory: () => [], createDirectory: () => undefined, delete: () => undefined, rename: () => undefined,
		readFile: uri => Buffer.from(render(bufs.get(uri.path) ?? [])),
		writeFile: async (uri, content) => {
			const old = bufs.get(uri.path) ?? []; const root = wsRoot()!;
			// parse edited buffer back into excerpts (headers are anchors)
			const parsed: Ex[] = []; let cur: Ex | undefined;
			for (const l of Buffer.from(content).toString().replace(/\n$/, '').split('\n')) {
				const h = HDR.exec(l);
				if (h) { cur = { file: h[1], start: +h[2] - 1, lines: [] }; parsed.push(cur); } else if (cur) { cur.lines.push(l); }
			}
			parsed.forEach((p, i) => { if (i < parsed.length - 1 && p.lines[p.lines.length - 1] === '') { p.lines.pop(); } }); // drop the separator line
			// group per file, apply bottom-up so line numbers stay valid
			const edit = new vscode.WorkspaceEdit(); let changed = 0;
			for (const p of parsed) {
				const o = old.find(x => x.file === p.file && x.start === p.start); if (!o || o.lines.join('\n') === p.lines.join('\n')) { continue; }
				const u = vscode.Uri.joinPath(root, p.file); const doc = await vscode.workspace.openTextDocument(u);
				const end = Math.min(doc.lineCount - 1, o.start + o.lines.length - 1);
				edit.replace(u, new vscode.Range(o.start, 0, end, doc.lineAt(end).text.length), p.lines.join('\n')); changed++;
			}
			if (changed) { await vscode.workspace.applyEdit(edit); await vscode.workspace.saveAll(false); }
			// re-anchor offsets after line-count changes
			const shift = new Map<string, number>();
			const next = parsed.slice().sort((a, b) => a.file.localeCompare(b.file) || a.start - b.start).map(p => {
				const o = old.find(x => x.file === p.file && x.start === p.start); const sh = shift.get(p.file) ?? 0;
				shift.set(p.file, sh + p.lines.length - (o?.lines.length ?? p.lines.length));
				return { ...p, start: p.start + sh };
			});
			bufs.set(uri.path, next);
			if (next.some((n, i) => n.start !== parsed[i]?.start)) { em.fire([{ type: vscode.FileChangeType.Changed, uri }]); }
			vscode.window.setStatusBarMessage(`$(check) Multibuffer: wrote ${changed} excerpt(s)`, 4000);
		},
	}, { isCaseSensitive: true }));
	register(ctx, 'axiora.multibuffer.search', async () => {
		const root = wsRoot(); if (!root) { return; }
		const ed = vscode.window.activeTextEditor;
		const q = await vscode.window.showInputBox({ prompt: 'Search (regex) — results open as one editable buffer', value: ed && !ed.selection.isEmpty ? ed.document.getText(ed.selection) : '' });
		if (!q) { return; }
		let out = '';
		try { out = await run('git', ['grep', '-n', '-E', '-I', '--untracked', q], root.fsPath); } catch { out = ''; }
		const hits = new Map<string, number[]>();
		for (const l of out.split('\n').filter(Boolean)) { const m = /^(.+?):(\d+):/.exec(l); if (m) { (hits.get(m[1]) ?? hits.set(m[1], []).get(m[1])!).push(+m[2] - 1); } }
		const ex: Ex[] = [];
		for (const [file, ls] of hits) {
			const doc = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(root, file));
			let s = -1, e = -1;
			const flush = () => { if (s >= 0) { ex.push({ file, start: s, lines: Array.from({ length: e - s + 1 }, (_, i) => doc.lineAt(s + i).text) }); } };
			for (const l of ls) { const a = Math.max(0, l - ctxLines), b = Math.min(doc.lineCount - 1, l + ctxLines); if (s >= 0 && a <= e + 1) { e = Math.max(e, b); } else { flush(); s = a; e = b; } }
			flush();
		}
		if (!ex.length) { vscode.window.showInformationMessage(`No matches for ${q}`); return; }
		const id = `/${q.replace(/[^\w-]+/g, '_').slice(0, 40)}-${Date.now()}.multibuffer`;
		bufs.set(id, ex);
		const doc = await vscode.workspace.openTextDocument(vscode.Uri.from({ scheme: 'axiora-multi', path: id }));
		await vscode.window.showTextDocument(doc);
		vscode.window.setStatusBarMessage(`Multibuffer: ${ex.length} excerpts from ${hits.size} files — edit and save to apply`, 6000);
	});
	// jump from an excerpt line to its source location
	register(ctx, 'axiora.multibuffer.open', async () => {
		const ed = vscode.window.activeTextEditor; if (!ed || ed.document.uri.scheme !== 'axiora-multi') { return; }
		for (let l = ed.selection.active.line, off = 0; l >= 0; l--, off++) {
			const h = HDR.exec(ed.document.lineAt(l).text);
			if (h) { const te = await vscode.window.showTextDocument(vscode.Uri.joinPath(wsRoot()!, h[1])); const p = new vscode.Position(+h[2] - 2 + off, 0); te.selection = new vscode.Selection(p, p); te.revealRange(new vscode.Range(p, p), vscode.TextEditorRevealType.InCenter); return; }
		}
	});
}
