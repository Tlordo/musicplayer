---
name: Моя музыка
description: A self-hosted music library with two switchable visual worlds, Классика (a dark cover-first player) and Кассета (a home-recorded МК-60 cassette), on one shared settings and theme layer.
colors:
  # ---- World A: Классика (css/classic.css :root) ----
  classic-bg: "#0a0a0a"
  classic-surface: "#121212"
  classic-surface-2: "#1f1f1f"
  classic-line: "#262626"
  classic-text: "#ffffff"
  classic-text-2: "#b3b3b3"
  classic-text-3: "#8f8f8f"
  classic-accent: "#1db954"
  classic-on-accent: "#04110a"
  classic-play-bg: "#ffffff"
  classic-play-fg: "#0a0a0a"
  classic-wave-rest: "rgba(255, 255, 255, 0.2)"
  classic-wave-hover: "rgba(255, 255, 255, 0.45)"
  classic-danger: "#ff7262"
  classic-ok: "#3ccf74"
  # ---- World B: Кассета (css/cassette.css :root) ----
  cassette-deck: "#0f1013"
  cassette-shell: "#16171b"
  cassette-on-shell: "#ecebe6"
  cassette-on-shell-2: "#a9abb3"
  cassette-on-shell-3: "#80838d"
  cassette-card: "#f4f4f0"
  cassette-card-2: "#e9e9e3"
  cassette-print: "#1b1c20"
  cassette-print-2: "#555966"
  cassette-rule: "#cdd3e6"
  cassette-ball: "#1f3aa8"
  cassette-orange: "#ff5a1f"
  cassette-orange-ink: "#d8420d"
  cassette-yellow: "#ffc928"
  cassette-cobalt: "#2a44d4"
  cassette-hi: "rgba(255, 201, 40, 0.62)"
  cassette-vfd: "#7ff5e8"
  cassette-key: "#e7e7e1"
  cassette-danger: "#c02a1a"
  cassette-ok: "#1d7a3c"
typography:
  classic-display:
    fontFamily: "'Onest', 'Segoe UI', system-ui, -apple-system, Roboto, sans-serif"
    fontSize: "clamp(1.6rem, 4.2vw, 2.7rem)"
    fontWeight: 800
    lineHeight: 1.08
    letterSpacing: "-0.02em"
  classic-headline:
    fontFamily: "'Onest', 'Segoe UI', system-ui, -apple-system, Roboto, sans-serif"
    fontSize: "1.35rem"
    fontWeight: 700
    letterSpacing: "-0.01em"
  classic-brand:
    fontFamily: "'Onest', 'Segoe UI', system-ui, -apple-system, Roboto, sans-serif"
    fontSize: "1.3rem"
    fontWeight: 700
    letterSpacing: "-0.01em"
  classic-title:
    fontFamily: "'Onest', 'Segoe UI', system-ui, -apple-system, Roboto, sans-serif"
    fontSize: "0.98rem"
    fontWeight: 600
  classic-artist:
    fontFamily: "'Onest', 'Segoe UI', system-ui, -apple-system, Roboto, sans-serif"
    fontSize: "clamp(1rem, 1.6vw, 1.2rem)"
    fontWeight: 400
  classic-body:
    fontFamily: "'Onest', 'Segoe UI', system-ui, -apple-system, Roboto, sans-serif"
    fontSize: "0.95rem"
    fontWeight: 400
    lineHeight: 1.45
  classic-label:
    fontFamily: "'Onest', 'Segoe UI', system-ui, -apple-system, Roboto, sans-serif"
    fontSize: "0.82rem"
    fontWeight: 400
    fontFeature: "'tnum'"
  cassette-display:
    fontFamily: "'Neucha', 'Segoe Print', 'Comic Sans MS', cursive"
    fontSize: "clamp(1.8rem, 7.5vw, 2.7rem)"
    fontWeight: 400
    lineHeight: 1.02
  cassette-brand:
    fontFamily: "'PT Sans Narrow', 'Arial Narrow', 'Roboto Condensed', sans-serif"
    fontSize: "2.6rem"
    fontWeight: 700
    lineHeight: 0.9
    letterSpacing: "-0.01em"
  cassette-headline:
    fontFamily: "'PT Sans Narrow', 'Arial Narrow', 'Roboto Condensed', sans-serif"
    fontSize: "1.35rem"
    fontWeight: 700
    letterSpacing: "0.08em"
  cassette-title:
    fontFamily: "'Neucha', 'Segoe Print', 'Comic Sans MS', cursive"
    fontSize: "1.32rem"
    fontWeight: 400
    lineHeight: 1.15
  cassette-body:
    fontFamily: "'PT Sans Narrow', 'Arial Narrow', 'Roboto Condensed', sans-serif"
    fontSize: "0.9rem"
    fontWeight: 400
    lineHeight: 1.4
  cassette-label:
    fontFamily: "'PT Sans Narrow', 'Arial Narrow', 'Roboto Condensed', sans-serif"
    fontSize: "0.72rem"
    fontWeight: 700
    letterSpacing: "0.12em"
  cassette-mono:
    fontFamily: "'PT Mono', ui-monospace, 'Cascadia Mono', monospace"
    fontSize: "0.9rem"
    fontWeight: 400
rounded:
  # shared layer (--ui-radius / --ui-radius-sm are re-mapped per world)
  menu: "12px"
  menu-item: "8px"
  pill: "999px"
  classic-sheet: "16px"
  classic-field: "10px"
  classic-cover: "12px"
  classic-row: "10px"
  classic-thumb: "6px"
  classic-band: "14px"
  cassette-sheet: "8px"
  cassette-field: "6px"
  cassette-print: "2px"
  cassette-stamp: "4px"
  cassette-window: "6px"
  cassette-control: "8px"
  cassette-icon: "10px"
  cassette-panel: "12px"
spacing:
  touch: "44px"
  sheet-gutter: "20px"
  sheet-gap: "16px"
  row: "64px"
  gutter: "20px"
  classic-tabbar: "62px"
  classic-library: "360px"
  cassette-transport: "76px"
components:
  btn:
    backgroundColor: "{colors.classic-surface-2}"
    textColor: "{colors.classic-text}"
    rounded: "{rounded.pill}"
    padding: "0 18px"
    height: "44px"
  btn-primary:
    backgroundColor: "{colors.classic-accent}"
    textColor: "{colors.classic-on-accent}"
    rounded: "{rounded.pill}"
    padding: "0 18px"
    height: "44px"
  menu:
    backgroundColor: "{colors.classic-surface}"
    textColor: "{colors.classic-text}"
    rounded: "{rounded.menu}"
    padding: "6px"
    width: "200px"
  menu-item:
    rounded: "{rounded.menu-item}"
    padding: "0 12px"
    height: "44px"
  theme-chip:
    backgroundColor: "{colors.classic-surface-2}"
    textColor: "{colors.classic-text}"
    rounded: "{rounded.pill}"
    padding: "0 14px 0 8px"
    height: "44px"
  classic-play:
    backgroundColor: "{colors.classic-play-bg}"
    textColor: "{colors.classic-play-fg}"
    rounded: "{rounded.pill}"
    size: "68px"
  classic-ctl:
    backgroundColor: "transparent"
    textColor: "{colors.classic-text-2}"
    rounded: "{rounded.pill}"
    size: "48px"
  classic-row:
    backgroundColor: "transparent"
    textColor: "{colors.classic-text}"
    typography: "{typography.classic-title}"
    rounded: "{rounded.classic-row}"
    padding: "8px 12px 8px 4px"
    height: "64px"
  classic-row-hover:
    backgroundColor: "{colors.classic-surface-2}"
  classic-search:
    backgroundColor: "{colors.classic-surface-2}"
    textColor: "{colors.classic-text}"
    rounded: "{rounded.classic-field}"
    padding: "0 6px 0 14px"
    height: "44px"
  classic-add:
    backgroundColor: "{colors.classic-accent}"
    textColor: "{colors.classic-on-accent}"
    rounded: "{rounded.pill}"
    height: "46px"
  cassette-stamp:
    backgroundColor: "transparent"
    textColor: "{colors.cassette-orange-ink}"
    typography: "{typography.cassette-label}"
    rounded: "{rounded.cassette-stamp}"
    padding: "0 18px"
    height: "46px"
  cassette-stamp-hover:
    backgroundColor: "{colors.cassette-orange-ink}"
    textColor: "#ffffff"
  cassette-deck-key:
    backgroundColor: "{colors.cassette-key}"
    textColor: "{colors.cassette-print}"
    height: "58px"
  cassette-led-button:
    textColor: "{colors.cassette-on-shell-2}"
    rounded: "{rounded.cassette-control}"
    padding: "0 8px"
    height: "44px"
  cassette-text-button:
    backgroundColor: "transparent"
    textColor: "{colors.cassette-on-shell-2}"
    rounded: "{rounded.cassette-control}"
    padding: "0 8px"
    height: "44px"
  cassette-track-row:
    backgroundColor: "transparent"
    textColor: "{colors.cassette-ball}"
    typography: "{typography.cassette-title}"
    height: "64px"
  cassette-written-line:
    backgroundColor: "transparent"
    textColor: "{colors.cassette-ball}"
    height: "44px"
  cassette-sheet:
    backgroundColor: "{colors.cassette-card}"
    textColor: "{colors.cassette-print}"
    rounded: "{rounded.cassette-sheet}"
    width: "560px"
  cassette-jfront:
    backgroundColor: "{colors.cassette-card}"
    textColor: "{colors.cassette-print}"
    padding: "6px 6px 0"
    width: "320px"
---

# Design System: Моя музыка

## Overview

**Creative North Star: "One Library, Two Players"**

The app is one owner's music library with two complete players over it. The owner picks one in settings. Both are phone-first, full-screen and Russian-language, and both lead with the track's cover. Neither is a skin of the other: each has its own palette, type, layout and signature components. What they share sits below them: one HTML markup contract, one set of dialogs (add, info, confirm, settings, cover view), the ⋯ menu, toasts, the lyrics overlay, and one theme engine. That shared layer reads only the `--ui-*` bridge tokens, and each world maps its own palette onto them. So a sheet opened in Классика is a dark rounded panel, and the same sheet in Кассета is a printed J-card page.

**World A, Классика**, is the original dark player rebuilt properly. The background is near-black and green is the one accent. The list has cover thumbnails. A large rounded cover sits over a blurred backdrop made from the same cover, with a round white play disc. The upgrades define the world now: a real waveform as the seek bar, a bottom spectrum on desktop, a small equaliser under the cover on phones, a lyrics band that takes the indicator's place, and the ⋯ menu. The cover and its colour lead, and the chrome recedes into grey.

**World B, Кассета**, is a home-recorded МК-60. The library is the cassette's J-card, filled in by hand in blue ballpoint over printed form fields. The player is a deck: a J-card front cover card shows the track art, the smoked-plastic cassette overlaps it with turning reels and a window that works as the seek scrubber, then come a rolling tape counter, a vacuum-fluorescent segment level meter, LED toggles, and chunky ivory piano keys that depress. It refuses the streaming-app look of Классика on purpose: no blurred backdrop, no pill controls on the deck or the card.

**Key Characteristics:**
- Two complete worlds over one markup contract; switching designs swaps `css/<design>.css` and the design module's template, never the behaviour.
- A shared layer (sheets, settings, theme editor, ⋯ menu, toasts, lyrics overlay) styled only through `--ui-*` bridge tokens.
- Themes are CSS-variable overrides on top of a world's defaults: presets per design, user custom themes, JSON export/import, optional cover colours (off by default).
- Классика: tonal dark layering, a single green accent, the cover big and blurred behind, a waveform seek and a spectrum.
- Кассета: two materials (deck plastic and J-card paper), two hands (printed caps and blue ballpoint), the factory tricolor, and physical controls.
- Touch targets of 44px or more everywhere, one shared ease-out curve, and every animation off under reduced motion.

## Colors

The shared layer owns no colours of its own. Each world brings a palette and maps it onto `--ui-*`.

### The Bridge Tokens (shared layer)
Every rule in `base.css` reads these and nothing else. A world sets them in its own `:root`.

| Bridge | Классика maps to | Кассета maps to | Used for |
|---|---|---|---|
| `--ui-bg` | `surface` | `card` | Sheet and menu ground |
| `--ui-surface` | `surface-2` | `card-2` | Fields, chips, buttons, menu hover |
| `--ui-surface-2` | `surface-2` mixed 14% toward `text` | `card-2` mixed 15% toward `print` | Hover on chips and buttons, toast ground |
| `--ui-text` / `--ui-text-2` | `text` / `text-2` | `print` / `print-2` | Sheet text, hints, field labels |
| `--ui-line` | `line` | `rule` | Section dividers, info rows, field borders |
| `--ui-accent` / `--ui-on-accent` | `accent` / `on-accent` | `cobalt` / white | Primary button, switch on, selected chip ring, field focus |
| `--ui-danger` / `--ui-ok` | `classic-danger` / `classic-ok` (base defaults) | `cassette-danger` / `cassette-ok` | Destructive actions, status lines, toast edges |
| `--ui-focus` | `text` | `yellow` (cobalt inside card and sheets) | Global focus ring |
| `--ui-font` / `--ui-font-head` | Onest | PT Sans Narrow | All shared-layer text |
| `--ui-head-case` / `--ui-head-tracking` | none / −0.01em | uppercase / 0.08em | Sheet headlines |
| `--ui-radius` / `--ui-radius-sm` | 16px / 10px (base defaults) | 8px / 6px | Sheet corners / fields and pickers |

The fixed exceptions are the lyrics surfaces: the lyrics slot and full-screen overlay are always black, with white status text at 78% and a translucent white close disc. The vendored lyrics engine paints inside them.

### Named Rules
**The Bridge Rule.** `base.css` never names a world colour, font or radius; it reads `--ui-*` only. A new shared surface gets its look by adding a bridge token that both worlds map, never by branching on `data-design`.

### World A, Классика

#### Primary
- **Spotify Green** (`classic-accent`): State and the one primary action. It colours the current row's title, its animated three-bar equaliser and 12% row tint, the played part of the waveform, the spectrum bars, active toggles (shuffle, repeat, spectrum, lyrics) with their 4px dot, the active sort icon and tab, the brand mark, the add button and the primary sheet button. **On-Accent** (`classic-on-accent`) is the near-black text on green fills. Cover colours can replace both (see Theme System).

#### Neutral
- **Stage Black** (`classic-bg`): The player background and the colour the blurred backdrop fades into.
- **Library Panel** (`classic-surface`): The library column, sheets and the ⋯ menu.
- **Field Grey** (`classic-surface-2`): Search, row hover, thumbnail backing, chips and plain buttons.
- **Hairline** (`classic-line`): The library border, foot divider, tab bar top edge, sheet section rules.
- **Text Ramp** (`classic-text`, `classic-text-2`, `classic-text-3`): Titles; artists, album and icons at rest; numbers, durations, times and stats.
- **Play Disc** (`classic-play-bg` on `classic-play-fg`): The round play button only.
- **Wave Rest / Wave Hover** (`classic-wave-rest`, `classic-wave-hover`): Unplayed waveform bars and the hover preview up to the pointer; also the mini-player progress track.
- **Error Coral / OK Green** (`classic-danger`, `classic-ok`): The "нет файла" tag (20% fill), delete in the menu, error/ok status and toast edges.

#### Named Rules
**The Cover Leads Rule.** The only large field of colour in Классика is the cover itself, shown sharp and again blurred behind the player (80px blur, 55% strength, faded to `classic-bg` by a top-to-bottom gradient). Green marks state and the single primary action; it never fills panels or backgrounds.

**The One White Disc Rule.** The play button is the only filled circle on the player: a 68px `classic-play-bg` disc. Every other control is a bare grey glyph that turns green when on.

### World B, Кассета

#### Primary
- **Ballpoint Blue** (`cassette-ball`): Everything the owner wrote. That covers track titles, durations, the owner name, search and URL text, info values, confirm text, design names in settings, the sort ticks, the heard ticks and the selected-chip border. If the owner wrote it, it is this blue.
- **Signal Orange** (`cassette-orange`): Factory print accent. It is the first stripe, the margin rule after the № column, the play key's top band, the scrub head, the LED glow, the repeat-one numeral, the input caret and the meter's overload segments. **Stamp Orange** (`cassette-orange-ink`) is its darker ink for strokes and text on paper: the "записать трек" stamp, the primary sheet button and the "НЕТ ФАЙЛА" tag.

#### Secondary
- **Factory Yellow** (`cassette-yellow`): The second stripe, the printed artist name on the deck, and the focus ring on the dark side. **Highlighter** (`cassette-hi`) is yellow at 62% for the playing row's marker sweep, the new-row flash and text selection.
- **Cobalt** (`cassette-cobalt`): The third and widest stripe, the shared-layer accent (switch on, focus inside the card and sheets, active field underline), the default toast dot, and the 5% / 9% row hover and press tint.
- **VFD Cyan** (`cassette-vfd`): The level meter's lit segments, scale and channel letters. Unlit segments stay faintly visible at 9%. Cover colours, when enabled, tint only this.

#### Neutral
- **Deck Black** (`cassette-deck`): The app background, the player's top-lit radial ground, and the source the panel, LED buttons and transport bar are mixed from.
- **Smoked Shell** (`cassette-shell`): The darkest stop of the cassette's smoke gradient.
- **Shell Text Ramp** (`cassette-on-shell`, `-2`, `-3`): Text on the dark side: the now-playing title; icons, meta and times; the counter label, time separator and side badge stroke.
- **J-card White** (`cassette-card`) and **Card Shade** (`cassette-card-2`): The J-card, the front cover card, the cassette label, sheets and toasts; Card Shade backs empty art.
- **Print Black / Print Grey** (`cassette-print`, `cassette-print-2`): Printed rules, headings and the side-letter block; printed form labels and secondary lines.
- **Form Rule** (`cassette-rule`): The pale ruled lines of the card, the label and the empty front cover.
- **Key Ivory** (`cassette-key`): The transport keys. Their shade and skirt are derived from it (`color-mix` 86% and 60% toward black), so a theme only sets one value.
- **Erase Red / Ink Green** (`cassette-danger`, `cassette-ok`): The destructive sheet stamp ("стереть"), error and ok status lines.

#### Named Rules
**The Ballpoint Rule.** Neucha set in `cassette-ball` means the owner wrote it. Printed form text (labels, headers, the brand, buttons) never uses the handwriting face, and owner content never uses printed caps. The one exception is the artist name on the deck, printed in yellow caps.

**The Tricolor Order Rule.** Stripes always run orange, yellow, cobalt, and cobalt is twice the width of each of the others. They appear in four places only: the J-card header (skewed −24°), the front cover card's foot, the cassette label's foot, and the 6px top edge of every sheet.

## Typography

Each world owns its type. The shared layer receives it through `--ui-font` and `--ui-font-head`, so sheets and settings set in the active world's faces. All faces are self-hosted from `public/fonts` with Cyrillic and Latin subsets.

### World A, Классика
**Display/Body Font:** Onest, variable 400–800 (with Segoe UI, system-ui, Roboto)

**Character:** A single contemporary grotesque with Cyrillic character, carried by weight alone: 800 for the now-playing title, 600–700 for titles and actions, 400 for everything else. Numbers are always tabular.

- **Display** (800, `clamp(1.6rem, 4.2vw, 2.7rem)`, 1.08, −0.02em): The now-playing title, balanced and clamped to 2 lines.
- **Headline** (700, 1.35rem, −0.01em): Sheet titles.
- **Brand** (700, 1.3rem, −0.01em, `classic-accent`): "Моя музыка" beside the note mark.
- **Title** (600, 0.98rem): Row titles, single line with ellipsis. Mini-player title at 0.92rem.
- **Artist** (400, `clamp(1rem, 1.6vw, 1.2rem)`, `classic-text-2`): The now-playing artist.
- **Body** (400, 0.95rem): Search, menu items, buttons (600), toasts (500).
- **Label** (400, 0.8–0.85rem, tabular): Row sub-line, durations, times, stats, meta and the library count. Tab labels are 0.72rem 600.

### World B, Кассета
**Display Font:** Neucha (with Segoe Print, Comic Sans MS, cursive)
**Body Font:** PT Sans Narrow 400/700 (with Arial Narrow, Roboto Condensed)
**Mono Font:** PT Mono (with ui-monospace, Cascadia Mono)

**Character:** A narrow Soviet print face for the form, a loose ballpoint hand for whatever fills it in, and a typewriter mono for the counter, elapsed time and meter scale.

- **Display** (Neucha 400, `clamp(1.8rem, 7.5vw, 2.7rem)`, 1.02; `clamp(1.6rem, 6.6vw, 2.2rem)` under 960px): The now-playing title on the deck, balanced, clamped to 2 lines.
- **Brand** (PT Sans Narrow 700, 2.6rem, 0.9): The "МК-60" mark on the card. The front cover card prints it at 1.05rem.
- **Headline** (PT Sans Narrow 700, 1.35rem, 0.08em, uppercase): Sheet titles.
- **Title** (Neucha 400, 1.32rem, 1.15): Tracklist entries. Handwritten companions sit at 1.15–1.45rem: duration, search and URL input, info values, confirm text, owner name, design names.
- **Body** (PT Sans Narrow 400, 0.86–0.95rem, 1.4): Row sub-lines, hints, status, meta, sort-box labels.
- **Label** (PT Sans Narrow 700, 0.72rem, 0.12em, uppercase, `cassette-print-2`): Printed form fields: ЗАПИСЬ, НАЙТИ, ПОРЯДОК, the № / НАИМЕНОВАНИЕ / ВРЕМЯ header, СТОРОНА, ССЫЛКА, info terms, the НЕТ ФАЙЛА tag. Buttons and the artist line share the uppercase tracked print voice at their own sizes (0.86–1.05rem, 0.1–0.14em).
- **Mono** (PT Mono, 0.9rem; 1.15rem on counter wheels; 10px on the meter scale): Elapsed and total time, the counter, the meter's dB marks.

### Named Rules
**The Field Label Rule.** In Кассета, uppercase label type is the printed name of the form field it sits on, inline with that field, the way a J-card prints its field names. On the J-card and the deck it never floats above a section as a heading.

**The Own Faces Rule.** A world never borrows the other world's faces. The shared layer has no font of its own: anything it renders must read `--ui-font` / `--ui-font-head`.

## Layout

Both worlds are one CSS grid of two cells on phones: the library and the player share row 1 and switch on `html[data-tab]`, and row 2 is the world's bottom bar plus the safe area. At **960px** and up both become two columns: the library is a fixed left column that collapses with `html.folded` (key B), and the player takes the rest. Sheets are bottom sheets with top corners rounded below **720px** width and centered cards above it. Widths are 560px by default, 720px for settings, 440px for confirm. Every sheet body uses an 18 / 20 / 22px padding and a 16px gap. Every touch target is 44px or larger.

**Классика.** Phone: a 62px tab bar (Плеер / Моё). The library tab carries a floating mini-player (44px cover, title, play, 2px progress) above the bar. The player stacks top bar → cover (`min(100%, 34dvh, 420px)`) → small equaliser (`min(64%, 260px)` × 26px) → title block → waveform seek (44px) → times → controls → extras row (volume, spectrum and lyrics toggles, ⋯). Desktop: a 360px library column with a pinned add button at its foot. The player stage is capped at 940px, with the cover (`clamp(240px, 28vw, 380px)`) left of a bottom-aligned title block, the waveform at 52px, and the spectrum as a faded band across the bottom 26% of the player. With lyrics on, the cover shrinks and a lyrics band (`clamp(140px, 24dvh, 260px)`; phone `clamp(110px, 18dvh, 170px)`) takes the indicator's place. The library rhythm is a 20px left gutter, 64px rows on a `30px | 48px | 1fr | auto` grid (number or eq, thumb, text, time) with 12px gaps, and 2px between rows.

**Кассета.** Phone: a 76px transport of 4 keys (◀◀, ▶/❚❚ at 1.35× width, ▶▶, J-card/cassette toggle) under the thumb. The player stacks deck top (side badge, counter, текст, ⋯, settings) → case → now-playing → panel (meter glass and LED row). In the case, the front cover card (`min(66%, 35dvh, 320px)`, tilted −2.5°) sits left, and the cassette (`min(62%, 22dvh × 1.58, 470px)`) overlaps its lower right by 16px like objects on a desk. The meter glass is `clamp(64px, 11dvh, 96px)` and tightens to 52px under 720px of height; it is never hidden by height. Under 480px the side badge and counter label drop. Desktop: the J-card is a `minmax(380px, 440px)` column spanning the full height. The player children are capped at 760px. The front cover (`min(30dvh, 280px)`) and cassette (`min(30dvh × 1.58, 440px)`) sit side by side. The transport drops to 3 keys (max 632px, no bar ground). The card rhythm is a 20px side gutter and 64px ruled rows on a `3rem | 52px | 1fr | 4.2rem` grid (№, pasted thumb, name, time). The ruling and the orange margin line continue past the last row to the bottom of the card.

## Elevation & Depth

The shared layer floats: sheets, the menu and toasts cast soft dark shadows over a 64% near-black dialog backdrop. Beyond that, each world handles depth differently. Классика layers tones (`classic-bg` → `classic-surface` → `classic-surface-2`) and lifts only the cover, the play disc and the lyrics band. Кассета gets depth from objects. Paper surfaces (the card, sheets) are flat and separated by printed rules: 2px `cassette-print` for major breaks and 1px `cassette-rule` for lines. Things lying on or above the paper cast real shadows: the cassette, the front cover card, the pasted thumbnails and toasts. Deck controls have mechanical skirts.

### Shadow Vocabulary
- **Sheet, bottom** (`0 -8px 40px rgba(0,0,0,.4)`) / **Sheet, centered** (`0 24px 64px rgba(0,0,0,.5)`): Shared.
- **Menu** (`0 12px 32px rgba(0,0,0,.45), 0 0 0 1px var(--ui-line)`): The ⋯ menu.
- **Toast** (`0 10px 28px rgba(0,0,0,.45)`; Кассета `0 8px 20px` for error/ok): Shared; error and ok add a 1px inset edge in Классика.
- **Cover view** (`0 24px 60px rgba(0,0,0,.6)`): Full-size cover.
- **Classic cover** (`0 28px 50px -18px var(--shadow-cover), 0 4px 12px rgba(0,0,0,.25)`): The big cover; the lyrics band uses `0 18px 40px -20px var(--shadow-cover)`.
- **Classic play disc** (`0 10px 24px -8px rgba(0,0,0,.6)`).
- **Cassette cast** (`filter: drop-shadow(0 16px 22px rgba(0,0,0,.6)) drop-shadow(0 3px 5px rgba(0,0,0,.45))`): The cassette only.
- **Front cover card** (`0 14px 28px -10px rgba(0,0,0,.7), 0 2px 6px rgba(0,0,0,.4)`).
- **Pasted photo** (`0 1px 3px rgba(0,0,0,.28)`): Row thumbnails on the J-card.
- **Key skirt** (`0 -1px 0 rgba(255,255,255,.6) inset, 0 5px 0 <key-skirt>, 0 8px 12px rgba(0,0,0,.55)`, raised `translateY(-3px)`): Transport keys at rest. Pressed or latched, the skirt goes to 0 and the key drops to `translateY(2px)`.
- **LED skirt** (`0 2px 0 #0c0d0f, 0 3px 6px rgba(0,0,0,.35)`): LED toggles; collapses on press.
- **Meter glass** (`inset 0 2px 8px rgba(0,0,0,.8), inset 0 0 0 1px rgba(255,255,255,.04)`): The recessed VFD window.

### Named Rules
**The Mechanical Skirt Rule.** A solid offset edge under a control is the visible side of a physical key. In Кассета it exists only on deck keys and LED toggles, and it must collapse when the control is pressed. Classic controls never carry one.

**The Object-On-Paper Rule.** In Кассета the paper itself never casts or carries a shadow; only physical objects resting on it do (the cassette, the front cover card, a pasted photo, a paper-strip toast).

## Shapes

**Shared:** pills for chips, switches and (in Классика) buttons; a 12px menu with 8px items; a 9px segmented control inside a 12px track; round 44px icon buttons. Classic leaves the sheet radii at the base defaults; Кассета maps them to 8/6px and squares its buttons and segmented control (6px / 4px).

**Классика** is softly rounded throughout. The cover is 12px (themeable 0–40px), lyrics band 14px, rows and search 10px, thumbnails 6px, and the waveform bars are fully rounded capsules. The play disc, the controls and the mini equaliser bars are round or capsule-shaped.

**Кассета** splits by material. Paper is nearly square: rows and rules have no radius, the side-letter block is 2px, the front cover card 3px, stamps and tags 4px. Plastic is softly rounded: 6px for the window, badge and meter glass, 8px for controls, 10px for icon buttons, 12px for the panel. Keys are asymmetric at 7px top and 10px bottom. Hand-placed things sit off true: the stamp at −1.2°, a toast at −0.8°, the front cover card at −2.5° (−1° on hover), pasted thumbnails cycling −2° / 1.5° / −0.5°, and the stripes skewed −24°. The cassette label is clip-path cut around the tape window.

## Components

### Shared layer

#### Markup contract
Both designs render their own template, and core binds to the same attribute hooks: `data-act` (actions: play, prev, next, shuffle, repeat, mute, meter, lyrics, lyrics-inline, menu, info, download, delete, add, settings, cover, fold/unfold, tab switches, clear-search), `data-bind` (title, artist, album, year, meta, count, total, time-cur, time-total and the rest), `data-seek`, `data-cover`, `data-list`, `data-search`, `data-meter`, `data-lyrics-slot`, `data-volume`, `data-needs-track`, `data-hide-empty`. Each design module declares `presets`, `themeVars`, `coverVars`, `template()` and `renderRow()`.

**The One Contract Rule.** A world may restyle, rearrange or re-label anything, but it binds the same `data-act` / `data-bind` hooks and keeps every capability: search, sort, play, seek, shuffle, repeat, volume, indicator, lyrics, ⋯ menu (info, download, delete), add, cover view, fold. A new feature lands in both templates or in neither.

#### Buttons (sheets)
- **Shape:** pill (999px), 44px min height, 18px side padding, 600 weight, 18px icon.
- **Plain:** `--ui-surface` ground, hover `--ui-surface-2`, press scales to 0.97.
- **Primary:** `--ui-accent` fill on `--ui-on-accent`; hover mixes 12% white.
- **Danger:** `--ui-danger` text, 10% danger tint on hover.
- **Кассета override:** plain buttons are transparent printed caps (0.1em, 6px radius, `print-2`); primary and danger become rubber stamps (see Кассета).

#### ⋯ Menu
A 200px-wide floating list on `--ui-bg`, 12px radius, 6px padding, menu shadow plus a 1px `--ui-line` ring, rising 6px in 0.2s. Items are 44px rows with a 19px icon in `--ui-text-2` and hover `--ui-surface`. Delete is the last item in `--ui-danger`. Классика opens it upward from the extras row; Кассета opens it downward from the deck top and labels delete "Стереть с кассеты".

#### Settings and theme editor
Sections are divided by 1px `--ui-line` with 16px vertical padding and headed by a small `--ui-font-head` heading (0.82rem, 700, 0.08em, uppercase, `--ui-text-2`). The design picker is two cards side by side, each with a 16:10 drawn mini preview of its world, a name and a one-line description; the selected card gets a 2px accent border (Кассета: ballpoint border, handwritten name). Theme chips are 44px pills with an overlapping three-dot swatch; the selected chip gets a 2px accent ring (Кассета: ballpoint). "Своя тема" is a dashed chip. Custom chips carry a small edit button. Toggles are 46×28px switches with a white 22px knob that slides on the ease-out curve and fill with `--ui-accent`. The indicator choice (indicator / lyrics / off) is a segmented control (Кассета: outlined, active segment inverted to `print` on `card`). The theme editor is an inset panel on `--ui-surface` with a name field, a dark/light segmented choice, a grid of 44×32px colour wells and range sliders (one per allowed variable), live preview, and Delete / Cancel / Save.

#### Theme System
- **What a theme is:** a set of CSS custom properties set inline on `<html>` over the defaults in `css/<design>.css`, plus a `scheme` (dark or light) applied to `color-scheme`. Switching themes removes the previous overrides first. `meta[name=theme-color]` follows the world's background variable (`--bg` or `--deck`).
- **What a theme may override:** for user themes, only the keys the design lists in `themeVars`.
  - Классика: `--bg`, `--surface`, `--surface-2`, `--text`, `--text-2`, `--accent`, `--play-bg` (colours), `--backdrop-strength` (0–1) and `--cover-radius` (0–40px).
  - Кассета: `--deck`, `--card`, `--print`, `--ball`, `--orange`, `--yellow`, `--cobalt`, `--vfd`, `--key`.
  - Built-in presets may also set derived variables (`--line`, `--on-accent`, `--text-3`, `--play-fg`, `--wave-*`, `--shadow-cover`, `--spectrum-opacity`; `--card-2`, `--print-2`, `--rule`, `--orange-ink`, `--hi`).
  - Nothing overrides `--ui-*` directly: the bridge follows the world variables.
- **Presets:** Классика ships Изумруд (default, no overrides), Сапфир, Коралл, Монохром and Светлая (light scheme). Кассета ships МК-60 (default), TDK SA, Свема and Ночная смена (dark paper). Each preset has a three-colour swatch.
- **Custom themes:** created from the current computed values, tied to one design, stored in `localStorage` (`mk.settings.v2`, `customThemes[]`), and kept through settings reset.
- **Cover colours:** the setting "Цвета из обложки" is off by default. When on, the dominant saturated hue of the cover's centre square replaces only Классика's `--accent` (with a contrast-picked `--on-accent`, lightness 0.62 dark / 0.36 light) or only Кассета's `--vfd` (lightness 0.68). They are never applied inside the editor preview.
- **Export format:** `{ "format": "mk-themes", "version": 1, "themes": [{ "id", "name", "design", "scheme", "vars": { "--key": "value" } }] }`. On import, themes for unknown designs are skipped, and only `themeVars` keys survive. Values must match `^[#\w\s.,()%-]{1,60}$`; the scheme is coerced to dark or light, and colliding ids are regenerated.

**The Whitelist Theme Rule.** A theme is data, not CSS. It may set only the variables its design names in `themeVars`, through the safe-value filter, and every surface must read those variables (or values derived from them with `color-mix`) so a theme reaches it. A colour hardcoded in a world stylesheet is a colour no theme can change.

#### Toasts, lyrics overlay, cover view
Toasts sit above the bottom bar (Классика `--tabbar-h` + 16px; Кассета `--transport-h` + 12px; desktop Классика 24px), max 420px, 12px radius on `--ui-surface-2`, and rise 12px in 0.35s. The lyrics overlay is full-screen black, scales in from 1.03, and closes with a 52px translucent white disc at the bottom centre; before the first line it shows the title and countdown centred in white. The cover view shows the cover at up to 86dvh with an 8px radius.

### World A, Классика

#### Play controls
- **Play disc:** 68px white circle, 30px glyph in `classic-play-fg`; hover scales to 1.05, press to 0.95.
- **Transport glyphs:** 48px round, 22px icon in `classic-text-2`, hover `classic-text`, press scales to 0.92. When on, they turn green with a 4px dot below; repeat-one adds a tiny 800-weight "1".
- **Extras:** 44px round icon buttons in `classic-text-2`; toggles go green, delete hover goes `classic-danger`.

#### Waveform seek (signature)
A 52px canvas (44px on phones) of rounded 3px bars on a 5px step, drawn from server peaks (a flat 18% line if none). Played bars are `classic-accent`; bars up to the pointer are `classic-wave-hover`; the rest are `classic-wave-rest`. Times sit below in tabular `classic-text-3`.

#### Spectrum and equaliser
Desktop: a canvas band across the bottom 26% of the player, behind the content, at `--spectrum-opacity` (0.32), masked to fade upward. Its 24–72 logarithmic bars rise fast, fall smoothly and are filled with an accent-to-transparent gradient. Phone: no band; instead a 28-bar solid-accent equaliser (26px tall) under the cover that always keeps a visible floor.

#### Library rows
64px rows with 10px radius. Number (tabular `classic-text-3`) or, when current, a three-bar green equaliser that animates while playing. Then a 48px cover thumbnail with 6px radius, a 600-weight title, an artist sub-line in `classic-text-2`, and the duration with a small green-grey check if already heard. Hover is `classic-surface-2`; the current row gets a 12% accent tint and a green title. A missing file dims the thumb and title to 50% and gets a coral "нет файла" tag. New rows flash a 30% accent tint for 1.8s.

#### Search, sort, add
Search is a 44px filled field (`classic-surface-2`, 10px radius) with a leading icon; on focus it gains a 1px 30% text border. Sort is four 36px icon toggles (time, A–Z, artist, album); the active one is green on `classic-surface-2`. Desktop has a full-width 46px green pill "Добавить трек" at the library foot; phones use a + in the header.

#### Navigation
Phone tab bar: two equal tabs with a 22px icon over a 0.72rem 600 label in `classic-text-3`, active green. The player top bar on phones carries a back chevron, a centred "Сейчас играет" bar title (0.72–0.78rem, uppercase, hidden on desktop), a pill "Текст" button (9% text wash) and settings.

### World B, Кассета

#### Stamp (primary action)
A rubber-stamp outline: 2.5px `cassette-orange-ink` border, 4px radius, 46px tall, printed caps at 1.05rem / 0.14em, rotated −1.2°, with a round record dot that blinks in two steps while a download runs. Hover fills solid Stamp Orange with white text; press scales to 0.97. The same stamp is the primary button in every sheet; danger swaps to `cassette-danger`.

#### Deck keys (signature)
Piano keys in an ivory gradient derived from `cassette-key`, 58px tall, with a 26px glyph in print black. The play key carries a 6px `cassette-orange` band on top and stays visibly latched (pressed and darker) while playing. On phones the fourth key toggles between the J-card and the cassette and swaps its icon.

#### LED toggles and text buttons
- **LED toggle:** 44px dark plastic (deck mixed toward grey), 8px radius, a 7px LED that is dull grey when off and an orange radial glow when on, plus the LED skirt. Used for shuffle, repeat, indicator and lyrics; repeat-one adds an orange "1".
- **Text button:** printed caps (0.86rem, 0.1em) with an 18px icon, 44px tall, `cassette-on-shell-2`, lifting to `cassette-on-shell` on a 6% white wash. The "текст" button adds a 1.5px 22% outline.

#### Front cover card and cassette
The front cover card is J-card paper, 3px radius, tilted −2.5°. It has a printed head (МК-60 / СТОРОНА А), the square track art (or ruled paper with a handwritten "без обложки") and a 10px tricolor foot. It opens the cover view. The cassette is an SVG in smoked plastic: tape packs that exchange radius with progress at constant tape speed, turning hubs, screws, a foot and glass. Its paper label has the side letter, the handwritten title over ruled lines and a tricolor foot, clip-cut around the window. The window is the seek scrubber: an orange head with arrowheads, a 14×10px enlarged hit area, and an orange 55% ring while dragging. A new track replays the 0.7s insert tilt.

#### Counter and level meter
The counter is PT Mono digits on rolling black-to-graphite wheels (MM:SS) in a near-black well, rolling 0.35s per digit. The level meter is a recessed glass with a vacuum-fluorescent segment display: two channels (Л / П) of 30 segments, the top 6 in orange as overload, a −30…+3 dB scale, a 1s peak hold, a glow on lit segments and a fine dark scan grid over the glass. With lyrics on, the glass grows to `clamp(120px, 18dvh, 200px)` and shows the lyrics instead.

#### Track row / J-card form
Each row is a 64px ruled line. It carries the number in printed tabular figures, zero-padded (a blue pen tick overlays it once heard); a pasted photo (44px cover with a 2px white border, tilted and shadowed); the title in Neucha `cassette-ball`; a printed grey sub-line (artist · album); and the duration handwritten. The playing title gets a skewed `cassette-hi` highlighter sweep. A missing file is struck through in faded blue, its photo greyed, and tagged with an outlined Stamp Orange "НЕТ ФАЙЛА". New rows flash highlighter for 1.8s. Hover and press tint cobalt at 5% and 9%.

#### Inputs / fields
- **Written line:** no box. A printed field label sits inline, the text is handwritten `cassette-ball` (1.35rem search, 1.3rem in sheets), with a 1px print underline and an orange caret. On focus the underline doubles in cobalt.
- **Sort boxes:** 15px printed squares; selection draws a 24px ballpoint tick overflowing the box, animating in from 0.6 scale and −8°.
- **Volume:** a 4px track with a 14×22px brushed-metal fader cap.

#### Sheets and toasts
Sheets are J-card paper with the tricolor as a 6px top edge, printed caps headlines, handwritten values against printed terms in the info list, and handwritten confirm text. Toasts are paper strips (3px radius, −0.8°) led by a 9px ink dot: cobalt for info, red for error, green for ok.

## Do's and Don'ts

### Do:
- **Do** build every shared surface in `base.css` from `--ui-*` tokens only, and map any new bridge token in both `classic.css` and `cassette.css` (The Bridge Rule).
- **Do** bind the same `data-act` / `data-bind` hooks in both templates and ship a feature to both worlds or neither (The One Contract Rule).
- **Do** list a variable in the design's `themeVars` before a theme can change it, and derive dependent shades with `color-mix` from those variables (The Whitelist Theme Rule).
- **Do** keep cover colours off by default and let them touch only `--accent` (Классика) or `--vfd` (Кассета).
- **Do** keep touch targets at 44px or more, draw icons as inline SVG symbols with `currentColor`, and run motion on `cubic-bezier(0.16, 1, 0.3, 1)` with reduced motion turning it off.
- **Do**, in Классика, let the cover and its blurred backdrop carry the colour and keep green for state and the one primary action (The Cover Leads Rule).
- **Do**, in Кассета, put every surface on one of two materials (deck plastic or J-card paper), write owner content in Neucha `cassette-ball`, and print form structure in PT Sans Narrow caps `cassette-print-2`.
- **Do**, in Кассета, use the stamp for the single primary action on paper, and deck keys or LED toggles for playback controls; keep key travel under 100ms.

### Don't:
- **Don't** reference a world's colours, fonts or radii in `base.css`, or branch shared styles on `data-design`.
- **Don't** mix worlds: no Onest, green or pills on the deck or the J-card; no Neucha, tricolor or skirts in Классика (The Own Faces Rule).
- **Don't** let a theme override `--ui-*` directly or inject values outside the safe filter.
- **Don't** use the Классика accent as a panel or background fill.
- **Don't**, in Кассета, use a blurred-cover backdrop or pill-shaped controls on the deck or the card; that is Классика's language, and Кассета refuses it.
- **Don't**, in Кассета, put uppercase label type above a section on the J-card or deck as a heading; it labels a field inline (The Field Label Rule).
- **Don't** reorder the tricolor, use its colours as general fills, or add it anywhere beyond its four places (The Tricolor Order Rule).
- **Don't** give paper a shadow or a skirt in Кассета; only objects resting on it cast shadows, and only deck keys and LED toggles have skirts (The Object-On-Paper Rule, The Mechanical Skirt Rule).
