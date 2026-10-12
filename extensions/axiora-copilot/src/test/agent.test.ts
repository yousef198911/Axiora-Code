/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AgentToolError, applyEdit, globToRegExp, isInside, resolveInWorkspace, sliceLines } from '../agentCore';
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

	test('read tools work without approval and skip node_modules', async () => {
		const t = tools();
		const read = await t.get('read_file')!.handler({ path: 'src/a.ts' });
		assert.strictEqual(read.resultType, 'success');
		assert.match(read.textResultForLlm, /1: const a = 1;/);
		const list = await t.get('list_files')!.handler({});
		assert.match(list.textResultForLlm, /src\/a\.ts/);
		assert.doesNotMatch(list.textResultForLlm, /node_modules/);
		const search = await t.get('search_text')!.handler({ query: 'CONST B' });
		assert.strictEqual(search.textResultForLlm, 'src/a.ts:2: const b = 2;');
		assert.strictEqual(confirms.length, 0);
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

	test('writing outside the workspace is refused before asking', async () => {
		const r = await tools().get('write_file')!.handler({ path: path.join(outside, 'x.txt'), content: 'x' });
		assert.strictEqual(r.resultType, 'failure');
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
