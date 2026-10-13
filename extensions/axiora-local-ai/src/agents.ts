/*---------------------------------------------------------------------------------------------
 *  Built-in specialized agents as @axiora slash commands, plus property-based test generation.
 *  /tester /architect /security /docs-writer /debugger /perf — each with a tuned system prompt
 *  and the active file/selection as context.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { chatCommands, register, SYS, ask, unfence, withProgress } from './util';
import { chat, routed } from './llm';

const AGENTS: Record<string, string> = {
	tester: 'You are a test engineer. Write thorough, runnable unit tests (edge cases, error paths) using the project\'s existing framework. Output code only with a one-line note on how to run it.',
	architect: 'You are a software architect. Analyze structure, boundaries, coupling and data flow. Propose a concrete design with trade-offs and a step-by-step migration plan.',
	security: 'You are an application security reviewer. Find vulnerabilities (injection, auth, secrets, SSRF, XSS, deserialization, crypto). For each: severity, location, exploit sketch, exact fix.',
	'docs-writer': 'You are a technical writer. Produce clear docs: overview, usage examples, parameters, return values, errors. Markdown.',
	debugger: 'You are a debugging expert. Form hypotheses ranked by likelihood, say how to confirm each (logs, breakpoints, commands), then give the fix.',
	perf: 'You are a performance engineer. Identify hot paths, complexity, allocations and I/O; propose measurable optimizations with expected impact.',
};
function context(): string {
	const ed = vscode.window.activeTextEditor; if (!ed) { return ''; }
	const sel = ed.selection.isEmpty ? ed.document.getText() : ed.document.getText(ed.selection);
	return `\n\nActive file: ${vscode.workspace.asRelativePath(ed.document.uri)} (${ed.document.languageId})\n\`\`\`\n${sel.slice(0, 16000)}\n\`\`\``;
}
export function activate(ctx: vscode.ExtensionContext) {
	for (const [name, prompt] of Object.entries(AGENTS)) {
		chatCommands.set(name, async (req, stream, token) => {
			await chat([{ role: 'system', content: `${SYS}\n${prompt}` }, { role: 'user', content: (req.prompt || 'Analyze the active code.') + context() }], s => stream.markdown(s), token);
			if (routed) { stream.markdown(`\n\n<sub>model: ${routed}</sub>`); }
		});
	}
	register(ctx, 'axiora.ai.propertyTests', async () => {
		const ed = vscode.window.activeTextEditor; if (!ed) { return; }
		const code = ed.selection.isEmpty ? ed.document.getText() : ed.document.getText(ed.selection);
		const lang = ed.document.languageId;
		const lib = /python/.test(lang) ? 'hypothesis' : /java$|kotlin/.test(lang) ? 'jqwik' : /rust/.test(lang) ? 'proptest' : /go/.test(lang) ? 'testing/quick' : 'fast-check';
		const out = await withProgress('Generating property-based tests…', t => ask(`Write property-based tests with ${lib} for this ${lang} code. State each invariant as a comment above its property. Output only code.\n\n${code}`, SYS, t));
		const doc = await vscode.workspace.openTextDocument({ language: lang, content: unfence(out) });
		await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside });
	});
}
