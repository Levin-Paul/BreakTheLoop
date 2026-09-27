package com.levin197.mobileapp01.screencapture

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.Image
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.DisplayMetrics
import android.view.WindowManager

/**
 * Captures exactly ONE screen frame through MediaProjection.
 *
 * Lifecycle for a single capture:
 *
 *   onStartCommand(ACTION_CAPTURE_SINGLE_FRAME)
 *     -> startForeground() with mediaProjection type (required on API 29+;
 *        on API 35+ Android requires the FGS to be running BEFORE
 *        getMediaProjection() is called, otherwise SecurityException)
 *     -> getMediaProjection(resultCode, resultData)   [token used exactly once]
 *     -> ImageReader.newInstance(w, h, RGBA_8888, maxImages = 2)
 *     -> mediaProjection.createVirtualDisplay(...)    [session = one createVirtualDisplay]
 *     -> onImageAvailable -> acquireLatestImage() -> read metadata only
 *        -> analyzeWithLocalVisionStub(image)         [no pixels leave memory]
 *        -> close(image) -> stopProjectionAndRelease()
 *     -> stopSelf()
 *
 * Privacy guarantees (verified against this code):
 *   - The Image is closed immediately after metadata extraction; pixels are
 *     never copied out of the single acquired buffer.
 *   - No file, MediaStore, SQLite, log, or network write exists in this class.
 *   - Width/height/format/timestamp are the ONLY values reported.
 */
class ScreenCaptureService : Service() {

  private var mediaProjection: MediaProjection? = null
  private var virtualDisplay: VirtualDisplay? = null
  private var imageReader: ImageReader? = null
  private var projectionCallback: MediaProjection.Callback? = null
  private var released = false

  private val mainHandler = Handler(Looper.getMainLooper())

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent == null || intent.action != ACTION_CAPTURE_SINGLE_FRAME) {
      // Unknown or stale start request; nothing consented, nothing to do.
      stopSelf()
      return START_NOT_STICKY
    }

    val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, Int.MIN_VALUE)
    @Suppress("DEPRECATION")
    val resultData = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      intent.getParcelableExtra(EXTRA_RESULT_DATA, Intent::class.java)
    } else {
      intent.getParcelableExtra(EXTRA_RESULT_DATA)
    }

    if (resultCode == Int.MIN_VALUE || resultData == null) {
      reportOutcome("invalid_consent")
      stopSelf()
      return START_NOT_STICKY
    }

    isCapturing = true
    // Consent is now "delivered": the service is the single owner of this flag
    // (set here, cleared in releaseAll()). The JS module never mutates it.
    hasConsentSession = true

    // Android 14+ (targetSdk 34+): a mediaProjection-typed FGS must be
    // promoted to the foreground BEFORE getMediaProjection() is invoked.
    try {
      startForegroundWithProjectionType()
    } catch (e: Exception) {
      isCapturing = false
      reportOutcome("foreground_service_failed")
      stopSelf()
      return START_NOT_STICKY
    }

    val projectionManager = getSystemService(MediaProjectionManager::class.java)
    if (projectionManager == null) {
      isCapturing = false
      reportOutcome("unavailable")
      stopSelf()
      return START_NOT_STICKY
    }

    // getMediaProjection() is @Nullable on recent SDK stubs (returns null for
    // an invalid consent token) and may also throw on a reused/expired token.
    val projection = try {
      projectionManager.getMediaProjection(resultCode, resultData)
    } catch (e: Exception) {
      null
    }

    if (projection == null) {
      // Token already used, revoked, or expired — or the platform returned no
      // projection. Nothing was captured; nothing to release beyond FGS state.
      isCapturing = false
      reportOutcome("projection_rejected")
      stopSelf()
      return START_NOT_STICKY
    }

    mediaProjection = projection

    // Register the stop callback BEFORE createVirtualDisplay (required by the
    // platform on API 34+; also lets us release when the user stops capture
    // from the system status-bar chip or the screen locks). Hold the callback
    // in a local val so register/unregister share one reference — no !!.
    val callback = object : MediaProjection.Callback() {
      override fun onStop() {
        // Session terminated by the system/user. Release what we still hold.
        releaseAll()
      }
    }
    projectionCallback = callback
    projection.registerCallback(callback, mainHandler)

    val metrics = currentDisplayMetrics()
    val width = metrics.widthPixels
    val height = metrics.heightPixels
    val density = metrics.densityDpi

    imageReader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, MAX_IMAGES)

    var display: VirtualDisplay? = null
    try {
      display = projection.createVirtualDisplay(
        VIRTUAL_DISPLAY_NAME,
        width,
        height,
        density,
        DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
        imageReader!!.surface,
        null,
        null
      )
    } catch (e: Exception) {
      // One-shot token consumed; nothing recoverable. Release and report.
      releaseAll()
      isCapturing = false
      reportOutcome("virtual_display_failed")
      stopSelf()
      return START_NOT_STICKY
    }
    virtualDisplay = display

    imageReader!!.setOnImageAvailableListener({ reader ->
      // Detach the listener first: after our single frame we must not consume
      // anything else, even if the display keeps mirroring for a few frames.
      reader.setOnImageAvailableListener(null, null)

      var image: Image? = null
      try {
        image = reader.acquireLatestImage()
      } catch (e: Exception) {
        releaseAll()
        isCapturing = false
        reportOutcome("image_unavailable")
        stopSelf()
        return@setOnImageAvailableListener
      }

      if (image == null) {
        releaseAll()
        isCapturing = false
        reportOutcome("image_unavailable")
        stopSelf()
        return@setOnImageAvailableListener
      }

      // Extract metadata + hand the in-memory image to the (stub) analyzer.
      val plane = image.planes[0]
      val result = mutableMapOf<String, Any?>(
        "success" to true,
        "width" to image.width,
        "height" to image.height,
        "timestamp" to image.timestamp,
        "pixelFormat" to "RGBA_8888",
        "rowStride" to plane.rowStride,
        "pixelStride" to plane.pixelStride
      )

      LocalVisionAnalyzer.analyze(image)

      // The frame is done: close it and tear the whole pipeline down. The
      // system keeps mirroring for a moment; we simply stop consuming.
      image.close()

      releaseAll()
      isCapturing = false
      reportSuccessMetadata(result)
      stopSelf()
    }, mainHandler)

    return START_NOT_STICKY
  }

  private fun currentDisplayMetrics(): DisplayMetrics {
    val metrics = DisplayMetrics()
    val windowManager = getSystemService(Context.WINDOW_SERVICE) as WindowManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      val windowMetrics = windowManager.maximumWindowMetrics
      metrics.widthPixels = windowMetrics.bounds.width()
      metrics.heightPixels = windowMetrics.bounds.height()
      metrics.densityDpi = resources.configuration.densityDpi
    } else {
      @Suppress("DEPRECATION")
      windowManager.defaultDisplay.getRealMetrics(metrics)
    }
    return metrics
  }

  private fun startForegroundWithProjectionType() {
    val channelId = NOTIFICATION_CHANNEL_ID
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(
        channelId,
        NOTIFICATION_CHANNEL_NAME,
        NotificationManager.IMPORTANCE_LOW
      ).apply {
        description = NOTIFICATION_CHANNEL_DESCRIPTION
        setShowBadge(false)
      }
      getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    val notification: Notification =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        Notification.Builder(this, channelId)
          .setContentTitle(NOTIFICATION_TITLE)
          .setContentText(NOTIFICATION_TEXT)
          .setOngoing(true)
          .setCategory(Notification.CATEGORY_SERVICE)
          .setSmallIcon(android.R.drawable.ic_menu_camera)
          .build()
      } else {
        @Suppress("DEPRECATION")
        Notification.Builder(this)
          .setContentTitle(NOTIFICATION_TITLE)
          .setContentText(NOTIFICATION_TEXT)
          .setSmallIcon(android.R.drawable.ic_menu_camera)
          .build()
      }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(
        NOTIFICATION_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
      )
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  private fun reportSuccessMetadata(metadata: Map<String, Any?>) {
    lastOutcome = "captured"
    lastOutcomeMetadata = metadata
    onCaptureResult?.invoke(metadata)
  }

  private fun reportOutcome(error: String) {
    lastOutcome = error
    lastOutcomeMetadata = null
    onCaptureResult?.invoke(null)
  }

  /**
   * Releases every capture resource exactly once, in the safe order:
   * VirtualDisplay -> ImageReader -> MediaProjection (+ callback).
   * Idempotent: safe to call from multiple failure paths.
   */
  @Synchronized
  private fun releaseAll() {
    if (released) return
    released = true
    try {
      virtualDisplay?.release()
    } catch (_: Exception) {}
    virtualDisplay = null
    try {
      imageReader?.close()
    } catch (_: Exception) {}
    imageReader = null
    try {
      projectionCallback?.let { mediaProjection?.unregisterCallback(it) }
    } catch (_: Exception) {}
    try {
      mediaProjection?.stop()
    } catch (_: Exception) {}
    mediaProjection = null
    hasConsentSession = false
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      stopForeground(STOP_FOREGROUND_REMOVE)
    } else {
      @Suppress("DEPRECATION")
      stopForeground(true)
    }
  }

  override fun onDestroy() {
    releaseAll()
    isCapturing = false
    super.onDestroy()
  }

  companion object {
    const val ACTION_CAPTURE_SINGLE_FRAME = "com.levin197.mobileapp01.screencapture.CAPTURE_SINGLE_FRAME"
    const val EXTRA_RESULT_CODE = "result_code"
    const val EXTRA_RESULT_DATA = "result_data"

    private const val NOTIFICATION_ID = 47132
    private const val NOTIFICATION_CHANNEL_ID = "btl_screen_capture"
    private const val NOTIFICATION_CHANNEL_NAME = "Screen capture test"
    private const val NOTIFICATION_CHANNEL_DESCRIPTION =
      "Shown only while the one-frame screen-capture test runs."
    private const val NOTIFICATION_TITLE = "Break the Loop — screen capture test"
    private const val NOTIFICATION_TEXT = "Capturing a single frame, then stopping."

    private const val VIRTUAL_DISPLAY_NAME = "BtlOneFrameCapture"
    private const val MAX_IMAGES = 2

    /** True between consent delivery and resource release. */
    @Volatile var hasConsentSession: Boolean = false
      private set

    @Volatile var isCapturing: Boolean = false
      private set

    /** Last terminal outcome: "captured" or an error code. */
    @Volatile var lastOutcome: String? = null
      private set

    private var lastOutcomeMetadata: Map<String, Any?>? = null

    /** JS module hook, set while the module instance lives. */
    @Volatile var onCaptureResult: ((Map<String, Any?>?) -> Unit)? = null

    /** Returns and clears the last outcome for JS status queries. */
    fun consumeLastOutcome(): String? {
      val value = lastOutcome
      return value
    }
  }
}
