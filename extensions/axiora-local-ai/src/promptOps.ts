/*---------------------------------------------------------------------------------------------
 *  Runtime-editable prompts + automatic context compaction.
 *  - .axiora/prompts/system.md replaces the built-in system prompt (re-read on every request,
 *    so edits apply immediately); .axiora/prompts/<command>.md is appended for /<command>.
 *    "Axiora AI: Edit Prompts..." creates/opens them.
 *  - When a conversation exceeds axiora.chat.maxContextTokens, older turns are summarized
 *    into one compact message (cached), keeping the last turns verbatim.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { register, wsRoot, SYS } from './util';
import { chat, ChatMessage } from './llm';

const dir = () => wsRoot() && vscode.Uri.joinPath(wsRoot()!, '.axiora', 'prompts');
const readOpt = async (u?: vscode.Uri) => { if (!u) { return undefined; } try { return new TextDecoder().decode(await vscode.workspace.fs.readFile(u)); } catch { return undefined; } };
export async function systemPrompt(builtin: string, command?: string): Promise<string> {
	const d = dir(); if (!d) { return builtin; }
	const sys = (await readOpt(vscode.Uri.joinPath(d, 'system.md')))?.trim();
	const cmd = command ? (await readOpt(vscode.Uri.joinPath(d, `${command}.md`)))?.trim() : undefined;
	return (sys || builtin) + (cmd ? `\n\n${cmd}` : '');
}
export const estTokens = (m: ChatMessage[]) => Math.ceil(m.reduce((n, x) => n + x.content.length, 0) / 4);
const cache = new Map<string, string>();
export async function compact(msgs: ChatMessage[], token: vscode.CancellationToken, onNote?: (s: string) => void): Promise<ChatMessage[]> {
	const max = vscode.workspace.getConfiguration('axiora.chat').get<number>('maxContextTokens', 6000);
	const keep = 4;
	if (estTokens(msgs) <= max || msgs.length <= keep + 2) { return msgs; }
	const [sys, ...rest] = msgs; const old = rest.slice(0, rest.length - keep); const recent = rest.slice(-keep);
	const key = old.map(m => m.role[0] + m.content.length + m.content.slice(0, 40)).join('|');
	let sum = cache.get(key);
	if (!sum) {
		sum = await chat([{ role: 'system', content: `${SYS}\nSummarize this earlier conversation for your own later use: decisions, facts, file names, code identifiers, open questions. Dense bullet points, max 250 words.` }, { role: 'user', content: old.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n').slice(0, 60000) }], () => undefined, token);
		cache.set(key, sum);
	}
	onNote?.(`Compacted ${old.length} earlier messages (~${estTokens(old)} → ~${Math.ceil(sum.length / 4)} tokens)`);
	return [sys, { role: 'user', content: `Summary of our earlier conversation:\n${sum}` }, { role: 'assistant', content: 'Understood.' }, ...recent];
}
export function activate(ctx: vscode.ExtensionContext) {
	register(ctx, 'axiora.prompts.edit', async () => {
		const d = dir(); if (!d) { vscode.window.showWarningMessage('Open a folder first.'); return; }
		const p = await vscode.window.showQuickPick([{ label: 'system.md', description: 'replaces the chat system prompt' }, ...['review', 'spec', 'tests', 'explain', 'parallel', 'security'].map(c => ({ label: `${c}.md`, description: `appended for /${c}` }))], { placeHolder: 'Prompt to edit (applies on the next request)' });
		if (!p) { return; }
		const u = vscode.Uri.joinPath(d, p.label);
		if (await readOpt(u) === undefined) { await vscode.workspace.fs.createDirectory(d); await vscode.workspace.fs.writeFile(u, new TextEncoder().encode(p.label === 'system.md' ? `${SYS}\n` : `<!-- extra instructions for /${p.label.replace('.md', '')} -->\n`)); }
		await vscode.window.showTextDocument(u);
	});
}
