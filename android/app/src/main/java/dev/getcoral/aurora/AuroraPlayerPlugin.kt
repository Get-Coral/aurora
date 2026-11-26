package dev.getcoral.aurora

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import androidx.activity.result.ActivityResult
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Hands an IPTV film or episode from the web player to [TvPlayerActivity] and resolves, once the
 * viewer is back, with where they got to.
 */
@CapacitorPlugin(name = "AuroraPlayer")
class AuroraPlayerPlugin : Plugin() {

  @PluginMethod
  fun open(call: PluginCall) {
    val url = call.getString("url")
    val itemId = call.getString("itemId")
    if (url.isNullOrBlank() || itemId.isNullOrBlank()) {
      call.reject("itemId and url are required")
      return
    }
    val intent =
        Intent(context, TvPlayerActivity::class.java).apply {
          putExtra(TvPlayerActivity.EXTRA_ITEM_ID, itemId)
          putExtra(TvPlayerActivity.EXTRA_TITLE, call.getString("title", ""))
          putExtra(TvPlayerActivity.EXTRA_SUBTITLE, call.getString("subtitle", ""))
          putExtra(TvPlayerActivity.EXTRA_LOCALE, call.getString("locale", ""))
          putExtra(TvPlayerActivity.EXTRA_LABELS, labels(call.getObject("labels")))
          putExtra(TvPlayerActivity.EXTRA_URL, url)
          putExtra(TvPlayerActivity.EXTRA_POSITION_MS, call.getDouble("positionMs", 0.0)!!.toLong())
          putExtra(TvPlayerActivity.EXTRA_DURATION_MS, call.getDouble("durationMs", 0.0)!!.toLong())
          putExtra(TvPlayerActivity.EXTRA_FORMAT, call.getString("format", ""))
          putExtra(TvPlayerActivity.EXTRA_FALLBACK_URL, call.getString("fallbackUrl", ""))
          putExtra(TvPlayerActivity.EXTRA_USER_AGENT, call.getString("userAgent", ""))
        }
    startActivityForResult(call, intent, "playerClosed")
  }

  /** The web app's own words for the controls, so the player speaks the viewer's language. */
  private fun labels(labels: JSObject?): Bundle =
      Bundle().apply {
        val keys = labels?.keys() ?: return@apply
        for (key in keys) labels.getString(key)?.let { putString(key, it) }
      }

  @ActivityCallback
  private fun playerClosed(call: PluginCall?, result: ActivityResult) {
    if (call == null) return
    val data = result.data
    if (result.resultCode != Activity.RESULT_OK || data == null) {
      // The player went away without saying where the viewer was (the system closed it).
      call.resolve(JSObject().apply { put("positionMs", -1); put("ended", false) })
      return
    }
    call.resolve(
        JSObject().apply {
          put("positionMs", data.getLongExtra(TvPlayerActivity.EXTRA_POSITION_MS, -1L))
          put("durationMs", data.getLongExtra(TvPlayerActivity.EXTRA_DURATION_MS, 0L))
          put("ended", data.getBooleanExtra(TvPlayerActivity.EXTRA_ENDED, false))
          data.getStringExtra(TvPlayerActivity.EXTRA_ERROR)?.let { put("error", it) }
        })
  }
}
