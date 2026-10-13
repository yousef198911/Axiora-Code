/*---------------------------------------------------------------------------------------------
 *  Block-based terminal + an agent that lives in the terminal.
 *  - Command Blocks: every command run in an integrated terminal (shell integration) becomes a
 *    block: command, exit code, duration, output. "Terminal: Command Blocks..." (terminal
 *    context menu / Ctrl+Alt+B in a terminal) → copy output, rerun, open output, ask AI to fix.
 *  - Axiora Agent terminal (terminal "+" dropdown → Axiora Agent): chat with the agent in a
 *    terminal; "!cmd" runs a command as a block; "/do <goal>" lets the agent propose a command
 *    that runs only after you confirm with y.
 *  - Edit: Transform Selection with Shell Command... pipes each selection through a command.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as cp from 'child_process';
import { register, wsRoot, SYS, ask } from './util';
import { chat, ChatMessage } from './llm';

type Block = { cmd: string; cwd?: string; exit?: number; start: number; end?: number; out: string; term: vscode.Terminal };
const strip = (s: string) => s.replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, '').replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\r/g, '');
export function activate(ctx: vscode.ExtensionContext) {
	const blocks: Block[] = [];
	const byExec = new Map<vscode.TerminalShellExecution, Block>();
	ctx.subscriptions.push(vscode.window.onDidStartTerminalShellExecution(async e => {
		const b: Block = { cmd: e.execution.commandLine.value, cwd: e.execution.cwd?.fsPath, start: Date.now(), out: '', term: e.terminal };
		blocks.push(b); if (blocks.length > 200) { blocks.shift(); } byExec.set(e.execution, b);
		try { for await (const d of e.execution.read()) { if (b.out.length < 200000) { b.out += d; } } } catch { /* closed */ }
	}), vscode.window.onDidEndTerminalShellExecution(e => { const b = byExec.get(e.execution); if (b) { b.exit = e.exitCode; b.end = Date.now(); byExec.delete(e.execution); } }));
	const show = async (content: string, language = 'log') => vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ content, language }), { preview: true, viewColumn: vscode.ViewColumn.Beside });
	register(ctx, 'axiora.term.blocks', async () => {
		const term = vscode.window.activeTerminal;
		const list = [...blocks].reverse().filter(b => !term || b.term === term || !blocks.some(x => x.term === term));
		if (!list.length) { vscode.window.showInformationMessage('No command blocks recorded in this window yet (terminals need shell integration: bash, zsh, fish or pwsh).'); return; }
		const icon = (b: Block) => b.exit === undefined ? '$(sync~spin)' : b.exit === 0 ? '$(pass)' : '$(error)';
		const p = await vscode.window.showQuickPick(list.map(b => ({ label: `${icon(b)} ${b.cmd}`, description: `${b.exit === undefined ? 'running' : `exit ${b.exit}`} · ${(((b.end ?? Date.now()) - b.start) / 1000).toFixed(1)}s`, detail: strip(b.out).trim().split('\n').slice(-1)[0]?.slice(0, 120), b })), { placeHolder: 'Command blocks (newest first)', matchOnDetail: true });
		if (!p) { return; }
		const b = p.b; const out = strip(b.out);
		const a = await vscode.window.showQuickPick([...(b.exit ? ['$(sparkle) Ask AI to Fix'] : []), '$(copy) Copy Output', '$(copy) Copy Command', '$(debug-rerun) Rerun', '$(go-to-file) Open Output in Editor', '$(sparkle) Explain Output'], { placeHolder: b.cmd });
		if (!a) { return; }
		if (a.includes('Copy Output')) { await vscode.env.clipboard.writeText(out); }
		else if (a.includes('Copy Command')) { await vscode.env.clipboard.writeText(b.cmd); }
		else if (a.includes('Rerun')) { b.term.show(); b.term.sendText(b.cmd); }
		else if (a.includes('Open Output')) { await show(`$ ${b.cmd}\n${out}`); }
		else { await vscode.commands.executeCommand('workbench.action.chat.open', { query: `@axiora ${a.includes('Fix') ? 'This command failed. Find the root cause and give the exact fix' : 'Explain this command output'}:\n\`\`\`\n$ ${b.cmd}  (exit ${b.exit ?? '?'}, cwd ${b.cwd ?? '?'})\n${out.split('\n').slice(-80).join('\n')}\n\`\`\`` }); }
	});

	// --- agent terminal
	ctx.subscriptions.push(vscode.window.registerTerminalProfileProvider('axiora.agentTerminal', { provideTerminalProfile: () => new vscode.TerminalProfile({ name: 'Axiora Agent', pty: agentPty(), iconPath: new vscode.ThemeIcon('sparkle') }) }));
	register(ctx, 'axiora.term.agent', () => vscode.window.createTerminal({ name: 'Axiora Agent', pty: agentPty(), iconPath: new vscode.ThemeIcon('sparkle') }).show());

	// --- transform selection through a shell command
	register(ctx, 'axiora.edit.shellFilter', async () => {
		const ed = vscode.window.activeTextEditor; if (!ed) { return; }
		const last = ctx.globalState.get<string>('axiora.shellFilter', 'sort');
		const cmd = await vscode.window.showInputBox({ prompt: 'Pipe each selection (or the whole file) through this shell command; output replaces it', value: last, placeHolder: 'sort -u   |   jq .   |   tr a-z A-Z   |   python3 -c "..."' });
		if (!cmd) { return; } await ctx.globalState.update('axiora.shellFilter', cmd);
		const sels = ed.selections.some(s => !s.isEmpty) ? ed.selections.filter(s => !s.isEmpty) : [new vscode.Selection(0, 0, ed.document.lineCount, 0)];
		const cwd = wsRoot()?.fsPath;
		try {
			const outs = await Promise.all(sels.map(s => new Promise<string>((res, rej) => { const p = cp.spawn(process.platform === 'win32' ? 'cmd' : 'sh', process.platform === 'win32' ? ['/c', cmd] : ['-c', cmd], { cwd }); let o = '', e = ''; p.stdout.on('data', d => o += d); p.stderr.on('data', d => e += d); p.on('close', c => c === 0 ? res(o) : rej(new Error(e.trim() || `exit ${c}`))); p.stdin.end(ed.document.getText(s)); })));
			await ed.edit(eb => sels.forEach((s, i) => eb.replace(s, ed.document.getText(s).endsWith('\n') || outs[i].endsWith('\n') === false ? outs[i] : outs[i].replace(/\n$/, ''))));
		} catch (e) { vscode.window.showErrorMessage(`Command failed: ${(e as Error).message}`); }
	});
}

function agentPty(): vscode.Pseudoterminal {
	const w = new vscode.EventEmitter<string>(); const close = new vscode.EventEmitter<void>();
	let line = ''; let busy = false; let pending: string | undefined; const hist: ChatMessage[] = [];
	const cwd = wsRoot()?.fsPath ?? process.env.HOME ?? '/';
	const out = (s: string) => w.fire(s.replace(/\r?\n/g, '\r\n'));
	const prompt = () => out('\x1b[36maxiora ›\x1b[0m ');
	const runCmd = (c: string) => new Promise<void>(res => { out(`\x1b[2m$ ${c}\x1b[0m\n`); const p = cp.spawn('sh', ['-c', c], { cwd }); p.stdout.on('data', d => out(String(d))); p.stderr.on('data', d => out(`\x1b[31m${d}\x1b[0m`)); p.on('close', code => { out(`\x1b[2m[exit ${code}]\x1b[0m\n`); hist.push({ role: 'user', content: `I ran \`${c}\` (exit ${code}).` }); res(); }); });
	const handle = async (q: string) => {
		busy = true;
		try {
			if (pending !== undefined) { const c = pending; pending = undefined; if (/^y(es)?$/i.test(q)) { await runCmd(c); } else { out('Skipped.\n'); } }
			else if (q.startsWith('!')) { await runCmd(q.slice(1).trim()); }
			else if (q === 'exit') { close.fire(); return; }
			else if (q === 'clear') { out('\x1b[2J\x1b[H'); }
			else if (q.startsWith('/do ')) {
				const c = (await ask(`Goal: ${q.slice(4)}\nWorking directory: ${cwd}\nOS: ${process.platform}\nReply with ONLY one shell command that achieves it, no explanation, no fences.`, SYS)).trim().replace(/^`+|`+$/g, '').split('\n')[0];
				pending = c; out(`Proposed: \x1b[33m${c}\x1b[0m\nRun it? [y/N] `); busy = false; return;
			} else if (q) {
				hist.push({ role: 'user', content: q });
				const r = await chat([{ role: 'system', content: `${SYS}\nYou are running inside a terminal (cwd ${cwd}). Plain text, short lines.` }, ...hist.slice(-12)], s => out(s));
				hist.push({ role: 'assistant', content: r }); out('\n');
			}
		} catch (e) { out(`\x1b[31m${(e as Error).message}\x1b[0m\n`); }
		busy = false; prompt();
	};
	return {
		onDidWrite: w.event, onDidClose: close.event,
		open: () => { out('\x1b[1mAxiora Agent\x1b[0m — ask anything · \x1b[33m!cmd\x1b[0m runs a command · \x1b[33m/do <goal>\x1b[0m proposes a command (asks before running) · \x1b[33mexit\x1b[0m\n'); prompt(); },
		close: () => undefined,
		handleInput: d => {
			if (busy) { return; }
			if (d === '\r') { out('\n'); const q = line.trim(); line = ''; void handle(q); }
			else if (d === '\x7f') { if (line) { line = line.slice(0, -1); w.fire('\b \b'); } }
			else if (d === '\x03') { line = ''; pending = undefined; out('^C\n'); prompt(); }
			else if (d >= ' ' || d.length > 1) { const t = d.replace(/[\x00-\x1f]/g, ''); line += t; w.fire(t); }
		},
	};
}
