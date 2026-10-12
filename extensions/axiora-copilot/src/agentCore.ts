/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Pure helpers for Axiora Agent mode (no `vscode` import) so they can be unit tested with plain mocha.

import * as fs from 'fs';
import * as path from 'path';

export class AgentToolError extends Error { }

/** Normalizes for comparison (case-insensitive file systems on Windows/macOS). */
function cmpKey(p: string, platform: NodeJS.Platform): string {
	return platform === 'linux' ? p : p.toLowerCase();
}

/** True when `child` equals `root` or lies inside it. Both must be absolute and normalized. */
export function isInside(root: string, child: string, platform: NodeJS.Platform = process.platform): boolean {
	const rel = path.relative(cmpKey(root, platform), cmpKey(child, platform));
	return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Resolves the deepest existing ancestor through symlinks, then re-appends the missing tail. */
function realpathLoose(p: string): string {
	let cur = p;
	const tail: string[] = [];
	for (; ;) {
		try {
			return path.join(fs.realpathSync.native(cur), ...tail.reverse());
		} catch {
			const parent = path.dirname(cur);
			if (parent === cur) {
				return p;
			}
			tail.push(path.basename(cur));
			cur = parent;
		}
	}
}

/**
 * Resolves a path given by the model (relative to the workspace root, or absolute) and guarantees the
 * result stays inside the workspace root, also after following symlinks. Throws {@link AgentToolError}.
 */
export function resolveInWorkspace(root: string, input: unknown, platform: NodeJS.Platform = process.platform): string {
	if (typeof input !== 'string' || !input.trim()) {
		throw new AgentToolError('A file path is required.');
	}
	if (input.includes('\0')) {
		throw new AgentToolError('Invalid path.');
	}
	const absRoot = path.resolve(root);
	const target = path.resolve(absRoot, input.trim());
	if (!isInside(absRoot, target, platform)) {
		throw new AgentToolError(`Access denied: "${input}" is outside the workspace folder.`);
	}
	const realRoot = realpathLoose(absRoot);
	if (!isInside(realRoot, realpathLoose(target), platform)) {
		throw new AgentToolError(`Access denied: "${input}" points outside the workspace folder (symlink).`);
	}
	return target;
}

/** Workspace-relative display path with forward slashes. */
export function displayPath(root: string, abs: string): string {
	return path.relative(root, abs).split(path.sep).join('/') || '.';
}

export function truncate(text: string, max: number): string {
	return text.length <= max ? text : `${text.slice(0, max)}\n… [truncated ${text.length - max} characters]`;
}

/** Applies a single exact-match replacement; the old text must occur exactly once. */
export function applyEdit(content: string, oldText: unknown, newText: unknown): string {
	if (typeof oldText !== 'string' || oldText.length === 0) {
		throw new AgentToolError('old_text must be a non-empty string copied exactly from the file.');
	}
	if (typeof newText !== 'string') {
		throw new AgentToolError('new_text must be a string.');
	}
	const first = content.indexOf(oldText);
	if (first < 0) {
		throw new AgentToolError('old_text was not found in the file. Read the file again and copy the text exactly.');
	}
	if (content.indexOf(oldText, first + 1) >= 0) {
		throw new AgentToolError('old_text occurs more than once. Include more surrounding lines so it is unique.');
	}
	return content.slice(0, first) + newText + content.slice(first + oldText.length);
}

/** Selects lines [start, end] (1-based, inclusive) and prefixes line numbers. */
export function sliceLines(content: string, start?: unknown, end?: unknown, maxLines = 2000): string {
	const lines = content.split(/\r?\n/);
	const s = typeof start === 'number' && start >= 1 ? Math.floor(start) : 1;
	let e = typeof end === 'number' && end >= s ? Math.floor(end) : lines.length;
	e = Math.min(e, lines.length, s + maxLines - 1);
	const out: string[] = [];
	for (let i = s; i <= e; i++) {
		out.push(`${i}: ${lines[i - 1]}`);
	}
	const more = e < lines.length ? `\n… (${lines.length - e} more lines; use start_line/end_line)` : '';
	return out.join('\n') + more;
}

/** Directories never listed or searched. */
export const SKIP_DIRS = new Set(['.git', 'node_modules', '.hg', '.svn', 'out', 'dist', '.next', '__pycache__', '.venv']);

/** Simple glob (`*`, `**`, `?`) to RegExp, matched against workspace-relative forward-slash paths. */
export function globToRegExp(glob: string): RegExp {
	let re = '';
	for (let i = 0; i < glob.length; i++) {
		const c = glob[i];
		if (c === '*') {
			if (glob[i + 1] === '*') {
				re += '.*';
				i++;
				if (glob[i + 1] === '/') {
					i++;
					re += '(?:/)?';
				}
			} else {
				re += '[^/]*';
			}
		} else if (c === '?') {
			re += '[^/]';
		} else {
			re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
		}
	}
	return new RegExp(`^${re}$`, 'i');
}

export type ApprovalKind = 'read' | 'write' | 'command';
export type ApprovalDecision = 'once' | 'session' | 'deny';

/**
 * Per-action approval with "allow once / always this session / deny". Anything other than an explicit
 * 'once' or 'session' answer (undefined, Esc, error) denies. 'session' approvals are remembered per kind
 * for the lifetime of this gate (one editor window session).
 */
export class ApprovalGate {
	private readonly sessionAllowed = new Set<ApprovalKind>();
	constructor(private readonly ask: (kind: ApprovalKind, title: string, detail: string) => Promise<ApprovalDecision | undefined>) { }

	isAlwaysAllowed(kind: ApprovalKind): boolean {
		return this.sessionAllowed.has(kind);
	}

	reset(): void {
		this.sessionAllowed.clear();
	}

	async approve(kind: ApprovalKind, title: string, detail: string, isCancelled: () => boolean = () => false): Promise<boolean> {
		if (isCancelled()) {
			return false;
		}
		if (this.sessionAllowed.has(kind)) {
			return true;
		}
		let decision: ApprovalDecision | undefined;
		try {
			decision = await this.ask(kind, title, detail);
		} catch {
			decision = undefined;
		}
		if (isCancelled()) {
			return false;
		}
		if (decision === 'session') {
			this.sessionAllowed.add(kind);
			return true;
		}
		return decision === 'once';
	}
}

export const AGENT_SYSTEM_PROMPT = [
	'You are the AI assistant inside Axiora Code, a code editor built on Code-OSS.',
	'You are running in Agent mode and you DO have tools to work directly in the user\'s open workspace folder: list_files and search_text (find files and text), read_file (read a file), write_file (create or overwrite a file), edit_file (replace exact text in a file), and run_command (run a shell command in the workspace folder).',
	'Use these tools whenever the task involves the user\'s code; never claim you cannot read or change workspace files.',
	'Each action is shown to the user, who can allow it once, allow that kind of action for the rest of the session, or deny it.',
	'Paths are relative to the workspace folder; you cannot access anything outside it.',
	'Read files before editing them. Prefer edit_file for small changes. If the user declines an action, do not retry it; explain and continue or ask.',
	'Keep the user informed briefly about what you are doing.',
].join(' ');
