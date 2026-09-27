// Typed JavaScript boundary for the native MediaProjection foundation module.
//
// PRIVACY: this API intentionally returns METADATA ONLY. There is no function
// here that can return pixels, and the native side never sends any. The raw
// frame lives in native memory for the duration of a single capture and is
// then released.

import { requireOptionalNativeModule } from 'expo';

/** Successful capture result: metadata only, never pixels. */
export interface ScreenFrameMetadata {
  success: true;
  width: number;
  height: number;
  timestamp: number;
  pixelFormat: string;
}

/** Failure result with a stable machine-readable error code. */
export interface ScreenCaptureFailure {
  success: false;
  error:
    | 'permission_denied'
    | 'no_activity'
    | 'unavailable'
    | 'cancelled'
    | 'dialog_failed'
    | 'service_start_failed'
    | 'invalid_consent'
    | 'projection_rejected'
    | 'foreground_service_failed'
    | 'virtual_display_failed'
    | 'image_unavailable'
    | 'no_capture'
    | 'unknown';
}

export type ScreenCaptureResult = ScreenFrameMetadata | ScreenCaptureFailure;

export interface ScreenCaptureStatus {
  supported: boolean;
  permissionGranted: boolean;
  capturing: boolean;
  lastError: string | null;
}

/**
 * Shape of the native module as registered by
 * modules/btl-screen-capture (Kotlin `BtlScreenCaptureModule`).
 */
interface NativeScreenCaptureModule {
  requestScreenCapturePermission(): Promise<
    { success: true } | { success: false; error: string }
  >;
  captureTestFrame(): Promise<ScreenCaptureResult>;
  getScreenCaptureStatus(): Promise<ScreenCaptureStatus>;
}

const nativeModule =
  requireOptionalNativeModule<NativeScreenCaptureModule>('BtlScreenCapture');

/** Whether the native foundation module is present in this build. */
export function isScreenCaptureSupported(): boolean {
  return nativeModule != null;
}

/**
 * Step 1 — launch Android's system screen-capture consent dialog.
 *
 * Resolves `{ success: true }` when the user approved and the one-frame
 * capture service was started, or `{ success: false, error: 'permission_denied' }`
 * (or another failure code) otherwise. Consent is NEVER assumed or bypassed:
 * the outcome always reflects the user's explicit choice in the system UI.
 */
export async function requestScreenCapturePermission(): Promise<
  { success: true } | { success: false; error: string }
> {
  if (!nativeModule) {
    return { success: false, error: 'unavailable' };
  }
  try {
    return await nativeModule.requestScreenCapturePermission();
  } catch {
    return { success: false, error: 'unknown' };
  }
}

/**
 * Step 2 — fetch the metadata of the single captured frame.
 *
 * Must be called after `requestScreenCapturePermission()` resolved successfully.
 * Returns `{ success: true, width, height, timestamp, pixelFormat }` on
 * success, or a failure code. No pixel data is ever included.
 */
export async function captureTestFrame(): Promise<ScreenCaptureResult> {
  if (!nativeModule) {
    return { success: false, error: 'unavailable' };
  }
  try {
    return await nativeModule.captureTestFrame();
  } catch {
    return { success: false, error: 'unknown' };
  }
}

/** Current native-side status snapshot (safe to call anytime). */
export async function getScreenCaptureStatus(): Promise<ScreenCaptureStatus> {
  if (!nativeModule) {
    return {
      supported: false,
      permissionGranted: false,
      capturing: false,
      lastError: null,
    };
  }
  try {
    return await nativeModule.getScreenCaptureStatus();
  } catch {
    return {
      supported: true,
      permissionGranted: false,
      capturing: false,
      lastError: 'unknown',
    };
  }
}
