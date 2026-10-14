/*---------------------------------------------------------------------------------------------
 *  Clean model output for inline (ghost text) completion: remove repeated chunks
 *  ("return a + b;return a + b;"), text the model echoed from before the cursor, and text that
 *  already exists after the cursor.
 *--------------------------------------------------------------------------------------------*/
export function cleanCompletion(text: string, prefix: string, suffix: string): string {
	let t = text.replace(/\r/g, '');
	// 1. whole-output repetition: X X X… (optionally ending in a partial X)
	for (let L = 4; L <= t.length / 2; L++) {
		const x = t.slice(0, L); let i = L;
		while (t.startsWith(x, i)) { i += L; }
		if (i > L && (i === t.length || x.startsWith(t.slice(i)))) { t = x; break; }
	}
	for (let L = 6; L <= t.length - 6; L++) { const x = t.slice(0, L); if (/[;})\]]$/.test(x) && x.startsWith(t.slice(L))) { t = x; break; } }
	// 2. consecutive duplicate lines
	t = t.split('\n').filter((l, i, a) => !(i > 0 && l.trim() && l.trim() === a[i - 1].trim())).join('\n');
	// 3. echo of the text before the cursor
	const cur = prefix.slice(prefix.lastIndexOf('\n') + 1);
	if (cur.trim() && t.trimStart().startsWith(cur.trim()) && t.trimStart().length > cur.trim().length) { t = t.trimStart().slice(cur.trim().length); }
	else { for (let k = Math.min(cur.length, t.length); k >= 4; k--) { if (cur.endsWith(t.slice(0, k))) { t = t.slice(k); break; } } }
	// 3b. model repeated the last word before the cursor ("return a " + "a + b")
	const lastTok = /([A-Za-z_$][\w$]*)\s*$/.exec(cur)?.[1];
	if (lastTok && new RegExp(`^${lastTok.replace(/\$/g, '\\$')}(?![\\w$])`).test(t.trimStart()) && /^\s*[^\w$\s]/.test(t.trimStart().slice(lastTok.length))) { t = t.trimStart().slice(lastTok.length).replace(/^\s+/, cur.endsWith(' ') ? '' : ' '); }
	// 4a. trailing lines that already exist right below the cursor (e.g. a closing "}")
	const below = suffix.split('\n').slice(1).map(l => l.trim()).filter(Boolean);
	const gl = t.split('\n');
	for (let k = gl.length - 1; k >= 1; k--) { if (gl.slice(-k).every((l, i) => l.trim() === below[i])) { t = gl.slice(0, gl.length - k).join('\n'); break; } }
	// 4. text that already follows the cursor
	const rest = suffix.slice(0, (suffix.indexOf('\n') + 1 || suffix.length + 1) - 1);
	if (rest.trim() && t.endsWith(rest.trim())) { t = t.slice(0, t.length - rest.trim().length); }
	else { const s = suffix.trimStart(); for (let k = Math.min(s.length, t.length); k >= 3; k--) { if (t.endsWith(s.slice(0, k))) { t = t.slice(0, t.length - k); break; } } }
	const nextLine = suffix.split('\n').map(l => l.trim()).find(Boolean);
	if (nextLine && t.trim() === nextLine) { return ''; }
	// a repeated statement at the end that equals the first statement (e.g. "x;\nx;")
	return t.replace(/\s+$/, '');
}
