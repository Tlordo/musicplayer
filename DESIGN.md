---
name: МК-60 · Моя музыка
description: A self-hosted music library dressed as a home-recorded Soviet МК-60 cassette, its J-card filled in by hand.
colors:
  deck: "#0f1013"
  shell: "#16171b"
  on-shell: "#ecebe6"
  on-shell-2: "#a9abb3"
  on-shell-3: "#7d808a"
  card: "#f4f4f0"
  card-2: "#e9e9e3"
  print: "#1b1c20"
  print-2: "#555966"
  rule: "#cdd3e6"
  ball: "#1f3aa8"
  orange: "#ff5a1f"
  orange-ink: "#d8420d"
  yellow: "#ffc928"
  cobalt: "#2a44d4"
  hi: "rgba(255, 201, 40, 0.62)"
  key: "#e7e7e1"
  key-2: "#c9c9c2"
  danger: "#c02a1a"
typography:
  display:
    fontFamily: "'Neucha', 'Segoe Print', 'Comic Sans MS', cursive"
    fontSize: "clamp(1.9rem, 8vw, 2.8rem)"
    fontWeight: 400
    lineHeight: 1.02
  brand:
    fontFamily: "'PT Sans Narrow', 'Arial Narrow', 'Roboto Condensed', sans-serif"
    fontSize: "2.6rem"
    fontWeight: 700
    lineHeight: 0.9
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "'PT Sans Narrow', 'Arial Narrow', 'Roboto Condensed', sans-serif"
    fontSize: "1.3rem"
    fontWeight: 700
    letterSpacing: "0.08em"
  title:
    fontFamily: "'Neucha', 'Segoe Print', 'Comic Sans MS', cursive"
    fontSize: "1.32rem"
    fontWeight: 400
    lineHeight: 1.15
  body:
    fontFamily: "'PT Sans Narrow', 'Arial Narrow', 'Roboto Condensed', sans-serif"
    fontSize: "0.92rem"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "'PT Sans Narrow', 'Arial Narrow', 'Roboto Condensed', sans-serif"
    fontSize: "0.72rem"
    fontWeight: 700
    letterSpacing: "0.12em"
  mono:
    fontFamily: "'PT Mono', ui-monospace, 'Cascadia Mono', monospace"
    fontSize: "0.9rem"
    fontWeight: 400
rounded:
  print: "2px"
  stamp: "4px"
  window: "6px"
  control: "8px"
  icon: "10px"
  panel: "12px"
  sheet: "14px"
spacing:
  xs: "6px"
  sm: "8px"
  md: "12px"
  gutter: "20px"
  row: "64px"
  touch: "44px"
components:
  stamp:
    backgroundColor: "transparent"
    textColor: "{colors.orange-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.stamp}"
    padding: "0 18px"
    height: "46px"
  stamp-hover:
    backgroundColor: "#c23a0a"
    textColor: "#ffffff"
  stamp-danger:
    textColor: "{colors.danger}"
    rounded: "{rounded.stamp}"
  deck-key:
    backgroundColor: "{colors.key}"
    textColor: "{colors.print}"
    height: "58px"
  led-button:
    backgroundColor: "#23252b"
    textColor: "{colors.on-shell-2}"
    rounded: "{rounded.control}"
    height: "44px"
    padding: "0 8px"
  text-button:
    backgroundColor: "transparent"
    textColor: "{colors.on-shell-2}"
    rounded: "{rounded.control}"
    padding: "0 8px"
    height: "44px"
  track-row:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ball}"
    typography: "{typography.title}"
    height: "64px"
  written-line-input:
    backgroundColor: "transparent"
    textColor: "{colors.ball}"
    height: "44px"
  sheet:
    backgroundColor: "{colors.card}"
    textColor: "{colors.print}"
    rounded: "{rounded.sheet}"
    width: "560px"
  deck-panel:
    backgroundColor: "#1b1d22"
    rounded: "{rounded.panel}"
    padding: "12px"
---

# Design System: МК-60 · Моя музыка

## Overview

**Creative North Star: "The Home-Recorded МК-60"**

The library is a cassette the owner recorded at home. Two materials carry the whole interface. Smoked shell plastic and a near-black deck hold the player. A cool-white printed J-card holds the tracklist, search, sort and dialogs. The printing on the card is factory work: narrow PT Sans caps for the form fields, a heavy rule under the header, and three slanted stripes in signal orange, yellow and cobalt. What the owner fills in is blue ballpoint set in Neucha: track titles, durations, the owner name and search text. Yellow highlighter marks the playing line. A pen tick beside the number marks a line already heard.

The player is the cassette in the deck. The label carries the track cover in place of artwork. The two reels shift tape from left to right as the track plays, and the cassette window doubles as the seek scrubber. Below it sit a mechanical tape counter, analog VU needles, LED toggles and a bottom row of chunky piano keys that physically depress. The density is phone-first. On desktop the card sits as a left column and the cassette takes the right. The look rejects the streaming-app pattern of a blurred cover with pill buttons.

Motion stays physical and short. Keys travel 5px in 80ms, the cassette tilts in when it is inserted, sheets slide up, and the record dot blinks in steps the way an LED does. Every animation shares the long ease-out curve, and reduced motion turns all of them off.

**Key Characteristics:**
- Two materials only: dark deck/shell and light printed card. Every surface is one or the other.
- Two hands on the card: printed form (PT Sans Narrow caps, `print-2`) versus handwritten entries (Neucha, `ball` blue).
- Factory tricolor stripes (orange / yellow / cobalt) as the brand signature, always in that order, cobalt the widest.
- Physical controls: depressing keys, LED toggles, an analog counter and a scrubbable tape window.
- Russian UI, lowercase handwritten copy, uppercase printed labels.

## Colors

Two neutral materials do the work. A small factory tricolor and one ballpoint blue carry the meaning.

### Primary
- **Ballpoint Blue** (`ball`): All handwritten content on the card, including track titles, durations, the owner name, search and URL input text, info values, the tick marks and the confirm text. If the owner wrote it, it is this blue.
- **Signal Orange** (`orange`): Factory print accent. Used for the first stripe, the vertical margin rule after the № column, the play key's top band, the scrub head, the LED glow and the input caret. **Stamp Orange** (`orange-ink`) is its darker ink for text and strokes on the light card: the "записать трек" stamp and the "нет файла" tag.

### Secondary
- **Factory Yellow** (`yellow`): The second stripe, the now-playing artist name on the deck, and the global focus ring on dark surfaces. **Highlighter** (`hi`) is the same yellow at 62% for the playing row's marker sweep, the new-row flash and text selection.
- **Cobalt** (`cobalt`): The third and widest stripe, the focus ring and active input underline on the card, the toast dot, and the 5–9% row hover/press tint.

### Neutral
- **Deck Black** (`deck`): The app background behind the player and keys.
- **Smoked Shell** (`shell`): The cassette body (in the SVG smoke gradient) and the browser theme color.
- **Shell Text Ramp** (`on-shell`, `on-shell-2`, `on-shell-3`): Primary, secondary and tertiary text on the dark side. Tertiary is used for the counter label, time separator and badge stroke.
- **J-card White** (`card`) and **Card Shade** (`card-2`): The card, sheets, cassette label and toasts. Card Shade is the empty-art backing.
- **Print Black** (`print`) and **Print Grey** (`print-2`): Printed rules and headings, and the printed form labels and secondary metadata.
- **Form Rule** (`rule`): The pale blue-grey ruled lines of the J-card. Rows sit on a 64px ruling that continues to the bottom of the card.
- **Key Ivory** (`key`, `key-2`): The gradient body of the transport keys.
- **Erase Red** (`danger`): Only for the destructive stamp ("стереть").

### Named Rules
**The Ballpoint Rule.** Neucha set in `ball` blue means the owner wrote it. Printed form text (labels, headers, the brand) never uses the handwriting face. Owner content never uses printed caps, with one exception: the artist name on the deck is printed in yellow caps.

**The Tricolor Order Rule.** Stripes always run orange, yellow, cobalt, with cobalt the widest (twice the width of each other stripe). They appear on the card header, the cassette label foot and the sheet top edge, and nowhere else.

## Typography

**Display Font:** Neucha (with Segoe Print, Comic Sans MS, cursive)
**Body Font:** PT Sans Narrow 400/700 (with Arial Narrow, Roboto Condensed)
**Label/Mono Font:** PT Mono (with ui-monospace, Cascadia Mono). All three are self-hosted from `public/fonts` with Cyrillic subsets.

**Character:** A narrow Soviet print face for the form, a loose ballpoint hand for whatever fills it in, and a typewriter mono for the counter and elapsed time.

### Hierarchy
- **Display** (Neucha 400, `clamp(1.9rem, 8vw, 2.8rem)`, 1.02): The now-playing title on the deck, clamped to 2 lines and text-balanced.
- **Brand** (PT Sans Narrow 700, 2.6rem, 0.9): The "МК-60" mark only.
- **Headline** (PT Sans Narrow 700, 1.3rem, 0.08em, uppercase): Sheet titles.
- **Title** (Neucha 400, 1.32rem, 1.15): Tracklist entries. Handwritten companions sit at 1.15–1.45rem: duration, search input, info values, owner name.
- **Body** (PT Sans Narrow 400, 0.86–0.95rem, 1.4): Row sub-lines, hints, status, meta.
- **Label** (PT Sans Narrow 700, 0.72rem, 0.12em, uppercase, `print-2`): Printed form fields on the card (ЗАПИСЬ, НАЙТИ, ПОРЯДОК, the № / НАИМЕНОВАНИЕ / ВРЕМЯ header, ССЫЛКА, info terms). Each one names the field it sits on.
- **Mono** (PT Mono, 0.9rem; 1.15rem on counter wheels): Elapsed/total time and the tape counter.

### Named Rules
**The Field Label Rule.** Uppercase label type is the printed name of the form field it sits on, inline with that field, the way a J-card prints its field names. It never floats above a section as a heading.

## Layout

The layout is phone-first and has two tabs. On phones the J-card and the player share one grid cell, and a 4-key transport row (`--transport-h` 76px plus the bottom safe area) toggles between them. The cassette is sized by `min(100%, 520px, 33dvh × 1.58)` so the controls never slide under the keys. The player column is capped at 520px.

At ≥960px the card becomes a fixed left column (`minmax(380px, 440px)`) and can collapse. The player centers in the remaining space, capped at 640px, with the cassette at `min(100%, 600px, 42dvh × 1.58)`. The transport drops to 3 keys and loses its tab key. Sheets become bottom sheets under 700px and centered cards above it. Under 720px of height on phones the VU meter is hidden and the panel tightens.

The card rhythm is a 20px side gutter, 64px ruled rows on a `3rem | 1fr | 4.2rem` grid (№ / name / time), and an orange vertical margin line after the № column that runs the full scroll height. Every touch target is 44px or larger.

## Elevation & Depth

Depth is physical, not ambient. The card is flat paper, separated only by printed rules: 2px `print` for major breaks, 1px `rule` for lines. The deck side gets its depth from objects. The cassette casts a double drop shadow. Keys and LED buttons have a solid skirt below them that collapses when pressed. Floating items (toasts, cover view) get a soft dark shadow.

### Shadow Vocabulary
- **Cassette cast** (`filter: drop-shadow(0 16px 22px rgba(0,0,0,.6)) drop-shadow(0 3px 5px rgba(0,0,0,.45))`): Only the cassette.
- **Key skirt** (`0 -1px 0 rgba(255,255,255,.6) inset, 0 5px 0 #8c8c86, 0 8px 12px rgba(0,0,0,.55)`, raised `translateY(-3px)`): Transport keys at rest. When pressed or latched the skirt goes to 0 and the key drops to `translateY(2px)`.
- **LED button skirt** (`0 2px 0 #0c0d0f, 0 3px 6px rgba(0,0,0,.35)`): Panel toggles. Collapses on `:active`.
- **Float** (`0 8px 20px rgba(0,0,0,.45)`; cover `0 24px 60px rgba(0,0,0,.6)`): Toasts and the full cover view.

### Named Rules
**The Mechanical Skirt Rule.** A solid offset edge under a control is the visible side of a physical key. It exists only on deck keys and LED buttons, and it must collapse when the control is pressed. Paper surfaces never carry one.

## Shapes

Paper is nearly square. Rows and rules have no radius, print blocks (the side letter) use 2px, and stamps use 4px. Plastic is softly rounded: 6px for the window and badge, 8px for controls, 12px for the panel, and 14px for the top corners of a bottom sheet. Keys are asymmetric at 7px top and 10px bottom. Two forms recur. Hand-placed elements sit slightly off true: the stamp at −1.2°, a toast at −0.8°, and the stripes skewed −24°. The cassette label is clip-path cut around the tape window.

## Components

### Buttons
- **Stamp (primary action):** Rubber-stamp outline at 2.5px `orange-ink`, 4px radius, 46px tall, printed caps at 1.05rem/0.14em, rotated −1.2°, with a round record dot that blinks while recording. On hover it fills solid orange-red with white text. On press it scales to 0.97. The danger variant swaps to `danger`.
- **Text button:** Printed caps (0.86rem, 0.1em) with an 18px SVG icon, 44px tall, `on-shell-2` that lifts to `on-shell` on a 6% white wash. Disabled sits at 35% opacity. On the card it uses `print-2`.
- **Icon button:** 44px (or 32px small) square, 10px radius, neutral 14% grey hover.
- **Focus:** A 2px `yellow` ring, offset 2px, on the dark side. It becomes `cobalt` inside the card and sheets.

### Deck Keys (signature)
These are piano keys in an ivory gradient, 58px tall, with a 26px SVG glyph in `print`. The play key carries a 6px `orange` band on top and stays visibly latched (pressed and darker) while playing. On phones the fourth key toggles between the card and the cassette.

### LED Toggles
These are dark plastic buttons (`#23252b`, 8px radius) with a 7px LED. The LED is dull `#3b3d45` when off and an orange radial glow when on. Repeat-one adds a small orange "1".

### Track Row / J-card Form
Each row is a 64px ruled line. The number is in printed tabular figures, the title in Neucha `ball`, the artist/album sub-line in printed grey, and the duration handwritten. The playing title gets a skewed `hi` highlighter sweep. A line already heard gets a blue pen tick over its number. A missing file is struck through in blue and tagged with an outlined `orange-ink` "НЕТ ФАЙЛА". New rows flash highlighter for 1.8s.

### Inputs / Fields
- **Written line:** No box. A printed field label sits inline, the input text is handwritten `ball` at 1.35rem, there is a 1px `print` underline, and the caret is orange. On focus the underline doubles to cobalt.
- **Sort boxes:** 15px printed squares. Selection draws a 24px ballpoint tick overflowing the box, which animates in from a scaled-down, rotated state.
- **Range (volume):** A 4px track and a 14×22px brushed-metal fader cap.

### Sheets
Sheets are J-card paper with the tricolor printed as a 6px top edge, a printed caps headline and a 20px body gutter. Info sheets list printed terms against handwritten values on ruled lines.

### Cassette, Counter, VU
The cassette is an SVG in smoked plastic, with a paper label (side letter block, handwritten title, track cover, tricolor foot) and a window that is a 44px-reachable seek scrubber with an orange head. The counter shows PT Mono digits on rolling black wheels. The VU meter is a canvas pair of warm-lit analog needles with a red zone and is toggleable.

## Do's and Don'ts

### Do:
- **Do** put every new surface on one of the two materials: `deck`/shell plastic or `card` paper.
- **Do** write owner content (titles, names, typed input) in Neucha `ball`, and print form structure in PT Sans Narrow caps `print-2`.
- **Do** use the stamp for the single primary action on a card surface, and deck keys/LED buttons for playback controls.
- **Do** draw icons as inline SVG symbols with `currentColor`.
- **Do** keep touch targets at 44px or larger and respect `prefers-reduced-motion`.
- **Do** run motion on `cubic-bezier(0.16, 1, 0.3, 1)` and keep key travel under 100ms.

### Don't:
- **Don't** use blurred-cover backgrounds or pill buttons. The world explicitly rejects the streaming-app clone.
- **Don't** put uppercase label type above a section as a heading. It labels a field inline (The Field Label Rule).
- **Don't** reorder the tricolor or use its colors as general fills.
- **Don't** put offset skirts or drop shadows on paper. Depth on the card comes from printed rules.
- **Don't** set printed UI chrome in Neucha, or handwritten entries in printed caps.
