// "Watch Ben play": a full-screen TV-style broadcast of Ben playing Ridgeback National.
import { HOLES, dist } from './course.js';
import { simulateHole } from './sim.js';
import { HoleScene } from './scene.js';
import { Broadcast } from './broadcast.js';
import { QUALITY_NAMES, getQualityName, setQualityName } from './assets.js';

const PLAYER = 'Ben';
const HANDICAP = 5; // Ben's skill level for the simulated shots (0 = scratch, 20 = bogey golfer)

const $ = (id) => document.getElementById(id);
const view = new HoleScene($('view'));
const director = (view.director = new Broadcast(view, $('overlay')));
const NAMES = ['Welcome', 'Heron Pond', 'The Drop', 'Elbow', 'Creekside', 'Cathedral', 'Long Walk', 'Needle', 'The Turn',
  'Twin Gates', 'Pond Corner', 'Teacup', 'Temptation', 'Summit', 'Short Fuse', 'Long Iron', 'Marathon', 'Clubhouse'];

let hole = 0;
let roundOn = false;
let total = 0; // strokes relative to par during a full round

// One simulated play of a hole for Ben. For a clean broadcast, skip plays that
// hit the water, top the tee shot, four-putt or score worse than double bogey.
function playFor(k) {
  const h = HOLES[k];
  const { traces } = simulateHole(k, { plays: 60, handicaps: [HANDICAP], tracePlays: 60 });
  const all = traces[HANDICAP];
  const clean = (shots) => !shots.some((s) => s.splash)
    && dist(shots[0].from, shots[0].to) >= 0.45 * Math.min(h.len, 250)
    && shots.filter((s) => s.putt).length <= 3
    && strokesOf(shots) <= h.par + 2;
  const plays = [all.filter(clean), all.filter((shots) => !shots.some((s) => s.splash)), all].find((p) => p.length);
  return plays[Math.floor(Math.random() * plays.length)];
}
const strokesOf = (shots) => shots.length + shots.filter((s) => s.splash).length;

function showHole(k) {
  hole = k;
  $('hole').value = k;
  view.show(HOLES[k]);
}

async function watchHole(k, label = PLAYER) {
  if (director.active) { director.stop(); await new Promise((r) => setTimeout(r, 0)); }
  showHole(k);
  const shots = playFor(k);
  setPlaying(true);
  await director.play(HOLES[k], shots, label, 'ben');
  return shots;
}

async function playRound() {
  roundOn = true;
  total = 0;
  for (let k = 0; k < 18 && roundOn; k++) {
    const label = k === 0 ? PLAYER : `${PLAYER} · ${total === 0 ? 'E' : total > 0 ? '+' + total : total} thru ${k}`;
    const shots = await watchHole(k, label);
    if (!roundOn) break;
    total += strokesOf(shots) - HOLES[k].par;
  }
  roundOn = false;
  setPlaying(false);
}

function setPlaying(on) {
  $('stop').hidden = !on;
  $('controls').classList.toggle('dim', on);
}

$('hole').innerHTML = HOLES.map((h, k) => `<option value="${k}">Hole ${k + 1} · ${NAMES[k]} · Par ${h.par} · ${h.yards} yds</option>`).join('');
$('hole').addEventListener('change', (e) => { roundOn = false; director.stop(); showHole(+e.target.value); });
$('watch').addEventListener('click', () => { roundOn = false; watchHole(hole).then(() => setPlaying(roundOn)); });
$('round').addEventListener('click', () => playRound());
$('stop').addEventListener('click', () => { roundOn = false; director.stop(); setPlaying(false); });
director.onEnd = () => { if (!roundOn) setPlaying(false); };

$('quality').innerHTML = QUALITY_NAMES.map((q) => `<option value="${q}" ${q === getQualityName() ? 'selected' : ''}>${q[0].toUpperCase() + q.slice(1)}</option>`).join('');
$('quality').addEventListener('change', (e) => { setQualityName(e.target.value); location.reload(); });

showHole(0);
window.showStatus?.('');
