# Drinkit UI stack share

## Goal

Show `Modules by UI stack` as a 100% stacked share chart and remove the two
style-token share charts from the Drinkit Android dashboard.

## Design

Generalize the existing `share` renderer from exactly two series to every series
listed by a chart spec. At each timestamp common to all listed series, normalize
their values to percentages whose sum is 100, then render them in spec order as
stacked areas. A two-series spec must keep the same labels, colors, values, and
stacking order it has today.

The Drinkit Android chart spec changes only in the UI group:

- `ui-module-stacks` changes from `line` to `share` and keeps its three existing
  series: `Modules:ComposeOnly`, `Modules:Mixed`, and `Modules:ViewOnly`.
- `ui-typography` is removed.
- `ui-colors` is removed.

The Android collector already uploads all three module-stack series together, so
neither `drinkit-mobile-android` nor the `code-metrics` service changes.

## Acceptance criteria

| id | Observable result | Evidence |
|---|---|---|
| AC-1 | `Modules by UI stack` renders three shares totaling 100% at every plotted timestamp. | Automated renderer test. |
| AC-2 | Existing two-series `share` specs retain their current output. | Automated compatibility test. |
| AC-3 | The Drinkit Android page no longer contains `Text styles: theme vs hardcoded` or `Colors: theme vs hardcoded`. | Built-page assertion. |
| AC-4 | Other charts and page sections remain present and the repository checks pass. | Full repository checks and local preview. |

## Out of scope

- Changes to metric collection or storage.
- Changes to the Dodo iOS chart specification.
- Visual redesign beyond the existing `share` chart presentation.
