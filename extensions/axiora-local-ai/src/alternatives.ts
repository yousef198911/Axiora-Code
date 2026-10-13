/*---------------------------------------------------------------------------------------------
 *  Practical alternatives for items that cannot be built literally in an Electron/Code-OSS fork:
 *  - GPU-native UI (#144)      → "Rendering: GPU Acceleration..." (argv.json GPU rasterization /
 *                                 hardware acceleration, WebGL terminal, smooth scrolling presets)
 *  - macOS-native UI (#145)    → "Window: macOS Native Look" (native title bar/tabs/fullscreen,
 *                                 SF fonts) + Touch Bar buttons for the main Axiora actions
 *  - WebContainers (#188)      → "Run in Sandbox": Node permission model (no network/child
 *                                 processes, fs limited to the workspace) or a no-network container
 *  - Model training (#47)      → "Fine-tune: Export Training Data" (JSONL from your repo + git
 *                                 history) and "Fine-tune: Launch LoRA Job..." (unsloth / mlx-lm /
 *                                 axolotl / llama.cpp) + "Import Adapter into Ollama"
 *  Also: computer use agent (#78), remote/Wi-Fi Android devices (#194), APK manifest (#107).
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { register, wsRoot, run, log } from './util';
import { chat } from './llm';

const isMac = process.platform === 'darwin', isWin = process.platform === 'win32';
const conf = () => vscode.workspace.getConfiguration();
const stripJsonc = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:"'])\/\/.*$/gm, '$1').replace(/,(\s*[}\]])/g, '$1');

async function editArgv(patch: Record<string, unknown>) {
	await vscode.commands.executeCommand('workbench.action.configureRuntimeArguments');
	await new Promise(r => setTimeout(r, 800));
	const ed = vscode.window.activeTextEditor; if (!ed || !ed.document.fileName.endsWith('argv.json')) { throw new Error('Could not open argv.json'); }
	const j = JSON.parse(stripJsonc(ed.document.getText()) || '{}'); for (const [k, v] of Object.entries(patch)) { if (v === undefined) { delete j[k]; } else { j[k] = v; } }
	await ed.edit(b => b.replace(new vscode.Range(0, 0, ed.document.lineCount, 0), JSON.stringify(j, null, '\t') + '\n')); await ed.document.save();
}
const runOut = (cmd: string, args: string[], cwd = os.homedir()) => run(cmd, args, cwd);

export function activate(ctx: vscode.ExtensionContext) {
	// ---- #144 GPU rendering presets
	register(ctx, 'axiora.render.gpu', async () => {
		const p = await vscode.window.showQuickPick([
			{ label: '$(rocket) Maximum GPU', description: 'GPU rasterization, zero-copy, WebGL terminal, smooth scrolling', id: 'max' },
			{ label: '$(dashboard) Balanced (default)', description: 'Chromium defaults, WebGL terminal when available', id: 'auto' },
			{ label: '$(circle-slash) Software rendering', description: 'Disable hardware acceleration (driver issues, VMs, RDP)', id: 'off' }], { placeHolder: 'Rendering mode (restart required)' });
		if (!p) { return; }
		const g = vscode.ConfigurationTarget.Global;
		await editArgv(p.id === 'max' ? { 'disable-hardware-acceleration': false, 'enable-gpu-rasterization': true, 'enable-zero-copy': true, 'ignore-gpu-blocklist': true } : p.id === 'off' ? { 'disable-hardware-acceleration': true, 'enable-gpu-rasterization': undefined, 'enable-zero-copy': undefined, 'ignore-gpu-blocklist': undefined } : { 'disable-hardware-acceleration': undefined, 'enable-gpu-rasterization': undefined, 'enable-zero-copy': undefined, 'ignore-gpu-blocklist': undefined });
		await conf().update('terminal.integrated.gpuAcceleration', p.id === 'off' ? 'off' : p.id === 'max' ? 'on' : 'auto', g);
		await conf().update('editor.smoothScrolling', p.id === 'max', g); await conf().update('workbench.list.smoothScrolling', p.id === 'max', g); await conf().update('editor.cursorSmoothCaretAnimation', p.id === 'max' ? 'on' : 'off', g);
		if (await vscode.window.showInformationMessage(`Rendering set to "${p.label.replace(/\$\([^)]*\)\s*/, '')}". Restart to apply GPU flags.`, 'Restart Now') === 'Restart Now') { await vscode.commands.executeCommand('workbench.action.quit'); }
	});
	register(ctx, 'axiora.render.gpuInfo', () => vscode.env.openExternal(vscode.Uri.parse('chrome://gpu')).then(ok => { if (!ok) { void vscode.commands.executeCommand('workbench.action.toggleDevTools'); vscode.window.showInformationMessage('In DevTools run: chrome://gpu is not available here; check "Help > Toggle Developer Tools > Rendering".'); } }));
	// ---- #145 macOS native look + Touch Bar
	register(ctx, 'axiora.window.macNative', async () => {
		const on = await vscode.window.showQuickPick(['Native macOS look', 'Axiora custom look'], { placeHolder: 'Window style (restart required)' }); if (!on) { return; }
		const n = on.startsWith('Native'), g = vscode.ConfigurationTarget.Global;
		await conf().update('window.titleBarStyle', n ? 'native' : 'custom', g); await conf().update('window.nativeTabs', n && isMac, g); await conf().update('window.nativeFullScreen', true, g);
		await conf().update('workbench.layoutControl.enabled', !n, g); await conf().update('window.commandCenter', !n, g);
		if (n) { await conf().update('editor.fontFamily', isMac ? "'SF Mono', Menlo, monospace" : conf().get('editor.fontFamily'), g); await conf().update('keyboard.dispatch', isMac ? 'code' : 'keyCode', g); }
		if (await vscode.window.showInformationMessage(`${on} applied${isMac ? '' : ' (native tabs and Touch Bar only take effect on macOS)'}.`, 'Restart Now') === 'Restart Now') { await vscode.commands.executeCommand('workbench.action.reloadWindow'); }
	});
	// ---- #188 sandboxed run (WebContainers alternative)
	register(ctx, 'axiora.sandbox.run', async () => {
		const ed = vscode.window.activeTextEditor; const r = wsRoot(); if (!ed || !r) { return; } await ed.document.save();
		const f = ed.document.fileName; const engine = conf().get<string>('axiora.sandbox.engine', 'node-permission');
		const outDir = path.join(r.fsPath, '.axiora', 'sandbox-out'); fs.mkdirSync(outDir, { recursive: true });
		const t = vscode.window.createTerminal({ name: 'Sandbox', cwd: r.fsPath }); t.show();
		if (engine === 'node-permission') {
			if (!/\.(m?js|cjs)$/.test(f)) { vscode.window.showWarningMessage('Node permission sandbox runs .js/.mjs/.cjs files; use engine "docker"/"podman" for other languages.'); return; }
			t.sendText(`node --permission --allow-fs-read="${r.fsPath}" --allow-fs-write="${outDir}" "${f}"`);
		} else {
			const image = /\.py$/.test(f) ? 'python:3.12-slim' : 'node:22-slim'; const rel = path.relative(r.fsPath, f).split(path.sep).join('/');
			t.sendText(`${engine} run --rm -it --network none --read-only --tmpfs /tmp --cpus 1 --memory 512m --pids-limit 128 --security-opt no-new-privileges -v "${r.fsPath}:/work:ro" -v "${outDir}:/out" -w /work ${image} ${/\.py$/.test(f) ? 'python' : 'node'} ${rel}`);
		}
		vscode.window.setStatusBarMessage(`$(shield) Sandboxed (${engine}): no network, writes only to .axiora/sandbox-out`, 6000);
	});
	// ---- #47 fine-tuning
	register(ctx, 'axiora.finetune.export', async () => {
		const r = wsRoot(); if (!r) { return; }
		const out = path.join(r.fsPath, '.axiora', 'finetune'); fs.mkdirSync(out, { recursive: true });
		const files = (await runOut('git', ['ls-files'], r.fsPath).catch(() => '')).split('\n').filter(x => /\.(ts|js|py|go|rs|java|kt|c|cc|cpp|h|cs|rb|php|swift)$/.test(x)).slice(0, 2000);
		const lines: string[] = []; let fim = 0, cm = 0;
		for (const rel of files) {
			let t = ''; try { t = fs.readFileSync(path.join(r.fsPath, rel), 'utf8'); } catch { continue; } if (t.length < 200 || t.length > 60000) { continue; }
			for (let k = 0; k < 3; k++) { const a = Math.floor(Math.random() * (t.length - 120)), b = a + 20 + Math.floor(Math.random() * 100); lines.push(JSON.stringify({ messages: [{ role: 'system', content: 'Complete the code at <CURSOR>.' }, { role: 'user', content: `// ${rel}\n${t.slice(Math.max(0, a - 1500), a)}<CURSOR>${t.slice(b, b + 500)}` }, { role: 'assistant', content: t.slice(a, b) }] })); fim++; }
		}
		const logOut = await runOut('git', ['log', '-n', '300', '--no-merges', '--format=%H%x00%B%x01'], r.fsPath).catch(() => '');
		for (const e of logOut.split('\x01').map(x => x.trim()).filter(Boolean)) { const [h, msg] = e.split('\x00'); const diff = await runOut('git', ['show', '--stat', '--patch', '--format=', h], r.fsPath).catch(() => ''); if (diff && diff.length < 12000 && msg?.trim()) { lines.push(JSON.stringify({ messages: [{ role: 'system', content: 'Write a commit message for this diff.' }, { role: 'user', content: diff }, { role: 'assistant', content: msg.trim() }] })); cm++; } }
		for (let i = lines.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [lines[i], lines[j]] = [lines[j], lines[i]]; }
		const cut = Math.max(1, Math.floor(lines.length * 0.95));
		fs.writeFileSync(path.join(out, 'train.jsonl'), lines.slice(0, cut).join('\n') + '\n'); fs.writeFileSync(path.join(out, 'valid.jsonl'), lines.slice(cut).join('\n') + '\n');
		const a = await vscode.window.showInformationMessage(`Training data: ${fim} completion + ${cm} commit-message examples → .axiora/finetune/train.jsonl, valid.jsonl. Review it for secrets before training.`, 'Open Folder', 'Launch LoRA Job...');
		if (a === 'Open Folder') { await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(path.join(out, 'train.jsonl'))); } if (a?.startsWith('Launch')) { await vscode.commands.executeCommand('axiora.finetune.launch'); }
	});
	register(ctx, 'axiora.finetune.launch', async () => {
		const r = wsRoot(); if (!r) { return; } const dir = path.join(r.fsPath, '.axiora', 'finetune');
		if (!fs.existsSync(path.join(dir, 'train.jsonl'))) { vscode.window.showWarningMessage('Run "Fine-tune: Export Training Data" first.'); return; }
		const b = await vscode.window.showQuickPick([
			{ label: 'Unsloth (NVIDIA GPU, Windows/Linux)', id: 'unsloth' }, { label: 'MLX-LM (Apple Silicon)', id: 'mlx' }, { label: 'Axolotl (NVIDIA GPU, config file)', id: 'axolotl' }], { placeHolder: 'LoRA backend (runs locally on your GPU; nothing is uploaded)' }); if (!b) { return; }
		const base = await vscode.window.showInputBox({ prompt: 'Base model (Hugging Face id)', value: b.id === 'mlx' ? 'mlx-community/Qwen2.5-Coder-1.5B-Instruct-4bit' : 'unsloth/Qwen2.5-Coder-1.5B-Instruct' }); if (!base) { return; }
		const t = vscode.window.createTerminal({ name: 'Fine-tune', cwd: dir }); t.show();
		if (b.id === 'mlx') { t.sendText(`pip install -U mlx-lm && mlx_lm.lora --model ${base} --train --data . --iters 600 --batch-size 2 --adapter-path adapters && mlx_lm.fuse --model ${base} --adapter-path adapters --save-path fused --export-gguf`); return; }
		if (b.id === 'axolotl') { fs.writeFileSync(path.join(dir, 'axolotl.yml'), `base_model: ${base}\nadapter: lora\nlora_r: 16\nlora_alpha: 32\nlora_target_linear: true\nload_in_4bit: true\ndatasets:\n  - path: train.jsonl\n    type: chat_template\nval_set_size: 0.05\nsequence_len: 4096\nmicro_batch_size: 2\ngradient_accumulation_steps: 4\nnum_epochs: 1\nlearning_rate: 0.0002\noutput_dir: ./lora-out\n`); t.sendText('pip install -U axolotl && axolotl train axolotl.yml'); return; }
		fs.writeFileSync(path.join(dir, 'train_unsloth.py'), `# Generated by Axiora — LoRA fine-tune with Unsloth (needs an NVIDIA GPU + CUDA)\nfrom unsloth import FastLanguageModel\nfrom datasets import load_dataset\nfrom trl import SFTTrainer, SFTConfig\nmodel, tok = FastLanguageModel.from_pretrained("${base}", max_seq_length=4096, load_in_4bit=True)\nmodel = FastLanguageModel.get_peft_model(model, r=16, lora_alpha=32, target_modules=["q_proj","k_proj","v_proj","o_proj","gate_proj","up_proj","down_proj"])\nds = load_dataset("json", data_files={"train": "train.jsonl", "validation": "valid.jsonl"})\nfmt = lambda b: {"text": [tok.apply_chat_template(m, tokenize=False) for m in b["messages"]]}\nds = ds.map(fmt, batched=True)\ntrainer = SFTTrainer(model=model, tokenizer=tok, train_dataset=ds["train"], eval_dataset=ds["validation"], args=SFTConfig(dataset_text_field="text", per_device_train_batch_size=2, gradient_accumulation_steps=4, num_train_epochs=1, learning_rate=2e-4, output_dir="out", logging_steps=10))\ntrainer.train()\nmodel.save_pretrained_gguf("gguf", tok, quantization_method="q4_k_m")\nprint("Done: gguf/ — run 'Fine-tune: Import into Ollama'")\n`);
		t.sendText('pip install -U unsloth trl datasets && python train_unsloth.py');
	});
	register(ctx, 'axiora.finetune.ollama', async () => {
		const g = await vscode.window.showOpenDialog({ filters: { GGUF: ['gguf'] }, defaultUri: wsRoot() && vscode.Uri.joinPath(wsRoot()!, '.axiora', 'finetune') }); if (!g) { return; }
		const name = await vscode.window.showInputBox({ prompt: 'Ollama model name', value: 'axiora-tuned' }); if (!name) { return; }
		const mf = path.join(path.dirname(g[0].fsPath), 'Modelfile'); fs.writeFileSync(mf, `FROM ${g[0].fsPath}\nPARAMETER temperature 0.2\n`);
		const t = vscode.window.createTerminal({ name: 'Ollama import' }); t.show(); t.sendText(`ollama create ${name} -f "${mf}"`);
		if (await vscode.window.showInformationMessage(`After import finishes, use "${name}" as the chat/completion model?`, 'Use It') === 'Use It') { await conf().update('axiora.ai.chatModel', name, vscode.ConfigurationTarget.Global); await conf().update('axiora.inlineCompletion.model', name, vscode.ConfigurationTarget.Global); }
	});
	// ---- #78 computer use (vision model drives mouse/keyboard; every action needs approval unless allowed for the run)
	register(ctx, 'axiora.computerUse.run', async () => {
		const goal = await vscode.window.showInputBox({ prompt: 'Computer-use goal (the agent sees your screen and asks before each action)', ignoreFocusOut: true }); if (!goal) { return; }
		const model = conf().get<string>('axiora.ai.visionModel', '') || undefined; let allowAll = false; const hist: string[] = [];
		await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Computer use', cancellable: true }, async (prog, tok) => {
			for (let step = 1; step <= 20 && !tok.isCancellationRequested; step++) {
				prog.report({ message: `step ${step}: looking at the screen…` });
				const png = path.join(os.tmpdir(), `axiora-screen-${Date.now()}.png`); await screenshot(png);
				const img = fs.readFileSync(png).toString('base64'); fs.rmSync(png, { force: true });
				const size = await screenSize();
				const reply = await chat([{ role: 'system', content: `You control a ${process.platform} computer to reach the user's goal. Screen is ${size.w}x${size.h} px. Reply with ONE JSON object only: {"action":"click","x":..,"y":..,"button":"left|right","double":false} | {"action":"type","text":".."} | {"action":"key","keys":"ctrl+s"} | {"action":"scroll","dy":-5} | {"action":"wait","ms":1000} | {"action":"done","summary":".."}. Add "why":"short reason".` }, { role: 'user', content: `Goal: ${goal}\nPrevious actions:\n${hist.join('\n') || '(none)'}`, images: [img] }], () => undefined, tok, model);
				let a: any; try { a = JSON.parse(/\{[\s\S]*\}/.exec(reply)?.[0] ?? ''); } catch { hist.push(`(unparseable reply)`); continue; }
				if (a.action === 'done') { vscode.window.showInformationMessage(`Computer use finished: ${a.summary ?? ''}`); return; }
				const desc = a.action === 'click' ? `${a.double ? 'double-' : ''}click (${a.x}, ${a.y})` : a.action === 'type' ? `type "${String(a.text).slice(0, 60)}"` : a.action === 'key' ? `press ${a.keys}` : a.action === 'scroll' ? `scroll ${a.dy}` : `wait ${a.ms}ms`;
				if (!allowAll) { const ok = await vscode.window.showWarningMessage(`Step ${step}: ${desc}\n${a.why ?? ''}`, { modal: true }, 'Allow', 'Allow All (this run)'); if (!ok) { return; } allowAll = ok.startsWith('Allow All'); }
				await act(a); hist.push(`${step}. ${desc}`); log.info(`[computer-use] ${desc}`); await new Promise(r => setTimeout(r, 800));
			}
		});
	});
	// ---- #194 remote / Wi-Fi devices
	register(ctx, 'axiora.device.remote', async () => {
		const adb = 'adb'; const c = await vscode.window.showQuickPick(['Enable Wi-Fi debugging on the USB device (adb tcpip 5555)', 'Connect to device at host:port...', 'Pair (Android 11+ wireless debugging)...', 'Stream remote device over SSH...']); if (!c) { return; }
		const t = (cmd: string) => { const x = vscode.window.createTerminal({ name: 'Remote device' }); x.show(); x.sendText(cmd); };
		if (c.startsWith('Enable')) { t(`${adb} tcpip 5555 && ${adb} shell ip route | awk '{print $9}'`); }
		if (c.startsWith('Connect')) { const h = await vscode.window.showInputBox({ prompt: 'host:port', value: '192.168.1.50:5555' }); if (h) { t(`${adb} connect ${h} && scrcpy -s ${h} --video-bit-rate 4M --max-size 1280`); } }
		if (c.startsWith('Pair')) { const h = await vscode.window.showInputBox({ prompt: 'Pairing host:port shown on the phone' }); if (h) { t(`${adb} pair ${h}`); } }
		if (c.startsWith('Stream')) { const h = await vscode.window.showInputBox({ prompt: 'SSH host with the device attached (user@host)' }); if (h) { t(`ssh -N -L 5037:localhost:5037 ${h} & sleep 3 && ADB_SERVER_SOCKET=tcp:localhost:5037 scrcpy --video-bit-rate 2M --max-size 1024`); } }
	});
	// ---- #107 APK manifest via aapt2/apkanalyzer
	register(ctx, 'axiora.apk.manifest', async (uri?: vscode.Uri) => {
		uri ??= (await vscode.window.showOpenDialog({ filters: { 'Android package': ['apk', 'aab'] } }))?.[0]; if (!uri) { return; }
		const home = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || path.join(os.homedir(), isMac ? 'Library/Android/sdk' : isWin ? 'AppData/Local/Android/Sdk' : 'Android/Sdk');
		const bt = path.join(home, 'build-tools'); const ver = fs.existsSync(bt) ? fs.readdirSync(bt).sort().pop() : undefined;
		const aapt2 = ver ? path.join(bt, ver, isWin ? 'aapt2.exe' : 'aapt2') : 'aapt2';
		let xml = '';
		if (uri.fsPath.endsWith('.aab')) { xml = await runOut('bundletool', ['dump', 'manifest', `--bundle=${uri.fsPath}`]).catch(e => `bundletool failed: ${e.message}`); }
		else { xml = await runOut(aapt2, ['dump', 'xmltree', uri.fsPath, '--file', 'AndroidManifest.xml']).catch(async e => (await runOut('apkanalyzer', ['manifest', 'print', uri!.fsPath]).catch(() => `aapt2/apkanalyzer not found (${e.message}). Install Android SDK build-tools or cmdline-tools.`))); }
		const doc = await vscode.workspace.openTextDocument({ content: xml, language: 'xml' }); await vscode.window.showTextDocument(doc, { preview: true });
	});
}
async function screenshot(file: string) {
	if (isMac) { await runOut('screencapture', ['-x', '-C', file]); return; }
	if (isWin) { await runOut('powershell', ['-NoProfile', '-Command', `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $i=New-Object System.Drawing.Bitmap $b.Width,$b.Height; $g=[System.Drawing.Graphics]::FromImage($i); $g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size); $i.Save('${file}')`]); return; }
	await runOut('bash', ['-lc', `command -v gnome-screenshot >/dev/null && gnome-screenshot -f "${file}" || import -window root "${file}" || ffmpeg -loglevel error -y -f x11grab -i "$DISPLAY" -frames:v 1 "${file}"`]);
}
async function screenSize(): Promise<{ w: number; h: number }> {
	try {
		const o = isWin ? await runOut('powershell', ['-NoProfile', '-Command', 'Add-Type -AssemblyName System.Windows.Forms; $b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; "$($b.Width)x$($b.Height)"']) : isMac ? await runOut('bash', ['-lc', "system_profiler SPDisplaysDataType | awk '/Resolution/{print $2\"x\"$4; exit}'"]) : await runOut('bash', ['-lc', "xdpyinfo | awk '/dimensions/{print $2; exit}'"]);
		const m = /(\d+)x(\d+)/.exec(o); if (m) { return { w: +m[1], h: +m[2] }; }
	} catch { /* */ }
	return { w: 1920, h: 1080 };
}
async function act(a: any) {
	const x = Math.round(a.x), y = Math.round(a.y);
	if (isWin) {
		const ps = (s: string) => runOut('powershell', ['-NoProfile', '-Command', `Add-Type -AssemblyName System.Windows.Forms; Add-Type -Namespace W -Name U -MemberDefinition '[DllImport("user32.dll")] public static extern void mouse_event(int f,int x,int y,int d,int e);'; ${s}`]);
		if (a.action === 'click') { const [d, u] = a.button === 'right' ? [8, 16] : [2, 4]; await ps(`[System.Windows.Forms.Cursor]::Position=New-Object System.Drawing.Point(${x},${y}); [W.U]::mouse_event(${d},0,0,0,0); [W.U]::mouse_event(${u},0,0,0,0)${a.double ? `; [W.U]::mouse_event(${d},0,0,0,0); [W.U]::mouse_event(${u},0,0,0,0)` : ''}`); }
		if (a.action === 'type') { await ps(`[System.Windows.Forms.SendKeys]::SendWait('${String(a.text).replace(/'/g, "''").replace(/[+^%~(){}[\]]/g, c => `{${c}}`)}')`); }
		if (a.action === 'key') { const map: Record<string, string> = { ctrl: '^', shift: '+', alt: '%', enter: '{ENTER}', tab: '{TAB}', esc: '{ESC}', escape: '{ESC}', backspace: '{BACKSPACE}', delete: '{DEL}', up: '{UP}', down: '{DOWN}', left: '{LEFT}', right: '{RIGHT}' }; await ps(`[System.Windows.Forms.SendKeys]::SendWait('${String(a.keys).toLowerCase().split('+').map(k => map[k] ?? k).join('')}')`); }
		if (a.action === 'scroll') { await ps(`[W.U]::mouse_event(0x0800,0,0,${-Math.round(a.dy) * 120},0)`); }
	} else if (isMac) {
		if (a.action === 'click') { await runOut('cliclick', [`${a.double ? 'dc' : a.button === 'right' ? 'rc' : 'c'}:${x},${y}`]); }
		if (a.action === 'type') { await runOut('osascript', ['-e', `tell application "System Events" to keystroke ${JSON.stringify(String(a.text))}`]); }
		if (a.action === 'key') { const parts = String(a.keys).toLowerCase().split('+'); const k = parts.pop()!; const mods = parts.map(m => ({ ctrl: 'control down', cmd: 'command down', shift: 'shift down', alt: 'option down' } as any)[m]).filter(Boolean); const codes: Record<string, number> = { enter: 36, tab: 48, esc: 53, escape: 53, backspace: 51, up: 126, down: 125, left: 123, right: 124 }; await runOut('osascript', ['-e', `tell application "System Events" to ${codes[k] !== undefined ? `key code ${codes[k]}` : `keystroke "${k}"`}${mods.length ? ` using {${mods.join(', ')}}` : ''}`]); }
		if (a.action === 'scroll') { await runOut('cliclick', [`w:${Math.round(a.dy)}`]).catch(() => undefined); }
	} else {
		if (a.action === 'click') { await runOut('xdotool', ['mousemove', String(x), String(y), 'click', ...(a.double ? ['--repeat', '2'] : []), a.button === 'right' ? '3' : '1']); }
		if (a.action === 'type') { await runOut('xdotool', ['type', '--delay', '20', String(a.text)]); }
		if (a.action === 'key') { await runOut('xdotool', ['key', String(a.keys).replace(/\benter\b/i, 'Return').replace(/\besc(ape)?\b/i, 'Escape')]); }
		if (a.action === 'scroll') { await runOut('xdotool', ['click', '--repeat', String(Math.abs(Math.round(a.dy))), a.dy < 0 ? '4' : '5']); }
	}
	if (a.action === 'wait') { await new Promise(r => setTimeout(r, Math.min(10000, +a.ms || 1000))); }
}
