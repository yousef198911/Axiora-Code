/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../../base/common/codicons.js';
import { localize, localize2 } from '../../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { ContextKeyExpr } from '../../../../../platform/contextkey/common/contextkey.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { IInstantiationService, ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IQuickInputService, IQuickPickItem, IQuickPickSeparator } from '../../../../../platform/quickinput/common/quickInput.js';
import { IWorkspaceTrustManagementService, IWorkspaceTrustRequestService } from '../../../../../platform/workspace/common/workspaceTrust.js';
import { Event } from '../../../../../base/common/event.js';
import { raceTimeout } from '../../../../../base/common/async.js';
import { IExtensionsWorkbenchService } from '../../../extensions/common/extensions.js';
import { ILanguageModelsService } from '../../common/languageModels.js';
import { CHAT_CATEGORY, CHAT_SETUP_ACTION_ID } from '../actions/chatActions.js';
import { ChatViewId } from '../chat.js';
import { ensureChatExtensionEnabled } from './chatManagement.contribution.js';

export const CHOOSE_YOUR_AI_COMMAND_ID = 'workbench.action.chat.chooseYourAI';

/** What the user can pre-select when the command is invoked with an argument. */
export type ChooseYourAIKind = 'byok' | 'local' | 'copilot';

interface IChooseYourAIItem extends IQuickPickItem {
	readonly run: () => Promise<void>;
}

const CONTINUE_EXTENSION_ID = 'Continue.continue';

/**
 * Lets the user pick how AI should work in Axiora Code: their own API key,
 * a local model (Ollama) or GitHub Copilot. Copilot stays available as an option.
 */
registerAction2(class ChooseYourAIAction extends Action2 {
	constructor() {
		super({
			id: CHOOSE_YOUR_AI_COMMAND_ID,
			title: localize2('chooseYourAI', "Choose Your AI"),
			category: CHAT_CATEGORY,
			icon: Codicon.sparkle,
			f1: true,
			menu: [{
				id: MenuId.ViewTitle,
				when: ContextKeyExpr.equals('view', ChatViewId),
				group: '3_configure',
				order: 1
			}]
		});
	}

	override async run(accessor: ServicesAccessor, kind?: ChooseYourAIKind): Promise<void> {
		const quickInputService = accessor.get(IQuickInputService);
		const commandService = accessor.get(ICommandService);
		const dialogService = accessor.get(IDialogService);
		const languageModelsService = accessor.get(ILanguageModelsService);
		const extensionsWorkbenchService = accessor.get(IExtensionsWorkbenchService);

		const workspaceTrustManagementService = accessor.get(IWorkspaceTrustManagementService);
		const workspaceTrustRequestService = accessor.get(IWorkspaceTrustRequestService);
		const notificationService = accessor.get(INotificationService);
		const instantiationService = accessor.get(IInstantiationService);

		const hasVendor = (vendor: string) => languageModelsService.getVendors().some(v => v.vendor === vendor);

		// Model providers come from the built-in AI extension, which does not run in Restricted Mode.
		// Ask for workspace trust when needed and wait until the provider is registered.
		const ensureVendor = async (vendor: string): Promise<boolean> => {
			if (hasVendor(vendor)) {
				return true;
			}
			if (!workspaceTrustManagementService.isWorkspaceTrusted()) {
				const trusted = await workspaceTrustRequestService.requestWorkspaceTrust({
					message: localize('chooseYourAI.trust', "AI model providers are disabled in Restricted Mode. Trust this folder to set up your AI.")
				});
				if (!trusted) {
					return false;
				}
			}
			const registered = Event.toPromise(Event.filter(languageModelsService.onDidChangeLanguageModelVendors, () => hasVendor(vendor)));
			// The built-in AI extension stays disabled until AI is set up; enable it like the Language Models editor does.
			await instantiationService.invokeFunction(ensureChatExtensionEnabled);
			await raceTimeout(registered, 20000);
			if (!hasVendor(vendor)) {
				notificationService.warn(localize('chooseYourAI.providerUnavailable', "The AI model provider is not available yet. Please try again in a moment."));
				return false;
			}
			return true;
		};

		const addProvider = async (vendor: string) => {
			if (!await ensureVendor(vendor)) {
				return;
			}
			await languageModelsService.configureLanguageModelsProviderGroup(vendor);
			await commandService.executeCommand('workbench.action.chat.open');
		};

		const setupLocal = async () => {
			const { confirmed } = await dialogService.confirm({
				type: 'info',
				message: localize('chooseYourAI.local.message', "Use a local model with Ollama"),
				detail: localize('chooseYourAI.local.detail', "1. Install Ollama from ollama.com and download a model, for example: ollama pull qwen2.5-coder:7b\n2. Agent mode sends large prompts. Start Ollama with a bigger context window, for example: OLLAMA_CONTEXT_LENGTH=32768 ollama serve\n3. Continue and confirm the Ollama address (default http://localhost:11434).\n\nNo account is needed and your code stays on your computer."),
				primaryButton: localize({ key: 'chooseYourAI.local.continue', comment: ['&& denotes a mnemonic'] }, "&&Continue")
			});
			if (confirmed) {
				await addProvider('ollama');
			}
		};

		const byokVendors: { vendor: string; label: string }[] = [
			{ vendor: 'openai', label: 'OpenAI' },
			{ vendor: 'anthropic', label: 'Anthropic' },
			{ vendor: 'gemini', label: 'Google Gemini' },
			{ vendor: 'xai', label: 'xAI' },
			{ vendor: 'openrouter', label: 'OpenRouter' },
		];

		const items: (IChooseYourAIItem | IQuickPickSeparator)[] = [];
		items.push({ type: 'separator', label: localize('chooseYourAI.byok', "Use your own API key") });
		for (const { vendor, label } of byokVendors) {
			items.push({ label, description: localize('chooseYourAI.byok.description', "API key"), run: () => addProvider(vendor) });
		}
		items.push({ label: localize('chooseYourAI.customEndpoint', "Custom Endpoint"), description: localize('chooseYourAI.customEndpoint.description', "Any OpenAI-compatible server"), run: () => addProvider('customendpoint') });
		items.push({ type: 'separator', label: localize('chooseYourAI.localSeparator', "Local model") });
		items.push({ label: localize('chooseYourAI.ollama', "Ollama (Local)"), description: localize('chooseYourAI.ollama.description', "Runs on your computer, no account needed"), run: setupLocal });
		items.push({ type: 'separator', label: localize('chooseYourAI.copilotSeparator', "GitHub Copilot") });
		items.push({ label: localize('chooseYourAI.copilot', "GitHub Copilot"), description: localize('chooseYourAI.copilot.description', "Sign in with a GitHub account"), run: async () => { await commandService.executeCommand(CHAT_SETUP_ACTION_ID); } });
		items.push({ type: 'separator', label: localize('chooseYourAI.extensionsSeparator', "Other assistants") });
		items.push({ label: localize('chooseYourAI.continue', "Continue extension (Open VSX)"), description: localize('chooseYourAI.continue.description', "Optional separate assistant with local codebase indexing"), run: async () => { await extensionsWorkbenchService.openSearch(`@id:${CONTINUE_EXTENSION_ID}`); } });

		if (kind === 'local') {
			return setupLocal();
		}
		if (kind === 'copilot') {
			await commandService.executeCommand(CHAT_SETUP_ACTION_ID);
			return;
		}

		const pick = await quickInputService.pick(items, {
			title: localize('chooseYourAI.title', "Choose Your AI"),
			placeHolder: kind === 'byok'
				? localize('chooseYourAI.placeholder.byok', "Select the provider of your API key")
				: localize('chooseYourAI.placeholder', "Use your own API key, a local model or GitHub Copilot"),
		}) as IChooseYourAIItem | undefined;
		await pick?.run();
	}
});
