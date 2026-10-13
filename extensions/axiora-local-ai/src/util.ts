/*---------------------------------------------------------------------------------------------
 *  Axiora Local AI - shared helpers for feature modules.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as cp from 'child_process';
import { chat, ChatMessage } from './llm';

export const log = vscode.window.createOutputChannel('Axiora Features', { log: true });
export const SYS = 'You are Axiora, a precise senior software engineer assistant inside the Axiora code editor. Be concise. Always reply in the same language as the user\'s request (English unless they write in another language).';
export function wsRoot(): vscode.Uri | undefined { return vscode.workspace.workspaceFolders?.[0]?.uri; }
export function run(cmd: string, args: string[], cwd: string): Promise<string> {
	return new Promise((res, rej) => cp.execFile(cmd, args, { cwd, maxBuffer: 64 * 1024 * 1024 }, (e, so, se) => e ? rej(new Error(se || e.message)) : res(so)));
}
/** One-shot model call returning the whole text. */
export async function ask(user: string, system = SYS, token?: vscode.CancellationToken): Promise<string> {
	const m: ChatMessage[] = [{ role: 'system', content: system }, { role: 'user', content: user }];
	return chat(m, () => { }, token);
}
/** Strip a surrounding ``` fence. */
export function unfence(s: string): string {
	const m = /```[\w+-]*\n([\s\S]*?)\n?```/.exec(s);
	return (m ? m[1] : s).trim();
}
export function withProgress<T>(title: string, fn: (t: vscode.CancellationToken) => Promise<T>): Thenable<T> {
	return vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Axiora: ${title}`, cancellable: true }, (_p, t) => fn(t));
}
export function register(ctx: vscode.ExtensionContext, id: string, fn: (...a: any[]) => any) {
	ctx.subscriptions.push(vscode.commands.registerCommand(id, async (...a) => {
		try { return await fn(...a); } catch (e) { log.error(`${id}: ${(e as Error).message}`); vscode.window.showErrorMessage(`Axiora: ${(e as Error).message}`); }
	}));
}
export type ChatCommandHandler = (req: vscode.ChatRequest, stream: vscode.ChatResponseStream, token: vscode.CancellationToken, chatCtx?: vscode.ChatContext) => Promise<void>;
export const chatCommands = new Map<string, ChatCommandHandler>();
/** Extra context providers appended to @axiora prompts (repo map, etc.). */
export const contextProviders: (() => Promise<string>)[] = [];
