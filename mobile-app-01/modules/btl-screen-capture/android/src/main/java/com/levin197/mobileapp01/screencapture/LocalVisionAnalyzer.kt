package com.levin197.mobileapp01.screencapture

import android.media.Image

/**
 * Future boundary for the local vision layer.
 *
 * THIS IS A STUB. BreakTheLoop does not ship a vision classifier yet, and this
 * file deliberately does not pretend to predict anything. No category,
 * confidence, or content judgement is produced here.
 *
 * Contract for the future implementation (LocalVisionAnalyzer):
 *   - receives the already-acquired in-memory [Image],
 *   - performs inference locally, on-device, with no network access,
 *   - returns a VisionSignal such as { category, confidence },
 *   - never persists, logs, or transmits the frame or any derivative.
 *
 * The current implementation intentionally returns only "unknown" and holds
 * no reference to the pixels after analyze() returns.
 */
object LocalVisionAnalyzer {

  data class VisionSignal(
    val category: String,
    val confidence: Float
  )

  /**
   * Stub entry point. The image must already be acquired by the caller and is
   * closed by the caller after this returns. This stub reads nothing from the
   * image and keeps no reference to it.
   */
  fun analyze(image: Image): VisionSignal {
    // No model. No prediction. Honest placeholder for the future pipeline:
    // MediaProjection -> ScreenFrameSource -> LocalVisionAnalyzer -> PrivacyFilter
    //                                 -> Pattern Engine -> Recovery Engine
    return VisionSignal(category = "unknown", confidence = 0f)
  }
}
