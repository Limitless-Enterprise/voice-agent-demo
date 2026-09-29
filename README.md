# Voice agent demo

Static **Limitless Enterprise** test shell for ElevenLabs ConvAI, with a promo bubble via a single custom element embed. The demo page uses the dark Limitless layout; per-agent promo copy and colors (e.g. **Purple Basil Medspa / Mia**) come from operator-hosted JSON, not from the page theme.

## Local development

```bash
pnpm install
pnpm dev
```

Then open:

- **Same machine:** [http://127.0.0.1:3000](http://127.0.0.1:3000) or [http://localhost:3000](http://localhost:3000)
- **Cursor remote / dev container:** run `pnpm dev` in your **integrated terminal** (not a one-off agent command). In the **Ports** panel, forward port **3000** and open the forwarded URL.

The dev server binds `0.0.0.0:3000` so port forwarding and localhost both work.

### Connection refused?

Usually nothing is listening on port 3000:

1. Stop any stale process: `fuser -k 3000/tcp 2>/dev/null` (Linux) or quit the terminal where `pnpm dev` was running.
2. From the project root, run `pnpm dev` and leave that terminal open until you see `Accepting connections at http://0.0.0.0:3000`.
3. Verify: `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/` should print `200`.

Background dev servers started by the agent often exit after the session idles; use your own terminal for a stable server.

## Limitless ConvAI pill (recommended)

One script tag and one custom element — same ergonomics as ElevenLabs’ `<elevenlabs-convai>` pattern. The embed:

1. Registers `<limitless-convai-pill>` and reads **`agent-id`** from the element.
2. Appends `<elevenlabs-convai agent-id="…">` as a **direct child of `<body>`** (even if the pill sits elsewhere in your markup).
3. Loads `@elevenlabs/convai-widget-embed` **once** if it is not already on the page.
4. Shows the dismissible promo bubble and loads copy from operator-hosted JSON (see **Config URL resolution** below).

### Quick start

Host `embed/limitless-convai-pill.js` and per-agent JSON on your Limitless origin, then add:

```html
<script
  src="https://YOUR_LIMITLESS_ORIGIN/embed/limitless-convai-pill.js"
  defer
  type="text/javascript"
></script>
<limitless-convai-pill agent-id="YOUR_AGENT_ID"></limitless-convai-pill>
```

This matches [`index.html`](index.html) in this repo (same-origin script path). The demo wires agent id **`agent_9201kvqe56a2ebwafvj92w81xy68`** (Purple Basil / Mia on ElevenLabs); promo copy and spa styling live at [`config/agents/agent_9201kvqe56a2ebwafvj92w81xy68.json`](config/agents/agent_9201kvqe56a2ebwafvj92w81xy68.json), independent of the Limitless-branded page shell.

Keep the **script and pill as direct children of `<body>`** when you can, so the widget’s fixed panel is not clipped by transformed ancestors.

Clients do **not** configure where agent JSON lives — Limitless hosts `{origin}/config/agents/{agentId}.json` on the same origin as the embed script.

### Config URL resolution

The embed resolves the config base from **where the pill script was loaded**, not from `data-*` attributes on the tag:

| Embed script URL | Config fetch base |
| --- | --- |
| `https://cdn.example.com/embed/limitless-convai-pill.js` | `https://cdn.example.com/config/agents` |
| `http://localhost:3000/embed/limitless-convai-pill.js` | `http://localhost:3000/config/agents` |

For agent id `YOUR_AGENT_ID`, the promo loads:

`{config base}/{YOUR_AGENT_ID}.json`

Implementation detail (operator-side constant in `limitless-convai-pill.js`): path segment `/config/agents` is appended to the script URL’s **origin**. Deploy JSON alongside the embed on that origin (this demo serves files from `config/agents/`).

**Example client config** in this repo:

| Client | File | Notes |
| --- | --- | --- |
| [Purple Basil Medspa](https://purplebasilmedspa.com/) — Mia | `config/agents/agent_9201kvqe56a2ebwafvj92w81xy68.json` | Light spa palette (plum `#6E3F58`); loaded by the pill on the demo |

### How `agent-id` flows

| Step | Source | Use |
| --- | --- | --- |
| 1 | `agent-id` on `<limitless-convai-pill>` | Required; drives widget and config fetch |
| 2 | Injected `<elevenlabs-convai agent-id="…">` | Same value; ElevenLabs widget reads it |
| 3 | Config request | `{script origin}/config/agents/{agentId}.json` |

Optional **`headline`**, **`body`**, and other promo settings on the **pill element** override remote JSON and built-in defaults.

### Remote copy JSON (API contract)

Each agent has a static JSON file (or equivalent API response) with this shape:

```json
{
  "headline": "Hi, I'm Mia",
  "body": "Ask about booking, treatments, or a personalized consultation at Purple Basil.",
  "styles": {
    "accentColor": "#6E3F58",
    "background": "rgba(255, 252, 253, 0.97)",
    "borderColor": "rgba(166, 113, 138, 0.5)",
    "textColor": "#1f161c",
    "closeColor": "#A6718A"
  }
}
```

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `headline` | string | no | First line in the rotation (styled as headline) |
| `body` | string | no | Second line in the rotation |
| `styles` | object | no | Promo bubble colors (see below) |

**`styles` object** (all keys optional; invalid color strings are ignored):

| JSON key | CSS custom property | Default (when omitted) |
| --- | --- | --- |
| `accentColor` | `--promo-accent` | `#3d9a8b` (headline, focus ring) |
| `background` | `--promo-bg` | `rgba(12,18,24,0.92)` |
| `borderColor` | `--promo-border` | `rgba(61,154,139,0.4)` |
| `textColor` | `--promo-text` | `#e8eef3` (body text, close hover) |
| `closeColor` | `--promo-close` | `#9aadb8` |

Colors must be `#rgb`, `#rrggbb`, `#rrggbbaa`, or valid `rgb` / `rgba` / `hsl` / `hsla` strings. Styles are set on the promo element only (not the ElevenLabs widget). Clients never pass style attributes — only operator-hosted JSON.

Example second agent (docs only):

```json
{
  "headline": "Need a hand?",
  "body": "I can walk you through setup.",
  "styles": {
    "accentColor": "#7c6cf0",
    "background": "rgba(20, 16, 32, 0.93)",
    "borderColor": "rgba(124, 108, 240, 0.35)",
    "textColor": "#f0eef8"
  }
}
```

Missing fields are ignored; if the fetch fails, the embed uses attributes on the pill (or built-in defaults) and default promo colors.

### Pill element attributes

Required **`agent-id`**:

```html
<limitless-convai-pill
  agent-id="YOUR_AGENT_ID"
  headline="Welcome back"
  body="Ask me anything."
></limitless-convai-pill>
```

| Attribute | Default | Description |
| --- | --- | --- |
| `agent-id` | — | Required ElevenLabs agent id |
| `headline` | `Hi I am Mia` | Fallback headline (before/without remote JSON) |
| `body` | `How can I help you today?` | Fallback body |
| `storage-key` | `widget-promo-dismissed` | `localStorage` key; value is dismiss time (ms since epoch). Promo stays hidden for **7 days**, then shows again. |
| `region-aria-label` | `Assistant availability` | Promo region `aria-label` |
| `close-aria-label` | `Dismiss` | Close button `aria-label` |

### Multiple pills

The embed supports more than one pill (unusual). Each pill injects its own ElevenLabs widget. Promo nodes use distinct IDs when multiple pills are present (suffix from `agent-id` or `storage-key`).

### Idempotency

- **`customElements.define`** is guarded if the script runs twice.
- **ElevenLabs embed** is injected at most once (`limitless-convai-elevenlabs-embed` script id, or reuse of an existing `@elevenlabs/convai-widget-embed` tag).
- Each pill instance mounts only once (`_limitlessMounted`).

---

## npm / unpkg

Package metadata lives in [`embed/package.json`](embed/package.json):

- **main / unpkg:** `limitless-convai-pill.js`
