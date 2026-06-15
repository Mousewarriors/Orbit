# @orbit/cli

The `orbit` CLI for scaffolding, validating, and packaging Orbit extensions.

```
orbit extension create <name> --template <no-view|list|detail|preferences|storage>
orbit extension validate [dir]
orbit extension build [dir]
orbit extension dev [dir]
orbit extension package [dir] [--out <zip>]
orbit extension logs [dir] [--limit <n>]
```

`create` emits a working extension (valid `manifest.json` + `index.mjs`
importing `@orbit/api`) that runs with no manual repair. `package` produces a
distributable `.zip` using a dependency-free built-in ZIP writer (`node:zlib`).

See [`docs/architecture/EXTENSION_SDK.md`](../../docs/architecture/EXTENSION_SDK.md)
for details.
