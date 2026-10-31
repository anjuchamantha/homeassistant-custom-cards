# Architecture

Editable cards are self-contained under `cards/`. The matching JavaScript under `dist/` is the HACS distribution; the build bundles source with the vendored MIT ApexCharts engine, and tests require the bundle to be current. Root `hacs.json` explicitly selects the installable file. Dashboard snippets depend on separate HACS cards and are not bundled JavaScript components.

Configuration comes from private dashboard YAML. The card uses Home Assistant's existing authenticated frontend API session to read history; it does not store credentials or contact external services. REST history is an array of per-entity state arrays, with the entity ID on the first state when using minimal responses. Date boundaries use the browser timezone and calendar arithmetic. Request sequencing prevents older requests from overwriting the selected date.

The card normalizes either entities or explicit series into one plot configuration. Recorded samples are grouped into aligned buckets so shared tooltips can compare readings at matching timestamps. Rendering is serialized; chart instances are destroyed on reconfiguration, date changes, or disconnection. Each card has unique main/brush IDs, and its engine constructor is kept private in the distribution scope.

Optional energy summaries load cumulative helper histories in a separate, failure-isolated request. Attributes are retained to normalize units and detect explicit resets. Totals are counter differences at the selected main-chart boundaries, using recorded step values rather than interpolation or power integration. Main-chart mounted/updated/zoom/scrolled events keep the summary aligned with brush and toolbar changes. Energy IDs belong in private configuration, not source.

Energy totals use the header's existing vertical space on wide cards. If the totals wrap onto a second header row, its extra height is subtracted from the configured main plot height. A header ResizeObserver keeps the height budget consistent across responsive layout changes; summary descriptions stay in tooltips/accessibility text rather than adding visible rows.
