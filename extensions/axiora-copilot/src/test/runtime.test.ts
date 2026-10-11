/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';
import { approxDownloadMb, downloadRuntime, extractTgz, findVerifiedRuntime, platformId, removeRuntimes, RuntimeError, safeJoin, verifyIntegrity } from '../runtime';

function tarEntry(name: string, data: Buffer, type = '0'): Buffer {
	const h = Buffer.alloc(512);
	h.write(name, 0, 100);
	h.write('0000755\0', 100);
	h.write(data.length.toString(8).padStart(11, '0') + '\0', 124);
	h.write(type, 156);
	h.write('        ', 148);
	let sum = 0;
	for (const b of h) { sum += b; }
	h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
	return Buffer.concat([h, data, Buffer.alloc((512 - data.length % 512) % 512)]);
}
function tgz(entries: Buffer[]): Buffer {
	return zlib.gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)]));
}
const integrityOf = (b: Buffer) => 'sha512-' + crypto.createHash('sha512').update(b).digest('base64');

function fakeRegistry(pkgTgz: Buffer, integrity: string, opts: { tarballHost?: string } = {}): typeof fetch {
	return (async (url: string | URL) => {
		const u = String(url);
		if (u.endsWith('/1.2.3')) {
			return new Response(JSON.stringify({ name: '@github/copilot-linux-x64', version: '1.2.3', dist: { integrity, tarball: `https://${opts.tarballHost ?? 'registry.npmjs.org'}/x.tgz` } }));
		}
		return new Response(new Uint8Array(pkgTgz), { headers: { 'content-length': String(pkgTgz.length) } });
	}) as unknown as typeof fetch;
}

suite('axiora-copilot runtime downloader', () => {
	let root: string;
	setup(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'axrt-')); });
	teardown(() => { fs.rmSync(root, { recursive: true, force: true }); });

	test('platform ids and sizes', () => {
		assert.strictEqual(platformId('linux', 'x64'), 'linux-x64');
		assert.strictEqual(platformId('win32', 'x64'), 'win32-x64');
		assert.strictEqual(platformId('linux', 'ia32'), undefined);
		assert.strictEqual(approxDownloadMb('win32-x64'), 100);
		assert.strictEqual(approxDownloadMb('linux-x64'), 115);
	});

	test('integrity: accepts match, rejects tamper and non-sha512', () => {
		const b = Buffer.from('official');
		verifyIntegrity(b, integrityOf(b));
		const t = Buffer.from('officiaL');
		assert.throws(() => verifyIntegrity(t, integrityOf(b)), (e: RuntimeError) => e.kind === 'integrity');
		assert.throws(() => verifyIntegrity(b, 'sha1-abc'), (e: RuntimeError) => e.kind === 'integrity');
	});

	test('path safety', () => {
		assert.ok(safeJoin(root, 'package/copilot').startsWith(root));
		for (const bad of ['package/../evil', '../evil', '/etc/passwd', 'C:/x', 'package/a/../../b']) {
			assert.throws(() => safeJoin(root, bad), (e: RuntimeError) => e.kind === 'unsafe', bad);
		}
		assert.throws(() => extractTgz(tgz([tarEntry('package/../../pwn', Buffer.from('x'))]), path.join(root, 'x')), (e: RuntimeError) => e.kind === 'unsafe');
		assert.throws(() => extractTgz(tgz([tarEntry('package/link', Buffer.alloc(0), '2')]), path.join(root, 'x')), (e: RuntimeError) => e.kind === 'unsafe');
		assert.ok(!fs.existsSync(path.join(path.dirname(root), 'pwn')));
	});

	test('download: verifies, installs atomically, caches, removes', async () => {
		const pkg = tgz([tarEntry('package/copilot', Buffer.from('#!/bin/sh\necho hi\n')), tarEntry('package/LICENSE.md', Buffer.from('L'))]);
		let progressed = 0;
		const exe = await downloadRuntime({ cacheRoot: root, plat: 'linux-x64', version: '1.2.3', fetchImpl: fakeRegistry(pkg, integrityOf(pkg)), onProgress: r => { progressed = r; } });
		assert.strictEqual(progressed, pkg.length);
		assert.strictEqual(findVerifiedRuntime(root, 'linux-x64', '1.2.3'), exe);
		assert.strictEqual(fs.readFileSync(path.join(path.dirname(exe), 'LICENSE.md'), 'utf8'), 'L');
		assert.deepStrictEqual(fs.readdirSync(root), ['copilot-linux-x64-1.2.3']);
		assert.strictEqual(removeRuntimes(root), true);
		assert.strictEqual(findVerifiedRuntime(root, 'linux-x64', '1.2.3'), undefined);
		assert.strictEqual(removeRuntimes(root), false);
	});

	test('download: tampered tarball is rejected and nothing is installed', async () => {
		const pkg = tgz([tarEntry('package/copilot', Buffer.from('a'))]);
		const tampered = Buffer.from(pkg); tampered[tampered.length - 1] ^= 1;
		await assert.rejects(downloadRuntime({ cacheRoot: root, plat: 'linux-x64', version: '1.2.3', fetchImpl: fakeRegistry(tampered, integrityOf(pkg)) }), (e: RuntimeError) => e.kind === 'integrity');
		assert.strictEqual(findVerifiedRuntime(root, 'linux-x64', '1.2.3'), undefined);
		assert.deepStrictEqual(fs.readdirSync(root), []);
	});

	test('download: tarball from a foreign host is refused', async () => {
		const pkg = tgz([tarEntry('package/copilot', Buffer.from('a'))]);
		await assert.rejects(downloadRuntime({ cacheRoot: root, plat: 'linux-x64', version: '1.2.3', fetchImpl: fakeRegistry(pkg, integrityOf(pkg), { tarballHost: 'evil.example' }) }), (e: RuntimeError) => e.kind === 'unsafe');
	});

	test('download: offline and cancelled errors are classified', async () => {
		const offline = (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch;
		await assert.rejects(downloadRuntime({ cacheRoot: root, plat: 'linux-x64', version: '1.2.3', fetchImpl: offline }), (e: RuntimeError) => e.kind === 'offline');
		const ac = new AbortController(); ac.abort();
		const aborting = (async () => { throw new Error('aborted'); }) as unknown as typeof fetch;
		await assert.rejects(downloadRuntime({ cacheRoot: root, plat: 'linux-x64', version: '1.2.3', fetchImpl: aborting, signal: ac.signal }), (e: RuntimeError) => e.kind === 'cancelled');
	});

	test('consent declined: no network call, no files', () => {
		// The extension only calls downloadRuntime after an explicit "Download" choice; without it the
		// cache stays empty and the runtime is reported missing.
		assert.strictEqual(findVerifiedRuntime(root, 'linux-x64', '1.2.3'), undefined);
		assert.throws(() => findVerifiedRuntime(root, 'linux-x64', '../1'));
	});
});
