/*---------------------------------------------------------------------------------------------
 *  Office files (xlsx / docx / pptx / pdf) + chart images, pure JS (exceljs, docx, pptxgenjs, pdf-lib).
 *  Spec (JSON) shared by all formats:
 *  { "title": "...", "blocks": [ {"heading":"..", "level":1} | {"text":".."} | {"bullets":[".."]} | {"table":[["h1","h2"],["a","b"]]}
 *                                | {"chart":{"type":"bar|line|pie","title":"..","labels":[..],"series":[{"name":"..","values":[..]}]}} | {"image":"path.png"} | {"pageBreak":true} ],
 *    "sheets": [ {"name":"..","rows":[[..]] } ],              // xlsx (blocks tables also become sheets)
 *    "slides": [ {"title":"..","bullets":[..],"chart":{..},"image":"..","notes":".."} ] }  // pptx (else derived from blocks)
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface Chart { type?: 'bar' | 'line' | 'pie'; title?: string; labels: string[]; series: { name: string; values: number[] }[] }
export type Block = { heading?: string; level?: number; text?: string; bullets?: string[]; table?: (string | number)[][]; chart?: Chart; image?: string; pageBreak?: boolean };
export interface DocSpec { title?: string; blocks?: Block[]; sheets?: { name: string; rows: (string | number)[][] }[]; slides?: { title?: string; bullets?: string[]; chart?: Chart; image?: string; notes?: string; table?: (string | number)[][] }[] }
const COLORS = ['#3b82f6', '#f97316', '#10b981', '#a855f7', '#ef4444', '#eab308', '#06b6d4', '#ec4899'];
const x = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** Chart → standalone SVG (bar, line, pie). */
export function chartSvg(c: Chart, w = 800, h = 450): string {
	const t = c.type ?? 'bar'; const pad = { l: 60, r: 20, t: c.title ? 46 : 20, b: 70 };
	let g = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="Segoe UI, Helvetica, Arial, sans-serif"><rect width="100%" height="100%" fill="#fff"/>`;
	if (c.title) { g += `<text x="${w / 2}" y="28" text-anchor="middle" font-size="18" font-weight="600" fill="#222">${x(c.title)}</text>`; }
	if (t === 'pie') {
		const v = c.series[0]?.values ?? []; const tot = v.reduce((a, b) => a + Math.max(0, b), 0) || 1; const cx = w / 2 - 100, cy = (h + pad.t) / 2, r = Math.min(w, h - pad.t) / 2 - 30; let a0 = -Math.PI / 2;
		v.forEach((val, i) => { const a1 = a0 + (Math.max(0, val) / tot) * Math.PI * 2; const big = a1 - a0 > Math.PI ? 1 : 0; g += `<path d="M${cx},${cy} L${cx + r * Math.cos(a0)},${cy + r * Math.sin(a0)} A${r},${r} 0 ${big} 1 ${cx + r * Math.cos(a1)},${cy + r * Math.sin(a1)} Z" fill="${COLORS[i % 8]}" stroke="#fff" stroke-width="2"/>`; g += `<rect x="${cx + r + 40}" y="${pad.t + 10 + i * 24}" width="14" height="14" fill="${COLORS[i % 8]}"/><text x="${cx + r + 60}" y="${pad.t + 22 + i * 24}" font-size="13" fill="#333">${x(c.labels[i])} (${Math.round(val / tot * 100)}%)</text>`; a0 = a1; });
		return g + '</svg>';
	}
	const all = c.series.flatMap(s => s.values); const mx = Math.max(0, ...all), mn = Math.min(0, ...all); const span = mx - mn || 1;
	const pw = w - pad.l - pad.r, ph = h - pad.t - pad.b; const Y = (v: number) => pad.t + ph - ((v - mn) / span) * ph; const n = c.labels.length || 1;
	for (let k = 0; k <= 5; k++) { const v = mn + span * k / 5; g += `<line x1="${pad.l}" x2="${w - pad.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="#e5e7eb"/><text x="${pad.l - 8}" y="${Y(v) + 4}" text-anchor="end" font-size="11" fill="#666">${+v.toFixed(2)}</text>`; }
	const bw = pw / n; c.labels.forEach((l, i) => { g += `<text x="${pad.l + bw * i + bw / 2}" y="${h - pad.b + 18}" text-anchor="middle" font-size="12" fill="#444">${x(l).slice(0, 14)}</text>`; });
	c.series.forEach((s, si) => {
		if (t === 'line') { g += `<polyline fill="none" stroke="${COLORS[si % 8]}" stroke-width="3" points="${s.values.map((v, i) => `${pad.l + bw * i + bw / 2},${Y(v)}`).join(' ')}"/>`; s.values.forEach((v, i) => { g += `<circle cx="${pad.l + bw * i + bw / 2}" cy="${Y(v)}" r="4" fill="${COLORS[si % 8]}"/>`; }); }
		else { const sw = bw * 0.8 / c.series.length; s.values.forEach((v, i) => { const y0 = Y(Math.max(0, v)), y1 = Y(Math.min(0, v)); g += `<rect x="${pad.l + bw * i + bw * 0.1 + sw * si}" y="${y0}" width="${sw - 2}" height="${Math.max(1, y1 - y0)}" fill="${COLORS[si % 8]}" rx="2"/>`; }); }
		g += `<rect x="${pad.l + si * 140}" y="${h - 26}" width="12" height="12" fill="${COLORS[si % 8]}"/><text x="${pad.l + si * 140 + 18}" y="${h - 16}" font-size="12" fill="#333">${x(s.name).slice(0, 18)}</text>`;
	});
	return g + '</svg>';
}
/** SVG → PNG via a short-lived webview canvas (works on every platform, no native deps). */
export async function svgToPng(svg: string, w = 800, h = 450): Promise<Buffer> {
	try {
		const { findBrowser } = await import('./browser'); const exe = findBrowser();
		if (exe) { const { chromium } = await import('playwright-core'); const b = await chromium.launch({ executablePath: exe, headless: true }); try { const pg = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 }); await pg.setContent(`<html><body style="margin:0">${svg}</body></html>`); return await pg.locator('svg').screenshot({ type: 'png' }); } finally { await b.close(); } }
	} catch { /* fall back to a webview canvas */ }
	const p = vscode.window.createWebviewPanel('axiora.raster', 'Rendering chart…', { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, { enableScripts: true });
	try {
		return await new Promise<Buffer>((res, rej) => {
			const to = setTimeout(() => rej(new Error('chart render timed out')), 15000);
			p.webview.onDidReceiveMessage(m => { clearTimeout(to); m.err ? rej(new Error(m.err)) : res(Buffer.from(m.png.split(',')[1], 'base64')); });
			p.webview.html = `<!doctype html><html><body><canvas id=c width=${w * 2} height=${h * 2}></canvas><script>const v=acquireVsCodeApi();const i=new Image();i.onload=()=>{const g=c.getContext('2d');g.drawImage(i,0,0,${w * 2},${h * 2});v.postMessage({png:c.toDataURL('image/png')})};i.onerror=()=>v.postMessage({err:'svg load failed'});i.src=URL.createObjectURL(new Blob([atob('${Buffer.from(svg).toString('base64')}')],{type:'image/svg+xml'}))</script></body></html>`;
		});
	} finally { p.dispose(); }
}
export async function writeChart(c: Chart, file: string): Promise<string[]> {
	const svg = chartSvg(c); const base = file.replace(/\.(png|svg)$/i, ''); fs.mkdirSync(path.dirname(base), { recursive: true });
	fs.writeFileSync(base + '.svg', svg); const out = [base + '.svg'];
	try { fs.writeFileSync(base + '.png', await svgToPng(svg)); out.unshift(base + '.png'); } catch (e) { vscode.window.showWarningMessage(vscode.l10n.t("PNG export failed (SVG saved): {0}", (e as Error).message)); }
	return out;
}
function slidesFrom(s: DocSpec) {
	if (s.slides?.length) { return s.slides; }
	const out: NonNullable<DocSpec['slides']> = []; let cur: NonNullable<DocSpec['slides']>[0] | undefined;
	for (const b of s.blocks ?? []) {
		if (b.heading) { cur = { title: b.heading, bullets: [] }; out.push(cur); continue; }
		cur ??= (out.push({ title: s.title, bullets: [] }), out[out.length - 1]);
		if (b.text) { cur.bullets!.push(b.text); } if (b.bullets) { cur.bullets!.push(...b.bullets); } if (b.chart) { cur.chart = b.chart; } if (b.image) { cur.image = b.image; } if (b.table) { cur.table = b.table; }
	}
	return out;
}
export async function makeDocument(kind: 'xlsx' | 'docx' | 'pptx' | 'pdf', spec: DocSpec, file: string): Promise<string> {
	fs.mkdirSync(path.dirname(file), { recursive: true }); const blocks = spec.blocks ?? [];
	const chartPng = async (c: Chart) => { try { return await svgToPng(chartSvg(c)); } catch (e) { vscode.window.showWarningMessage(vscode.l10n.t("Chart image skipped: {0}", (e as Error).message)); return undefined; } };
	if (kind === 'xlsx') {
		const ExcelJS = (await import('exceljs')).default; const wb = new ExcelJS.Workbook(); wb.creator = 'Axiora Code';
		const sheets = spec.sheets?.length ? spec.sheets : blocks.filter(b => b.table).map((b, i) => ({ name: `Table ${i + 1}`, rows: b.table! }));
		if (!sheets.length) { sheets.push({ name: 'Sheet1', rows: blocks.map(b => [b.heading ?? b.text ?? (b.bullets ?? []).join('; ')]) }); }
		for (const s of sheets) {
			const ws = wb.addWorksheet(s.name.slice(0, 31)); s.rows.forEach(r => ws.addRow(r.map(v => typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) ? +v : v)));
			ws.getRow(1).font = { bold: true }; ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } }; ws.views = [{ state: 'frozen', ySplit: 1 }];
			ws.columns.forEach(c => { let m = 8; c.eachCell?.(cell => { m = Math.max(m, String(cell.value ?? '').length + 2); }); c.width = Math.min(m, 60); });
		}
		for (const b of blocks.filter(b => b.chart)) { const png = await chartPng(b.chart!); if (png) { const ws = wb.addWorksheet((b.chart!.title ?? 'Chart').slice(0, 31)); const id = wb.addImage({ buffer: png as any, extension: 'png' }); ws.addImage(id, { tl: { col: 0, row: 0 }, ext: { width: 800, height: 450 } }); } }
		await wb.xlsx.writeFile(file);
	} else if (kind === 'docx') {
		const D = await import('docx'); const kids: any[] = [];
		if (spec.title) { kids.push(new D.Paragraph({ text: spec.title, heading: D.HeadingLevel.TITLE })); }
		for (const b of blocks) {
			if (b.heading) { kids.push(new D.Paragraph({ text: b.heading, heading: [D.HeadingLevel.HEADING_1, D.HeadingLevel.HEADING_2, D.HeadingLevel.HEADING_3][Math.min((b.level ?? 1) - 1, 2)] })); }
			if (b.text) { kids.push(new D.Paragraph({ children: [new D.TextRun(b.text)] })); }
			for (const t of b.bullets ?? []) { kids.push(new D.Paragraph({ text: t, bullet: { level: 0 } })); }
			if (b.table) { kids.push(new D.Table({ width: { size: 100, type: D.WidthType.PERCENTAGE }, rows: b.table.map((r, i) => new D.TableRow({ children: r.map(c => new D.TableCell({ children: [new D.Paragraph({ children: [new D.TextRun({ text: String(c), bold: i === 0 })] })] })) })) })); }
			const img = b.chart ? await chartPng(b.chart) : b.image && fs.existsSync(b.image) ? fs.readFileSync(b.image) : undefined;
			if (img) { kids.push(new D.Paragraph({ children: [new D.ImageRun({ data: img, type: 'png', transformation: { width: 600, height: 338 } })] })); }
			if (b.pageBreak) { kids.push(new D.Paragraph({ children: [new D.PageBreak()] })); }
		}
		fs.writeFileSync(file, await D.Packer.toBuffer(new D.Document({ creator: 'Axiora Code', title: spec.title, sections: [{ children: kids }] })));
	} else if (kind === 'pptx') {
		const P = (await import('pptxgenjs')).default; const pp = new P(); pp.layout = 'LAYOUT_WIDE'; pp.title = spec.title ?? '';
		if (spec.title) { const s = pp.addSlide(); s.background = { color: '1E293B' }; s.addText(spec.title, { x: 0.6, y: 2.6, w: 12, h: 1.4, fontSize: 40, bold: true, color: 'FFFFFF' }); }
		for (const sl of slidesFrom(spec)) {
			const s = pp.addSlide(); if (sl.title) { s.addText(sl.title, { x: 0.5, y: 0.3, w: 12.3, h: 0.9, fontSize: 28, bold: true, color: '1E293B' }); }
			const side = !!(sl.chart || sl.image || sl.table); const bw = side ? 6 : 12.3;
			if (sl.bullets?.length) { s.addText(sl.bullets.map(t => ({ text: t, options: { bullet: true, breakLine: true } })), { x: 0.5, y: 1.4, w: bw, h: 5.5, fontSize: 18, valign: 'top', color: '333333' }); }
			const X = sl.bullets?.length ? 6.8 : 0.8, W = sl.bullets?.length ? 6 : 11.7;
			if (sl.chart) { const t = sl.chart.type === 'line' ? pp.ChartType.line : sl.chart.type === 'pie' ? pp.ChartType.pie : pp.ChartType.bar; s.addChart(t, sl.chart.series.map(se => ({ name: se.name, labels: sl.chart!.labels, values: se.values })), { x: X, y: 1.4, w: W, h: 5.2, showLegend: true, showTitle: !!sl.chart.title, title: sl.chart.title }); }
			else if (sl.image && fs.existsSync(sl.image)) { s.addImage({ path: sl.image, x: X, y: 1.4, w: W, h: W * 9 / 16 }); }
			else if (sl.table) { s.addTable(sl.table.map((r, i) => r.map(c => ({ text: String(c), options: { bold: i === 0, fill: { color: i === 0 ? 'E5E7EB' : 'FFFFFF' } } }))), { x: X, y: 1.4, w: W, fontSize: 14, border: { type: 'solid', color: 'CCCCCC', pt: 1 } }); }
			if (sl.notes) { s.addNotes(sl.notes); }
		}
		await pp.writeFile({ fileName: file });
	} else {
		const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib'); const pdf = await PDFDocument.create(); pdf.setTitle(spec.title ?? ''); pdf.setCreator('Axiora Code');
		const font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
		let pg = pdf.addPage([595, 842]); let y = 790; const M = 50, W = 495;
		const ascii = (s: string) => s.replace(/[\u2018\u2019]/g, '\'').replace(/[\u201c\u201d]/g, '"').replace(/[\u2013\u2014]/g, '-').replace(/\u2022/g, '*').replace(/[^\x20-\x7e\xa0-\xff]/g, '?');
		const need = (h: number) => { if (y - h < 50) { pg = pdf.addPage([595, 842]); y = 790; } };
		const line = (s: string, size: number, f = font, ind = 0) => { const words = ascii(s).split(/\s+/); let cur = ''; const flush = () => { need(size + 6); pg.drawText(cur, { x: M + ind, y, size, font: f, color: rgb(0.13, 0.13, 0.13) }); y -= size + 6; cur = ''; }; for (const w of words) { const t = cur ? `${cur} ${w}` : w; if (f.widthOfTextAtSize(t, size) > W - ind && cur) { flush(); cur = w; } else { cur = t; } } if (cur) { flush(); } };
		if (spec.title) { line(spec.title, 24, bold); y -= 8; }
		for (const b of blocks) {
			if (b.heading) { y -= 6; line(b.heading, b.level === 2 ? 15 : b.level === 3 ? 13 : 18, bold); }
			if (b.text) { line(b.text, 11); y -= 4; }
			for (const t of b.bullets ?? []) { line(`•  ${t}`.replace('•', '-'), 11, font, 10); }
			if (b.table) { const cw = W / Math.max(1, b.table[0]?.length ?? 1); for (const [i, r] of b.table.entries()) { need(18); r.forEach((c, k) => pg.drawText(ascii(String(c)).slice(0, Math.floor(cw / 5.5)), { x: M + k * cw, y, size: 10, font: i === 0 ? bold : font })); pg.drawLine({ start: { x: M, y: y - 4 }, end: { x: M + W, y: y - 4 }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) }); y -= 18; } y -= 6; }
			const img = b.chart ? await chartPng(b.chart) : b.image && fs.existsSync(b.image) ? fs.readFileSync(b.image) : undefined;
			if (img) { const im = await pdf.embedPng(img); const h = W * im.height / im.width; need(h + 10); pg.drawImage(im, { x: M, y: y - h, width: W, height: h }); y -= h + 12; }
			if (b.pageBreak) { pg = pdf.addPage([595, 842]); y = 790; }
		}
		fs.writeFileSync(file, await pdf.save());
	}
	return file;
}
