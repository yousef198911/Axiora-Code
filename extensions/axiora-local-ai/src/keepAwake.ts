/*---------------------------------------------------------------------------------------------
 *  Keep the machine awake while the agent works: holds a sleep inhibitor (systemd-inhibit /
 *  caffeinate / Windows SetThreadExecutionState) while chat requests or tasks are running.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as cp from 'child_process';

let proc: cp.ChildProcess | undefined; let holders = 0;
function start() {
	if (proc || !vscode.workspace.getConfiguration('axiora.agent').get('keepAwake', true)) { return; }
	const [cmd, args] = process.platform === 'darwin' ? ['caffeinate', ['-i', '-w', String(process.pid)]]
		: process.platform === 'win32' ? ['powershell', ['-NoProfile', '-Command', `Add-Type -Name P -Namespace W -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);'; [W.P]::SetThreadExecutionState(0x80000001); while ($true) { Start-Sleep 30 }`]]
			: ['systemd-inhibit', ['--what=idle:sleep', '--who=Axiora', '--why=Agent is working', 'sleep', 'infinity']];
	try { proc = cp.spawn(cmd as string, args as string[], { stdio: 'ignore' }); proc.on('error', () => { proc = undefined; }); proc.on('exit', () => { proc = undefined; }); } catch { proc = undefined; }
}
function stop() { proc?.kill(); proc = undefined; }
/** Wrap long agent work: keeps the machine awake until the promise settles. */
export async function awake<T>(p: Promise<T>): Promise<T> { holders++; start(); try { return await p; } finally { if (--holders === 0) { stop(); } } }
export function activate(ctx: vscode.ExtensionContext) {
	ctx.subscriptions.push({ dispose: stop });
	ctx.subscriptions.push(vscode.tasks.onDidStartTask(() => { holders++; start(); }), vscode.tasks.onDidEndTask(() => { if (--holders <= 0) { holders = 0; stop(); } }));
}
