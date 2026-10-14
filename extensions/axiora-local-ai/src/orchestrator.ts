/*---------------------------------------------------------------------------------------------
 *  Parallel orchestrator with subagents: "@axiora /parallel <task>" — a planner splits the task
 *  into independent subtasks, subagents work on them concurrently (configurable concurrency,
 *  each with its own focused context), and a coordinator merges the results into one answer.
 *  "/subagent <role>: <task>" runs one isolated subagent and returns only its summary.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { chatCommands, SYS, contextProviders } from './util';
import { chat } from './llm';

const quiet = (sys: string, user: string, token: vscode.CancellationToken) => chat([{ role: 'system', content: sys }, { role: 'user', content: user }], () => undefined, token);
export function parsePlan(s: string): string[] {
	const lines = s.split('\n').map(l => l.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').trim()).filter(l => l.length > 3 && !/^(subtasks?|plan)\b[:]?$/i.test(l));
	return lines.slice(0, 8);
}
/** Parse coordinator lines "N: RETRY reason" → indices to re-dispatch. */
export function parseVerdict(s: string, n: number): { i: number; why: string }[] {
	return [...s.matchAll(/^\s*#?(\d+)\s*[:.)-]\s*RETRY\b[:\s-]*(.*)$/gim)].map(m => ({ i: +m[1] - 1, why: m[2].trim() || 'incomplete' })).filter(r => r.i >= 0 && r.i < n);
}
async function pool<T>(items: T[], n: number, fn: (t: T, i: number) => Promise<void>) { let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } })); }
export function activate(_ctx: vscode.ExtensionContext) {
	chatCommands.set('parallel', async (req, stream, token) => {
		let base = ''; for (const p of contextProviders.slice(0, 2)) { base += await p().catch(() => ''); }
		stream.progress(vscode.l10n.t("Planning subtasks…"));
		const plan = parsePlan(await quiet(`${SYS}\nYou are a planner. Split the task into 2-6 INDEPENDENT subtasks that can be done in parallel. Output one per line, no extra text.`, req.prompt + base, token));
		if (!plan.length) { stream.markdown(vscode.l10n.t("Could not split this task.")); return; }
		stream.markdown(vscode.l10n.t("**Plan ({0} subagents in parallel):**\n{1}\n\n", plan.length, plan.map((p, i) => `${i + 1}. ${p}`).join('\n')));
		const n = vscode.workspace.getConfiguration('axiora.agents').get<number>('concurrency', 3);
		const results: string[] = new Array(plan.length).fill('');
		let done = 0;
		await pool(plan, n, async (t, i) => {
			results[i] = await quiet(`${SYS}\nYou are subagent #${i + 1}. Do ONLY your subtask, concisely, with code where needed.`, `Overall task: ${req.prompt}\nYour subtask: ${t}${base}`, token).catch(e => `Error: ${e.message}`);
			stream.progress(vscode.l10n.t("Subagents finished: {0}/{1}", ++done, plan.length));
		});
		// coordinator supervision: verify each result, re-dispatch incomplete ones once with feedback
		stream.progress(vscode.l10n.t("Coordinator verifying subagent results…"));
		const verdict = await quiet(`${SYS}\nYou are the coordinator supervising subagents. For each subagent result, reply one line: "N: OK" or "N: RETRY <what is missing>". Nothing else.`, `Task: ${req.prompt}\n\n${results.map((r, i) => `## Subagent ${i + 1} (${plan[i]})\n${r.slice(0, 3000)}`).join('\n\n')}`, token).catch(() => '');
		const retries = parseVerdict(verdict, plan.length);
		if (retries.length) {
			stream.markdown(vscode.l10n.t("**Coordinator:** re-dispatching {0}.\n\n", retries.map(r => `#${r.i + 1}`).join(', ')));
			await pool(retries, n, async r => { results[r.i] = await quiet(`${SYS}\nYou are subagent #${r.i + 1}. Your previous answer was incomplete: ${r.why}. Redo your subtask fully.`, `Overall task: ${req.prompt}\nYour subtask: ${plan[r.i]}\nPrevious answer:\n${results[r.i]}${base}`, token).catch(e => `Error: ${e.message}`); });
		} else { stream.markdown(vscode.l10n.t("**Coordinator:** all subagent results verified ✓\n\n")); }
		stream.markdown(results.map((r, i) => `#### Subagent ${i + 1}: ${plan[i]}\n\n${r}\n`).join("\n") + "\n\n---\n**Merged result:**\n\n");
		await chat([{ role: 'system', content: `${SYS}\nYou are the coordinator. Merge the subagent results into one coherent, deduplicated answer; resolve conflicts.` }, { role: 'user', content: `Task: ${req.prompt}\n\n${results.map((r, i) => `## Subagent ${i + 1} (${plan[i]})\n${r}`).join('\n\n')}` }], s => stream.markdown(s), token);
	});
	chatCommands.set('subagent', async (req, stream, token) => {
		const m = /^([\w -]{2,30}):\s*([\s\S]+)$/.exec(req.prompt); const role = m?.[1] ?? 'general'; const task = m?.[2] ?? req.prompt;
		stream.progress(vscode.l10n.t("Subagent ({0}) working in an isolated context…", role));
		const r = await quiet(`${SYS}\nYou are an isolated ${role} subagent. Work the task fully, then reply with a SHORT summary of findings/results only.`, task, token);
		stream.markdown(vscode.l10n.t("**Subagent ({0}) summary:**\n\n{1}", role, r));
	});
}
