# pi-voice

Selectable response voices for [Pi](https://pi.dev). Change how your assistant responds without changing how thoroughly it works.

## Install

```sh
pi install git:github.com/dys-org/pi-voice@v0.3.1
```

Run `/reload` in an existing Pi session, or restart Pi.

## Usage

Run `/voice` to open the picker, or select directly:

```text
/voice concise
/voice proactive
/voice explanatory
/voice learning
/voice default
```

| Voice | Behavior |
| --- | --- |
| `default` | No added voice instructions |
| `concise` | Short, direct, result-first responses |
| `proactive` | Autonomous work with fewer interruptions; keeps safety boundaries |
| `explanatory` | Brief, codebase-specific implementation insights |
| `learning` | Small hands-on coding exercises; pauses for your contribution |

Selections apply on the next turn and persist across sessions in `~/.pi/agent/voice.json` (or the directory specified by `PI_CODING_AGENT_DIR`). Concurrent sessions save atomically; the last save wins, while running sessions retain their own selection until restarted or changed.

## Voice files

Add your own voices in **`~/.pi/agent/voices/<name>.md`**—no package edits needed. If you use `PI_CODING_AGENT_DIR`, put the `voices/` directory inside that agent directory instead.

For example, create `~/.pi/agent/voices/warm.md`:

```md
---
description: Warm and conversational
---

Use a friendly, conversational tone. Keep explanations clear and avoid excessive enthusiasm.
```

Run `/reload`, then `/voice warm`. YAML frontmatter must contain a nonempty string `description`; the Markdown body is the prompt and must be nonempty. Standard YAML quoting and multiline descriptions are supported.

- Personal files override bundled `voices/*.md` presets with the same filename. For example, `concise.md` replaces the built-in concise voice.
- `default` is reserved and cannot be overridden.
- Only `.md` files directly inside the personal directory are loaded. Project voices are not loaded.
- Unreadable or invalid files produce a warning and are skipped; an invalid override leaves the built-in intact.
- Voices are refreshed on session startup and `/reload`. Adding, editing, or deleting a file requires a reload to affect a running session.
- Removing a selected personal voice falls back to `default` with a warning unless a built-in voice has the same name.
- Personal voices live outside the managed package checkout and survive package updates.

## Migrating from v0.2.0

Voice files now require YAML frontmatter. The old first-line-description syntax is not supported. Convert existing personal files manually: move the description into frontmatter as shown above, leaving the prompt in the Markdown body. User files are not automatically rewritten. Invalid old-format overrides leave built-ins intact; an invalid personal-only selected voice falls back to `default` with a warning.

## Compatibility

`/output-style` and `/output-styles` remain aliases for `/voice`. If `voice.json` is absent, the extension reads the previous `output-style.json` state. New selections write only `voice.json`.

Remove or disable the old standalone output-style extension before loading this package to avoid duplicate commands and prompt instructions. The original extension had inline presets, not an external styles directory.

## Development

```sh
pnpm install --frozen-lockfile
pnpm test
```

Use pnpm 11.25.0 (pinned in `package.json`). Dependency build scripts for `@google/genai`, `esbuild`, and `protobufjs` are explicitly disabled in `pnpm-workspace.yaml`; the tests do not require them. Tests use Node.js 22.19+ and the real public `parseFrontmatter` export from Pi 1.x, installed as a development dependency. At runtime, Pi supplies this helper and loads TypeScript directly; this extension has no runtime dependencies.

## License

MIT
