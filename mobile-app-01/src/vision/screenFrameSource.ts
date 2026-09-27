// ScreenFrameSource — the JS orchestrator for this milestone.
//
// Implements the first two hops of the target architecture and stops there:
//
//   MediaProjection (native)  ->  ScreenFrameSource (here)
//                             ->  LocalVisionAnalyzer (stub)
//                             ->  discard
//
// The raw frame never reaches JavaScript. `captureSingleTestFrame()` returns
// metadata plus the (stub) vision signal only.

import {
  captureTestFrame,
  getScreenCaptureStatus,
  isScreenCaptureSupported,
  requestScreenCapturePermission,
  type ScreenCaptureResult,
} from './screenCaptureModule';
import {
  createStubVisionAnalyzer,
  type ScreenFrame,
  type VisionSignal,
} from './localVisionAnalyzer';

export type { ScreenCaptureResult } from './screenCaptureModule';

export interface SingleFrameTestOutcome {
  ok: boolean;
  /** Machine-readable error code when ok === false. */
  error?: string;
  /** Frame metadata when ok === true. Pixels are never included. */
  frame?: ScreenFrame;
  /** Stub analyzer output — always `{ category: 'unknown', confidence: 0 }` for now. */
  vision: VisionSignal;
}

/**
 * Full one-shot flow: consent -> one frame -> stub analysis -> discard.
 *
 * Safe to call repeatedly; each call runs a complete fresh consent + capture
 * cycle, mirroring Android 14+ rules (a projection token is single-use).
 */
export async function captureSingleTestFrame(): Promise<SingleFrameTestOutcome> {
  if (!isScreenCaptureSupported()) {
    return {
      ok: false,
      error: 'unavailable',
      vision: { category: 'unknown', confidence: 0 },
    };
  }

  const permission = await requestScreenCapturePermission();
  if (!permission.success) {
    return {
      ok: false,
      error: permission.error,
      vision: { category: 'unknown', confidence: 0 },
    };
  }

  // Small defer: the service completes asynchronously; poll briefly for the
  // terminal outcome rather than racing it.
  const result = await waitForFrameResult();
  if (!result.success) {
    return {
      ok: false,
      error: result.error,
      vision: { category: 'unknown', confidence: 0 },
    };
  }

  const frame: ScreenFrame = {
    width: result.width,
    height: result.height,
    timestamp: result.timestamp,
    pixelFormat: result.pixelFormat,
  };

  // Boundary hop: the stub analyzer consumes metadata only.
  const analyzer = createStubVisionAnalyzer();
  const vision = await analyzer.analyze(frame);

  return { ok: true, frame, vision };
}

/** Status passthrough for the test UI. */
export async function refreshScreenCaptureStatus() {
  return getScreenCaptureStatus();
}

async function waitForFrameResult(
  attempts: number = 20,
  delayMs: number = 100
): Promise<ScreenCaptureResult> {
  let last: ScreenCaptureResult = { success: false, error: 'no_capture' };
  for (let i = 0; i < attempts; i++) {
    await sleep(delayMs);
    last = await captureTestFrame();
    if (last.success) {
      return last;
    }
    // 'no_capture' means the service has not finished yet; anything else is a
    // terminal failure reported by the service itself.
    if (last.error !== 'no_capture') {
      return last;
    }
  }
  return last;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
