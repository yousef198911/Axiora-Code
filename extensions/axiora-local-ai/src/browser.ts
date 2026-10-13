/*---------------------------------------------------------------------------------------------
 *  Real browser driver (playwright-core + an installed Chrome / Edge / Chromium).
 *  Actions: goto, click (selector | text | [n]), fill, press, select, check, back, wait, text, snapshot, screenshot, assert, close.
 *  "Browser: Run Task..." lets the model drive the page step by step (with approval for risky clicks).
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as cp from 'child_process';
import type { Browser, Page } from 'playwright-core';
import { chat } from './llm';
import { log, wsRoot } from './util';
import { approve } from './approval';

let browser: Browser | undefined, page: Page | undefined;
const cfg = () => vscode.workspace.getConfiguration('axiora.browser');
export function findBrowser(): string | undefined {
	const set = cfg().get<string>('executablePath', ''); if (set) { return set; }
	const env = process.env;
	const c = process.platform === 'win32' ? [`${env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`, `${env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`, `${env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`, `${env['PROGRAMFILES(X86)']}\\Microsoft\\Edge\\Application\\msedge.exe`, `${env.PROGRAMFILES}\\Microsoft\\Edge\\Application\\msedge.exe`]
		: process.platform === 'darwin' ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser']
			: ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'brave-browser'].map(b => { try { return cp.execFileSync('which', [b]).toString().trim(); } catch { return ''; } });
	return c.find(p => p && fs.existsSync(p));
}
export async function getPage(headless?: boolean): Promise<Page> {
	if (page && !page.isClosed()) { return page; }
	const exe = findBrowser(); if (!exe) { throw new Error('No Chrome/Edge/Chromium found. Install one or set axiora.browser.executablePath.'); }
	const { chromium } = await import('playwright-core');
	browser = await chromium.launch({ executablePath: exe, headless: headless ?? cfg().get('headless', false), args: ['--no-first-run', '--no-default-browser-check'] });
	const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
	page = await ctx.newPage(); page.setDefaultTimeout(15000);
	return page;
}
export async function closeBrowser() { await browser?.close().catch(() => undefined); browser = page = undefined; }

/** Numbered list of visible interactive elements (tags them with data-axiora-n). */
export async function snapshot(p: Page): Promise<string> {
	const els = await p.evaluate(`(() => {
		const out = []; let n = 0;
		document.querySelectorAll('[data-axiora-n]').forEach(e => e.removeAttribute('data-axiora-n'));
		for (const e of Array.from(document.querySelectorAll('a[href],button,input,textarea,select,[role=button],[role=link],[role=tab],[role=checkbox],[contenteditable=true],summary'))) {
			const r = e.getBoundingClientRect(); if (r.width < 2 || r.height < 2 || getComputedStyle(e).visibility === 'hidden' || e.type === 'hidden') { continue; }
			e.setAttribute('data-axiora-n', String(++n));
			const i = e; const lab = (i.labels?.[0]?.innerText ?? '') || e.getAttribute('aria-label') || i.placeholder || e.innerText || i.value || e.getAttribute('title') || e.getAttribute('name') || '';
			out.push(\`[\${n}] \${e.tagName.toLowerCase()}\${i.type ? \`:\${i.type}\` : ''} "\${lab.replace(/\s+/g, ' ').trim().slice(0, 70)}"\${i.value && e.tagName !== 'BUTTON' ? \` value="\${String(i.value).slice(0, 40)}"\` : ''}\`);
			if (n >= 80) { break; }
		}
		return out;
	})()`) as string[];
	return `URL: ${p.url()}\nTitle: ${await p.title()}\nElements:\n${els.join('\n')}`;
}
export interface BrowserAction { action: string; url?: string; selector?: string; text?: string; n?: number; value?: string; key?: string; path?: string; ms?: number }
function locate(p: Page, a: BrowserAction) {
	if (a.n) { return p.locator(`[data-axiora-n="${a.n}"]`).first(); }
	if (a.selector) { return p.locator(a.selector).first(); }
	if (a.text) { return p.getByRole('button', { name: a.text }).or(p.getByRole('link', { name: a.text })).or(p.getByLabel(a.text)).or(p.getByPlaceholder(a.text)).or(p.getByText(a.text)).first(); }
	throw new Error('Give n, selector or text');
}
const RISKY = /\b(buy|pay|purchase|order|checkout|delete|remove|send|submit|publish|confirm|transfer|subscribe|sign up|unsubscribe)\b/i;
export function shotPath(name = 'browser'): string {
	const dir = path.join(wsRoot()?.fsPath ?? os.tmpdir(), '.axiora', 'shots'); fs.mkdirSync(dir, { recursive: true });
	return path.join(dir, `${name}-${new Date().toISOString().replace(/[:.]/g, '-')}.png`);
}
/** Run one action; returns a text observation (and a screenshot path for screenshot). */
export async function act(a: BrowserAction): Promise<{ text: string; image?: string }> {
	const p = await getPage();
	switch (a.action) {
		case 'goto': case 'open': await p.goto(/^\w+:/.test(a.url ?? '') ? a.url! : `https://${a.url}`, { waitUntil: 'domcontentloaded' }); break;
		case 'click': {
			const l = locate(p, a); const label = (await l.innerText().catch(() => '')) || a.text || a.selector || '';
			if (RISKY.test(label) && !await approve('browser', `Click "${label.slice(0, 80)}" on ${p.url()}`, 'medium')) { return { text: 'User denied this click.' }; }
			await l.click(); await p.waitForLoadState('domcontentloaded').catch(() => undefined); break;
		}
		case 'fill': case 'type': await locate(p, a).fill(a.value ?? ''); break;
		case 'press': await (a.n || a.selector || a.text ? locate(p, a).press(a.key ?? 'Enter') : p.keyboard.press(a.key ?? 'Enter')); await p.waitForLoadState('domcontentloaded').catch(() => undefined); break;
		case 'select': await locate(p, a).selectOption(a.value ?? ''); break;
		case 'check': await locate(p, a).check(); break;
		case 'back': await p.goBack(); break;
		case 'wait': await p.waitForTimeout(Math.min(a.ms ?? 1000, 10000)); break;
		case 'text': return { text: (await p.innerText('body')).slice(0, 8000) };
		case 'screenshot': { const f = a.path ?? shotPath(); await p.screenshot({ path: f }); return { text: `Saved screenshot ${f}`, image: f }; }
		case 'assert': { const body = ((await p.textContent('body')) ?? '').replace(/\s+/g, ' ').toLowerCase(); const ok = a.text ? body.includes(a.text.replace(/\s+/g, ' ').toLowerCase()) : !!(await locate(p, a).count()); return { text: ok ? `PASS: "${a.text ?? a.selector}" present` : `FAIL: "${a.text ?? a.selector}" not found on ${p.url()}` }; }
		case 'close': await closeBrowser(); return { text: 'Browser closed.' };
		case 'snapshot': break;
		default: throw new Error(`Unknown browser action ${a.action}`);
	}
	return { text: await snapshot(p) };
}
const TASK_SYS = `You control a real web browser to complete the user's task. Each turn you get the page state (URL, title, numbered interactive elements).
Reply with ONE JSON object only, one of:
{"action":"goto","url":"https://..."} | {"action":"click","n":3} | {"action":"fill","n":5,"value":"text"} | {"action":"press","key":"Enter","n":5} | {"action":"select","n":2,"value":"opt"} | {"action":"text"} | {"action":"assert","text":"expected text"} | {"action":"screenshot"} | {"action":"done","result":"what you found / did"}
Never enter passwords or payment details unless the user gave them. Stop with "done" as soon as the task is complete.`;
export async function runTask(task: string, onStep: (s: string) => void, token?: vscode.CancellationToken): Promise<{ result: string; shot?: string }> {
	const p = await getPage(); let obs = p.url() === 'about:blank' ? 'URL: about:blank (no page yet — start with goto)' : await snapshot(p);
	const hist: { role: 'system' | 'user' | 'assistant'; content: string }[] = [{ role: 'system', content: TASK_SYS }];
	const max = cfg().get<number>('maxSteps', 15);
	for (let i = 1; i <= max && !token?.isCancellationRequested; i++) {
		hist.push({ role: 'user', content: `${i === 1 ? `Task: ${task}\n\n` : ''}${obs.slice(0, 7000)}` });
		const reply = await chat(hist.slice(0, 1).concat(hist.slice(-8)), () => undefined, token);
		hist.push({ role: 'assistant', content: reply });
		let a: BrowserAction & { result?: string };
		try { a = JSON.parse(/\{[\s\S]*\}/.exec(reply)?.[0] ?? ''); } catch { onStep(`Step ${i}: (model reply was not a JSON action, retrying)`); obs = 'Your reply was not valid JSON. Reply with ONE JSON action object only.'; continue; }
		onStep(`Step ${i}: ${a.action}${a.url ? ` ${a.url}` : ''}${a.n ? ` [${a.n}]` : ''}${a.value ? ` "${a.value}"` : ''}${a.text ? ` "${a.text}"` : ''}`);
		if (a.action === 'done') { const f = shotPath('task'); await p.screenshot({ path: f }).catch(() => undefined); return { result: a.result ?? 'Done.', shot: fs.existsSync(f) ? f : undefined }; }
		try { const r = await act(a); obs = r.text; } catch (e) { obs = `Action failed: ${(e as Error).message}\n${await snapshot(p).catch(() => '')}`; log.warn(`browser: ${(e as Error).message}`); }
	}
	const f = shotPath('task'); await p.screenshot({ path: f }).catch(() => undefined);
	return { result: 'Stopped after the step limit.', shot: f };
}
