package dev.getcoral.aurora

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.util.Log
import android.view.KeyEvent
import android.view.WindowManager
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.PlayerView
import kotlin.math.max

/**
 * A native full-screen player for IPTV films and episodes on Android TV.
 *
 * The WebView plays provider files with Chromium's own decoders, which leave out Dolby audio
 * (AC3/E-AC3: the film plays without sound) and struggle with some MKV files (sound drifts away from
 * the picture). ExoPlayer uses the device's decoders and its Dolby passthrough instead.
 *
 * Started by [AuroraPlayerPlugin]; the result carries where the viewer got to, which the web
 * player reports to the IPTV store like it does for its own playback.
 */
class TvPlayerActivity : AppCompatActivity() {

  companion object {
    private const val TAG = "AuroraTvPlayer"

    const val EXTRA_ITEM_ID = "dev.getcoral.aurora.player.ITEM_ID"
    const val EXTRA_TITLE = "dev.getcoral.aurora.player.TITLE"
    const val EXTRA_URL = "dev.getcoral.aurora.player.URL"
    const val EXTRA_POSITION_MS = "dev.getcoral.aurora.player.POSITION_MS"
    const val EXTRA_DURATION_MS = "dev.getcoral.aurora.player.DURATION_MS"
    const val EXTRA_FORMAT = "dev.getcoral.aurora.player.FORMAT"
    const val EXTRA_FALLBACK_URL = "dev.getcoral.aurora.player.FALLBACK_URL"
    const val EXTRA_USER_AGENT = "dev.getcoral.aurora.player.USER_AGENT"
    const val EXTRA_ENDED = "dev.getcoral.aurora.player.ENDED"
    const val EXTRA_ERROR = "dev.getcoral.aurora.player.ERROR"
  }

  private val itemId by lazy { intent.getStringExtra(EXTRA_ITEM_ID).orEmpty() }
  private val url by lazy { intent.getStringExtra(EXTRA_URL).orEmpty() }
  private val startPositionMs by lazy { intent.getLongExtra(EXTRA_POSITION_MS, 0L) }
  private val knownDurationMs by lazy { intent.getLongExtra(EXTRA_DURATION_MS, 0L) }
  private val format by lazy { intent.getStringExtra(EXTRA_FORMAT).orEmpty() }
  private val fallbackUrl by lazy { intent.getStringExtra(EXTRA_FALLBACK_URL).orEmpty() }
  private val userAgent by lazy { intent.getStringExtra(EXTRA_USER_AGENT).orEmpty() }

  private var player: ExoPlayer? = null
  private lateinit var playerView: PlayerView
  private var usingFallback = false
  private var finishing = false
  /** Where the viewer was, kept for when the player is already released. */
  private var lastPositionMs = 0L

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    WindowCompat.setDecorFitsSystemWindows(window, false)
    WindowInsetsControllerCompat(window, window.decorView).apply {
      hide(WindowInsetsCompat.Type.systemBars())
      systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    }

    if (url.isBlank()) {
      finishWithResult(ended = false, error = "No stream to play")
      return
    }
    lastPositionMs = startPositionMs

    playerView =
        PlayerView(this).apply {
          setBackgroundColor(Color.BLACK)
          setShowSubtitleButton(true)
          setShowNextButton(false)
          setShowPreviousButton(false)
          controllerShowTimeoutMs = 4_000
          keepScreenOn = true
          isFocusable = true
          isFocusableInTouchMode = true
        }
    setContentView(playerView)

    onBackPressedDispatcher.addCallback(
        this,
        object : OnBackPressedCallback(true) {
          override fun handleOnBackPressed() {
            // First Back hides the controls, like every TV player; the next one leaves.
            if (playerView.isControllerFullyVisible) playerView.hideController()
            else finishWithResult(ended = false)
          }
        },
    )

    startPlayer()
  }

  private fun startPlayer() {
    val http =
        DefaultHttpDataSource.Factory()
            .setAllowCrossProtocolRedirects(true)
            .setConnectTimeoutMs(20_000)
            .setReadTimeoutMs(30_000)
            .apply { if (userAgent.isNotBlank()) setUserAgent(userAgent) }
    val player =
        ExoPlayer.Builder(this)
            .setMediaSourceFactory(DefaultMediaSourceFactory(this).setDataSourceFactory(http))
            // Film audio: lets ExoPlayer hand Dolby streams to the TV or receiver as they are.
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(C.USAGE_MEDIA)
                    .setContentType(C.AUDIO_CONTENT_TYPE_MOVIE)
                    .build(),
                /* handleAudioFocus= */ true,
            )
            .setHandleAudioBecomingNoisy(true)
            .setSeekBackIncrementMs(10_000)
            .setSeekForwardIncrementMs(30_000)
            .build()
    this.player = player
    player.addListener(listener)
    playerView.player = player
    player.setMediaItem(mediaItem(url, format), max(0L, startPositionMs))
    player.prepare()
    player.playWhenReady = true
    playerView.requestFocus()
  }

  /**
   * The player tells HLS from a progressive file by the URL's extension. IPTV playlists don't always
   * have one, so say so when the web player knows.
   */
  private fun mediaItem(uri: String, format: String): MediaItem =
      MediaItem.Builder()
          .setUri(uri)
          .apply { if (format == "hls") setMimeType(MimeTypes.APPLICATION_M3U8) }
          .build()

  private val listener =
      object : Player.Listener {
        override fun onPlaybackStateChanged(playbackState: Int) {
          if (playbackState == Player.STATE_ENDED) finishWithResult(ended = true)
        }

        override fun onPlayerError(error: PlaybackException) {
          Log.e(TAG, "Playback failed", error)
          val player = player ?: return
          if (!usingFallback && fallbackUrl.isNotBlank()) {
            usingFallback = true
            val position = player.currentPosition
            player.setMediaItem(mediaItem(fallbackUrl, ""), position)
            player.prepare()
            player.play()
            return
          }
          finishWithResult(ended = false, error = error.errorCodeName)
        }
      }

  override fun dispatchKeyEvent(event: KeyEvent): Boolean {
    // Any remote key brings the controls up first, so a stray press never seeks blind.
    if (
        event.action == KeyEvent.ACTION_DOWN &&
            ::playerView.isInitialized &&
            !playerView.isControllerFullyVisible &&
            event.keyCode != KeyEvent.KEYCODE_BACK &&
            isNavigationKey(event.keyCode)
    ) {
      playerView.showController()
      return true
    }
    return super.dispatchKeyEvent(event)
  }

  private fun isNavigationKey(keyCode: Int) =
      when (keyCode) {
        KeyEvent.KEYCODE_DPAD_UP,
        KeyEvent.KEYCODE_DPAD_DOWN,
        KeyEvent.KEYCODE_DPAD_LEFT,
        KeyEvent.KEYCODE_DPAD_RIGHT,
        KeyEvent.KEYCODE_DPAD_CENTER,
        KeyEvent.KEYCODE_ENTER -> true
        else -> false
      }

  override fun onStop() {
    super.onStop()
    // Home or another app: pause here, the viewer comes back to the same spot.
    player?.pause()
  }

  private fun positionMs(): Long {
    val player = player ?: return lastPositionMs
    lastPositionMs = player.currentPosition.coerceAtLeast(0L)
    return lastPositionMs
  }

  private fun durationMs(): Long = max(knownDurationMs, player?.duration?.takeIf { it > 0 } ?: 0L)

  private fun finishWithResult(ended: Boolean, error: String? = null) {
    if (finishing) return
    finishing = true
    val position = if (ended) durationMs() else positionMs()
    val result =
        Intent().apply {
          putExtra(EXTRA_ITEM_ID, itemId)
          putExtra(EXTRA_POSITION_MS, position)
          putExtra(EXTRA_DURATION_MS, durationMs())
          putExtra(EXTRA_ENDED, ended)
          if (error != null) putExtra(EXTRA_ERROR, error)
        }
    setResult(RESULT_OK, result)
    releasePlayer()
    finish()
  }

  private fun releasePlayer() {
    val player = player ?: return
    lastPositionMs = player.currentPosition.coerceAtLeast(0L)
    player.removeListener(listener)
    player.release()
    this.player = null
    if (::playerView.isInitialized) playerView.player = null
  }

  override fun onDestroy() {
    releasePlayer()
    super.onDestroy()
  }
}
