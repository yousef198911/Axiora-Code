/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { approxDownloadMb, CLI_LICENSE_URL, downloadRuntime, findVerifiedRuntime, platformId, removeRuntimes, RuntimeError } from './runtime';
import { buildPrompt, ChatRole, classifyError, ErrorKind, estimateTokens, isAllowedToken, ModelInfoLike, PlainMessage, redactSecrets, SIGN_IN_SCOPES, SILENT_SCOPE_SETS, toModelInfos } from './core';

// The Copilot SDK is loaded lazily so that a missing platform runtime never breaks activation.
type Sdk = typeof import('@github/copilot-sdk');
type Client = import('@github/copilot-sdk').CopilotClient;

const VENDOR = 'axiora-copilot';
const CONFIG = 'axiora.copilot';

let log: vscode.LogOutputChannel;
let extContext: vscode.ExtensionContext;
/** Set when the user declined the runtime download in this window; avoids repeated prompts. */
let declinedThisSession = false;

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

/**
 * Returns the path of the Copilot CLI runtime: the `axiora.copilot.runtimePath` override, or a verified
 * cached download. If missing and `interactive`, asks for consent and downloads it from the official source.
 */
async function ensureRuntime(interactive: boolean): Promise<string> {
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
	if (!interactive || declinedThisSession) {
		throw new RuntimeUnavailable(message('runtimeMissing'));
	}
	const mb = approxDownloadMb(plat);
	const download = vscode.l10n.t('Download');
	const license = vscode.l10n.t('View License');
	let choice: string | undefined;
	do {
		choice = await vscode.window.showInformationMessage(
			vscode.l10n.t('GitHub Copilot needs its official runtime'),
			{
				modal: true,
				detail: vscode.l10n.t('Axiora Code will download the GitHub Copilot CLI runtime {0} (about {1} MB) directly from GitHub\'s official npm package @github/copilot-{2} (registry.npmjs.org) and verify its checksum. It is provided by GitHub under the GitHub Copilot CLI License ({3}), not by Axiora Code. Chat, your own API keys and Ollama work without it.', version, mb, plat, CLI_LICENSE_URL)
					+ '\n\n' + 'يحتاج GitHub Copilot إلى تنزيل محرّكه الرسمي (حوالي ' + mb + ' ميغابايت) مباشرة من حزمة GitHub الرسمية على npm، مع التحقق من سلامته. يوفّره GitHub بموجب ترخيصه الخاص، وليس Axiora Code. الدردشة ومفاتيحك الخاصة وOllama تعمل بدونه.'
			},
			download, license);
		if (choice === license) {
			void vscode.env.openExternal(vscode.Uri.parse(CLI_LICENSE_URL));
		}
	} while (choice === license);
	if (choice !== download) {
		declinedThisSession = true;
		log.info('User declined the Copilot runtime download.');
		throw new RuntimeUnavailable(vscode.l10n.t('GitHub Copilot is unavailable because its runtime was not downloaded. Run "Download Copilot Runtime" to install it later.'));
	}
	return vscode.window.withProgress({
		location: vscode.ProgressLocation.Notification,
		title: vscode.l10n.t('Downloading GitHub Copilot runtime from GitHub (npm) / جارٍ تنزيل محرّك Copilot'),
		cancellable: true,
	}, async (progress, token) => {
		const ac = new AbortController();
		const sub = token.onCancellationRequested(() => ac.abort());
		let lastPct = 0;
		try {
			const exe = await downloadRuntime({
				cacheRoot: runtimeCacheRoot(), plat, version, signal: ac.signal,
				onProgress: (received, total) => {
					if (total) {
						const pct = Math.floor(received * 100 / total);
						if (pct > lastPct) {
							progress.report({ increment: pct - lastPct, message: `${Math.round(received / 1048576)} / ${Math.round(total / 1048576)} MB` });
							lastPct = pct;
						}
					} else {
						progress.report({ message: `${Math.round(received / 1048576)} MB` });
					}
				},
			});
			log.info(`Copilot runtime ${version} (${plat}) downloaded and verified (sha512).`);
			return exe;
		} catch (e) {
			const kind = e instanceof RuntimeError ? e.kind : 'unknown';
			log.error(`Runtime download failed (${kind}): ${redactSecrets(String((e as Error)?.message ?? e))}`);
			const text = kind === 'offline' ? vscode.l10n.t('Could not download the Copilot runtime: no connection to registry.npmjs.org. Check your internet connection or proxy (http.proxy) and try again.')
				: kind === 'cancelled' ? vscode.l10n.t('Copilot runtime download cancelled.')
					: kind === 'integrity' ? vscode.l10n.t('The downloaded Copilot runtime failed the integrity check and was discarded.')
						: vscode.l10n.t('Could not download the Copilot runtime: {0}', String((e as Error)?.message ?? e));
			void vscode.window.showErrorMessage(text);
			throw new RuntimeUnavailable(text);
		} finally {
			sub.dispose();
		}
	});
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
				declinedThisSession = false;
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
			declinedThisSession = false;
			try {
				await ensureRuntime(true);
				provider.refresh();
				void vscode.window.showInformationMessage(vscode.l10n.t('The GitHub Copilot runtime is installed and verified.'));
			} catch (e) {
				log.info(String((e as Error)?.message ?? e));
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
