// Fast rule-based chat parser. Handles the obvious commands (FEED, 🦈, акула,
// "!fish clownfish", typos like "shrak") in a few microseconds, so the AI parser
// only sees free-form requests that the rules could not understand.

const LEX = {
  feed: {
    words: ['feed', 'food', 'feeding', 'feedme', 'eat', 'hungry', 'snack', 'snacks', 'flakes', 'pellets',
      'comida', 'comer', 'alimentar', 'alimenta', 'essen', 'futter', 'fuettern', 'füttern', 'nourrir',
      'nourriture', 'manger', 'cibo', 'mangiare', 'jedzenie',
      'еда', 'еды', 'жрать', 'хавчик', 'їжа', 'їжі', 'їжу', 'їсти', 'ням'],
    stems: ['корм', 'покорм', 'накорм', 'подкорм', 'голодн', 'годув', 'годуй', 'погодуй', 'нагоду'],
  },
  shark: {
    words: ['shark', 'sharks', 'jaws', 'megalodon', 'tiburon', 'tiburón', 'tubarao', 'tubarão', 'haie',
      'requin', 'squalo', 'rekin'],
    stems: ['акул'],
  },
  night: {
    words: ['night', 'nights', 'nighttime', 'dark', 'darker', 'darkness', 'moon', 'moonlight', 'noche',
      'nacht', 'nuit', 'notte', 'noc', 'noite', 'ночь', 'ночи', 'ночью', 'ночку', 'ночка', 'ніч', 'ночі'],
    // Stems only where no everyday word shares them: "ніч" would also match "нічого".
    stems: ['ночн', 'темн', 'стемн', 'нічн'],
  },
  day: {
    words: ['day', 'daytime', 'daylight', 'sun', 'sunny', 'sunshine', 'morning', 'bright', 'brighter', 'light',
      'lights', 'jour', 'giorno', 'dzien', 'dzień',
      'день', 'днем', 'утро', 'утром', 'утра', 'ранок', 'вранці', 'ранку', 'светло', 'светлее', 'посветлее',
      'світло', 'світліше', 'солнце', 'солнышко', 'солнца', 'сонце', 'сонечко'],
    // No "светл"/"світл" stems: they would match the names Светлана/Світлана.
    stems: [],
  },
  bubbles: {
    words: ['bubbles', 'bubble', 'bubbly', 'fizz', 'burbujas', 'burbuja', 'bolhas', 'bolha', 'blasen',
      'bulles', 'bolle', 'babelki', 'bąbelki'],
    stems: ['пузыр', 'пузир', 'бульбаш', 'бульк'],
  },
  wish: {
    words: ['wish', 'wishes', 'luck', 'lucky', 'golden', 'gold', 'goldfish', 'magic', 'deseo', 'suerte',
      'wunsch', 'gluck', 'glück', 'souhait', 'fortuna'],
    stems: ['желан', 'желаю', 'загада', 'золот', 'удач', 'бажан', 'бажаю', 'щаст', 'счаст'],
  },
  jellyfish: {
    words: ['jellyfish', 'jelly', 'jellies', 'jellys', 'medusa', 'medusas', 'qualle', 'quallen', 'meduse',
      'méduse', 'meduza', 'meduzy'],
    stems: ['медуз'],
  },
  myfish: { words: ['myfish'], stems: [] },
};

// Multi-word phrases win over the single words inside them ("too dark" is a
// request for DAY, not a vote for "dark").
const PHRASES = [
  ['too dark', 'day'], ['слишком темно', 'day'], ['очень темно', 'day'], ['занадто темно', 'day'],
  ['too bright', 'night'], ['слишком светло', 'night'], ['занадто світло', 'night'],
  ['lights off', 'night'], ['light off', 'night'], ['turn off the lights', 'night'], ['turn off the light', 'night'],
  ['night mode', 'night'], ['выключи свет', 'night'], ['выключите свет', 'night'], ['вимкни світло', 'night'],
  ['вимкніть світло', 'night'], ['switch off the lights', 'night'], ['switch off the light', 'night'],
  ['switch the lights off', 'night'], ['turn the lights off', 'night'], ['turn the light off', 'night'],
  ['kill the lights', 'night'], ['dim the lights', 'night'], ['lights out', 'night'], ['очень светло', 'night'],
  ['lights on', 'day'], ['turn on the lights', 'day'], ['turn on the light', 'day'], ['включи свет', 'day'],
  ['включите свет', 'day'], ['увімкни світло', 'day'], ['увімкніть світло', 'day'],
  ['switch on the lights', 'day'], ['switch the lights on', 'day'], ['turn the lights on', 'day'], ['turn the light on', 'day'],
  ['my fish', 'myfish'], ['моя рыбка', 'myfish'], ['мою рыбку', 'myfish'], ['моя рыба', 'myfish'],
  ['моя рибка', 'myfish'], ['мою рибку', 'myfish'], ['моя риба', 'myfish'],
  ['golden fish', 'wish'], ['gold fish', 'wish'], ['золотая рыбка', 'wish'], ['золотую рыбку', 'wish'],
  ['золота рибка', 'wish'], ['золоту рибку', 'wish'],
  ['agua viva', 'jellyfish'],
  // Greetings are not requests: "good night everyone" must not vote for NIGHT.
  ['good night', null], ['goodnight', null], ['nighty night', null], ['good morning', null], ['good day', null],
  ['nice day', null], ['great day', null], ['good evening', null], ['bom dia', null], ['boa noite', null],
  ['buenos dias', null], ['buenas noches', null], ['gute nacht', null], ['guten tag', null], ['guten morgen', null],
  ['bonne nuit', null], ['доброй ночи', null], ['спокойной ночи', null], ['доброе утро', null],
  ['добрый день', null], ['доброго дня', null], ['хорошего дня', null], ['на ночь', null], ['добраніч', null],
  ['доброї ночі', null], ['на добраніч', null], ['доброго ранку', null], ['добрий ранок', null],
  ['добрий день', null], ['гарного дня', null], ['night all', null], ['night everyone', null], ['night chat', null],
  ['night night', null], ['nite', null], ['gn', null], ['good nite', null], ['morning all', null],
  ['morning everyone', null], ['morning chat', null], ['с добрым утром', null], ['доброго утра', null],
  ['всем доброй ночи', null], ['доброго вечора', null],
  // Everyday expressions that only contain a command word.
  ['good luck', null], ['bubble tea', null], ['light blue', null], ['dark blue', null], ['light green', null],
  ['dark green', null], ['dark mode', null], ['light mode', null], ['day one', null], ['every day', null],
  ['all day', null], ['one day', null], ['someday', null],
].map(([p, intent]) => [p.split(' '), intent]);

const SPECIES_ALIASES = [
  ['yellow tang', 'yellowtang'], ['yellowtang', 'yellowtang'], ['желтый хирург', 'yellowtang'],
  ['желтого хирурга', 'yellowtang'], ['жовтий хірург', 'yellowtang'], ['жовтого хірурга', 'yellowtang'],
  ['yellow', 'yellowtang'], ['желтый', 'yellowtang'], ['желтая', 'yellowtang'], ['желтую', 'yellowtang'],
  ['желтого', 'yellowtang'], ['жовтий', 'yellowtang'], ['жовту', 'yellowtang'], ['жовтого', 'yellowtang'],
  ['blue tang', 'tang'], ['tang', 'tang'], ['dory', 'tang'], ['дори', 'tang'], ['дорі', 'tang'],
  ['clownfish', 'clownfish'], ['clown', 'clownfish'], ['nemo', 'clownfish'], ['payaso', 'clownfish'],
  ['palhaco', 'clownfish'], ['palhaço', 'clownfish'], ['немо', 'clownfish'],
  ['chromis', 'chromis'], ['хромис', 'chromis'], ['хроміс', 'chromis'],
  ['royal gramma', 'gramma'], ['gramma', 'gramma'],
  ['cardinalfish', 'cardinal'], ['cardinal', 'cardinal'], ['banggai', 'cardinal'],
].map(([p, sp]) => [p.split(' '), sp]);
const SPECIES_STEMS = [['клоун', 'clownfish'], ['хирург', 'tang'], ['хірург', 'tang'], ['грамм', 'gramma'],
  ['грам', 'gramma'], ['кардинал', 'cardinal']];

const SPAWN_VERBS = new Set(['add', 'spawn', 'summon', 'adopt', 'get', 'put', 'buy', 'release', 'drop',
  'want', 'wanna', 'gimme', 'give', 'create', 'make', 'хочу', 'хотим', 'дай', 'дайте', 'давай', 'давайте',
  'создай', 'кинь', 'закинь', 'додай', 'додайте', 'додати', 'хочемо']);
const SPAWN_VERB_STEMS = ['добав', 'запуст', 'завед', 'засел', 'посел'];
const FISH_WORDS = new Set(['fish', 'fishy', 'fishie', 'fishes', 'pez', 'peces', 'peixe', 'fisch', 'poisson',
  'pesce', 'ryba', 'rybka']);
const FISH_STEMS = ['рыб', 'риб'];
const BANG_SPAWN = new Set(['fish', 'spawn', 'add', 'newfish', 'рыбка', 'рыбку', 'рыба', 'рибка', 'рибку', 'риба']);

const NEGATIONS = new Set(['no', 'not', 'dont', 'didnt', 'doesnt', 'wont', 'never', 'stop', 'without', 'nope',
  'не', 'нет', 'ні', 'без', 'хватит', 'досить', 'годі', 'хорош']);

const EMOJI = [
  ['🦈', 'shark'], ['🍤', 'feed'], ['🦐', 'feed'], ['🍞', 'feed'], ['🥖', 'feed'], ['🍕', 'feed'],
  ['🌙', 'night'], ['🌚', 'night'], ['🌛', 'night'], ['🌜', 'night'], ['🌑', 'night'],
  ['☀', 'day'], ['🌞', 'day'], ['🌅', 'day'], ['🌤', 'day'],
  ['🫧', 'bubbles'], ['✨', 'wish'], ['🌟', 'wish'], ['⭐', 'wish'], ['🍀', 'wish'],
  ['🪼', 'jellyfish'],
];
// Fish emoji are too common as reactions; they only count when the message is nothing else.
const EMOJI_SPAWN_ONLY = ['🐠', '🐟', '🐡'];

const REQUEST_MARKERS = new Set(['please', 'pls', 'plz', 'can', 'could', 'would', 'lets', 'let', 'want', 'wanna',
  'make', 'give', 'bring', 'show', 'turn', 'need', 'more', 'some', 'add',
  'пожалуйста', 'плиз', 'можно', 'можете', 'давай', 'давайте', 'хочу', 'хотим', 'сделай', 'сделайте', 'пусть',
  'покажи', 'покажите', 'включи', 'выключи', 'нужно', 'надо', 'можна', 'зробіть', 'зроби', 'покажіть',
  'увімкни', 'вимкни', 'хочемо', 'нехай', 'quiero', 'bitte', 'porfa']);
const DOMAIN_STEMS = ['fish', 'aquarium', 'tank', 'water', 'scary', 'monster', 'predator', 'glow', 'hungry', 'shark', 'акул',
  'рыб', 'риб', 'аквариум', 'акваріум', 'вод', 'страш', 'монстр', 'хищ', 'хиж', 'темн', 'голод'];

const intentWords = new Map();
for (const [intent, { words }] of Object.entries(LEX)) for (const w of words) intentWords.set(w, intent);
const fuzzyKeys = ['shark', 'sharks', 'bubbles', 'bubble', 'jellyfish', 'jelly', 'golden', 'night', 'feed', 'food'];

export function normalize(text) {
  return String(text ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/['’`ʼ]/g, '')
    .replace(/(\p{L})\1{2,}/gu, '$1$1');
}

export function tokenize(norm) {
  return norm.match(/[\p{L}\p{N}]+/gu) ?? [];
}

// Typo tolerance without false friends: only an adjacent swap ("shrak"),
// a doubled letter ("feedd") or, for long words, one missing letter ("jellyfsh").
// Plain one-letter substitutions are NOT accepted - "share" must not become "shark".
function nearMatch(word, key) {
  const lw = word.length, lk = key.length;
  if (lw === lk) {
    let i = 0;
    while (i < lw && word[i] === key[i]) i++;
    if (i >= lw - 1) return false;
    return word[i] === key[i + 1] && word[i + 1] === key[i] && word.slice(i + 2) === key.slice(i + 2);
  }
  if (lw === lk + 1) {
    for (let i = 0; i < lw; i++) {
      if (word.slice(0, i) + word.slice(i + 1) === key) return word[i] === word[i - 1] || word[i] === word[i + 1];
    }
    return false;
  }
  if (lw === lk - 1 && lk >= 7) {
    for (let i = 0; i < lk; i++) if (key.slice(0, i) + key.slice(i + 1) === word) return true;
  }
  return false;
}

function wordIntent(w) {
  const exact = intentWords.get(w);
  if (exact) return exact;
  for (const [intent, { stems }] of Object.entries(LEX)) {
    for (const s of stems) if (w.startsWith(s)) return intent;
  }
  if (/^[a-z]+$/.test(w) && w.length >= 4) {
    for (const key of fuzzyKeys) if (Math.abs(key.length - w.length) <= 1 && nearMatch(w, key)) return intentWords.get(key);
  }
  return null;
}

function matchPhraseAt(tokens, i, table) {
  let best = null;
  for (const [parts, value] of table) {
    if (parts.length < 1 || i + parts.length > tokens.length) continue;
    let ok = true;
    for (let k = 0; k < parts.length; k++) if (tokens[i + k] !== parts[k]) { ok = false; break; }
    if (ok && (!best || parts.length > best.len)) best = { value, len: parts.length };
  }
  return best;
}

const COLOUR_ONLY = new Set(['yellow', 'желтый', 'желтая', 'желтую', 'желтого', 'жовтий', 'жовту', 'жовтого']);

// A bare colour ("yellow") only names a species next to a fish word.
function findSpecies(tokens, fishHint = false) {
  const fishy = fishHint || tokens.some(isFishWord);
  for (let i = 0; i < tokens.length; i++) {
    const m = matchPhraseAt(tokens, i, SPECIES_ALIASES);
    if (m && !(m.len === 1 && COLOUR_ONLY.has(tokens[i]) && !fishy)) return m.value;
    for (const [stem, sp] of SPECIES_STEMS) if (tokens[i].startsWith(stem)) return sp;
  }
  return null;
}

const isSpawnVerb = (w) => SPAWN_VERBS.has(w) || SPAWN_VERB_STEMS.some((s) => w.startsWith(s));
const isFishWord = (w) => FISH_WORDS.has(w) || FISH_STEMS.some((s) => w.startsWith(s));

/**
 * @returns {{intent: string|null, species?: string, confidence?: string, aiCandidate?: boolean}}
 */
export function parseMessage(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return { intent: null, aiCandidate: false };
  const norm = normalize(raw);
  const tokens = tokenize(norm);

  // 1. Explicit bang command: "!fish clownfish", "!shark", "!myfish"
  if (/^[!/]/.test(norm) && tokens.length) {
    const cmd = tokens[0];
    if (BANG_SPAWN.has(cmd)) return { intent: 'spawn', species: findSpecies(tokens.slice(1), true) ?? 'any', confidence: 'high' };
    if (cmd === 'myfish' || cmd === 'my') return { intent: 'myfish', confidence: 'high' };
    const bangIntent = wordIntent(cmd);
    if (bangIntent) return { intent: bangIntent, confidence: 'high' };
  }

  // 2. Spawn with a named species: "add a clownfish", "хочу рыбку-клоуна"
  const hasVerb = tokens.some(isSpawnVerb);
  const species = findSpecies(tokens);
  if (hasVerb && species) return { intent: 'spawn', species, confidence: 'high' };

  // 3. Keywords and phrases, left to right; the first one wins.
  // "no more sharks", "I don't want a shark", "не надо акулу": a negation up to 3 words back cancels the vote.
  const negatedAt = (i) => tokens.slice(Math.max(0, i - 3), i).some((t) => NEGATIONS.has(t));
  for (let i = 0; i < tokens.length; i++) {
    const negated = negatedAt(i);
    const phrase = matchPhraseAt(tokens, i, PHRASES);
    if (phrase) {
      if (phrase.value && !negated) return { intent: phrase.value, confidence: 'high' };
      i += phrase.len - 1;
      continue;
    }
    const intent = wordIntent(tokens[i]);
    // "day 3 of watching", "night 2": a command word followed by a number is just counting.
    const counting = /^\d+$/.test(tokens[i + 1] ?? '');
    if (intent && !negated && !counting) return { intent, confidence: tokens.length <= 3 ? 'high' : 'medium' };
  }

  // 4. Spawn with a generic fish word: "add a fish", "добавь рыбку"
  if (hasVerb && tokens.some(isFishWord)) return { intent: 'spawn', species: species ?? 'any', confidence: 'medium' };

  // 5. Emoji
  const anyNegation = tokens.some((t) => NEGATIONS.has(t));
  if (!anyNegation) for (const [emoji, intent] of EMOJI) if (raw.includes(emoji)) return { intent, confidence: 'high' };
  if (tokens.length === 0 && EMOJI_SPAWN_ONLY.some((e) => raw.includes(e))) return { intent: 'spawn', species: 'any', confidence: 'medium' };

  return { intent: null, aiCandidate: isAiCandidate(raw, tokens) };
}

// Should an unmatched message be shown to the AI parser? Plain chatter
// ("hello from Brazil", "so relaxing") is not worth an API call.
export function isAiCandidate(raw, tokens = tokenize(normalize(raw))) {
  if (raw.length < 6 || raw.length > 220) return false;
  if (/https?:\/\/|www\./i.test(raw)) return false;
  if (tokens.length < 2) return false;
  if (raw.includes('?')) return true;
  return tokens.some((t) => REQUEST_MARKERS.has(t) || DOMAIN_STEMS.some((s) => t.startsWith(s)));
}
