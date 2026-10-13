# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
One owner of a personal music library. Main scene: a phone on the home Wi‑Fi, the player open full screen, music in the foreground. A desktop browser is secondary.

## Product Purpose
A local, self-hosted music library built from YouTube / YouTube Music links. Paste a link, the server downloads the audio as Opus with its metadata and cover, and the track lives on the owner's disk forever. Success: adding a track and playing the library from the phone is fast and pleasant.

## Positioning
The owner's own collection, not a streaming catalog: every track is a file on their machine, rescued from YouTube, with automatic restore if the file disappears.

## Operating Context
- Rust server (`cargo run --release`) on the owner's PC, opened from the phone over the LAN at `http://<pc>:3000`.
- Adding tracks = pasting a YouTube / YouTube Music URL; download takes seconds to minutes.

## Capabilities and Constraints
- API: `GET /api/library`, `POST /api/add {url}`, `GET /api/stream/:id` (Range), `GET /api/thumbnail/:id`, `DELETE /api/track/:id`. Missing files answer 404 `{restoring:true}` and restore in the background.
- Track fields: title, artist, album, track, release_date (DD.MM.YYYY), duration (string), view_count, like_count, abr, filesize_mb, extension, file_exists, thumbnail_api.
- Features to keep: search, sort (added / title / artist / album), play/pause, prev/next, shuffle, repeat, seek, volume, visualizer, cover full view, track info, download file, delete, add by URL, collapsible library on desktop.
- Removed by the owner: multiple list views (keep one good list), playback speed.
- UI language: Russian. Static HTML/CSS/JS in `public/`, no build step.

## Evidence on Hand
Real content only comes from the owner's library (covers are YouTube thumbnails). No invented tracks in shipped UI.

## Product Principles
- Phone first: thumb-reachable controls, full-screen player.
- The music and its cover lead; chrome recedes.
- Adding a track should feel like one gesture.

## Accessibility & Inclusion
Touch targets ≥ 44px, keyboard control on desktop, reduced-motion respected.
