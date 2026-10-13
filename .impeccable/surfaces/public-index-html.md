---
version: 1
slug: "public-index-html"
primary_target: "public/index.html"
related_targets: []
---

Scope: whole player app (public/index.html), mode Operate. Phone-first full-screen player over LAN; desktop secondary.
Job: find and play a track from the owner's library, add one by URL, manage it (info, download, delete).
Constraints: static HTML/CSS/JS, Russian UI, existing API. Removed: extra list views, playback speed.

## Direction contract

THESIS: The library is a home-recorded МК-60 cassette: the tracklist is its J-card filled in by hand, the player is the cassette itself turning in the deck. Refuses the blurred-cover-plus-pill-buttons streaming clone.

OWN-WORLD: Smoked translucent shell plastic (#16171b) around a cool-white printed J-card (#f4f4f0); printed form in PT Sans Narrow caps (СТОРОНА А, №, НАИМЕНОВАНИЕ, ВРЕМЯ) with factory stripes in signal orange #ff5a1f, cobalt #2a44d4, and yellow #ffc928; entries in blue ballpoint (#1f3aa8) set in Neucha; yellow highlighter marks what is playing; pen ticks mark what was heard. Deck keys are chunky mechanical piano keys that depress; LEDs for shuffle/repeat; analog VU needles.

STORY: Opening the app shows the tape loaded and the J-card under the thumb; you see your own handwriting-style list, tap a line and the reels start turning; adding a track = "записать трек", a new line appears on the card.

FIRST VIEWPORT: Phone: top 55% the cassette — J-card front cover image (track thumbnail) seated above a shell with two reels whose tape mass shifts left→right with progress, window strip is the seek scrubber, tape counter wheels; big handwritten title + printed artist; bottom a full-width row of 4 deck keys (◀◀ ▶/❚❚ ▶▶ + J-card) under the thumb. J-card tab: unfolded card with ruled form lines, search as a written line, sort as pen-ticked boxes, "+ записать трек" stamp at bottom. Desktop: J-card left column, cassette right.

FORM: Cassette J-card (МК-60), my list position 1 (pick), seed key ad63a346.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
