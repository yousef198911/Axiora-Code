/*---------------------------------------------------------------------------------------------
 *  Official Cursor CLI release resolution.
 *
 *  Cursor does not publish a separate version manifest. The documented install
 *  method is the script at https://cursor.com/install (Windows:
 *  https://cursor.com/install?win32=true). That script names the current
 *  package on https://downloads.cursor.com/lab/<version>/... . These helpers
 *  parse that script and accept only that host, so the downloader never
 *  invents a URL and never follows a script that points somewhere else.
 *--------------------------------------------------------------------------------------------*/

/** Documented install script for macOS, Linux, and WSL. */
export const CURSOR_INSTALL_POSIX_URL = 'https://cursor.com/install';
/** Documented install script for native Windows. */
export const CURSOR_INSTALL_WIN32_URL = 'https://cursor.com/install?win32=true';

const VERSION_RE = /^\d{4}\.\d{2}\.\d{2}-[A-Za-z0-9._-]{1,80}$/;

export interface CursorCliTarget {
	/** Cache folder segment, e.g. `linux-x64` or `windows-arm64`. */
	readonly id: string;
	/** Path segment the official installer uses (`linux`, `darwin`, or `windows`). */
	readonly os: 'linux' | 'darwin' | 'windows';
	readonly arch: 'x64' | 'arm64';
	readonly archive: 'tar.gz' | 'zip';
}

export interface CursorCliRelease {
	readonly version: string;
	readonly downloadUrl: string;
	readonly archive: 'tar.gz' | 'zip';
	readonly target: CursorCliTarget;
}

export function cursorInstallScriptUrl(platform: NodeJS.Platform): string {
	return platform === 'win32' ? CURSOR_INSTALL_WIN32_URL : CURSOR_INSTALL_POSIX_URL;
}

export function cursorCliTarget(platform: NodeJS.Platform, arch: string): CursorCliTarget | undefined {
	const mapped = arch === 'x64' || arch === 'amd64' ? 'x64' : arch === 'arm64' || arch === 'aarch64' ? 'arm64' : undefined;
	if (!mapped) {
		return undefined;
	}
	if (platform === 'win32') {
		return { id: `windows-${mapped}`, os: 'windows', arch: mapped, archive: 'zip' };
	}
	if (platform === 'linux' || platform === 'darwin') {
		return { id: `${platform}-${mapped}`, os: platform, arch: mapped, archive: 'tar.gz' };
	}
	return undefined;
}

/** True only for the package host the official installer prints. */
export function isOfficialCursorDownloadUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		return parsed.protocol === 'https:' && parsed.hostname === 'downloads.cursor.com' && parsed.pathname.startsWith('/lab/');
	} catch {
		return false;
	}
}

/**
 * Reads the version and package URL out of the official install script.
 * POSIX scripts contain `DOWNLOAD_URL="https://downloads.cursor.com/lab/<version>/${OS}/${ARCH}/agent-cli-package.tar.gz"`.
 * The Windows script sets `$downloadUrl` and `$version`, then appends `windows/<arch>/agent-cli-package.zip`.
 */
export function parseCursorInstallScript(script: string, platform: NodeJS.Platform, arch: string): CursorCliRelease {
	const target = cursorCliTarget(platform, arch);
	if (!target) {
		throw new Error(`Cursor CLI has no official package for ${platform}/${arch}.`);
	}
	if (platform === 'win32') {
		const version = /\$version\s*=\s*'([^']+)'/.exec(script)?.[1];
		const prefix = /\$downloadUrl\s*=\s*'(https:\/\/downloads\.cursor\.com\/lab\/[^'\s]+\/)'/.exec(script)?.[1];
		if (!version || !prefix || !VERSION_RE.test(version)) {
			throw new Error('The official Windows Cursor installer did not contain a recognized package URL.');
		}
		const downloadUrl = `${prefix}windows/${target.arch}/agent-cli-package.zip`;
		if (!isOfficialCursorDownloadUrl(downloadUrl)) {
			throw new Error('Refusing a Cursor package URL that is not on downloads.cursor.com.');
		}
		return { version, downloadUrl, archive: 'zip', target };
	}
	const raw = /DOWNLOAD_URL="(https:\/\/downloads\.cursor\.com\/lab\/[^"]+)"/.exec(script)?.[1];
	if (!raw) {
		throw new Error('The official Cursor installer did not contain a DOWNLOAD_URL.');
	}
	const version = /\/lab\/([^/]+)\//.exec(raw)?.[1];
	if (!version || !VERSION_RE.test(version)) {
		throw new Error('The official Cursor installer version was not recognized.');
	}
	const downloadUrl = raw.replaceAll('${OS}', target.os).replaceAll('${ARCH}', target.arch);
	if (!isOfficialCursorDownloadUrl(downloadUrl) || downloadUrl.includes('${')) {
		throw new Error('Refusing a Cursor package URL that is not on downloads.cursor.com.');
	}
	return { version, downloadUrl, archive: 'tar.gz', target };
}

const EXECUTABLE_PREFERENCE = ['cursor-agent', 'cursor-agent.exe', 'cursor-agent.cmd', 'agent.exe', 'agent.cmd', 'agent'];

/** Picks the CLI binary the official package lays down (`cursor-agent`, or `agent` on Windows). */
export function preferredCursorExecutable(paths: readonly string[]): string | undefined {
	for (const name of EXECUTABLE_PREFERENCE) {
		const hit = paths.find(p => p.replace(/\\/g, '/').split('/').pop() === name);
		if (hit) {
			return hit;
		}
	}
	return undefined;
}
