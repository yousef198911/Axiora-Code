/*---------------------------------------------------------------------------------------------
 *  Code quality:
 *  - Inspections (JS/TS/Python) with quick fixes: unused imports, == vs ===, bare except,
 *    mutable default args, leftover console.log/print debugging, empty catch, duplicated blocks,
 *    overly long functions. On open/save + "Inspect Workspace".
 *  - Dependency vulnerabilities (SCA) via the free OSV.dev API for package-lock.json /
 *    package.json / requirements.txt → Problems on the manifest.
 *  - Safe AI refactor: describe a refactoring → preview as a diff → apply only if the test
 *    command still passes (otherwise it is rolled back automatically).
 *  - Run Property Tests: runs a hypothesis / fast-check / node:test file, extracts the
 *    falsifying example and offers "Fix with AI".
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as path from 'path';
import { register, wsRoot, run, ask, unfence, withProgress, SYS } from './util';

export type Finding = { line: number; col: number; len: number; code: string; msg: string; sev: vscode.DiagnosticSeverity; fix?: { title: string; replace: string; wholeLine?: boolean } };
const W = vscode.DiagnosticSeverity.Warning, I = vscode.DiagnosticSeverity.Information, H = vscode.DiagnosticSeverity.Hint;
export function inspect(text: string, lang: string): Finding[] {
	const L = text.split('\n'); const f: Finding[] = []; const py = lang === 'python'; const js = /^(java|type)script(react)?$/.test(lang);
	const body = (skip: number) => L.filter((_, i) => i !== skip).join('\n');
	L.forEach((l, i) => {
		if (js) {
			const m = /^\s*import\s+(?:(\w+)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s+['"][^'"]+['"]/.exec(l);
			if (m) {
				const names = [m[1], ...(m[2] ?? '').split(',').map(s => s.trim().split(/\s+as\s+/).pop()!)].filter(Boolean) as string[];
				const rest = body(i); const unused = names.filter(n => !new RegExp(`\\b${n}\\b`).test(rest));
				if (unused.length === names.length) { f.push({ line: i, col: 0, len: l.length, code: 'unused-import', msg: `Unused import${names.length > 1 ? 's' : ''}: ${names.join(', ')}`, sev: H, fix: { title: 'Remove unused import', replace: '', wholeLine: true } }); }
				else { for (const n of unused) { f.push({ line: i, col: l.indexOf(n), len: n.length, code: 'unused-import', msg: `Unused import: ${n}`, sev: H }); } }
			}
			for (const m2 of l.matchAll(/[^=!<>]==(?!=)|!=(?!=)/g)) { if (/^\s*(\/\/|\*)/.test(l)) { break; } const col = m2.index! + (m2[0].startsWith('!') ? 0 : 1); const op = m2[0].endsWith('==') && !m2[0].startsWith('!') ? '==' : '!='; f.push({ line: i, col, len: op.length, code: 'loose-equality', msg: `Use ${op}= instead of ${op}`, sev: W, fix: { title: `Replace with ${op}=`, replace: `${op}=` } }); }
			if (/^\s*console\.(log|debug)\(/.test(l)) { f.push({ line: i, col: l.search(/\S/), len: l.trim().length, code: 'debug-log', msg: 'Leftover console.log', sev: I, fix: { title: 'Remove console.log', replace: '', wholeLine: true } }); }
			if (/catch\s*(\(\w*\))?\s*\{\s*\}/.test(l)) { f.push({ line: i, col: l.indexOf('catch'), len: 5, code: 'empty-catch', msg: 'Empty catch block swallows errors', sev: W }); }
		}
		if (py) {
			const m = /^\s*(?:from\s+[\w.]+\s+)?import\s+(.+)$/.exec(l);
			if (m && !/\(\s*$/.test(l)) {
				const names = m[1].split(',').map(s => s.trim().split(/\s+as\s+/).pop()!.split('.')[0]).filter(n => /^\w+$/.test(n));
				const rest = body(i); const unused = names.filter(n => !new RegExp(`\\b${n}\\b`).test(rest));
				if (names.length && unused.length === names.length) { f.push({ line: i, col: 0, len: l.length, code: 'unused-import', msg: `Unused import${names.length > 1 ? 's' : ''}: ${names.join(', ')}`, sev: H, fix: { title: 'Remove unused import', replace: '', wholeLine: true } }); }
			}
			const b = /^(\s*)except\s*:/.exec(l); if (b) { f.push({ line: i, col: b[1].length, len: 7, code: 'bare-except', msg: 'Bare except also catches KeyboardInterrupt/SystemExit', sev: W, fix: { title: 'Use except Exception:', replace: 'except Exception:' } }); }
			const d = /def\s+\w+\(.*?(\w+)\s*=\s*(\[\]|\{\}|set\(\))/.exec(l); if (d) { f.push({ line: i, col: l.indexOf(d[1]), len: d[1].length, code: 'mutable-default', msg: `Mutable default argument "${d[1]}" is shared between calls; use None`, sev: W }); }
			if (/^\s*print\(\s*f?["']?(debug|DEBUG|xxx|here)/.test(l)) { f.push({ line: i, col: l.search(/\S/), len: l.trim().length, code: 'debug-log', msg: 'Leftover debug print', sev: I, fix: { title: 'Remove debug print', replace: '', wholeLine: true } }); }
		}
	});
	// long functions
	const starts = js ? /^\s*(export\s+)?(async\s+)?function\s+(\w+)|^\s*(?:const|let)\s+(\w+)\s*=\s*(async\s*)?\(/ : py ? /^(\s*)def\s+(\w+)/ : undefined;
	if (starts) { let cur: { i: number; name: string } | undefined; const close = (end: number) => { if (cur && end - cur.i > 80) { f.push({ line: cur.i, col: 0, len: L[cur.i].length, code: 'long-function', msg: `Function "${cur.name}" is ${end - cur.i} lines; consider splitting it`, sev: I }); } }; L.forEach((l, i) => { const m = starts.exec(l); if (m) { close(i); cur = { i, name: m[3] ?? m[4] ?? m[2] ?? 'anonymous' }; } }); close(L.length); }
	// duplicated blocks (6 identical non-trivial lines)
	const seen = new Map<string, number>(); const N = 6;
	for (let i = 0; i + N <= L.length; i++) { const blk = L.slice(i, i + N).map(s => s.trim()); if (blk.filter(s => s.length > 8).length < N) { continue; } const k = blk.join('\n'); const prev = seen.get(k); if (prev === undefined) { seen.set(k, i); } else if (i >= prev + N) { f.push({ line: i, col: 0, len: L[i].length, code: 'duplicate', msg: `Duplicated block (same as lines ${prev + 1}-${prev + N})`, sev: I }); i += N - 1; } }
	return f;
}
export type Dep = { name: string; version: string; eco: 'npm' | 'PyPI' };
export function parseDeps(file: string, text: string): Dep[] {
	if (file.endsWith('package-lock.json')) { const j = JSON.parse(text); return Object.entries<any>(j.packages ?? {}).filter(([k]) => k.startsWith('node_modules/')).map(([k, v]) => ({ name: k.replace(/^.*node_modules\//, ''), version: v.version, eco: 'npm' as const })).filter(d => d.version); }
	if (file.endsWith('package.json')) { const j = JSON.parse(text); return Object.entries<string>({ ...j.dependencies, ...j.devDependencies }).map(([name, v]) => ({ name, version: String(v).replace(/^[\^~>=<\s]+/, ''), eco: 'npm' as const })).filter(d => /^\d/.test(d.version)); }
	return text.split('\n').map(l => /^\s*([A-Za-z0-9_.-]+)\s*==\s*([\w.]+)/.exec(l)).filter(Boolean).map(m => ({ name: m![1], version: m![2], eco: 'PyPI' as const }));
}
export function activate(ctx: vscode.ExtensionContext) {
	const dc = vscode.languages.createDiagnosticCollection('axiora-inspect'); ctx.subscriptions.push(dc);
	const fixes = new Map<string, Finding[]>();
	const on = () => vscode.workspace.getConfiguration('axiora.inspections').get('enabled', true);
	const check = (d: vscode.TextDocument) => { if (!on() || d.uri.scheme !== 'file' || !/^(java|type)script(react)?$|^python$/.test(d.languageId)) { return; } const fs = inspect(d.getText(), d.languageId); fixes.set(d.uri.toString(), fs); dc.set(d.uri, fs.map(x => { const g = new vscode.Diagnostic(new vscode.Range(x.line, x.col, x.line, x.col + x.len), x.msg, x.sev); g.source = 'Axiora'; g.code = x.code; if (x.code === 'unused-import') { g.tags = [vscode.DiagnosticTag.Unnecessary]; } return g; })); };
	vscode.workspace.textDocuments.forEach(check);
	ctx.subscriptions.push(vscode.workspace.onDidOpenTextDocument(check), vscode.workspace.onDidSaveTextDocument(check), vscode.workspace.onDidCloseTextDocument(d => dc.delete(d.uri)));
	ctx.subscriptions.push(vscode.languages.registerCodeActionsProvider([{ language: 'javascript' }, { language: 'typescript' }, { language: 'javascriptreact' }, { language: 'typescriptreact' }, { language: 'python' }], {
		provideCodeActions(doc, range) {
			const acts: vscode.CodeAction[] = []; const all = (fixes.get(doc.uri.toString()) ?? []).filter(x => x.fix);
			for (const x of all.filter(x => x.line >= range.start.line && x.line <= range.end.line)) {
				const a = new vscode.CodeAction(x.fix!.title, vscode.CodeActionKind.QuickFix); a.edit = new vscode.WorkspaceEdit();
				a.edit.replace(doc.uri, x.fix!.wholeLine ? doc.lineAt(x.line).rangeIncludingLineBreak : new vscode.Range(x.line, x.col, x.line, x.col + x.len), x.fix!.replace); a.isPreferred = true; acts.push(a);
				const same = all.filter(y => y.code === x.code);
				if (same.length > 1) { const b = new vscode.CodeAction(`Fix all "${x.code}" in file (${same.length})`, vscode.CodeActionKind.QuickFix); b.edit = new vscode.WorkspaceEdit(); for (const y of [...same].sort((p, q) => q.line - p.line || q.col - p.col)) { b.edit.replace(doc.uri, y.fix!.wholeLine ? doc.lineAt(y.line).rangeIncludingLineBreak : new vscode.Range(y.line, y.col, y.line, y.col + y.len), y.fix!.replace); } acts.push(b); }
			}
			return acts;
		}
	}, { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }));
	register(ctx, 'axiora.inspect.workspace', async () => {
		const files = await vscode.workspace.findFiles('**/*.{js,ts,jsx,tsx,py}', '{**/node_modules/**,**/out/**,**/dist/**,**/.axiora/**}', 2000);
		let n = 0; for (const u of files) { const d = await vscode.workspace.openTextDocument(u); check(d); n += fixes.get(u.toString())?.length ?? 0; }
		await vscode.commands.executeCommand('workbench.actions.view.problems');
		vscode.window.showInformationMessage(vscode.l10n.t("Inspections: {0} finding(s) in {1} file(s).", n, files.length));
	});
	// ---- SCA via OSV.dev
	const sca = vscode.languages.createDiagnosticCollection('axiora-sca'); ctx.subscriptions.push(sca);
	register(ctx, 'axiora.sca.scan', async () => {
		const files = await vscode.workspace.findFiles('{package-lock.json,package.json,requirements.txt,**/requirements*.txt}', '**/node_modules/**', 20);
		let total = 0;
		await withProgress('Checking dependencies on OSV.dev…', async () => {
			for (const u of files) {
				const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(u));
				if (u.fsPath.endsWith('package.json') && files.some(x => x.fsPath === u.fsPath.replace(/package\.json$/, 'package-lock.json'))) { continue; }
				const deps = parseDeps(u.fsPath, text).slice(0, 1000); if (!deps.length) { continue; }
				const r = await fetch('https://api.osv.dev/v1/querybatch', { method: 'POST', body: JSON.stringify({ queries: deps.map(d => ({ package: { name: d.name, ecosystem: d.eco }, version: d.version })) }) });
				const j = await r.json() as { results: { vulns?: { id: string }[] }[] };
				const diags: vscode.Diagnostic[] = [];
				for (const [i, res] of j.results.entries()) {
					if (!res.vulns?.length) { continue; } const d = deps[i]; total++;
					const idx = Math.max(0, text.indexOf(`"${d.name}"`) >= 0 ? text.indexOf(`"${d.name}"`) : text.indexOf(d.name)); const pos = new vscode.Position(text.slice(0, idx).split('\n').length - 1, 0);
					const g = new vscode.Diagnostic(new vscode.Range(pos, pos.translate(0, 200)), `${d.name}@${d.version}: ${res.vulns.length} known vulnerabilit${res.vulns.length > 1 ? 'ies' : 'y'} (${res.vulns.slice(0, 4).map(v => v.id).join(', ')}${res.vulns.length > 4 ? ', …' : ''})`, vscode.DiagnosticSeverity.Warning);
					g.source = 'OSV'; g.code = { value: res.vulns[0].id, target: vscode.Uri.parse(`https://osv.dev/vulnerability/${res.vulns[0].id}`) }; diags.push(g);
				}
				sca.set(u, diags);
			}
		});
		await vscode.commands.executeCommand('workbench.actions.view.problems');
		vscode.window.showInformationMessage(total ? `OSV: ${total} vulnerable dependenc${total > 1 ? 'ies' : 'y'} (see Problems).` : 'OSV: no known vulnerabilities in pinned dependencies.');
	});
	// ---- safe AI refactor
	register(ctx, 'axiora.refactor.safe', async () => {
		const ed = vscode.window.activeTextEditor; const r = wsRoot(); if (!ed || !r) { return; }
		const what = await vscode.window.showInputBox({ prompt: vscode.l10n.t("Refactoring (behaviour must not change)"), placeHolder: vscode.l10n.t("extract the validation into a function; rename x to total; replace loop with map…") }); if (!what) { return; }
		const doc = ed.document; const range = ed.selection.isEmpty ? new vscode.Range(0, 0, doc.lineCount, 0) : new vscode.Range(ed.selection.start.with(undefined, 0), ed.selection.end.with(ed.selection.end.line + 1, 0));
		const before = doc.getText(range);
		const after = unfence(await withProgress('Refactoring…', t => ask(`Apply this behaviour-preserving refactoring: ${what}\nReturn ONLY the rewritten code for the given range, nothing else.\n\n\`\`\`${doc.languageId}\n${before}\n\`\`\``, SYS, t))) + (before.endsWith('\n') ? '\n' : '');
		if (after.trim() === before.trim() || after.trim().length < 2) { vscode.window.showInformationMessage(vscode.l10n.t("The model proposed no change.")); return; }
		const prop = vscode.Uri.parse(`untitled:${path.basename(doc.fileName)}.refactor${path.extname(doc.fileName)}`);
		const pd = await vscode.workspace.openTextDocument(prop); const we = new vscode.WorkspaceEdit(); we.insert(prop, new vscode.Position(0, 0), doc.getText().replace(before, after)); await vscode.workspace.applyEdit(we);
		await vscode.commands.executeCommand('vscode.diff', doc.uri, pd.uri, `Refactor preview: ${what}`);
		const test = vscode.workspace.getConfiguration('axiora.solo').get<string>('testCommand', '') || (await vscode.workspace.findFiles('package.json', undefined, 1)).length && 'npm test --silent' || '';
		const a = await vscode.window.showInformationMessage(vscode.l10n.t("Apply refactoring{0}?", test ? ` and verify with "${test}"` : ''), 'Apply', 'Discard'); if (a !== 'Apply') { return; }
		const orig = doc.getText(); const ed2 = new vscode.WorkspaceEdit(); ed2.replace(doc.uri, range, after); await vscode.workspace.applyEdit(ed2); await doc.save();
		if (!test) { vscode.window.showInformationMessage(vscode.l10n.t("Refactoring applied (no test command configured — set axiora.solo.testCommand to verify automatically).")); return; }
		const ok = await run('bash', ['-lc', `${test} 2>&1`], r.fsPath).then(() => true, () => false);
		if (ok) { vscode.window.showInformationMessage(vscode.l10n.t("Refactoring applied — tests still pass ✓")); return; }
		const back = new vscode.WorkspaceEdit(); back.replace(doc.uri, new vscode.Range(0, 0, doc.lineCount, 0), orig); await vscode.workspace.applyEdit(back); await doc.save();
		vscode.window.showWarningMessage(vscode.l10n.t("Tests failed after the refactoring — it was rolled back."));
	});
	// ---- property tests: run + counterexample
	register(ctx, 'axiora.propertyTests.run', async () => {
		const ed = vscode.window.activeTextEditor; const r = wsRoot(); if (!ed || !r) { return; } await ed.document.save();
		const f = ed.document.fileName; const py = f.endsWith('.py');
		const cmd = py ? `python3 -m pytest -q -p no:cacheprovider "${f}" 2>&1 || python3 "${f}" 2>&1` : `node --test "${f}" 2>&1`;
		const res = await withProgress('Running property tests…', () => run('bash', ['-lc', `cd "${path.dirname(f)}" && (${cmd}); exit \${PIPESTATUS[0]}`], r.fsPath).then(o => ({ ok: true, o }), e => ({ ok: false, o: String(e.message) })));
		const out = vscode.window.createOutputChannel('Axiora Property Tests'); out.clear(); out.append(res.o);
		const clean = res.o.replace(/^E {0,11}/gm, ''); const fe = /(?:Falsifying example|Failing test case):[\s\S]*?\n\)/.exec(clean)?.[0]?.replace(/\s+/g, ' ') ?? /Counterexample: .*/.exec(clean)?.[0];
		if (res.ok && !/failed|Falsifying|Counterexample/i.test(res.o)) { vscode.window.showInformationMessage(vscode.l10n.t("All properties hold ✓")); out.show(true); return; }
		const a = await vscode.window.showWarningMessage(fe ? `Property violated — ${fe.split('\n').slice(0, 3).join(' ').slice(0, 200)}` : 'Property tests failed.', 'Show Output', 'Fix with AI');
		if (a === 'Show Output') { out.show(); }
		if (a === 'Fix with AI') { await vscode.commands.executeCommand('workbench.action.chat.open', { query: `@axiora The property test ${path.basename(f)} failed.\n${fe ?? res.o.slice(-1500)}\nFind the bug in the code under test and propose the fix.` }); }
	});
}
