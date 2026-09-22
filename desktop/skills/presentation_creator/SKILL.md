---
name: presentation_creator
description: Build polished PowerPoint presentations — pitch decks, executive briefings, product roadmaps, status updates — with clean structure, consistent design, and speaker notes, scaled to the actual content rather than a fixed template. Use this whenever the user asks for a presentation, slide deck, pitch deck, briefing, or slides for a talk or meeting.
---
# Presentation & Slide Deck Guidelines

## Plan Before Building
- Infer or confirm audience, purpose (pitch / status update / training / board briefing), and rough length before choosing a structure. Don't force every request into the same fixed slide count — a 3-slide lightning update and a 15-slide investor deck need different shapes.
- Default architecture for a standard business deck (adapt freely to the actual content):
  1. Title (bold title, subtitle, presenter/date)
  2. Agenda / context
  3. Problem or opportunity
  4. Core content — as many slides as the material needs (data points, key metrics, strategic pillars)
  5. Risks or considerations, when relevant
  6. Next steps / the ask
- If the user's content doesn't map cleanly onto this shape, reshape it around their content rather than padding or cutting to fit.

## Content Density
- Max ~6 bullets per slide, ~10 words per bullet. Where the content is quantitative, prefer one strong chart or number over a wall of bullets.
- If bullet text won't fit the placeholder at a readable size (~18pt or larger), split into two slides — never shrink text to make it fit.
- Add concise speaker notes on any slide dense enough to need them, so the deck also works as a stand-alone leave-behind.

## Design
- Default palette: Deep Navy `#0F172A` with Vibrant Cyan `#06B6D4` accents — but use the user's brand colors instead if they give any.
- Keep one consistent palette and font pairing across the whole deck. Check text/background contrast is legible (no light-on-light or low-contrast combinations).

## Files & Presentation
- Filename: `<Topic>_<YYYY-MM-DD>.pptx`, saved to `~/Desktop` unless told otherwise.
- Only call `open_application(app_name="powerpoint")` if that tool is actually available and the session has an interactive desktop — never assume a GUI exists. Otherwise just hand over the file.