# c

Pick a Claude Code account and launch it, showing each account's 5-hour and
weekly usage with the time until reset. One command in place of a drawer full
of `CLAUDE_CONFIG_DIR=... claude` aliases.

```
$ c

   account   plan       5h  week  resets in
→1 personal  max 20x   26%    3%  2h 27m
 2 work      max 5x    71%   44%  41m
 3 team      pro        4%    1%  3h 12m

  yolo on · worktree off  ·  [enter] personal   ↑↓ move   1-3 pick   y yolo   w worktree   r refresh   q quit
```

## Install

```bash
npm install -g @tonoid/c
```

Or run it without installing: `npx @tonoid/c`. Node 18 or newer, no
dependencies. Linux; see [Limitations](#limitations) for macOS.

npm is the only distribution channel: no Homebrew tap, no apt repo, no
install script. It is one file, so a checkout on your `PATH` works just as
well (see [Development](#development)).

`c`, not `cc`, because `cc` is the C compiler. A real command on `PATH` rather
than a shell alias, so it works from scripts and from any shell, not just an
interactive one. If the single letter collides with something of yours, rename
the installed binary and set `CMD` at the top of `c.mjs` to match: every
message reads from it.

## Commands

| Command | Description |
|---|---|
| `c` | Usage table, pick an account. Enter takes the top row, which is the one used last. |
| `c <args...>` | Skip the menu: last-used account, everything passed through to `claude`. `c --resume`, `c --worktree`, `c "fix the failing test"`. |
| `c -a <id> [args...]` | A specific account, by id or display name. |
| `c status` | Table only. Also `c ls`. |
| `c add <id>` | Create `~/.claude-<id>` and log in to it. |
| `c yolo [on\|off]` | Toggle the `--dangerously-skip-permissions` default. On. |
| `c worktree [on\|off]` | Toggle the `--worktree` default, a git worktree per session. Off. |
| `c version`, `c help` | |

In the menu: ↑↓ move the arrow (wrapping at both ends), enter launches the
marked account, 1-9 pick a row outright, `y` toggles yolo, `w` toggles
worktree, `r` refetches usage, `q` quits. Every key redraws the block in
place instead of printing another copy of it.

Both defaults are remembered, and both are skipped when you type the flag
yourself, so `c --worktree` with the default already on still passes it once.

## How it works

Every `~/.claude*` directory holding a `.credentials.json` is an account, so
there is nothing to register: `c add work`, or any manual `CLAUDE_CONFIG_DIR`
login, just shows up. Directories without credentials (plugin caches such as
`~/.claude-mem`) are ignored.

Rows sort most-recently-used first, so `c` then enter is always the account you
were just in.

Usage comes from `GET https://api.anthropic.com/api/oauth/usage`, authenticated
with the OAuth token Claude Code already wrote into each config directory. Same
data as `/usage` inside a session. It is an undocumented endpoint: if Anthropic
changes it, the usage columns show an error and picking and launching still
work.

Launching sets `CLAUDE_CONFIG_DIR` for the child process only, so two terminals
can run two accounts at once.

## State

`~/.config/c/db.json`: `order` (most-recently-used ids), the `yolo` and
`worktree` flag defaults, and cached `usage`. Refetched when older than 60s, or
on `r`. Delete the file to reset. Nothing else is written, and no credential
ever leaves the machine except as the `authorization` header on the usage call.

Another remembered claude flag is one line: add it to `FLAGS` in `c.mjs` and it
gets a `c <name> [on|off]` subcommand and a db field for free.

## Limitations

- Subcommand names shadow prompts. `c status` prints the table; to send that
  word as a prompt use `c -a main status`.
- macOS keeps Claude Code credentials in the Keychain rather than in
  `.credentials.json`, so discovery finds nothing there. Linux only for now.
- The menu assumes its footer fits on one terminal line; a very narrow window
  can leave a stale line behind on redraw.

## Development

```bash
git clone https://github.com/tonoid/c
cd c
npm test
```

The suite is `node:test` and `node:assert` only. It builds throwaway `HOME`
directories with fake config dirs, so it never reads or writes real accounts
and never calls the network.

To run the checkout as the real command, so `git pull` updates it:

```bash
ln -s "$PWD/c.mjs" ~/.local/bin/c
```

## Releasing

Versions come from the commit messages, so land work on `main` with
[conventional commits](https://www.conventionalcommits.org):

| Prefix | Effect |
|---|---|
| `fix: ...` | patch, 1.0.0 to 1.0.1 |
| `feat: ...` | minor, 1.0.0 to 1.1.0 |
| `feat!: ...` or a `BREAKING CHANGE:` footer | major, 1.0.0 to 2.0.0 |
| `docs:`, `chore:`, `test:`, `refactor:` | no release |

The `release` workflow runs release-please on every push to `main`. It keeps a
single release PR open ("chore(main): release X.Y.Z") holding the version bump
in `package.json` and the new `CHANGELOG.md` section. Nothing publishes while
that PR sits there. Merging it tags `vX.Y.Z`, cuts the GitHub release, and
triggers the publish job, which runs the suite and then `npm publish` with the
`NPM_TOKEN` repository secret.

`release-please-config.json` and `.release-please-manifest.json` hold the
release type and the current version. The manifest is the source of truth for
what ships next, so let release-please edit it rather than bumping
`package.json` by hand.

Two one-time prerequisites: the `NPM_TOKEN` secret, and "Allow GitHub Actions
to create and approve pull requests" enabled in the repository's Actions
settings, without which release-please cannot open its PR. The very first
publish of a scoped package also has to be done by hand (`npm publish`) so npm
records it as public.

## License

MIT
