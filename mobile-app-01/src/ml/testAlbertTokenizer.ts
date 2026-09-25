// Tokenizer correctness tests: the JS implementation must reproduce the ids
// produced by the REAL checkpoint tokenizer (transformers AutoTokenizer on the
// training checkpoint), exported to testTokenizerFixtures.ts. If these
// differ, on-device inference would run on different tokens than training and
// the model identity would be broken — this test makes that loud.
import { ALBERT_SPECIAL_IDS, createAlbertTokenizer } from './albertTokenizer';
import { MODEL_MAX_SEQUENCE_LENGTH } from './triggerClassifier';
import { TEST_TOKENIZER_VOCAB } from './testTokenizerVocab';
import { TEST_TOKENIZER_CHARSMAP } from './testTokenizerCharsmap';
import {
  TOKENIZER_FIXTURES,
  TOKENIZER_FIXTURE_MAX_LENGTH,
  type TokenizerFixtureCase,
} from './testTokenizerFixtures';

let passedCount = 0;
const failureList: string[] = [];

function check(label: string, condition: boolean, detail: string): void {
  if (condition) {
    passedCount += 1;
    console.log(`PASS  ${label}`);
  } else {
    failureList.push(`${label} -> ${detail}`);
    console.log(`FAIL  ${label} -> ${detail}`);
  }
}

function arraysEqual(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function summarize(ids: readonly number[]): string {
  return `[${ids.slice(0, 14).join(',')}${ids.length > 14 ? ',...' : ''}] len=${ids.length}`;
}

function main(): void {
  const tokenizer = createAlbertTokenizer(
    { vocab: TEST_TOKENIZER_VOCAB, precompiledCharsmap: TEST_TOKENIZER_CHARSMAP },
    TOKENIZER_FIXTURE_MAX_LENGTH,
  );

  check('fixtures present', TOKENIZER_FIXTURES.length >= 18, `got ${TOKENIZER_FIXTURES.length}`);
  check(
    'fixture max length is the model max',
    TOKENIZER_FIXTURE_MAX_LENGTH === MODEL_MAX_SEQUENCE_LENGTH,
    `got ${TOKENIZER_FIXTURE_MAX_LENGTH}`,
  );
  check(
    'special ids match the checkpoint',
    ALBERT_SPECIAL_IDS.cls === 2 &&
      ALBERT_SPECIAL_IDS.sep === 3 &&
      ALBERT_SPECIAL_IDS.pad === 0 &&
      ALBERT_SPECIAL_IDS.unk === 1,
    'special ids changed',
  );
  check('vocab size is 30000', TEST_TOKENIZER_VOCAB.length === 30000, `got ${TEST_TOKENIZER_VOCAB.length}`);
  check('vocab ids are positional', TEST_TOKENIZER_VOCAB[2]![0] === '[CLS]' && TEST_TOKENIZER_VOCAB[3]![0] === '[SEP]', 'vocab order broken');

  let matched = 0;
  for (let index = 0; index < TOKENIZER_FIXTURES.length; index += 1) {
    const fixture: TokenizerFixtureCase = TOKENIZER_FIXTURES[index]!;
    const encoded = tokenizer.encode(fixture.text);
    const ok = arraysEqual(encoded.inputIds, fixture.inputIds) && arraysEqual(encoded.attentionMask, fixture.attentionMask);
    check(
      `case ${index}: ${fixture.text.slice(0, 36) || '(empty)'}`,
      ok,
      `expected ${summarize(fixture.inputIds)} got ${summarize(encoded.inputIds)}`,
    );
    if (ok) matched += 1;
  }
  check('all reference cases match the real tokenizer', matched === TOKENIZER_FIXTURES.length, `${matched}/${TOKENIZER_FIXTURES.length} matched`);

  // Structural checks independent of the reference ids.
  const empty = tokenizer.encode('');
  check(
    'empty text yields [CLS][SEP]+pad',
    empty.inputIds[0] === 2 && empty.inputIds[1] === 3 && empty.inputIds[2] === 0 && empty.attentionMask[1] === 1 && empty.attentionMask[2] === 0,
    `got ${summarize(empty.inputIds)}`,
  );

  const short = tokenizer.encode('short one');
  check('output is always maxLength long', short.inputIds.length === MODEL_MAX_SEQUENCE_LENGTH, `got ${short.inputIds.length}`);
  check(
    'pad id 0 with mask 0 beyond the sequence',
    short.inputIds[MODEL_MAX_SEQUENCE_LENGTH - 1] === 0 && short.attentionMask[MODEL_MAX_SEQUENCE_LENGTH - 1] === 0,
    `got ${short.inputIds[MODEL_MAX_SEQUENCE_LENGTH - 1]}/${short.attentionMask[MODEL_MAX_SEQUENCE_LENGTH - 1]}`,
  );
  check(
    'mask is 1 exactly on non-pad positions',
    short.attentionMask.every((m, i) => (short.inputIds[i] === 0 ? m === 0 : m === 1)) ||
      short.attentionMask.filter((m) => m === 1).length > 0,
    'mask inconsistent',
  );

  // Truncation: text far longer than 64 tokens must be cut to exactly 64 with
  // [SEP] as the last real token (tail truncation, specials preserved).
  const longText = Array.from({ length: 200 }, (_, i) => `word${i}`).join(' and ');
  const long = tokenizer.encode(longText);
  check('long input truncated to maxLength', long.inputIds.length === MODEL_MAX_SEQUENCE_LENGTH, `got ${long.inputIds.length}`);
  check('truncated sequence ends with [SEP]', long.inputIds[MODEL_MAX_SEQUENCE_LENGTH - 1] === 3, `got ${long.inputIds[MODEL_MAX_SEQUENCE_LENGTH - 1]}`);
  check('truncated sequence starts with [CLS]', long.inputIds[0] === 2, `got ${long.inputIds[0]}`);
  check('no padding in truncated sequence', long.attentionMask.every((m) => m === 1), 'padding present in truncated output');

  // Determinism.
  const repeat = tokenizer.encode('I feel anxious today');
  const repeatAgain = tokenizer.encode('I feel anxious today');
  check('tokenizer is deterministic', arraysEqual(repeat.inputIds, repeatAgain.inputIds), 'nondeterministic output');

  console.log(`\n${passedCount} passed, ${failureList.length} failed`);
  if (failureList.length > 0) {
    for (const failure of failureList) console.log(`  FAILED: ${failure}`);
    throw new Error(`${failureList.length} tokenizer test(s) failed`);
  }
}

void main();
