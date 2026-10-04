# pi-voice

Selectable response voices for [Pi](https://pi.dev). Change how your assistant responds without changing how thoroughly it works.

## Install

```sh
pi install git:github.com/dys-org/pi-voice@v0.1.0
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

Presets live in `voices/<name>.md`. The first line is the picker description; the remaining Markdown is the prompt. To add a preset in a local checkout, add a Markdown file and reload Pi. `default` is reserved and always means no added instructions.

## Compatibility

`/output-style` and `/output-styles` remain aliases for `/voice`. If `voice.json` is absent, the extension reads the previous `output-style.json` state. New selections write only `voice.json`.

Remove or disable the old standalone output-style extension before loading this package to avoid duplicate commands and prompt instructions. The original extension had inline presets, not an external styles directory.

## Development

```sh
npm test
```

Tests use Node.js 22.13+ and require no installed dependencies. Pi supplies the runtime peer dependency and loads TypeScript directly.

## License

MIT
