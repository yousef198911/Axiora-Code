# AXIORA CODE — SEQUENTIAL EXECUTION, REPAIR, VERIFICATION & RELEASE READINESS REPORT

Date: 2026-10-11 (UTC). Environment: Linux x64 box with Xvfb. Node 24.18.0 (from `~/.nvm`; system Node 20 untouched). No Windows machine is available.

Git:
- Base `main` = `fd3e4150` (untouched).
- Checkpoint branch `axiora/exec-checkpoint-2026-10-11` = `fd3e4150`.
- Work branch `axiora/exec-work-2026-10-11` has local commits only. Nothing was pushed or merged to main.

## FINAL RESPONSE (10 POINTS)

1. **Status:** Axiora Code is a working VS Code fork on Linux. A clean isolated `npm ci` passes, `npm run compile` passes, and dev mode opens a real editor with the neutral "Choose Your AI" onboarding. Windows has never been built or run.
2. **Dev mode on this machine (Linux):** PASS. It runs from freshly compiled HEAD source plus one onboarding fix (screenshot `exec-en.png`).
3. **Fresh Windows clone:** NOT VERIFIED (no Windows host). The exact steps are in section 8. Linux results do not prove Windows.
4. **Scores:** Implementation completion **71% (PROVISIONAL, MEDIUM)**. Release readiness **60% (59.75%, MEDIUM)**. In the previous audit they were 68% and 51%.
5. **Feature counts (14):** 5 verified, 7 implemented but not fully verified, 1 partial, 0 missing, 2 not verified/blocked (Windows installer and portable). Continue is excluded because the user decided not to integrate it.
6. **Prerequisites:** Node 24.18.0, npm, Git, Python 3, and on Windows VS 2022 Build Tools (Desktop C++). Commands: `npm ci`, `npm run compile`, `scripts\code.bat` (`./scripts/code.sh` on Linux).
7. **AI improvements:**
   - (1) Defaults and hint suppression: TESTED.
   - (2) Choose Your AI: VERIFIED in onboarding at runtime. It is now the primary choice. Copilot and "Continue without Signing In" are kept.
   - (3) Ollama context-window message: IMPLEMENTED. The server error signature was confirmed and matches the detector, but the message was not seen in the UI.
   - (4) Continue: NOT STARTED, by user decision.
8. **Blockers:**
   - P1: no Windows build, installer or portable has ever been built or tested.
   - P1: the GitHub token exposed in chat must be revoked (steps in section 7).
   - P2: `licenseUrl`/`reportIssueUrl` still point to microsoft/vscode, because the Axiora repo is private and a private URL would 404 for users.
   - P2: Arabic was not shown in dev mode; it was verified only in an earlier packaged build.
9. **Next 5 tasks:**
   - (1) Revoke the token.
   - (2) Run the Windows steps: `npm ci`, `npm run compile`, `scripts\code.bat`.
   - (3) `npm run gulp vscode-win32-x64-min`, then the user-setup task. Install and test.
   - (4) Decide on a public URL for the licence and issue links.
   - (5) Trigger the context-window message in the UI (EN/AR) and rebuild the Linux package from the work branch.
10. **Reports:** `.axiora/reports/MASTER-PROJECT-EXECUTION-REPORT.md` and `.json` (on the work branch). Copies are in `/workspace/audit-output/`. Evidence: `/workspace/audit-output/exec-en.png`, `exec-ar.png`, and the logs listed in section 4.

## 1. BASELINE AND SECRET SCAN

- HEAD `fd3e4150`, tree clean, branch `main`. A checkpoint branch was created at HEAD, and work was done on `axiora/exec-work-2026-10-11`.
- Tracked-file secret scan (`git grep` for GitHub PAT, `sk-`, AWS `AKIA`, `xai-` and private-key patterns): 15 files matched. All are upstream test fixtures, secret-filter patterns, or example strings (for example `secretFilter.spec.ts`, `terminalEnvironment.test.ts`, `selfSignedCert.test.ts`). No real credentials were found. Values are not printed.
- The exposed GitHub PAT (shared earlier in chat) was not used, validated or transmitted.

## 2. ENVIRONMENT AND REPRODUCIBILITY

- `.nvmrc` = 24.18.0. Node 24.18.0 was found at `~/.nvm/versions/node/v24.18.0` and used through PATH. The system Node (20.19.2) was not changed.
- Isolated clean install: `git worktree add --detach /tmp/axiora-ci HEAD`, then `npm ci`.
  - Result: **PASS** (exit 0). Root added 1581 packages in 6 min. The copilot extension added 1149 packages. 0 `npm error` / `gyp ERR`.
  - `git status` in the worktree was clean afterwards, so the lockfiles were not modified.
  - The worktree was removed afterwards.
- FRESH DEPENDENCY INSTALL: **PASS (Linux)**. Windows: NOT VERIFIED.

## 3. COMPILE AND DEV STARTUP

- `npm run compile` (compile-client and compile-copilot, Node 24): **PASS**, exit 0, 0 errors, about 2 min (log `/tmp/axiora-compile.log`).
- `out/` now matches source: the icon font is byte-identical to `resources/axiora/codicon.ttf`, and the onboarding JS contains the new strings.
- Finding from the previous audit: the "Copilot-first" onboarding screenshot came from a **stale `out/`** compiled before commit `90563a0e`. The committed source already had the Choose-AI subtitle and buttons.
- Dev startup: `VSCODE_SKIP_PRELAUNCH=1 ./scripts/code.sh --user-data-dir <fresh tmp> --extensions-dir <tmp> --disable-gpu --no-sandbox` under Xvfb.
  - Result: **PASS**. Real workbench with explorer, editor and chat panel, plus the onboarding dialog.
  - Logs show only dbus/X11 noise and no workbench errors. All processes started by this run were killed. Pre-existing processes from other sessions were left alone.
- REAL EDITOR UI: **VERIFIED (Linux)**.

## 4. TESTS

| Test | Command | Result |
|---|---|---|
| Typecheck | `tsc --noEmit -p src/tsconfig.json` (after fix) | PASS |
| ESLint, changed files | `npx eslint <5 changed workbench files>` | PASS (0 problems) |
| Hygiene | `node build/hygiene.ts <changed files>` | PASS |
| Terminal initial hint unit | `./scripts/test.sh --run .../terminalInitialHint.test.ts` | PASS (5) |
| Chat browser suite | `./scripts/test.sh --runGlob "vs/workbench/contrib/chat/test/browser/**/*.test.js"` | 4547 pass, 15 pending, **10 fail** |
| Copilot conversation tests | `vitest --run --pool=forks src/extension/conversation/vscode-node/test/` | PASS (4 files, 20 tests) |

Classification of the 10 failures: **not Axiora regressions (environmental or pre-existing)**.
- 9 are `ChatListWidget` 5000 ms timeouts (sticky rows and scroll geometry under headless Xvfb).
- 1 is a `ChatStatusDashboard` date assertion (`Resets May 31 at`), which depends on the date and locale.
- None of the files involved were changed by Axiora: their last commit is the upstream import `e5853b1e`. P3.

Not run: full unit suite, integration/smoke tests, Windows tests.

## 5. AI VERIFICATION

- **5.1 Defaults and hints: TESTED.** `extensions/copilot/package.json` (BYOK/utility default) and `terminal.initialHint.contribution.ts`. The unit tests pass. Runtime absence of warnings was confirmed earlier at `29c6d869`.
- **5.2 Choose Your AI: VERIFIED (runtime, EN).**
  - Fix made: `src/vs/workbench/contrib/welcomeOnboarding/browser/onboardingVariationA.ts`.
    - "Use My Own API Key" (primary) and "Use a Local Model (Ollama)" are now rendered **above** the Copilot sign-in buttons.
    - "Continue with GitHub" is no longer the emphasized primary button.
    - GitHub, Google, Apple and GHE sign-in remain available, and "Continue without Signing In" is kept.
  - The buttons run `workbench.action.chat.chooseYourAI` (in `chooseYourAI.contribution.ts`), which can be opened again later.
  - API keys go through the Copilot BYOK provider flow (SecretStorage). The picker stores nothing itself.
  - AR keys for the new strings exist in `extensions/axiora-language-pack-ar/translations/main.i18n.json`. Dev mode did not apply the Arabic locale (`exec-ar.png` shows English), so Arabic is NOT VERIFIED here. It was previously verified in a packaged build at an earlier commit.
- **5.3 Local model and context message: IMPLEMENTED.**
  - Ollama 0.40.2 (`/tmp/ol`) with model `qwen2.5:0.5b`.
  - With `num_ctx=512` and a ~6000-token prompt, `/api/chat` returns HTTP 400 `exceed_context_size_error` ("request exceeds the available context size"). That matches the detector at `extensions/copilot/src/extension/conversation/vscode-node/languageModelAccess.ts:1073`.
  - A missing model returns 404 `model 'x' not found`.
  - The Ollama OpenAI endpoint with the server default context did not error; it truncated instead.
  - The friendly message was NOT observed in the chat UI in either EN or AR: UI automation of a configured Ollama chat was not done this run.
  - The missing-server case was not tested (the server was running).
- **5.4 Continue: NOT STARTED (deliberate).** No references remain in source.

## 6. EXTERNAL SERVICES (key names only)

| Service | Config | Status |
|---|---|---|
| Open VSX | `product.json` extensionsGallery.serviceUrl/itemUrl/latestUrlTemplate | Configured; install verified at an earlier commit |
| OpenAI/Anthropic/Gemini/xAI/OpenRouter/Custom | Copilot BYOK providers, SecretStorage | Implemented; no paid calls made (by rule); NOT VERIFIED |
| Ollama | `http://localhost:11434` | Server-side verified this run |
| GitHub Copilot / auth | built-in auth | Optional; not tested with an account |
| npm registry, Electron, ripgrep downloads | build time | Worked during `npm ci` |
| Auto-update | no updateUrl | Not applicable |

## 7. SECURITY, BRANDING, LICENSING

- **Exposed GitHub token (P1).** Revocation steps:
  1. GitHub → Settings → Developer settings → Personal access tokens.
  2. Find the token and click Delete/Revoke.
  3. Create a new fine-grained token limited to `Axiora-Code` with only the scopes needed.
  4. Check Settings → Security log for unexpected use.
  - Never paste tokens into chat.
- **`licenseUrl` / `reportIssueUrl` (P2): left unchanged on purpose.** They point to microsoft/vscode. The Axiora repo is private, so pointing users there would 404. Options:
  - (a) Make the repo or a docs repo public, then set `licenseUrl` to `.../Axiora-Code/blob/main/LICENSE.txt` and `reportIssueUrl` to `.../Axiora-Code/issues/new`.
  - (b) Use a website URL.
  - Needs the owner's decision.
- Identifiers kept: package name `code-oss-dev` and the technical IDs. User-facing IDs are consistent (Axiora Code, axiora-code, com.axiora.code, Axiora.AxioraCode).
- **Extension signature verification (P2):** effectively off, which is typical for Open VSX forks. Trade-off: Open VSX does not provide Microsoft-signed packages. Enabling verification would block most installs. Document the risk and consider enabling it once Open VSX signing is supported.
- **Licensing:**
  - Root licence is MIT (Code-OSS).
  - The copilot extension reads "SEE LICENSE IN LICENSE.txt", and that file is MIT (Microsoft).
  - Bundled third-party notices are inherited.
  - Trademarks: the "GitHub Copilot" name is used for an optional provider. Review this.
  - This is not legal approval.

## 8. WINDOWS

- Verdicts:
  - WINDOWS FRESH-CLONE STARTUP: NOT VERIFIED
  - PRODUCTION BUILD (Windows): NOT VERIFIED
  - WINDOWS INSTALLER: NOT VERIFIED
  - WINDOWS PORTABLE: NOT VERIFIED
- Reason: Linux host only. Cross-building Windows native modules is not supported, so it was not attempted. CI is disabled and pushing is forbidden.
- Task names (verified in source):
  - `vscode-win32-x64-min` (generated in `build/gulpfile.vscode.ts:741-752`)
  - `vscode-win32-x64-inno-updater` (`build/gulpfile.vscode.win32.ts:156`)
  - `vscode-win32-x64-user-setup` and `vscode-win32-x64-system-setup` (`:134`)
- Exact Windows steps (PowerShell):
  1. Install Node 24.18.0 x64, Git, Python 3, and VS 2022 Build Tools with "Desktop development with C++".
  2. `git config --global core.longpaths true`
  3. `git clone https://github.com/yousef198911/Axiora-Code.git`
  4. `cd Axiora-Code` then `git checkout axiora/exec-work-2026-10-11` (after it is pushed), or use `main`.
  5. `npm ci`
  6. `npm run compile`
  7. `scripts\code.bat` (dev mode)
  8. `npm run gulp vscode-win32-x64-min`. Output: `..\VSCode-win32-x64\`. Zip this folder to make the portable build.
  9. `npm run gulp vscode-win32-x64-inno-updater`, then `npm run gulp vscode-win32-x64-user-setup`. Output: `.build\win32-x64\user-setup\AxioraCodeUserSetup-*.exe` (name per product.json).
- PRODUCTION BUILD (Linux): PASS from earlier evidence (`/workspace/VSCode-linux-x64`, labelled `eb3f78c5`, icon font equal to `fd3e4150`). It was not rebuilt with this run's fix.

## 9. CHANGES MADE

- `onboardingVariationA.ts` (+9/−7): neutral AI choices first, BYOK primary, GitHub button de-emphasized.
- New `.axiora/reports/MASTER-PROJECT-EXECUTION-REPORT.md` and `.json`.
- All changes are committed locally on `axiora/exec-work-2026-10-11` and are **not pushed, not merged**. `main` is unchanged at `fd3e4150`.
- To review: `git diff main..axiora/exec-work-2026-10-11`.

## 10. SCORES

**Implementation completion (PROVISIONAL: no written requirements inventory; list reconstructed):**

| # | Feature | Score |
|---|---|---|
| 1 | Branding | 100 |
| 2 | Open VSX | 75 |
| 3 | Icon redesign (626) | 75 |
| 4 | Layout toggle icons | 100 |
| 5 | Panel alignment icons | 100 |
| 6 | Arabic pack | 75 |
| 7 | AI1 defaults/hints | 75 |
| 8 | AI2 Choose Your AI picker | 75 |
| 9 | AI3 Ollama/context message | 75 |
| 10 | Onboarding without auth, AI-neutral | 100 |
| 11 | Linux dev startup | 100 |
| 12 | Upstream URL cleanup | 50 |
| 13 | Windows installer | 0 |
| 14 | Windows portable | 0 |

Total: 1000 / 14 = **71.4%**. Continue is excluded by user decision.

**Release readiness:**

| Category | Weight | Score | Points | Evidence |
|---|---|---|---|---|
| Clean-clone reproducibility | 15 | 75% | 11.25 | `npm ci` and compile PASS on Linux with Node 24; Windows unverified |
| Development startup | 20 | 70% | 14.0 | Linux PASS; Windows unverified |
| Core editor | 20 | 75% | 15.0 | Real UI; 4547 chat tests pass |
| AI and integrations | 15 | 60% | 9.0 | Onboarding verified; cloud keys, Copilot and UI context message unverified |
| Tests and reliability | 10 | 55% | 5.5 | tsc, eslint, hygiene, focused suites; 10 env failures; no CI or full suite |
| Security and licensing | 10 | 50% | 5.0 | Token not yet revoked; upstream URLs; licence review pending |
| Windows packaging | 10 | 0% | 0.0 | Never built |
| **Total** | 100 | | **59.75%** | |

Confidence: **MEDIUM**.
