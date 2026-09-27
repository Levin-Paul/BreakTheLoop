// Future boundary for BreakTheLoop's local vision layer (JS side).
//
// THIS IS AN INTERFACE + STUB ONLY. No vision model exists yet. Nothing in
// this file produces, fakes, or implies a visual classification.
//
// Planned pipeline (this milestone implements only the first two hops):
//
//   MediaProjection -> ScreenFrameSource -> LocalVisionAnalyzer
//                                        -> PrivacyFilter
//                                        -> Pattern Engine
//                                        -> Recovery Engine

/** Metadata describing one ephemeral in-memory frame. */
export interface ScreenFrame {
  width: number;
  height: number;
  /** Capture epoch timestamp in milliseconds. */
  timestamp: number;
  /** e.g. "RGBA_8888" — format only, never pixel contents. */
  pixelFormat: string;
}

/**
 * What a real analyzer would eventually return. The stub returns
 * `{ category: 'unknown', confidence: 0 }` and nothing else — deliberately
 * not a plausible-looking prediction.
 */
export interface VisionSignal {
  category: string;
  confidence: number;
}

/**
 * Contract for the future on-device analyzer. Implementations must:
 *   - accept the frame metadata natively (pixels stay in native memory),
 *   - run fully locally with no network access,
 *   - never persist, log, or transmit the frame or its derivatives.
 */
export interface LocalVisionAnalyzer {
  analyze(frame: ScreenFrame): Promise<VisionSignal>;
}

/**
 * Honest stub used by the development test screen until a real local model
 * exists. It performs no analysis and returns a fixed unknown signal.
 */
export function createStubVisionAnalyzer(): LocalVisionAnalyzer {
  return {
    async analyze(): Promise<VisionSignal> {
      return { category: 'unknown', confidence: 0 };
    },
  };
}
