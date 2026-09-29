// Demo mode: the real Director, parser, world and crowd simulator from server/
// running inside the browser, so the whole chat -> votes -> events loop can be
// shown without a server or a YouTube stream. Imported only when the page runs
// as a standalone demo (node:fs / node:path are mapped to tiny shims there).
import { World } from '../server/world.js';
import { Director } from '../server/director.js';
import { Ambient } from '../server/ambient.js';
import { CrowdSimulator } from '../server/simulator.js';
import { parseMessage } from '../server/parser.js';

export function startDemo({ onHello, onEvent, onWorld, onMeters, onChat }) {
  const world = new World({ dataDir: null, dayLengthMin: 10, populationCap: 110 }).load();
  const director = new Director({ world });
  const ambient = new Ambient({
    director,
    world,
    config: { feedEveryMin: 3, tvFeedEveryMin: 3, goldenMeanMin: 15, nightJellyMeanMin: 5, birthsPerDayPerSpecies: 2 },
  });

  const handle = (msg) => {
    const now = Date.now();
    world.noteMessage(msg.userId, msg.userName);
    director.noteActivity(msg.userId, now);
    const parsed = parseMessage(msg.text);
    let result = null;
    if (parsed.intent) {
      const r = director.vote({ userId: msg.userId, userName: msg.userName, intent: parsed.intent, species: parsed.species, source: 'rules' }, now);
      result = r.accepted ? r.reason : `✗ ${r.reason}`;
    }
    onChat({ user: msg.userName, text: msg.text, intent: parsed.intent, species: parsed.species, result });
  };
  const sim = new CrowdSimulator({ onMessage: handle });

  const sync = () => {
    const now = Date.now();
    return {
      now, tod: world.tod(now), todRate: world.todRate(now), growth: world.state.growth, luck: world.state.luck,
      luckTarget: director.luckTarget(), population: world.population, mode: director.mode,
    };
  };

  director.on((ev) => {
    onEvent(ev);
    if (ev.kind === 'night' || ev.kind === 'day') onWorld(sync());
  });

  onHello({ mode: director.mode, world: { ...world.snapshot(), luckTarget: director.luckTarget() } });
  setInterval(() => {
    const now = Date.now();
    sim.tick(now);
    director.tick(now);
    ambient.tick(now);
  }, 100);
  setInterval(() => onWorld(sync()), 1000);
  setInterval(() => onMeters({ ...director.snapshot(), population: world.population }), 500);

  return {
    world,
    director,
    say(user, text) { handle({ userId: `demo:${user}`, userName: user, text, roles: {} }); },
    crowd(on, viewers = 40) { return on ? sim.start({ scenario: 'normal', viewers }) : sim.stop(); },
    raid(intent = 'shark', viewers = 1000) { return sim.raid({ intent, viewers, durationMs: 15000 }); },
    status() { return sim.status(); },
    trigger(kind, species) {
      const intent = kind === 'golden' ? 'wish' : kind;
      return director.vote({ userId: 'host', userName: 'Host', intent, species, admin: true, source: 'panel' });
    },
    setMode(mode) { director.setMode(mode); },
  };
}
