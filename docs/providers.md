# Provider setup

Install and sign in to at least one supported agent before using MonoCode. MonoCode runs the CLIs you install and reuses their existing logins.

Follow each provider’s linked installation guide for platform requirements and installation options. Use the installation and login commands below where provided.

- [Claude Code](https://claude.com/product/claude-code) - `claude auth login`
- [Codex](https://developers.openai.com/codex/cli) - `codex login`
- [Antigravity](https://antigravity.google/docs/cli-install) (macOS/Linux) - `curl -fsSL https://antigravity.google/cli/install.sh | bash`, then run `agy` once to sign in
- [Pi](https://pi.dev/) - `npm install -g @earendil-works/pi-coding-agent`
- [omp](https://omp.sh) - `curl -fsSL https://omp.sh/install | sh`

One provider is enough. MonoCode probes for each CLI at startup and disables the ones it can’t find, with a hint about how to install them, so a missing Codex doesn’t stop you from working on anything else.

Once a provider is installed and signed in, open a project folder in MonoCode, choose that agent, and send a message. For sessions on another machine, install and authenticate the providers on the host as described in [remote access](remote-access.md).

In **Settings → Providers**, use **Models** beside an agent to choose which models appear in pickers, favorites, and recent choices. Search for a model and uncheck it to hide it; **Show all** restores the list. The Global/project scope applies to model visibility too, and a model hidden globally stays hidden in every project. Existing conversations keep their selected model.

To run MonoCode from a checkout, see [building from source](building.md). Return to the [README](../README.md) for desktop downloads.

## GitHub Copilot credentials

On macOS and Linux, desktop launches do not inherit your interactive shell environment. MonoCode forwards `COPILOT_GITHUB_TOKEN` from that shell to every provider process when the app environment lacks the variable. An inherited value takes precedence.

Export `COPILOT_GITHUB_TOKEN` in your shell configuration before you start MonoCode. Restart MonoCode after you change the token.
