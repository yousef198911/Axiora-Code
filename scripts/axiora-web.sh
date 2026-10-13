#!/usr/bin/env bash
# Axiora-Code for the browser (self-hosted, no paid infra). Written, untested on the build box.
#   ./scripts/axiora-web.sh dev        → compile + serve the dev web build on http://localhost:8080
#   ./scripts/axiora-web.sh build      → minified static web build in ../vscode-web (serve with any static server)
#   ./scripts/axiora-web.sh server     → one shared server, many windows/clients (browser tabs or other PCs) with a connection token
#   ./scripts/axiora-web.sh serve DIR  → serve a built folder with COOP/COEP headers (needed for web workers)
# Notes: extensions that need Node (terminal, LSP binaries, runner, docker…) are disabled in the browser;
# the Axiora AI extension's web-safe parts use fetch() against your model endpoint (enable CORS on it,
# e.g. OLLAMA_ORIGINS=* for Ollama).
set -euo pipefail
cd "$(dirname "$0")/.."
case "${1:-dev}" in
  dev)   npm run compile-web && ./scripts/code-web.sh --host 0.0.0.0 --port "${PORT:-8080}" --browserType none ;;
  server) TOKEN="${AXIORA_SERVER_TOKEN:-$(node -e 'console.log(require("crypto").randomBytes(16).toString("hex"))')}"; echo "Open http://<this-host>:${PORT:-8000}/?tkn=$TOKEN in any number of windows / machines"; ./scripts/code-server.sh --host 0.0.0.0 --port "${PORT:-8000}" --connection-token "$TOKEN" --accept-server-license-terms ;;
  build) npm run gulp vscode-web-min && echo "Built: $(cd .. && pwd)/vscode-web" ;;
  serve) DIR="${2:-../vscode-web}"; node -e '
const http=require("http"),fs=require("fs"),p=require("path");const root=p.resolve(process.argv[1]);
const T={".html":"text/html",".js":"text/javascript",".css":"text/css",".json":"application/json",".svg":"image/svg+xml",".png":"image/png",".wasm":"application/wasm",".ttf":"font/ttf",".woff2":"font/woff2"};
http.createServer((q,r)=>{let f=p.join(root,decodeURIComponent(new URL(q.url,"http://x").pathname));if(!f.startsWith(root))return r.writeHead(403).end();if(fs.existsSync(f)&&fs.statSync(f).isDirectory())f=p.join(f,"index.html");
fs.readFile(f,(e,b)=>{if(e)return r.writeHead(404).end();r.writeHead(200,{"content-type":T[p.extname(f)]||"application/octet-stream","cross-origin-opener-policy":"same-origin","cross-origin-embedder-policy":"require-corp"});r.end(b)})}).listen(+process.env.PORT||8080,()=>console.log("Serving",root))' "$DIR" ;;
  *) echo "usage: $0 dev|server|build|serve [dir]"; exit 1 ;;
esac
