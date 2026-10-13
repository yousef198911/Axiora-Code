/*---------------------------------------------------------------------------------------------
 *  which-key: press Ctrl+K then pause (or run "Show Key Bindings Hints") to see every chord
 *  continuation with its command, and run one directly. Reads default + user keybindings.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { register } from './util';

type KB = { key: string; command: string; when?: string };
const strip = (s: string) => s.replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[\]}])/g, '$1');
async function allBindings(ctx: vscode.ExtensionContext): Promise<KB[]> {
	const list: KB[] = [];
	const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse('vscode://defaultsettings/keybindings.json'));
	try { list.push(...JSON.parse(strip(doc.getText())) as KB[]); } catch { /* ignore */ }
	for (const e of vscode.extensions.all) { const k = e.packageJSON?.contributes?.keybindings; if (Array.isArray(k)) { list.push(...k.map((b: KB & { linux?: string; mac?: string; win?: string }) => ({ key: (process.platform === 'darwin' ? b.mac : process.platform === 'win32' ? b.win : b.linux) ?? b.key, command: b.command, when: b.when }))); } }
	const user = path.join(path.dirname(path.dirname(ctx.globalStorageUri.fsPath)), 'keybindings.json');
	try { list.push(...JSON.parse(strip(fs.readFileSync(user, 'utf8'))) as KB[]); } catch { /* none */ }
	return list.filter(b => b.key && b.command && !b.command.startsWith('-'));
}
const pretty = (c: string) => c.replace(/^workbench\.action\./, '').replace(/^editor\.action\./, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\./g, ' › ');
export function activate(ctx: vscode.ExtensionContext) {
	const show = async (prefix?: string) => {
		const all = await allBindings(ctx);
		const items = all.filter(b => !prefix || b.key.startsWith(prefix + ' ')).map(b => ({ label: `$(keyboard) ${prefix ? b.key.slice(prefix.length + 1) : b.key}`, description: pretty(b.command), detail: b.when ? `when: ${b.when}` : undefined, cmd: b.command }));
		const p = await vscode.window.showQuickPick(items, { placeHolder: prefix ? `${prefix} …  (${items.length} continuations)` : 'All key bindings: type a key or a command', matchOnDescription: true });
		if (p) { await vscode.commands.executeCommand(p.cmd); }
	};
	register(ctx, 'axiora.whichKey.show', () => show());
	register(ctx, 'axiora.whichKey.ctrlK', () => show('ctrl+k'));
}
