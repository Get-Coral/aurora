package dev.getcoral.aurora

import android.content.Intent
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Hands a film from the web player to [TheaterActivity] and tells the web app where the viewer got
 * to once they are back on the panel. Only the Quest build has it.
 */
@CapacitorPlugin(name = "AuroraTheater")
class AuroraTheaterPlugin : Plugin() {

  @PluginMethod
  fun open(call: PluginCall) {
    val url = call.getString("url")
    val itemId = call.getString("itemId")
    if (url.isNullOrBlank() || itemId.isNullOrBlank()) {
      call.reject("itemId and url are required")
      return
    }
    val intent =
        Intent(context, TheaterActivity::class.java).apply {
          action = Intent.ACTION_MAIN
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          putExtra(TheaterActivity.EXTRA_ITEM_ID, itemId)
          putExtra(TheaterActivity.EXTRA_TITLE, call.getString("title", ""))
          putExtra(TheaterActivity.EXTRA_URL, url)
          putExtra(TheaterActivity.EXTRA_POSITION_MS, call.getDouble("positionMs", 0.0)!!.toLong())
          putExtra(
              TheaterActivity.EXTRA_STREAM_OFFSET_MS,
              call.getDouble("streamOffsetMs", 0.0)!!.toLong(),
          )
          putExtra(TheaterActivity.EXTRA_DURATION_MS, call.getDouble("durationMs", 0.0)!!.toLong())
          putExtra(TheaterActivity.EXTRA_LIVE, call.getBoolean("live", false)!!)
          putExtra(TheaterActivity.EXTRA_FORMAT, call.getString("format", ""))
          putExtra(TheaterActivity.EXTRA_FALLBACK_URL, call.getString("fallbackUrl", ""))
          putExtra(TheaterActivity.EXTRA_USER_AGENT, call.getString("userAgent", ""))
          putExtra(TheaterActivity.EXTRA_ARTWORK_URL, call.getString("artworkUrl", ""))
        }
    activity.startActivity(intent)
    call.resolve()
  }

  // Capacitor routes both the launch intent and later ones here, so this also
  // works when the panel activity was recreated while the theater was open.
  override fun handleOnNewIntent(intent: Intent?) {
    if (intent?.action != TheaterActivity.ACTION_CLOSED) return
    val result =
        JSObject().apply {
          put("itemId", intent.getStringExtra(TheaterActivity.EXTRA_ITEM_ID).orEmpty())
          put("positionMs", intent.getLongExtra(TheaterActivity.EXTRA_POSITION_MS, 0L))
          put("ended", intent.getBooleanExtra(TheaterActivity.EXTRA_ENDED, false))
        }
    // Handled: a later reload of the WebView must not replay it.
    intent.action = Intent.ACTION_MAIN
    // Kept until the web player listens, in case the WebView is still starting.
    notifyListeners("closed", result, true)
  }
}
