/*---------------------------------------------------------------------------------------------
 *  AI token usage & cost report.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { usage } from './llm';
import { register } from './util';

export function activate(ctx: vscode.ExtensionContext) {
	register(ctx, 'axiora.ai.showUsage', async () => {
		const c = vscode.workspace.getConfiguration('axiora.ai');
		const pin = c.get<number>('costPer1kInputTokens', 0), pout = c.get<number>('costPer1kOutputTokens', 0);
		let md = '# Axiora AI usage (this session, approx. tokens = chars/4)\n\n| Model | Requests | Input tokens | Output tokens | Est. cost |\n|---|---|---|---|---|\n';
		let total = 0;
		for (const [m, u] of usage) { const cost = u.input / 1000 * pin + u.output / 1000 * pout; total += cost; md += `| ${m} | ${u.requests} | ${u.input} | ${u.output} | ${cost.toFixed(4)} |\n`; }
		md += `\n**Total estimated cost:** ${total.toFixed(4)} (set \`axiora.ai.costPer1kInputTokens\` / \`axiora.ai.costPer1kOutputTokens\`)\n`;
		await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ language: 'markdown', content: md }));
	});
}
