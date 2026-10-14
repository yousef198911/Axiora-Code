/*---------------------------------------------------------------------------------------------
 *  Shelve / Unshelve (JetBrains-style): park selected changed files as a named patch under
 *  .git/axiora-shelf, revert them in the working tree, and re-apply later. Plus named
 *  change lists that group files for partial commits.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { register, run, wsRoot } from './util';

async function changed(root: string) {
	return (await run('git', ['status', '--porcelain'], root)).split('\n').filter(Boolean).map(l => ({ st: l.slice(0, 2), f: l.slice(3).replace(/^.* -> /, '') }));
}
export function activate(ctx: vscode.ExtensionContext) {
	const shelf = (root: string) => { const d = path.join(root, '.git', 'axiora-shelf'); fs.mkdirSync(d, { recursive: true }); return d; };
	register(ctx, 'axiora.shelve.shelve', async (...args: unknown[]) => {
		const root = wsRoot()?.fsPath; if (!root) { return; }
		const fromScm = args.flat().filter((a): a is { resourceUri: vscode.Uri } => !!(a as { resourceUri?: vscode.Uri })?.resourceUri).map(a => path.relative(root, a.resourceUri.fsPath));
		let files = fromScm;
		if (!files.length) {
			const ch = (await changed(root)).filter(c => c.st !== '??');
			const p = await vscode.window.showQuickPick(ch.map(c => ({ label: c.f, description: c.st.trim(), picked: true })), { canPickMany: true, placeHolder: vscode.l10n.t("Files to shelve") });
			if (!p?.length) { return; } files = p.map(x => x.label);
		}
		const name = await vscode.window.showInputBox({ prompt: vscode.l10n.t("Shelf name"), value: `shelf ${new Date().toLocaleString()}` }); if (!name) { return; }
		const patch = await run('git', ['diff', 'HEAD', '--binary', '--', ...files], root);
		if (!patch.trim()) { vscode.window.showWarningMessage(vscode.l10n.t("Nothing to shelve.")); return; }
		fs.writeFileSync(path.join(shelf(root), `${Date.now()}.patch`), `# ${name}\n# files: ${files.join(', ')}\n${patch}`);
		await run('git', ['checkout', 'HEAD', '--', ...files], root);
		vscode.window.showInformationMessage(vscode.l10n.t("Shelved {0} file(s) as \"{1}\".", files.length, name));
	});
	const pickShelf = async (root: string, placeHolder: string) => {
		const d = shelf(root);
		const items = fs.readdirSync(d).filter(f => f.endsWith('.patch')).sort().reverse().map(f => { const head = fs.readFileSync(path.join(d, f), 'utf8').split('\n'); return { label: `$(archive) ${head[0].slice(2)}`, description: head[1].slice(9), file: path.join(d, f) }; });
		if (!items.length) { vscode.window.showInformationMessage(vscode.l10n.t("The shelf is empty.")); return undefined; }
		return vscode.window.showQuickPick(items, { placeHolder });
	};
	register(ctx, 'axiora.shelve.unshelve', async () => {
		const root = wsRoot()?.fsPath; if (!root) { return; }
		const p = await pickShelf(root, 'Unshelve which changes?'); if (!p) { return; }
		const body = fs.readFileSync(p.file, 'utf8').split('\n').slice(2).join('\n');
		const tmp = p.file + '.apply'; fs.writeFileSync(tmp, body);
		try { await run('git', ['apply', '--3way', tmp], root); fs.unlinkSync(p.file); vscode.window.showInformationMessage('Unshelved.'); }
		catch (e) { vscode.window.showErrorMessage(vscode.l10n.t("Unshelve failed: {0}", (e as Error).message)); }
		finally { fs.rmSync(tmp, { force: true }); }
	});
	register(ctx, 'axiora.shelve.view', async () => {
		const root = wsRoot()?.fsPath; if (!root) { return; }
		const p = await pickShelf(root, 'Shelved changes'); if (!p) { return; }
		const a = await vscode.window.showQuickPick(['Show Patch', 'Unshelve', 'Delete']);
		if (a === 'Show Patch') { await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ language: 'diff', content: fs.readFileSync(p.file, 'utf8') })); }
		else if (a === 'Unshelve') { await vscode.commands.executeCommand('axiora.shelve.unshelve'); }
		else if (a === 'Delete') { fs.unlinkSync(p.file); }
	});
	// change lists: named groups of files; "Commit Change List" stages exactly that group
	const lists = () => ctx.workspaceState.get<Record<string, string[]>>('axiora.changelists', {});
	register(ctx, 'axiora.changelist.assign', async (...args: unknown[]) => {
		const root = wsRoot()?.fsPath; if (!root) { return; }
		const files = args.flat().filter((a): a is { resourceUri: vscode.Uri } => !!(a as { resourceUri?: vscode.Uri })?.resourceUri).map(a => path.relative(root, a.resourceUri.fsPath));
		const sel = files.length ? files : (await vscode.window.showQuickPick((await changed(root)).map(c => c.f), { canPickMany: true, placeHolder: 'Files' })) ?? [];
		if (!sel.length) { return; }
		const l = lists();
		const name = (await vscode.window.showQuickPick([...Object.keys(l), '$(add) New Change List...'], { placeHolder: vscode.l10n.t("Move to change list") })); if (!name) { return; }
		const n = name.startsWith('$(add)') ? await vscode.window.showInputBox({ prompt: vscode.l10n.t("Change list name") }) : name; if (!n) { return; }
		for (const k of Object.keys(l)) { l[k] = l[k].filter(f => !sel.includes(f)); }
		l[n] = [...new Set([...(l[n] ?? []), ...sel])];
		await ctx.workspaceState.update('axiora.changelists', l);
	});
	register(ctx, 'axiora.changelist.commit', async () => {
		const root = wsRoot()?.fsPath; if (!root) { return; }
		const l = lists(); const n = await vscode.window.showQuickPick(Object.entries(l).map(([k, v]) => ({ label: k, description: `${v.length} file(s)`, detail: v.join(', ') })), { placeHolder: vscode.l10n.t("Commit which change list?") }); if (!n) { return; }
		const msg = await vscode.window.showInputBox({ prompt: vscode.l10n.t("Commit message for \"{0}\"", n.label) }); if (!msg) { return; }
		await run('git', ['reset', '-q'], root); await run('git', ['add', '--', ...l[n.label]], root); await run('git', ['commit', '-m', msg], root);
		delete l[n.label]; await ctx.workspaceState.update('axiora.changelists', l);
		vscode.window.showInformationMessage(vscode.l10n.t("Committed change list \"{0}\".", n.label));
	});
}
