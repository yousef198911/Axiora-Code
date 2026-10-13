/*---------------------------------------------------------------------------------------------
 *  Voice output (TTS), image generation, screen capture.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { aiEndpoint } from './llm';
import { log, wsRoot } from './util';

let secrets: vscode.SecretStorage;
export function initMedia(s: vscode.SecretStorage) { secrets = s; }
const has = (b: string) => { try { cp.execFileSync(process.platform === 'win32' ? 'where' : 'which', [b], { stdio: 'ignore' }); return true; } catch { return false; } };

// ---------------------------------------------------------------- TTS
let speaking: cp.ChildProcess | undefined;
export function plainForSpeech(md: string): string {
	return md.replace(/```[\s\S]*?```/g, ' (code omitted) ').replace(/`([^`]+)`/g, '$1').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/^#+\s*/gm, '').replace(/[*_>|~]/g, '').replace(/\n{2,}/g, '. ').replace(/\s+/g, ' ').trim().slice(0, 6000);
}
export function stopSpeaking() { if (speaking && speaking.exitCode === null) { speaking.kill(); } speaking = undefined; }
export async function speak(text: string): Promise<void> {
	stopSpeaking(); const t = plainForSpeech(text); if (!t) { return; }
	const c = vscode.workspace.getConfiguration('axiora.voice.tts');
	if (c.get<string>('provider', 'os') === 'openai') {
		const ep = await aiEndpoint(); const base = (c.get<string>('baseUrl', '') || ep.baseUrl).replace(/\/+$/, ''); const key = await secrets.get('axiora.voice.ttsApiKey');
		const r = await fetch(`${base}/audio/speech`, { method: 'POST', headers: { ...ep.headers, ...(key ? { authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify({ model: c.get('model', 'gpt-4o-mini-tts'), voice: c.get('voice', 'alloy'), input: t, response_format: 'mp3' }) });
		if (!r.ok) { throw new Error(`TTS ${r.status}: ${(await r.text()).slice(0, 200)}`); }
		const f = path.join(os.tmpdir(), `axiora-tts-${Date.now()}.mp3`); fs.writeFileSync(f, Buffer.from(await r.arrayBuffer()));
		speaking = process.platform === 'win32' ? cp.spawn('powershell', ['-NoProfile', '-Command', `Add-Type -AssemblyName presentationCore; $p=New-Object System.Windows.Media.MediaPlayer; $p.Open([uri]'${f}'); $p.Play(); Start-Sleep -Milliseconds 500; while($p.Position -lt $p.NaturalDuration.TimeSpan){Start-Sleep -Milliseconds 200}`])
			: process.platform === 'darwin' ? cp.spawn('afplay', [f]) : cp.spawn(['mpg123', 'ffplay', 'mpv', 'paplay'].find(has) ?? 'ffplay', has('ffplay') && !has('mpg123') ? ['-nodisp', '-autoexit', f] : [f]);
		return;
	}
	const rate = c.get<number>('rate', 0); const voice = c.get<string>('osVoice', '');
	const f = path.join(os.tmpdir(), 'axiora-tts.txt'); fs.writeFileSync(f, t);
	if (process.platform === 'win32') {
		speaking = cp.spawn('powershell', ['-NoProfile', '-Command', `Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Rate=${Math.max(-10, Math.min(10, rate))}; ${voice ? `$s.SelectVoice('${voice.replace(/'/g, '')}');` : ''} $s.Speak([IO.File]::ReadAllText('${f}'))`]);
	} else if (process.platform === 'darwin') {
		speaking = cp.spawn('say', [...(voice ? ['-v', voice] : []), ...(rate ? ['-r', String(175 + rate * 20)] : []), '-f', f]);
	} else {
		const b = ['spd-say', 'espeak-ng', 'espeak'].find(has); if (!b) { throw new Error('No speech engine found. Install speech-dispatcher or espeak-ng (sudo apt install espeak-ng), or set axiora.voice.tts.provider to "openai".'); }
		speaking = b === 'spd-say' ? cp.spawn(b, ['-w', '-r', String(rate * 10), t.slice(0, 3000)]) : cp.spawn(b, [...(voice ? ['-v', voice] : []), '-s', String(170 + rate * 15), '-f', f]);
	}
	speaking.on('error', e => log.warn(`tts: ${e.message}`));
}

// ---------------------------------------------------------------- image generation
export async function generateImage(prompt: string, size = '1024x1024'): Promise<string> {
	const c = vscode.workspace.getConfiguration('axiora.image'); const ep = await aiEndpoint();
	const base = (c.get<string>('baseUrl', '') || ep.baseUrl).replace(/\/+$/, ''); const key = await secrets.get('axiora.image.apiKey');
	const h = { ...ep.headers, ...(key ? { authorization: `Bearer ${key}` } : {}) };
	const model = c.get<string>('model', 'google/gemini-2.5-flash-image');
	let b64 = '';
	if (c.get<string>('api', 'auto') === 'chat' || (c.get<string>('api', 'auto') === 'auto' && base.includes('openrouter.ai'))) {
		const r = await fetch(`${base}/chat/completions`, { method: 'POST', headers: h, body: JSON.stringify({ model, modalities: ['image', 'text'], messages: [{ role: 'user', content: `Generate an image: ${prompt}` }] }) });
		const tx = await r.text(); let j: any; try { j = JSON.parse(tx); } catch { throw new Error(`Image endpoint returned ${r.status} (not JSON).`); } if (!r.ok || j.error) { throw new Error(`Image ${r.status}: ${j.error?.message ?? JSON.stringify(j).slice(0, 200)}`); }
		const url: string = j.choices?.[0]?.message?.images?.[0]?.image_url?.url ?? ''; if (!url) { throw new Error(`Model ${model} returned no image (${String(j.choices?.[0]?.message?.content ?? '').slice(0, 120)}). Pick an image-output model in axiora.image.model.`); }
		b64 = url.startsWith('data:') ? url.split(',')[1] : Buffer.from(await (await fetch(url)).arrayBuffer()).toString('base64');
	} else {
		const r = await fetch(`${base}/images/generations`, { method: 'POST', headers: h, body: JSON.stringify({ model, prompt, size, n: 1, response_format: 'b64_json' }) });
		const tx = await r.text(); let j: any; try { j = JSON.parse(tx); } catch { throw new Error(`Image endpoint ${base}/images/generations returned ${r.status} (not JSON). Check axiora.image.baseUrl / axiora.image.api.`); } if (!r.ok) { throw new Error(`Image ${r.status}: ${j.error?.message ?? JSON.stringify(j).slice(0, 200)}`); }
		b64 = j.data?.[0]?.b64_json ?? (j.data?.[0]?.url ? Buffer.from(await (await fetch(j.data[0].url)).arrayBuffer()).toString('base64') : '');
	}
	if (!b64) { throw new Error('No image data returned'); }
	const dir = path.join(wsRoot()?.fsPath ?? os.tmpdir(), c.get<string>('folder', '.axiora/images')); fs.mkdirSync(dir, { recursive: true });
	const buf = Buffer.from(b64, 'base64'); const ext = buf[0] === 0xff ? 'jpg' : buf[0] === 0x52 ? 'webp' : 'png';
	const f = path.join(dir, `${prompt.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40).replace(/^-|-$/g, '') || 'image'}-${Date.now()}.${ext}`); fs.writeFileSync(f, buf);
	return f;
}

// ---------------------------------------------------------------- screen capture
export async function captureScreen(what: 'window' | 'screen' = 'window'): Promise<string> {
	const dir = path.join(wsRoot()?.fsPath ?? os.tmpdir(), '.axiora', 'shots'); fs.mkdirSync(dir, { recursive: true });
	const f = path.join(dir, `${what}-${new Date().toISOString().replace(/[:.]/g, '-')}.png`);
	const run = (c: string, a: string[]) => new Promise<void>((res, rej) => cp.execFile(c, a, { timeout: 20000 }, e => e ? rej(e) : res()));
	if (process.platform === 'win32') {
		await run('powershell', ['-NoProfile', '-Command', `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; ${what === 'window' ? `Add-Type 'using System;using System.Runtime.InteropServices;public class W{[DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();[DllImport("user32.dll")]public static extern bool GetWindowRect(IntPtr h,out R r);public struct R{public int L,T,Ri,B;}}'; $r=New-Object W+R; [W]::GetWindowRect([W]::GetForegroundWindow(),[ref]$r)|Out-Null; $x=$r.L;$y=$r.T;$w=$r.Ri-$r.L;$h=$r.B-$r.T` : '$b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $x=$b.X;$y=$b.Y;$w=$b.Width;$h=$b.Height'}; $bmp=New-Object System.Drawing.Bitmap $w,$h; $g=[System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($x,$y,0,0,$bmp.Size); $bmp.Save('${f}',[System.Drawing.Imaging.ImageFormat]::Png)`]);
	} else if (process.platform === 'darwin') {
		await run('screencapture', ['-x', ...(what === 'window' ? ['-o', '-l', String(await new Promise<string>(res => cp.execFile('osascript', ['-e', 'tell application "System Events" to get unix id of first process whose frontmost is true'], (_e, o) => res(o.trim())))) ] : []), f]).catch(() => run('screencapture', ['-x', f]));
	} else {
		const win = what === 'window' && has('xdotool') ? await new Promise<string>(res => cp.execFile('xdotool', ['getactivewindow'], (_e, o) => res(o.trim()))) : '';
		if (has('import')) { await run('import', ['-window', win || 'root', f]); }
		else if (has('gnome-screenshot')) { await run('gnome-screenshot', [...(what === 'window' ? ['-w'] : []), '-f', f]); }
		else if (has('grim')) { await run('grim', [f]); }
		else if (has('scrot')) { await run('scrot', [...(what === 'window' ? ['-u'] : []), f]); }
		else if (has('spectacle')) { await run('spectacle', ['-b', '-n', what === 'window' ? '-a' : '-f', '-o', f]); }
		else if (has('ffmpeg') && process.env.DISPLAY) {
			let geo: string[] = [];
			if (win) { const g = await new Promise<string>(res => cp.execFile('xdotool', ['getwindowgeometry', '--shell', win], (_e, o) => res(o))); const v = Object.fromEntries(g.trim().split('\n').map(l => l.split('='))); if (v.WIDTH) { geo = ['-video_size', `${v.WIDTH}x${v.HEIGHT}`, '-i', `${process.env.DISPLAY}+${v.X},${v.Y}`]; } }
			await run('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'x11grab', ...(geo.length ? geo : ['-i', process.env.DISPLAY]), '-frames:v', '1', f]);
		}
		else { throw new Error('No screenshot tool found (install ImageMagick, gnome-screenshot, grim, scrot or ffmpeg).'); }
	}
	if (!fs.existsSync(f)) { throw new Error('Screenshot failed'); }
	return f;
}
/** Markdown that renders an image inline in chat (local file URIs are allowed by the chat renderer). */
export function inlineImage(file: string, alt = 'screenshot', width = 640): vscode.MarkdownString {
	return new vscode.MarkdownString(`![${alt}](${vscode.Uri.file(file).toString()}|width=${width})\n\n`);
}
