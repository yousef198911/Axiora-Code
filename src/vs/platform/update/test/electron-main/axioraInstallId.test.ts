/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { generateUuid } from '../../../../base/common/uuid.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { createUpdateURL, isValidInstallId, resolveUpdateBaseUrl } from '../../electron-main/abstractUpdateService.js';

suite('Axiora update: anonymous install id', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('createUpdateURL appends a valid installId', () => {
		const id = generateUuid();
		const url = new URL(createUpdateURL('https://updates.example', 'win32-x64-user', 'stable', 'abc', { installId: id }));
		assert.strictEqual(url.pathname, '/api/update/win32-x64-user/stable/abc');
		assert.strictEqual(url.searchParams.get('installId'), id);
		assert.strictEqual(url.searchParams.get('u'), 'none');
	});

	test('createUpdateURL omits missing or malformed installId', () => {
		assert.strictEqual(new URL(createUpdateURL('https://u.example', 'p', 'stable', 'c')).searchParams.has('installId'), false);
		assert.strictEqual(new URL(createUpdateURL('https://u.example', 'p', 'stable', 'c', { installId: 'user@host' })).searchParams.has('installId'), false);
	});

	test('isValidInstallId accepts only lowercase uuids', () => {
		assert.ok(isValidInstallId(generateUuid()));
		assert.ok(!isValidInstallId(''));
		assert.ok(!isValidInstallId(undefined));
		assert.ok(!isValidInstallId('not-a-uuid'));
	});

	test('resolveUpdateBaseUrl honours AXIORA_UPDATE_URL override', () => {
		assert.strictEqual(resolveUpdateBaseUrl('https://prod.example/', {}), 'https://prod.example');
		assert.strictEqual(resolveUpdateBaseUrl('https://prod.example', { AXIORA_UPDATE_URL: 'http://127.0.0.1:3002' }), 'http://127.0.0.1:3002');
		assert.strictEqual(resolveUpdateBaseUrl(undefined, { AXIORA_UPDATE_URL: '  ' }), undefined);
	});
});
