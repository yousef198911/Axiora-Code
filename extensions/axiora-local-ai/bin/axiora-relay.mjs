#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Axiora collaboration relay — tiny self-hosted fan-out server (no accounts, no storage).
 *  Clients end-to-end encrypt every message (AES-GCM, key in the invite link fragment), so the
 *  relay only ever sees opaque ciphertext. Run on any box both peers can reach:
 *     node axiora-relay.mjs --port 7790          (put TLS in front, e.g. caddy, for internet use)
 *  GET /r/:room/events?peer=ID  (SSE)   ·   POST /r/:room  {peer, data}   ·   GET /health
 *--------------------------------------------------------------------------------------------*/
import http from 'node:http';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const PORT = +arg('--port', process.env.AXIORA_RELAY_PORT || 7790);
const rooms = new Map(); // room -> Map(peer -> res)
const MAX = 1 << 20;
http.createServer((req, res) => {
	const u = new URL(req.url, 'http://x'); const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type' };
	if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
	if (u.pathname === '/health') { res.writeHead(200, { ...cors, 'content-type': 'application/json' }); return res.end(JSON.stringify({ rooms: rooms.size, peers: [...rooms.values()].reduce((a, m) => a + m.size, 0) })); }
	const m = /^\/r\/([\w-]{8,64})(\/events)?$/.exec(u.pathname); if (!m) { res.writeHead(404, cors); return res.end(); }
	const room = rooms.get(m[1]) ?? new Map(); rooms.set(m[1], room);
	if (m[2] && req.method === 'GET') {
		const peer = (u.searchParams.get('peer') || Math.random().toString(36).slice(2)).slice(0, 40);
		res.writeHead(200, { ...cors, 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' }); res.write(`event: hello\ndata: ${JSON.stringify({ peers: [...room.keys()] })}\n\n`);
		for (const r of room.values()) { r.write(`event: join\ndata: ${JSON.stringify({ peer })}\n\n`); }
		room.set(peer, res); const ka = setInterval(() => res.write(': ka\n\n'), 25000);
		req.on('close', () => { clearInterval(ka); room.delete(peer); for (const r of room.values()) { r.write(`event: leave\ndata: ${JSON.stringify({ peer })}\n\n`); } if (!room.size) { rooms.delete(m[1]); } });
		return;
	}
	if (!m[2] && req.method === 'POST') {
		let s = ''; req.on('data', d => { s += d; if (s.length > MAX) { req.destroy(); } });
		req.on('end', () => { let b; try { b = JSON.parse(s); } catch { res.writeHead(400, cors); return res.end(); } const line = `data: ${JSON.stringify({ peer: b.peer, data: b.data })}\n\n`; for (const [p, r] of room) { if (p !== b.peer) { r.write(line); } } res.writeHead(204, cors); res.end(); });
		return;
	}
	res.writeHead(405, cors); res.end();
}).listen(PORT, process.env.AXIORA_RELAY_HOST || '0.0.0.0', () => console.log(`Axiora relay on :${PORT}`));
