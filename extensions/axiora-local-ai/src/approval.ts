/*---------------------------------------------------------------------------------------------
 *  Global approval gate for destructive / externally visible actions.
 *  axiora.approval.mode:
 *    "always"         - confirm EVERY agent action (file writes, shell, browser clicks, sends, deletes…)
 *    "ask"            - (default) confirm destructive + external actions (delete, git push, rm/destructive shell, sends, deploy)
 *    "never-for-safe" - confirm only high-risk actions (force push, recursive delete, sends, deploy, production changes)
 *  Nothing is ever auto-approved for sends: "send" always asks unless the user clicked Send on a draft card.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { log } from './util';

export type Risk = 'safe' | 'medium' | 'high';
export type Kind = 'shell' | 'write' | 'delete' | 'git-push' | 'send' | 'deploy' | 'browser' | 'other';

const HIGH = [/\brm\s+(-[a-z]*r[a-z]*f?|-[a-z]*f[a-z]*r)\b/i, /\bgit\s+push\b.*(--force|-f\b|--force-with-lease|\+\w)/i, /\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f|branch\s+-D|filter-branch|filter-repo)/i,
	/\b(mkfs|dd\s+if=|shred|format\s+[a-z]:)/i, /\b(DROP|TRUNCATE)\s+(TABLE|DATABASE|SCHEMA)\b/i, /\bkubectl\s+delete\b/i, /\bterraform\s+(apply|destroy)\b/i, /\bdocker\s+(system\s+prune|volume\s+rm|rm\s+-f)/i,
	/Remove-Item\b.*-Recurse/i, /\brmdir\s+\/s\b/i, /\bdel\s+\/[sq]/i, /\bnpm\s+publish\b/i, /\bchmod\s+-R\s+777\b/i, /:\(\)\s*\{\s*:\|:&\s*\};:/, /\bcurl\b[^|]*\|\s*(ba|z)?sh\b/i];
const MEDIUM = [/\brm\b/i, /\bgit\s+(push|rebase|reset|checkout\s+--|restore|stash\s+drop|tag\s+-d)\b/i, /\b(mv|unlink|Remove-Item|del|erase|rmdir)\b/i, /\bdocker\s+(compose\s+down|rm|rmi|stop)\b/i,
	/\b(npm|pnpm|yarn)\s+(uninstall|remove)\b/i, /\bpip\s+uninstall\b/i, /\bsudo\b/i, /\bDELETE\s+FROM\b/i, /\b(UPDATE)\s+\w+\s+SET\b/i, /\b(scp|rsync)\b.*--delete/i, />\s*[^&|]/];

export function classifyShell(cmd: string): Risk {
	if (HIGH.some(r => r.test(cmd))) { return 'high'; }
	if (MEDIUM.some(r => r.test(cmd))) { return 'medium'; }
	return 'safe';
}
const BASE: Record<Kind, Risk> = { shell: 'safe', write: 'safe', browser: 'safe', other: 'medium', delete: 'medium', 'git-push': 'medium', send: 'high', deploy: 'high' };
const allowed = new Set<string>();

export function mode(): 'always' | 'ask' | 'never-for-safe' { return vscode.workspace.getConfiguration('axiora.approval').get('mode', 'ask'); }
export function needsApproval(kind: Kind, risk: Risk): boolean {
	const m = mode();
	if (kind === 'send') { return true; }
	if (m === 'always') { return true; }
	if (m === 'never-for-safe') { return risk === 'high'; }
	return risk !== 'safe';
}
/** Ask the user before a destructive/external action. Returns true when allowed. */
export async function approve(kind: Kind, detail: string, risk?: Risk): Promise<boolean> {
	const r = risk ?? (kind === 'shell' ? classifyShell(detail) : kind === 'git-push' && /--force|-f\b/.test(detail) ? 'high' : BASE[kind]);
	if (!needsApproval(kind, r)) { return true; }
	const key = `${kind}:${detail}`;
	if (allowed.has(key)) { return true; }
	const icon = r === 'high' ? '⚠️ HIGH RISK' : r === 'medium' ? 'Destructive' : 'Agent action';
	const a = await vscode.window.showWarningMessage(vscode.l10n.t("Axiora approval — {0} ({1})", icon, kind), { modal: true, detail: `${detail.slice(0, 1500)}\n\nPolicy: axiora.approval.mode = "${mode()}".` }, 'Allow', 'Allow for this session');
	log.info(`approval ${kind} [${r}] ${a ?? 'DENIED'}: ${detail.slice(0, 200)}`);
	if (a === 'Allow for this session') { allowed.add(key); }
	return !!a;
}
/** Throws when the user denies. */
export async function requireApproval(kind: Kind, detail: string, risk?: Risk) {
	if (!await approve(kind, detail, risk)) { throw new Error(`Denied by approval policy: ${kind}`); }
}
export function activate(ctx: vscode.ExtensionContext) {
	ctx.subscriptions.push(vscode.commands.registerCommand('axiora.approval.setMode', async () => {
		const p = await vscode.window.showQuickPick([
			{ label: 'ask', description: vscode.l10n.t("Confirm destructive & external actions (default)") },
			{ label: 'always', description: vscode.l10n.t("Confirm every agent action") },
			{ label: 'never-for-safe', description: vscode.l10n.t("Confirm only high-risk actions (sends always confirmed)") }], { placeHolder: vscode.l10n.t("Approval mode (current: {0})", mode()) });
		if (p) { await vscode.workspace.getConfiguration('axiora.approval').update('mode', p.label, vscode.ConfigurationTarget.Global); allowed.clear(); }
	}));
}
