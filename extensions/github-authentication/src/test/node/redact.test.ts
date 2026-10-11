/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { redactSensitiveUrlParams } from '../../node/fetch';

suite('redactSensitiveUrlParams', () => {
	test('redacts device_code but keeps other params', () => {
		const url = 'https://github.com/login/oauth/access_token?client_id=abc&device_code=SECRET123&grant_type=x';
		const out = redactSensitiveUrlParams(url);
		assert.ok(!out.includes('SECRET123'));
		assert.ok(out.includes('device_code=<redacted>'));
		assert.ok(out.includes('client_id=abc'));
		assert.ok(out.includes('grant_type=x'));
	});
	test('leaves URLs without sensitive params untouched', () => {
		const url = 'https://api.github.com/user?per_page=1';
		assert.strictEqual(redactSensitiveUrlParams(url), url);
	});
});
