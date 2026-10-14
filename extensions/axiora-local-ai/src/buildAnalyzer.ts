/*---------------------------------------------------------------------------------------------
 *  Build Analyzer: run a build (npm/yarn/pnpm script, make, gradle, cargo, tsc or any command)
 *  with per-line timing and get a report: total time, slowest steps (where the build waited),
 *  warnings/errors grouped by message, and an "Ask AI" follow-up. Palette "Build: Analyze
 *  Build..." or the Run and Debug view's "..." menu. Reports are saved in .axiora/builds/.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { register, wsRoot } from './util';

export type Line = { t: number; s: string };
export function analyze(lines: Line[], total: number) {
	const steps = [{ s: '(startup — before first output)', dur: lines[0]?.t ?? total }, ...lines.map((l, i) => ({ s: l.s, dur: (lines[i + 1]?.t ?? total) - l.t }))].filter(x => x.s.trim());
	const slow = [...steps].sort((a, b) => b.dur - a.dur).slice(0, 10);
	const norm = (s: string) => s.replace(/\d+/g, 'N').replace(/(['"`]).*?\1/g, '…').replace(/\S+\.(ts|js|py|java|kt|rs|c|cpp|go)\b/g, '‹file›').trim().slice(0, 140);
	const group = (re: RegExp) => { const m = new Map<string, number>(); for (const l of lines) { if (re.test(l.s)) { const k = norm(l.s); m.set(k, (m.get(k) ?? 0) + 1); } } return [...m.entries()].sort((a, b) => b[1] - a[1]); };
	return { slow, warnings: group(/\bwarn(ing)?\b/i), errors: group(/\berror\b|\bfailed\b|✖/i) };
}
export function activate(ctx: vscode.ExtensionContext) {
	register(ctx, 'axiora.build.analyze', async () => {
		const root = wsRoot()?.fsPath; if (!root) { return; }
		const cands: string[] = [];
		try { const pk = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')); const pm = fs.existsSync(path.join(root, 'pnpm-lock.yaml')) ? 'pnpm' : fs.existsSync(path.join(root, 'yarn.lock')) ? 'yarn' : 'npm run'; for (const s of Object.keys(pk.scripts ?? {})) { cands.push(`${pm} ${s}`); } } catch { /* none */ }
		if (fs.existsSync(path.join(root, 'Makefile'))) { cands.push('make'); }
		if (fs.existsSync(path.join(root, 'Cargo.toml'))) { cands.push('cargo build --timings'); }
		if (fs.existsSync(path.join(root, 'gradlew'))) { cands.push('./gradlew build --profile'); }
		if (fs.existsSync(path.join(root, 'tsconfig.json'))) { cands.push('npx tsc --noEmit --extendedDiagnostics'); }
		const last = ctx.workspaceState.get<string>('axiora.build.last');
		const pick = await vscode.window.showQuickPick([...(last ? [{ label: last, description: vscode.l10n.t("last used") }] : []), ...cands.filter(c => c !== last).map(c => ({ label: c, description: '' })), { label: '$(edit) Custom command...', description: '' }], { placeHolder: vscode.l10n.t("Build command to analyze") });
		if (!pick) { return; }
		const cmd = pick.label.startsWith('$(edit)') ? await vscode.window.showInputBox({ prompt: vscode.l10n.t("Build command") }) : pick.label; if (!cmd) { return; }
		await ctx.workspaceState.update('axiora.build.last', cmd);
		const lines: Line[] = []; const t0 = Date.now(); let code: number | null = null;
		await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: vscode.l10n.t("Analyzing build: {0}", cmd), cancellable: true }, (prog, tok) => new Promise<void>(res => {
			const p = cp.spawn(process.platform === 'win32' ? 'cmd' : 'sh', process.platform === 'win32' ? ['/c', cmd] : ['-c', cmd], { cwd: root, env: { ...process.env, FORCE_COLOR: '0' } });
			let buf = ''; const on = (d: Buffer) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { lines.push({ t: Date.now() - t0, s: buf.slice(0, i).replace(/\x1b\[[0-9;]*m/g, '') }); buf = buf.slice(i + 1); prog.report({ message: lines[lines.length - 1].s.slice(0, 80) }); } };
			p.stdout.on('data', on); p.stderr.on('data', on); tok.onCancellationRequested(() => p.kill());
			p.on('close', c => { if (buf) { lines.push({ t: Date.now() - t0, s: buf }); } code = c; res(); }); p.on('error', e => { lines.push({ t: 0, s: `error: ${e.message}` }); res(); });
		}));
		const total = Date.now() - t0; const a = analyze(lines, total);
		const fmt = (ms: number) => ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms}ms`;
		const diag = lines.filter(l => /^(Files|Lines|Check time|Parse time|Bind time|Emit time|Total time|Memory used|I\/O read|Program time):/.test(l.s)).map(l => `| ${l.s.split(':')[0]} | ${l.s.split(':').slice(1).join(':').trim()} |`);
		const md = `# Build analysis: \`${cmd}\`\n\n**${code === 0 ? '✅ succeeded' : `❌ failed (exit ${code})`}** in **${fmt(total)}** · ${lines.length} output lines · ${a.warnings.reduce((n, w) => n + w[1], 0)} warnings · ${a.errors.reduce((n, w) => n + w[1], 0)} errors\n\n` +
			`## Slowest steps (time until the next output)\n| Time | Share | Step |\n|---:|---:|---|\n${a.slow.map(s => `| ${fmt(s.dur)} | ${Math.round(100 * s.dur / Math.max(1, total))}% | \`${s.s.trim().slice(0, 120).replace(/\|/g, '\\|')}\` |`).join('\n')}\n\n` +
			(diag.length ? `## Compiler diagnostics\n| Metric | Value |\n|---|---|\n${diag.join('\n')}\n\n` : '') +
			`## Errors\n${a.errors.map(([k, n]) => `- ${n}× ${k}`).join('\n') || '_none_'}\n\n## Warnings\n${a.warnings.slice(0, 20).map(([k, n]) => `- ${n}× ${k}`).join('\n') || '_none_'}\n`;
		const dir = path.join(root, '.axiora', 'builds'); fs.mkdirSync(dir, { recursive: true });
		const f = path.join(dir, `${new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15)}.md`); fs.writeFileSync(f, md + `\n## Raw log (with timestamps)\n\`\`\`\n${lines.map(l => `[${fmt(l.t).padStart(8)}] ${l.s}`).join('\n')}\n\`\`\`\n`);
		await vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.file(f));
		if (await vscode.window.showInformationMessage(vscode.l10n.t("Build {0} in {1}.", code === 0 ? 'finished' : 'failed', fmt(total)), 'Ask AI How to Speed Up') ) {
			await vscode.commands.executeCommand('workbench.action.chat.open', { query: `@axiora Analyze this build report and tell me how to make the build faster${code ? ' and fix the failure' : ''}:\n${md.slice(0, 6000)}` });
		}
	});
}
