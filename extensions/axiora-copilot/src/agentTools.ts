/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Axiora Agent mode tools, handed to the Copilot SDK as custom tools. No `vscode` import: the editor
// integration (approval dialog, progress text, cancellation) is injected through {@link AgentHost} so
// the tools can be unit tested. Every write and every command requires `confirm` to return true.

import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { AgentToolError, applyEdit, displayPath, globToRegExp, resolveInWorkspace, SKIP_DIRS, sliceLines, truncate } from './agentCore';

export interface AgentHost {
	/** Workspace folder; all tools are confined to it. */
	readonly root: string;
	/** Asks the user. Must resolve true only on an explicit approval. */
	confirm(kind: 'write' | 'command', title: string, detail: string): Promise<boolean>;
	/** Short progress line shown in the chat response. */
	report(text: string): void;
	readonly isCancelled: () => boolean;
	/** Writes a file (through the editor so open editors update). Defaults to fs. */
	writeFile?(abs: string, content: string): Promise<void>;
	readonly commandTimeoutMs?: number;
	/** Untrusted workspace: only the read-only tools are offered. */
	readonly restrictToReadOnly?: boolean;
}

export interface ToolResultLike {
	textResultForLlm: string;
	resultType: 'success' | 'failure' | 'rejected' | 'denied' | 'timeout';
	error?: string;
}

export interface AgentToolDef {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
	skipPermission: boolean;
	handler: (args: unknown) => Promise<ToolResultLike>;
}

const MAX_READ_CHARS = 60000;
const MAX_OUTPUT_CHARS = 20000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_LIST = 500;
const MAX_MATCHES = 200;

const ok = (text: string): ToolResultLike => ({ textResultForLlm: text, resultType: 'success' });
const denied = (what: string): ToolResultLike => ({ textResultForLlm: `The user declined: ${what}. Do not retry it.`, resultType: 'denied' });

function obj(args: unknown): Record<string, unknown> {
	return args && typeof args === 'object' ? args as Record<string, unknown> : {};
}

function walk(root: string, start: string, visit: (abs: string, rel: string, isDir: boolean) => boolean | void): void {
	const stack = [start];
	while (stack.length) {
		const dir = stack.pop()!;
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			continue;
		}
		entries.sort((a, b) => a.name.localeCompare(b.name));
		for (const e of entries) {
			if (e.isSymbolicLink()) {
				continue;
			}
			const abs = path.join(dir, e.name);
			const isDir = e.isDirectory();
			if (isDir && SKIP_DIRS.has(e.name)) {
				continue;
			}
			if (visit(abs, displayPath(root, abs), isDir) === false) {
				return;
			}
			if (isDir) {
				stack.push(abs);
			}
		}
	}
}

function readText(abs: string): string {
	const st = fs.statSync(abs);
	if (!st.isFile()) {
		throw new AgentToolError('Not a file.');
	}
	if (st.size > MAX_FILE_BYTES) {
		throw new AgentToolError(`File is too large (${st.size} bytes).`);
	}
	const buf = fs.readFileSync(abs);
	if (buf.subarray(0, 8000).includes(0)) {
		throw new AgentToolError('Binary file; not shown.');
	}
	return buf.toString('utf8');
}

function wrap(fn: (a: Record<string, unknown>) => Promise<ToolResultLike>): (args: unknown) => Promise<ToolResultLike> {
	return async args => {
		try {
			return await fn(obj(args));
		} catch (e) {
			const msg = e instanceof AgentToolError ? e.message : `Error: ${(e as Error)?.message ?? e}`;
			return { textResultForLlm: msg, resultType: 'failure', error: msg };
		}
	};
}

export function createAgentTools(host: AgentHost): AgentToolDef[] {
	const root = path.resolve(host.root);
	const rel = (abs: string) => displayPath(root, abs);
	const write = async (abs: string, content: string) => {
		if (host.writeFile) {
			await host.writeFile(abs, content);
		} else {
			fs.mkdirSync(path.dirname(abs), { recursive: true });
			fs.writeFileSync(abs, content, 'utf8');
		}
	};

	const tools: AgentToolDef[] = [
		{
			name: 'list_files',
			description: 'List files and folders in the workspace (recursive). Optional `path` (folder, relative to the workspace) and `pattern` (glob such as **/*.ts).',
			parameters: { type: 'object', properties: { path: { type: 'string' }, pattern: { type: 'string' } } },
			skipPermission: true,
			handler: wrap(async a => {
				const dir = resolveInWorkspace(root, typeof a.path === 'string' && a.path ? a.path : '.');
				const re = typeof a.pattern === 'string' && a.pattern ? globToRegExp(a.pattern) : undefined;
				const out: string[] = [];
				walk(root, dir, (_abs, r, isDir) => {
					if (!re || re.test(r)) {
						out.push(isDir ? `${r}/` : r);
					}
					return out.length < MAX_LIST;
				});
				host.report(`📂 ${rel(dir)}`);
				return ok(out.length ? out.join('\n') + (out.length >= MAX_LIST ? '\n… (limit reached)' : '') : '(no matches)');
			}),
		},
		{
			name: 'read_file',
			description: 'Read a text file in the workspace. Returns numbered lines. Optional start_line/end_line (1-based).',
			parameters: { type: 'object', properties: { path: { type: 'string' }, start_line: { type: 'number' }, end_line: { type: 'number' } }, required: ['path'] },
			skipPermission: true,
			handler: wrap(async a => {
				const abs = resolveInWorkspace(root, a.path);
				const text = readText(abs);
				host.report(`📄 ${rel(abs)}`);
				return ok(truncate(sliceLines(text, a.start_line, a.end_line), MAX_READ_CHARS));
			}),
		},
		{
			name: 'search_text',
			description: 'Search text files in the workspace for a string (case-insensitive) or a regular expression (is_regex true). Optional `pattern` glob to limit files.',
			parameters: { type: 'object', properties: { query: { type: 'string' }, is_regex: { type: 'boolean' }, pattern: { type: 'string' } }, required: ['query'] },
			skipPermission: true,
			handler: wrap(async a => {
				if (typeof a.query !== 'string' || !a.query) {
					throw new AgentToolError('query is required.');
				}
				let re: RegExp;
				try {
					re = a.is_regex ? new RegExp(a.query, 'i') : new RegExp(a.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
				} catch (e) {
					throw new AgentToolError(`Invalid regular expression: ${(e as Error).message}`);
				}
				const glob = typeof a.pattern === 'string' && a.pattern ? globToRegExp(a.pattern) : undefined;
				const out: string[] = [];
				walk(root, root, (abs, r, isDir) => {
					if (isDir || (glob && !glob.test(r)) || host.isCancelled()) {
						return !host.isCancelled();
					}
					let text: string;
					try {
						text = readText(abs);
					} catch {
						return;
					}
					const lines = text.split(/\r?\n/);
					for (let i = 0; i < lines.length && out.length < MAX_MATCHES; i++) {
						if (re.test(lines[i])) {
							out.push(`${r}:${i + 1}: ${truncate(lines[i].trim(), 300)}`);
						}
					}
					return out.length < MAX_MATCHES;
				});
				host.report(`🔎 ${a.query}`);
				return ok(out.length ? out.join('\n') : '(no matches)');
			}),
		},
		{
			name: 'write_file',
			description: 'Create a new file or overwrite a file in the workspace with the full given content. The user must approve.',
			parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
			skipPermission: true,
			handler: wrap(async a => {
				const abs = resolveInWorkspace(root, a.path);
				if (typeof a.content !== 'string') {
					throw new AgentToolError('content must be a string.');
				}
				const exists = fs.existsSync(abs);
				if (exists && !fs.statSync(abs).isFile()) {
					throw new AgentToolError('Path is a folder.');
				}
				const title = exists ? `Overwrite ${rel(abs)}? / استبدال الملف؟` : `Create ${rel(abs)}? / إنشاء ملف جديد؟`;
				if (!await host.confirm('write', title, truncate(a.content, 1500))) {
					host.report(`⛔ ${rel(abs)}`);
					return denied(`write ${rel(abs)}`);
				}
				await write(abs, a.content);
				host.report(`✏️ ${rel(abs)}`);
				return ok(`${exists ? 'Overwrote' : 'Created'} ${rel(abs)} (${a.content.length} characters).`);
			}),
		},
		{
			name: 'edit_file',
			description: 'Replace one exact occurrence of old_text with new_text in a workspace file. old_text must match exactly once. The user must approve.',
			parameters: { type: 'object', properties: { path: { type: 'string' }, old_text: { type: 'string' }, new_text: { type: 'string' } }, required: ['path', 'old_text', 'new_text'] },
			skipPermission: true,
			handler: wrap(async a => {
				const abs = resolveInWorkspace(root, a.path);
				const before = readText(abs);
				const after = applyEdit(before, a.old_text, a.new_text);
				const detail = `- ${truncate(String(a.old_text), 700)}\n+ ${truncate(String(a.new_text), 700)}`;
				if (!await host.confirm('write', `Edit ${rel(abs)}? / تعديل الملف؟`, detail)) {
					host.report(`⛔ ${rel(abs)}`);
					return denied(`edit ${rel(abs)}`);
				}
				await write(abs, after);
				host.report(`✏️ ${rel(abs)}`);
				return ok(`Edited ${rel(abs)}.`);
			}),
		},
		{
			name: 'run_command',
			description: 'Run a shell command in the workspace folder (for example tests or a build) and return its output. The user must approve every command. Times out after 2 minutes.',
			parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
			skipPermission: true,
			handler: wrap(async a => {
				if (typeof a.command !== 'string' || !a.command.trim()) {
					throw new AgentToolError('command is required.');
				}
				const command = a.command.trim();
				if (!await host.confirm('command', 'Run this command? / تشغيل هذا الأمر؟', `${command}\n\n📁 ${root}`)) {
					host.report(`⛔ \`${truncate(command, 80)}\``);
					return denied(`run \`${command}\``);
				}
				host.report(`▶️ \`${truncate(command, 80)}\``);
				const r = await runShell(command, root, host.commandTimeoutMs ?? 120000, host.isCancelled);
				const body = truncate(r.output, MAX_OUTPUT_CHARS) || '(no output)';
				if (r.timedOut) {
					return { textResultForLlm: `Timed out.\n${body}`, resultType: 'timeout' };
				}
				return ok(`Exit code: ${r.code}\n${body}`);
			}),
		},
	];
	return host.restrictToReadOnly ? tools.filter(t => READ_ONLY_TOOLS.has(t.name)) : tools;
}

export const READ_ONLY_TOOLS = new Set(['list_files', 'read_file', 'search_text']);

export function runShell(command: string, cwd: string, timeoutMs: number, isCancelled: () => boolean): Promise<{ code: number | null; output: string; timedOut: boolean }> {
	return new Promise(resolve => {
		const child = cp.spawn(command, { cwd, shell: true, windowsHide: true, env: process.env, detached: process.platform !== 'win32' });
		let output = '';
		let timedOut = false;
		const add = (d: Buffer) => {
			if (output.length < MAX_OUTPUT_CHARS * 2) {
				output += d.toString('utf8');
			}
		};
		child.stdout?.on('data', add);
		child.stderr?.on('data', add);
		const kill = () => {
			try {
				if (process.platform === 'win32' && child.pid) {
					cp.spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
				} else {
					process.kill(-child.pid!, 'SIGKILL'); // whole process group
				}
			} catch { /* ignore */ }
		};
		const timer = setTimeout(() => { timedOut = true; kill(); }, timeoutMs);
		const poll = setInterval(() => { if (isCancelled()) { kill(); } }, 250);
		const done = (code: number | null) => {
			clearTimeout(timer);
			clearInterval(poll);
			resolve({ code, output, timedOut });
		};
		child.on('error', e => { output += String(e.message); done(null); });
		child.on('close', code => done(code));
	});
}
