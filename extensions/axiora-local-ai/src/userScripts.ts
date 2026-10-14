/*---------------------------------------------------------------------------------------------
 *  Scriptable editor: JavaScript user scripts with full access to the vscode API.
 *  Scripts live in <user>/axiora-scripts and <workspace>/.axiora/scripts. Each exports
 *  `module.exports = async (vscode, api) => {...}`. Scripts named init.js run at startup.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { register, wsRoot, run, log } from './util';

const TEMPLATE = `// Axiora user script. Runs with the full VS Code API.
// api: { run(cmd, args, cwd) -> stdout, log(msg), workspace: path }
module.exports = async (vscode, api) => {
	const ed = vscode.window.activeTextEditor;
	if (!ed) { return; }
	const text = ed.document.getText(ed.selection) || ed.document.lineAt(ed.selection.active.line).text;
	await ed.edit(b => b.replace(ed.selection.isEmpty ? ed.document.lineAt(ed.selection.active.line).range : ed.selection, text.toUpperCase()));
	vscode.window.showInformationMessage('Script done');
};
`;
export function activate(ctx: vscode.ExtensionContext) {
	const dirs = () => [path.join(path.dirname(path.dirname(ctx.globalStorageUri.fsPath)), 'axiora-scripts'), ...(wsRoot() ? [path.join(wsRoot()!.fsPath, '.axiora', 'scripts')] : [])];
	const scripts = () => dirs().flatMap(d => { try { return fs.readdirSync(d).filter(f => f.endsWith('.js')).map(f => path.join(d, f)); } catch { return []; } });
	const exec = async (f: string) => {
		delete require.cache[require.resolve(f)];
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const fn = require(f);
		const main = typeof fn === 'function' ? fn : fn?.default;
		if (typeof main !== 'function') { throw new Error(`${path.basename(f)} does not export a function (module.exports = async (vscode, api) => {...})`); }
		await main(vscode, { run, log: (m: string) => log.info(`[script ${path.basename(f)}] ${m}`), workspace: wsRoot()?.fsPath });
	};
	register(ctx, 'axiora.scripts.run', async () => {
		const p = await vscode.window.showQuickPick(scripts().map(f => ({ label: `$(file-code) ${path.basename(f, '.js')}`, description: f.includes('.axiora') ? 'workspace' : 'user', f })), { placeHolder: vscode.l10n.t("Run user script") });
		if (p) { try { await exec(p.f); } catch (e) { vscode.window.showErrorMessage(vscode.l10n.t("Script failed: {0}", (e as Error).message)); } }
	});
	register(ctx, 'axiora.scripts.new', async () => {
		const where = await vscode.window.showQuickPick(['User (all projects)', 'Workspace (.axiora/scripts)']); if (!where) { return; }
		const name = await vscode.window.showInputBox({ prompt: vscode.l10n.t("Script name"), value: 'upper-case' }); if (!name) { return; }
		const d = dirs()[where.startsWith('User') ? 0 : 1] ?? dirs()[0]; fs.mkdirSync(d, { recursive: true });
		const f = path.join(d, `${name}.js`); if (!fs.existsSync(f)) { fs.writeFileSync(f, TEMPLATE); }
		await vscode.window.showTextDocument(vscode.Uri.file(f));
	});
	register(ctx, 'axiora.scripts.runCurrent', async () => { const d = vscode.window.activeTextEditor?.document; if (d?.fileName.endsWith('.js') && /axiora-scripts|[\\/]\.axiora[\\/]scripts/.test(d.fileName)) { await d.save(); await exec(d.fileName); } else { vscode.window.showInformationMessage(vscode.l10n.t("Open a file from .axiora/scripts or your user axiora-scripts folder.")); } });
	for (const f of scripts().filter(f => path.basename(f) === 'init.js')) { exec(f).catch(e => log.warn(`init script: ${e.message}`)); }
}
