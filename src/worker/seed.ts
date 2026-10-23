/**
 * Seed phrases for new worlds, e.g. "amber-lantern-4821".
 *
 * This is the one place randomness enters from outside the simulation, so it lives with the host
 * (not in src/engine, whose code may not read entropy). A phrase is easy to read aloud and share.
 */

const ADJECTIVES = [
  'amber',
  'brisk',
  'coral',
  'distant',
  'ember',
  'foggy',
  'gilded',
  'hollow',
  'ivory',
  'jagged',
  'keen',
  'lunar',
  'misty',
  'north',
  'open',
  'pale',
  'quiet',
  'rising',
  'salted',
  'tidal',
  'umber',
  'vivid',
  'windy',
  'young',
  'azure',
  'bold',
  'calm',
  'drifting',
  'eastern',
  'fierce',
  'gentle',
  'hidden',
];

const NOUNS = [
  'anchor',
  'beacon',
  'compass',
  'current',
  'dolphin',
  'estuary',
  'figurehead',
  'galley',
  'harbor',
  'island',
  'jetty',
  'keel',
  'lantern',
  'mast',
  'narrows',
  'oar',
  'port',
  'quay',
  'reef',
  'sail',
  'tide',
  'undertow',
  'voyage',
  'wharf',
  'barnacle',
  'cove',
  'driftwood',
  'gull',
  'horizon',
  'inlet',
  'lagoon',
  'shoal',
];

export function randomSeed(random: (count: number) => Uint32Array = defaultRandom): string {
  const [a = 0, b = 0, c = 0] = random(3);
  const adjective = ADJECTIVES[a % ADJECTIVES.length] as string;
  const noun = NOUNS[b % NOUNS.length] as string;
  const number = 1000 + (c % 9000);
  return `${adjective}-${noun}-${number}`;
}

function defaultRandom(count: number): Uint32Array {
  return crypto.getRandomValues(new Uint32Array(count));
}
