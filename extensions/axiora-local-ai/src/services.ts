/*---------------------------------------------------------------------------------------------
 *  Google (Gmail, Drive, Calendar) via the user's OWN OAuth client (desktop app, loopback + PKCE),
 *  and Slack via a bot token. Tokens live in SecretStorage only.
 *  Chat: /gmail [query | read <id> | draft <to> | <subject> | <body>], /drive [query], /calendar [days],
 *        /slack channels | history #chan | send-draft #chan <text>
 *  Sending always goes through a draft card (drafts.ts) — never directly.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as http from 'http';
import * as crypto from 'crypto';
import { chatCommands, register } from './util';
import { createDraft, registerSender } from './drafts';

let secrets: vscode.SecretStorage;
const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.compose', 'https://www.googleapis.com/auth/drive.readonly', 'https://www.googleapis.com/auth/calendar.readonly', 'openid', 'email'];
const gcfg = () => vscode.workspace.getConfiguration('axiora.google');

async function googleSignIn(): Promise<void> {
	let clientId = gcfg().get<string>('clientId', '');
	if (!clientId) {
		clientId = await vscode.window.showInputBox({ prompt: vscode.l10n.t("Your Google OAuth client ID (Desktop app type, from console.cloud.google.com → Credentials)"), ignoreFocusOut: true }) ?? '';
		if (!clientId) { return; } await gcfg().update('clientId', clientId, vscode.ConfigurationTarget.Global);
	}
	let secret = await secrets.get('axiora.google.clientSecret');
	if (!secret) { secret = await vscode.window.showInputBox({ prompt: vscode.l10n.t("Google OAuth client secret (stored in secret storage)"), password: true, ignoreFocusOut: true }); if (!secret) { return; } await secrets.store('axiora.google.clientSecret', secret); }
	const verifier = crypto.randomBytes(32).toString('base64url'); const challenge = crypto.createHash('sha256').update(verifier).digest('base64url'); const state = crypto.randomBytes(8).toString('hex');
	const code = await new Promise<{ code: string; redirect: string }>((res, rej) => {
		const srv = http.createServer((req, rsp) => {
			const u = new URL(req.url ?? '/', 'http://127.0.0.1'); const c = u.searchParams.get('code');
			rsp.writeHead(200, { 'content-type': 'text/html' }); rsp.end(c ? '<h3>Axiora: Google connected. You can close this tab.</h3>' : `<h3>Sign-in failed: ${String(u.searchParams.get('error')).replace(/</g, '')}</h3>`);
			srv.close(); if (c && u.searchParams.get('state') === state) { res({ code: c, redirect }); } else { rej(new Error(u.searchParams.get('error') ?? 'state mismatch')); }
		});
		let redirect = '';
		srv.listen(0, '127.0.0.1', () => {
			redirect = `http://127.0.0.1:${(srv.address() as any).port}`;
			const url = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({ client_id: clientId, redirect_uri: redirect, response_type: 'code', scope: SCOPES.join(' '), code_challenge: challenge, code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent', state })}`;
			void vscode.env.openExternal(vscode.Uri.parse(url));
		});
		setTimeout(() => { srv.close(); rej(new Error('Timed out waiting for Google sign-in')); }, 5 * 60_000);
	});
	const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ code: code.code, client_id: clientId, client_secret: secret, redirect_uri: code.redirect, grant_type: 'authorization_code', code_verifier: verifier }) });
	const j = await r.json() as any; if (!r.ok) { throw new Error(`Google token: ${j.error_description ?? j.error}`); }
	await secrets.store('axiora.google.refreshToken', j.refresh_token);
	vscode.window.showInformationMessage(vscode.l10n.t("Axiora: Google account connected (Gmail, Drive, Calendar)."));
}
let access: { t: string; exp: number } | undefined;
async function gtoken(): Promise<string> {
	if (access && access.exp > Date.now() + 60_000) { return access.t; }
	const rt = await secrets.get('axiora.google.refreshToken'); if (!rt) { throw new Error('Google not connected. Run "Google: Sign In (Gmail, Drive, Calendar)".'); }
	const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ refresh_token: rt, client_id: gcfg().get('clientId', ''), client_secret: await secrets.get('axiora.google.clientSecret') ?? '', grant_type: 'refresh_token' }) });
	const j = await r.json() as any; if (!r.ok) { throw new Error(`Google refresh: ${j.error_description ?? j.error}`); }
	access = { t: j.access_token, exp: Date.now() + j.expires_in * 1000 }; return access.t;
}
async function gget(url: string, init?: RequestInit): Promise<any> {
	const r = await fetch(url, { ...init, headers: { authorization: `Bearer ${await gtoken()}`, 'content-type': 'application/json', ...(init?.headers ?? {}) } });
	const t = await r.text(); if (!r.ok) { throw new Error(`Google ${r.status}: ${t.slice(0, 300)}`); } return t ? JSON.parse(t) : {};
}
const hdr = (m: any, n: string) => m.payload?.headers?.find((h: any) => h.name.toLowerCase() === n)?.value ?? '';
function body(p: any): string {
	if (!p) { return ''; }
	if (p.mimeType === 'text/plain' && p.body?.data) { return Buffer.from(p.body.data, 'base64url').toString(); }
	for (const x of p.parts ?? []) { const b = body(x); if (b) { return b; } }
	if (p.body?.data) { return Buffer.from(p.body.data, 'base64url').toString().replace(/<[^>]+>/g, ' '); }
	return '';
}
function rfc822(d: { to: string; subject?: string; body: string }) { return Buffer.from(`To: ${d.to}\r\nSubject: =?UTF-8?B?${Buffer.from(d.subject ?? '').toString('base64')}?=\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${d.body}`).toString('base64url'); }

export const services = {
	async gmail(arg: string): Promise<string | { draft: string }> {
		const a = arg.trim();
		const dm = /^draft\s+([^|]+)\|([^|]*)\|([\s\S]*)$/i.exec(a);
		if (dm) { const d = await createDraft({ channel: 'gmail', to: dm[1].trim(), subject: dm[2].trim(), body: dm[3].trim() }); return { draft: d.id }; }
		const rm = /^read\s+(\S+)/i.exec(a);
		if (rm) { const m = await gget(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${rm[1]}?format=full`); return `From: ${hdr(m, 'from')}\nSubject: ${hdr(m, 'subject')}\nDate: ${hdr(m, 'date')}\n\n${body(m.payload).slice(0, 6000)}`; }
		const l = await gget(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=15&q=${encodeURIComponent(a || 'in:inbox')}`);
		if (!l.messages?.length) { return 'No messages.'; }
		const ms = await Promise.all(l.messages.map((x: any) => gget(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${x.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`)));
		return ms.map(m => `${m.id}  ${hdr(m, 'date').slice(0, 22)} · ${hdr(m, 'from').slice(0, 40)} — ${hdr(m, 'subject')}`).join('\n');
	},
	async drive(arg: string): Promise<string> {
		const q = arg.trim() ? `name contains '${arg.trim().replace(/'/g, "\\'")}' and trashed=false` : 'trashed=false';
		const j = await gget(`https://www.googleapis.com/drive/v3/files?pageSize=20&orderBy=modifiedTime desc&fields=files(id,name,mimeType,modifiedTime,webViewLink)&q=${encodeURIComponent(q)}`);
		return j.files?.length ? j.files.map((f: any) => `${f.name} · ${f.mimeType.split('.').pop()} · ${f.modifiedTime.slice(0, 10)} · ${f.webViewLink}`).join('\n') : 'No files.';
	},
	async calendar(arg: string): Promise<string> {
		const days = +(arg.trim() || 7) || 7; const now = new Date();
		const j = await gget(`https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&maxResults=30&timeMin=${now.toISOString()}&timeMax=${new Date(+now + days * 864e5).toISOString()}`);
		return j.items?.length ? j.items.map((e: any) => `${(e.start.dateTime ?? e.start.date).replace('T', ' ').slice(0, 16)} — ${e.summary ?? '(no title)'}${e.location ? ` @ ${e.location}` : ''}`).join('\n') : `No events in the next ${days} days.`;
	},
	async slack(arg: string): Promise<string | { draft: string }> {
		const [sub = 'channels', ...rest] = arg.trim().split(/\s+/);
		if (/^send(-draft)?$/i.test(sub)) { const ch = rest.shift() ?? ''; const d = await createDraft({ channel: 'slack', to: ch, body: rest.join(' ') }); return { draft: d.id }; }
		if (/^history$/i.test(sub)) { const id = await slackChannel(rest[0] ?? ''); const j = await slackApi(`conversations.history?channel=${id}&limit=20`); return j.messages.map((m: any) => `${new Date(+m.ts * 1000).toISOString().slice(0, 16).replace('T', ' ')} ${m.user ?? m.username ?? 'bot'}: ${String(m.text).slice(0, 200)}`).join('\n') || 'No messages.'; }
		const j = await slackApi('conversations.list?limit=200&exclude_archived=true&types=public_channel,private_channel');
		return j.channels.map((c: any) => `#${c.name} (${c.id})${c.is_member ? '' : ' · bot not a member'} · ${c.num_members ?? '?'} members`).join('\n') || 'No channels.';
	}
};
async function slackApi(path: string, body?: unknown): Promise<any> {
	const t = await secrets.get('axiora.connector.slack'); if (!t) { throw new Error('No Slack bot token. Run "Slack: Set Bot Token".'); }
	const r = await fetch(`https://slack.com/api/${path}`, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json; charset=utf-8' }, body: body ? JSON.stringify(body) : undefined });
	const j = await r.json() as any; if (!j.ok) { throw new Error(`Slack: ${j.error}`); } return j;
}
async function slackChannel(n: string): Promise<string> {
	n = n.replace(/^#/, ''); if (/^[CGD][A-Z0-9]{6,}$/.test(n)) { return n; }
	const j = await slackApi('conversations.list?limit=1000&exclude_archived=true&types=public_channel,private_channel');
	const c = j.channels.find((x: any) => x.name === n); if (!c) { throw new Error(`Slack channel #${n} not found`); } return c.id;
}

export function activate(ctx: vscode.ExtensionContext) {
	secrets = ctx.secrets;
	register(ctx, 'axiora.google.signIn', googleSignIn);
	register(ctx, 'axiora.google.signOut', async () => { await secrets.delete('axiora.google.refreshToken'); access = undefined; vscode.window.showInformationMessage(vscode.l10n.t("Google disconnected.")); });
	register(ctx, 'axiora.slack.setToken', async () => { const t = await vscode.window.showInputBox({ prompt: vscode.l10n.t("Slack bot token (xoxb-…), scopes: channels:read, channels:history, groups:read, chat:write"), password: true, ignoreFocusOut: true }); if (t !== undefined) { t ? await secrets.store('axiora.connector.slack', t) : await secrets.delete('axiora.connector.slack'); } });
	registerSender('gmail', async d => { await gget('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { method: 'POST', body: JSON.stringify({ raw: rfc822(d) }) }); return `Email sent to ${d.to}.`; });
	registerSender('gmail-draft', async d => { const j = await gget('https://gmail.googleapis.com/gmail/v1/users/me/drafts', { method: 'POST', body: JSON.stringify({ message: { raw: rfc822(d) } }) }); return `Saved to Gmail Drafts (${j.id}) — not sent.`; });
	registerSender('slack', async d => { const ch = await slackChannel(d.to); const j = await slackApi('chat.postMessage', { channel: ch, text: d.body }); return `Posted to ${d.to} (ts ${j.ts}).`; });
	for (const id of ['gmail', 'drive', 'calendar', 'slack'] as const) {
		chatCommands.set(id, async (req, stream) => {
			stream.progress(vscode.l10n.t("Querying {0}…", id));
			try {
				const r = await services[id](req.prompt);
				if (typeof r === 'object') { stream.markdown(vscode.l10n.t("Draft created — **nothing has been sent**. Review, edit, then click Send on the card.\n\n")); stream.button({ command: 'axiora.drafts.open', arguments: [r.draft], title: vscode.l10n.t("$(edit) Open draft") }); return; }
				const md = new vscode.MarkdownString(`**${id[0].toUpperCase() + id.slice(1)}** · live data\n\n`); for (const l of r.split('\n').filter(Boolean)) { md.appendMarkdown(`- ${l.replace(/[\\`*_[\]<>]/g, m => '\\' + m)}\n`); } stream.markdown(md);
			} catch (e) { stream.markdown(vscode.l10n.t("**{0} error:** {1}", id, (e as Error).message)); }
		});
	}
}
