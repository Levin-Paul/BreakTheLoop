# ML Specification

## Architecture (offline-first)

```
USER-PROVIDED TEXT
      -> PRIVACY FILTER              (mobile-app-01/src/services/privacyFilter.ts)
      -> TOKENIZER
      -> ALBERT
      -> MULTI-LABEL CLASSIFIER      (ml/artifacts/trigger-classifier.onnx)
      -> TRIGGER SIGNALS
      -> LOCAL EVENT DATABASE
      -> PATTERN ENGINE              (mobile-app-01/src/engine/patternEngine.ts)
      -> RECOVERY ENGINE             (mobile-app-01/src/engine/recoveryEngine.ts)
      -> INTERVENTION
```

All inference is local. No cloud AI, no account, no remote inference or storage.

ALBERT does **not** generate therapy or interventions, decide whether to block the
user, determine causation, or diagnose addiction. It only produces classification
signals.

## Trigger classifier (trained)

`ml/training/train.py` fits ALBERT + a multi-label head:

- head: dropout -> linear(768 -> N) -> **sigmoid**, loss = BCE-with-logits
- softmax is never used (labels are not mutually exclusive)
- one independent sigmoid per label, fixed 0.5 threshold at inference

### Labels actually trained

Only labels with real public data are trained. Everything else stays in the
taxonomy marked unsupported: see `ml/dataset/taxonomy.json` and
`ml/dataset/DATASET_AUDIT.md`.

| Trained | Source (GoEmotions, Apache-2.0) |
| --- | --- |
| `anxiety` | `fear`, `nervousness` |
| `sadness` | `sadness`, `grief`, `disappointment` |
| `anger` | `anger`, `annoyance` |

Unsupported (no approved source, NOT trained): `stress, boredom, loneliness,
isolation, fatigue, sleep_deprivation, procrastination, doomscrolling,
social_media, relationship_conflict, academic_pressure, work_pressure, unknown`.

### Trained result (checkpoint `ml/training/runs/trigger-classifier/best`)

1 epoch, 6,752 train / 843 validation / 843 test, batch 32, lr 2e-5,
max_seq_len 64, seed 42, BCE-with-logits, threshold 0.5.

| Split | micro F1 | macro F1 |
| --- | --- | --- |
| validation | 0.8115 | 0.7907 |
| test | 0.8204 | 0.7942 |

Test per-label F1: `anger` 0.8613, `sadness` 0.7729, `anxiety` 0.7484.

These are text-classification metrics on held-out GoEmotions-derived data. They
are **not** clinical validity, **not** personalization, and apply **only** to the
three trained labels.

## Pipeline files

| Stage | File |
| --- | --- |
| Taxonomy / mappings | `ml/dataset/taxonomy.json` |
| Dataset builder | `ml/preprocessing/build_dataset.py` |
| Training | `ml/training/train.py` |
| Evaluation | `ml/training/evaluate.py` |
| ONNX export | `ml/training/export_onnx.py` |
| Inference test | `ml/training/infer_test.py` |

## ONNX artifacts

- `ml/artifacts/trigger-classifier.onnx` — inputs `input_ids`, `attention_mask`;
  output `probabilities` `[batch, num_labels]` (sigmoid already applied).
- `ml/artifacts/trigger-classifier.json` — label order, threshold, shapes, sizes.
- `ml/artifacts/albert-base-v2.onnx` — representation-only encoder, kept for
  reference (`--base-encoder`).

Large training checkpoints live under `ml/training/runs/` and are **not** copied
into the mobile source tree.

## Model output vs user pattern

- **Model output**: which trigger signals a single piece of text contains.
- **Personalized pattern**: repeated sequences over time, produced only by the
  deterministic Pattern Engine from the user's local event history.

The two must never be conflated in UI copy.

## Current limitations (honest)

- Only 3 of 16 taxonomy labels have training data; the other 13 predictions do
  not exist. Do not present an untrained label as a prediction.
- 13 labels have zero examples, so `unknown` is never trained as "everything else".
- Training is a small CPU run (see `ml/training/runs/trigger-classifier/training_config.json`).
  Metrics on the held-out split are reported by `evaluate.py`; they are not
  clinical validity and not a personalization result.
- No personalized fine-tuning exists yet. The intended future path is:
  general model + the user's locally labeled events -> personal pattern model,
  with the user's history staying local.

## Not to be done

- Do not download another model or replace ALBERT.
- Do not fabricate datasets, labels, examples, or accuracy.
- Do not add a cloud inference service or send journal text to external APIs.
