package com.levin197.mobileapp01.screencapture

import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.media.projection.MediaProjectionManager
import android.app.Activity

import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * BreakTheLoop — MediaProjection foundation module.
 *
 * Scope of this milestone (deliberately minimal):
 *   1. Request screen-capture consent through Android's system dialog
 *      (createScreenCaptureIntent). Nothing is granted automatically.
 *   2. On approval, start [ScreenCaptureService], which captures exactly ONE
 *      frame into native memory, hands it to [LocalVisionAnalyzer] (a stub
 *      for now), then releases every resource and never persists anything.
 *   3. Report status / structured metadata back to JavaScript.
 *
 * Privacy contract enforced by this module and the service:
 *   - Raw pixels never leave the native process memory.
 *   - Nothing is written to disk, SQLite, logs, or the network.
 *   - Only { success, width, height, timestamp, pixelFormat } metadata is
 *     returned to JS.
 *   - No continuous capture: the VirtualDisplay is torn down after the first
 *     Image is acquired.
 */
class BtlScreenCaptureModule : Module() {
  private var pendingPermissionPromise: Promise? = null

  override fun definition() = ModuleDefinition {
    Name(MODULE_NAME)

    OnCreate {
      // Keep the pending result around across JS reloads only for the module's
      // lifetime; the service reports results via a static callback.
      ScreenCaptureService.onCaptureResult = { result ->
        pendingCaptureResult = result
      }
    }

    OnDestroy {
      // If JS unloads while the consent dialog is open, drop the promise so we
      // never resolve into a dead runtime context.
      pendingPermissionPromise = null
      ScreenCaptureService.onCaptureResult = null
      pendingCaptureResult = null
    }

    AsyncFunction("requestScreenCapturePermission") { promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null) {
        promise.resolve(
          mapOf(
            "success" to false,
            "error" to "no_activity"
          )
        )
        return@AsyncFunction
      }

      val projectionManager =
        activity.getSystemService(MediaProjectionManager::class.java)
      if (projectionManager == null) {
        promise.resolve(
          mapOf(
            "success" to false,
            "error" to "unavailable"
          )
        )
        return@AsyncFunction
      }

      // There may be a stale promise from a previous (interrupted) round trip;
      // resolve it as cancelled so at most one request is pending.
      pendingPermissionPromise?.resolve(
        mapOf(
          "success" to false,
          "error" to "cancelled"
        )
      )
      pendingPermissionPromise = promise

      try {
        // This launches Android's consent dialog. The result comes back via
        // the OnActivityResult hook below. We do NOT bypass or pre-grant it.
        activity.startActivityForResult(
          projectionManager.createScreenCaptureIntent(),
          REQUEST_CODE
        )
      } catch (e: Exception) {
        pendingPermissionPromise = null
        promise.resolve(
          mapOf(
            "success" to false,
            "error" to "dialog_failed"
          )
        )
      }
    }

    AsyncFunction("captureTestFrame") { promise: Promise ->
      val result = pendingCaptureResult
      if (result == null) {
        // No completed capture session. Ask the service for its state so the
        // caller can distinguish "never ran" from "ran and failed".
        val state = ScreenCaptureService.consumeLastOutcome()
        promise.resolve(
          mapOf(
            "success" to false,
            "error" to (state ?: "no_capture")
          )
        )
        return@AsyncFunction
      }
      pendingCaptureResult = null
      // Metadata only. The map is built by the service and never contains
      // pixel data.
      promise.resolve(result)
    }

    AsyncFunction("getScreenCaptureStatus") { promise: Promise ->
      promise.resolve(
        mapOf(
          "supported" to (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP),
          "permissionGranted" to ScreenCaptureService.hasConsentSession,
          "capturing" to ScreenCaptureService.isCapturing,
          "lastError" to ScreenCaptureService.lastOutcome
        )
      )
    }

    OnActivityResult { _, payload ->
      if (payload.requestCode != REQUEST_CODE) return@OnActivityResult

      val promise = pendingPermissionPromise
      pendingPermissionPromise = null
      if (promise == null) return@OnActivityResult

      val approved = payload.resultCode == Activity.RESULT_OK && payload.data != null
      if (!approved) {
        // User pressed "Cancel"/denied. Nothing to release; no capture started.
        promise.resolve(
          mapOf(
            "success" to false,
            "error" to "permission_denied"
          )
        )
        return@OnActivityResult
      }

      // The consent token is delivered via the intent below; the service owns
      // the consent-session flag from the moment it consumes the intent.
      val intent = Intent(appContext.reactContext, ScreenCaptureService::class.java)
      intent.action = ScreenCaptureService.ACTION_CAPTURE_SINGLE_FRAME
      intent.putExtra(ScreenCaptureService.EXTRA_RESULT_CODE, payload.resultCode)
      intent.putExtra(ScreenCaptureService.EXTRA_RESULT_DATA, payload.data)

      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          appContext.reactContext!!.startForegroundService(intent)
        } else {
          appContext.reactContext!!.startService(intent)
        }
        promise.resolve(
          mapOf(
            "success" to true
          )
        )
      } catch (e: Exception) {
        promise.resolve(
          mapOf(
            "success" to false,
            "error" to "service_start_failed"
          )
        )
      }
    }
  }

  private var pendingCaptureResult: Map<String, Any?>? = null

  companion object {
    private const val MODULE_NAME = "BtlScreenCapture"
    private const val REQUEST_CODE = 47131
  }
}
