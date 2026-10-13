/*---------------------------------------------------------------------------------------------
 *  Regex assistant and prompt enhancer.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { ask, chatCommands, register, unfence, withProgress } from './util';

async function buildRegex(desc: string, t?: vscode.CancellationToken) {
	return unfence(await ask(`Write a JavaScript regular expression (no slashes, no flags) that matches: ${desc}. Return only the regex in one code block.`, undefined, t)).split('\n')[0];
}
export function activate(ctx: vscode.ExtensionContext) {
	register(ctx, 'axiora.ai.buildRegex', async () => {
		const d = await vscode.window.showInputBox({ prompt: 'Describe the text to find (a regex will be generated and put in Find)' });
		if (!d) { return; }
		const re = await withProgress('building regex…', t => buildRegex(d, t));
		try { new RegExp(re); } catch { vscode.window.showWarningMessage(`Model returned an invalid regex: ${re}`); return; }
		await vscode.commands.executeCommand('editor.actions.findWithArgs', { searchString: re, isRegex: true });
	});
	register(ctx, 'axiora.ai.improvePrompt', async () => {
		const p = await vscode.window.showInputBox({ prompt: 'Prompt to improve' });
		if (!p) { return; }
		const better = await withProgress('improving prompt…', t => ask(`Rewrite this request for an AI coding agent so it is specific, with goals, constraints and acceptance criteria. Keep the user's language. Return only the rewritten prompt.\n\n${p}`, undefined, t));
		await vscode.commands.executeCommand('workbench.action.chat.open', { query: better.trim(), isPartialQuery: true });
	});
	chatCommands.set('regex', async (req, stream, token) => {
		const re = await buildRegex(req.prompt, token);
		let ok = true; try { new RegExp(re); } catch { ok = false; }
		stream.markdown(`\`\`\`regex\n${re}\n\`\`\`\n${ok ? '' : '⚠️ invalid regex'}`);
		if (ok) { stream.button({ command: 'editor.actions.findWithArgs', title: 'Find in editor', arguments: [{ searchString: re, isRegex: true }] }); }
	});
	chatCommands.set('improve', async (req, stream, token) => {
		stream.markdown(await ask(`Rewrite this request for an AI coding agent so it is specific, with goals, constraints and acceptance criteria. Keep the user's language. Return only the rewritten prompt.\n\n${req.prompt}`, undefined, token));
	});
}
