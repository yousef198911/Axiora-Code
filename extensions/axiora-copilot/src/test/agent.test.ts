/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AGENT_SYSTEM_PROMPT, AgentToolError, ApprovalDecision, ApprovalGate, applyEdit, globToRegExp, isInside, resolveInWorkspace, sliceLines } from '../agentCore';
import { AgentHost, AgentToolDef, createAgentTools } from '../agentTools';

suite('axiora-copilot agent', () => {
	let tmp: string;
	let root: string;
	let outside: string;
	let confirms: { kind: string; title: string; detail: string }[];
	let answer: boolean;

	setup(() => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'axiora-agent-'));
		root = path.join(tmp, 'ws');
		outside = path.join(tmp, 'secret');
		fs.mkdirSync(path.join(root, 'src'), { recursive: true });
		fs.mkdirSync(path.join(root, 'node_modules', 'x'), { recursive: true });
		fs.mkdirSync(outside);
		fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'const a = 1;\nconst b = 2;\n');
		fs.writeFileSync(path.join(root, 'node_modules', 'x', 'i.js'), 'const a = 1;');
		fs.writeFileSync(path.join(outside, 'key.txt'), 'TOPSECRET');
		confirms = [];
		answer = true;
	});
	teardown(() => fs.rmSync(tmp, { recursive: true, force: true }));

	function tools(extra: Partial<AgentHost> = {}): Map<string, AgentToolDef> {
		const host: AgentHost = {
			root,
			confirm: async (kind, title, detail) => { confirms.push({ kind, title, detail }); return answer; },
			report: () => { },
			isCancelled: () => false,
			...extra,
		};
		return new Map(createAgentTools(host).map(t => [t.name, t]));
	}

	test('resolveInWorkspace confines paths to the workspace', () => {
		assert.strictEqual(resolveInWorkspace(root, 'src/a.ts'), path.join(root, 'src', 'a.ts'));
		assert.strictEqual(resolveInWorkspace(root, path.join(root, 'new.txt')), path.join(root, 'new.txt'));
		assert.throws(() => resolveInWorkspace(root, '../secret/key.txt'), AgentToolError);
		assert.throws(() => resolveInWorkspace(root, path.join(outside, 'key.txt')), AgentToolError);
		assert.throws(() => resolveInWorkspace(root, ''), AgentToolError);
		assert.throws(() => resolveInWorkspace(root, 42), AgentToolError);
		assert.ok(!isInside('/a/ws', '/a/ws2/x', 'linux'));
		assert.ok(isInside('C:\\Ws', 'c:\\ws\\x', 'win32') || process.platform !== 'win32');
	});

	test('resolveInWorkspace rejects symlinks that escape', function () {
		try {
			fs.symlinkSync(outside, path.join(root, 'link'), 'dir');
		} catch {
			this.skip();
		}
		assert.throws(() => resolveInWorkspace(root, 'link/key.txt'), /symlink/);
		assert.throws(() => resolveInWorkspace(root, 'link/new.txt'), /symlink/);
	});

	test('applyEdit requires exactly one match', () => {
		assert.strictEqual(applyEdit('a b c', 'b', 'X'), 'a X c');
		assert.throws(() => applyEdit('a b b', 'b', 'X'), /more than once/);
		assert.throws(() => applyEdit('a', 'z', 'X'), /not found/);
		assert.throws(() => applyEdit('a', '', 'X'), AgentToolError);
	});

	test('sliceLines and globToRegExp', () => {
		assert.strictEqual(sliceLines('x\ny\nz', 2, 2), '2: y\n… (1 more lines; use start_line/end_line)');
		assert.ok(globToRegExp('**/*.ts').test('src/a.ts'));
		assert.ok(globToRegExp('**/*.ts').test('a.ts'));
		assert.ok(!globToRegExp('*.ts').test('src/a.ts'));
	});

	test('read tools work after approval and skip node_modules', async () => {
		const t = tools();
		const read = await t.get('read_file')!.handler({ path: 'src/a.ts' });
		assert.strictEqual(read.resultType, 'success');
		assert.match(read.textResultForLlm, /1: const a = 1;/);
		const list = await t.get('list_files')!.handler({});
		assert.match(list.textResultForLlm, /src\/a\.ts/);
		assert.doesNotMatch(list.textResultForLlm, /node_modules/);
		const search = await t.get('search_text')!.handler({ query: 'CONST B' });
		assert.strictEqual(search.textResultForLlm, 'src/a.ts:2: const b = 2;');
		assert.deepStrictEqual(confirms.map(c => c.kind), ['read', 'read', 'read']);
	});

	test('denied reads return nothing', async () => {
		answer = false;
		const t = tools();
		for (const [name, args] of [['read_file', { path: 'src/a.ts' }], ['list_files', {}], ['search_text', { query: 'const' }]] as const) {
			const r = await t.get(name)!.handler(args);
			assert.strictEqual(r.resultType, 'denied', name);
			assert.doesNotMatch(r.textResultForLlm, /const a|a\.ts:/, name);
		}
	});

	test('ApprovalGate: once asks every time, session remembers per kind, deny/undefined/throw deny', async () => {
		const answers: (ApprovalDecision | undefined | Error)[] = [];
		const asked: string[] = [];
		const gate = new ApprovalGate(async kind => {
			asked.push(kind);
			const a = answers.shift();
			if (a instanceof Error) {
				throw a;
			}
			return a;
		});
		answers.push('once', 'once');
		assert.strictEqual(await gate.approve('read', 't', 'd'), true);
		assert.strictEqual(await gate.approve('read', 't', 'd'), true);
		assert.strictEqual(asked.length, 2);
		answers.push('deny', undefined, new Error('x'));
		assert.strictEqual(await gate.approve('write', 't', 'd'), false);
		assert.strictEqual(await gate.approve('write', 't', 'd'), false);
		assert.strictEqual(await gate.approve('write', 't', 'd'), false);
		answers.push('session');
		assert.strictEqual(await gate.approve('command', 't', 'd'), true);
		const before = asked.length;
		assert.strictEqual(await gate.approve('command', 't', 'd'), true);
		assert.strictEqual(asked.length, before, 'session approval must not ask again');
		assert.ok(gate.isAlwaysAllowed('command') && !gate.isAlwaysAllowed('write'));
		answers.push('deny');
		assert.strictEqual(await gate.approve('write', 't', 'd'), false, 'session for command must not cover write');
		assert.strictEqual(await gate.approve('command', 't', 'd', () => true), false, 'cancelled always denies');
		gate.reset();
		answers.push('deny');
		assert.strictEqual(await gate.approve('command', 't', 'd'), false);
	});

	test('tools wired to ApprovalGate: "always this session" stops prompting for that kind only', async () => {
		const asked: string[] = [];
		const queue: ApprovalDecision[] = ['session', 'deny'];
		const gate = new ApprovalGate(async kind => { asked.push(kind); return queue.shift(); });
		const t = new Map(createAgentTools({ root, confirm: (k, ti, d) => gate.approve(k, ti, d), report: () => { }, isCancelled: () => false }).map(x => [x.name, x]));
		assert.strictEqual((await t.get('read_file')!.handler({ path: 'src/a.ts' })).resultType, 'success');
		assert.strictEqual((await t.get('search_text')!.handler({ query: 'a' })).resultType, 'success');
		assert.strictEqual((await t.get('list_files')!.handler({})).resultType, 'success');
		assert.strictEqual((await t.get('write_file')!.handler({ path: 'x.txt', content: 'x' })).resultType, 'denied');
		assert.deepStrictEqual(asked, ['read', 'write']);
		assert.ok(!fs.existsSync(path.join(root, 'x.txt')));
	});

	test('system prompt names Axiora Code and every tool', () => {
		assert.match(AGENT_SYSTEM_PROMPT, /Axiora Code/);
		for (const name of createAgentTools({ root, confirm: async () => false, report: () => { }, isCancelled: () => false }).map(x => x.name)) {
			assert.ok(AGENT_SYSTEM_PROMPT.includes(name), name);
		}
	});

	test('reading outside the workspace fails', async () => {
		const r = await tools().get('read_file')!.handler({ path: '../secret/key.txt' });
		assert.strictEqual(r.resultType, 'failure');
		assert.doesNotMatch(r.textResultForLlm, /TOPSECRET/);
	});

	test('write_file and edit_file need approval', async () => {
		const t = tools();
		answer = false;
		const d = await t.get('write_file')!.handler({ path: 'new.txt', content: 'hi' });
		assert.strictEqual(d.resultType, 'denied');
		assert.ok(!fs.existsSync(path.join(root, 'new.txt')));
		const de = await t.get('edit_file')!.handler({ path: 'src/a.ts', old_text: 'b = 2', new_text: 'b = 3' });
		assert.strictEqual(de.resultType, 'denied');
		assert.match(fs.readFileSync(path.join(root, 'src', 'a.ts'), 'utf8'), /b = 2/);

		answer = true;
		assert.strictEqual((await t.get('write_file')!.handler({ path: 'dir/new.txt', content: 'hi' })).resultType, 'success');
		assert.strictEqual(fs.readFileSync(path.join(root, 'dir', 'new.txt'), 'utf8'), 'hi');
		assert.strictEqual((await t.get('edit_file')!.handler({ path: 'src/a.ts', old_text: 'b = 2', new_text: 'b = 3' })).resultType, 'success');
		assert.match(fs.readFileSync(path.join(root, 'src', 'a.ts'), 'utf8'), /b = 3/);
		assert.deepStrictEqual(confirms.map(c => c.kind), ['write', 'write', 'write', 'write']);
	});

	test('reading/writing outside the workspace is refused before asking', async () => {
		const r = await tools().get('write_file')!.handler({ path: path.join(outside, 'x.txt'), content: 'x' });
		assert.strictEqual(r.resultType, 'failure');
		assert.strictEqual((await tools().get('read_file')!.handler({ path: path.join(outside, 'key.txt') })).resultType, 'failure');
		assert.strictEqual(confirms.length, 0);
		assert.ok(!fs.existsSync(path.join(outside, 'x.txt')));
	});

	test('run_command needs approval and runs in the workspace', async () => {
		const t = tools();
		answer = false;
		const marker = path.join(root, 'ran.txt');
		const d = await t.get('run_command')!.handler({ command: `node -e "require('fs').writeFileSync('ran.txt','1')"` });
		assert.strictEqual(d.resultType, 'denied');
		assert.ok(!fs.existsSync(marker));
		answer = true;
		const r = await t.get('run_command')!.handler({ command: `node -e "require('fs').writeFileSync('ran.txt','1');console.log(process.cwd())"` });
		assert.strictEqual(r.resultType, 'success');
		assert.match(r.textResultForLlm, /Exit code: 0/);
		assert.ok(fs.existsSync(marker));
		assert.strictEqual(confirms[0].kind, 'command');
		assert.match(confirms[0].detail, /writeFileSync/);
	});

	test('run_command times out', async () => {
		answer = true;
		const r = await tools({ commandTimeoutMs: 500 }).get('run_command')!.handler({ command: `node -e "setTimeout(()=>{},10000)"` });
		assert.strictEqual(r.resultType, 'timeout');
	});

	test('untrusted workspace offers read-only tools', () => {
		assert.deepStrictEqual([...tools({ restrictToReadOnly: true }).keys()], ['list_files', 'read_file', 'search_text']);
	});
});
