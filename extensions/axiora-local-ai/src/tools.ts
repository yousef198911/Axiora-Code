/*---------------------------------------------------------------------------------------------
 *  Agent tools the model can call itself (in @axiora chat and via vscode.lm tools):
 *  web_search, web_fetch, browser, browser_task, make_document, make_chart, generate_image, screenshot,
 *  draft_message, run_shell (approval-gated), delete_file (approval-gated).
 *  Plus chat commands /image /browser /office /chart /screenshot /draft and palette commands.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { chat, ChatMessage, chatTools, providerKind, applyFilters, wireMessages } from './llm';
import { chatCommands, register, run, SYS, wsRoot, log } from './util';
import { webSearch } from './webSearch';
import { fetchPage } from './web';
import { act, runTask, closeBrowser, BrowserAction } from './browser';
import { makeDocument, writeChart, DocSpec, Chart } from './office';
import { generateImage, captureScreen, inlineImage, speak, stopSpeaking, initMedia } from './media';
import { createDraft } from './drafts';
import { approve, requireApproval } from './approval';

type Out = { text: string; image?: string; file?: string; draft?: string };
interface Tool { name: string; description: string; schema: Record<string, unknown>; run(a: any, token?: vscode.CancellationToken): Promise<Out> }
const S = (props: Record<string, unknown>, req: string[] = []) => ({ type: 'object', properties: props, required: req });
const str = (d: string) => ({ type: 'string', description: d });
const root = () => wsRoot()?.fsPath ?? os.tmpdir();
const inWs = (p: string) => { const f = path.resolve(root(), p); if (!f.startsWith(path.resolve(root()))) { throw new Error('Path must be inside the workspace'); } return f; };

export const TOOLS: Tool[] = [
	{ name: 'web_search', description: 'Search the web. Returns titles, URLs, snippets.', schema: S({ query: str('search query') }, ['query']), async run(a) { const r = await webSearch(a.query); return { text: r.map((x, i) => `[${i + 1}] ${x.title}\n${x.url}\n${x.snippet}`).join('\n\n') || 'No results.' }; } },
	{ name: 'web_fetch', description: 'Open a URL and return its readable text (article/main content) and links.', schema: S({ url: str('http(s) URL') }, ['url']), async run(a) { const p = await fetchPage(a.url); return { text: `# ${p.title}\n${p.url}\n\n${p.text}\n\nLinks:\n${p.links.slice(0, 20).map(l => `- ${l.text}: ${l.url}`).join('\n')}` }; } },
	{ name: 'browser', description: 'Drive a real browser. action: goto(url) | click(n|selector|text) | fill(n|selector|text, value) | press(key) | select | check | back | text | snapshot | screenshot | assert(text) | close. Returns numbered interactive elements.', schema: S({ action: str('action'), url: str('for goto'), n: { type: 'number', description: 'element number from the last snapshot' }, selector: str('CSS selector'), text: str('visible text / label / expected text'), value: str('value for fill/select'), key: str('key for press') }, ['action']), async run(a: BrowserAction) { return act(a); } },
	{ name: 'browser_task', description: 'Give a multi-step goal to the browser agent (it navigates, clicks, fills forms) and get the result + final screenshot.', schema: S({ task: str('what to do in the browser') }, ['task']), async run(a, t) { const r = await runTask(a.task, s => log.info(`browser_task ${s}`), t); return { text: r.result, image: r.shot }; } },
	{ name: 'make_document', description: 'Create an office file. kind: xlsx|docx|pptx|pdf. spec: {title, blocks:[{heading}|{text}|{bullets:[]}|{table:[[...]]}|{chart:{type,title,labels,series:[{name,values}]}}|{image}], sheets:[{name,rows}], slides:[{title,bullets,chart,image,notes}]}', schema: S({ kind: str('xlsx|docx|pptx|pdf'), path: str('output path relative to the workspace'), spec: { type: 'object', description: 'document spec' } }, ['kind', 'spec']), async run(a) { const f = inWs(a.path ?? `.axiora/docs/${(a.spec?.title ?? 'document').replace(/[^\w-]+/g, '-')}.${a.kind}`); await makeDocument(a.kind, a.spec, f); return { text: `Created ${path.relative(root(), f)}`, file: f }; } },
	{ name: 'make_chart', description: 'Render a chart to PNG + SVG. chart: {type:bar|line|pie, title, labels:[], series:[{name, values:[]}]}', schema: S({ chart: { type: 'object' }, path: str('output path (no extension) relative to workspace') }, ['chart']), async run(a) { const fs2 = await writeChart(a.chart as Chart, inWs(a.path ?? `.axiora/charts/${(a.chart.title ?? 'chart').replace(/[^\w-]+/g, '-')}`)); return { text: `Saved ${fs2.map(f => path.relative(root(), f)).join(', ')}`, image: fs2.find(f => f.endsWith('.png')), file: fs2[0] }; } },
	{ name: 'generate_image', description: 'Generate an image from a text prompt; saved in the project.', schema: S({ prompt: str('image description'), size: str('e.g. 1024x1024') }, ['prompt']), async run(a) { const f = await generateImage(a.prompt, a.size); return { text: `Saved ${path.relative(root(), f)}`, image: f, file: f }; } },
	{ name: 'screenshot', description: 'Capture the editor window (or whole screen) and show it in chat.', schema: S({ target: str('window|screen') }), async run(a) { const f = await captureScreen(a.target === 'screen' ? 'screen' : 'window'); return { text: `Captured ${path.relative(root(), f)}`, image: f }; } },
	{ name: 'draft_message', description: 'Prepare an email (gmail) or Slack message as a DRAFT card. It is never sent automatically; the user reviews and clicks Send.', schema: S({ channel: str('gmail|slack'), to: str('email address or #channel'), subject: str('email subject'), body: str('message text') }, ['channel', 'to', 'body']), async run(a) { const d = await createDraft({ channel: a.channel, to: a.to, subject: a.subject, body: a.body }); return { text: `Draft ${d.id} created for ${a.to}. NOT sent — the user must click Send.`, draft: d.id }; } },
	{ name: 'run_shell', description: 'Run a shell command in the workspace (destructive commands need user approval).', schema: S({ command: str('command') }, ['command']), async run(a) { await requireApproval('shell', a.command); const o = await run(process.platform === 'win32' ? 'powershell' : 'bash', process.platform === 'win32' ? ['-NoProfile', '-Command', a.command] : ['-lc', a.command], root()).catch(e => `ERROR: ${e.message}`); return { text: o.slice(0, 8000) }; } },
	{ name: 'delete_file', description: 'Delete a file in the workspace (requires user approval).', schema: S({ path: str('relative path') }, ['path']), async run(a) { const f = inWs(a.path); await requireApproval('delete', `Delete ${path.relative(root(), f)}`); await vscode.workspace.fs.delete(vscode.Uri.file(f), { useTrash: true }); return { text: `Deleted ${a.path} (moved to trash)` }; } },
];
const byName = new Map(TOOLS.map(t => [t.name, t]));
const TOOL_PROMPT = () => `\n\n## Tools\nYou can call tools. To call one, output ONLY a single block and stop:\n<tool>{"name":"<tool>","args":{...}}</tool>\nYou then receive <tool_result>. Call tools when they help (fresh facts → web_search/web_fetch; files → make_document; messages → draft_message, never claim something was sent). Then answer normally without a tool block.\nAvailable:\n${TOOLS.map(t => `- ${t.name}: ${t.description} args: ${JSON.stringify((t.schema as any).properties)}`).join('\n')}`;

function renderOut(stream: vscode.ChatResponseStream, o: Out) {
	if (o.image && /\.(png|jpe?g|webp|gif)$/i.test(o.image)) { stream.markdown(inlineImage(o.image, path.basename(o.image))); }
	if (o.file) { stream.reference(vscode.Uri.file(o.file)); }
	if (o.draft) { stream.button({ command: 'axiora.drafts.open', arguments: [o.draft], title: vscode.l10n.t("$(edit) Review draft") }); }
}
/** Chat loop with model-initiated tool calls. Streams normal text, executes <tool> blocks. Returns the visible reply. */
export async function toolLoop(msgs: ChatMessage[], stream: vscode.ChatResponseStream, token: vscode.CancellationToken): Promise<string> {
	if (!vscode.workspace.getConfiguration('axiora.agent').get('tools', true)) { return chat(msgs, s => stream.markdown(s), token); }
	if (providerKind() !== 'ollama') {
		try { return await nativeLoop(msgs, stream, token); }
		catch (e) { if (![400, 404, 405, 422].includes((e as any).status)) { throw e; } log.warn(`native tools unsupported, using text protocol: ${(e as Error).message}`); }
	}
	msgs = [{ ...msgs[0], content: msgs[0].content + TOOL_PROMPT() }, ...msgs.slice(1)];
	let visible = '';
	for (let step = 0; step < 8 && !token.isCancellationRequested; step++) {
		let buf = '', sent = 0, inTool = false;
		const full = await chat(msgs, s => {
			buf += s; if (inTool) { return; }
			const ti = buf.indexOf('<tool'); if (ti >= 0) { inTool = true; if (ti > sent) { stream.markdown(buf.slice(sent, ti)); visible += buf.slice(sent, ti); } sent = ti; return; }
			const safe = buf.lastIndexOf('<') > buf.length - 6 ? buf.lastIndexOf('<') : buf.length; if (safe > sent) { stream.markdown(buf.slice(sent, safe)); visible += buf.slice(sent, safe); sent = safe; }
		}, token);
		const m = /<tool>\s*([\s\S]*?)\s*<\/tool>|<tool>\s*(\{[\s\S]*\})\s*$/.exec(full);
		if (!m) { if (sent < full.length) { stream.markdown(full.slice(sent)); visible += full.slice(sent); } return visible; }
		let call: { name: string; args: any };
		try { call = JSON.parse((m[1] ?? m[2]).replace(/^```\w*|```$/g, '')); } catch { msgs.push({ role: 'assistant', content: full }, { role: 'user', content: '<tool_result>Invalid JSON in tool call.</tool_result>' }); continue; }
		const t = byName.get(call.name);
		stream.progress(vscode.l10n.t("Tool: {0}…", call.name));
		let res: Out;
		try { if (!t) { throw new Error(`unknown tool ${call.name}`); } res = await t.run(call.args ?? {}, token); stream.markdown(`\n\n> 🔧 \`${call.name}\` ${summ(call.args)}\n\n`); renderOut(stream, res); }
		catch (e) { res = { text: `ERROR: ${(e as Error).message}` }; stream.markdown(vscode.l10n.t("\n\n> 🔧 `{0}` failed: {1}\n\n", call.name, (e as Error).message)); }
		msgs.push({ role: 'assistant', content: full }, { role: 'user', content: `<tool_result name="${call.name}">\n${res.text.slice(0, 12000)}\n</tool_result>` });
	}
	return visible;
}
async function exec(name: string, args: any, stream: vscode.ChatResponseStream, token: vscode.CancellationToken): Promise<Out> {
	const t = byName.get(name); stream.progress(vscode.l10n.t("Tool: {0}…", name));
	try { if (!t) { throw new Error(`unknown tool ${name}`); } const r = await t.run(args ?? {}, token); stream.markdown(`\n\n> 🔧 \`${name}\` ${summ(args)}\n\n`); renderOut(stream, r); return r; }
	catch (e) { stream.markdown(vscode.l10n.t("\n\n> 🔧 `{0}` failed: {1}\n\n", name, (e as Error).message)); return { text: `ERROR: ${(e as Error).message}` }; }
}
/** OpenAI-style native function calling (OpenRouter, OpenAI, Groq, LM Studio, vLLM…). */
async function nativeLoop(msgs: ChatMessage[], stream: vscode.ChatResponseStream, token: vscode.CancellationToken): Promise<string> {
	const sys = '\n\nYou have tools (web search/fetch, a real browser, office files, charts, images, screenshots, message drafts, gated shell). Use them when helpful. Messages are only ever DRAFTED; never claim something was sent.';
	const wire: any[] = wireMessages(applyFilters([{ ...msgs[0], content: msgs[0].content + sys }, ...msgs.slice(1)]), providerKind());
	const defs = TOOLS.map(t => ({ name: t.name, description: t.description, parameters: t.schema }));
	for (let step = 0; step < 10 && !token.isCancellationRequested; step++) {
		const r = await chatTools(wire, defs, token);
		if (!r.tool_calls) { stream.markdown(r.content); return r.content; }
		if (r.content.trim()) { stream.markdown(r.content + '\n\n'); }
		wire.push({ role: 'assistant', content: r.content || null, tool_calls: r.tool_calls });
		for (const c of r.tool_calls) {
			let args: any = {}; try { args = JSON.parse(c.function.arguments || '{}'); } catch { /* */ }
			const o = await exec(c.function.name, args, stream, token);
			wire.push({ role: 'tool', tool_call_id: c.id, content: o.text.slice(0, 12000) });
		}
	}
	const last = await chat(msgs, s => stream.markdown(s), token); return last;
}
const summ = (a: any) => { const v = a?.query ?? a?.url ?? a?.task ?? a?.prompt ?? a?.action ?? a?.kind ?? a?.command ?? a?.to ?? ''; return v ? `· ${String(v).slice(0, 80)}` : ''; };

let lastReply = '';
export function setLastReply(s: string) { lastReply = s; }
async function specFor(kind: string, desc: string, token?: vscode.CancellationToken): Promise<DocSpec> {
	const r = await chat([{ role: 'system', content: `${SYS}\nReturn ONLY JSON (no prose) for a ${kind} document spec: {"title":"..","blocks":[{"heading":"..","level":1}|{"text":".."}|{"bullets":[".."]}|{"table":[["col","col"],["v","v"]]}|{"chart":{"type":"bar|line|pie","title":"..","labels":[..],"series":[{"name":"..","values":[numbers]}]}}]${kind === 'xlsx' ? ',"sheets":[{"name":"..","rows":[["header",..],[..]]}]' : ''}${kind === 'pptx' ? ',"slides":[{"title":"..","bullets":[".."],"chart":{..},"notes":".."}]' : ''}}. Use realistic content.` }, { role: 'user', content: desc }], () => undefined, token);
	const j = /\{[\s\S]*\}/.exec(r.replace(/```json|```/g, ''))?.[0]; if (!j) { throw new Error('Model returned no JSON spec'); }
	return JSON.parse(j);
}
export function activate(ctx: vscode.ExtensionContext) {
	initMedia(ctx.secrets);
	// vscode.lm tools (usable by any agent / chat mode that supports tools)
	for (const t of TOOLS) {
		try {
			ctx.subscriptions.push(vscode.lm.registerTool(`axiora_${t.name}`, {
				prepareInvocation: async (o: any) => (['run_shell', 'delete_file', 'draft_message'].includes(t.name) ? { invocationMessage: `${t.name}`, confirmationMessages: { title: `Axiora: ${t.name}`, message: JSON.stringify(o.input).slice(0, 500) } } : { invocationMessage: `${t.name} ${summ(o.input)}` }),
				invoke: async (o: any, token: vscode.CancellationToken) => { const r = await t.run(o.input, token); return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(r.text + (r.image ? `\n(image: ${r.image})` : ''))]); }
			}));
		} catch (e) { log.warn(`registerTool ${t.name}: ${(e as Error).message}`); }
	}
	const tool = (name: string) => byName.get(name)!;
	chatCommands.set('image', async (req, stream) => { if (!req.prompt.trim()) { stream.markdown(vscode.l10n.t("Usage: `/image <description>`")); return; } stream.progress(vscode.l10n.t("Generating image…")); const o = await tool('generate_image').run({ prompt: req.prompt }); stream.markdown(`${o.text}\n\n`); renderOut(stream, o); });
	chatCommands.set('browser', async (req, stream, token) => {
		if (!req.prompt.trim()) { stream.markdown(vscode.l10n.t("Usage: `/browser <task>` e.g. `/browser open example.com and tell me the heading`")); return; }
		stream.markdown(vscode.l10n.t("**Browser agent** — {0}\n\n", req.prompt));
		const r = await runTask(req.prompt, s => stream.markdown(`- ${s}\n`), token); stream.markdown(vscode.l10n.t("\n**Result:** {0}\n\n", r.result)); if (r.shot) { renderOut(stream, { text: '', image: r.shot, file: r.shot }); }
	});
	chatCommands.set('office', async (req, stream, token) => {
		const m = /^(xlsx|docx|pptx|pdf)\b\s*([\s\S]*)$/i.exec(req.prompt.trim()); if (!m) { stream.markdown(vscode.l10n.t("Usage: `/office <xlsx|docx|pptx|pdf> <what to create>`")); return; }
		stream.progress(vscode.l10n.t("Writing document spec…")); const spec = await specFor(m[1].toLowerCase(), m[2], token);
		stream.progress(vscode.l10n.t("Building file…")); const o = await tool('make_document').run({ kind: m[1].toLowerCase(), spec }); stream.markdown(`${o.text}\n\n`); renderOut(stream, o);
		stream.button({ command: 'revealFileInOS', arguments: [vscode.Uri.file(o.file!)], title: vscode.l10n.t("$(folder-opened) Reveal") });
	});
	chatCommands.set('chart', async (req, stream, token) => {
		const r = await chat([{ role: 'system', content: 'Return ONLY JSON: {"type":"bar|line|pie","title":"..","labels":[..],"series":[{"name":"..","values":[numbers]}]}' }, { role: 'user', content: req.prompt }], () => undefined, token);
		const o = await tool('make_chart').run({ chart: JSON.parse(/\{[\s\S]*\}/.exec(r)![0]) }); stream.markdown(`${o.text}\n\n`); renderOut(stream, o);
	});
	chatCommands.set('screenshot', async (req, stream) => {
		const a = req.prompt.trim(); let o: Out;
		if (/^https?:\/\/|^[\w-]+\.[a-z]{2,}/i.test(a)) { await act({ action: 'goto', url: a }); o = await act({ action: 'screenshot' }); }
		else if (a === 'browser') { o = await act({ action: 'screenshot' }); }
		else { o = await tool('screenshot').run({ target: a === 'screen' ? 'screen' : 'window' }); }
		stream.markdown(`${o.text.split('\n')[0]}\n\n`); renderOut(stream, { ...o, file: o.image });
	});
	chatCommands.set('draft', async (req, stream) => {
		const m = /^(gmail|email|slack)\s+(\S+)\s*([\s\S]*)$/i.exec(req.prompt.trim()); if (!m) { stream.markdown(vscode.l10n.t("Usage: `/draft gmail someone@x.com Subject | body` or `/draft slack #channel text`")); return; }
		const ch = m[1].toLowerCase() === 'slack' ? 'slack' : 'gmail'; const [subject, ...b] = ch === 'gmail' && m[3].includes('|') ? m[3].split('|') : ['', m[3]];
		const d = await createDraft({ channel: ch, to: m[2], subject: subject.trim(), body: b.join('|').trim() });
		stream.markdown(vscode.l10n.t("Draft created — **not sent**. Review it, then click **Send** on the card.\n\n")); stream.button({ command: 'axiora.drafts.open', arguments: [d.id], title: vscode.l10n.t("$(edit) Review draft") });
	});
	// palette
	register(ctx, 'axiora.browser.runTask', async () => {
		const t = await vscode.window.showInputBox({ prompt: vscode.l10n.t("Browser task (e.g. \"open github.com/trending and list the top 3 repos\")"), ignoreFocusOut: true }); if (!t) { return; }
		await vscode.commands.executeCommand('workbench.action.chat.open', { query: `@axiora /browser ${t}` });
	});
	register(ctx, 'axiora.browser.open', async () => { const u = await vscode.window.showInputBox({ prompt: vscode.l10n.t("URL to open in the agent browser") }); if (u) { await act({ action: 'goto', url: u }); } });
	register(ctx, 'axiora.browser.close', () => closeBrowser());
	register(ctx, 'axiora.office.generate', async () => {
		const k = await vscode.window.showQuickPick(['xlsx', 'docx', 'pptx', 'pdf'], { placeHolder: vscode.l10n.t("File type") }); if (!k) { return; }
		const d = await vscode.window.showInputBox({ prompt: vscode.l10n.t("Describe the {0} to create", k), ignoreFocusOut: true }); if (!d) { return; }
		await vscode.commands.executeCommand('workbench.action.chat.open', { query: `@axiora /office ${k} ${d}` });
	});
	register(ctx, 'axiora.office.fromJson', async () => {
		const ed = vscode.window.activeTextEditor; if (!ed) { return; } const spec = JSON.parse(ed.document.getText(ed.selection.isEmpty ? undefined : ed.selection));
		const k = await vscode.window.showQuickPick(['xlsx', 'docx', 'pptx', 'pdf'], { placeHolder: vscode.l10n.t("Generate from this JSON spec as…") }); if (!k) { return; }
		const f = ed.document.fileName.replace(/\.[^.\\/]+$/, '') + '.' + k; await makeDocument(k as any, spec, f); vscode.window.showInformationMessage(vscode.l10n.t("Created {0}", path.basename(f)), 'Reveal').then(a => a && vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(f)));
	});
	register(ctx, 'axiora.chart.export', async () => {
		const ed = vscode.window.activeTextEditor; if (!ed) { return; } const c = JSON.parse(ed.document.getText(ed.selection.isEmpty ? undefined : ed.selection)) as Chart;
		const out = await writeChart(c, ed.document.fileName.replace(/\.[^.\\/]+$/, '') + '-chart'); vscode.window.showInformationMessage(vscode.l10n.t("Chart saved: {0}", out.map(f => path.basename(f)).join(', ')));
	});
	register(ctx, 'axiora.image.generate', async () => { const p = await vscode.window.showInputBox({ prompt: vscode.l10n.t("Describe the image") }); if (p) { await vscode.commands.executeCommand('workbench.action.chat.open', { query: `@axiora /image ${p}` }); } });
	register(ctx, 'axiora.image.setApiKey', async () => { const k = await vscode.window.showInputBox({ prompt: vscode.l10n.t("API key for image generation (blank = use the main AI key)"), password: true }); if (k !== undefined) { k ? await ctx.secrets.store('axiora.image.apiKey', k) : await ctx.secrets.delete('axiora.image.apiKey'); } });
	register(ctx, 'axiora.screenshot.toChat', async () => { const p = await vscode.window.showQuickPick([{ label: 'window', description: vscode.l10n.t("Editor window") }, { label: 'screen', description: vscode.l10n.t("Whole screen") }, { label: 'browser', description: vscode.l10n.t("Agent browser page") }], { placeHolder: vscode.l10n.t("Capture and post to chat") }); if (p) { await vscode.commands.executeCommand('workbench.action.chat.open', { query: `@axiora /screenshot ${p.label}` }); } });
	register(ctx, 'axiora.voice.readAloud', async (text?: string) => { const t = typeof text === 'string' ? text : lastReply || vscode.window.activeTextEditor?.document.getText(vscode.window.activeTextEditor.selection); if (!t) { vscode.window.showInformationMessage(vscode.l10n.t("Nothing to read yet.")); return; } await speak(t); });
	register(ctx, 'axiora.voice.stop', () => stopSpeaking());
	register(ctx, 'axiora.voice.setTtsApiKey', async () => { const k = await vscode.window.showInputBox({ prompt: vscode.l10n.t("API key for the TTS endpoint (blank = main AI key)"), password: true }); if (k !== undefined) { k ? await ctx.secrets.store('axiora.voice.ttsApiKey', k) : await ctx.secrets.delete('axiora.voice.ttsApiKey'); } });
	register(ctx, 'axiora.approval.test', async () => { const ok = await approve('shell', 'rm -rf ./build'); vscode.window.showInformationMessage(ok ? 'Approved' : 'Denied'); });
}
