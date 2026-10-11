# GitHub Copilot for Axiora Code (Copilot SDK engine)

Built-in extension that provides GitHub Copilot models to the Chat view through the
official [GitHub Copilot SDK](https://github.com/github/copilot-sdk) (`@github/copilot-sdk`, MIT),
authenticated with the user's GitHub sign-in from the Axiora Code GitHub OAuth app.

- Models appear in the Chat model picker under **GitHub Copilot** (vendor `axiora-copilot`).
- The SDK's own agent tools are disabled by default (`axiora.copilot.allowAgentTools: false`);
  every runtime permission request is denied.
- Turn it off with **Settings → GitHub Copilot (Axiora) → Enabled** (`axiora.copilot.enabled`, default `true`).
  When off, the provider is unregistered and the Copilot runtime is not started; the Chat view,
  BYOK (your own API keys) and Ollama are unaffected because they are provided by `extensions/copilot`.
- Only GitHub user tokens (`gho_`, `ghu_`, `github_pat_`) are passed to the runtime. The token is kept
  in memory and handed to the runtime process through an environment variable (never on the command
  line); it is never written to disk or to logs by this extension.
- Requires a GitHub Copilot plan on the user's account (Copilot Free is enough).

## Legacy engine

The legacy Copilot engine (`extensions/copilot`, GitHub.copilot-chat) is kept unchanged on disk.
Its Copilot service models are not used: they rely on GitHub's internal Copilot token endpoint,
which only accepts first-party clients. The legacy extension keeps hosting the Chat view,
BYOK providers and Ollama.

Switch engines with **GitHub Copilot (Axiora): Switch to the Legacy Copilot Engine** /
**Switch to the Copilot SDK Engine** (setting `axiora.copilot.engine`: `sdk` | `legacy`).

## Copilot runtime (downloaded on first use, not shipped)

The Copilot SDK talks to the GitHub Copilot CLI runtime. **Axiora Code does not ship this runtime.**
On first use (sign-in command, opening the model picker, sending a Copilot request, or
**Download Copilot Runtime**) the user is asked for consent; on "Download" the extension:

1. reads `copilotCliVersion` from the bundled `@github/copilot-sdk/package.json` (pinned version, today `1.0.95`);
2. fetches metadata for GitHub's official npm package `@github/copilot-<platform>` from `https://registry.npmjs.org`;
3. downloads the tarball (only from the same registry host, HTTPS) with a cancellable progress bar;
4. verifies it against the registry `dist.integrity` (sha512) and discards it on mismatch;
5. extracts it unmodified (no links, no paths outside the target) into a temp dir and atomically renames it to
   `<globalStorage>/runtime/copilot-<platform>-<version>/` with a `.verified` marker.

Fallback: only if npm is unreachable or returns an HTTP error, the standalone asset
`copilot-<platform>.tar.gz` (`.zip` on Windows) is downloaded from the official GitHub Release
`github/copilot-cli` `v<version>`. It must match both the release's `SHA256SUMS.txt` and the SHA-256 pinned in
`src/runtime.ts` (`PINNED_RELEASE_SHA256`); redirects are only accepted to GitHub's release asset hosts.
An integrity failure from npm never falls back.

Downloads use the extension host's global `fetch`, which the editor patches to follow `http.proxy` / system
proxy and system certificates (`http.fetchAdditionalSupport`, on by default). Not yet verified behind a real proxy.
Offline or blocked downloads show a clear error. **Remove Copilot Runtime** deletes the cache.
`axiora.copilot.runtimePath` can point to a runtime the user installed themselves.
Declining or a failed download only makes Copilot unavailable; Chat, BYOK and Ollama are unaffected.

## Licenses and notices

- `SDK-LICENSE.txt` – GitHub Copilot SDK (`@github/copilot-sdk` 1.0.19), MIT License, Copyright GitHub, Inc.
  This is the only GitHub package shipped with this extension (JavaScript only).
- `CLI-LICENSE.md` – reference copy of the GitHub Copilot CLI License (exact `LICENSE.md` of the npm package
  `@github/copilot@1.0.95`; current text: https://github.com/github/copilot-cli/blob/main/LICENSE.md).
  The CLI runtime is **not** contained in or redistributed with Axiora Code: the user downloads it directly from
  GitHub's npm package, which carries its own `LICENSE.md`, after being shown this license link in the consent prompt.
- "GitHub" and "Copilot" are trademarks of GitHub, Inc., used only to identify the service.
