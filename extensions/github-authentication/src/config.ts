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
// (Device Flow enabled, redirect URI http://127.0.0.1/callback). No client secret is
// shipped. GitHub's web-flow token exchange requires a client_secret for OAuth Apps
// (even with PKCE), so without a secret only the Device Code and PAT flows are offered.
//
// NOTE: GitHub client secrets cannot be secured when running in a native client so in other words, the client secret is
// not really a secret... so we allow the client secret in code. It is brought in before we publish VS Code. Reference:
// https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/best-practices-for-creating-an-oauth-app#client-secrets
export const Config: IConfig = {
	gitHubClientId: 'Ov23liFwNhY5NNRdDgoz'
};
