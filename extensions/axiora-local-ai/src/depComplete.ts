/*---------------------------------------------------------------------------------------------
 *  Dependency completion in build files: package names and latest versions from npm
 *  (package.json), PyPI (requirements*.txt, pyproject.toml) and crates.io (Cargo.toml),
 *  plus hover with description/latest version. Cached in memory.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';

const cache = new Map<string, Promise<unknown>>();
const getJson = (u: string) => { if (!cache.has(u)) { cache.set(u, fetch(u, { headers: { 'user-agent': 'Axiora/1.0', accept: 'application/json' } }).then(r => r.ok ? r.json() : undefined).catch(() => undefined)); } return cache.get(u)!; };
type Pkg = { name: string; version: string; description?: string };
async function npmSearch(q: string): Promise<Pkg[]> { const j = await getJson(`https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(q)}&size=15`) as { objects?: { package: Pkg }[] }; return j?.objects?.map(o => o.package) ?? []; }
async function npmInfo(n: string): Promise<Pkg | undefined> { const j = await getJson(`https://registry.npmjs.org/${encodeURIComponent(n).replace('%40', '@')}/latest`) as Pkg | undefined; return j?.version ? j : undefined; }
async function pypiInfo(n: string): Promise<Pkg | undefined> { const j = await getJson(`https://pypi.org/pypi/${encodeURIComponent(n)}/json`) as { info?: { name: string; version: string; summary: string } }; return j?.info ? { name: j.info.name, version: j.info.version, description: j.info.summary } : undefined; }
async function crateSearch(q: string): Promise<Pkg[]> { const j = await getJson(`https://crates.io/api/v1/crates?q=${encodeURIComponent(q)}&per_page=15`) as { crates?: { name: string; max_stable_version: string; description: string }[] }; return j?.crates?.map(c => ({ name: c.name, version: c.max_stable_version, description: c.description })) ?? []; }
type Eco = 'npm' | 'pypi' | 'cargo';
function eco(doc: vscode.TextDocument): Eco | undefined {
	const f = doc.fileName.split(/[\\/]/).pop() ?? '';
	if (f === 'package.json') { return 'npm'; } if (/^requirements.*\.txt$|^pyproject\.toml$/.test(f)) { return 'pypi'; } if (f === 'Cargo.toml') { return 'cargo'; }
	return undefined;
}
function inDeps(doc: vscode.TextDocument, line: number): boolean {
	for (let i = line; i >= 0; i--) { const t = doc.lineAt(i).text; if (/"(dev|peer|optional)?[dD]ependencies"\s*:/.test(t) || /^\[(.*dependencies.*)\]/.test(t) || /^\s*dependencies\s*=\s*\[/.test(t)) { return true; } if (/^\s*[}\]]\s*,?\s*$/.test(t) && i < line) { return false; } if (/^\[/.test(t)) { return false; } }
	return doc.fileName.endsWith('.txt');
}
export function activate(ctx: vscode.ExtensionContext) {
	const sel: vscode.DocumentSelector = [{ pattern: '**/package.json' }, { pattern: '**/requirements*.txt' }, { pattern: '**/pyproject.toml' }, { pattern: '**/Cargo.toml' }];
	ctx.subscriptions.push(vscode.languages.registerCompletionItemProvider(sel, {
		async provideCompletionItems(doc, pos) {
			const e = eco(doc); if (!e || !inDeps(doc, pos.line)) { return; }
			const pre = doc.lineAt(pos.line).text.slice(0, pos.character);
			// version position: "name": "^|  or name==|  or name = "|
			const vm = /"([@\w./-]+)"\s*:\s*"[~^]?$/.exec(pre) ?? /^\s*([\w.-]+)\s*(==|>=|~=)$/.exec(pre) ?? /^\s*([\w-]+)\s*=\s*"$/.exec(pre);
			if (vm) {
				const info = e === 'npm' ? await npmInfo(vm[1]) : e === 'pypi' ? await pypiInfo(vm[1]) : (await crateSearch(vm[1])).find(c => c.name === vm[1]);
				if (!info) { return; }
				const it = new vscode.CompletionItem(info.version, vscode.CompletionItemKind.Value); it.detail = `latest ${info.name}`; it.documentation = info.description; it.sortText = '0'; return [it];
			}
			const nm = /"([@\w./-]*)$/.exec(pre) ?? /^\s*([\w.-]*)$/.exec(pre); if (!nm || nm[1].length < 2) { return; }
			const list = e === 'npm' ? await npmSearch(nm[1]) : e === 'cargo' ? await crateSearch(nm[1]) : await (async () => { const i = await pypiInfo(nm[1]); return i ? [i] : []; })();
			return new vscode.CompletionList(list.map((p, i) => {
				const it = new vscode.CompletionItem(p.name, vscode.CompletionItemKind.Module);
				it.detail = `${p.version}${p.description ? ' — ' + p.description : ''}`; it.sortText = String(i).padStart(3, '0');
				it.range = new vscode.Range(pos.line, pos.character - nm[1].length, pos.line, pos.character);
				it.insertText = e === 'npm' ? new vscode.SnippetString(`${p.name}": "^${p.version}`) : e === 'cargo' ? `${p.name} = "${p.version}"` : `${p.name}==${p.version}`;
				return it;
			}), true);
		}
	}, '"', '=', '^'));
	ctx.subscriptions.push(vscode.languages.registerHoverProvider(sel, {
		async provideHover(doc, pos) {
			const e = eco(doc); if (!e || !inDeps(doc, pos.line)) { return; }
			const r = doc.getWordRangeAtPosition(pos, /[@\w./-]+/); if (!r) { return; }
			const n = doc.getText(r); const info = e === 'npm' ? await npmInfo(n) : e === 'pypi' ? await pypiInfo(n) : (await crateSearch(n)).find(c => c.name === n);
			if (!info) { return; }
			const cur = /(\d+\.\d+[\w.-]*)/.exec(doc.lineAt(pos.line).text.slice(r.end.character))?.[1];
			return new vscode.Hover(new vscode.MarkdownString(`**${info.name}** — latest \`${info.version}\`${cur && cur !== info.version ? ` (you use \`${cur}\`)` : ''}\n\n${info.description ?? ''}`), r);
		}
	}));
}
