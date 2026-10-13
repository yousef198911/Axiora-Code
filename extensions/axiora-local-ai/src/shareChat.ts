/*---------------------------------------------------------------------------------------------
 *  Share chat by link: "@axiora /share" renders the current conversation to a self-contained
 *  HTML page. With axiora.share.endpoint set (your own server) it is uploaded and the returned
 *  link is copied; otherwise it is saved under .axiora/shared/ for sending as a file.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { chatCommands, wsRoot } from './util';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
function transcript(h: readonly (vscode.ChatRequestTurn | vscode.ChatResponseTurn)[]) {
	const turns: { who: string; text: string }[] = [];
	for (const t of h) {
		if (t instanceof vscode.ChatRequestTurn) { turns.push({ who: 'You', text: (t.command ? `/${t.command} ` : '') + t.prompt }); }
		else { turns.push({ who: 'Axiora', text: t.response.map(p => p instanceof vscode.ChatResponseMarkdownPart ? p.value.value : '').join('') }); }
	}
	return turns;
}
export function activate(_ctx: vscode.ExtensionContext) {
	chatCommands.set('share', async (_req, stream, _t, cc) => {
		const turns = transcript(cc?.history ?? []);
		if (!turns.length) { stream.markdown('Nothing to share yet: chat with @axiora first, then run `/share`.'); return; }
		const md = turns.map(t => `### ${t.who}\n\n${t.text}`).join('\n\n');
		const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Axiora chat</title><style>body{font-family:system-ui;max-width:820px;margin:2em auto;padding:0 1em;line-height:1.5}.t{border-radius:8px;padding:10px 14px;margin:10px 0}.You{background:#eef4ff}.Axiora{background:#f6f6f6}pre{white-space:pre-wrap}</style></head><body><h2>Axiora chat · ${new Date().toLocaleString()}</h2>${turns.map(t => `<div class="t ${t.who}"><b>${t.who}</b><pre>${esc(t.text)}</pre></div>`).join('')}</body></html>`;
		const ep = vscode.workspace.getConfiguration('axiora.share').get<string>('endpoint', '');
		if (ep) {
			const r = await fetch(ep, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: turns[0].text.slice(0, 80), markdown: md, html }) });
			if (!r.ok) { stream.markdown(`Upload failed: HTTP ${r.status}`); return; }
			const j = await r.json() as { url?: string };
			if (j.url) { await vscode.env.clipboard.writeText(j.url); stream.markdown(`🔗 Shared: [${j.url}](${j.url}) (copied to clipboard)`); return; }
		}
		const root = wsRoot(); if (!root) { stream.markdown(md); return; }
		const f = vscode.Uri.joinPath(root, '.axiora', 'shared', `chat-${Date.now()}.html`);
		await vscode.workspace.fs.writeFile(f, Buffer.from(html));
		await vscode.env.clipboard.writeText(md);
		stream.markdown(`Saved ${turns.length} messages to \`${vscode.workspace.asRelativePath(f)}\` and copied the Markdown to the clipboard. Set \`axiora.share.endpoint\` to your server to get a link.`);
		stream.reference(f);
	});
}
