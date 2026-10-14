/*---------------------------------------------------------------------------------------------
 *  Axiora: commands used by the Axiora assistant extension to manage chat sessions in the panel.
 *  - axiora.chat.setTitle(title): set the title of the chat shown in the panel (series parts).
 *  - axiora.chat.restore({ title, turns }): load a saved conversation into the chat panel so it
 *    can be continued (turns: [{ who: 'user' | 'axiora', text }]).
 *--------------------------------------------------------------------------------------------*/
import { CommandsRegistry } from '../../../../../platform/commands/common/commands.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { ChatViewPaneTarget, IChatWidgetService } from '../chat.js';
import { IChatService } from '../../common/chatService/chatService.js';
import { IChatAgentService } from '../../common/participants/chatAgents.js';
import { ChatAgentLocation } from '../../common/constants.js';
import { IExportableChatData, ISerializableChatRequestData } from '../../common/model/chatModel.js';

const AXIORA_AGENT_ID = 'axiora.local';

export function registerAxioraChatActions() {
	CommandsRegistry.registerCommand('axiora.chat.setTitle', (accessor, title: string, sessionResource?: string) => {
		const widgets = accessor.get(IChatWidgetService);
		const chatService = accessor.get(IChatService);
		const w = widgets.lastFocusedWidget ?? widgets.getWidgetsByLocations(ChatAgentLocation.Chat)[0];
		const res = w?.viewModel?.sessionResource;
		if (res && title && (!sessionResource || res.toString() === sessionResource)) {
			chatService.setChatSessionTitle(res, title);
			return true;
		}
		return false;
	});

	CommandsRegistry.registerCommand('axiora.chat.restore', async (accessor, data: { title?: string; turns: { who: string; text: string }[] }) => {
		const widgets = accessor.get(IChatWidgetService);
		const chatService = accessor.get(IChatService);
		const agents = accessor.get(IChatAgentService);
		const agent = agents.getAgent(AXIORA_AGENT_ID);
		const requests: ISerializableChatRequestData[] = [];
		const turns = data.turns ?? [];
		for (let i = 0; i < turns.length; i++) {
			if (turns[i].who !== 'user') { continue; }
			const reply = turns[i + 1]?.who === 'user' ? '' : (turns[i + 1]?.text ?? '');
			const text = turns[i].text;
			requests.push({
				requestId: generateUuid(),
				message: { text, parts: [{ kind: 'text', text, range: { start: 0, endExclusive: text.length }, editorRange: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: text.length + 1 } }] },
				variableData: { variables: [] },
				response: [{ kind: 'markdownContent', content: { value: reply } }],
				agent: agent ? { ...agent } as ISerializableChatRequestData['agent'] : undefined,
				timestamp: Date.now(),
			} as unknown as ISerializableChatRequestData);
		}
		const exported: IExportableChatData = { initialLocation: ChatAgentLocation.Chat, requests, responderUsername: agent?.fullName ?? 'Axiora' };
		const ref = chatService.loadSessionFromData(exported, 'axiora.chat.restore');
		try {
			const res = ref.object.sessionResource;
			if (data.title) { chatService.setChatSessionTitle(res, data.title); }
			await widgets.openSession(res, ChatViewPaneTarget, { pinned: true });
			return res.toString();
		} finally {
			ref.dispose();
		}
	});
}
