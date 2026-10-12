/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IConfig {
	// The client ID of the GitHub OAuth app
	gitHubClientId: string;
	gitHubClientSecret?: string;
}

// For easy access to mixin client ID and secret
//
// Axiora Code: this is the public Client ID of the "Axiora Code" GitHub OAuth App
// (Device Flow enabled, redirect URI http://127.0.0.1/callback). The client secret is NOT
// committed: the Windows build workflow replaces the placeholder below with the
// AXIORA_GITHUB_CLIENT_SECRET Actions secret before compiling. With a secret, the
// browser (local server, http://127.0.0.1/callback) flow is offered first; Device Code
// and PAT remain as fallbacks. Without one (e.g. local dev builds), only Device Code + PAT.
//
// NOTE: GitHub client secrets cannot be secured when running in a native client so in other words, the client secret is
// not really a secret... so we allow the client secret in code. It is brought in before we publish VS Code. Reference:
// https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/best-practices-for-creating-an-oauth-app#client-secrets
const INJECTED_CLIENT_SECRET: string = '__AXIORA_GITHUB_CLIENT_SECRET__';

export const Config: IConfig = {
	gitHubClientId: 'Ov23liFwNhY5NNRdDgoz',
	gitHubClientSecret: INJECTED_CLIENT_SECRET && !INJECTED_CLIENT_SECRET.startsWith('__AXIORA_') ? INJECTED_CLIENT_SECRET : undefined
};
