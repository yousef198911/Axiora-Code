/*---------------------------------------------------------------------------------------------
 *  Cursor CLI as an internal Axiora component.
 *
 *  On startup the official installer script is read (it is the only documented
 *  way to learn the current package):
 *    macOS / Linux / WSL:  https://cursor.com/install
 *    Windows:              https://cursor.com/install?win32=true
 *  The script's package URL on https://downloads.cursor.com is downloaded into
 *  the extension's global storage (the app data folder), the same idea as
 *  agentSdkDownloader's versioned cache and `.complete` sentinel. The script
 *  itself is not executed: running it would install into ~/.local or
 *  %LOCALAPPDATA% and edit the user PATH. That is the documented limitation.
 *
 *  Sign-in uses the official browser flow: `agent login` with NO_OPEN_BROWSER=1
 *  (https://cursor.com/docs/cli/reference/authentication) and opens the printed
 *  URL. No Cursor API key is embedded; the end user's account is the only auth.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { cursorInstallScriptUrl, parseCursorInstallScript, preferredCursorExecutable, type CursorCliRelease } from './cursorCliResolve';
import { log, register } from './util';

interface CurrentInstall { version: string; target: string; executable: string }

let storageRoot: string | undefined;
let inflight: Promise<string> | undefined;
let loginUrlOpened = false;

const enabled = () => vscode.workspace.getConfiguration('axiora.cursor').get<boolean>('enabled', true);

function overridePath(): string {
	return (process.env.AXIORA_CURSOR_CLI || vscode.workspace.getConfiguration('axiora.cursor').get<string>('cliPath', '') || '').trim();
}

function currentFile(): string | undefined {
	return storageRoot && path.join(storageRoot, 'current.json');
}

function readCurrent(): CurrentInstall | undefined {
	const file = currentFile();
	if (!file) { return undefined; }
	try {
		const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as CurrentInstall;
		if (parsed?.version && parsed.executable && fs.existsSync(parsed.executable)) { return parsed; }
	} catch { /* no cache yet */ }
	return undefined;
}

/** Cached `agent` binary, if a previous launch already finished the download. */
export function cursorExecutableNow(): string | undefined {
	const override = overridePath();
	if (override && fs.existsSync(override)) { return override; }
	return readCurrent()?.executable;
}

export function openCursorLoginUrl(url: string): void {
	if (loginUrlOpened || !url.startsWith('https://')) { return; }
	loginUrlOpened = true;
	void vscode.env.openExternal(vscode.Uri.parse(url));
}

function resetLoginUrlGate(): void { loginUrlOpened = false; }

function execFile(cmd: string, args: string[]): Promise<void> {
	return new Promise((resolve, reject) => {
		cp.execFile(cmd, args, { timeout: 10 * 60_000, maxBuffer: 8 * 1024 * 1024 }, (err, _stdout, stderr) => err ? reject(new Error(stderr || err.message)) : resolve());
	});
}

async function downloadFile(url: string, dest: string): Promise<void> {
	const response = await fetch(url);
	if (!response.ok || !response.body) { throw new Error(`HTTP ${response.status} fetching ${url}`); }
	await new Promise<void>((resolve, reject) => {
		const out = fs.createWriteStream(dest);
		const reader = response.body!.getReader();
		const pump = (): void => {
			reader.read().then(({ done, value }) => {
				if (done) { out.end((err: Error | null | undefined) => err ? reject(err) : resolve()); return; }
				if (!out.write(Buffer.from(value))) { out.once('drain', pump); } else { pump(); }
			}).catch(reject);
		};
		out.on('error', reject);
		pump();
	});
}

async function fetchRelease(): Promise<CursorCliRelease> {
	const url = cursorInstallScriptUrl(process.platform);
	const response = await fetch(url);
	if (!response.ok) { throw new Error(`HTTP ${response.status} fetching ${url}`); }
	return parseCursorInstallScript(await response.text(), process.platform, process.arch);
}

function findExecutable(dir: string): string | undefined {
	const found: string[] = [];
	const walk = (current: string, depth: number) => {
		if (depth > 4) { return; }
		let entries: fs.Dirent[];
		try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }
		for (const entry of entries) {
			const full = path.join(current, entry.name);
			if (entry.isDirectory()) { walk(full, depth + 1); }
			else if (/^(cursor-agent|agent)(\.exe|\.cmd)?$/.test(entry.name)) { found.push(full); }
		}
	};
	walk(dir, 0);
	return preferredCursorExecutable(found);
}

async function downloadAndExtract(release: CursorCliRelease, dest: string): Promise<void> {
	fs.mkdirSync(path.dirname(dest), { recursive: true });
	const tmp = `${dest}.tmp-${process.pid}`;
	fs.rmSync(tmp, { recursive: true, force: true });
	fs.mkdirSync(tmp, { recursive: true });
	const archive = path.join(tmp, release.archive === 'zip' ? 'package.zip' : 'package.tar.gz');
	try {
		await downloadFile(release.downloadUrl, archive);
		if (release.archive === 'tar.gz') {
			await execFile('tar', ['--strip-components=1', '-xzf', archive, '-C', tmp]);
		} else {
			const extract = path.join(tmp, 'extract');
			fs.mkdirSync(extract);
			await execFile('tar', ['-xf', archive, '-C', extract]);
			const staged = path.join(extract, 'dist-package');
			const source = fs.existsSync(staged) ? staged : extract;
			for (const name of fs.readdirSync(source)) { fs.renameSync(path.join(source, name), path.join(tmp, name)); }
			fs.rmSync(extract, { recursive: true, force: true });
		}
		fs.rmSync(archive, { force: true });
		fs.rmSync(dest, { recursive: true, force: true });
		fs.renameSync(tmp, dest);
	} catch (err) {
		fs.rmSync(tmp, { recursive: true, force: true });
		throw err;
	}
}

async function doEnsure(): Promise<string> {
	const override = overridePath();
	if (override) {
		if (!fs.existsSync(override)) { throw new Error(vscode.l10n.t("Cursor CLI was not found at {0}.", override)); }
		return override;
	}
	if (!storageRoot) { throw new Error('Cursor CLI storage is not ready.'); }
	const cached = readCurrent();
	let release: CursorCliRelease;
	try {
		release = await fetchRelease();
	} catch (err) {
		if (cached) { log.warn(`Cursor CLI update check failed, using ${cached.version}: ${(err as Error).message}`); return cached.executable; }
		throw err;
	}
	if (cached && cached.version === release.version && cached.target === release.target.id) { return cached.executable; }
	const dest = path.join(storageRoot, 'versions', release.version, release.target.id);
	const sentinel = path.join(dest, '.complete');
	if (!fs.existsSync(sentinel) || !findExecutable(dest)) {
		log.info(`Downloading Cursor CLI ${release.version} from ${release.downloadUrl}`);
		await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: vscode.l10n.t("Downloading Cursor Agent…") }, () => downloadAndExtract(release, dest));
	}
	const executable = findExecutable(dest);
	if (!executable) { throw new Error(vscode.l10n.t("The Cursor package did not contain the agent executable.")); }
	try { fs.chmodSync(executable, 0o755); } catch { /* Windows */ }
	fs.writeFileSync(sentinel, '');
	fs.mkdirSync(storageRoot, { recursive: true });
	fs.writeFileSync(path.join(storageRoot, 'current.json'), JSON.stringify({ version: release.version, target: release.target.id, executable } satisfies CurrentInstall));
	const versions = path.join(storageRoot, 'versions');
	for (const name of fs.readdirSync(versions)) {
		if (name !== release.version) { fs.rmSync(path.join(versions, name), { recursive: true, force: true }); }
	}
	log.info(`Cursor CLI ${release.version} ready at ${executable}`);
	return executable;
}

/** Resolves the Cursor CLI, downloading it on first use and when the official script names a newer build. */
export function ensureCursorCli(): Promise<string> {
	if (!enabled() && !overridePath()) { return Promise.reject(new Error(vscode.l10n.t("Cursor Agent is turned off in Settings (axiora.cursor.enabled)."))); }
	if (!inflight) {
		const run = doEnsure();
		inflight = run;
		run.catch(() => { if (inflight === run) { inflight = undefined; } });
	}
	return inflight;
}

function runAgent(exe: string, args: string[], token?: vscode.CancellationToken, openUrls = false): Promise<{ code: number; output: string }> {
	return new Promise((resolve, reject) => {
		const child = cp.spawn(exe, args, { env: { ...process.env, NO_OPEN_BROWSER: '1' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
		let output = '';
		const take = (chunk: Buffer) => {
			output = (output + chunk.toString()).slice(-8000);
			if (!openUrls) { return; }
			const match = /https:\/\/[^\s'")]+/.exec(output);
			if (match) { openCursorLoginUrl(match[0].replace(/[.,)]$/, '')); }
		};
		child.stdout?.on('data', take);
		child.stderr?.on('data', take);
		const sub = token?.onCancellationRequested(() => child.kill());
		child.on('error', err => { sub?.dispose(); reject(err); });
		child.on('exit', code => { sub?.dispose(); resolve({ code: code ?? 1, output }); });
	});
}

async function signIn(): Promise<void> {
	const exe = await ensureCursorCli();
	resetLoginUrlGate();
	const login = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: vscode.l10n.t("Signing in to Cursor…"), cancellable: true }, (_progress, token) => runAgent(exe, ['login'], token, true));
	if (login.code !== 0) { throw new Error(login.output.trim().slice(-400) || vscode.l10n.t("Cursor sign-in did not finish.")); }
	const status = await runAgent(exe, ['status']);
	const signedIn = status.code === 0 && !/not (logged|signed) in|not authenticated/i.test(status.output);
	await vscode.commands.executeCommand('setContext', 'axiora.cursor.signedIn', signedIn);
	if (!signedIn) { throw new Error(status.output.trim().slice(-400) || vscode.l10n.t("Cursor sign-in did not finish.")); }
	vscode.window.showInformationMessage(vscode.l10n.t("Signed in to Cursor."));
}

async function showStatus(): Promise<void> {
	const exe = cursorExecutableNow() ?? await ensureCursorCli();
	const status = await runAgent(exe, ['status']);
	vscode.window.showInformationMessage(status.output.trim().slice(0, 400) || vscode.l10n.t("Cursor CLI {0}", exe));
}

export function activate(ctx: vscode.ExtensionContext): void {
	storageRoot = path.join(ctx.globalStorageUri.fsPath, 'cursor-cli');
	register(ctx, 'axiora.cursor.signIn', signIn);
	register(ctx, 'axiora.cursor.status', showStatus);
	if (!enabled()) { return; }
	// First launch and every later launch: refresh in the background. A failure
	// keeps the last good binary and is retried next launch (or on Sign In).
	void ensureCursorCli().catch(err => {
		log.warn(`Cursor CLI background download failed: ${(err as Error).message}`);
		void vscode.window.showWarningMessage(vscode.l10n.t("Cursor CLI download failed: {0}. Axiora will try again on the next launch.", (err as Error).message));
	});
}
