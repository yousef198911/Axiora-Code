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

## Licenses and notices

- `SDK-LICENSE.txt` – GitHub Copilot SDK (`@github/copilot-sdk` 1.0.19), MIT License, Copyright GitHub, Inc.
- `CLI-LICENSE.md` – GitHub Copilot CLI License, exact text of `LICENSE.md` from the npm package
  `@github/copilot@1.0.95` (https://www.npmjs.com/package/@github/copilot), the CLI version contained in
  the bundled runtime `@github/copilot-sdk-<platform>@1.0.19`. The runtime is redistributed **unmodified**,
  solely as part of Axiora Code (an editor with material functionality beyond the runtime), not on a
  standalone basis. All copyright, trademark and attribution notices in the runtime are retained.
- "GitHub" and "Copilot" are trademarks of GitHub, Inc., used only to identify the service.
