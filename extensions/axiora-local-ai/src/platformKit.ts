/*---------------------------------------------------------------------------------------------
 *  Platform kit — written for the owner's machines (toolchains/devices not on the build box):
 *  - Voice dictation via a local Whisper server (whisper.cpp server /inference or any
 *    OpenAI-compatible /v1/audio/transcriptions): record in a small panel → text at cursor/chat.
 *  - OS scripts: run selection/file as AppleScript (macOS), PowerShell (Windows) or shell.
 *  - Nix: detect flake.nix / shell.nix, open dev shell terminals, load the env into terminals.
 *  - Emulators & devices: Android AVDs (emulator), adb devices/install/logcat, scrcpy mirroring,
 *    iOS Simulator (xcrun simctl), Gradle tasks.
 *  - Container debugging: run the current Node/Python file in a container with the debugger
 *    port published and attach.
 *  - Java/Spring: run Spring Boot with JDWP and attach; R: terminal + run selection;
 *    Terraform: fmt/validate/plan/apply; CMake: configure/build/run; QML: preview.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { htmlDir, htmlLang, webviewL10n, voiceLanguage } from './i18n';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { register, wsRoot, run } from './util';

const isMac = process.platform === 'darwin', isWin = process.platform === 'win32';
const term = (name: string, cmd: string, cwd?: string) => { const t = vscode.window.terminals.find(x => x.name === name) ?? vscode.window.createTerminal({ name, cwd: cwd ?? wsRoot()?.fsPath }); t.show(); t.sendText(cmd); return t; };
const sel = () => { const e = vscode.window.activeTextEditor; return e ? (e.selection.isEmpty ? e.document.getText() : e.document.getText(e.selection)) : ''; };
const androidHome = () => process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || path.join(os.homedir(), isMac ? 'Library/Android/sdk' : isWin ? 'AppData/Local/Android/Sdk' : 'Android/Sdk');
const sdkTool = (sub: string, name: string) => { const p = path.join(androidHome(), sub, isWin ? `${name}.exe` : name); return fs.existsSync(p) ? p : name; };
export function activate(ctx: vscode.ExtensionContext) {
	// ---- voice dictation (local Whisper)
	register(ctx, 'axiora.voice.setApiKey', async () => { const k = await vscode.window.showInputBox({ prompt: vscode.l10n.t("API key for the OpenAI-compatible /audio/transcriptions endpoint (Groq, OpenAI, …); blank = main AI key"), password: true }); if (k !== undefined) { k ? await ctx.secrets.store('axiora.voice.apiKey', k) : await ctx.secrets.delete('axiora.voice.apiKey'); } });
	register(ctx, 'axiora.voice.dictate', async (target?: 'chat' | 'editor') => {
		const vc = vscode.workspace.getConfiguration('axiora.voice'); const remote = vc.get<string>('provider', 'local') === 'openai';
		const endpoint = remote ? `${vc.get<string>('baseUrl', 'https://api.groq.com/openai/v1').replace(/\/+$/, '')}/audio/transcriptions` : vc.get<string>('endpoint', 'http://127.0.0.1:8080/inference');
		const sttKey = remote ? (await ctx.secrets.get('axiora.voice.apiKey') ?? await ctx.secrets.get('axiora.ai.apiKey')) : undefined;
		const ed = vscode.window.activeTextEditor;
		const panel = vscode.window.createWebviewPanel('axioraVoice', vscode.l10n.t("Dictation"), { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, { enableScripts: true });
		panel.webview.html = `<!doctype html><html dir="${htmlDir()}" lang="${htmlLang()}"><body style="font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:16px"><button id=b style="font-size:16px;padding:10px 18px">${vscode.l10n.t("● Start recording")}</button><p id=s>${vscode.l10n.t("Uses your microphone; audio goes only to {0}", endpoint.replace(/</g, ''))}</p><script>${webviewL10n(['Transcribing…', '● Start recording', '■ Stop', 'Recording…'])}const v=acquireVsCodeApi();let rec,chunks=[];b.onclick=async()=>{if(rec){rec.stop();return}const st=await navigator.mediaDevices.getUserMedia({audio:true});rec=new MediaRecorder(st);chunks=[];rec.ondataavailable=e=>chunks.push(e.data);rec.onstop=async()=>{st.getTracks().forEach(t=>t.stop());s.textContent=L('Transcribing…');const buf=await new Blob(chunks,{type:rec.mimeType}).arrayBuffer();v.postMessage({type:rec.mimeType,data:Array.from(new Uint8Array(buf))});rec=null;b.textContent=L('● Start recording')};rec.start();b.textContent=L('■ Stop');s.textContent=L('Recording…')}</script></body></html>`;
		panel.webview.onDidReceiveMessage(async m => {
			const form = new FormData(); const blob = new Blob([new Uint8Array(m.data)], { type: m.type });
			form.append('file', blob, m.type.includes('ogg') ? 'audio.ogg' : 'audio.webm'); form.append('model', (vc.get<string>('model', '') || (remote ? 'whisper-large-v3-turbo' : 'whisper-1'))); form.append('response_format', 'json'); const vlang = voiceLanguage(); if (vlang) { form.append('language', vlang); }
			try {
				const r = await fetch(endpoint, { method: 'POST', body: form, headers: sttKey ? { authorization: `Bearer ${sttKey}` } : undefined }); if (!r.ok) { throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`); } const j = await r.json() as { text?: string };
				const text = (j.text ?? '').trim(); if (!text) { throw new Error('empty transcription'); }
				if (target === 'chat') { await vscode.commands.executeCommand('workbench.action.chat.open', { query: text, isPartialQuery: true }); }
				else if (ed) { await ed.edit(b => b.insert(ed.selection.active, text)); } else { await vscode.env.clipboard.writeText(text); }
				panel.dispose();
			} catch (e) { vscode.window.showErrorMessage(vscode.l10n.t("Dictation failed ({0}): {1}. {2}", endpoint, (e as Error).message, remote ? vscode.l10n.t("Check axiora.voice.baseUrl / axiora.voice.model and the key (Voice: Set Speech-to-Text API Key).") : vscode.l10n.t("Start a local whisper server, e.g. \"whisper-server -m ggml-base.bin --port 8080\", or set axiora.voice.provider to \"openai\" (Groq / OpenAI / any /audio/transcriptions endpoint)."))); }
		});
	});
	// ---- OS scripts
	register(ctx, 'axiora.os.runScript', async () => {
		const code = sel(); if (!code) { return; }
		const kinds = [...(isMac ? ['AppleScript', 'JavaScript for Automation'] : []), ...(isWin ? ['PowerShell', 'cmd'] : []), 'Shell (bash/zsh)'];
		const k = kinds.length === 1 ? kinds[0] : await vscode.window.showQuickPick(kinds, { placeHolder: vscode.l10n.t("Run selection as") }); if (!k) { return; }
		const f = path.join(os.tmpdir(), `axiora-script-${Date.now()}.${{ AppleScript: 'applescript', 'JavaScript for Automation': 'js', PowerShell: 'ps1', cmd: 'cmd' }[k] ?? 'sh'}`); fs.writeFileSync(f, code);
		const [cmd, args] = k === 'AppleScript' ? ['osascript', [f]] : k === 'JavaScript for Automation' ? ['osascript', ['-l', 'JavaScript', f]] : k === 'PowerShell' ? ['powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', f]] : k === 'cmd' ? ['cmd', ['/c', f]] : [process.env.SHELL || 'bash', [f]];
		const outp = await run(cmd, args, os.homedir()).catch(e => `Error: ${e.message}`);
		const a = await vscode.window.showInformationMessage(outp.trim().slice(0, 300) || `${k} finished.`, 'Replace Selection', 'Copy');
		const ed = vscode.window.activeTextEditor; if (a === 'Replace Selection' && ed) { await ed.edit(b => b.replace(ed.selection, outp.trim())); } else if (a === 'Copy') { await vscode.env.clipboard.writeText(outp); }
	});
	// ---- Nix
	register(ctx, 'axiora.nix.shell', async () => {
		const r = wsRoot(); if (!r) { return; }
		const flake = fs.existsSync(path.join(r.fsPath, 'flake.nix')), shell = fs.existsSync(path.join(r.fsPath, 'shell.nix')) || fs.existsSync(path.join(r.fsPath, 'default.nix'));
		if (!flake && !shell) { const a = await vscode.window.showInformationMessage(vscode.l10n.t("No flake.nix or shell.nix in this folder."), 'Create shell.nix'); if (a) { const u = vscode.Uri.joinPath(r, 'shell.nix'); await vscode.workspace.fs.writeFile(u, new TextEncoder().encode('{ pkgs ? import <nixpkgs> {} }:\npkgs.mkShell {\n  packages = with pkgs; [ nodejs python3 git ];\n}\n')); await vscode.window.showTextDocument(u); } return; }
		term('Nix dev shell', flake ? 'nix develop' : 'nix-shell');
	});
	register(ctx, 'axiora.nix.loadEnv', async () => {
		const r = wsRoot(); if (!r) { return; }
		const flake = fs.existsSync(path.join(r.fsPath, 'flake.nix'));
		const envOut = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: vscode.l10n.t("Evaluating Nix environment…") }, () => run('bash', ['-lc', flake ? 'nix print-dev-env --json' : 'nix-shell --run "env -0" | tr "\\0" "\\n"'], r.fsPath));
		const env: Record<string, string> = {};
		if (flake) { for (const [k, v] of Object.entries<any>(JSON.parse(envOut).variables ?? {})) { if (v.type === 'exported' && typeof v.value === 'string') { env[k] = v.value; } } }
		else { for (const l of envOut.split('\n')) { const i = l.indexOf('='); if (i > 0) { env[l.slice(0, i)] = l.slice(i + 1); } } }
		const coll = ctx.environmentVariableCollection; coll.clear(); for (const [k, v] of Object.entries(env)) { if (!/^(PWD|SHLVL|_|OLDPWD|TERM.*)$/.test(k)) { coll.replace(k, v); } }
		vscode.window.showInformationMessage(vscode.l10n.t("Nix environment loaded into new terminals ({0} variables).", Object.keys(env).length));
	});
	// ---- Android / iOS
	register(ctx, 'axiora.device.emulator', async () => {
		const avds = (await run(sdkTool('emulator', 'emulator'), ['-list-avds'], os.homedir()).catch(() => '')).split('\n').map(s => s.trim()).filter(Boolean);
		const sims = isMac ? JSON.parse(await run('xcrun', ['simctl', 'list', 'devices', 'available', '-j'], os.homedir()).catch(() => '{"devices":{}}')) as { devices: Record<string, { name: string; udid: string; state: string }[]> } : { devices: {} };
		const items = [...avds.map(a => ({ label: `$(device-mobile) ${a}`, description: 'Android emulator', run: () => term(`Emulator ${a}`, `"${sdkTool('emulator', 'emulator')}" -avd ${a}`) })), ...Object.entries(sims.devices).flatMap(([rt, ds]) => ds.map(d => ({ label: `$(device-mobile) ${d.name}`, description: `${rt.split('.').pop()} · ${d.state}`, run: () => { void run('xcrun', ['simctl', 'boot', d.udid], os.homedir()).catch(() => undefined).then(() => run('open', ['-a', 'Simulator'], os.homedir())); } })))];
		if (!items.length) { vscode.window.showWarningMessage(vscode.l10n.t("No emulators found. Android: install the SDK emulator + an AVD (ANDROID_HOME={0}); iOS: Xcode (macOS only).", androidHome())); return; }
		(await vscode.window.showQuickPick(items, { placeHolder: vscode.l10n.t("Start emulator / simulator") }))?.run();
	});
	register(ctx, 'axiora.device.adb', async () => {
		const adb = sdkTool('platform-tools', 'adb');
		const devs = (await run(adb, ['devices', '-l'], os.homedir()).catch(e => { throw new Error(`adb not found (${e.message}). Install Android platform-tools.`); })).split('\n').slice(1).filter(l => /\bdevice\b/.test(l)).map(l => ({ id: l.split(/\s+/)[0], model: /model:(\S+)/.exec(l)?.[1] ?? '' }));
		if (!devs.length) { vscode.window.showWarningMessage(vscode.l10n.t("No Android devices/emulators connected (enable USB debugging).")); return; }
		const d = devs.length === 1 ? devs[0] : (await vscode.window.showQuickPick(devs.map(x => ({ label: x.model || x.id, description: x.id, x })), { placeHolder: 'Device' }))?.x; if (!d) { return; }
		const a = await vscode.window.showQuickPick(['Install APK...', 'Logcat', 'Mirror Screen (scrcpy)', 'Shell', 'Screenshot'], { placeHolder: `${d.model || d.id}` });
		if (a === 'Install APK...') { const f = (await vscode.window.showOpenDialog({ filters: { APK: ['apk'] } }))?.[0]; if (f) { term('adb', `"${adb}" -s ${d.id} install -r "${f.fsPath}"`); } }
		if (a === 'Logcat') { term(`logcat ${d.id}`, `"${adb}" -s ${d.id} logcat -v color`); }
		if (a === 'Mirror Screen (scrcpy)') { term(`scrcpy ${d.id}`, `scrcpy -s ${d.id}`); }
		if (a === 'Shell') { term(`adb shell ${d.id}`, `"${adb}" -s ${d.id} shell`); }
		if (a === 'Screenshot') { const f = path.join(wsRoot()?.fsPath ?? os.tmpdir(), `screen-${Date.now()}.png`); await run('bash', ['-lc', `"${adb}" -s ${d.id} exec-out screencap -p > "${f}"`], os.homedir()); await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(f)); }
	});
	register(ctx, 'axiora.android.gradle', async () => {
		const r = wsRoot(); if (!r) { return; } const gw = fs.existsSync(path.join(r.fsPath, isWin ? 'gradlew.bat' : 'gradlew')) ? (isWin ? '.\\gradlew.bat' : './gradlew') : 'gradle';
		const t = await vscode.window.showQuickPick(['assembleDebug', 'installDebug', 'test', 'connectedAndroidTest', 'lint', 'bundleRelease', 'clean', 'tasks'], { placeHolder: vscode.l10n.t("Gradle task") }); if (t) { term('Gradle', `${gw} ${t}`); }
	});
	// ---- container debugging
	register(ctx, 'axiora.container.debug', async () => {
		const ed = vscode.window.activeTextEditor; const r = wsRoot(); if (!ed || !r) { return; }
		const py = ed.document.languageId === 'python'; const rel = path.relative(r.fsPath, ed.document.fileName).split(path.sep).join('/');
		const image = await vscode.window.showInputBox({ prompt: vscode.l10n.t("Container image"), value: py ? 'python:3.12-slim' : 'node:22-slim' }); if (!image) { return; }
		const port = py ? 5678 : 9229; const engine = vscode.workspace.getConfiguration('axiora.container').get<string>('engine', 'docker');
		const cmd = py ? `pip install -q debugpy && python -m debugpy --listen 0.0.0.0:${port} --wait-for-client ${rel}` : `node --inspect-brk=0.0.0.0:${port} ${rel}`;
		term('Container debug', `${engine} run --rm -it -p ${port}:${port} -v "${r.fsPath}:/work" -w /work ${image} sh -c "${cmd}"`);
		await new Promise(res => setTimeout(res, py ? 15000 : 4000));
		await vscode.debug.startDebugging(vscode.workspace.workspaceFolders![0], py
			? { type: 'debugpy', request: 'attach', name: 'Attach (container)', connect: { host: '127.0.0.1', port }, pathMappings: [{ localRoot: r.fsPath, remoteRoot: '/work' }] }
			: { type: 'node', request: 'attach', name: 'Attach (container)', address: '127.0.0.1', port, localRoot: r.fsPath, remoteRoot: '/work' });
	});
	// ---- Java / Spring
	register(ctx, 'axiora.java.springDebug', async () => {
		const r = wsRoot(); if (!r) { return; } const mvn = fs.existsSync(path.join(r.fsPath, 'pom.xml')); const jdwp = '-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=*:5005';
		term('Spring Boot', mvn ? `${fs.existsSync(path.join(r.fsPath, 'mvnw')) ? './mvnw' : 'mvn'} spring-boot:run -Dspring-boot.run.jvmArguments="${jdwp}"` : `${fs.existsSync(path.join(r.fsPath, 'gradlew')) ? './gradlew' : 'gradle'} bootRun --debug-jvm`);
		await new Promise(res => setTimeout(res, 12000));
		const ok = await vscode.debug.startDebugging(vscode.workspace.workspaceFolders![0], { type: 'java', request: 'attach', name: 'Attach Spring Boot', hostName: 'localhost', port: 5005 });
		if (!ok) { vscode.window.showWarningMessage(vscode.l10n.t("Attach needs a Java debug adapter: install \"vscjava.vscode-java-debug\" from Open VSX. The app is listening for a debugger on port 5005.")); }
	});
	// ---- R
	register(ctx, 'axiora.r.runSelection', () => { const t = vscode.window.terminals.find(x => x.name === 'R') ?? term('R', 'R --no-save'); t.show(true); t.sendText(sel()); });
	// ---- Terraform
	register(ctx, 'axiora.terraform.run', async () => { const c = await vscode.window.showQuickPick(['init', 'fmt -recursive', 'validate', 'plan', 'apply', 'destroy'], { placeHolder: 'terraform' }); if (c) { term('Terraform', `terraform ${c}`); } });
	// ---- CMake / C++
	register(ctx, 'axiora.cmake.build', async () => {
		const c = await vscode.window.showQuickPick(['Configure (Debug, compile_commands.json)', 'Build', 'Run tests (ctest)', 'Clean'], { placeHolder: 'CMake' }); if (!c) { return; }
		term('CMake', c.startsWith('Configure') ? 'cmake -S . -B build -DCMAKE_BUILD_TYPE=Debug -DCMAKE_EXPORT_COMPILE_COMMANDS=ON && ln -sf build/compile_commands.json .' : c === 'Build' ? 'cmake --build build -j' : c.startsWith('Run') ? 'ctest --test-dir build --output-on-failure' : 'cmake --build build --target clean');
	});
	// ---- QML
	register(ctx, 'axiora.qml.preview', () => { const e = vscode.window.activeTextEditor; if (e) { void e.document.save(); term('QML preview', `qml "${e.document.fileName}" || qmlscene "${e.document.fileName}"`); } });
}
