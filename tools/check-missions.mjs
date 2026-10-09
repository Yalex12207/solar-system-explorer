/** Report mission-data completeness and the timeline ordering. */
import { MISSIONS } from '../src/data/missions.js';

const year = (m) => m.milestone ?? m.launch;
const required = [
  ['apollo', 'Apollo'],
  ['voyager-1', 'Voyager 1'],
  ['voyager-2', 'Voyager 2'],
  ['cassini', 'Cassini'],
  ['juno', 'Juno'],
  ['new-horizons', 'New Horizons'],
  ['mars', 'Mars Rover'],
];

console.log('missions:', MISSIONS.length);
const missingAchievement = MISSIONS.filter((m) => !m.achievement).map((m) => m.id);
console.log('without achievement:', missingAchievement.length, missingAchievement.join(','));

const missingRequired = required.filter(([, label]) => {
  const needle = label.toLowerCase().replace(' rover', '');
  return !MISSIONS.some((m) => m.name.toLowerCase().includes(needle));
});
console.log('required missions missing:', missingRequired.length, missingRequired.map(([, l]) => l).join(','));

console.log('\ntimeline (sorted):');
for (const m of [...MISSIONS].sort((a, b) => year(a) - year(b))) {
  const marker = [1977, 1997, 2011, 2015, 2004, 1969, 2020].includes(year(m)) ? '*' : ' ';
  console.log(` ${marker} ${String(year(m)).padEnd(5)} ${m.name.padEnd(30)} ${m.status}`);
}
