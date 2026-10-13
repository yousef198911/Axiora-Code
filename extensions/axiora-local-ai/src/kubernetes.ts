/*---------------------------------------------------------------------------------------------
 *  Kubernetes tools via kubectl: contexts, namespaces, pods (logs/exec/describe/delete),
 *  deployments (scale/restart), apply/delete manifests.
 *--------------------------------------------------------------------------------------------*/
import { approve } from './approval';
import * as vscode from 'vscode';
import { register, run } from './util';

async function k(args: string[]): Promise<string> {
	try { return await run('kubectl', args, process.cwd()); }
	catch (e) { const m = (e as Error).message; throw new Error(/ENOENT/.test(m) ? 'kubectl not found. Install kubectl and configure a cluster.' : m); }
}
function term(name: string, cmd: string) { const t = vscode.window.createTerminal(name); t.show(); t.sendText(cmd); }
export function activate(ctx: vscode.ExtensionContext) {
	const ns = () => ctx.workspaceState.get<string>('axiora.k8s.ns', 'default');
	register(ctx, 'axiora.k8s.context', async () => {
		const cur = (await k(['config', 'current-context'])).trim();
		const all = (await k(['config', 'get-contexts', '-o', 'name'])).trim().split('\n');
		const p = await vscode.window.showQuickPick(all.map(c => ({ label: c, description: c === cur ? 'current' : '' })), { placeHolder: 'Kubernetes context' });
		if (p) { await k(['config', 'use-context', p.label]); }
	});
	register(ctx, 'axiora.k8s.namespace', async () => {
		const all = (await k(['get', 'ns', '-o', 'jsonpath={.items[*].metadata.name}'])).trim().split(/\s+/);
		const p = await vscode.window.showQuickPick(all, { placeHolder: `Namespace (current: ${ns()})` }); if (p) { await ctx.workspaceState.update('axiora.k8s.ns', p); }
	});
	register(ctx, 'axiora.k8s.pods', async () => {
		const out = await k(['get', 'pods', '-n', ns(), '--no-headers', '-o', 'custom-columns=NAME:.metadata.name,STATUS:.status.phase,RESTARTS:.status.containerStatuses[0].restartCount']);
		const items = out.trim().split('\n').filter(Boolean).map(l => { const [name, st, r] = l.trim().split(/\s+/); return { label: `${st === 'Running' ? '$(pass-filled)' : '$(circle-large-outline)'} ${name}`, description: `${st} · restarts ${r}`, name }; });
		const p = await vscode.window.showQuickPick(items, { placeHolder: `Pods in ${ns()}` }); if (!p) { return; }
		const a = await vscode.window.showQuickPick(['Logs (follow)', 'Open Shell', 'Describe', 'Port Forward...', 'Delete']); if (!a) { return; }
		if (a.startsWith('Logs')) { term(`logs ${p.name}`, `kubectl logs -f --tail=200 -n ${ns()} ${p.name}`); }
		else if (a === 'Open Shell') { term(`exec ${p.name}`, `kubectl exec -it -n ${ns()} ${p.name} -- sh -c "command -v bash >/dev/null && exec bash || exec sh"`); }
		else if (a === 'Describe') { await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ language: 'yaml', content: await k(['describe', 'pod', '-n', ns(), p.name]) })); }
		else if (a.startsWith('Port')) { const ports = await vscode.window.showInputBox({ prompt: 'local:remote', value: '8080:80' }); if (ports) { term(`pf ${p.name}`, `kubectl port-forward -n ${ns()} ${p.name} ${ports}`); } }
		else if (await vscode.window.showWarningMessage(`Delete pod ${p.name}?`, { modal: true }, 'Delete')) { await k(['delete', 'pod', '-n', ns(), p.name]); }
	});
	register(ctx, 'axiora.k8s.deployments', async () => {
		const out = await k(['get', 'deploy', '-n', ns(), '--no-headers']);
		const p = await vscode.window.showQuickPick(out.trim().split('\n').filter(Boolean).map(l => { const c = l.trim().split(/\s+/); return { label: c[0], description: `ready ${c[1]}`, name: c[0] }; }), { placeHolder: `Deployments in ${ns()}` }); if (!p) { return; }
		const a = await vscode.window.showQuickPick(['Scale...', 'Rollout Restart', 'Rollout Status', 'Get YAML']); if (!a) { return; }
		if (a === 'Scale...') { const n = await vscode.window.showInputBox({ prompt: 'Replicas' }); if (n) { await k(['scale', 'deploy', p.name, '-n', ns(), `--replicas=${n}`]); } }
		else if (a === 'Rollout Restart') { await k(['rollout', 'restart', 'deploy', p.name, '-n', ns()]); }
		else if (a === 'Rollout Status') { term('rollout', `kubectl rollout status deploy/${p.name} -n ${ns()}`); }
		else { await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ language: 'yaml', content: await k(['get', 'deploy', p.name, '-n', ns(), '-o', 'yaml']) })); }
	});
	register(ctx, 'axiora.k8s.apply', async (uri?: vscode.Uri) => { const f = uri ?? vscode.window.activeTextEditor?.document.uri; if (f) { term('kubectl apply', `kubectl apply -n ${ns()} -f "${f.fsPath}"`); } });
	register(ctx, 'axiora.k8s.delete', async (uri?: vscode.Uri) => { const f = uri ?? vscode.window.activeTextEditor?.document.uri; if (f && await approve('delete', `kubectl delete -n ${ns()} -f ${f.fsPath}`, 'high')) { term('kubectl delete', `kubectl delete -n ${ns()} -f "${f.fsPath}"`); } });
}
