# Atlas Rail, Form, and Loading System Design

## Intent

Atlas should feel like one dependable desktop workspace. Its activity rail must preserve orientation while many devices are present; routine cancellation must never be presented as a remote filesystem failure; and every editable value and asynchronous operation must use a coherent, accessible visual language.

This design preserves the existing Svelte, Dockview, and token-based Atlas architecture. It does not introduce shadcn-svelte or another UI runtime. Shadcn/Svelte is used only as interaction and composition inspiration: small reusable primitives, predictable labels and states, keyboard-friendly controls, and no hidden global form framework.

## Scope and Success Criteria

1. The left activity rail has three visually and behaviorally separate regions:
   - a fixed top region for brand and workspace/global navigation;
   - a middle region containing only device contexts, scrolling independently when necessary;
   - a fixed bottom region for universal actions.
2. The device list hides its native scrollbar, preserves wheel/keyboard/touch scrolling, and provides visible, accessible earlier/later affordances only when it overflows in that direction.
3. Opening or expanding one filesystem location must not cancel unrelated folder requests. Expected cancellation must not be wrapped as `route_unavailable`, retried as a route failure, or shown in `panel-error`.
4. Atlas has shared form primitives covering text input, multiline input, select, and searchable combobox. Their focus, border, disabled, invalid, helper, loading, and theme behavior is uniform.
5. Existing raw controls migrate to the shared primitives when the form is user-facing. Native controls remain only where they are semantically required and wrapped/styled by the shared primitive.
6. Every user-visible asynchronous operation exposes a local loading state. A local operation does not block unrelated controls or panels.
7. Duplicated control styles and obsolete ad-hoc components are removed only after all imports migrate and the build/test suite proves they are unused.

## Architecture

### Activity Rail

`ActivityRail.svelte` becomes a structural shell with `activity-rail-top`, `activity-rail-devices`, and `activity-rail-bottom` regions. The rail itself is a fixed-height flex column with `overflow: hidden`. Top and bottom use `flex: none`; the device region uses `flex: 1; min-height: 0` and owns `RailScrollViewport`.

`RailScrollViewport.svelte` remains the one overflow implementation. It accepts general slot content, reports directional overflow via a `ResizeObserver` and `scroll` listener, hides only the native scrollbar, and renders controls that communicate the contained collection through a prop (defaulting to Devices). It must not alter outer rail layout or use absolute controls that overlap fixed regions.

### Filesystem Request Lifecycle

`FilesystemTree.svelte` replaces its single `navigationController` with a controller registry keyed by normalized path. Starting a request may cancel a previous request for *that same path*; it cannot cancel a load for another expanded directory. Context/root transitions and component teardown cancel every registered request.

The UI owns a monotonic request token per path. A response can update `children[path]` only when it is still the active token for that path and the selected context/root is unchanged. `pendingPaths` is derived from active path requests and continues to drive row-level spinners.

`FileService` treats cancellation as terminal control flow. If the passed `AbortSignal` is aborted, or a route reports the canonical cancellation error, it immediately rethrows cancellation instead of aggregating it into `#unavailable`. The server’s existing error normalization will map that controlled cancellation consistently. The client ignores cancellation in the same way it ignores browser `AbortError`; no error banner is emitted.

### Form Primitives

A small `src/web/components/ui/` layer owns durable form behavior:

- `AtlasField.svelte`: label, description, required indicator, error text, and `aria-describedby` wiring.
- `AtlasInput.svelte`: single-line input with optional leading/trailing adornments and an operation-level spinner.
- `AtlasTextarea.svelte`: multiline equivalent of `AtlasInput`.
- `AtlasSelect.svelte`: compact, styled native select for small fixed option sets, with a consistent chevron and state treatment.
- `AtlasCombobox.svelte`: searchable listbox for profiles, contexts/devices, roots, and any large/dynamic selection. It supports keyboard navigation, Escape dismissal, busy state, empty state, and selected-value announcement.

The primitives consume Atlas CSS tokens and emit ordinary Svelte bindings/events. They do not own network data, form submission, or panel state. Panels continue to own validation and actions, preventing a global form store.

### Loading States

`LoadingSpinner.svelte` and `LoadingState.svelte` remain the visual base. Shared primitives receive `busy`/`loadingLabel` props; panels model asynchronous operations with explicit local booleans or keyed maps. Error content appears only for a failed operation, and controls remain independently usable unless that exact action is unsafe while pending.

An audit migrates current raw form and loading sites, including profile selection, unified-search filtering, filesystem sorting/search/create/rename, save-as, handoff/deployment/port configuration, lifecycle controls, app connections, and agent/chat prompts. Lazy panel imports must use a loading fallback rather than blank panel space.

## Visual and Accessibility Rules

- Tokens in `theme.css`/workspace CSS define control height, radius, surface, border, focus ring, text, placeholder, error, and disabled colors; components do not hard-code their own palette.
- Focus is visible using the same ring on all controls, including selects and combobox list items.
- All fields retain real labels or `aria-label`; errors are associated via `aria-describedby`; busy values use an accessible status message.
- Combobox behavior uses input/listbox semantics and supports ArrowUp, ArrowDown, Enter, Escape, Home, and End.
- Spinner motion respects `prefers-reduced-motion` through the existing spinner primitive.
- Light and dark themes use the same semantic tokens rather than duplicated component palettes.

## Error and Recovery Rules

- A cancellation says nothing to the user by default because it is a normal navigation consequence. A genuine timeout, offline device, authorization problem, or exhausted route set retains its actionable message and is shown near the affected operation.
- A cancelled directory request removes only its own pending indicator.
- Switching context/root clears obsolete pending requests and data without allowing old responses to repopulate the current tree.
- Failed combobox data loads present an inline retry action and retain the current selection.

## Validation

Tests will prove rail region structure and overflow affordances; distinct concurrent folder loads and same-path cancellation; service-level cancellation propagation; form primitive semantics and keyboard behavior; migration coverage preventing raw user-facing selects/inputs outside approved exceptions; and loading behavior for representative file, dialog, and lazy-panel operations.

The complete repository suite, web type-check, production build, and browser end-to-end suite remain required verification before merge.
