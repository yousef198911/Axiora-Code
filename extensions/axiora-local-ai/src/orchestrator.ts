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
async function pool<T>(items: T[], n: number, fn: (t: T, i: number) => Promise<void>) { let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } })); }
export function activate(_ctx: vscode.ExtensionContext) {
	chatCommands.set('parallel', async (req, stream, token) => {
		let base = ''; for (const p of contextProviders.slice(0, 2)) { base += await p().catch(() => ''); }
		stream.progress('Planning subtasks…');
		const plan = parsePlan(await quiet(`${SYS}\nYou are a planner. Split the task into 2-6 INDEPENDENT subtasks that can be done in parallel. Output one per line, no extra text.`, req.prompt + base, token));
		if (!plan.length) { stream.markdown('Could not split this task.'); return; }
		stream.markdown(`**Plan (${plan.length} subagents in parallel):**\n${plan.map((p, i) => `${i + 1}. ${p}`).join('\n')}\n\n`);
		const n = vscode.workspace.getConfiguration('axiora.agents').get<number>('concurrency', 3);
		const results: string[] = new Array(plan.length).fill('');
		let done = 0;
		await pool(plan, n, async (t, i) => {
			results[i] = await quiet(`${SYS}\nYou are subagent #${i + 1}. Do ONLY your subtask, concisely, with code where needed.`, `Overall task: ${req.prompt}\nYour subtask: ${t}${base}`, token).catch(e => `Error: ${e.message}`);
			stream.progress(`Subagents finished: ${++done}/${plan.length}`);
		});
		stream.markdown(results.map((r, i) => `<details><summary>Subagent ${i + 1}: ${plan[i]}</summary>\n\n${r}\n\n</details>`).join('\n') + '\n\n---\n**Merged result:**\n\n');
		await chat([{ role: 'system', content: `${SYS}\nYou are the coordinator. Merge the subagent results into one coherent, deduplicated answer; resolve conflicts.` }, { role: 'user', content: `Task: ${req.prompt}\n\n${results.map((r, i) => `## Subagent ${i + 1} (${plan[i]})\n${r}`).join('\n\n')}` }], s => stream.markdown(s), token);
	});
	chatCommands.set('subagent', async (req, stream, token) => {
		const m = /^([\w -]{2,30}):\s*([\s\S]+)$/.exec(req.prompt); const role = m?.[1] ?? 'general'; const task = m?.[2] ?? req.prompt;
		stream.progress(`Subagent (${role}) working in an isolated context…`);
		const r = await quiet(`${SYS}\nYou are an isolated ${role} subagent. Work the task fully, then reply with a SHORT summary of findings/results only.`, task, token);
		stream.markdown(`**Subagent (${role}) summary:**\n\n${r}`);
	});
}
