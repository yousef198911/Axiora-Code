/*---------------------------------------------------------------------------------------------
 *  Connectors: Figma, Jira, Linear, Stripe. Tokens live in SecretStorage (OS keychain), never
 *  in settings. Each connector adds a chat command that pulls live data into the prompt:
 *    /figma <file-url|key> [node-id]   /jira <KEY-123 | JQL>   /linear <ID-123 | search>
 *    /stripe <customers|charges|invoices|subscriptions|events> [query]
 *  and "Connectors: Manage..." to set/clear tokens and test each connection.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { languageRule } from './i18n';
import { register, chatCommands } from './util';
import { chat } from './llm';

type Id = 'figma' | 'jira' | 'linear' | 'stripe';
const LABEL: Record<Id, string> = { figma: 'Figma (personal access token)', jira: 'Jira (API token; email in axiora.connectors.jira.email)', linear: 'Linear (personal API key)', stripe: 'Stripe (restricted read-only key recommended, rk_…)' };
let secrets: vscode.SecretStorage;
const cfg = (k: string) => vscode.workspace.getConfiguration('axiora.connectors').get<string>(k, '');
const tok = async (id: Id) => { const t = await secrets.get(`axiora.connector.${id}`); if (!t) { throw new Error(`No ${id} token. Run "Connectors: Manage..." to add one.`); } return t; };
async function get(url: string, headers: Record<string, string>, init?: RequestInit): Promise<any> {
	const r = await fetch(url, { ...init, headers: { accept: 'application/json', ...headers, ...(init?.headers as any) } });
	if (!r.ok) { throw new Error(`${new URL(url).host} ${r.status}: ${(await r.text()).slice(0, 300)}`); } return r.json();
}
const api = {
	async figma(arg: string) {
		if (!arg.trim() || /^(me|whoami)$/i.test(arg.trim())) { const h0 = { 'X-Figma-Token': await tok('figma') }; const me = await get('https://api.figma.com/v1/me', h0); return `Figma user: ${me.handle} <${me.email}> (id ${me.id})\nPass a file URL or key to inspect a design: /figma https://www.figma.com/design/<key>/...`; }
		const key = /figma\.com\/(?:file|design)\/([\w]+)/.exec(arg)?.[1] ?? arg.split(/\s+/)[0]; const node = /node-id=([\w%:-]+)/.exec(arg)?.[1]?.replace('-', ':') ?? arg.split(/\s+/)[1];
		const h = { 'X-Figma-Token': await tok('figma') };
		const j = node ? await get(`https://api.figma.com/v1/files/${key}/nodes?ids=${encodeURIComponent(decodeURIComponent(node))}&depth=4`, h) : await get(`https://api.figma.com/v1/files/${key}?depth=2`, h);
		const walk = (n: any, d = 0): string => `${'  '.repeat(d)}- ${n.type} "${n.name}"${n.absoluteBoundingBox ? ` ${Math.round(n.absoluteBoundingBox.width)}×${Math.round(n.absoluteBoundingBox.height)}` : ''}${n.characters ? `: ${String(n.characters).slice(0, 80)}` : ''}${n.fills?.[0]?.color ? ` fill rgba(${['r', 'g', 'b'].map(c => Math.round(n.fills[0].color[c] * 255)).join(',')},${n.fills[0].color.a})` : ''}${n.style?.fontFamily ? ` font ${n.style.fontFamily} ${n.style.fontSize}` : ''}\n${d < 5 ? (n.children ?? []).slice(0, 40).map((c: any) => walk(c, d + 1)).join('') : ''}`;
		return node ? Object.values<any>(j.nodes).map(n => walk(n.document)).join('\n') : `File "${j.name}"\n${walk(j.document)}`;
	},
	async jira(arg: string) {
		const site = cfg('jira.site').replace(/\/$/, ''); if (!site) { throw new Error('Set axiora.connectors.jira.site (e.g. https://acme.atlassian.net).'); }
		const h = { authorization: 'Basic ' + Buffer.from(`${cfg('jira.email')}:${await tok('jira')}`).toString('base64') };
		const fmt = (i: any) => `${i.key} [${i.fields.status?.name}] ${i.fields.summary}\n  type ${i.fields.issuetype?.name} · assignee ${i.fields.assignee?.displayName ?? '-'} · priority ${i.fields.priority?.name ?? '-'}\n${typeof i.fields.description === 'string' ? i.fields.description : JSON.stringify(i.fields.description ?? '').replace(/"type":"\w+",?|[{}[\]"]/g, ' ').replace(/\s+/g, ' ').slice(0, 2000)}`;
		if (/^(me|whoami)$/i.test(arg.trim())) { const me = await get(`${site}/rest/api/3/myself`, h); return `Jira user: ${me.displayName} <${me.emailAddress ?? ''}> · ${site}`; }
		if (/^projects?$/i.test(arg.trim())) { const j = await get(`${site}/rest/api/3/project/search?maxResults=50`, h); return (j.values ?? []).map((p: any) => `${p.key} — ${p.name} (${p.projectTypeKey})`).join('\n') || 'No projects visible to this account.'; }
		if (/^[A-Z][A-Z0-9]+-\d+$/.test(arg.trim())) { return fmt(await get(`${site}/rest/api/3/issue/${arg.trim()}`, h)); }
		const j = await get(`${site}/rest/api/3/search/jql?jql=${encodeURIComponent(arg || 'updated >= -365d ORDER BY updated DESC')}&maxResults=20&fields=summary,status,issuetype,assignee,priority,description`, h);
		return (j.issues ?? []).map(fmt).join('\n\n') || 'No issues.';
	},
	async linear(arg: string) {
		const key = await tok('linear'); const post = async (query: string, variables: any) => { const j = await get('https://api.linear.app/graphql', { authorization: key, 'content-type': 'application/json' }, { method: 'POST', body: JSON.stringify({ query, variables }) }); if (j.errors?.length && !j.data) { throw new Error(`Linear: ${j.errors.map((e: any) => e.message).join('; ')}`); } return j; };
		const F = 'identifier title state{name} assignee{name} priorityLabel url description';
		const range = /^([A-Z]+)-(\d+)\s*(?:\.\.|-|–)\s*(?:[A-Z]+-)?(\d+)$/.exec(arg.trim());
		if (range) { const out: string[] = []; for (let n = +range[2]; n <= Math.min(+range[3], +range[2] + 24); n++) { const j = await post(`query($id:String!){issue(id:$id){${F}}}`, { id: `${range[1]}-${n}` }).catch(() => undefined); const i = j?.data?.issue; out.push(i ? `${i.identifier} [${i.state?.name}] ${i.title} (${i.priorityLabel}, ${i.assignee?.name ?? 'unassigned'})` : `${range[1]}-${n}: not found`); } return out.join('\n'); }
		if (/^[A-Z]+-\d+$/.test(arg.trim())) { const j = await post(`query($id:String!){issue(id:$id){${F}}}`, { id: arg.trim() }); const i = j.data?.issue; return i ? `${i.identifier} [${i.state.name}] ${i.title}\n${i.url}\n${i.description ?? ''}` : 'Not found.'; }
		const j = arg ? await post(`query($t:String!){searchIssues(term:$t,first:15){nodes{${F}}}}`, { t: arg }) : await post(`query{issues(first:25,orderBy:updatedAt){nodes{${F}}}}`, {});
		const nodes = j.data?.searchIssues?.nodes ?? j.data?.issues?.nodes ?? [];
		return nodes.map((i: any) => `${i.identifier} [${i.state?.name}] ${i.title} (${i.priorityLabel}, ${i.assignee?.name ?? 'unassigned'})`).join('\n') || 'No issues.';
	},
	async stripe(arg: string) {
		const [res = 'events', ...rest] = arg.split(/\s+/).filter(Boolean); const h = { authorization: `Bearer ${await tok('stripe')}` };
		const allowed = ['customers', 'charges', 'invoices', 'subscriptions', 'events', 'products', 'prices', 'payment_intents', 'balance'];
		if (!allowed.includes(res)) { throw new Error(`Use one of: ${allowed.join(', ')}`); }
		if (res === 'balance') { const b = await get('https://api.stripe.com/v1/balance', h); const f = (a: any[]) => (a ?? []).map(x => `${(x.amount / 100).toFixed(2)} ${String(x.currency).toUpperCase()}`).join(', ') || '0'; return `Stripe balance (${b.livemode ? 'LIVE' : 'test mode'})\navailable: ${f(b.available)}\npending: ${f(b.pending)}`; }
		const searchable = ['customers', 'charges', 'invoices', 'subscriptions', 'payment_intents', 'products', 'prices'];
		const j = rest.length && searchable.includes(res) ? await get(`https://api.stripe.com/v1/${res}/search?limit=20&query=${encodeURIComponent(rest.join(' '))}`, h) : await get(`https://api.stripe.com/v1/${res}?limit=20`, h);
		return (j.data ?? []).map((o: any) => `${o.id} ${o.type ?? o.status ?? ''} ${o.email ?? o.description ?? o.name ?? ''} ${o.amount != null ? `${o.amount / 100} ${o.currency}` : ''} ${new Date((o.created ?? 0) * 1000).toISOString().slice(0, 10)}`.replace(/\s+/g, ' ')).join('\n') || 'None.';
	},
};
export function activate(ctx: vscode.ExtensionContext) {
	secrets = ctx.secrets;
	register(ctx, 'axiora.connectors.manage', async () => {
		const items = await Promise.all((Object.keys(LABEL) as Id[]).map(async id => ({ label: `${(await secrets.get(`axiora.connector.${id}`)) ? '$(pass-filled)' : '$(circle-large-outline)'} ${id[0].toUpperCase() + id.slice(1)}`, description: LABEL[id], id })));
		const p = await vscode.window.showQuickPick(items, { placeHolder: 'Connectors' }); if (!p) { return; }
		const a = await vscode.window.showQuickPick(['Set Token...', 'Test Connection', 'Remove Token'], { placeHolder: p.label }); if (!a) { return; }
		if (a === 'Set Token...') { const t = await vscode.window.showInputBox({ prompt: LABEL[p.id], password: true, ignoreFocusOut: true }); if (t) { await secrets.store(`axiora.connector.${p.id}`, t.trim()); vscode.window.showInformationMessage(vscode.l10n.t("{0} token saved to the OS keychain.", p.id)); } }
		if (a === 'Remove Token') { await secrets.delete(`axiora.connector.${p.id}`); }
		if (a === 'Test Connection') { try { const out = await api[p.id](p.id === 'stripe' ? 'balance' : p.id === 'linear' ? '' : 'me'); vscode.window.showInformationMessage(vscode.l10n.t("{0}: OK — {1}", p.id, out.split('\n')[0].slice(0, 120))); } catch (e) { vscode.window.showErrorMessage(`${p.id}: ${(e as Error).message}`); } }
	});
	for (const id of Object.keys(api) as Id[]) {
		chatCommands.set(id, async (req, stream, token) => {
			stream.progress(vscode.l10n.t("Fetching from {0}…", id));
			let data: string; try { data = await api[id](req.prompt.trim()); } catch (e) { stream.markdown(`**${id}:** ${(e as Error).message}`); stream.button({ command: 'axiora.connectors.manage', title: vscode.l10n.t("Manage Connectors") }); return; }
			const ask = req.prompt.includes('?') || req.prompt.split(/\s+/).length > 4;
			const md = new vscode.MarkdownString(); md.appendMarkdown(`**${id[0].toUpperCase() + id.slice(1)}** · live data\n\n`);
			// one bullet per line (wraps in the chat panel, unlike a code block); identifiers like AXI-1 / KEY-12 / ids as inline code
			const esc = (t: string) => t.replace(/[\\`*_{}[\]<>#|]/g, c => '\\' + c);
			for (const l of data.slice(0, 12000).split('\n').filter(x => x.trim())) { const m = /^(\s*)([A-Za-z][\w]*-\d+|[a-z]{2,6}_[A-Za-z0-9]+)\b(.*)$/.exec(l); md.appendMarkdown(m ? `- \`${m[2]}\`${esc(m[3])}\n` : `- ${esc(l.trim())}\n`); }
			stream.markdown(md); stream.markdown('\n\n');
			if (id === 'figma' && /^\s*(me|whoami)?\s*$/i.test(req.prompt)) { return; }
			if (ask || id === 'figma') { await chat([{ role: 'system', content: `You are Axiora. ${languageRule()} Use the ${id} data below to help the developer. For Figma, produce implementation guidance (layout, components, tokens) or code when asked.` }, { role: 'user', content: `${req.prompt}\n\n${id} data:\n${data.slice(0, 20000)}` }], c => stream.markdown(c), token); }
		});
	}
}
