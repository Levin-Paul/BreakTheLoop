// Deterministic tests for the Discovery Mode model. Run with: npm test
//
// Covers: stage derivation from real counts, honest empty-state wording,
// promoted-pattern-only banners, banner limits (no spam), and the wording
// contracts (no causal/medical claims, no shame language).
import {
  DISCOVERY_BANNER_LIMIT,
  buildPatternInsightBanners,
  deriveDiscoveryStatus,
  isPromotedPattern,
} from './discoveryModel';

let passed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail: string): void {
  if (condition) {
    passed += 1;
    console.log(`PASS  ${label}`);
  } else {
    failures.push(`${label} -> ${detail}`);
    console.log(`FAIL  ${label} -> ${detail}`);
  }
}

function assertEqual<T>(label: string, actual: T, expected: T): void {
  check(label, actual === expected, `expected ${String(expected)}, got ${String(actual)}`);
}

const PATTERN_SHAPES = ['possible', 'emerging', 'recurring'] as const;

function pattern(
  id: string,
  occurrenceCount: number,
  status: (typeof PATTERN_SHAPES)[number],
  description = 'Distress appeared within 12 hours before high-urge episodes.',
) {
  return { id, description, occurrenceCount, status };
}

async function main(): Promise<void> {
  // --- 1. Stage derivation is honest for every data volume ---
  const empty = deriveDiscoveryStatus(true, 0, 0, 0);
  assertEqual('stage: no data', empty.stage, 'no_data');
  check(
    'stage: empty state uses the honest wording',
    empty.headline.includes('Not enough data yet'),
    empty.headline,
  );

  const gathering = deriveDiscoveryStatus(true, 2, 3, 0);
  assertEqual('stage: gathering with data but no promoted patterns', gathering.stage, 'gathering');
  check(
    'stage: gathering wording mentions what is being looked for',
    gathering.headline.includes('urges, emotions, situations and timing'),
    gathering.headline,
  );

  const forming = deriveDiscoveryStatus(true, 5, 6, 1);
  assertEqual('stage: patterns forming with a promoted pattern', forming.stage, 'patterns_forming');
  check(
    'stage: forming wording stays cautious',
    forming.headline.includes('becoming clearer'),
    forming.headline,
  );

  const disabled = deriveDiscoveryStatus(false, 5, 6, 1);
  assertEqual('stage: disabled reports off', disabled.enabled, false);
  check(
    'stage: disabled wording is honest',
    disabled.headline === 'Discovery Mode is off.',
    disabled.headline,
  );

  // Counts are echoed verbatim — never invented.
  assertEqual('counts: checkIns echoed', deriveDiscoveryStatus(true, 7, 3, 0).checkIns, 7);
  assertEqual('counts: urges echoed', deriveDiscoveryStatus(true, 7, 3, 0).urges, 3);

  // --- 2. Only promoted patterns produce banners ---
  assertEqual('promote: single sighting is not promoted', isPromotedPattern(pattern('a', 1, 'possible')), false);
  assertEqual('promote: two sightings emerging is promoted', isPromotedPattern(pattern('a', 2, 'emerging')), true);
  assertEqual('promote: four sightings recurring is promoted', isPromotedPattern(pattern('a', 4, 'recurring')), true);
  assertEqual(
    'promote: repeated count with possible status is not promoted',
    isPromotedPattern(pattern('a', 2, 'possible')),
    false,
  );

  const possibleOnly = buildPatternInsightBanners([pattern('possible-1', 1, 'possible')]);
  assertEqual('banners: no banner for un-promoted patterns', possibleOnly.length, 0);

  // --- 3. Banner limit: no spam ---
  const many = buildPatternInsightBanners([
    pattern('p1', 2, 'emerging'),
    pattern('p2', 4, 'recurring'),
    pattern('p3', 6, 'recurring'),
  ]);
  assertEqual('banners: at most DISCOVERY_BANNER_LIMIT', many.length, DISCOVERY_BANNER_LIMIT);
  assertEqual('banners: strongest pattern first', many[0]?.id, 'p3');

  // --- 4. Repeated renders are deterministic (no duplicate banners) ---
  const input = [pattern('p1', 3, 'emerging'), pattern('p2', 2, 'emerging')];
  const first = buildPatternInsightBanners(input);
  const second = buildPatternInsightBanners(input);
  check(
    'banners: repeated renders identical',
    JSON.stringify(first) === JSON.stringify(second),
    'renders differed',
  );
  const ids = new Set(first.map((banner) => banner.id));
  assertEqual('banners: no duplicate ids in one render', ids.size, first.length);

  // --- 5. Wording contracts ---
  const banners = buildPatternInsightBanners([
    pattern('late-night', 3, 'emerging', 'Distress appeared within 12 hours before high-urge episodes.'),
  ]);
  assertEqual('wording: banner title neutral', banners[0]?.title, 'Pattern noticed');
  const bannerText = `${banners[0]?.body ?? ''} ${banners[0]?.callToAction ?? ''}`;
  check(
    'wording: no causal/deterministic claims',
    !/causes?|will happen|always|cures?|addicted|you failed|weak/i.test(bannerText),
    bannerText,
  );
  check(
    'wording: no shame language',
    !/failed|weak|addict/i.test(bannerText),
    bannerText,
  );
  check(
    'wording: count-based evidence is stated',
    (banners[0]?.body ?? '').includes('(3 times)'),
    banners[0]?.body ?? 'missing',
  );
  check(
    'wording: invitation is cautious',
    (banners[0]?.callToAction ?? '').startsWith('Want to explore'),
    banners[0]?.callToAction ?? 'missing',
  );

  const statusText = `${deriveDiscoveryStatus(true, 0, 0, 0).headline} ${deriveDiscoveryStatus(true, 2, 2, 0).headline} ${deriveDiscoveryStatus(true, 2, 2, 1).headline}`;
  check(
    'wording: status headlines avoid deterministic claims',
    !/will|always|guaranteed|diagnos/i.test(statusText),
    statusText,
  );

  // --- Summary ---
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    for (const failure of failures) {
      console.log(`  FAILED: ${failure}`);
    }
    throw new Error(`${failures.length} Discovery Mode test(s) failed`);
  }
}

void main();
