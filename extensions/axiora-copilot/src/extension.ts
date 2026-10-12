/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { downloadRuntime, findVerifiedRuntime, platformId, removeRuntimes, RuntimeError } from './runtime';
import { buildPrompt, ChatRole, classifyError, ErrorKind, estimateTokens, isAllowedToken, ModelInfoLike, PlainMessage, redactSecrets, SIGN_IN_SCOPES, SILENT_SCOPE_SETS, toModelInfos } from './core';

// The Copilot SDK is loaded lazily so that a missing platform runtime never breaks activation.
type Sdk = typeof import('@github/copilot-sdk');
type Client = import('@github/copilot-sdk').CopilotClient;

const VENDOR = 'axiora-copilot';
const CONFIG = 'axiora.copilot';

let log: vscode.LogOutputChannel;
let extContext: vscode.ExtensionContext;
/** Set when the user declined the runtime download in this window; avoids repeated prompts. */

function runtimeCacheRoot(): string {
	return path.join(extContext.globalStorageUri.fsPath, 'runtime');
}

/** Pinned runtime version = the Copilot CLI version the bundled SDK was built against. */
function pinnedRuntimeVersion(): string {
	const pkgPath = path.join(extContext.extensionPath, 'node_modules', '@github', 'copilot-sdk', 'package.json');
	const v = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).copilotCliVersion;
	if (typeof v !== 'string') {
		throw new Error('copilotCliVersion missing from @github/copilot-sdk');
	}
	return v;
}

class RuntimeUnavailable extends Error { }

/** In-flight background download (shared by all callers) and the time of the last failure. */
let downloading: Promise<string> | undefined;
let lastFailure = 0;
const RETRY_AFTER_MS = 10 * 60 * 1000;

/**
 * Returns the path of the Copilot CLI runtime: the `axiora.copilot.runtimePath` override, or a verified
 * cached download. If missing (and Copilot is enabled), the official runtime is downloaded automatically
 * in the background from GitHub's npm package, verified and installed atomically. There is no dialog:
 * progress is shown subtly in the status bar and failures are logged. After a failure, automatic retries
 * wait {@link RETRY_AFTER_MS}; `force` (the "Download Copilot Runtime" command) retries immediately.
 */
async function ensureRuntime(force: boolean): Promise<string> {
	const override = vscode.workspace.getConfiguration(CONFIG).get<string>('runtimePath', '').trim();
	if (override) {
		if (!fs.existsSync(override)) {
			throw new RuntimeUnavailable(vscode.l10n.t('The Copilot runtime set in axiora.copilot.runtimePath was not found: {0}', override));
		}
		return override;
	}
	const plat = platformId();
	if (!plat) {
		throw new RuntimeUnavailable(vscode.l10n.t('GitHub Copilot is not available on this platform ({0}-{1}).', process.platform, process.arch));
	}
	const version = pinnedRuntimeVersion();
	const cached = findVerifiedRuntime(runtimeCacheRoot(), plat, version);
	if (cached) {
		return cached;
	}
	if (!copilotEnabled()) {
		throw new RuntimeUnavailable(message('disabled'));
	}
	if (!downloading && !force && lastFailure && Date.now() - lastFailure < RETRY_AFTER_MS) {
		throw new RuntimeUnavailable(message('runtimeMissing'));
	}
	downloading ??= backgroundDownload(plat, version).finally(() => { downloading = undefined; });
	return downloading;
}

function backgroundDownload(plat: string, version: string): Promise<string> {
	log.info(`Downloading the official GitHub Copilot runtime ${version} (${plat}) from GitHub's npm package in the background.`);
	return Promise.resolve(vscode.window.withProgress({
		location: vscode.ProgressLocation.Window,
		title: vscode.l10n.t('Preparing GitHub Copilot / تجهيز Copilot'),
	}, async progress => {
		let lastPct = -1;
		try {
			const exe = await downloadRuntime({
				cacheRoot: runtimeCacheRoot(), plat, version,
				onProgress: (received, total) => {
					const pct = total ? Math.floor(received * 100 / total) : -1;
					if (pct !== lastPct) {
						lastPct = pct;
						progress.report({ message: total ? `${pct}%` : `${Math.round(received / 1048576)} MB` });
					}
				},
			});
			lastFailure = 0;
			log.info(`Copilot runtime ${version} (${plat}) downloaded and verified.`);
			return exe;
		} catch (e) {
			lastFailure = Date.now();
			const kind = e instanceof RuntimeError ? e.kind : 'unknown';
			log.error(`Runtime download failed (${kind}): ${redactSecrets(String((e as Error)?.message ?? e))}`);
			throw new RuntimeUnavailable(kind === 'offline'
				? vscode.l10n.t('GitHub Copilot is unavailable: its runtime could not be downloaded (no connection). It will be retried later.')
				: kind === 'integrity'
					? vscode.l10n.t('GitHub Copilot is unavailable: the downloaded runtime failed the integrity check and was discarded.')
					: vscode.l10n.t('GitHub Copilot is unavailable: its runtime could not be downloaded ({0}).', kind));
		}
	}));
}

function message(kind: ErrorKind | 'tokenRejected' | 'disabled'): string {
	switch (kind) {
		case 'signInRequired': return vscode.l10n.t('Sign in to GitHub to use Copilot in Axiora Code. Run "Sign in to GitHub for Copilot" from the Command Palette.');
		case 'noSubscription': return vscode.l10n.t('Your GitHub account does not have access to GitHub Copilot. Enable Copilot Free or a paid plan at github.com/settings/copilot, then try again.');
		case 'rateLimited': return vscode.l10n.t('GitHub Copilot usage limit reached. Wait a while or check your plan, then try again.');
		case 'network': return vscode.l10n.t('Could not reach GitHub Copilot. Check your internet connection and try again.');
		case 'tokenRejected': return vscode.l10n.t('This GitHub sign-in uses a token type that Copilot in Axiora Code does not accept. Sign out of GitHub and sign in again with Axiora Code.');
		case 'runtimeMissing': return vscode.l10n.t('GitHub Copilot needs its official runtime, which is downloaded from GitHub on first use. Run "Download Copilot Runtime" from the Command Palette.');
		case 'disabled': return vscode.l10n.t('GitHub Copilot is turned off in Axiora Code settings (axiora.copilot.enabled).');
		default: return vscode.l10n.t('GitHub Copilot request failed.');
	}
}

class CopilotSdkHost implements vscode.Disposable {
	private sdk: Promise<Sdk> | undefined;
	private client: Client | undefined;
	private clientToken: string | undefined;
	private starting: Promise<Client> | undefined;

	private loadSdk(): Promise<Sdk> {
		this.sdk ??= import('@github/copilot-sdk');
		return this.sdk;
	}

	async getClient(token: string, interactive: boolean): Promise<Client> {
		if (this.client && this.clientToken === token) {
			return this.client;
		}
		if (this.starting && this.clientToken === token) {
			return this.starting;
		}
		await this.stop();
		this.clientToken = token;
		this.starting = (async () => {
			const runtimePath = await ensureRuntime(interactive);
			const sdk = await this.loadSdk();
			const client = new sdk.CopilotClient({
				gitHubToken: token,
				useLoggedInUser: false,
				connection: sdk.RuntimeConnection.forStdio({ path: runtimePath }),
				workingDirectory: vscode.workspace.workspaceFolders?.[0]?.uri.scheme === 'file' ? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined,
			});
			await client.start();
			this.client = client;
			return client;
		})();
		try {
			return await this.starting;
		} catch (e) {
			this.clientToken = undefined;
			throw e;
		} finally {
			this.starting = undefined;
		}
	}

	async stop(): Promise<void> {
		const c = this.client;
		this.client = undefined;
		this.clientToken = undefined;
		if (c) {
			try { await c.stop(); } catch { /* ignore */ }
		}
	}

	dispose(): void {
		void this.stop();
	}
}

/** Returns the GitHub access token of the session if it is an accepted type; never logs the token. */
function acceptedToken(session: vscode.AuthenticationSession): string {
	if (!isAllowedToken(session.accessToken)) {
		log.warn('GitHub session token type is not accepted for Copilot (expected gho_/ghu_/github_pat_).');
		throw new Error(message('tokenRejected'));
	}
	return session.accessToken;
}

async function getGitHubSession(createIfNone: boolean): Promise<vscode.AuthenticationSession | undefined> {
	for (const scopes of SILENT_SCOPE_SETS) {
		try {
			const s = await vscode.authentication.getSession('github', scopes, { silent: true });
			if (s) {
				return s;
			}
		} catch { /* try next */ }
	}
	if (createIfNone) {
		return vscode.authentication.getSession('github', SIGN_IN_SCOPES, { createIfNone: true });
	}
	return undefined;
}

function copilotEnabled(): boolean {
	return vscode.workspace.getConfiguration(CONFIG).get<boolean>('enabled', true);
}

function engineEnabled(): boolean {
	return copilotEnabled() && vscode.workspace.getConfiguration(CONFIG).get<string>('engine', 'sdk') === 'sdk';
}

function toPlain(messages: readonly vscode.LanguageModelChatRequestMessage[]): PlainMessage[] {
	return messages.map(m => {
		const text = m.content.map(p => {
			if (p instanceof vscode.LanguageModelTextPart) {
				return p.value;
			}
			if (p instanceof vscode.LanguageModelToolResultPart) {
				return p.content.map(c => c instanceof vscode.LanguageModelTextPart ? c.value : '').join('');
			}
			return '';
		}).join('');
		const role: ChatRole = m.role === vscode.LanguageModelChatMessageRole.User ? 'user'
			: m.role === vscode.LanguageModelChatMessageRole.Assistant ? 'assistant' : 'system';
		const result: PlainMessage = { role, text };
		return result;
	});
}

class CopilotSdkProvider implements vscode.LanguageModelChatProvider<vscode.LanguageModelChatInformation> {
	private readonly _onDidChange = new vscode.EventEmitter<void>();
	readonly onDidChangeLanguageModelChatInformation = this._onDidChange.event;
	private cache: ModelInfoLike[] | undefined;

	constructor(private readonly host: CopilotSdkHost) { }

	refresh(): void {
		this.cache = undefined;
		this._onDidChange.fire();
	}

	async provideLanguageModelChatInformation(options: vscode.PrepareLanguageModelChatModelOptions): Promise<vscode.LanguageModelChatInformation[]> {
		if (!engineEnabled()) {
			return [];
		}
		if (this.cache) {
			return this.cache;
		}
		const session = await getGitHubSession(!options.silent);
		if (!session) {
			log.info('No GitHub session yet; Copilot models hidden until sign-in.');
			return [];
		}
		try {
			const client = await this.host.getClient(acceptedToken(session), !options.silent);
			const models = await client.listModels();
			this.cache = toModelInfos(models);
			log.info(`Copilot SDK models: ${this.cache.map(m => m.id).join(', ')}`);
			return this.cache;
		} catch (e) {
			if (e instanceof RuntimeUnavailable) {
				log.info(`Copilot models hidden: ${e.message}`);
				return [];
			}
			const kind = classifyError(e);
			log.error(`listModels failed (${kind}): ${redactSecrets(String(e?.message ?? e))}`);
			if (!options.silent) {
				void vscode.window.showWarningMessage(message(kind));
			}
			return [];
		}
	}

	async provideLanguageModelChatResponse(model: vscode.LanguageModelChatInformation, messages: readonly vscode.LanguageModelChatRequestMessage[], _options: vscode.ProvideLanguageModelChatResponseOptions, progress: vscode.Progress<vscode.LanguageModelResponsePart>, token: vscode.CancellationToken): Promise<void> {
		if (!engineEnabled()) {
			throw new Error(message('disabled'));
		}
		const session = await getGitHubSession(true);
		if (!session) {
			throw new Error(message('signInRequired'));
		}
		const { system, prompt } = buildPrompt(toPlain(messages));
		const allowTools = vscode.workspace.getConfiguration(CONFIG).get<boolean>('allowAgentTools', false);
		const started = Date.now();
		log.info(`Request started: model=${model.id}, messages=${messages.length}, promptChars=${prompt.length}`);
		let sdkSession: import('@github/copilot-sdk').CopilotSession | undefined;
		try {
			const client = await this.host.getClient(acceptedToken(session), true);
			sdkSession = await client.createSession({
				clientName: 'Axiora Code',
				model: model.id,
				streaming: true,
				systemMessage: system ? { mode: 'append', content: system } : undefined,
				// Safety: no SDK built-in tools unless explicitly allowed; permission prompts are always denied.
				...(allowTools ? {} : { availableTools: [], excludedTools: ['builtin:*', 'mcp:*'] }),
				onPermissionRequest: () => ({ kind: 'denied-no-approval-rule-and-could-not-request-from-user' }),
			});
			const s = sdkSession;
			let streamed = false;
			let finalText: string | undefined;
			let failure: string | undefined;
			const done = new Promise<void>(resolve => {
				s.on(event => {
					switch (event.type) {
						case 'assistant.message_delta':
							if (event.data.deltaContent) {
								streamed = true;
								progress.report(new vscode.LanguageModelTextPart(event.data.deltaContent));
							}
							break;
						case 'assistant.message':
							finalText = (event.data as { content?: string }).content ?? finalText;
							break;
						case 'session.error':
							failure = (event.data as { message?: string }).message ?? 'session error';
							resolve();
							break;
						case 'session.idle':
							resolve();
							break;
					}
				});
			});
			const cancel = token.onCancellationRequested(() => { void s.abort().catch(() => undefined); });
			try {
				await s.send({ prompt });
				await done;
			} finally {
				cancel.dispose();
			}
			if (failure) {
				throw new Error(failure);
			}
			if (!streamed && finalText) {
				progress.report(new vscode.LanguageModelTextPart(finalText));
			}
			const gotText = streamed || !!finalText;
			log.info(`Request finished: model=${model.id}, text=${gotText ? 'yes' : 'no'}, ms=${Date.now() - started}`);
			if (!gotText && !token.isCancellationRequested) {
				throw new Error(`The model "${model.id}" returned no text.`);
			}
		} catch (e) {
			if (token.isCancellationRequested) {
				return;
			}
			if (e instanceof RuntimeUnavailable) {
				throw e;
			}
			const kind = classifyError(e);
			const detail = redactSecrets(String(e?.message ?? e));
			log.error(`Request failed (${kind}): ${detail}`);
			throw new Error(kind === 'unknown' ? `${message(kind)} ${detail}` : message(kind));
		} finally {
			if (sdkSession) {
				void sdkSession.disconnect().catch(() => undefined);
			}
		}
	}

	async provideTokenCount(_model: vscode.LanguageModelChatInformation, text: string | vscode.LanguageModelChatRequestMessage): Promise<number> {
		if (typeof text === 'string') {
			return estimateTokens(text);
		}
		return estimateTokens(toPlain([text]).map(m => m.text).join(''));
	}
}

export function activate(context: vscode.ExtensionContext): void {
	extContext = context;
	log = vscode.window.createOutputChannel('GitHub Copilot (Axiora)', { log: true });
	const host = new CopilotSdkHost();
	const provider = new CopilotSdkProvider(host);
	context.subscriptions.push(log, host);

	// The provider stays registered so the editor gets an authoritative (empty) model list when
	// `axiora.copilot.enabled` is turned off; unregistering left stale cached Copilot models in the Chat
	// model picker. When disabled the provider reports no models and the Copilot runtime process is
	// stopped. Nothing else in the editor (Chat view, BYOK providers, Ollama) depends on this extension.
	context.subscriptions.push(vscode.lm.registerLanguageModelChatProvider(VENDOR, provider));
	log.info('Axiora Copilot SDK provider registered.');
	const applyEnabled = () => {
		if (!copilotEnabled()) {
			void host.stop();
			log.info('Copilot disabled (axiora.copilot.enabled = false): models removed, runtime stopped.');
		}
		provider.refresh();
	};

	context.subscriptions.push(
		vscode.authentication.onDidChangeSessions(e => {
			if (e.provider.id === 'github') {
				void host.stop();
				provider.refresh();
			}
		}),
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(`${CONFIG}.enabled`)) {
				applyEnabled();
			} else if (e.affectsConfiguration(`${CONFIG}.engine`)) {
				if (!engineEnabled()) {
					void host.stop();
				}
				provider.refresh();
			}
		}),
		vscode.commands.registerCommand('axiora.copilot.signIn', async () => {
			if (!copilotEnabled()) {
				void vscode.window.showWarningMessage(message('disabled'));
				return;
			}
			const s = await getGitHubSession(true);
			if (s) {
				try {
					await ensureRuntime(true);
				} catch {
					return;
				}
				provider.refresh();
				void vscode.window.showInformationMessage(vscode.l10n.t('Signed in to GitHub as {0}. Copilot models are now available in the Chat model picker.', s.account.label));
			}
		}),
		vscode.commands.registerCommand('axiora.copilot.refreshModels', () => provider.refresh()),
		vscode.commands.registerCommand('axiora.copilot.downloadRuntime', async () => {
			if (!copilotEnabled()) {
				void vscode.window.showWarningMessage(message('disabled'));
				return;
			}
			try {
				await ensureRuntime(true);
				provider.refresh();
				void vscode.window.showInformationMessage(vscode.l10n.t('The GitHub Copilot runtime is installed and verified.'));
			} catch (e) {
				void vscode.window.showWarningMessage(String((e as Error)?.message ?? e));
			}
		}),
		vscode.commands.registerCommand('axiora.copilot.removeRuntime', async () => {
			await host.stop();
			let removed = false;
			try {
				removed = removeRuntimes(runtimeCacheRoot());
			} catch (e) {
				void vscode.window.showErrorMessage(vscode.l10n.t('Could not remove the Copilot runtime: {0}', String((e as Error)?.message ?? e)));
				return;
			}
			provider.refresh();
			log.info(`Remove runtime: ${removed ? 'removed' : 'nothing to remove'}.`);
			void vscode.window.showInformationMessage(removed
				? vscode.l10n.t('The downloaded GitHub Copilot runtime was removed. / تم حذف محرّك Copilot.')
				: vscode.l10n.t('No downloaded GitHub Copilot runtime was found. / لا يوجد محرّك Copilot منزَّل.'));
		}),
		vscode.commands.registerCommand('axiora.copilot.useLegacyEngine', async () => {
			await vscode.workspace.getConfiguration(CONFIG).update('engine', 'legacy', vscode.ConfigurationTarget.Global);
		}),
		vscode.commands.registerCommand('axiora.copilot.useSdkEngine', async () => {
			await vscode.workspace.getConfiguration(CONFIG).update('engine', 'sdk', vscode.ConfigurationTarget.Global);
		}),
	);
}

export function deactivate(): void { }
