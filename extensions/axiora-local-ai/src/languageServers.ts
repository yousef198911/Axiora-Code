/*---------------------------------------------------------------------------------------------
 *  Language server manager: detects the language of opened files, offers to download/install
 *  the matching language server into the editor's own storage (no global installs), starts it
 *  through an LSP client hosted inside the editor (vscode-languageclient), and manages it from
 *  the palette ("Language Servers: Manage...") and the status bar language item ({} hover).
 *  Built-in servers (TS/JS, JSON, HTML, CSS, Markdown) are untouched; a server is skipped when
 *  an extension that already provides it is installed.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import * as os from 'os';
import { LanguageClient, LanguageClientOptions, ServerOptions } from 'vscode-languageclient/node';

type Install = { kind: 'path'; bin: string; hint: string } | { kind: 'url'; url: () => string; bin: string; requires?: string } | { kind: 'cmd'; cmd: string[]; bin: string; requires: string } | { kind: 'npm'; pkg: string; bin: string } | { kind: 'go'; pkg: string; bin: string } | { kind: 'github'; repo: string; asset: (tag: string) => RegExp; bin: string };
export type Server = { id: string; name: string; languages: string[]; install: Install; args: string[]; conflicts: string[]; detect?: string };
export const SERVERS: Server[] = [
	{ id: 'pyright', name: 'Pyright', languages: ['python'], install: { kind: 'npm', pkg: 'pyright', bin: 'pyright-langserver' }, args: ['--stdio'], conflicts: ['ms-python.vscode-pylance', 'ms-pyright.pyright', 'detachhead.basedpyright'] },
	{ id: 'bash', name: 'Bash Language Server', languages: ['shellscript'], install: { kind: 'npm', pkg: 'bash-language-server', bin: 'bash-language-server' }, args: ['start'], conflicts: ['mads-hartmann.bash-ide-vscode'] },
	{ id: 'yaml', name: 'YAML Language Server', languages: ['yaml'], install: { kind: 'npm', pkg: 'yaml-language-server', bin: 'yaml-language-server' }, args: ['--stdio'], conflicts: ['redhat.vscode-yaml'] },
	{ id: 'docker', name: 'Dockerfile Language Server', languages: ['dockerfile'], install: { kind: 'npm', pkg: 'dockerfile-language-server-nodejs', bin: 'docker-langserver' }, args: ['--stdio'], conflicts: ['ms-azuretools.vscode-docker', 'ms-azuretools.vscode-containers'] },
	{ id: 'gopls', name: 'gopls', languages: ['go'], install: { kind: 'go', pkg: 'golang.org/x/tools/gopls@latest', bin: 'gopls' }, args: [], conflicts: ['golang.go'], detect: 'go' },
	{ id: 'rust-analyzer', name: 'rust-analyzer', languages: ['rust'], install: { kind: 'github', repo: 'rust-lang/rust-analyzer', asset: () => new RegExp(`^rust-analyzer-${{ x64: 'x86_64', arm64: 'aarch64' }[process.arch as 'x64'] ?? 'x86_64'}-${{ linux: 'unknown-linux-gnu', darwin: 'apple-darwin', win32: 'pc-windows-msvc' }[process.platform as 'linux'] ?? 'unknown-linux-gnu'}\\.(gz|zip)$`), bin: 'rust-analyzer' }, args: [], conflicts: ['rust-lang.rust-analyzer'] },
	{ id: 'clangd', name: 'clangd', languages: ['c', 'cpp', 'objective-c', 'objective-cpp'], install: { kind: 'github', repo: 'clangd/clangd', asset: t => new RegExp(`^clangd-${{ linux: 'linux', darwin: 'mac', win32: 'windows' }[process.platform as 'linux'] ?? 'linux'}-${t.replace(/^v/, '').replace(/\./g, '\\.')}\\.zip$`), bin: 'clangd' }, args: ['--background-index'], conflicts: ['llvm-vs-code-extensions.vscode-clangd', 'ms-vscode.cpptools'] },
	{ id: 'lua', name: 'Lua Language Server', languages: ['lua'], install: { kind: 'github', repo: 'LuaLS/lua-language-server', asset: t => new RegExp(`^lua-language-server-${t.replace(/\./g, '\\.')}-${{ linux: 'linux', darwin: 'darwin', win32: 'win32' }[process.platform as 'linux'] ?? 'linux'}-${process.arch === 'arm64' ? 'arm64' : 'x64'}\\.(tar\\.gz|zip)$`), bin: path.join('bin', 'lua-language-server') }, args: [], conflicts: ['sumneko.lua'] },
	// --- written for the owner's machines (toolchains not on the build box) ---
	{ id: 'jdtls', name: 'Eclipse JDT Language Server (Java, Spring)', languages: ['java'], install: { kind: 'url', url: () => 'https://download.eclipse.org/jdtls/snapshots/jdt-language-server-latest.tar.gz', bin: path.join('bin', 'jdtls'), requires: 'java' }, args: ['-data', path.join(os.tmpdir(), 'axiora-jdtls-ws')], conflicts: ['redhat.java'] },
	{ id: 'kotlin', name: 'Kotlin Language Server', languages: ['kotlin'], install: { kind: 'github', repo: 'fwcd/kotlin-language-server', asset: () => /^server\.zip$/, bin: path.join('server', 'bin', 'kotlin-language-server') }, args: [], conflicts: ['fwcd.kotlin'] },
	{ id: 'terraform-ls', name: 'Terraform Language Server', languages: ['terraform', 'tf'], install: { kind: 'github', repo: 'hashicorp/terraform-ls', asset: t => new RegExp(`^terraform-ls_${t.replace(/^v/, '').replace(/\./g, '\\.')}_${{ linux: 'linux', darwin: 'darwin', win32: 'windows' }[process.platform as 'linux'] ?? 'linux'}_${process.arch === 'arm64' ? 'arm64' : 'amd64'}\\.zip$`), bin: 'terraform-ls' }, args: ['serve'], conflicts: ['hashicorp.terraform'] },
	{ id: 'r', name: 'R languageserver', languages: ['r'], install: { kind: 'cmd', cmd: ['Rscript', '-e', "install.packages('languageserver', repos='https://cloud.r-project.org', lib=Sys.getenv('R_LIBS_USER'))"], bin: 'R', requires: 'Rscript' }, args: ['--slave', '-e', 'languageserver::run()'], conflicts: ['reditorsupport.r'] },
	{ id: 'sourcekit', name: 'SourceKit-LSP (Swift)', languages: ['swift'], install: { kind: 'path', bin: 'sourcekit-lsp', hint: 'Install Xcode (macOS) or the Swift toolchain from swift.org (Linux/Windows).' }, args: [], conflicts: ['swiftlang.swift-vscode', 'sswg.swift-lang'] },
	{ id: 'qmlls', name: 'QML Language Server (Qt)', languages: ['qml'], install: { kind: 'path', bin: 'qmlls', hint: 'Install Qt 6.5+ and add its bin folder (with qmlls) to PATH.' }, args: [], conflicts: ['theqtcompany.qt-qml'] },
	{ id: 'kotlin-android', name: 'Gradle/Android (via jdtls + kotlin)', languages: ['groovy'], install: { kind: 'path', bin: 'gradle-language-server', hint: 'Optional: install gradle-language-server from microsoft/vscode-gradle.' }, args: [], conflicts: ['vscjava.vscode-gradle'] },
];
const exe = (b: string) => process.platform === 'win32' && !/\.\w+$/.test(b) ? `${b}${b.includes('node_modules') ? '.cmd' : '.exe'}` : b;
const sh = (cmd: string, args: string[], opts: cp.SpawnOptions, out: vscode.OutputChannel) => new Promise<void>((res, rej) => {
	out.appendLine(`$ ${cmd} ${args.join(' ')}`); const p = cp.spawn(cmd, args, { ...opts, shell: process.platform === 'win32' });
	p.stdout?.on('data', d => out.append(String(d))); p.stderr?.on('data', d => out.append(String(d)));
	p.on('error', e => rej(new Error(`${cmd}: ${e.message}`))); p.on('close', c => c === 0 ? res() : rej(new Error(`${cmd} exited ${c} (see "Language Servers" output)`)));
});
const onPath = (c: string) => (process.env.PATH ?? '').split(path.delimiter).some(d => { try { return fs.statSync(path.join(d, exe(c))).isFile(); } catch { return false; } });
export function activate(ctx: vscode.ExtensionContext) {
	const out = vscode.window.createOutputChannel('Language Servers', { log: true }); ctx.subscriptions.push(out);
	const root = path.join(ctx.globalStorageUri.fsPath, 'lsp'); fs.mkdirSync(root, { recursive: true });
	const cfg = () => vscode.workspace.getConfiguration('axiora.lsp');
	const dir = (s: Server) => path.join(root, s.id);
	const binPath = (s: Server) => { const i = s.install; if (i.kind === 'path') { const d = (process.env.PATH ?? '').split(path.delimiter).find(x => fs.existsSync(path.join(x, exe(i.bin)))); return d ? path.join(d, exe(i.bin)) : path.join(dir(s), exe(i.bin)); } if (i.kind === 'cmd') { const d = (process.env.PATH ?? '').split(path.delimiter).find(x => fs.existsSync(path.join(x, exe(i.bin)))); return fs.existsSync(path.join(dir(s), 'INSTALLED')) && d ? path.join(d, exe(i.bin)) : path.join(dir(s), 'missing'); } if (i.kind === 'npm') { return path.join(dir(s), 'node_modules', '.bin', exe(i.bin)); } if (i.kind === 'go') { return path.join(dir(s), 'bin', exe(i.bin)); } return path.join(dir(s), exe(i.bin)); };
	const installed = (s: Server) => fs.existsSync(binPath(s));
	const conflict = (s: Server) => s.conflicts.find(id => vscode.extensions.getExtension(id));
	const clients = new Map<string, LanguageClient>(); const status = new Map<string, vscode.LanguageStatusItem>(); const busy = new Set<string>();
	const item = (s: Server) => {
		let it = status.get(s.id);
		if (!it) { it = vscode.languages.createLanguageStatusItem(`axiora.lsp.${s.id}`, s.languages.map(language => ({ language }))); it.name = s.name; status.set(s.id, it); ctx.subscriptions.push(it); }
		const c = clients.get(s.id); const st = busy.has(s.id) ? 'installing…' : c?.isRunning() ? 'running' : installed(s) ? 'stopped' : 'not installed';
		it.text = `$(${c?.isRunning() ? 'pass' : busy.has(s.id) ? 'sync~spin' : 'circle-slash'}) ${s.name}`; it.detail = st; it.busy = busy.has(s.id);
		it.severity = st === 'running' ? vscode.LanguageStatusSeverity.Information : vscode.LanguageStatusSeverity.Warning;
		it.command = { title: c?.isRunning() ? 'Manage' : installed(s) ? 'Start' : 'Install', command: 'axiora.lsp.manage', arguments: [s.id] };
	};
	async function latestAsset(repo: string, re: (t: string) => RegExp) {
		const r = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'axiora-code' } });
		if (!r.ok) { throw new Error(`GitHub releases for ${repo}: HTTP ${r.status}`); }
		const j = await r.json() as { tag_name: string; assets: { name: string; browser_download_url: string }[] };
		const a = j.assets.find(x => re(j.tag_name).test(x.name)); if (!a) { throw new Error(`No ${process.platform}/${process.arch} build in ${repo} ${j.tag_name}`); }
		return { tag: j.tag_name, ...a };
	}
	async function install(s: Server) {
		const d = dir(s); fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true }); const i = s.install;
		if (i.kind === 'npm') {
			if (!onPath('npm')) { throw new Error(`${s.name} is installed with npm, but npm was not found on PATH. Install Node.js (https://nodejs.org) and retry.`); }
			fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: `axiora-lsp-${s.id}`, private: true }));
			await sh('npm', ['install', '--no-audit', '--no-fund', '--omit=dev', i.pkg], { cwd: d }, out);
		} else if (i.kind === 'go') {
			if (!onPath('go')) { throw new Error(`${s.name} needs the Go toolchain (https://go.dev/dl) — "go" was not found on PATH.`); }
			await sh('go', ['install', i.pkg], { cwd: d, env: { ...process.env, GOBIN: path.join(d, 'bin') } }, out);
		} else if (i.kind === 'path') {
			throw new Error(`${s.name}: "${i.bin}" not found on PATH. ${i.hint}`);
		} else if (i.kind === 'cmd') {
			if (!onPath(i.requires)) { throw new Error(`${s.name} needs "${i.requires}" on PATH.`); }
			await sh(i.cmd[0], i.cmd.slice(1), { cwd: d }, out); fs.writeFileSync(path.join(d, 'INSTALLED'), new Date().toISOString());
		} else if (i.kind === 'url') {
			if (i.requires && !onPath(i.requires)) { throw new Error(`${s.name} needs "${i.requires}" (JDK 21+) on PATH.`); }
			const u = i.url(); out.appendLine(`downloading ${u}`); const r = await fetch(u); if (!r.ok) { throw new Error(`download failed: HTTP ${r.status}`); }
			const f = path.join(d, path.basename(u)); fs.writeFileSync(f, Buffer.from(await r.arrayBuffer()));
			await sh('tar', ['-xzf', f, '-C', d], {}, out); fs.rmSync(f, { force: true });
			if (process.platform !== 'win32' && fs.existsSync(binPath(s))) { fs.chmodSync(binPath(s), 0o755); }
		} else {
			const a = await latestAsset(i.repo, i.asset); out.appendLine(`downloading ${a.browser_download_url}`);
			const r = await fetch(a.browser_download_url); if (!r.ok) { throw new Error(`download failed: HTTP ${r.status}`); }
			const buf = Buffer.from(await r.arrayBuffer()); const file = path.join(d, a.name); fs.writeFileSync(file, buf);
			if (a.name.endsWith('.gz') && !a.name.endsWith('.tar.gz')) { fs.writeFileSync(binPath(s), zlib.gunzipSync(buf)); }
			else if (a.name.endsWith('.tar.gz')) { await sh('tar', ['-xzf', file, '-C', d], {}, out); }
			else { // zip: extract and flatten a single top-level folder (clangd_19.1.2/bin/clangd → bin/clangd)
				if (process.platform === 'win32') { await sh('powershell', ['-NoProfile', '-Command', `Expand-Archive -Force '${file}' '${d}'`], {}, out); } else { await sh('unzip', ['-q', '-o', file, '-d', d], {}, out); }
				const top = fs.readdirSync(d).filter(n => n !== a.name && fs.statSync(path.join(d, n)).isDirectory());
				if (!fs.existsSync(binPath(s)) && top.length === 1) { const t = path.join(d, top[0]); const cand = [path.join(t, 'bin', exe(i.bin)), path.join(t, exe(i.bin))].find(fs.existsSync); if (cand) { fs.symlinkSync(cand, binPath(s)); } }
			}
			fs.rmSync(file, { force: true }); fs.writeFileSync(path.join(d, 'VERSION'), a.tag);
			if (process.platform !== 'win32') { fs.chmodSync(fs.realpathSync(binPath(s)), 0o755); }
		}
		if (!installed(s)) { throw new Error(`${s.name} installed but ${binPath(s)} is missing`); }
	}
	async function start(s: Server) {
		if (clients.get(s.id)?.isRunning()) { return; }
		const server: ServerOptions = { command: binPath(s), args: s.args, options: { cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath, env: { ...process.env, PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH}` } } };
		const client: LanguageClientOptions = { documentSelector: s.languages.flatMap(language => [{ scheme: 'file', language }, { scheme: 'untitled', language }]), outputChannel: out, initializationOptions: cfg().get<Record<string, unknown>>(`initializationOptions.${s.id}`) };
		const c = new LanguageClient(`axiora-lsp-${s.id}`, s.name, server, client); clients.set(s.id, c);
		await c.start(); out.info(`${s.name} started`); item(s);
	}
	async function stop(s: Server) { const c = clients.get(s.id); clients.delete(s.id); if (c) { await c.stop().catch(() => undefined); } item(s); }
	const ensure = async (s: Server, interactive: boolean) => {
		if (busy.has(s.id) || clients.get(s.id)?.isRunning() || conflict(s)) { return; }
		if (cfg().get<string[]>('disabled', []).includes(s.id)) { return; }
		if (!installed(s)) {
			const mode = cfg().get<string>('autoInstall', 'ask');
			if (mode === 'never' && !interactive) { item(s); return; }
			if (mode === 'ask' && !interactive) {
				const a = await vscode.window.showInformationMessage(vscode.l10n.t("Install the {0} language server for {1} (completions, diagnostics, go to definition)?", s.name, s.languages[0]), 'Install', 'Not Now', 'Never for ' + s.name);
				if (a?.startsWith('Never')) { await cfg().update('disabled', [...cfg().get<string[]>('disabled', []), s.id], vscode.ConfigurationTarget.Global); }
				if (a !== 'Install') { item(s); return; }
			}
			busy.add(s.id); item(s);
			try { await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: vscode.l10n.t("Installing {0}…", s.name) }, () => install(s)); }
			catch (e) { busy.delete(s.id); item(s); const a = await vscode.window.showErrorMessage(vscode.l10n.t("Could not install {0}: {1}", s.name, (e as Error).message), 'Show Log'); if (a) { out.show(); } return; }
			busy.delete(s.id);
		}
		try { await start(s); } catch (e) { item(s); vscode.window.showErrorMessage(vscode.l10n.t("{0} failed to start: {1}", s.name, (e as Error).message), 'Show Log').then(a => a && out.show()); }
	};
	const forDoc = (d: vscode.TextDocument) => SERVERS.find(s => s.languages.includes(d.languageId));
	const onDoc = (d: vscode.TextDocument) => { const s = forDoc(d); if (s && (d.uri.scheme === 'file' || d.uri.scheme === 'untitled')) { item(s); void ensure(s, false); } };
	vscode.workspace.textDocuments.forEach(onDoc); ctx.subscriptions.push(vscode.workspace.onDidOpenTextDocument(onDoc));
	ctx.subscriptions.push({ dispose: () => { for (const c of clients.values()) { void c.stop(); } } });
	ctx.subscriptions.push(vscode.commands.registerCommand('axiora.lsp.manage', async (id?: string) => {
		let s = SERVERS.find(x => x.id === id);
		if (!s) {
			const p = await vscode.window.showQuickPick(SERVERS.map(x => { const c = conflict(x); const run = clients.get(x.id)?.isRunning(); return { label: `${run ? '$(pass-filled)' : installed(x) ? '$(circle-large-outline)' : '$(cloud-download)'} ${x.name}`, description: x.languages.join(', '), detail: c ? `provided by extension ${c}` : run ? 'running' : installed(x) ? `installed${fs.existsSync(path.join(dir(x), 'VERSION')) ? ` (${fs.readFileSync(path.join(dir(x), 'VERSION'), 'utf8')})` : ''} · stopped` : 'not installed', s: x }; }), { placeHolder: vscode.l10n.t("Language servers managed by Axiora") });
			s = p?.s; if (!s) { return; }
		}
		const run = clients.get(s.id)?.isRunning(); const dis = cfg().get<string[]>('disabled', []).includes(s.id);
		const acts = [...(run ? ['Restart', 'Stop'] : installed(s) ? ['Start'] : ['Install and Start']), ...(installed(s) ? ['Update (reinstall)', 'Uninstall'] : []), dis ? 'Enable auto-start' : 'Disable auto-start', 'Show Log'];
		const a = await vscode.window.showQuickPick(acts, { placeHolder: `${s.name} — ${run ? 'running' : installed(s) ? 'stopped' : 'not installed'}` });
		if (a === 'Restart') { await stop(s); await start(s); }
		else if (a === 'Stop') { await stop(s); }
		else if (a === 'Start' || a === 'Install and Start') { await ensure(s, true); }
		else if (a === 'Update (reinstall)') { await stop(s); fs.rmSync(dir(s), { recursive: true, force: true }); await ensure(s, true); }
		else if (a === 'Uninstall') { await stop(s); fs.rmSync(dir(s), { recursive: true, force: true }); item(s); vscode.window.showInformationMessage(vscode.l10n.t("{0} uninstalled.", s.name)); }
		else if (a === 'Disable auto-start' || a === 'Enable auto-start') { const l = cfg().get<string[]>('disabled', []); await cfg().update('disabled', dis ? l.filter(x => x !== s!.id) : [...l, s.id], vscode.ConfigurationTarget.Global); }
		else if (a === 'Show Log') { out.show(); }
	}));
}
