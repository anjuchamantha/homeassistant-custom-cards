# Changelog

## Unreleased

- Arranged complete energy summaries as colored equation boxes: Solar + Grid + Discharge − Charge − estimated losses = Home, preserving measured totals and the card height.
- Matched the pastel solar/grid/battery palette to the reference and changed Home/Load to red; added direction filtering to color charging and discharging separately.


- Moved energy totals from large bottom tiles into a compact top-right header block, with full descriptions available on hover/focus.
- Kept the original card height when totals wrap on narrow cards by reallocating plot height, including on resize.


- Added optional selected-range energy summaries from cumulative energy helpers, with solar/load/grid and separate battery charge/discharge totals.
- Added Wh/kWh/MWh conversion, explicit missing/reset explanations, zoom/brush synchronization, and a generic summary example.


- Moved the 0 W baseline label to the right edge to keep it clear of left-axis tick labels.


- Removed the separate cross-day timeline slider; retained the brush overview and date controls.




- Made the heading optional: omit `title`, set it empty, or use `header.show: false`.
- Replaced the basic canvas plot with locally bundled ApexCharts 3.54.1 (MIT), smooth area/line styling, zoom/pan/reset/export, shared tooltips, and a brush overview.
- Added a dashed, labeled 0 W baseline and automatic bounds including zero.
- Added ApexCharts-style series configuration, five-minute sample averaging with null gaps, per-series styling, 12/24-hour time, chart/brush options, and responsive date controls.
- Preserved existing `entities` configuration; added a complete ApexCharts-style example, schema, browser tests, and distribution build checks.


- Initial reusable repository layout.
- Added Solar Energy Flow Card package and generic configuration example.
- Replaced device-specific entity IDs with generic examples and completed the MIT license.
- Added HACS distribution under `dist/` and corrected root metadata.
- Fixed minimal REST history parsing, calendar-day boundaries, repeated configuration, and stale request handling.
- Rendered configurable titles and errors as text to prevent HTML injection.
- Added configuration validation, regression tests, CI, local-file ignore rules, and installation documentation.
- Removed the unverified Home Assistant 2025.10.0 minimum from HACS metadata. Compatibility still requires testing on the installed Home Assistant version.
