# Sigil — UI Style Guidance

## Thesis

Sigil already named itself after an occult tool: a symbol traced with
intent to bind a working to a condition. Lean into that literally. The
visual language is **machine-age ritual** — Art Deco's geometric, gilded
precision applied to a grimoire, not a dashboard. Think a 1920s
occult printing house crossed with a Camarilla elder's private study:
disciplined linework, aged metals, blood and ink, candlelight rather
than neon. The product underneath stays a precise developer tool —
the theme lives in chrome, material, and voice, never in the data.

## Color

Six named values. Gilt and Old Blood are accents, used sparingly — most
of the surface is Obsidian and Parchment doing the actual work of being
readable.

| Name         | Hex       | Role                                                                                       |
| ------------ | --------- | ------------------------------------------------------------------------------------------ |
| Obsidian Ink | `#0E0C10` | Base background. Near-black with a hint of warmth, not cold blue-black.                    |
| Parchment    | `#E8E1CC` | Primary text on dark surfaces. Warm ivory, not pure white.                                 |
| Gilt         | `#C9A227` | Active states, primary hairlines, the lit sigil-glyph. The gold leaf accent.               |
| Old Blood    | `#7A1F2B` | Errors, destructive actions, the fractured glyph. Wax-seal red, never neon.                |
| Verdigris    | `#3E6259` | Success / "running" states. Aged bronze-green patina — keeps red reserved for danger only. |
| Veil         | `#4B4554` | Secondary text, dividers, dormant/disabled states. The grey between worlds.                |

Check Parchment-on-Obsidian and any Gilt-on-Obsidian _text_ against
WCAG AA before shipping — Gilt at `#C9A227` is fine for linework and
glyphs but may need lightening for body-sized text on dark backgrounds.

### Category metals

A second, smaller palette for node-chrome only — which of the five MVP
node categories a node belongs to. This is deliberately separate from
the six colors above: those are _semantic_ (what state something is
in), these are _material_ (which family a node belongs to), and they
need to stay visually distinct from each other so a Trigger node and an
"active" sigil-glyph don't get read as the same signal by coincidence.

| Category | Color     | Hex       | Why                                                   |
| -------- | --------- | --------- | ----------------------------------------------------- |
| Trigger  | Gilt      | `#C9A227` | Reused — the trigger is what lights the working.      |
| Logic    | Pewter    | `#7E8AA0` | Cool, clear-headed — judgment and branching.          |
| System   | Verdigris | `#4A7568` | Reused — the metal that does things to the world.     |
| State    | Copper    | `#A85C32` | Warm, a metal historically tied to memory and wiring. |
| Utility  | Veil      | `#6A6473` | Reused — the quiet, background category.              |

Three of the five are reused from the semantic palette where the
meaning genuinely overlaps (Trigger/lit, System/doing, Utility/quiet).
Pewter and Copper are net-new — both stay in the same "aged metal"
material family as Gilt and Verdigris, so the addition reads as more of
the same idea rather than a second, unrelated palette bolted on.

## Type

Four roles, each mapped to a different register of the product — not
four fonts for variety's sake.

| Role        | Use                                                                                          | Suggested face                  |
| ----------- | -------------------------------------------------------------------------------------------- | ------------------------------- |
| Display     | Section titles, empty-state headlines, onboarding. Caps, wide tracking, used with restraint. | Cinzel                          |
| UI / body   | Buttons, labels, forms, nav, panel headers. The functional, familiar layer.                  | Inter or IBM Plex Sans          |
| Manuscript  | Short flavor copy only — empty states, About screen, tooltips' descriptive line.             | Spectral or Cormorant           |
| Data / mono | Event Inspector, JSON, Variable Inspector, code nodes, timestamps.                           | JetBrains Mono or IBM Plex Mono |

Display and Manuscript carry the personality. UI and Data carry the
actual work and should never feel "themed" — see Restraint, below.

## Layout & ornament

- **Panel corners:** a small stepped (ziggurat) inset on major panel
  chrome — node inspector, settings, the workflow canvas frame — instead
  of rounded corners. Buttons and inputs stay simple rectangles; the
  step motif belongs to architecture, not controls.
- **Frame tiers — two weights, used deliberately:**
    - _Structural panels_ (toolbar, Node Library, Inspector, Settings,
      any container that appears once or twice per screen) get the full
      **ornamental frame**: a gilt hairline, a dark gap, a second fainter
      gilt hairline, then the surface — a nested double-line moulding
      rather than a flat border — with a small three-stroke fan flourish
      tucked into each of the two stepped corners, marking the joint the
      way a Deco facade brackets a corner. This is where the "more
      ornamental" boldness should live.
    - _Repeated small elements_ (workflow cards, node cards on the
      canvas — anything that might appear a dozen times on one screen)
      get the **light frame** only: a single stepped hairline plus one
      small corner-fan at the top-left corner. Applying the full nested
      frame to every node on a busy canvas would spend the boldness
      everywhere at once and cancel it out — see Restraint.
- **Dividers:** a 1px Gilt hairline, ~30–40% opacity for quiet sections
  and full opacity for emphasis, instead of soft drop shadows. Deco is
  crisp linework, not blur.
- **Canvas background (Workflow Builder):** replace a generic dot-grid
  with a faint radial ley-line field — concentric rings and spokes from
  a vanishing point, ~6–8% opacity — so the canvas reads as a ritual
  circle at a glance without competing with the nodes sitting on it.
- **Node chrome:** each node card's light frame (above) carries a 3px
  top-edge accent in its category's metal — see the Category metals
  table — like a wax seal stamped at the top of the card, instead of a
  generic colored left-border tab.

```
Structural panel (ornamental):        Node / workflow card (light):
╔══╗──────────────────╔══╗            ┌╗───────────────────╗
║ ░│  INSPECTOR        │░ ║            │  ▰▰▰  ← category accent
║ ░│                   │░ ║            │  FILE WATCHER
╚══╝──────────────────╚══╝            └─────────────────────┘
 ↑ gilt · gap · gilt · surface          ↑ one hairline, one corner-fan
```

## Signature element: the sigil-glyph

Every Workflow gets a small (~24–32px) procedurally generated glyph —
straight lines and arcs traced on a hidden radial grid, the way a real
sigil is constructed from letters arranged on a circle — seeded
deterministically from the Workflow's id, so the same Workflow always
renders the same mark. This is the one place the boldness lives; it
shows up consistently on Home, the Workflows list, and the tray menu.

| State                  | Rendering                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------- |
| Dormant (disabled)     | Veil, thin stroke, unlit                                                              |
| Active (enabled, idle) | Gilt, normal weight                                                                   |
| Running                | Verdigris, slow breathing-opacity pulse (freezes to static fill under reduced motion) |
| Error                  | Old Blood, a single fracture line cut across the glyph                                |

It replaces the generic colored-dot status indicator with something
that's both more characterful and just as fast to scan.
