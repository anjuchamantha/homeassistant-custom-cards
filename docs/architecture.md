# Architecture

Editable cards are self-contained under `cards/`. The matching JavaScript under `dist/` is the HACS distribution; the build bundles source with the vendored MIT ApexCharts engine, and tests require the bundle to be current. Root `hacs.json` explicitly selects the installable file. Dashboard snippets depend on separate HACS cards and are not bundled JavaScript components.

Configuration comes from private dashboard YAML. The card uses Home Assistant's existing authenticated frontend API session to read history; it does not store credentials or contact external services. REST history is an array of per-entity state arrays, with the entity ID on the first state when using minimal responses. Date boundaries use the browser timezone and calendar arithmetic. Request sequencing prevents older requests from overwriting the selected date.

The card normalizes either entities or explicit series into one plot configuration. Recorded samples are grouped into aligned buckets so shared tooltips can compare readings at matching timestamps. Rendering is serialized; chart instances are destroyed on reconfiguration, date changes, or disconnection. Each card has unique main/brush IDs, and its engine constructor is kept private in the distribution scope.
