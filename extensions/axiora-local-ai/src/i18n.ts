/*---------------------------------------------------------------------------------------------
 *  Axiora: runtime localization for button labels and quick-pick item labels.
 *  Messages are wrapped with vscode.l10n.t at the call site; buttons/labels are often compared
 *  by their English text afterwards, so they are translated here and mapped back to the original
 *  value before being returned to the caller.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';

const tr = (s: string) => { try { return vscode.l10n.t(s); } catch { return s; } };

export function isArabicUi(): boolean { return vscode.env.language.toLowerCase().startsWith('ar'); }

/** `dir` attribute value for webview <html> elements. */
export function htmlDir(): string { return isArabicUi() ? 'rtl' : 'ltr'; }
export function htmlLang(): string { return isArabicUi() ? 'ar' : 'en'; }

export function installRuntimeL10n(): void {
	if (!vscode.l10n.bundle) { return; } // English UI: nothing to translate
	const w = vscode.window as any;
	for (const name of ['showInformationMessage', 'showWarningMessage', 'showErrorMessage']) {
		const orig = w[name]?.bind(vscode.window); if (!orig) { continue; }
		try {
			w[name] = (msg: string, ...rest: any[]) => {
				const map = new Map<any, any>();
				const items = rest.map(r => {
					if (typeof r === 'string') { const t = tr(r); map.set(t, r); return t; }
					if (r && typeof r === 'object' && typeof r.title === 'string' && !('modal' in r) && !('detail' in r)) { const c = { ...r, title: tr(r.title) }; map.set(c, r); return c; }
					return r;
				});
				return Promise.resolve(orig(typeof msg === 'string' ? tr(msg) : msg, ...items)).then((res: any) => res === undefined ? res : (map.has(res) ? map.get(res) : res));
			};
		} catch { /* API object not writable: leave English buttons */ }
	}
	const qp = w.showQuickPick?.bind(vscode.window);
	if (qp) {
		try {
			w.showQuickPick = (items: any, opts?: any, token?: any) => {
				const map = new Map<any, any>();
				const conv = (arr: any[]) => arr.map(i => {
					if (typeof i === 'string') { const t = tr(i); map.set(t, i); return t; }
					if (i && typeof i === 'object' && typeof i.label === 'string') { const c = { ...i, label: tr(i.label), description: typeof i.description === 'string' ? tr(i.description) : i.description, detail: typeof i.detail === 'string' ? tr(i.detail) : i.detail }; map.set(c, i); return c; }
					return i;
				});
				const o = opts && typeof opts === 'object' ? { ...opts, placeHolder: typeof opts.placeHolder === 'string' ? tr(opts.placeHolder) : opts.placeHolder, title: typeof opts.title === 'string' ? tr(opts.title) : opts.title } : opts;
				const conved = Array.isArray(items) ? conv(items) : Promise.resolve(items).then(conv);
				return Promise.resolve(qp(conved, o, token)).then((res: any) => Array.isArray(res) ? res.map(r => map.get(r) ?? r) : (res === undefined ? res : (map.get(res) ?? res)));
			};
		} catch { /* ignore */ }
	}
}

/** Builds a `const L=...` script snippet translating the given English strings inside a webview. */
export function webviewL10n(strings: string[]): string {
	const m: Record<string, string> = {}; for (const s of strings) { m[s] = tr(s); }
	return `const __T=${JSON.stringify(m).replace(/</g, '\\u003c')};const L=s=>__T[s]||s;`;
}

/** Spoken language for dictation: `axiora.voice.language` = auto | ar | en. `auto` lets a multilingual Whisper model detect it. */
export function voiceLanguage(): string | undefined {
	const v = vscode.workspace.getConfiguration('axiora.voice').get<string>('language', 'auto');
	return v === 'ar' || v === 'en' ? v : undefined;
}

/** Language rule appended to every system prompt (`axiora.chat.responseLanguage` = auto | ar | en). */
export function languageRule(): string {
	const pref = vscode.workspace.getConfiguration('axiora.chat').get<string>('responseLanguage', 'auto');
	const ui = isArabicUi() ? 'Arabic' : 'English';
	const reply = pref === 'ar' ? 'Always write your conversational replies to the user in Arabic (Modern Standard Arabic).'
		: pref === 'en' ? 'Always write your conversational replies to the user in English.'
			: `Reply in the same language as the user's latest message (Arabic if they write Arabic, English if they write English); if it is unclear, use ${ui}.`;
	return `${reply} Code rule: everything you write into code and files must be in English — source code, identifiers, file and folder names, file contents, code comments, docstrings, log messages, test names and commit messages — even when the conversation is in Arabic. Use Arabic only for conversational explanations to the user (and only translate user-facing UI strings when explicitly asked).`;
}
