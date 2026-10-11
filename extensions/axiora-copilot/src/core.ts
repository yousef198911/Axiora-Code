/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Pure helpers (no `vscode` import) so they can be unit tested with plain mocha.

export type ChatRole = 'system' | 'user' | 'assistant';

export interface PlainMessage {
	readonly role: ChatRole;
	readonly text: string;
}

export interface SdkModelLike {
	readonly id: string;
	readonly name: string;
	readonly capabilities?: {
		readonly supports?: { readonly vision?: boolean };
		readonly limits?: { readonly max_prompt_tokens?: number; readonly max_output_tokens?: number; readonly max_context_window_tokens?: number };
	};
	readonly policy?: { readonly state: string };
	readonly billing?: { readonly multiplier?: number };
}

export interface ModelInfoLike {
	readonly id: string;
	readonly name: string;
	readonly family: string;
	readonly version: string;
	readonly maxInputTokens: number;
	readonly maxOutputTokens: number;
	readonly detail?: string;
	readonly tooltip?: string;
	readonly capabilities: { readonly imageInput: boolean; readonly toolCalling: boolean };
}

/** Converts Copilot SDK models into language model chat information. Disabled-by-policy models are dropped. */
export function toModelInfos(models: readonly SdkModelLike[]): ModelInfoLike[] {
	const result: ModelInfoLike[] = [];
	for (const m of models) {
		if (m.policy?.state === 'disabled') {
			continue;
		}
		const limits = m.capabilities?.limits ?? {};
		const context = limits.max_context_window_tokens ?? 128000;
		const maxOutputTokens = limits.max_output_tokens ?? 16000;
		const maxInputTokens = limits.max_prompt_tokens ?? Math.max(1, context - maxOutputTokens);
		const multiplier = m.billing?.multiplier;
		result.push({
			id: m.id,
			name: m.name || m.id,
			family: m.id,
			version: m.id,
			maxInputTokens,
			maxOutputTokens,
			detail: typeof multiplier === 'number' ? `${multiplier}x` : undefined,
			tooltip: `GitHub Copilot · ${m.name || m.id}`,
			// The SDK runs its own agent loop; editor-provided tools are not forwarded.
			capabilities: { imageInput: false, toolCalling: false }
		});
	}
	return result;
}

/**
 * Splits the editor conversation into a system message and a single prompt for one
 * Copilot SDK turn. Prior turns are included as a transcript so context is kept.
 */
export function buildPrompt(messages: readonly PlainMessage[]): { system: string | undefined; prompt: string } {
	const system = messages.filter(m => m.role === 'system').map(m => m.text).filter(Boolean).join('\n\n') || undefined;
	const turns = messages.filter(m => m.role !== 'system' && m.text.trim().length > 0);
	if (turns.length === 0) {
		return { system, prompt: '' };
	}
	if (turns.length === 1) {
		return { system, prompt: turns[0].text };
	}
	const last = turns[turns.length - 1];
	const history = turns.slice(0, -1).map(m => `<${m.role}>\n${m.text}\n</${m.role}>`).join('\n');
	return {
		system,
		prompt: `<conversation_history>\n${history}\n</conversation_history>\n\n${last.role === 'user' ? last.text : `<${last.role}>\n${last.text}\n</${last.role}>`}`
	};
}

export type ErrorKind = 'signInRequired' | 'noSubscription' | 'rateLimited' | 'network' | 'runtimeMissing' | 'unknown';

/** Classifies an error coming from the Copilot SDK / runtime. */
export function classifyError(err: unknown): ErrorKind {
	const text = String((err as { message?: string })?.message ?? err ?? '');
	if (/not authenticated|unauthori[sz]ed|\b401\b|bad credentials|sign[ -]?in|no token|token (is )?(invalid|expired)/i.test(text)) {
		return 'signInRequired';
	}
	if (/\b403\b|forbidden|no (active )?copilot|not (have|has) (access|a subscription)|subscription|not entitled|access to copilot|copilot is not enabled/i.test(text)) {
		return 'noSubscription';
	}
	if (/\b429\b|rate.?limit|quota/i.test(text)) {
		return 'rateLimited';
	}
	if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|network|fetch failed|socket hang up/i.test(text)) {
		return 'network';
	}
	if (/Could not resolve @github\/copilot-sdk-|missing required Copilot CLI runtime|Unsupported Copilot CLI|Path to Copilot CLI is required/i.test(text)) {
		return 'runtimeMissing';
	}
	return 'unknown';
}

/** Removes anything that looks like a GitHub token from text before it is logged or shown. */
export function redactSecrets(text: string): string {
	return text.replace(/\b(gh[opusr]_|github_pat_)[A-Za-z0-9_]+/g, '$1[redacted]');
}

/**
 * Only GitHub user tokens are ever handed to the Copilot runtime: OAuth app tokens (gho_),
 * GitHub App user-to-server tokens (ghu_) and fine-grained personal access tokens (github_pat_).
 * Classic PATs (ghp_), server-to-server (ghs_) and refresh tokens (ghr_) are rejected.
 */
export function isAllowedToken(token: string | undefined): token is string {
	return typeof token === 'string' && /^(gho_|ghu_|github_pat_)[A-Za-z0-9_]+$/.test(token);
}

/** Rough token estimate (≈4 characters per token). */
export function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

/** Scope sets tried silently, in order, to reuse an existing Axiora GitHub sign-in. */
// The first set is the one Axiora's built-in GitHub/Git integration uses, so an existing editor
// sign-in is reused without a new device-code flow.
export const SILENT_SCOPE_SETS: readonly (readonly string[])[] = [
	['repo', 'workflow', 'user:email', 'read:user'],
	['read:user'],
	['user:email'],
	['read:user', 'user:email', 'repo', 'workflow'],
	['repo', 'workflow'],
	['repo'],
];

/**
 * Scopes requested when the user explicitly signs in for Copilot: the same scopes as the editor's
 * GitHub integration (extensions/github/src/auth.ts), so a single sign-in serves Git and Copilot.
 */
export const SIGN_IN_SCOPES: readonly string[] = ['repo', 'workflow', 'user:email', 'read:user'];
