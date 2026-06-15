# @orbit/api

The Orbit Extension SDK — a typed, ergonomic layer over the v1 one-shot
extension protocol.

```js
import { defineExtension, List, Action, showToast } from "@orbit/api";

const ext = defineExtension({
  commands: {
    search: (ctx) =>
      List(List.Item({ title: "Hello", actions: [Action.CopyToClipboard("hi")] })),
  },
});

await ext.run();
```

See [`docs/architecture/EXTENSION_SDK.md`](../../docs/architecture/EXTENSION_SDK.md)
for the full API surface, what protocol v1 supports vs. defers, and a
write-your-first-extension walkthrough.
