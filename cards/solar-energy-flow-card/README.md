# Solar Energy Flow Card

Date-selectable Home Assistant Recorder history for solar, battery, grid, and load power. This card draws a power history chart; it does not calculate energy totals or source-to-load allocation.

## HACS installation

Publish this repository on GitHub, then add its URL in HACS → Custom repositories with type **Dashboard** (called **Lovelace** in some versions). Download **Solar Energy Flow Card**, reload the browser, and add the YAML below as a Manual card.

The root `hacs.json` selects `dist/solar-energy-flow-card.js`. The GitHub repository may be named `homeassistant-custom-cards`; the explicit `filename` selects the card. Without releases, HACS uses the default branch. If publishing releases, include the current JavaScript file as a release asset.

If HACS does not add the resource automatically, add `/hacsfiles/YOUR_REPOSITORY_NAME/solar-energy-flow-card.js` as a JavaScript module in dashboard resources, replacing `YOUR_REPOSITORY_NAME` with the actual GitHub repository name.

## Manual installation

Copy `dist/solar-energy-flow-card.js` to `/config/www/solar-energy-flow-card.js` and register `/local/solar-energy-flow-card.js` as a JavaScript module resource.

## Configuration

```yaml
type: custom:solar-energy-flow-card
title: Energy history
entities:
  solar: sensor.solar_power
  battery: sensor.battery_power
  grid: sensor.grid_power
  load: sensor.home_load_power
```

Replace the example IDs with your real IDs in your private Home Assistant dashboard configuration. Do not commit your local configuration here.

| Option | Required | Meaning |
| --- | --- | --- |
| `type` | Yes | `custom:solar-energy-flow-card` |
| `title` | No | Plain text heading; defaults to `Solar power history` |
| `entities.solar` | Yes | Solar power sensor |
| `entities.battery` | Yes | Battery power sensor |
| `entities.grid` | Yes | Grid power sensor |
| `entities.load` | Yes | Load power sensor |

All four sensors must report numeric **watts**. Values are plotted as reported, including negative values; no sign or unit conversion is performed. `hours` was previously unused and remains ignored; the card always shows one calendar day.

Use the arrows, date field, and Today button to load a day. The day uses the browser's local timezone, which should match your intended Home Assistant timezone. Recorder and History must be enabled and retain the selected sensors. Unavailable or nonnumeric states are skipped. This uses recent state history, not long-term statistics. Dates with no retained readings show an empty chart. To retry after an error, use a date control or Today. The chart refreshes on date selection, configuration, or page reload; it does not continuously poll live readings.

## Development

Edit `cards/solar-energy-flow-card/solar-energy-flow-card.js`, then copy it to `dist/solar-energy-flow-card.js`. Run:

```sh
node --check cards/solar-energy-flow-card/solar-energy-flow-card.js
node --check dist/solar-energy-flow-card.js
node --test tests/card.test.cjs
TZ=America/New_York node --test tests/card.test.cjs
ruby -ryaml -e 'Dir["**/*.yaml"].each { |path| YAML.load_file(path) }'
```

CI checks JavaScript, YAML, distribution consistency, and HACS metadata. Test installation in your own Home Assistant before publishing a release.
