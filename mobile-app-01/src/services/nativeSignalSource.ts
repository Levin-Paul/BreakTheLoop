// Native Android signal source boundary (NOT IMPLEMENTED).
//
// Intended architecture, once a native module exists:
//
//     Android AccessibilityService (explicitly enabled by the user)
//             -> minimal local signal
//             -> privacy filter  (services/signalPipeline)
//             -> local ML representation
//
// This file defines the boundary only. It does not register an Android service,
// does not read screen content, and does not collect anything. It exists so the
// JS side has a single, typed place to plug the native source into later without
// the pipeline or its filtering changing.
//
// Hard rules for any future implementation:
//   - the user must enable it explicitly, and it must be visible and
//     disableable with a kill switch,
//   - no covert surveillance,
//   - no raw screenshots or screen content ever captured or stored,
//   - no private messages read in the background,
//   - everything processed locally; nothing uploaded.
import type { RawSignal } from './signalPipeline';

/** Outcome of asking a source to start. */
export interface SourceStartResult {
  ok: boolean;
  error?: string;
}

/** A device-side provider of raw signals, before privacy filtering. */
export interface NativeSignalSource {
  readonly name: string;
  /** Whether the underlying native capability is present and enabled. */
  isAvailable(): Promise<boolean>;
  /** Begins delivering raw signals. Must be user-initiated. */
  start(onSignal: (raw: RawSignal) => void): Promise<SourceStartResult>;
  /** Stops delivery. Safe to call when not started. */
  stop(): Promise<void>;
}

/** Stable identifier used to label signals from this source. */
export const ANDROID_ACCESSIBILITY_SOURCE = 'android-accessibility';

/**
 * Placeholder for the Android AccessibilityService-backed source.
 *
 * It deliberately reports `ok: false`. Wiring this into the app now would mean
 * shipping a source that cannot honour the visibility/kill-switch requirements,
 * so it stays an honest stub until the native module lands.
 */
export function createAndroidAccessibilitySource(): NativeSignalSource {
  return {
    name: ANDROID_ACCESSIBILITY_SOURCE,
    async isAvailable(): Promise<boolean> {
      return false;
    },
    async start(): Promise<SourceStartResult> {
      return {
        ok: false,
        error:
          'Android accessibility signal source is not implemented. No native module is registered yet.',
      };
    },
    async stop(): Promise<void> {
      // Nothing was started, so there is nothing to stop.
    },
  };
}

/**
 * Human-readable description of what remains before this source can be enabled.
 * Kept next to the stub so the boundary documents its own gap.
 */
export const ANDROID_SOURCE_NEXT_STEPS = [
  'Add an Expo config plugin that registers a Kotlin AccessibilityService.',
  'Expose start/stop/flush over a native module bridge to this interface.',
  'Gate start behind an explicit, visible user toggle with a kill switch.',
  'Map native events to RawSignal metadata only (app category, activity type) and pass them through processSignal().',
  'Never request or store screen text, screenshots, or message contents.',
] as const;
