# GitHub Copilot for Axiora Code (Copilot SDK engine)

Built-in extension that provides GitHub Copilot models to the Chat view through the
official [GitHub Copilot SDK](https://github.com/github/copilot-sdk) (`@github/copilot-sdk`, MIT),
authenticated with the user's GitHub sign-in from the Axiora Code GitHub OAuth app.

- Models appear in the Chat model picker under **GitHub Copilot** (vendor `axiora-copilot`).
- The SDK's own agent tools are disabled by default (`axiora.copilot.allowAgentTools: false`);
  every runtime permission request is denied.
- Requires a GitHub Copilot plan on the user's account (Copilot Free is enough).

## Legacy engine

The legacy Copilot engine (`extensions/copilot`, GitHub.copilot-chat) is kept unchanged on disk.
Its Copilot service models are not used: they rely on GitHub's internal Copilot token endpoint,
which only accepts first-party clients. The legacy extension keeps hosting the Chat view,
BYOK providers and Ollama.

Switch engines with **GitHub Copilot (Axiora): Switch to the Legacy Copilot Engine** /
**Switch to the Copilot SDK Engine** (setting `axiora.copilot.engine`: `sdk` | `legacy`).

## Licenses

- `SDK-LICENSE.txt` – Copilot SDK (MIT).
- `CLI-LICENSE.md` – GitHub Copilot CLI License covering the bundled runtime
  (`@github/copilot-sdk-<platform>`), redistributed unmodified as part of Axiora Code.
