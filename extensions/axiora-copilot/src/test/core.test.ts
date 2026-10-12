/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { buildPrompt, classifyError, isAllowedToken, redactSecrets, toModelInfos } from '../core';

suite('axiora-copilot core', () => {
	test('toModelInfos maps limits and drops disabled models', () => {
		const infos = toModelInfos([
			{ id: 'gpt-5-mini', name: 'GPT-5 mini', capabilities: { limits: { max_context_window_tokens: 128000, max_prompt_tokens: 100000, max_output_tokens: 8000 } }, billing: { multiplier: 0 } },
			{ id: 'blocked', name: 'Blocked', policy: { state: 'disabled' } },
			{ id: 'bare', name: '' },
		]);
		assert.deepStrictEqual(infos.map(i => i.id), ['gpt-5-mini', 'bare']);
		assert.strictEqual(infos[0].maxInputTokens, 100000);
		assert.strictEqual(infos[0].maxOutputTokens, 8000);
		assert.strictEqual(infos[0].detail, '0x');
		assert.strictEqual(infos[1].name, 'bare');
		assert.strictEqual(infos[1].capabilities.toolCalling, true);
		assert.strictEqual(infos[1].isUserSelectable, true);
	});

	test('toModelInfos gives virtual models (auto) a usable input budget', () => {
		const infos = toModelInfos([
			{ id: 'auto', name: 'Auto', capabilities: { limits: { max_context_window_tokens: 0, max_output_tokens: 16000 } } },
			{ id: 'auto2', name: 'Auto', capabilities: { limits: { max_prompt_tokens: 0, max_context_window_tokens: 0, max_output_tokens: 0 } } },
			{ id: 'auto3', name: 'Auto', capabilities: { limits: { max_context_window_tokens: 16000, max_output_tokens: 16000 } } },
		]);
		for (const i of infos) {
			assert.ok(i.maxInputTokens >= 4096, `${i.id} maxInputTokens=${i.maxInputTokens}`);
			assert.ok(i.maxOutputTokens > 0, `${i.id} maxOutputTokens=${i.maxOutputTokens}`);
		}
	});

	test('buildPrompt single turn', () => {
		assert.deepStrictEqual(buildPrompt([{ role: 'system', text: 'S' }, { role: 'user', text: 'hi' }]), { system: 'S', prompt: 'hi' });
	});

	test('buildPrompt keeps history', () => {
		const r = buildPrompt([{ role: 'user', text: 'a' }, { role: 'assistant', text: 'b' }, { role: 'user', text: 'c' }]);
		assert.strictEqual(r.system, undefined);
		assert.ok(r.prompt.includes('<user>\na\n</user>'));
		assert.ok(r.prompt.includes('<assistant>\nb\n</assistant>'));
		assert.ok(r.prompt.endsWith('\n\nc'));
	});

	test('buildPrompt empty', () => {
		assert.deepStrictEqual(buildPrompt([]), { system: undefined, prompt: '' });
	});

	test('classifyError', () => {
		assert.strictEqual(classifyError(new Error('Request failed 401 Unauthorized')), 'signInRequired');
		assert.strictEqual(classifyError(new Error('403 Forbidden')), 'noSubscription');
		assert.strictEqual(classifyError(new Error('rate limit exceeded (429)')), 'rateLimited');
		assert.strictEqual(classifyError(new Error('getaddrinfo ENOTFOUND api.githubcopilot.com')), 'network');
		assert.strictEqual(classifyError(new Error('Could not resolve @github/copilot-sdk-win32-x64.')), 'runtimeMissing');
		assert.strictEqual(classifyError('weird'), 'unknown');
	});

	test('redactSecrets', () => {
		assert.strictEqual(redactSecrets('token gho_ABCdef123 and github_pat_11AA_bb'), 'token gho_[redacted] and github_pat_[redacted]');
	});

	test('isAllowedToken', () => {
		assert.strictEqual(isAllowedToken('gho_' + 'A1b2C3'), true);
		assert.strictEqual(isAllowedToken('ghu_' + 'A1b2C3'), true);
		assert.strictEqual(isAllowedToken('github_pat_' + '11AA_bb'), true);
		for (const t of ['ghp_' + 'abc', 'ghs_' + 'abc', 'ghr_' + 'abc', 'gho_', 'gho_abc def', 'Bearer gho_abc', '', undefined]) {
			assert.strictEqual(isAllowedToken(t), false, String(t));
		}
	});
});
