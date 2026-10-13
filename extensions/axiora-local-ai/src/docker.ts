/*---------------------------------------------------------------------------------------------
 *  Docker tools via the docker CLI: containers / images / compose, with actions.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { register, run, wsRoot } from './util';

async function docker(args: string[]): Promise<string> {
	try { return await run('docker', args, wsRoot()?.fsPath ?? process.cwd()); }
	catch (e) { const m = (e as Error).message; throw new Error(/ENOENT/.test(m) ? 'Docker CLI not found. Install Docker to use these tools.' : m); }
}
function term(name: string, cmd: string) { const t = vscode.window.createTerminal(name); t.show(); t.sendText(cmd); }
export function activate(ctx: vscode.ExtensionContext) {
	register(ctx, 'axiora.docker.containers', async () => {
		const out = await docker(['ps', '-a', '--format', '{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}']);
		const items = out.trim().split('\n').filter(Boolean).map(l => { const [id, name, image, st] = l.split('\t'); return { label: `${st.startsWith('Up') ? '$(vm-running)' : '$(vm-outline)'} ${name}`, description: image, detail: st, id, name, up: st.startsWith('Up') }; });
		const p = await vscode.window.showQuickPick(items, { placeHolder: items.length ? 'Containers' : 'No containers' }); if (!p) { return; }
		const actions = p.up ? ['Logs (follow)', 'Open Shell', 'Restart', 'Stop', 'Inspect'] : ['Start', 'Remove', 'Logs', 'Inspect'];
		const a = await vscode.window.showQuickPick(actions, { placeHolder: p.name }); if (!a) { return; }
		switch (a) {
			case 'Logs (follow)': term(`logs: ${p.name}`, `docker logs -f --tail 200 ${p.id}`); break;
			case 'Logs': term(`logs: ${p.name}`, `docker logs --tail 200 ${p.id}`); break;
			case 'Open Shell': term(`shell: ${p.name}`, `docker exec -it ${p.id} sh -c "command -v bash >/dev/null && exec bash || exec sh"`); break;
			case 'Inspect': await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ language: 'json', content: await docker(['inspect', p.id]) })); break;
			default: await docker([{ Start: 'start', Stop: 'stop', Restart: 'restart', Remove: 'rm' }[a]!, p.id]); vscode.window.showInformationMessage(`${a}: ${p.name}`);
		}
	});
	register(ctx, 'axiora.docker.images', async () => {
		const out = await docker(['images', '--format', '{{.Repository}}:{{.Tag}}\t{{.ID}}\t{{.Size}}']);
		const p = await vscode.window.showQuickPick(out.trim().split('\n').filter(Boolean).map(l => { const [ref, id, size] = l.split('\t'); return { label: `$(package) ${ref}`, description: size, ref, id }; }), { placeHolder: 'Images' }); if (!p) { return; }
		const a = await vscode.window.showQuickPick(['Run (interactive)', 'Run (detached)', 'Remove', 'Inspect']); if (!a) { return; }
		if (a.startsWith('Run')) { term(`run: ${p.ref}`, `docker run ${a.includes('inter') ? '-it --rm' : '-d'} ${p.ref}`); }
		else if (a === 'Remove') { await docker(['rmi', p.id]); }
		else { await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ language: 'json', content: await docker(['inspect', p.id]) })); }
	});
	register(ctx, 'axiora.docker.build', async (uri?: vscode.Uri) => {
		const f = uri ?? vscode.window.activeTextEditor?.document.uri; if (!f) { return; }
		const tag = await vscode.window.showInputBox({ prompt: 'Image tag', value: `${(wsRoot()?.path.split('/').pop() ?? 'app').toLowerCase()}:latest` }); if (!tag) { return; }
		term('docker build', `docker build -f "${f.fsPath}" -t ${tag} "${vscode.Uri.joinPath(f, '..').fsPath}"`);
	});
	register(ctx, 'axiora.docker.composeUp', (uri?: vscode.Uri) => { const f = uri ?? vscode.window.activeTextEditor?.document.uri; if (f) { term('compose', `docker compose -f "${f.fsPath}" up -d`); } });
	register(ctx, 'axiora.docker.composeDown', (uri?: vscode.Uri) => { const f = uri ?? vscode.window.activeTextEditor?.document.uri; if (f) { term('compose', `docker compose -f "${f.fsPath}" down`); } });
}
