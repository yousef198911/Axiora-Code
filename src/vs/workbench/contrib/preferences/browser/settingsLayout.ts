/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isWeb, isWindows } from '../../../../base/common/platform.js';
import { localize } from '../../../../nls.js';
import { ISetting, ISettingsGroup } from '../../../services/preferences/common/preferences.js';
import { ChatAIDisabledSettingId } from '../../../../platform/chat/common/chatSettings.js';

export interface ITOCFilter {
	include?: {
		keyPatterns?: string[];
		tags?: string[];
	};
	exclude?: {
		keyPatterns?: string[];
		tags?: string[];
	};
}

export interface ITOCEntry<T> {
	id: string;
	label: string;
	order?: number;
	children?: ITOCEntry<T>[];
	settings?: Array<T>;
	hide?: boolean;
}

const COMMONLY_USED_SETTINGS: readonly string[] = [
	'editor.fontSize',
	'editor.formatOnSave',
	'files.autoSave',
	'GitHub.copilot-chat.manageExtension',
	'editor.defaultFormatter',
	'editor.fontFamily',
	'editor.wordWrap',
	'chat.agent.maxRequests',
	'files.exclude',
	'workbench.colorTheme',
	'editor.tabSize',
	'editor.mouseWheelZoom',
	'editor.formatOnPaste'
];

export function getCommonlyUsedData(settingGroups: ISettingsGroup[]): ITOCEntry<ISetting> {
	const allSettings = new Map<string, ISetting>();
	for (const group of settingGroups) {
		for (const section of group.sections) {
			for (const s of section.settings) {
				allSettings.set(s.key, s);
			}
		}
	}
	const settings: ISetting[] = [];
	for (const id of COMMONLY_USED_SETTINGS) {
		const setting = allSettings.get(id);
		if (setting) {
			settings.push(setting);
		}
	}
	return {
		id: 'commonlyUsed',
		label: localize('commonlyUsed', "Commonly Used"),
		settings
	};
}

export const tocData: ITOCEntry<string> = {
	id: 'root',
	label: 'root',
	children: [
		{
			id: 'editor',
			label: localize('textEditor', "Text Editor"),
			settings: ['editor.*'],
			children: [
				{
					id: 'editor/axioraCompletion',
					label: localize('axiora.toc.editor.axioraCompletion', "AI Completion"),
					settings: ['axiora.inlineCompletion.enabled', 'axiora.inlineCompletion.model', 'axiora.inlineCompletion.maxTokens', 'axiora.inlineCompletion.debounceMs', 'axiora.nextEdit.enabled']
				},
				{
					id: 'editor/axioraKeymap',
					label: localize('axiora.toc.editor.axioraKeymap', "Keymap"),
					settings: ['axiora.keymap']
				},
				{
					id: 'editor/axioraTypewriter',
					label: localize('axiora.toc.editor.axioraTypewriter', "Typewriter"),
					settings: ['axiora.editor.typewriterMode']
				},
				{
					id: 'editor/axioraLsp',
					label: localize('axiora.toc.editor.axioraLsp', "Language Servers"),
					settings: ['axiora.lsp.autoInstall', 'axiora.lsp.disabled', 'axiora.lsp.initializationOptions', 'axiora.inspections.enabled']
				},
				{
					id: 'editor/cursor',
					label: localize('cursor', "Cursor"),
					settings: ['editor.cursor*']
				},
				{
					id: 'editor/find',
					label: localize('find', "Find"),
					settings: ['editor.find.*']
				},
				{
					id: 'editor/font',
					label: localize('font', "Font"),
					settings: ['editor.font*']
				},
				{
					id: 'editor/format',
					label: localize('formatting', "Formatting"),
					settings: ['axiora.editorconfig.enabled', 'editor.format*']
				},
				{
					id: 'editor/diffEditor',
					label: localize('diffEditor', "Diff Editor"),
					settings: ['diffEditor.*']
				},
				{
					id: 'editor/multiDiffEditor',
					label: localize('multiDiffEditor', "Multi-File Diff Editor"),
					settings: ['multiDiffEditor.*']
				},
				{
					id: 'editor/minimap',
					label: localize('minimap', "Minimap"),
					settings: ['editor.minimap.*']
				},
				{
					id: 'editor/suggestions',
					label: localize('suggestions', "Suggestions"),
					settings: ['editor.*suggest*']
				},
				{
					id: 'editor/files',
					label: localize('files', "Files"),
					settings: ['files.*']
				}
			]
		},
		{
			id: 'workbench',
			label: localize('workbench', "Workbench"),
			settings: ['workbench.*'],
			children: [
				{
					id: 'workbench/appearance',
					label: localize('appearance', "Appearance"),
					settings: ['workbench.activityBar.*', 'workbench.*color*', 'workbench.fontAliasing', 'workbench.iconTheme', 'workbench.sidebar.location', 'workbench.*.visible', 'workbench.tips.enabled', 'workbench.tree.*', 'workbench.view.*']
				},
				{
					id: 'workbench/breadcrumbs',
					label: localize('breadcrumbs', "Breadcrumbs"),
					settings: ['breadcrumbs.*']
				},
				{
					id: 'workbench/editor',
					label: localize('editorManagement', "Editor Management"),
					settings: ['workbench.editor.*']
				},
				{
					id: 'workbench/settings',
					label: localize('settings', "Settings Editor"),
					settings: ['workbench.settings.*']
				},
				{
					id: 'workbench/zenmode',
					label: localize('zenMode', "Zen Mode"),
					settings: ['zenmode.*']
				},
				{
					id: 'workbench/screencastmode',
					label: localize('screencastMode', "Screencast Mode"),
					settings: ['screencastMode.*']
				},
				{
					id: 'workbench/browser',
					label: localize('browser', "Browser"),
					settings: ['workbench.browser.*']
				}
			]
		},
		{
			id: 'window',
			label: localize('window', "Window"),
			settings: ['window.*'],
			children: [
				{
					id: 'window/newWindow',
					label: localize('newWindow', "New Window"),
					settings: ['window.*newwindow*']
				}
			]
		},
		{
			id: 'chat',
			label: localize('chat', "Chat"),
			children: [
				{
					id: 'chat/axioraAssistant',
					label: localize('axiora.toc.chat.axioraAssistant', "Axiora Assistant"),
					settings: ['axiora.chat.defaultParticipant', 'axiora.agent.tools', 'axiora.web.readPages', 'axiora.agents.concurrency']
				},
				{
					id: 'chat/axioraMemory',
					label: localize('axiora.toc.chat.axioraMemory', "Memory"),
					settings: ['axiora.memory.enabled', 'axiora.chat.maxContextTokens', 'axiora.chat.seriesLimit']
				},
				{
					id: 'chat/agent',
					label: localize('chatAgent', "Agent"),
					settings: [
						'chat.agent.*',
						'chat.checkpoints.*',
						'chat.editRequests',
						'chat.requestQueuing.*',
						'chat.undoRequests.*',
						'chat.customAgentInSubagent.*',
						'chat.editing.autoAcceptDelay',
						'chat.editing.confirmEditRequest*',
						'chat.planAgent.defaultModel'
					]
				},
				{
					id: 'chat/appearance',
					label: localize('chatAppearance', "Appearance"),
					settings: [
						'chat.editor.*',
						'chat.fontFamily',
						'chat.fontSize',
						'chat.math.*',
						'chat.agentsControl.*',
						'chat.alternativeToolAction.*',
						'chat.codeBlock.*',
						'chat.editing.explainChanges.enabled',
						'chat.editorAssociations',
						'chat.extensionUnification.*',
						'chat.inlineReferences.*',
						'chat.notifyWindow*',
						'chat.statusWidget.*',
						'chat.tips.*',
						'chat.unifiedAgentsBar.*',
						'accessibility.signals.chatUserActionRequired',
						'accessibility.signals.chatResponseReceived'
					]
				},
				{
					id: 'chat/sessions',
					label: localize('chatSessions', "Sessions"),
					settings: [
						'chat.agentSessionProjection.*',
						'chat.sessions.*',
						'chat.viewProgressBadge.*',
						'chat.viewSessions.*',
						'chat.restoreLastPanelSession',
						'chat.exitAfterDelegation',
						'chat.repoInfo.*'
					]
				},
				{
					id: 'chat/tools',
					label: localize('chatTools', "Tools"),
					settings: [
						'chat.tools.*',
						'chat.extensionTools.*'
					]
				},
				{
					id: 'chat/mcp',
					label: localize('chatMcp', "MCP"),
					settings: ['mcp', 'chat.mcp.*', 'mcp.*']
				},
				{
					id: 'chat/context',
					label: localize('chatContext', "Context"),
					settings: ['axiora.context.repoMap', 'axiora.context.fastContext', 'axiora.context.liveActions', 'axiora.context.extraRepos', 'axiora.docs.maxPages', 
						'chat.detectParticipant.*',
						'chat.experimental.detectParticipant.*',
						'chat.implicitContext.*',
						'chat.promptFilesLocations',
						'chat.instructionsFilesLocations',
						'chat.modeFilesLocations',
						'chat.agentFilesLocations',
						'chat.agentSkillsLocations',
						'chat.hookFilesLocations',
						'chat.promptFilesRecommendations',
						'chat.useAgentsMdFile',
						'chat.useNestedAgentsMdFiles',
						'chat.useAgentSkills',
						'chat.experimental.useSkillAdherencePrompt',
						'chat.useHooks',
						'chat.includeApplyingInstructions',
						'chat.includeReferencedInstructions',
						'chat.useClaudeMdFile'
					]
				},
				{
					id: 'chat/inlineChat',
					label: localize('chatInlineChat', "Inline Chat"),
					settings: ['inlineChat.*']
				},
				{
					id: 'chat/miscellaneous',
					label: localize('chatMiscellaneous', "Miscellaneous"),
					settings: [
						ChatAIDisabledSettingId,
						'chat.allowAnonymousAccess'
					]
				},
			]
		},
		{
			id: 'aiModels',
			label: localize('axiora.toc.aiModels', "AI Models"),
			children: [
				{
					id: 'aiModels/key',
					label: localize('axiora.toc.aiModels.key', "AI Key"),
					settings: ['axiora.ai.apiKey']
				},
				{
					id: 'aiModels/provider',
					label: localize('axiora.toc.aiModels.provider', "Provider"),
					settings: ['axiora.ai.provider', 'axiora.ai.baseUrl', 'axiora.ai.chatModel']
				},
				{
					id: 'aiModels/router',
					label: localize('axiora.toc.aiModels.router', "Model Router"),
					settings: ['axiora.ai.router.enabled', 'axiora.ai.router.smallModel', 'axiora.ai.router.largeModel', 'axiora.ai.router.threshold']
				},
				{
					id: 'aiModels/cost',
					label: localize('axiora.toc.aiModels.cost', "Cost"),
					settings: ['axiora.ai.costPer1kInputTokens', 'axiora.ai.costPer1kOutputTokens']
				},
				{
					id: 'aiModels/vision',
					label: localize('axiora.toc.aiModels.vision', "Vision and Embeddings"),
					settings: ['axiora.ai.visionModel', 'axiora.ai.embeddingModel']
				},
				{
					id: 'aiModels/image',
					label: localize('axiora.toc.aiModels.image', "Image Generation"),
					settings: ['axiora.image.model', 'axiora.image.api', 'axiora.image.baseUrl', 'axiora.image.folder']
				},
				{
					id: 'aiModels/arena',
					label: localize('axiora.toc.aiModels.arena', "Arena"),
					settings: ['axiora.arena.models']
				},
			]
		},
		{
			id: 'voice',
			label: localize('axiora.toc.voice', "Voice"),
			children: [
				{
					id: 'voice/stt',
					label: localize('axiora.toc.voice.stt', "Speech to Text"),
					settings: ['axiora.voice.provider', 'axiora.voice.endpoint', 'axiora.voice.baseUrl', 'axiora.voice.model']
				},
				{
					id: 'voice/tts',
					label: localize('axiora.toc.voice.tts', "Text to Speech"),
					settings: ['axiora.voice.tts.provider', 'axiora.voice.tts.autoSpeak', 'axiora.voice.tts.rate', 'axiora.voice.tts.osVoice', 'axiora.voice.tts.model', 'axiora.voice.tts.voice', 'axiora.voice.tts.baseUrl']
				},
			]
		},
		{
			id: 'integrations',
			label: localize('axiora.toc.integrations', "Integrations"),
			children: [
				{
					id: 'integrations/jira',
					label: localize('axiora.toc.integrations.jira', "Jira"),
					settings: ['axiora.connectors.jira.token', 'axiora.connectors.jira.site', 'axiora.connectors.jira.email']
				},
				{
					id: 'integrations/google',
					label: localize('axiora.toc.integrations.google', "Google"),
					settings: ['axiora.google.account', 'axiora.google.clientId']
				},
				{
					id: 'integrations/figma',
					label: localize('axiora.toc.integrations.figma', "Figma"),
					settings: ['axiora.connectors.figma.token']
				},
				{
					id: 'integrations/slack',
					label: localize('axiora.toc.integrations.slack', "Slack"),
					settings: ['axiora.connectors.slack.token']
				},
				{
					id: 'integrations/linear',
					label: localize('axiora.toc.integrations.linear', "Linear"),
					settings: ['axiora.connectors.linear.token']
				},
				{
					id: 'integrations/stripe',
					label: localize('axiora.toc.integrations.stripe', "Stripe"),
					settings: ['axiora.connectors.stripe.token']
				},
				{
					id: 'integrations/github',
					label: localize('axiora.toc.integrations.github', "GitHub"),
					settings: ['axiora.github.token', 'axiora.github.repo', 'axiora.github.apiUrl']
				},
				{
					id: 'integrations/mcp',
					label: localize('axiora.toc.integrations.mcp', "MCP Server"),
					settings: ['axiora.mcpServer.enabled', 'axiora.mcpServer.port', 'axiora.mcpServer.allowWrites']
				},
				{
					id: 'integrations/browser',
					label: localize('axiora.toc.integrations.browser', "Browser"),
					settings: ['axiora.browser.executablePath', 'axiora.browser.headless', 'axiora.browser.maxSteps']
				},
				{
					id: 'integrations/remote',
					label: localize('axiora.toc.integrations.remote', "Remote and Sharing"),
					settings: ['axiora.runner.machines', 'axiora.collab.relayUrl', 'axiora.share.endpoint', 'axiora.embed.baseUrl', 'axiora.acp.agents']
				},
			]
		},
		{
			id: 'features',
			label: localize('features', "Features"),
			children: [
				{
					id: 'features/axioraCheckpoints',
					label: localize('axiora.toc.features.axioraCheckpoints', "Checkpoints"),
					settings: ['axiora.checkpoints.autoOnSave']
				},
				{
					id: 'features/axioraLintFix',
					label: localize('axiora.toc.features.axioraLintFix', "AI Lint Fix"),
					settings: ['axiora.lintFix.onSave', 'axiora.lintFix.maxIterations']
				},
				{
					id: 'features/axioraSolo',
					label: localize('axiora.toc.features.axioraSolo', "Solo Agent"),
					settings: ['axiora.solo.testCommand', 'axiora.solo.maxIterations']
				},
				{
					id: 'features/axioraLatex',
					label: localize('axiora.toc.features.axioraLatex', "LaTeX"),
					settings: ['axiora.latex.engine', 'axiora.latex.buildOnSave', 'axiora.latex.viewerDpi']
				},
				{
					id: 'features/axioraContainers',
					label: localize('axiora.toc.features.axioraContainers', "Containers"),
					settings: ['axiora.container.engine', 'axiora.wasi.replace']
				},
				{
					id: 'features/accessibilitySignals',
					label: localize('accessibility.signals', 'Accessibility Signals'),
					settings: ['accessibility.signal*']
				},
				{
					id: 'features/accessibility',
					label: localize('accessibility', "Accessibility"),
					settings: ['accessibility.*']
				},
				{
					id: 'features/explorer',
					label: localize('fileExplorer', "Explorer"),
					settings: ['explorer.*', 'outline.*']
				},
				{
					id: 'features/search',
					label: localize('search', "Search"),
					settings: ['search.*']
				},
				{
					id: 'features/debug',
					label: localize('debug', "Debug"),
					settings: ['debug.*', 'launch']
				},
				{
					id: 'features/testing',
					label: localize('testing', "Testing"),
					settings: ['testing.*']
				},
				{
					id: 'features/scm',
					label: localize('scm', "Source Control"),
					settings: ['scm.*']
				},
				{
					id: 'features/extensions',
					label: localize('extensions', "Extensions"),
					settings: ['extensions.*']
				},
				{
					id: 'features/terminal',
					label: localize('terminal', "Terminal"),
					settings: ['terminal.*']
				},
				{
					id: 'features/task',
					label: localize('task', "Task"),
					settings: ['task.*']
				},
				{
					id: 'features/problems',
					label: localize('problems', "Problems"),
					settings: ['problems.*']
				},
				{
					id: 'features/output',
					label: localize('output', "Output"),
					settings: ['output.*']
				},
				{
					id: 'features/comments',
					label: localize('comments', "Comments"),
					settings: ['comments.*']
				},
				{
					id: 'features/remote',
					label: localize('remote', "Remote"),
					settings: ['remote.*']
				},
				{
					id: 'features/timeline',
					label: localize('timeline', "Timeline"),
					settings: ['timeline.*']
				},
				{
					id: 'features/notebook',
					label: localize('notebook', 'Notebook'),
					settings: ['notebook.*', 'interactiveWindow.*']
				},
				{
					id: 'features/mergeEditor',
					label: localize('mergeEditor', 'Merge Editor'),
					settings: ['mergeEditor.*']
				},
				{
					id: 'features/issueReporter',
					label: localize('issueReporter', 'Issue Reporter'),
					settings: ['issueReporter.*'],
					hide: !isWeb
				}
			]
		},
		{
			id: 'application',
			label: localize('application', "Application"),
			children: [
				{
					id: 'application/axioraDotfiles',
					label: localize('axiora.toc.application.axioraDotfiles', "Dotfiles"),
					settings: ['axiora.dotfiles.repository', 'axiora.dotfiles.targetPath', 'axiora.dotfiles.installCommand', 'axiora.dotfiles.installOnStartup', 'axiora.dotfiles.ignore']
				},
				{
					id: 'application/axioraPower',
					label: localize('axiora.toc.application.axioraPower', "Power"),
					settings: ['axiora.agent.keepAwake']
				},
				{
					id: 'application/http',
					label: localize('proxy', "Proxy"),
					settings: ['http.*']
				},
				{
					id: 'application/keyboard',
					label: localize('keyboard', "Keyboard"),
					settings: ['keyboard.*']
				},
				{
					id: 'application/update',
					label: localize('update', "Update"),
					settings: ['update.*']
				},
				{
					id: 'application/telemetry',
					label: localize('telemetry', "Telemetry"),
					settings: ['telemetry.*']
				},
				{
					id: 'application/settingsSync',
					label: localize('settingsSync', "Settings Sync"),
					settings: ['axiora.sync.endpoint', 'axiora.sync.auto', 'settingsSync.*']
				},
				{
					id: 'application/network',
					label: localize('network', "Network"),
					settings: ['network.*']
				},
				{
					id: 'application/experimental',
					label: localize('experimental', "Experimental"),
					settings: ['application.experimental.*']
				},
				{
					id: 'application/other',
					label: localize('other', "Other"),
					settings: ['application.*'],
					hide: isWindows
				}
			]
		},
		{
			id: 'security',
			label: localize('security', "Security"),
			settings: ['security.*'],
			children: [
				{
					id: 'security/axioraApproval',
					label: localize('axiora.toc.security.axioraApproval', "Agent Approval"),
					settings: ['axiora.approval.mode']
				},
				{
					id: 'security/axioraSecrets',
					label: localize('axiora.toc.security.axioraSecrets', "Secret Scanning"),
					settings: ['axiora.security.scanOnSave']
				},
				{
					id: 'security/axioraSandbox',
					label: localize('axiora.toc.security.axioraSandbox', "Sandbox"),
					settings: ['axiora.sandbox.engine']
				},
				{
					id: 'security/axioraPolicy',
					label: localize('axiora.toc.security.axioraPolicy', "Policy"),
					settings: ['axiora.policy.url']
				},
				{
					id: 'security/workspace',
					label: localize('workspace', "Workspace"),
					settings: ['security.workspace.*']
				}
			]
		},
		{
			id: 'language',
			label: localize('axiora.toc.language', "Language"),
			settings: ['axiora.language.*'],
			children: [
				{
					id: 'language/display',
					label: localize('axiora.toc.language.display', "Display Language"),
					settings: ['axiora.language.display', 'axiora.language.mirrorLayout', 'axiora.language.statusBar']
				},
				{
					id: 'language/ai',
					label: localize('axiora.toc.language.ai', "AI Reply Language"),
					settings: ['axiora.chat.responseLanguage']
				},
				{
					id: 'language/voice',
					label: localize('axiora.toc.language.voice', "Voice Language"),
					settings: ['axiora.voice.language']
				}
			]
		}
	]
};
