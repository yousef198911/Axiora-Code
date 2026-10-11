/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// On-demand download of the official GitHub Copilot CLI runtime (no `vscode` import, unit testable).
// The runtime is NOT shipped with Axiora Code. It is fetched, after user consent, directly from the
// official npm registry package published by GitHub (@github/copilot-<platform>), verified against the
// registry's sha512 `dist.integrity`, extracted unmodified and cached per platform + pinned version.

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';

export const REGISTRY = 'https://registry.npmjs.org';
export const CLI_LICENSE_URL = 'https://github.com/github/copilot-cli/blob/main/LICENSE.md';

/** Platforms for which GitHub publishes a native Copilot CLI package. */
const SUPPORTED = new Set(['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64', 'win32-x64', 'win32-arm64']);

export function platformId(platform: string = process.platform, arch: string = process.arch): string | undefined {
	const id = `${platform}-${arch}`;
	return SUPPORTED.has(id) ? id : undefined;
}

export function packageName(plat: string): string {
	return `@github/copilot-${plat}`;
}

/** Approximate download size in MB shown in the consent prompt. */
export function approxDownloadMb(plat: string): number {
	return plat.startsWith('win32') ? 100 : 115;
}

export function runtimeDir(cacheRoot: string, plat: string, version: string): string {
	if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(version)) {
		throw new Error('Invalid pinned runtime version');
	}
	return path.join(cacheRoot, `copilot-${plat}-${version}`);
}

export function executableName(plat: string): string {
	return plat.startsWith('win32') ? 'copilot.exe' : 'copilot';
}

/** Returns the executable path if a verified runtime for this platform/version is cached. */
export function findVerifiedRuntime(cacheRoot: string, plat: string, version: string): string | undefined {
	const dir = runtimeDir(cacheRoot, plat, version);
	const exe = path.join(dir, executableName(plat));
	return fs.existsSync(path.join(dir, '.verified')) && fs.existsSync(exe) ? exe : undefined;
}

export class RuntimeError extends Error {
	constructor(readonly kind: 'offline' | 'integrity' | 'cancelled' | 'unsupported' | 'http' | 'unsafe', msg: string) {
		super(msg);
	}
}

/** Verifies `buf` against an npm `dist.integrity` string (sha512 only). */
export function verifyIntegrity(buf: Uint8Array, integrity: string): void {
	const m = /^sha512-([A-Za-z0-9+/=]+)$/.exec(integrity.trim());
	if (!m) {
		throw new RuntimeError('integrity', 'Unexpected integrity algorithm (sha512 required)');
	}
	const got = crypto.createHash('sha512').update(buf).digest('base64');
	if (got !== m[1]) {
		throw new RuntimeError('integrity', 'INTEGRITY_MISMATCH: downloaded runtime does not match the official checksum');
	}
}

/** Resolves a tar entry name inside `root`; throws on absolute paths or traversal. */
export function safeJoin(root: string, entryName: string): string {
	const rel = entryName.replace(/^package\//, '');
	if (!rel || path.isAbsolute(rel) || /^[A-Za-z]:/.test(rel) || rel.split(/[\\/]/).includes('..')) {
		throw new RuntimeError('unsafe', `Unsafe path in runtime archive: ${entryName}`);
	}
	const base = path.resolve(root);
	const dest = path.resolve(base, rel);
	if (!dest.startsWith(base + path.sep)) {
		throw new RuntimeError('unsafe', `Unsafe path in runtime archive: ${entryName}`);
	}
	return dest;
}

/** Extracts a gzipped npm tarball into `dest`. Only regular files and directories; links are refused. */
export function extractTgz(tgz: Uint8Array, dest: string): void {
	const tar = zlib.gunzipSync(tgz);
	let off = 0;
	let longName: string | undefined;
	const str = (h: Buffer, a: number, b: number) => h.subarray(a, b).toString('utf8').replace(/\0.*$/s, '');
	while (off + 512 <= tar.length) {
		const h = tar.subarray(off, off + 512);
		if (h.every(b => b === 0)) {
			break;
		}
		let name = str(h, 0, 100);
		const prefix = str(h, 345, 500);
		if (prefix) {
			name = `${prefix}/${name}`;
		}
		const size = parseInt(str(h, 124, 136).trim() || '0', 8);
		const type = String.fromCharCode(h[156] || 48);
		const mode = parseInt(str(h, 100, 108).trim() || '644', 8);
		const data = tar.subarray(off + 512, off + 512 + size);
		off += 512 + Math.ceil(size / 512) * 512;
		if (type === 'L') {
			longName = data.toString('utf8').replace(/\0.*$/s, '');
			continue;
		}
		if (longName) {
			name = longName;
			longName = undefined;
		}
		if (type === 'x' || type === 'g') {
			continue;
		}
		if (type === '1' || type === '2') {
			throw new RuntimeError('unsafe', `Links are not allowed in runtime archive: ${name}`);
		}
		const target = safeJoin(dest, name);
		if (type === '5') {
			fs.mkdirSync(target, { recursive: true });
		} else if (type === '0' || type === '\0') {
			fs.mkdirSync(path.dirname(target), { recursive: true });
			fs.writeFileSync(target, data, { mode: mode & 0o755 });
		}
	}
}

export interface DownloadOptions {
	readonly cacheRoot: string;
	readonly plat: string;
	readonly version: string;
	readonly fetchImpl?: typeof fetch;
	readonly registry?: string;
	readonly onProgress?: (received: number, total: number | undefined) => void;
	readonly signal?: AbortSignal;
}

async function get(fetchImpl: typeof fetch, url: string, signal?: AbortSignal): Promise<Response> {
	let res: Response;
	try {
		res = await fetchImpl(url, { signal, headers: { 'User-Agent': 'Axiora-Code' } });
	} catch (e) {
		if (signal?.aborted) {
			throw new RuntimeError('cancelled', 'Download cancelled');
		}
		throw new RuntimeError('offline', `Could not reach ${new URL(url).host}: ${(e as Error)?.message ?? e}`);
	}
	if (!res.ok) {
		throw new RuntimeError('http', `HTTP ${res.status} from ${new URL(url).host}`);
	}
	return res;
}

/** Downloads, verifies and installs the official runtime; returns the executable path. */
export async function downloadRuntime(o: DownloadOptions): Promise<string> {
	const fetchImpl = o.fetchImpl ?? fetch;
	const registry = o.registry ?? REGISTRY;
	const existing = findVerifiedRuntime(o.cacheRoot, o.plat, o.version);
	if (existing) {
		return existing;
	}
	const pkg = packageName(o.plat);
	const meta = await (await get(fetchImpl, `${registry}/${pkg}/${o.version}`, o.signal)).json() as { name?: string; version?: string; dist?: { integrity?: string; tarball?: string } };
	if (meta.name !== pkg || meta.version !== o.version || !meta.dist?.integrity || !meta.dist.tarball) {
		throw new RuntimeError('http', 'Unexpected registry metadata');
	}
	const tarballUrl = new URL(meta.dist.tarball);
	if (tarballUrl.protocol !== 'https:' || tarballUrl.host !== new URL(registry).host) {
		throw new RuntimeError('unsafe', 'Runtime tarball is not hosted on the official registry');
	}
	const res = await get(fetchImpl, tarballUrl.toString(), o.signal);
	const total = Number(res.headers.get('content-length')) || undefined;
	const chunks: Uint8Array[] = [];
	let received = 0;
	try {
		if (res.body) {
			for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
				chunks.push(chunk);
				received += chunk.length;
				o.onProgress?.(received, total);
			}
		} else {
			const b = new Uint8Array(await res.arrayBuffer());
			chunks.push(b);
			received = b.length;
			o.onProgress?.(received, total);
		}
	} catch (e) {
		if (o.signal?.aborted) {
			throw new RuntimeError('cancelled', 'Download cancelled');
		}
		throw new RuntimeError('offline', `Download interrupted: ${(e as Error)?.message ?? e}`);
	}
	const buf = Buffer.concat(chunks);
	verifyIntegrity(buf, meta.dist.integrity);

	const dir = runtimeDir(o.cacheRoot, o.plat, o.version);
	const tmp = `${dir}.tmp-${process.pid}-${Date.now()}`;
	fs.mkdirSync(o.cacheRoot, { recursive: true });
	try {
		extractTgz(buf, tmp);
		const exe = path.join(tmp, executableName(o.plat));
		if (!fs.existsSync(exe)) {
			throw new RuntimeError('integrity', 'Runtime executable missing from official package');
		}
		if (!o.plat.startsWith('win32')) {
			fs.chmodSync(exe, 0o755);
		}
		fs.writeFileSync(path.join(tmp, '.verified'), meta.dist.integrity);
		fs.rmSync(dir, { recursive: true, force: true });
		fs.renameSync(tmp, dir);
	} catch (e) {
		fs.rmSync(tmp, { recursive: true, force: true });
		throw e;
	}
	return path.join(dir, executableName(o.plat));
}

/** Deletes every cached runtime under `cacheRoot`. Returns true if something was removed. */
export function removeRuntimes(cacheRoot: string): boolean {
	if (!fs.existsSync(cacheRoot)) {
		return false;
	}
	const entries = fs.readdirSync(cacheRoot).filter(n => n.startsWith('copilot-'));
	for (const n of entries) {
		fs.rmSync(path.join(cacheRoot, n), { recursive: true, force: true });
	}
	return entries.length > 0;
}
