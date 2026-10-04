# Third-party notices

This repository is released under the MIT License (see `LICENSE`). Parts of it are adapted from
the 9Router Agent Link Paseo plugin, also MIT-licensed:

Source: `paseo-plugin-9router` (itsjustanks/paseo-plugin-9router), version 0.16.0.

`tests/fixtures/omniroute-3.8.50.json` and `tests/fixtures/omniroute-3.8.51-settings.json` hold redacted
responses from a live OmniRoute (MIT) server, with identifiers replaced.

| In this repository | Adapted from |
| --- | --- |
| `apps/paseo/client/ui.tsx` (Card, Chip, Button, Field, Note) | `apps/paseo/client/ui.tsx` |
| `apps/paseo/server/store.ts` (`settingsDir`, reading the daemon's settings envelope) | `apps/paseo/server/hooks.ts` (`routingSettingsPath`, `readRoutingSettings`) |
| `apps/paseo/shared/logic.ts` (`parseRoutingEnvelope`) | `apps/paseo/shared/routing-logic.ts` |
| `apps/paseo/server/hooks.ts` (the `agent.session_open` env rewrite) | `apps/paseo/server/hooks.ts` |
| `apps/paseo/shared/logic.ts` (`aiRouterProviderEntry`: a Claude-derived provider owning the router's model list) | `apps/paseo/server/handlers.ts` (`handleRouterSyncModels`) |
| `apps/paseo/tests/hook-order/*`, `tests/hook-order.mjs` | the same paths |
| `tests/logic.mjs` (transpile-and-import pattern) | `tests/routing-logic.mjs` |
| `.github/workflows/ci.yml`, `apps/paseo/tsconfig.json` | the same paths |

```
MIT License

Copyright (c) 2026 itsjustanks

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

`apps/paseo/assets/ai-router.svg` (the AI Router card icon on Paseo's Usage page) is Lucide's `route` icon
(https://lucide.dev/icons/route), under the ISC License:

```
ISC License

Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```
