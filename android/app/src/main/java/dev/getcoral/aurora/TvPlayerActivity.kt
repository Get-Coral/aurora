package dev.getcoral.aurora

import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.Color
import android.os.Bundle
import android.util.Log
import android.view.KeyEvent
import android.view.LayoutInflater
import android.view.View
import android.view.WindowManager
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.annotation.OptIn
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.content.res.ResourcesCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.CaptionStyleCompat
import androidx.media3.ui.PlayerControlView
import androidx.media3.ui.PlayerView
import androidx.media3.ui.TimeBar
import java.util.Locale
import kotlin.math.max

/**
 * A native full-screen player for IPTV films and episodes on Android TV.
 *
 * The WebView plays provider files with Chromium's own decoders, which leave out Dolby audio
 * (AC3/E-AC3: the film plays without sound) and struggle with some MKV files (sound drifts away from
 * the picture). ExoPlayer uses the device's decoders and its Dolby passthrough instead.
 *
 * It looks like the web player in TV mode (layout/aurora_tv_player_controls.xml), with the labels
 * the web app hands over in its own language. Started by [AuroraPlayerPlugin]; the result carries
 * where the viewer got to, which the web player reports to the IPTV store.
 */
@OptIn(UnstableApi::class)
class TvPlayerActivity : AppCompatActivity() {

  companion object {
    private const val TAG = "AuroraTvPlayer"

    const val EXTRA_ITEM_ID = "dev.getcoral.aurora.player.ITEM_ID"
    const val EXTRA_TITLE = "dev.getcoral.aurora.player.TITLE"
    const val EXTRA_SUBTITLE = "dev.getcoral.aurora.player.SUBTITLE"
    const val EXTRA_URL = "dev.getcoral.aurora.player.URL"
    const val EXTRA_POSITION_MS = "dev.getcoral.aurora.player.POSITION_MS"
    const val EXTRA_DURATION_MS = "dev.getcoral.aurora.player.DURATION_MS"
    const val EXTRA_FORMAT = "dev.getcoral.aurora.player.FORMAT"
    const val EXTRA_FALLBACK_URL = "dev.getcoral.aurora.player.FALLBACK_URL"
    const val EXTRA_USER_AGENT = "dev.getcoral.aurora.player.USER_AGENT"
    const val EXTRA_LOCALE = "dev.getcoral.aurora.player.LOCALE"
    const val EXTRA_LABELS = "dev.getcoral.aurora.player.LABELS"
    const val EXTRA_ENDED = "dev.getcoral.aurora.player.ENDED"
    const val EXTRA_ERROR = "dev.getcoral.aurora.player.ERROR"

    // The web player's skips (seekBack / seekForward in MediaPlayerDialog).
    private const val SKIP_BACK_MS = 15_000L
    private const val SKIP_FORWARD_MS = 30_000L
    private const val CONTROLS_TIMEOUT_MS = 3_000 // CONTROLS_HIDE_DELAY_MS in the web player
  }

  /** Text in the web app's language; English when the web app sent none. */
  private class Labels(bundle: Bundle?) {
    private val values = bundle ?: Bundle()

    private fun get(key: String, fallback: String) = values.getString(key)?.takeIf { it.isNotBlank() } ?: fallback

    val nowPlaying = get("nowPlaying", "Now playing")
    val close = get("close", "Close player")
    val skipBack = get("skipBack", "−15s")
    val skipForward = get("skipForward", "+30s")
    val audioTrack = get("audioTrack", "Audio track")
    val subtitles = get("subtitles", "Subtitles")
    val subtitlesOff = get("subtitlesOff", "Off")
    private val trackNumber = get("trackNumber", "Track {number}")

    fun track(number: Int) = trackNumber.replace("{number}", number.toString())
  }

  private enum class Picker {
    AUDIO,
    SUBTITLES,
  }

  private val itemId by lazy { intent.getStringExtra(EXTRA_ITEM_ID).orEmpty() }
  private val url by lazy { intent.getStringExtra(EXTRA_URL).orEmpty() }
  private val startPositionMs by lazy { intent.getLongExtra(EXTRA_POSITION_MS, 0L) }
  private val knownDurationMs by lazy { intent.getLongExtra(EXTRA_DURATION_MS, 0L) }
  private val format by lazy { intent.getStringExtra(EXTRA_FORMAT).orEmpty() }
  private val fallbackUrl by lazy { intent.getStringExtra(EXTRA_FALLBACK_URL).orEmpty() }
  private val userAgent by lazy { intent.getStringExtra(EXTRA_USER_AGENT).orEmpty() }
  private val labels by lazy { Labels(intent.getBundleExtra(EXTRA_LABELS)) }
  private val displayLocale by lazy {
    intent.getStringExtra(EXTRA_LOCALE)?.takeIf { it.isNotBlank() }?.let(Locale::forLanguageTag)
        ?: Locale.getDefault()
  }

  private var player: ExoPlayer? = null
  private lateinit var playerView: PlayerView
  private lateinit var pickerView: LinearLayout
  private lateinit var pickerTitle: TextView
  private lateinit var pickerList: LinearLayout
  private lateinit var pickerScroll: ScrollView
  private var timeView: TextView? = null
  private var audioButton: ImageButton? = null
  private var subtitlesButton: ImageButton? = null
  private var openPicker: Picker? = null
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

    setContentView(R.layout.activity_tv_player)
    playerView = findViewById(R.id.aurora_player_view)
    pickerView = findViewById(R.id.aurora_picker)
    pickerTitle = findViewById(R.id.aurora_picker_title)
    pickerList = findViewById(R.id.aurora_picker_list)
    pickerScroll = findViewById(R.id.aurora_picker_scroll)
    setUpPlayerView()

    onBackPressedDispatcher.addCallback(
        this,
        object : OnBackPressedCallback(true) {
          override fun handleOnBackPressed() {
            // Back closes a picker, then hides the controls, like the web player; then it leaves.
            when {
              openPicker != null -> closePicker()
              playerView.isControllerFullyVisible -> playerView.hideController()
              else -> finishWithResult(ended = false)
            }
          }
        },
    )

    startPlayer()
  }

  private fun setUpPlayerView() {
    playerView.setBackgroundColor(Color.BLACK)
    playerView.controllerShowTimeoutMs = CONTROLS_TIMEOUT_MS
    playerView.controllerHideOnTouch = true
    playerView.keepScreenOn = true

    playerView
        .findViewById<ProgressBar>(androidx.media3.ui.R.id.exo_buffering)
        ?.indeterminateTintList =
        ColorStateList.valueOf(ContextCompat.getColor(this, R.color.aurora_accent))

    // Subtitles like the web player's cues: white Manrope with a soft shadow, no box.
    playerView.subtitleView?.apply {
      setStyle(
          CaptionStyleCompat(
              Color.WHITE,
              Color.TRANSPARENT,
              Color.TRANSPARENT,
              CaptionStyleCompat.EDGE_TYPE_DROP_SHADOW,
              Color.BLACK,
              ResourcesCompat.getFont(this@TvPlayerActivity, R.font.aurora_manrope_semibold),
          ))
      setFractionalTextSize(0.05f)
      setBottomPaddingFraction(0.1f)
    }

    findViewById<TextView>(R.id.aurora_eyebrow).text = labels.nowPlaying
    findViewById<TextView>(R.id.aurora_title).text = intent.getStringExtra(EXTRA_TITLE).orEmpty()
    findViewById<TextView>(R.id.aurora_subtitle).apply {
      val subtitle = intent.getStringExtra(EXTRA_SUBTITLE).orEmpty()
      text = subtitle
      visibility = if (subtitle.isBlank()) View.GONE else View.VISIBLE
    }
    findViewById<TextView>(R.id.aurora_skip_back_label).text = labels.skipBack
    findViewById<TextView>(R.id.aurora_skip_forward_label).text = labels.skipForward
    // Icon and label in one button, so not Media3's exo_rew / exo_ffwd (those must be images).
    findViewById<View>(R.id.aurora_skip_back).apply {
      contentDescription = labels.skipBack
      setOnClickListener { skip(-SKIP_BACK_MS) }
    }
    findViewById<View>(R.id.aurora_skip_forward).apply {
      contentDescription = labels.skipForward
      setOnClickListener { skip(SKIP_FORWARD_MS) }
    }
    findViewById<ImageButton>(R.id.aurora_close).apply {
      contentDescription = labels.close
      setOnClickListener { finishWithResult(ended = false) }
    }
    audioButton =
        findViewById<ImageButton>(R.id.aurora_audio).apply {
          contentDescription = labels.audioTrack
          setOnClickListener { togglePicker(Picker.AUDIO) }
        }
    subtitlesButton =
        findViewById<ImageButton>(R.id.aurora_subtitles).apply {
          contentDescription = labels.subtitles
          setOnClickListener { togglePicker(Picker.SUBTITLES) }
        }
    timeView = findViewById(R.id.aurora_time)

    val controller = playerView.findViewById<PlayerControlView>(androidx.media3.ui.R.id.exo_controller)
    controller?.setProgressUpdateListener { position, _ -> showTime(position) }
    findViewById<AuroraTimeBar>(androidx.media3.ui.R.id.exo_progress)
        .addListener(
            object : TimeBar.OnScrubListener {
              override fun onScrubStart(timeBar: TimeBar, position: Long) = showTime(position)

              override fun onScrubMove(timeBar: TimeBar, position: Long) = showTime(position)

              override fun onScrubStop(timeBar: TimeBar, position: Long, canceled: Boolean) =
                  showTime(position)
            })

    playerView.setControllerVisibilityListener(
        PlayerView.ControllerVisibilityListener { visibility ->
          if (visibility == View.VISIBLE) {
            showTime(player?.currentPosition ?: lastPositionMs)
            // Land on play/pause, as the web player's TV mode does.
            if (openPicker == null && currentFocus?.let { isInside(it, playerView) } != true) {
              findViewById<View>(androidx.media3.ui.R.id.exo_play_pause)?.requestFocus()
            }
          } else if (openPicker != null) {
            closePicker()
          }
        })
  }

  private fun isInside(view: View, ancestor: View): Boolean {
    var current: View? = view
    while (current != null) {
      if (current === ancestor) return true
      current = current.parent as? View
    }
    return false
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
            .setSeekBackIncrementMs(SKIP_BACK_MS)
            .setSeekForwardIncrementMs(SKIP_FORWARD_MS)
            .build()
    this.player = player
    // Audio in the viewer's language when the file has it. Subtitles the file marks as default or
    // forced show on their own, the rest only once the viewer picks them.
    player.trackSelectionParameters =
        player.trackSelectionParameters
            .buildUpon()
            .setPreferredAudioLanguage(displayLocale.language)
            .build()
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

        override fun onTracksChanged(tracks: Tracks) {
          audioButton?.visibility = if (audioOptions().size > 1) View.VISIBLE else View.GONE
          subtitlesButton?.visibility =
              if (subtitleOptions().isNotEmpty()) View.VISIBLE else View.GONE
          openPicker?.let { showPicker(it) }
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

  private fun skip(deltaMs: Long) {
    val player = player ?: return
    if (deltaMs < 0) player.seekBack() else player.seekForward()
    showTime(player.currentPosition)
  }

  // ---- Time ----

  private fun showTime(positionMs: Long) {
    timeView?.text = "${formatTime(positionMs)} / ${formatTime(durationMs())}"
  }

  /** The web player's formatTime: 0:57, 12:05, 1:13:34. */
  private fun formatTime(ms: Long): String {
    val total = (ms.coerceAtLeast(0L) / 1000)
    val h = total / 3600
    val m = (total % 3600) / 60
    val s = total % 60
    return if (h > 0) String.format(Locale.ROOT, "%d:%02d:%02d", h, m, s)
    else String.format(Locale.ROOT, "%d:%02d", m, s)
  }

  // ---- Audio and subtitle pickers ----

  private class TrackOption(
      val label: String,
      val group: Tracks.Group?,
      val index: Int,
      val selected: Boolean,
  )

  private fun optionsOf(type: Int): List<TrackOption> {
    val groups = player?.currentTracks?.groups ?: return emptyList()
    val options = mutableListOf<TrackOption>()
    for (group in groups) {
      if (group.type != type) continue
      for (index in 0 until group.length) {
        if (!group.isTrackSupported(index)) continue
        options +=
            TrackOption(
                label = trackLabel(group.getTrackFormat(index), options.size + 1),
                group = group,
                index = index,
                selected = group.isTrackSelected(index),
            )
      }
    }
    return options
  }

  private fun audioOptions() = optionsOf(C.TRACK_TYPE_AUDIO)

  private fun subtitleOptions() = optionsOf(C.TRACK_TYPE_TEXT)

  /** Like trackLabel in src/lib/player/attach-stream.ts: "Dutch", "English (SDH)", or a number. */
  private fun trackLabel(format: Format, number: Int): String {
    val code = format.language?.takeIf { it.isNotBlank() && it != "und" && it != C.LANGUAGE_UNDETERMINED }
    val language =
        code?.let {
          Locale.forLanguageTag(it).getDisplayLanguage(displayLocale).takeIf { name ->
            name.isNotBlank() && !name.equals(it, ignoreCase = true)
          }
              ?: it.uppercase(Locale.ROOT)
        }?.replaceFirstChar { it.titlecase(displayLocale) }
    val title = format.label?.trim()?.takeIf { it.isNotEmpty() }
    return when {
      language != null && title != null && !title.contains(language, ignoreCase = true) ->
          "$language ($title)"
      language != null -> language
      title != null -> title
      else -> labels.track(number)
    }
  }

  private fun togglePicker(picker: Picker) {
    if (openPicker == picker) closePicker() else showPicker(picker)
  }

  private fun showPicker(picker: Picker) {
    val options = if (picker == Picker.AUDIO) audioOptions() else subtitleOptions()
    openPicker = picker
    // Keep the controls up while a picker is open.
    playerView.controllerShowTimeoutMs = 0
    playerView.showController()

    pickerTitle.text = if (picker == Picker.AUDIO) labels.audioTrack else labels.subtitles
    pickerList.removeAllViews()
    val inflater = LayoutInflater.from(this)
    var focusTarget: View? = null

    fun addOption(label: String, selected: Boolean, onPick: () -> Unit) {
      val view =
          (inflater.inflate(R.layout.aurora_tv_player_option, pickerList, false) as TextView).apply {
            text = label
            isSelected = selected
            setOnClickListener {
              onPick()
              closePicker()
            }
          }
      pickerList.addView(view)
      if (selected || focusTarget == null) focusTarget = view
    }

    if (picker == Picker.SUBTITLES) {
      val off = player?.trackSelectionParameters?.disabledTrackTypes?.contains(C.TRACK_TYPE_TEXT) == true
      addOption(labels.subtitlesOff, off || options.none { it.selected }) {
        updateTracks { it.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true) }
      }
    }
    for (option in options) {
      addOption(option.label, option.selected) {
        val group = option.group ?: return@addOption
        val type = if (picker == Picker.AUDIO) C.TRACK_TYPE_AUDIO else C.TRACK_TYPE_TEXT
        updateTracks {
          it.setTrackTypeDisabled(type, false)
              .setOverrideForType(TrackSelectionOverride(group.mediaTrackGroup, option.index))
        }
      }
    }

    pickerView.visibility = View.VISIBLE
    // Long lists (forty subtitle languages) scroll inside the picker instead of running off screen.
    pickerScroll.layoutParams =
        pickerScroll.layoutParams.apply {
          height =
              if (pickerList.childCount > 7) (resources.displayMetrics.heightPixels * 0.55f).toInt()
              else LinearLayout.LayoutParams.WRAP_CONTENT
        }
    // Focus the current choice once the picker is laid out, scrolled into view in a long list.
    focusTarget?.let { target ->
      pickerScroll.post {
        target.requestFocus()
        pickerScroll.scrollTo(0, max(0, target.top - target.height))
      }
    }
  }

  private fun updateTracks(
      change: (androidx.media3.common.TrackSelectionParameters.Builder) ->
          androidx.media3.common.TrackSelectionParameters.Builder
  ) {
    val player = player ?: return
    player.trackSelectionParameters = change(player.trackSelectionParameters.buildUpon()).build()
  }

  private fun closePicker() {
    val picker = openPicker ?: return
    openPicker = null
    pickerView.visibility = View.GONE
    pickerList.removeAllViews()
    playerView.controllerShowTimeoutMs = CONTROLS_TIMEOUT_MS
    playerView.showController()
    (if (picker == Picker.AUDIO) audioButton else subtitlesButton)?.requestFocus()
  }

  // ---- Remote ----

  override fun dispatchKeyEvent(event: KeyEvent): Boolean {
    // Any remote key brings the controls up first, so a stray press never seeks blind.
    if (
        event.action == KeyEvent.ACTION_DOWN &&
            ::playerView.isInitialized &&
            openPicker == null &&
            !playerView.isControllerFullyVisible &&
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

  // ---- Leaving ----

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
