# How to write artboards for the design canvas

The canvas is a set of files under `project/` in this folder:
`/tmp/claude-0/-home-user-Competitive-Response-OS/cd408d1f-f189-53bc-a33b-3f0ac1a3e72c/scratchpad/canvas/`

## Index: `project/canvas.json`

```json
{"v":3,"createdOnFiles":{"v":1,"at":"<now RFC3339>"},"title":"Competitive Response OS — Prototype",
 "launch":{"view":"canvas"},"pages":[],
 "boards":{"Main.dc.html":{"x":0,"y":0,"w":1440,"h":1000,"title":"…","expand":"fill","is_interactive":true}},
 "order":["Main.dc.html"],"notes":{},"designSystems":[]}
```

- `boards`: one entry per artboard file. `x`,`y`,`w`,`h` = frame on the canvas in CSS px. 80 px gap between frames in a row, 120 px between rows.
- `expand: "fill"` = a fluid PAGE (web app screen). `h` = its height at width `w`. Use w = 1440.
- `is_interactive: true` only for artboards with working handlers/links.
- `notes`: `{"id":{"x":0,"y":-300,"text":"Signal & evidence","kind":"title1","maxW":3000}}` — a title for a ROW of artboards; at least 223 px above the row. Stickies: no `kind`, set `w`.
- First artboard must be `Main.dc.html` (the entry).
- File names: letters/digits/`_` start, then `.`,`-`; end `.dc.html`; no spaces; unique stems.

## Artboard file skeleton (each `project/<Name>.dc.html`)

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Signal Inbox</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=...&display=swap" rel="stylesheet">
<style>
body{margin:0}
a{color:#2952cc}a:hover{color:#1d3d99}
</style>
</helmet>
<div style="...fluid root, font-family, color, background...">
  ...
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{"$preview":{"width":1440,"height":1000}}'>
class Component extends DCLogic {
  renderVals() {
    return { items: [...], pick: () => this.setState({ x: 1 }) };
  }
}
</script>
</body>
</html>
```

## Rules that fail silently if broken

- Keep `<script src="./support.js"></script>` exactly.
- Close every non-void element; quote every attribute.
- All UI is `<x-dc>` markup. Never build UI from script (`innerHTML`, `appendChild`).
- Styles: inline `style="…"` on elements. `<helmet><style>` only for page basics (`body{margin:0}`, `a`/`a:hover`, simple `:focus-visible`, `:hover` rules are OK there too sparingly). Prefer inline styles.
- `{{hole}}` is a dotted lookup into `renderVals()` only — never an expression (`{{a+b}}`, `{{!x}}` fail). Compute in `renderVals()`.
- Attributes: `x="{{path}}"` passes raw value; `onClick="{{ pick }}"` binds a handler returned by `renderVals()`. Per-item handlers: map items in `renderVals()` to include `pick: () => this.setState(...)`, bind `onClick="{{ item.pick }}"`.
- Control flow: `<sc-if value="{{ cond }}" hint-placeholder-val="{{ true }}">…</sc-if>`; `<sc-for list="{{ items }}" as="item" hint-placeholder-count="3">…</sc-for>`. Always set the hint attrs. No `else` — use two `sc-if`s with precomputed flags.
- Conditional styling in loops: precompute per item (e.g. `item.rowStyle`) and bind `style="{{ item.rowStyle }}"`.
- Logic class: classic JS, `class Component extends DCLogic`, no imports. `this.state`/`this.setState`. Initialize state with `state = {...}` class field or in constructor.
- `data-props` is single-quoted JSON. Escape `&` as `&amp;`, `'` as `&#39;`. Keep tweaks few (e.g. a `density` enum, `theme` light/dark). No tweaks for copy.
- Links between artboards: `<a href="Evidence.dc.html" style="...button look...">Open evidence</a>`. Style the `<a>` as the button; never put a `<button>` inside an `<a>`.
- Network: only Google Fonts `css2` `<link>` in `<helmet>`. No images from the web; no emoji; icons = inline stroke SVG (`stroke="currentColor"`).
- No `<iframe>`, `<object>`, `<embed>`, no global keydown handlers.
- Fluid PAGE root: no fixed px width; use a `max-width` container, %/rem/fr. Side nav + content = `display:flex; flex-wrap:wrap`, content `flex: 999 1 560px; min-width:0`. Nav must not be sticky or `100vh`. Wide tables in an `overflow-x:auto` box. At phone width things stack.
- Accessibility: real `<button>`, `<a href>`, `<input>`+`<label>`; `aria-label` on icon-only buttons; text contrast ≥ 4.5:1; status never by color alone (icon + text label). Touch targets ≥ 44 px where practical (desktop dense rows may be 36–40 px, but buttons ≥ 36 px).
- No AI tropes: no gradient washes, no left-border accent cards, no emoji. Do NOT use Inter, Roboto, or Arial.
- No lorem ipsum, no invented stats beyond the PRD §10 fixture. Keep the "Illustrative data" indicator visible on every screen.

## Shared state across screens

Each artboard has its own state. A flow that needs shared state across steps lives in ONE artboard with `sc-if` per step. Otherwise link artboards with `<a href>`.
