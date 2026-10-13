/*---------------------------------------------------------------------------------------------
 *  Security center: secret scanning (keys, tokens, private keys, passwords) and lightweight
 *  SAST rules (eval, SQL string building, shell injection, innerHTML, weak crypto, TLS off),
 *  plus dependency audit via npm/pip-audit. Findings go to the Problems panel; scan on save.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { register, wsRoot } from './util';

type Rule = { id: string; re: RegExp; msg: string; sev: vscode.DiagnosticSeverity; langs?: string[] };
const E = vscode.DiagnosticSeverity.Error, W = vscode.DiagnosticSeverity.Warning;
export const RULES: Rule[] = [
	{ id: 'secret.aws', re: /\bAKIA[0-9A-Z]{16}\b/, msg: 'AWS access key ID', sev: E },
	{ id: 'secret.github', re: /\b(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/, msg: 'GitHub token', sev: E },
	{ id: 'secret.openai', re: /\bsk-(proj-)?[A-Za-z0-9_-]{20,}\b/, msg: 'API secret key (sk-…)', sev: E },
	{ id: 'secret.slack', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, msg: 'Slack token', sev: E },
	{ id: 'secret.google', re: /\bAIza[0-9A-Za-z_-]{35}\b/, msg: 'Google API key', sev: E },
	{ id: 'secret.stripe', re: /\b[sr]k_live_[0-9a-zA-Z]{20,}\b/, msg: 'Stripe live key', sev: E },
	{ id: 'secret.privatekey', re: /-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/, msg: 'Private key', sev: E },
	{ id: 'secret.jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/, msg: 'JSON Web Token', sev: W },
	{ id: 'secret.password', re: /\b(password|passwd|pwd|secret|api_?key|token)\s*[:=]\s*["'][^"'\s]{6,}["']/i, msg: 'Hard-coded credential', sev: W },
	{ id: 'sast.eval', re: /\b(eval|new Function)\s*\(/, msg: 'Dynamic code execution (eval/new Function)', sev: W, langs: ['javascript', 'typescript', 'javascriptreact', 'typescriptreact', 'python'] },
	{ id: 'sast.sql', re: /\b(SELECT|INSERT|UPDATE|DELETE)\b[^;\n]*["'`]\s*(\+|\$\{|%s|\.format\(|f["'])/i, msg: 'SQL built from strings: use parameterized queries', sev: W },
	{ id: 'sast.shell', re: /\b(child_process\.)?(exec|execSync)\s*\(\s*[`'"][^`'"]*(\$\{|["']\s*\+)|os\.system\(|subprocess\.\w+\([^)]*shell\s*=\s*True/, msg: 'Shell command with interpolated input (command injection risk)', sev: W },
	{ id: 'sast.xss', re: /\.(innerHTML|outerHTML)\s*=|dangerouslySetInnerHTML|document\.write\(/, msg: 'Unsafe HTML sink (XSS risk)', sev: W },
	{ id: 'sast.crypto', re: /\b(md5|sha1)\b\s*\(|createHash\(\s*['"](md5|sha1)['"]|hashlib\.(md5|sha1)\(/i, msg: 'Weak hash algorithm', sev: W },
	{ id: 'sast.tls', re: /rejectUnauthorized\s*:\s*false|verify\s*=\s*False|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0/, msg: 'TLS certificate verification disabled', sev: W },
	{ id: 'sast.pickle', re: /\bpickle\.loads?\(|yaml\.load\((?![^)]*SafeLoader)/, msg: 'Unsafe deserialization', sev: W, langs: ['python'] },
];
export function scanText(text: string, lang: string): { line: number; col: number; len: number; rule: Rule }[] {
	const out: { line: number; col: number; len: number; rule: Rule }[] = [];
	text.split('\n').forEach((l, i) => {
		if (/axiora-ignore-security/.test(l)) { return; }
		for (const r of RULES) { if (r.langs && !r.langs.includes(lang)) { continue; } const m = r.re.exec(l); if (m) { out.push({ line: i, col: m.index, len: m[0].length, rule: r }); } }
	});
	return out;
}
export function activate(ctx: vscode.ExtensionContext) {
	const dc = vscode.languages.createDiagnosticCollection('axiora-security'); ctx.subscriptions.push(dc);
	const diag = (doc: vscode.TextDocument | { uri: vscode.Uri; text: string; lang: string }) => {
		const text = 'getText' in doc ? doc.getText() : doc.text, lang = 'languageId' in doc ? doc.languageId : doc.lang;
		dc.set(doc.uri, scanText(text, lang).map(f => { const d = new vscode.Diagnostic(new vscode.Range(f.line, f.col, f.line, f.col + f.len), `${f.rule.msg}`, f.rule.sev); d.source = 'Axiora Security'; d.code = f.rule.id; return d; }));
	};
	const on = () => vscode.workspace.getConfiguration('axiora.security').get('scanOnSave', true);
	ctx.subscriptions.push(vscode.workspace.onDidSaveTextDocument(d => on() && diag(d)), vscode.workspace.onDidOpenTextDocument(d => on() && d.uri.scheme === 'file' && diag(d)));
	register(ctx, 'axiora.security.scanWorkspace', async () => {
		const files = await vscode.workspace.findFiles('**/*', '{**/node_modules/**,**/.git/**,**/dist/**,**/out/**,**/*.min.js,**/*.{png,jpg,gif,db,bin,zip,pdf,woff*,lock}}', 5000);
		let n = 0;
		await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Security scan', cancellable: true }, async (p, tok) => {
			for (const [i, u] of files.entries()) {
				if (tok.isCancellationRequested) { break; }
				const b = await vscode.workspace.fs.readFile(u); if (b.byteLength > 2_000_000 || b.includes(0)) { continue; }
				const ext = u.path.split('.').pop() ?? ''; const lang = ({ js: 'javascript', ts: 'typescript', py: 'python', jsx: 'javascriptreact', tsx: 'typescriptreact' } as Record<string, string>)[ext] ?? ext;
				diag({ uri: u, text: Buffer.from(b).toString(), lang }); n += (dc.get(u)?.length ?? 0);
				if (i % 50 === 0) { p.report({ message: `${i}/${files.length}`, increment: 5000 / files.length }); }
			}
		});
		vscode.window.showInformationMessage(`Security scan: ${n} finding(s) in ${files.length} files.`, 'Open Problems').then(a => a && vscode.commands.executeCommand('workbench.actions.view.problems'));
	});
	register(ctx, 'axiora.security.auditDeps', async () => {
		const root = wsRoot(); if (!root) { return; }
		const has = async (f: string) => { try { await vscode.workspace.fs.stat(vscode.Uri.joinPath(root, f)); return true; } catch { return false; } };
		const t = vscode.window.createTerminal({ name: 'Dependency Audit', iconPath: new vscode.ThemeIcon('shield') }); t.show();
		if (await has('package.json')) { t.sendText('npm audit'); }
		if (await has('requirements.txt') || await has('pyproject.toml')) { t.sendText('pip-audit || python3 -m pip_audit'); }
		if (await has('Cargo.toml')) { t.sendText('cargo audit'); }
		if (await has('go.mod')) { t.sendText('govulncheck ./...'); }
	});
	ctx.subscriptions.push(vscode.languages.registerCodeActionsProvider('*', {
		provideCodeActions(doc, range, c) {
			return c.diagnostics.filter(d => d.source === 'Axiora Security').map(d => {
				const a = new vscode.CodeAction(`Suppress "${d.code}" on this line`, vscode.CodeActionKind.QuickFix);
				const line = doc.lineAt(d.range.start.line); const cm = /python|shell|yaml|ruby|perl|r\b/.test(doc.languageId) ? '#' : '//';
				a.edit = new vscode.WorkspaceEdit(); a.edit.insert(doc.uri, line.range.end, ` ${cm} axiora-ignore-security`); a.diagnostics = [d]; void range; return a;
			});
		}
	}, { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }));
	vscode.workspace.textDocuments.forEach(d => on() && d.uri.scheme === 'file' && diag(d));
}
