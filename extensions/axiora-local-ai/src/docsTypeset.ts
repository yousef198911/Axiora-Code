/*---------------------------------------------------------------------------------------------
 *  LaTeX and Typst: build (latexmk/pdflatex/tectonic, typst), live SVG preview for Typst,
 *  PDF preview via the built-in Chromium viewer, build on save, outline via document symbols.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { register } from './util';

const out = vscode.window.createOutputChannel('LaTeX / Typst');
function exe(cmd: string, args: string[], cwd: string): Promise<void> {
	return new Promise((res, rej) => { out.appendLine(`$ ${cmd} ${args.join(' ')}`); const p = cp.spawn(cmd, args, { cwd }); p.stdout.on('data', d => out.append(String(d))); p.stderr.on('data', d => out.append(String(d))); p.on('error', rej); p.on('close', c => c === 0 ? res() : rej(new Error(`${cmd} exited with ${c} (see "LaTeX / Typst" output)`))); });
}
async function build(doc: vscode.TextDocument): Promise<string> {
	await doc.save();
	const f = doc.uri.fsPath, dir = path.dirname(f), pdf = f.replace(/\.(tex|typ)$/, '.pdf');
	if (doc.languageId === 'typst' || f.endsWith('.typ')) { await exe('typst', ['compile', f, pdf], dir); return pdf; }
	const engine = vscode.workspace.getConfiguration('axiora.latex').get<string>('engine', 'latexmk');
	const args = engine === 'latexmk' ? ['-pdf', '-interaction=nonstopmode', '-synctex=1', path.basename(f)] : engine === 'tectonic' ? [path.basename(f)] : ['-interaction=nonstopmode', '-synctex=1', path.basename(f)];
	try { await exe(engine, args, dir); } catch (e) { if (/ENOENT/.test(String(e))) { throw new Error(`${engine} not found. Install TeX Live / MiKTeX / tectonic, or change axiora.latex.engine.`); } throw e; }
	return pdf;
}
export function activate(ctx: vscode.ExtensionContext) {
	const panels = new Map<string, vscode.WebviewPanel>();
	const showPdf = (pdf: string) => {
		let p = panels.get(pdf);
		const dir = vscode.Uri.file(path.dirname(pdf));
		if (!p) { p = vscode.window.createWebviewPanel('axiora.pdf', `PDF: ${path.basename(pdf)}`, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, { localResourceRoots: [dir], enableScripts: false }); panels.set(pdf, p); p.onDidDispose(() => panels.delete(pdf)); }
		const src = p.webview.asWebviewUri(vscode.Uri.file(pdf)).toString() + `?t=${Date.now()}`;
		p.webview.html = `<!DOCTYPE html><html><body style="margin:0;height:100vh"><embed src="${src}" type="application/pdf" style="width:100%;height:100%"></body></html>`;
	};
	register(ctx, 'axiora.tex.build', async () => {
		const doc = vscode.window.activeTextEditor?.document; if (!doc) { return; }
		const pdf = await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: vscode.l10n.t("Building PDF…") }, () => build(doc));
		if (fs.existsSync(pdf)) { showPdf(pdf); }
	});
	register(ctx, 'axiora.tex.openPdf', async () => { const doc = vscode.window.activeTextEditor?.document; if (doc) { await vscode.env.openExternal(vscode.Uri.file(doc.uri.fsPath.replace(/\.(tex|typ)$/, '.pdf'))); } });
	ctx.subscriptions.push(vscode.workspace.onDidSaveTextDocument(async doc => {
		if (!/\.(tex|typ)$/.test(doc.fileName) || !vscode.workspace.getConfiguration('axiora.latex').get('buildOnSave', true)) { return; }
		const pdf = doc.fileName.replace(/\.(tex|typ)$/, '.pdf');
		if (!panels.has(pdf)) { return; } // only rebuild when a preview is open
		try { await build(doc); showPdf(pdf); } catch (e) { vscode.window.setStatusBarMessage(`$(error) ${(e as Error).message}`, 5000); }
	}));
	// outline for LaTeX sections and Typst headings
	ctx.subscriptions.push(vscode.languages.registerDocumentSymbolProvider([{ language: 'latex' }, { language: 'typst' }], {
		provideDocumentSymbols(doc) {
			const syms: vscode.DocumentSymbol[] = [];
			for (let i = 0; i < doc.lineCount; i++) {
				const t = doc.lineAt(i).text;
				const m = /\\(part|chapter|section|subsection|subsubsection)\*?\{([^}]*)\}/.exec(t) ?? (/^(=+)\s+(.*)$/.exec(t));
				if (m) { const r = doc.lineAt(i).range; syms.push(new vscode.DocumentSymbol(m[2], m[1].startsWith('=') ? `h${m[1].length}` : m[1], vscode.SymbolKind.String, r, r)); }
			}
			return syms;
		}
	}));
}
