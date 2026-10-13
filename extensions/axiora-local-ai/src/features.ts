import * as vscode from 'vscode';
import * as commitMsg from './commitMsg';
import * as aiActions from './aiActions';
export function activateFeatures(ctx: vscode.ExtensionContext) {
	for (const f of [commitMsg, aiActions]) { try { f.activate(ctx); } catch (e) { console.error(e); } }
}
