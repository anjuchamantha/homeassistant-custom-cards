# Home Assistant Custom Cards

Reusable Home Assistant Lovelace cards and dashboard snippets for energy and smart-home projects.

## Solar Energy Flow Card

A date-selectable chart for solar, battery, grid, and load power history. Install this repository as a HACS custom **Dashboard** repository. See the [installation guide and configuration options](cards/solar-energy-flow-card/README.md).

The installable file is `dist/solar-energy-flow-card.js`; editable source is under `cards/solar-energy-flow-card/`.

## Dashboard snippets

`dashboard-snippets/` contains generic examples for separately installed Button Card, ApexCharts Card, and Power Flow Card Plus. Replace the example sensor IDs in your private dashboard. The Solar Guardian style example has inverter-specific threshold and current-direction assumptions that you must adapt to your equipment.

Keep actual entity IDs, credentials, and private URLs in local Home Assistant configuration. This repository does not need Home Assistant tokens or connection details.
