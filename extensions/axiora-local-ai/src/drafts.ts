/*---------------------------------------------------------------------------------------------
 *  Draft-before-send. Every outgoing message (email, Slack, …) becomes an editable draft card
 *  with Send / Discard. Nothing is sent unless the user clicks Send on the card.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { htmlDir, htmlLang } from './i18n';
import { log } from './util';

export interface Draft { id: string; channel: string; to: string; subject?: string; body: string; meta?: Record<string, string>; created: number; status: 'draft' | 'sent' | 'discarded'; result?: string }
type Sender = (d: Draft) => Promise<string>;
const senders = new Map<string, Sender>();
let store: vscode.Memento;
const panels = new Map<string, vscode.WebviewPanel>();
const esc = (s = '') => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

export function registerSender(channel: string, s: Sender) { senders.set(channel, s); }
function all(): Draft[] { return store.get<Draft[]>('axiora.drafts', []); }
async function save(d: Draft) { const l = all().filter(x => x.id !== d.id); l.unshift(d); await store.update('axiora.drafts', l.slice(0, 100)); }

/** Create a draft and open its card. Returns the draft (never sends). */
export async function createDraft(p: { channel: string; to: string; subject?: string; body: string; meta?: Record<string, string> }, open = true): Promise<Draft> {
	const d: Draft = { ...p, id: Math.random().toString(36).slice(2, 10), created: Date.now(), status: 'draft' };
	await save(d); if (open) { openCard(d.id); }
	return d;
}
export function openCard(id: string) {
	const d = all().find(x => x.id === id); if (!d) { vscode.window.showWarningMessage(vscode.l10n.t("Draft not found.")); return; }
	let p = panels.get(id);
	if (p) { p.reveal(); return; }
	p = vscode.window.createWebviewPanel('axiora.draft', `Draft · ${d.channel}`, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false }, { enableScripts: true });
	panels.set(id, p); p.onDidDispose(() => panels.delete(id));
	const render = (x: Draft) => `<!doctype html><html dir="${htmlDir()}" lang="${htmlLang()}"><head><style>body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:14px;max-width:760px}label{display:block;font-size:11px;opacity:.75;margin:10px 0 3px;text-transform:uppercase;letter-spacing:.04em}input,textarea{width:100%;box-sizing:border-box;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,var(--vscode-panel-border));padding:6px;border-radius:3px;font-family:inherit}textarea{min-height:220px;font-family:var(--vscode-editor-font-family)}.bar{margin-top:12px;display:flex;gap:8px;align-items:center}button{border:0;padding:6px 14px;border-radius:3px;cursor:pointer}.send{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}.disc{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}.badge{font-size:11px;padding:2px 8px;border-radius:9px;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground)}.note{font-size:12px;opacity:.75;margin-top:10px}</style></head><body>
<div class=bar style="margin-top:0"><b>${vscode.l10n.t("{0} draft", esc(x.channel))}</b><span class=badge>${x.status.toUpperCase()}</span></div>
<label>${vscode.l10n.t("To")}</label><input id=to value="${esc(x.to)}" ${x.status !== 'draft' ? 'disabled' : ''}>
${x.channel === 'slack' ? '' : `<label>${vscode.l10n.t("Subject")}</label><input id=su value="${esc(x.subject)}" ${x.status !== 'draft' ? 'disabled' : ''}>`}
<label>${vscode.l10n.t("Message")}</label><textarea id=bo ${x.status !== 'draft' ? 'disabled' : ''}>${esc(x.body)}</textarea>
${x.status === 'draft' ? `<div class=bar><button class=send id=s>${vscode.l10n.t("Send")}</button><button class=disc id=d>${vscode.l10n.t("Discard")}</button>${x.channel === 'gmail' ? `<button class=disc id=g>${vscode.l10n.t("Save to Gmail Drafts")}</button>` : ''}</div><div class=note>${vscode.l10n.t("Nothing is sent until you click Send. Edit any field first.")}</div>` : `<div class=note>${esc(x.result ?? '')}</div>`}
<script>const v=acquireVsCodeApi();const val=()=>({to:to.value,subject:window.su?su.value:undefined,body:bo.value});window.s&&(s.onclick=()=>v.postMessage({op:'send',...val()}));window.d&&(d.onclick=()=>v.postMessage({op:'discard'}));window.g&&(g.onclick=()=>v.postMessage({op:'gdraft',...val()}));</script></body></html>`;
	p.webview.html = render(d);
	p.webview.onDidReceiveMessage(async m => {
		const cur = all().find(x => x.id === id)!; if (cur.status !== 'draft') { return; }
		Object.assign(cur, { to: m.to ?? cur.to, subject: m.subject ?? cur.subject, body: m.body ?? cur.body });
		if (m.op === 'discard') { cur.status = 'discarded'; cur.result = 'Discarded — nothing was sent.'; }
		else {
			const s = senders.get(m.op === 'gdraft' ? 'gmail-draft' : cur.channel);
			if (!s) { vscode.window.showErrorMessage(vscode.l10n.t("No sender configured for {0}.", cur.channel)); return; }
			try { cur.result = await s(cur); if (m.op === 'send') { cur.status = 'sent'; } vscode.window.showInformationMessage(vscode.l10n.t("Axiora: {0}", cur.result)); log.info(`draft ${id} ${m.op}: ${cur.result}`); }
			catch (e) { vscode.window.showErrorMessage(vscode.l10n.t("Send failed: {0}", (e as Error).message)); await save(cur); return; }
		}
		await save(cur); p!.webview.html = render(cur);
	});
}
export function activate(ctx: vscode.ExtensionContext) {
	store = ctx.globalState;
	ctx.subscriptions.push(vscode.commands.registerCommand('axiora.drafts.open', (id?: string) => id ? openCard(id) : vscode.commands.executeCommand('axiora.drafts.list')));
	ctx.subscriptions.push(vscode.commands.registerCommand('axiora.drafts.list', async () => {
		const l = all(); if (!l.length) { vscode.window.showInformationMessage(vscode.l10n.t("No drafts yet. Ask @axiora to draft an email or Slack message.")); return; }
		const p = await vscode.window.showQuickPick(l.map(d => ({ label: `${d.status === 'draft' ? '$(edit)' : d.status === 'sent' ? '$(check)' : '$(trash)'} ${d.channel} → ${d.to}`, description: d.subject ?? d.body.slice(0, 60), detail: new Date(d.created).toLocaleString(), id: d.id })), { placeHolder: vscode.l10n.t("Drafts (nothing is sent without clicking Send)") });
		if (p) { openCard(p.id); }
	}));
	ctx.subscriptions.push(vscode.commands.registerCommand('axiora.drafts.new', async () => {
		const ch = await vscode.window.showQuickPick([...senders.keys()].filter(k => k !== 'gmail-draft'), { placeHolder: 'Channel' }); if (!ch) { return; }
		await createDraft({ channel: ch, to: '', subject: '', body: '' });
	}));
}
