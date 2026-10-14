/*---------------------------------------------------------------------------------------------
 *  Pull requests, issues and CI inside the editor (GitHub REST API; GitHub Enterprise via
 *  axiora.github.apiUrl). Token from "GitHub: Set Token" (SecretStorage) — public repos work
 *  without one. Repo from the origin remote or axiora.github.repo.
 *  PRs: list, view description, open diff, check out, AI review (+ suggested fixes), comment.
 *  Issues: list, view, create a branch for it, ask @axiora to implement it.
 *  CI: workflow runs for the current branch, failed jobs + log tail, AI failure analysis.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { register, run, wsRoot, ask, SYS, withProgress } from './util';
import { RULES } from './security';

const LANG: Record<string, string> = { js: 'javascript', jsx: 'javascriptreact', ts: 'typescript', tsx: 'typescriptreact', mjs: 'javascript', cjs: 'javascript', py: 'python' };
/** Scan only the lines a diff adds. */
export function scanDiff(diff: string) {
	const out: { file: string; line: number; id: string; msg: string; text: string }[] = []; let file = ''; let n = 0;
	for (const l of diff.split('\n')) {
		const f = /^\+\+\+ b\/(.+)$/.exec(l); if (f) { file = f[1]; continue; }
		const h = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(l); if (h) { n = +h[1]; continue; }
		if (l.startsWith('+') && !l.startsWith('+++')) { const lang = LANG[file.split('.').pop() ?? ''] ?? ''; for (const r of RULES) { if (r.langs && !r.langs.includes(lang)) { continue; } if (r.re.test(l.slice(1))) { out.push({ file, line: n, id: r.id, msg: r.msg, text: l.slice(1).trim().slice(0, 120) }); } } n++; }
		else if (!l.startsWith('-')) { n++; }
	}
	return out;
}
async function securityReport(title: string, diff: string, token: vscode.CancellationToken) {
	const hits = scanDiff(diff);
	const ai = await ask(`Security review of this change. Only real, exploitable issues introduced by the ADDED lines: injection, authz/authn, secrets, SSRF, path traversal, deserialization, crypto, unsafe deps. For each: [severity] file:line — issue — fix (code). If none, say so.\n\nStatic findings: ${JSON.stringify(hits)}\n\n${diff.slice(0, 60000)}`, SYS, token);
	return `# Security review: ${title}\n\n## Static scan of added lines (${hits.length})\n${hits.map(h => `- **${h.id}** \`${h.file}:${h.line}\` — ${h.msg}  \n  \`${h.text.replace(/`/g, "'")}\``).join('\n') || '_No rule matches._'}\n\n## AI security review\n${ai}\n`;
}

export function parseRemote(url: string): string | undefined { return /github[^/:]*[:/]([^/]+\/[^/.]+?)(?:\.git)?\/?$/.exec(url.trim())?.[1]; }
export function activate(ctx: vscode.ExtensionContext) {
	const api = () => vscode.workspace.getConfiguration('axiora.github').get<string>('apiUrl', 'https://api.github.com').replace(/\/$/, '');
	const repo = async () => { const r = vscode.workspace.getConfiguration('axiora.github').get<string>('repo', ''); if (r) { return r; } const root = wsRoot(); if (!root) { return undefined; } try { return parseRemote(await run('git', ['remote', 'get-url', 'origin'], root.fsPath)); } catch { return undefined; } };
	const gh = async (p: string, init: RequestInit = {}) => {
		const tok = await ctx.secrets.get('axiora.github.token');
		const r = await fetch(`${api()}${p}`, { ...init, headers: { accept: 'application/vnd.github+json', 'user-agent': 'Axiora', ...(tok ? { authorization: `Bearer ${tok}` } : {}), ...(init.headers ?? {}) } });
		if (!r.ok) { throw new Error(`GitHub ${r.status}: ${(await r.text()).slice(0, 200)}${r.status === 404 || r.status === 401 ? ' (private repo? run "GitHub: Set Token")' : ''}`); }
		return /json/.test(r.headers.get('content-type') ?? '') ? r.json() : r.text();
	};
	const need = async () => { const r = await repo(); if (!r) { vscode.window.showWarningMessage(vscode.l10n.t("No GitHub repository: add an origin remote or set axiora.github.repo (owner/name)."), 'Set Repository').then(a => a && vscode.commands.executeCommand('workbench.action.openSettings', 'axiora.github.repo')); } return r; };
	const show = async (content: string, language = 'markdown') => vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ language, content }), { preview: true });
	register(ctx, 'axiora.github.setToken', async () => { const t = await vscode.window.showInputBox({ prompt: vscode.l10n.t("GitHub token (fine-grained, repo read; write only if you want to comment)"), password: true }); if (t !== undefined) { await ctx.secrets.store('axiora.github.token', t); } });
	register(ctx, 'axiora.github.prs', async () => {
		const r = await need(); if (!r) { return; }
		const prs = await gh(`/repos/${r}/pulls?state=open&per_page=50`) as { number: number; title: string; user: { login: string }; head: { ref: string }; draft: boolean; body: string; html_url: string }[];
		const p = await vscode.window.showQuickPick(prs.map(x => ({ label: `$(git-pull-request${x.draft ? '-draft' : ''}) #${x.number} ${x.title}`, description: `${x.user.login} · ${x.head.ref}`, x })), { placeHolder: vscode.l10n.t("{0}: {1} open pull requests", r, prs.length), matchOnDescription: true });
		if (!p) { return; }
		const a = await vscode.window.showQuickPick(['Show Description', 'Show Diff', 'AI Review', 'Security Review', 'Check Out', 'Add Comment...', 'Open on GitHub'], { placeHolder: `#${p.x.number} ${p.x.title}` }); if (!a) { return; }
		const diff = () => gh(`/repos/${r}/pulls/${p.x.number}`, { headers: { accept: 'application/vnd.github.v3.diff' } }) as Promise<string>;
		if (a === 'Show Description') { await show(`# #${p.x.number} ${p.x.title}\n\n_${p.x.user.login} wants to merge \`${p.x.head.ref}\`_\n\n${p.x.body ?? ''}`); }
		else if (a === 'Show Diff') { await show(await diff(), 'diff'); }
		else if (a === 'AI Review') { const d = await diff(); const out = await withProgress(`Reviewing #${p.x.number}…`, t => ask(`Review this pull request. List concrete issues (bugs, security, tests, style) as: [severity] file:line — problem — suggested fix (with a code snippet). End with a verdict.\n\nTitle: ${p.x.title}\n${p.x.body ?? ''}\n\n${d.slice(0, 60000)}`, SYS, t)); await show(`# AI review of #${p.x.number}\n\n${out}`); }
		else if (a === 'Security Review') { const d = await diff(); await show(await withProgress(`Security review of #${p.x.number}…`, t => securityReport(`#${p.x.number} ${p.x.title}`, d, t))); }
		else if (a === 'Check Out') { const root = wsRoot()!.fsPath; await run('git', ['fetch', 'origin', `pull/${p.x.number}/head:pr-${p.x.number}`], root); await run('git', ['checkout', `pr-${p.x.number}`], root); vscode.window.showInformationMessage(vscode.l10n.t("Checked out PR #{0} as pr-{1}.", p.x.number, p.x.number)); }
		else if (a === 'Add Comment...') { const body = await vscode.window.showInputBox({ prompt: vscode.l10n.t("Comment on #{0}", p.x.number) }); if (body && await vscode.window.showWarningMessage(vscode.l10n.t("Post this comment publicly on #{0}?", p.x.number), { modal: true }, 'Post') === 'Post') { await gh(`/repos/${r}/issues/${p.x.number}/comments`, { method: 'POST', body: JSON.stringify({ body }) }); } }
		else { await vscode.env.openExternal(vscode.Uri.parse(p.x.html_url)); }
	});
	register(ctx, 'axiora.git.securityReview', async () => {
		const root = wsRoot(); if (!root) { return; }
		const d = await run('git', ['diff', 'HEAD'], root.fsPath).catch(() => '');
		if (!d.trim()) { vscode.window.showInformationMessage(vscode.l10n.t("No uncommitted changes to review.")); return; }
		await show(await withProgress('Security review of local changes…', t => securityReport('uncommitted changes', d, t)));
	});
	register(ctx, 'axiora.github.issues', async () => {
		const r = await need(); if (!r) { return; }
		const is = (await gh(`/repos/${r}/issues?state=open&per_page=50`) as { number: number; title: string; body: string; labels: { name: string }[]; pull_request?: unknown; html_url: string; user: { login: string } }[]).filter(i => !i.pull_request);
		const p = await vscode.window.showQuickPick(is.map(x => ({ label: `$(issues) #${x.number} ${x.title}`, description: x.labels.map(l => l.name).join(', '), x })), { placeHolder: vscode.l10n.t("{0}: {1} open issues", r, is.length), matchOnDescription: true });
		if (!p) { return; }
		const a = await vscode.window.showQuickPick(['Show', 'Create Branch', 'Ask @axiora to Implement', 'Open on GitHub']); if (!a) { return; }
		if (a === 'Show') { await show(`# #${p.x.number} ${p.x.title}\n\n_opened by ${p.x.user.login}_\n\n${p.x.body ?? ''}`); }
		else if (a === 'Create Branch') { const b = `issue-${p.x.number}-${p.x.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40).replace(/-$/, '')}`; await run('git', ['checkout', '-b', b], wsRoot()!.fsPath); vscode.window.showInformationMessage(vscode.l10n.t("Created branch {0}.", b)); }
		else if (a.startsWith('Ask')) { await vscode.commands.executeCommand('workbench.action.chat.open', { query: `@axiora /spec Implement GitHub issue #${p.x.number}: ${p.x.title}\n\n${(p.x.body ?? '').slice(0, 3000)}`, isPartialQuery: true }); }
		else { await vscode.env.openExternal(vscode.Uri.parse(p.x.html_url)); }
	});
	register(ctx, 'axiora.github.ci', async () => {
		const r = await need(); if (!r) { return; }
		let branch = ''; try { branch = (await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], wsRoot()!.fsPath)).trim(); } catch { /* none */ }
		const runs = (await gh(`/repos/${r}/actions/runs?per_page=20${branch && branch !== 'HEAD' ? `&branch=${encodeURIComponent(branch)}` : ''}`) as { workflow_runs: { id: number; name: string; status: string; conclusion: string | null; head_branch: string; created_at: string; html_url: string }[] }).workflow_runs;
		const icon = (x: { status: string; conclusion: string | null }) => x.status !== 'completed' ? '$(sync~spin)' : x.conclusion === 'success' ? '$(pass)' : x.conclusion === 'failure' ? '$(error)' : '$(circle-slash)';
		const p = await vscode.window.showQuickPick(runs.map(x => ({ label: `${icon(x)} ${x.name}`, description: `${x.head_branch} · ${x.conclusion ?? x.status}`, detail: new Date(x.created_at).toLocaleString(), x })), { placeHolder: runs.length ? `CI runs for ${r}${branch ? ` (${branch})` : ''}` : 'No workflow runs' });
		if (!p) { return; }
		const jobs = (await gh(`/repos/${r}/actions/runs/${p.x.id}/jobs`) as { jobs: { id: number; name: string; conclusion: string | null; steps: { name: string; conclusion: string | null }[] }[] }).jobs;
		let rep = `# ${p.x.name} — ${p.x.conclusion ?? p.x.status}\n${p.x.html_url}\n\n`;
		for (const j of jobs) { rep += `## ${j.conclusion === 'failure' ? '❌' : j.conclusion === 'success' ? '✅' : '•'} ${j.name}\n${j.steps.map(s => `- ${s.conclusion === 'failure' ? '❌' : s.conclusion === 'success' ? '✅' : '•'} ${s.name}`).join('\n')}\n\n`; }
		const failed = jobs.find(j => j.conclusion === 'failure');
		if (failed) {
			try { const log = await gh(`/repos/${r}/actions/jobs/${failed.id}/logs`) as string; const tail = log.split('\n').slice(-120).join('\n'); rep += `## Log tail (${failed.name})\n\`\`\`\n${tail}\n\`\`\`\n`; if (await vscode.window.showInformationMessage(vscode.l10n.t("Job \"{0}\" failed.", failed.name), 'Analyze with AI') === 'Analyze with AI') { rep += `\n## AI analysis\n${await withProgress('Analyzing CI failure…', t => ask(`This CI job failed. Root cause and exact fix:\n\n${tail}`, SYS, t))}\n`; } }
			catch (e) { rep += `\n_(logs need a token: ${(e as Error).message})_\n`; }
		}
		await show(rep);
	});
}
