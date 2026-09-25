// Real on-device ONNX Runtime integration for the trigger classifier.
//
// This module is the ONLY place that imports `onnxruntime-react-native` and
// `expo-asset`. It:
//   1. resolves the bundled INT8 model asset (metro asset -> local file URI),
//   2. creates a real `ort.InferenceSession` on the device,
//   3. builds the real ALBERT tokenizer from the checkpoint tokenizer files
//      (bundled verbatim as an asset),
//   4. binds the existing adapter (`createOnnxTriggerClassifier`) into
//      `mlRuntime`, with `setTriggerClassifier` also accepting a failure
//      reason so the app degrades honestly instead of faking availability.
//
// Every failure mode is surfaced, never swallowed: missing asset, failed
// session creation, tokenizer parse errors, and inference errors all result in
// an unavailable classifier with a concrete reason string. The app keeps
// working without ML inference (the Urge flow and Pattern Engine are
// unaffected), per the integration contract.
import { Asset } from 'expo-asset';
import { InferenceSession, Tensor } from 'onnxruntime-react-native';

import {
  MODEL_MAX_SEQUENCE_LENGTH,
  createOnnxTriggerClassifier,
  type TriggerModelSession,
} from './triggerClassifier';
import { setTriggerClassifier, setTriggerModelUnavailableReason } from './mlRuntime';
import { createAlbertTokenizer } from './albertTokenizer';

// Static require of the bundled tokenizer files (verbatim from the training
// checkpoint). Metro inlines .json as a module, so this is available
// synchronously without any download.
const TOKENIZER_JSON = require('../../assets/ml/trigger-classifier-tokenizer.json') as unknown as TokenizerJsonSubset;

/** Where metro bundles the model from (see assets/ml + metro.config.js). */
const MODEL_ASSET = require('../../assets/ml/trigger-classifier.int8.onnx') as number;

/** Bundled artifact identity (see ml/artifacts/trigger-classifier.json). */
export const BUNDLED_MODEL_ASSET_NAME = 'trigger-classifier.int8.onnx';
export const BUNDLED_TOKENIZER_ASSET_NAME = 'trigger-classifier-tokenizer.json';

/**
 * Minimal parsed subset of the checkpoint tokenizer.json. The full file is
 * bundled verbatim; only these fields are read.
 */
interface TokenizerJsonSubset {
  model: { readonly vocab: readonly (readonly [string, number])[] };
  normalizer: {
    readonly normalizers: readonly { readonly type: string; readonly precompiled_charsmap?: string }[];
  };
}

function extractPrecompiledCharsmap(parsed: TokenizerJsonSubset): string {
  for (const normalizer of parsed.normalizer?.normalizers ?? []) {
    if (normalizer.type === 'Precompiled' && typeof normalizer.precompiled_charsmap === 'string') {
      return normalizer.precompiled_charsmap;
    }
  }
  throw new Error('tokenizer.json contains no Precompiled normalizer charsmap.');
}

/**
 * Loads the bundled model + tokenizer and binds a REAL session-backed
 * classifier. Returns a concrete reason string on failure (never throws) so
 * callers can log it; on failure the runtime stays honestly unavailable.
 */
export async function initializeTriggerClassifierRuntime(): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    // 1. Resolve the bundled model asset to a local file URI. Downloading the
    //    asset from the metro dev server is REQUIRED before InferenceSession
    //    can open it (RN never exposes bundled files as plain paths).
    const modelAsset = Asset.fromModule(MODEL_ASSET);
    await modelAsset.downloadAsync();
    const modelUri = modelAsset.localUri ?? modelAsset.uri;
    if (!modelUri) return { ok: false, reason: 'Bundled ONNX model asset could not be resolved.' };

    // 2. Create the real inference session on device.
    const session = await InferenceSession.create(modelUri, { graphOptimizationLevel: 'all' });

    // 3. Build the real tokenizer from the bundled checkpoint tokenizer files.
    const vocab = TOKENIZER_JSON.model?.vocab;
    if (!Array.isArray(vocab) || vocab.length === 0) {
      return { ok: false, reason: 'Bundled tokenizer.json has no Unigram vocab.' };
    }
    const charsmap = extractPrecompiledCharsmap(TOKENIZER_JSON);
    const tokenizer = createAlbertTokenizer(
      { vocab, precompiledCharsmap: charsmap },
      MODEL_MAX_SEQUENCE_LENGTH,
    );

    // 4. Wrap the ORT session in the adapter's session surface: int64
    //    input_ids/attention_mask tensors of shape [1, seq], flattened
    //    probabilities output.
    const triggerSession: TriggerModelSession = {
      async run({ inputIds, attentionMask }) {
        const seq = inputIds.length;
        if (seq === 0 || attentionMask.length !== seq) {
          throw new Error('input_ids/attention_mask length mismatch.');
        }
        const inputIdsTensor = new Tensor('int64', BigInt64Array.from(Array.from(inputIds, (v) => BigInt(v))), [1, seq]);
        const maskTensor = new Tensor('int64', BigInt64Array.from(Array.from(attentionMask, (v) => BigInt(v))), [1, seq]);
        const feeds: Record<string, Tensor> = {
          input_ids: inputIdsTensor,
          attention_mask: maskTensor,
        };
        const outputs = await session.run(feeds);
        const probabilities = outputs['probabilities'] ?? outputs[Object.keys(outputs)[0] as string];
        if (!probabilities || !probabilities.data) throw new Error('Session produced no probabilities output.');
        return probabilities.data as ArrayLike<number>;
      },
    };

    // 5. Bind through the existing adapter (privacy-first boundary unchanged).
    setTriggerClassifier(createOnnxTriggerClassifier({ session: triggerSession, tokenizer }));
    return { ok: true };
  } catch (error) {
    const reason = `ONNX trigger classifier failed to initialize: ${
      error instanceof Error ? error.message : String(error)
    }`;
    setTriggerModelUnavailableReason(reason);
    return { ok: false, reason };
  }
}
