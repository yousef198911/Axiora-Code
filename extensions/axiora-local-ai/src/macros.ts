/*---------------------------------------------------------------------------------------------
 *  Keyboard macros: record typing + editor commands run through the palette-free recorder,
 *  play back N times, save named macros.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { addTypeHandler } from './typeRouter';
import { register } from './util';

type Step = { t: 'type'; text: string } | { t: 'cmd'; id: string };
const RECORDABLE = ['cursorDown', 'cursorUp', 'cursorLeft', 'cursorRight', 'cursorHome', 'cursorEnd', 'cursorWordLeft', 'cursorWordRight', 'deleteLeft', 'deleteRight',
	'editor.action.insertLineAfter', 'cursorLineStart', 'cursorLineEnd', 'tab', 'outdent', 'editor.action.deleteLines', 'cursorDownSelect', 'cursorUpSelect', 'cursorEndSelect', 'cursorHomeSelect',
	'editor.action.clipboardCopyAction', 'editor.action.clipboardPasteAction', 'editor.action.clipboardCutAction', 'cursorWordEndRight', 'cursorWordStartLeft'];

export function activate(ctx: vscode.ExtensionContext) {
	let rec: Step[] | undefined; let last: Step[] = ctx.workspaceState.get('axiora.macro.last', []);
	let subs: vscode.Disposable[] = [];
	const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1000);
	status.text = '$(record) REC'; status.tooltip = 'Recording macro — click to stop'; status.command = 'axiora.macro.stop';
	ctx.subscriptions.push(status);

	const stop = () => {
		if (!rec) { return; }
		subs.forEach(s => s.dispose()); subs = [];
		last = rec; rec = undefined; ctx.workspaceState.update('axiora.macro.last', last);
		status.hide(); vscode.commands.executeCommand('setContext', 'axiora.macroRecording', false);
		vscode.window.setStatusBarMessage(`Macro recorded (${last.length} steps)`, 3000);
	};
	register(ctx, 'axiora.macro.start', () => {
		if (rec) { return stop(); }
		rec = [];
		subs.push(addTypeHandler(text => { rec?.push({ t: 'type', text }); return false; }));
		// wrap common editing commands bound to keys while recording
		for (const id of RECORDABLE) {
			subs.push(vscode.commands.registerCommand(`axiora.macro.rec.${id}`, async () => { rec?.push({ t: 'cmd', id }); await vscode.commands.executeCommand(id); }));
		}
		status.show(); vscode.commands.executeCommand('setContext', 'axiora.macroRecording', true);
	});
	register(ctx, 'axiora.macro.stop', stop);
	const play = async (steps: Step[], times = 1) => {
		for (let n = 0; n < times; n++) {
			for (const s of steps) { if (s.t === 'type') { await vscode.commands.executeCommand('default:type', { text: s.text }); } else { await vscode.commands.executeCommand(s.id); } }
		}
	};
	register(ctx, 'axiora.macro.play', () => play(last));
	register(ctx, 'axiora.macro.playN', async () => { const n = await vscode.window.showInputBox({ prompt: 'Repeat macro how many times?', value: '5' }); if (n && +n > 0) { await play(last, +n); } });
	register(ctx, 'axiora.macro.save', async () => {
		const name = await vscode.window.showInputBox({ prompt: 'Macro name' }); if (!name) { return; }
		await ctx.globalState.update('axiora.macros', { ...ctx.globalState.get<Record<string, Step[]>>('axiora.macros', {}), [name]: last });
	});
	register(ctx, 'axiora.macro.runSaved', async () => {
		const all = ctx.globalState.get<Record<string, Step[]>>('axiora.macros', {});
		const p = await vscode.window.showQuickPick(Object.keys(all), { placeHolder: 'Run saved macro' }); if (p) { await play(all[p]); }
	});
}
