/*---------------------------------------------------------------------------------------------
 *  ACP authenticate selection.
 *
 *  Axiora's ACP client used to send `initialize` and then `session/new`, skipping
 *  `authenticate`. Cursor's official ACP flow requires
 *  `authenticate` with `methodId: "cursor_login"` before `session/new`
 *  (https://cursor.com/docs/cli/acp). Other agents are authenticated only when
 *  they advertise `authMethods`.
 *--------------------------------------------------------------------------------------------*/

export interface AcpAuthAgent {
	readonly name: string;
	readonly authMethod?: string;
}

export interface AcpInitializeResult {
	readonly authMethods?: readonly { readonly id?: string }[];
}

/** Which `authenticate` methodId to send, or `undefined` when no login step is required. */
export function selectAcpAuthMethod(agent: AcpAuthAgent, init: AcpInitializeResult | undefined): string | undefined {
	const advertised = (init?.authMethods ?? []).map(method => method?.id).filter((id): id is string => typeof id === 'string' && id.length > 0);
	if (agent.authMethod && (advertised.length === 0 || advertised.includes(agent.authMethod))) {
		return agent.authMethod;
	}
	if (agent.name === 'cursor') {
		return advertised.includes('cursor_login') || advertised.length === 0 ? 'cursor_login' : advertised[0];
	}
	return advertised[0];
}

/** Pulls a browser login URL out of an `authenticate` result, when the CLI returns one. */
export function loginUrlFromAuthResult(result: unknown): string | undefined {
	if (!result || typeof result !== 'object') {
		return undefined;
	}
	const bag = result as Record<string, unknown>;
	for (const key of ['url', 'loginUrl', 'authUrl', 'authorizationUrl']) {
		const value = bag[key];
		if (typeof value === 'string' && value.startsWith('https://')) {
			return value;
		}
	}
	return undefined;
}
