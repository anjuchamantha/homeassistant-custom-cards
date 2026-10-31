# Architecture

Editable cards are self-contained under `cards/`. The matching JavaScript under `dist/` is the HACS distribution; tests require both files to match. Root `hacs.json` explicitly selects the installable file. Dashboard snippets depend on separate HACS cards and are not bundled JavaScript components.

Configuration comes from private dashboard YAML. The card uses Home Assistant's existing authenticated frontend API session to read history; it does not store credentials or contact external services. REST history is an array of per-entity state arrays, with the entity ID on the first state when using minimal responses. Date boundaries use the browser timezone and calendar arithmetic. Request sequencing prevents older requests from overwriting the selected date.
