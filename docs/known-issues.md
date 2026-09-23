# Deferred UI issues

These are documented and intentionally deferred while deployment/runtime work is implemented.

## Dockview tab hitbox overlap

In one recovered workspace state, the fixed Atlas title bar overlaps the top Dockview tab row. The tab remains visible but pointer events are intercepted by the title bar, so right-clicking or clicking that tab can time out in Playwright. The existing 6px geometry, viewport, sidebar-width, divider, and empty-center assertions remain valid; this is a separate stacking/hitbox defect.

## Empty workspace presentation

The protected Dockview anchor can present a very large, visually sparse empty region in the shell. The rails and status bar remain functional, but the center needs a stronger deployment-oriented empty state and clearer recovery affordances.

The failing browser scenario and screenshots are retained as regression evidence. No further UI changes are part of the current deployment/runtime slice.
