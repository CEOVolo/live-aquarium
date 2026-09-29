import test from 'node:test';
import assert from 'node:assert/strict';
import { SPECIES, SPAWNABLE, INTENTS, ENGINE_EVENTS, RULES, INTENT_LABEL } from '../server/catalog.js';

test('every chat intent has a rule, an overlay label and a way into the engine', () => {
  const engineKind = { wish: 'golden', spawn: 'fish_add', myfish: 'spotlight' };
  assert.deepEqual(Object.keys(RULES).sort(), [...INTENTS].sort());
  for (const intent of INTENTS) {
    const r = RULES[intent];
    assert.ok(['vote', 'meter', 'request'].includes(r.kind), intent);
    assert.ok(r.modes.length > 0 && r.modes.every((m) => m === 'interactive' || m === 'tv'), intent);
    assert.equal(typeof r.priority, 'number', intent);
    assert.ok(INTENT_LABEL[intent], intent);
    assert.ok(ENGINE_EVENTS.includes(engineKind[intent] ?? intent), intent);
  }
});

test('vote rules are consistent: base <= max, gathering shorter than the window, TV cooldowns longer', () => {
  for (const [intent, r] of Object.entries(RULES)) {
    if (r.kind !== 'vote') continue;
    const [base, frac, max] = r.need;
    assert.ok(base >= 1 && frac >= 0 && max >= base, intent);
    assert.ok(r.gatherMs < r.windowMs, intent);
    assert.ok(r.cooldownMs > 0, intent);
    if (r.modes.includes('tv')) assert.ok(r.tvCooldownMs >= r.cooldownMs, intent);
  }
});

test('TV mode only offers calm events', () => {
  assert.deepEqual(INTENTS.filter((i) => RULES[i].modes.includes('tv')).sort(), ['bubbles', 'feed', 'wish']);
});

test('the species list is the spawn whitelist', () => {
  assert.deepEqual(SPAWNABLE, Object.keys(SPECIES));
});
