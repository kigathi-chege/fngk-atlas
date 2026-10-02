---
name: fngk-interface
description: Build or revise FNGK Atlas workspace UI, docking, panels, terminal presentation, and desktop interactions. Use for Atlas interface work; do not use it to alter Signal protocols without a demonstrated compatibility blocker.
---

# FNGK Atlas interface engineering

Atlas is a Svelte 5 desktop-first application using Dockview, xterm, CodeMirror,
Fastify, and Tauri. Inspect and reuse the existing panel registry, command registry,
workbench state, and terminal transport before creating a replacement abstraction.

## Non-negotiable interaction rules

- Treat the workspace as an application: routine actions must not destroy docking,
  focus, terminal, connection, or selection state.
- Terminal ownership is independent of presentation. Moving, floating, hiding, and
  minimizing a terminal must retain its FNGK session; only explicit lifecycle
  actions may stop, archive, or close it.
- Persist only safe UI metadata. Never store terminal bytes, editor buffers,
  credentials, URLs containing tickets, or FNGK secrets in layout state.
- Scope persisted layouts to the selected profile and context. Use the existing
  credential-free FNGK profile/lifecycle contracts; preserve profile arguments on
  all FNGK commands.

## Workspace conventions

- Keep the central dock visually primary. Rails minimize contextual sidebars;
  bottom dock entries restore their original panel/session without reconnecting by
  default.
- Reuse Dockview for docking and floating. Splitters need an accessible, generous
  hit target and a centered three-dot affordance without visually heavy borders.
- Use semantic design tokens. Dark is the primary experience, but every new token
  must have a light-theme value and visible focus treatment.
- Prefer lazy panel loading and virtualized large collections. Do not load an
  inspector merely because it exists in the activity rail.

## Verification

Add a focused failing test before behavior changes, then verify it passes. Cover
keyboard navigation, focus restoration, profile scoping, safe persistence, and
terminal continuity whenever affected. Preserve browser fallbacks for Tauri-only
features and measure startup/payload effects before accepting new dependencies.
