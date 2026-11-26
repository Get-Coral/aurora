package dev.getcoral.aurora

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Handler
import android.os.Looper
import android.util.Log
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Fetches a title's artwork for the native players, which show it while the stream loads, as the
 * web player does. Off the main thread, scaled down to about screen size, and best effort: no
 * artwork just leaves the usual black screen.
 */
class ArtworkLoader(private val userAgent: String) {

  private companion object {
    const val TAG = "AuroraArtwork"
    const val MAX_BYTES = 8 * 1024 * 1024
    const val MAX_WIDTH = 1920
  }

  private val executor: ExecutorService = Executors.newSingleThreadExecutor()
  private val main = Handler(Looper.getMainLooper())
  @Volatile private var cancelled = false

  /** Calls [onLoaded] on the main thread, unless loading fails or [cancel] came first. */
  fun load(url: String, onLoaded: (Bitmap) -> Unit) {
    if (url.isBlank()) return
    executor.execute {
      val bitmap =
          try {
            fetch(url)
          } catch (error: Exception) {
            Log.w(TAG, "Artwork unavailable: ${error.javaClass.simpleName}")
            null
          }
      if (bitmap != null && !cancelled) main.post { if (!cancelled) onLoaded(bitmap) }
    }
  }

  fun cancel() {
    cancelled = true
    executor.shutdownNow()
  }

  private fun fetch(url: String): Bitmap? {
    val connection =
        (URL(url).openConnection() as HttpURLConnection).apply {
          connectTimeout = 8_000
          readTimeout = 10_000
          instanceFollowRedirects = true
          if (userAgent.isNotBlank()) setRequestProperty("User-Agent", userAgent)
        }
    try {
      if (connection.responseCode !in 200..299) return null
      if (connection.contentType?.startsWith("image/") == false) return null
      val bytes = connection.inputStream.use { input -> readCapped(input) } ?: return null
      // Decode at the smallest power-of-two scale that still fills a 1080p screen.
      val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
      if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
      var sample = 1
      while (bounds.outWidth / (sample * 2) >= MAX_WIDTH) sample *= 2
      return BitmapFactory.decodeByteArray(
          bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
    } finally {
      connection.disconnect()
    }
  }

  private fun readCapped(input: java.io.InputStream): ByteArray? {
    val out = java.io.ByteArrayOutputStream()
    val buffer = ByteArray(16 * 1024)
    while (true) {
      val read = input.read(buffer)
      if (read < 0) break
      if (out.size() + read > MAX_BYTES) return null
      out.write(buffer, 0, read)
    }
    return out.toByteArray()
  }
}
