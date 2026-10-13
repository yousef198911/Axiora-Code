/*---------------------------------------------------------------------------------------------
 *  Debug: Continue / Pause all other threads (keeps the focused thread stopped / running).
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { register } from './util';

async function others(): Promise<{ s: vscode.DebugSession; ids: number[] } | undefined> {
	const item = vscode.debug.activeStackItem;
	const s = item?.session ?? vscode.debug.activeDebugSession;
	if (!s || !item) { vscode.window.showInformationMessage('Select a thread in the Call Stack first.'); return; }
	const { threads } = await s.customRequest('threads') as { threads: { id: number }[] };
	return { s, ids: threads.map(t => t.id).filter(id => id !== item.threadId) };
}
export function activate(ctx: vscode.ExtensionContext) {
	register(ctx, 'axiora.debug.continueOthers', async () => {
		const o = await others(); if (!o) { return; }
		for (const threadId of o.ids) { await o.s.customRequest('continue', { threadId, singleThread: true }).then(undefined, () => undefined); }
	});
	register(ctx, 'axiora.debug.pauseOthers', async () => {
		const o = await others(); if (!o) { return; }
		for (const threadId of o.ids) { await o.s.customRequest('pause', { threadId }).then(undefined, () => undefined); }
	});
}
