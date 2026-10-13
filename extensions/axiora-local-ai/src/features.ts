import * as vscode from 'vscode';
import * as promptTools from './promptTools';
import * as terminalNL from './terminalNL';
import * as commitMsg from './commitMsg';
import * as aiActions from './aiActions';
export function activateFeatures(ctx: vscode.ExtensionContext) {
	for (const f of [promptTools, terminalNL, commitMsg, aiActions]) { try { f.activate(ctx); } catch (e) { console.error(e); } }
}
