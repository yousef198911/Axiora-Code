/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// On-demand download of the official GitHub Copilot CLI runtime (no `vscode` import, unit testable).
// The runtime is NOT shipped with Axiora Code. It is fetched automatically in the background on first use, directly from the
// official npm registry package published by GitHub (@github/copilot-<platform>), verified against the
// registry's sha512 `dist.integrity`, extracted unmodified and cached per platform + pinned version.

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';

export const REGISTRY = 'https://registry.npmjs.org';
/** Official GitHub Releases of the Copilot CLI, used only when the npm registry cannot be reached. */
export const RELEASES_BASE = 'https://github.com/github/copilot-cli/releases/download';
/** Hosts GitHub Releases downloads may be served from (after redirects). */
const RELEASE_HOSTS = new Set(['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com']);

/**
 * SHA-256 of the official standalone release assets, pinned per version. The downloaded asset must match
 * both this table (when the version is listed) and the release's own SHA256SUMS.txt.
 */
export const PINNED_RELEASE_SHA256: Readonly<Record<string, Readonly<Record<string, string>>>> = {
	'1.0.95': {
		'linux-x64': 'c91a8874f3b2bdc905c2452f9d9fc923013924feb431e256eb769ff792719d7f',
		'linux-arm64': '4cae94d3abd15699d6a479103a9a39fb3c1dcd85a6ce191882f1902340f10f44',
		'darwin-x64': '4fbe697463e028bf9927722a0bdc26dee4494ce60ce3a83bdb8689313566794b',
		'darwin-arm64': 'de8fe8f8451247f03e0d5dfd0e0f8bafb1b38649e33e79997dc1ee76ec66df8f',
		'win32-x64': 'f25057289dadcb84230c218ccbe6a02cfff569bab0e9d290c7f50b962b58f38c',
		'win32-arm64': 'f027577f2bd9185ef6e60c0b0663051ceb45223a75f5541062f5d10245ae4c61',
	},
};

export function releaseAssetName(plat: string): string {
	return plat.startsWith('win32') ? `copilot-${plat}.zip` : `copilot-${plat}.tar.gz`;
}

/** Parses a `sha256  filename` list (SHA256SUMS.txt). */
export function parseSha256Sums(text: string): Map<string, string> {
	const out = new Map<string, string>();
	for (const line of text.split(/\r?\n/)) {
		const m = /^([0-9a-f]{64})\s+\*?(\S+)$/i.exec(line.trim());
		if (m) {
			out.set(m[2], m[1].toLowerCase());
		}
	}
	return out;
}

/** Extracts a zip archive (stored or deflated entries only) into `dest`, with the same path safety as tar. */
export function extractZip(zip: Uint8Array, dest: string): void {
	const b = Buffer.from(zip.buffer, zip.byteOffset, zip.byteLength);
	let eocd = -1;
	for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
		if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
	}
	if (eocd < 0) {
		throw new RuntimeError('integrity', 'Invalid zip archive');
	}
	const count = b.readUInt16LE(eocd + 10);
	let off = b.readUInt32LE(eocd + 16);
	for (let n = 0; n < count; n++) {
		if (b.readUInt32LE(off) !== 0x02014b50) {
			throw new RuntimeError('integrity', 'Invalid zip central directory');
		}
		const method = b.readUInt16LE(off + 10);
		const csize = b.readUInt32LE(off + 20);
		const nameLen = b.readUInt16LE(off + 28);
		const extraLen = b.readUInt16LE(off + 30);
		const commentLen = b.readUInt16LE(off + 32);
		const extAttr = b.readUInt32LE(off + 38);
		const local = b.readUInt32LE(off + 42);
		const name = b.subarray(off + 46, off + 46 + nameLen).toString('utf8');
		off += 46 + nameLen + extraLen + commentLen;
		if (((extAttr >>> 16) & 0o170000) === 0o120000) {
			throw new RuntimeError('unsafe', `Links are not allowed in runtime archive: ${name}`);
		}
		const target = safeJoin(dest, name);
		if (name.endsWith('/')) {
			fs.mkdirSync(target, { recursive: true });
			continue;
		}
		const lStart = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28);
		const raw = b.subarray(lStart, lStart + csize);
		const data = method === 0 ? raw : method === 8 ? zlib.inflateRawSync(raw) : undefined;
		if (!data) {
			throw new RuntimeError('integrity', `Unsupported zip compression method ${method}`);
		}
		fs.mkdirSync(path.dirname(target), { recursive: true });
		fs.writeFileSync(target, data);
	}
}

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

/** Approximate download size in MB (documentation / logs). */
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
	/** GitHub Releases base URL for the fallback (tests only). */
	readonly releasesBase?: string;
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

/**
 * Downloads, verifies and installs the official runtime; returns the executable path.
 * Source order: the official npm package (sha512 `dist.integrity`), then — only if npm is unreachable or
 * returns an HTTP error — the official GitHub Releases asset (pinned SHA-256 + the release's SHA256SUMS.txt).
 */
export async function downloadRuntime(o: DownloadOptions): Promise<string> {
	const existing = findVerifiedRuntime(o.cacheRoot, o.plat, o.version);
	if (existing) {
		return existing;
	}
	try {
		return await downloadFromNpm(o);
	} catch (e) {
		if (e instanceof RuntimeError && (e.kind === 'offline' || e.kind === 'http')) {
			try {
				return await downloadFromReleases(o);
			} catch (e2) {
				// Report the fallback failure only if it is more specific than "also unreachable".
				throw e2 instanceof RuntimeError && e2.kind !== 'offline' && e2.kind !== 'http' ? e2 : e;
			}
		}
		throw e;
	}
}

async function readBody(res: Response, o: DownloadOptions): Promise<Buffer> {
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
			o.onProgress?.(b.length, total);
		}
	} catch (e) {
		if (o.signal?.aborted) {
			throw new RuntimeError('cancelled', 'Download cancelled');
		}
		throw new RuntimeError('offline', `Download interrupted: ${(e as Error)?.message ?? e}`);
	}
	return Buffer.concat(chunks);
}

function install(o: DownloadOptions, extract: (tmp: string) => void, verifiedTag: string): string {
	const dir = runtimeDir(o.cacheRoot, o.plat, o.version);
	const tmp = `${dir}.tmp-${process.pid}-${Date.now()}`;
	fs.mkdirSync(o.cacheRoot, { recursive: true });
	try {
		extract(tmp);
		const exe = path.join(tmp, executableName(o.plat));
		if (!fs.existsSync(exe)) {
			throw new RuntimeError('integrity', 'Runtime executable missing from official package');
		}
		if (!o.plat.startsWith('win32')) {
			fs.chmodSync(exe, 0o755);
		}
		fs.writeFileSync(path.join(tmp, '.verified'), verifiedTag);
		fs.rmSync(dir, { recursive: true, force: true });
		fs.renameSync(tmp, dir);
	} catch (e) {
		fs.rmSync(tmp, { recursive: true, force: true });
		throw e;
	}
	return path.join(dir, executableName(o.plat));
}

function assertReleaseHost(res: Response, requested: string): void {
	const final = new URL(res.url || requested);
	const official = new URL(requested).host === 'github.com';
	if (final.protocol !== 'https:' || (official && !RELEASE_HOSTS.has(final.host))) {
		throw new RuntimeError('unsafe', 'Runtime release asset is not hosted on GitHub');
	}
}

async function downloadFromReleases(o: DownloadOptions): Promise<string> {
	const fetchImpl = o.fetchImpl ?? fetch;
	const base = `${o.releasesBase ?? RELEASES_BASE}/v${o.version}`;
	const asset = releaseAssetName(o.plat);
	const sumsRes = await get(fetchImpl, `${base}/SHA256SUMS.txt`, o.signal);
	assertReleaseHost(sumsRes, `${base}/SHA256SUMS.txt`);
	const listed = parseSha256Sums(await sumsRes.text()).get(asset);
	const pinned = PINNED_RELEASE_SHA256[o.version]?.[o.plat];
	if (!listed || (pinned && listed !== pinned)) {
		throw new RuntimeError('integrity', 'INTEGRITY_MISMATCH: release checksum list does not match the pinned checksum');
	}
	const res = await get(fetchImpl, `${base}/${asset}`, o.signal);
	assertReleaseHost(res, `${base}/${asset}`);
	const buf = await readBody(res, o);
	const got = crypto.createHash('sha256').update(buf).digest('hex');
	if (got !== listed) {
		throw new RuntimeError('integrity', 'INTEGRITY_MISMATCH: downloaded runtime does not match the official checksum');
	}
	return install(o, tmp => asset.endsWith('.zip') ? extractZip(buf, tmp) : extractTgz(buf, tmp), `sha256-${got} (GitHub Releases)`);
}

async function downloadFromNpm(o: DownloadOptions): Promise<string> {
	const fetchImpl = o.fetchImpl ?? fetch;
	const registry = o.registry ?? REGISTRY;
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
	const buf = await readBody(res, o);
	verifyIntegrity(buf, meta.dist.integrity);
	return install(o, tmp => extractTgz(buf, tmp), meta.dist.integrity);
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
