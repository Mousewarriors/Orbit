# Product Spec

## Vision

Orbit is the universal command layer for a computer. Instead of opening apps and
navigating menus, the user summons Orbit with one shortcut and expresses an
intention — open an app, find a file, move a window, paste something copied
earlier, calculate a value, ask AI, run an automation. Orbit should feel like an
intelligent operating-system layer, not another application.

## Principles

1. **Keyboard first** — every major action is reachable without the mouse.
2. **Instant** — open, type, navigate and execute feel immediate (see targets).
3. **Local first** — local features keep working with no internet.
4. **Search driven** — the UI progressively reveals actions by intent.
5. **Extensible** — built-ins and third-party extensions share one command model.
6. **Secure by default** — extensions/agents/scripts/MCP run within explicit
   permissions.
7. **Context aware** — commands understand selection, active app, clipboard,
   browser tab and file, where permitted.
8. **Calm** — compact, elegant, no dashboard clutter.
9. **Predictable** — consistent keys, navigation, actions, errors.
10. **Inspectable** — the user can see what an extension/tool/automation will do.

## Performance targets

| Metric | Target |
| --- | --- |
| Launcher visible after hotkey | < 100 ms |
| Local root results after keystroke | < 50 ms |
| Input latency | < 16 ms |
| Selection movement | 60 fps |
| Extension warm start | < 150 ms |

Benchmarked against 2,000 apps/commands, 100,000 files, 10,000 clipboard
entries, 5,000 Quicklinks/snippets, 250 extensions.

## Interaction model (defaults)

- `Alt+Space` (Windows) / configurable — toggle launcher
- `Enter` — primary action · `Ctrl/Cmd+K` — Action Panel
- `Esc` — clear query, then close · `↑/↓` — move selection

## Scope status

This document is the north star. Implemented vs. planned is tracked honestly in
[FEATURE_MATRIX.md](../FEATURE_MATRIX.md); the phased path is in
[IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).
