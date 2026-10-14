/*---------------------------------------------------------------------------------------------
 *  Arena mode: "@axiora /arena <prompt>" sends the prompt to two models side by side
 *  (blind), you vote, and a local leaderboard tracks which model wins for you.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { chatCommands, register, SYS } from './util';
import { chat, listModels } from './llm';

export function activate(ctx: vscode.ExtensionContext) {
	const board = () => ctx.globalState.get<Record<string, { w: number; n: number }>>('axiora.arena', {});
	ctx.subscriptions.push(vscode.commands.registerCommand('axiora.arena.vote', async (winner: string, loser: string) => {
		const b = board(); for (const m of [winner, loser]) { b[m] ??= { w: 0, n: 0 }; b[m].n++; } if (winner !== loser) { b[winner].w++; }
		await ctx.globalState.update('axiora.arena', b);
		vscode.window.showInformationMessage(vscode.l10n.t("Vote recorded: {0} wins over {1}.", winner, loser));
	}));
	register(ctx, 'axiora.arena.leaderboard', async () => {
		const rows = Object.entries(board()).sort((a, b) => b[1].w / b[1].n - a[1].w / a[1].n);
		await vscode.window.showQuickPick(rows.map(([m, s], i) => ({ label: `${i + 1}. ${m}`, description: `${s.w}/${s.n} wins (${Math.round(100 * s.w / Math.max(1, s.n))}%)` })), { placeHolder: rows.length ? 'Arena leaderboard' : 'No votes yet: try @axiora /arena' });
	});
	chatCommands.set('arena', async (req, stream, token) => {
		const models = await listModels();
		const pref = vscode.workspace.getConfiguration('axiora.arena').get<string[]>('models', []);
		const pool = (pref.length >= 2 ? pref : models).slice();
		if (pool.length < 1) { stream.markdown(vscode.l10n.t("No models available. Configure Ollama or an OpenAI-compatible endpoint.")); return; }
		const shuffled = pool.sort(() => Math.random() - 0.5); const a = shuffled[0], b = shuffled[1] ?? shuffled[0];
		stream.progress(vscode.l10n.t("Asking two models…"));
		const msgs = [{ role: 'system' as const, content: SYS }, { role: 'user' as const, content: req.prompt }];
		const [ra, rb] = await Promise.all([chat(msgs, () => undefined, token, a).catch(e => `Error: ${e.message}`), chat(msgs, () => undefined, token, b).catch(e => `Error: ${e.message}`)]);
		stream.markdown(vscode.l10n.t("### Model A\n\n{0}\n\n---\n\n### Model B\n\n{1}\n\n---\n", ra, rb));
		stream.button({ title: vscode.l10n.t("A is better"), command: 'axiora.arena.vote', arguments: [a, b] });
		stream.button({ title: vscode.l10n.t("B is better"), command: 'axiora.arena.vote', arguments: [b, a] });
	});
}
