/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { buildPrompt, classifyError, redactSecrets, toModelInfos } from '../core';

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
		assert.strictEqual(infos[1].capabilities.toolCalling, false);
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
});
