/*---------------------------------------------------------------------------------------------
 *  Single owner of the 'type' command so macros and Vim mode can both intercept typing.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';

export type TypeHandler = (text: string) => Promise<boolean> | boolean; // true = consumed
const handlers: TypeHandler[] = [];
let reg: vscode.Disposable | undefined;

function sync() {
	if (handlers.length && !reg) {
		reg = vscode.commands.registerCommand('type', async (args: { text: string }) => {
			for (const h of [...handlers]) { if (await h(args.text)) { return; } }
			return vscode.commands.executeCommand('default:type', args);
		});
	} else if (!handlers.length && reg) { reg.dispose(); reg = undefined; }
}
export function addTypeHandler(h: TypeHandler): vscode.Disposable {
	handlers.push(h); sync();
	return { dispose: () => { const i = handlers.indexOf(h); if (i >= 0) { handlers.splice(i, 1); } sync(); } };
}
