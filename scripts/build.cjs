const fs = require('node:fs');
const path = 'cards/solar-energy-flow-card/';
const engine = fs.readFileSync(path + 'vendor/apexcharts.esm.js', 'utf8');
const tail = 'export{Jt as default};';
if (!engine.includes(tail)) throw new Error('Unexpected vendored engine format');
const output = `/* Solar Energy Flow Card; includes ApexCharts 3.54.1 (MIT).
${fs.readFileSync(path + 'vendor/LICENSE', 'utf8')}
*/\n(() => {\nconst SolarEnergyCharts = (() => {\n${engine.replace(tail, 'return Jt;')}\n})();\nconst ApexCharts = SolarEnergyCharts;\n${fs.readFileSync(path + 'solar-energy-flow-card.js', 'utf8')}\n})();\n`;
if (process.argv.includes('--check')) {
  if (fs.readFileSync('dist/solar-energy-flow-card.js', 'utf8') !== output) {
    throw new Error('Distribution is stale; run node scripts/build.cjs');
  }
} else {
  fs.writeFileSync('dist/solar-energy-flow-card.js', output);
}
