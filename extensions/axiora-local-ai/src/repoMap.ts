/*---------------------------------------------------------------------------------------------
 *  Repository map (aider-style) + .axioraignore for AI context.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { chatCommands, contextProviders, register, run, wsRoot } from './util';

const DECL = /^\s*(?:export\s+)?(?:default\s+)?(?:public\s+|private\s+|protected\s+|static\s+|async\s+|abstract\s+)*(class|interface|enum|type|function|def|fn|func|struct|trait|impl|module|namespace)\s+([A-Za-z_][\w]*)/;
const CODE = /\.(ts|tsx|js|jsx|mjs|py|go|rs|java|kt|cs|cpp|cc|c|h|hpp|rb|php|swift|scala|dart|lua)$/;

function globToRe(g: string): RegExp {
	g = g.trim().replace(/^\//, '');
	const re = g.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*\*\/?/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0000/g, '.*');
	return new RegExp(`(^|/)${re}(/|$)`);
}
export async function axioraIgnore(): Promise<(p: string) => boolean> {
	const r = wsRoot(); if (!r) { return () => false; }
	let txt = ''; try { txt = new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(r, '.axioraignore'))); } catch { /* none */ }
	const res = txt.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(globToRe);
	return p => res.some(x => x.test(p));
}
export async function repoMap(max = 12000): Promise<string> {
	const r = wsRoot(); if (!r) { return ''; }
	const ignored = await axioraIgnore();
	const files = (await run('git', ['ls-files'], r.fsPath).catch(() => '')).split('\n').filter(f => CODE.test(f) && !ignored(f)).slice(0, 3000);
	let out = '';
	for (const f of files) {
		if (out.length > max) { out += '…(truncated)\n'; break; }
		let text = ''; try { const b = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(r, f)); if (b.byteLength > 300_000) { continue; } text = new TextDecoder().decode(b); } catch { continue; }
		const syms: string[] = [];
		for (const line of text.split('\n')) { const m = DECL.exec(line); if (m) { syms.push(`${m[1]} ${m[2]}`); if (syms.length > 25) { break; } } }
		out += syms.length ? `${f}: ${syms.join(', ')}\n` : `${f}\n`;
	}
	return out;
}
export function activate(ctx: vscode.ExtensionContext) {
	register(ctx, 'axiora.ai.showRepoMap', async () => {
		const m = await repoMap(200_000);
		await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ language: 'markdown', content: `# Repository map\n\n\`\`\`\n${m}\`\`\`\n` }));
	});
	chatCommands.set('map', async (_req, stream) => { stream.markdown(`\`\`\`\n${await repoMap(20000)}\`\`\``); });
	contextProviders.push(async () => vscode.workspace.getConfiguration('axiora.context').get('repoMap', true) ? `\n\nRepository map (files and top-level symbols):\n${await repoMap(4000)}` : '');
}
