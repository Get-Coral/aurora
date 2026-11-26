package dev.getcoral.aurora

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Outline
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.LayoutInflater
import android.view.MotionEvent
import android.view.Surface
import android.view.View
import android.view.ViewGroup
import android.view.ViewOutlineProvider
import android.widget.GridLayout
import android.widget.ImageButton
import android.widget.ImageView
import android.widget.SeekBar
import android.widget.TextView
import androidx.core.net.toUri
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.VideoSize
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import com.meta.spatial.core.Color4
import com.meta.spatial.core.Entity
import com.meta.spatial.core.Pose
import com.meta.spatial.core.Quaternion
import com.meta.spatial.core.Query
import com.meta.spatial.core.SpatialFeature
import com.meta.spatial.core.SystemBase
import com.meta.spatial.core.Vector3
import com.meta.spatial.runtime.AlphaMode
import com.meta.spatial.runtime.ButtonBits
import com.meta.spatial.runtime.ReferenceSpace
import com.meta.spatial.runtime.SessionState
import com.meta.spatial.runtime.StereoMode
import com.meta.spatial.toolkit.AppSystemActivity
import com.meta.spatial.toolkit.Controller
import com.meta.spatial.toolkit.DpDisplayOptions
import com.meta.spatial.toolkit.LayoutXMLPanelRegistration
import com.meta.spatial.toolkit.Material
import com.meta.spatial.toolkit.MediaPanelRenderOptions
import com.meta.spatial.toolkit.MediaPanelSettings
import com.meta.spatial.toolkit.Mesh
import com.meta.spatial.toolkit.MeshCollision
import com.meta.spatial.toolkit.Panel
import com.meta.spatial.toolkit.PanelRegistration
import com.meta.spatial.toolkit.PanelStyleOptions
import com.meta.spatial.toolkit.PixelDisplayOptions
import com.meta.spatial.toolkit.QuadShapeOptions
import com.meta.spatial.toolkit.Scale
import com.meta.spatial.toolkit.Transform
import com.meta.spatial.toolkit.UIPanelSettings
import com.meta.spatial.toolkit.VideoSurfacePanelRegistration
import com.meta.spatial.toolkit.Visible
import com.meta.spatial.vr.LocomotionSystem
import com.meta.spatial.vr.VRFeature
import java.util.Locale
import kotlin.math.max

/**
 * The immersive theater on Meta Quest: the film on a big screen inside an environment (see
 * [TheaterEnvironment]) that dims its lights and hushes while the film plays. It plays whatever the
 * panel player does: Jellyfin titles (direct play or HLS transcodes), IPTV films and series, and
 * live channels (HLS or MPEG-TS).
 *
 * The web player hands over the stream through [AuroraTheaterPlugin]; leaving goes back to the 2D
 * panel with the position, which the web player then reports to Jellyfin or the IPTV store as usual.
 */
class TheaterActivity : AppSystemActivity() {

  companion object {
    private const val TAG = "AuroraTheater"

    const val EXTRA_ITEM_ID = "dev.getcoral.aurora.theater.ITEM_ID"
    const val EXTRA_TITLE = "dev.getcoral.aurora.theater.TITLE"
    const val EXTRA_URL = "dev.getcoral.aurora.theater.URL"
    const val EXTRA_POSITION_MS = "dev.getcoral.aurora.theater.POSITION_MS"
    const val EXTRA_STREAM_OFFSET_MS = "dev.getcoral.aurora.theater.STREAM_OFFSET_MS"
    const val EXTRA_DURATION_MS = "dev.getcoral.aurora.theater.DURATION_MS"
    const val EXTRA_ENDED = "dev.getcoral.aurora.theater.ENDED"
    const val EXTRA_LIVE = "dev.getcoral.aurora.theater.LIVE"
    const val EXTRA_FORMAT = "dev.getcoral.aurora.theater.FORMAT"
    const val EXTRA_FALLBACK_URL = "dev.getcoral.aurora.theater.FALLBACK_URL"
    const val EXTRA_USER_AGENT = "dev.getcoral.aurora.theater.USER_AGENT"

    /** The action of the intent that brings the 2D panel back. */
    const val ACTION_CLOSED = "dev.getcoral.aurora.theater.CLOSED"

    private const val PREFS = "aurora-theater"
    private const val PREF_ENVIRONMENT = "environment"

    // A 16:9 screen 4.8 m wide, 5 m away: about 51° wide, a good cinema seat.
    private const val SCREEN_WIDTH = 4.8f
    private const val SCREEN_HEIGHT = 2.7f
    private val SCREEN_POSITION = Vector3(0f, 1.6f, 5f)

    // The control bar floats low and close, out of the film's way; the picker opens above it.
    private const val CONTROLS_WIDTH = 1.25f
    private const val CONTROLS_HEIGHT = 0.275f
    private val CONTROLS_POSITION = Vector3(0f, 0.95f, 1.45f)
    private const val PICKER_HEIGHT = 0.65f
    private val PICKER_POSITION =
        Vector3(0f, 0.95f + CONTROLS_HEIGHT / 2 + PICKER_HEIGHT / 2 + 0.03f, 1.5f)

    // How the rendered skies and seats line up with the screen (yaw, degrees).
    private const val SKY_YAW = 180f
    private const val SEAT_YAW = 180f

    private const val SKIP_BACK_MS = 10_000L
    private const val SKIP_FORWARD_MS = 30_000L
    // The controls step aside this long after the last interaction while the film plays.
    private const val CONTROLS_HIDE_MS = 5_000L
    private const val FADE_MS = 220L
    // A live stream that drops is reconnected, but not forever.
    private const val MAX_LIVE_RECONNECTS = 5
  }

  private val itemId by lazy { intent.getStringExtra(EXTRA_ITEM_ID).orEmpty() }
  private val title by lazy { intent.getStringExtra(EXTRA_TITLE).orEmpty() }
  private val url by lazy { intent.getStringExtra(EXTRA_URL).orEmpty() }
  private val startPositionMs by lazy { intent.getLongExtra(EXTRA_POSITION_MS, 0L) }
  /** Film time at which the stream starts (a transcode resumed mid-film). */
  private val streamOffsetMs by lazy { intent.getLongExtra(EXTRA_STREAM_OFFSET_MS, 0L) }
  private val knownDurationMs by lazy { intent.getLongExtra(EXTRA_DURATION_MS, 0L) }
  private val live by lazy { intent.getBooleanExtra(EXTRA_LIVE, false) }
  private val format by lazy { intent.getStringExtra(EXTRA_FORMAT).orEmpty() }
  private val fallbackUrl by lazy { intent.getStringExtra(EXTRA_FALLBACK_URL).orEmpty() }
  private val userAgent by lazy { intent.getStringExtra(EXTRA_USER_AGENT).orEmpty() }

  private var player: ExoPlayer? = null
  private lateinit var ambience: TheaterAmbience
  private var environment = TheaterEnvironment.all.first()

  private var screen: Entity? = null
  /** The environment's sky (index 0) and its light layers, once their images are decoded. */
  private var skies: List<TheaterSky> = emptyList()
  /** Bumped on every switch, so a slow decode never puts up an environment no longer chosen. */
  private var environmentGeneration = 0
  private val decoder = java.util.concurrent.Executors.newSingleThreadExecutor()
  private var seat: Entity? = null
  private var controlsEntity: Entity? = null
  private var pickerEntity: Entity? = null

  private var controlsRoot: View? = null
  private var pickerRoot: View? = null
  private var titleView: TextView? = null
  private var timeView: TextView? = null
  private var seekBar: SeekBar? = null
  private var playPauseButton: ImageButton? = null
  private val environmentCards = mutableMapOf<String, View>()

  private var controlsShown = true
  private var pickerOpen = false
  private var wasPlayingBeforeMenu = false
  private var leaving = false
  private var seeking = false
  private var usingFallback = false
  private var liveReconnects = 0

  private val handler = Handler(Looper.getMainLooper())
  private val ticker =
      object : Runnable {
        override fun run() {
          updateControls()
          handler.postDelayed(this, 500)
        }
      }
  private val hideControls = Runnable { setControlsShown(false) }

  override fun registerFeatures(): List<SpatialFeature> = listOf(VRFeature(this))

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    environment =
        TheaterEnvironment.byKey(
            getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(PREF_ENVIRONMENT, null))
    ambience = TheaterAmbience(this) { sky, layers, lightsUp -> renderLights(sky, layers, lightsUp) }
    systemManager.registerSystem(WakeControlsSystem())
  }

  override fun onSceneReady() {
    super.onSceneReady()
    scene.setReferenceSpace(ReferenceSpace.LOCAL_FLOOR)
    // Dim, even light: the screen is what should stand out.
    scene.setLightingEnvironment(
        ambientColor = Vector3(0.6f),
        sunColor = Vector3(0f),
        sunDirection = -Vector3(1f, 3f, 2f),
        environmentIntensity = 0.2f,
    )
    // A theater, not a place to walk around in.
    systemManager.findSystem<LocomotionSystem>().enableLocomotion(false)

    screen = Entity.create(Panel(R.id.theater_screen), Transform(Pose(SCREEN_POSITION)))
    controlsEntity =
        Entity.create(Panel(R.id.theater_controls), Transform(Pose(CONTROLS_POSITION)))
    pickerEntity =
        Entity.create(
            Panel(R.id.theater_environments), Transform(Pose(PICKER_POSITION)), Visible(false))
    applyEnvironment(environment)
  }

  override fun registerPanels(): List<PanelRegistration> =
      listOf(
          VideoSurfacePanelRegistration(
              R.id.theater_screen,
              surfaceConsumer = { _, surface -> startPlayer(surface) },
              settingsCreator = {
                MediaPanelSettings(
                    shape = QuadShapeOptions(width = SCREEN_WIDTH, height = SCREEN_HEIGHT),
                    // Ignored by surface panels, which take the video's own size.
                    display = PixelDisplayOptions(width = 1920, height = 1080),
                    rendering = MediaPanelRenderOptions(stereoMode = StereoMode.None),
                )
              },
          ),
          LayoutXMLPanelRegistration(
              R.id.theater_controls,
              layoutIdCreator = { R.layout.theater_controls },
              settingsCreator = {
                UIPanelSettings(
                    shape = QuadShapeOptions(width = CONTROLS_WIDTH, height = CONTROLS_HEIGHT),
                    display = DpDisplayOptions(width = 1000f, height = 220f),
                    style = PanelStyleOptions(themeResourceId = R.style.TheaterPanelTheme),
                )
              },
              panelSetupWithRootView = { root, _, _ -> bindControls(root) },
          ),
          LayoutXMLPanelRegistration(
              R.id.theater_environments,
              layoutIdCreator = { R.layout.theater_environments },
              settingsCreator = {
                UIPanelSettings(
                    shape = QuadShapeOptions(width = CONTROLS_WIDTH, height = PICKER_HEIGHT),
                    display = DpDisplayOptions(width = 1000f, height = 520f),
                    style = PanelStyleOptions(themeResourceId = R.style.TheaterPanelTheme),
                )
              },
              panelSetupWithRootView = { root, _, _ -> bindPicker(root) },
          ),
      )

  // ---- Playback ----

  private fun startPlayer(surface: Surface) {
    player?.release()
    val http =
        DefaultHttpDataSource.Factory()
            .setAllowCrossProtocolRedirects(true)
            .apply { if (userAgent.isNotBlank()) setUserAgent(userAgent) }
    player =
        ExoPlayer.Builder(this, auroraRenderers(this))
            .setMediaSourceFactory(DefaultMediaSourceFactory(this).setDataSourceFactory(http))
            .build()
            .apply {
              setVideoSurface(surface)
              addListener(playerListener)
              setMediaItem(mediaItem(url, format))
              prepare()
              if (!live) seekTo(max(0L, startPositionMs - streamOffsetMs))
              playWhenReady = true
            }
    handler.removeCallbacks(ticker)
    handler.post(ticker)
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

  /** Live: drop the stale buffer and join the stream again. */
  private fun reconnectLive(): Boolean {
    val player = player ?: return false
    if (!live || liveReconnects >= MAX_LIVE_RECONNECTS) return false
    liveReconnects++
    player.prepare()
    player.play()
    return true
  }

  private val playerListener =
      object : Player.Listener {
        override fun onPlaybackStateChanged(playbackState: Int) {
          if (playbackState == Player.STATE_ENDED) {
            // A live stream "ends" when the connection drops.
            if (!reconnectLive()) leave(ended = !live)
          }
          onFilmStateChanged()
        }

        override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) =
            onFilmStateChanged()

        override fun onIsPlayingChanged(isPlaying: Boolean) {
          if (isPlaying) liveReconnects = 0
          updateControls()
        }

        override fun onVideoSizeChanged(videoSize: VideoSize) = fitScreen(videoSize)

        override fun onPlayerError(error: PlaybackException) {
          Log.e(TAG, "Playback failed", error)
          val player = player ?: return
          // The provider's other stream (MPEG-TS when HLS fails), like the panel player does.
          if (!usingFallback && fallbackUrl.isNotBlank()) {
            usingFallback = true
            player.setMediaItem(mediaItem(fallbackUrl, ""))
            player.prepare()
            player.play()
            return
          }
          if (live && error.errorCode == PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW) {
            player.seekToDefaultPosition()
            player.prepare()
            return
          }
          if (reconnectLive()) return
          titleView?.text = getString(R.string.theater_error)
          setControlsShown(true)
        }
      }

  /**
   * The film is "playing" from the moment the viewer wants it to, buffering included, so the lights
   * don't flicker up on every stall. Pause, the system menu and the end bring them back up.
   */
  private fun onFilmStateChanged() {
    val player = player ?: return
    val playing = player.playWhenReady && player.playbackState != Player.STATE_ENDED
    ambience.setFilmPlaying(playing)
    if (playing) scheduleHide() else setControlsShown(true)
    updateControls()
  }

  /** Letterbox or pillarbox the screen to the film instead of stretching it. */
  private fun fitScreen(size: VideoSize) {
    if (size.width == 0 || size.height == 0) return
    val video = size.width * size.pixelWidthHeightRatio / size.height
    val frame = SCREEN_WIDTH / SCREEN_HEIGHT
    val scale = if (video > frame) Vector3(1f, frame / video, 1f) else Vector3(video / frame, 1f, 1f)
    screen?.setComponent(Scale(scale))
  }

  /** Where the viewer is in the film, not in the stream. Live has no position to keep. */
  private fun filmPositionMs(): Long =
      if (live) 0L else (player?.currentPosition ?: 0L) + streamOffsetMs

  private fun filmDurationMs(): Long {
    val streamDuration = player?.duration?.takeIf { it > 0 } ?: 0L
    return max(knownDurationMs, streamDuration + streamOffsetMs)
  }

  private fun seekToFilm(positionMs: Long) {
    val target = (positionMs - streamOffsetMs).coerceAtLeast(0L)
    player?.seekTo(target)
    updateControls()
  }

  // ---- Controls ----

  private fun bindControls(root: View) {
    controlsRoot = root
    titleView = root.findViewById<TextView>(R.id.theater_title).apply { text = title }
    timeView = root.findViewById(R.id.theater_time)
    playPauseButton =
        root.findViewById<ImageButton>(R.id.theater_play_pause).apply {
          setOnClickListener { interact { player?.let { it.playWhenReady = !it.playWhenReady } } }
        }
    root.findViewById<View>(R.id.theater_skip_back).apply {
      setOnClickListener { interact { seekToFilm(filmPositionMs() - SKIP_BACK_MS) } }
      visibility = if (live) View.GONE else View.VISIBLE
    }
    root.findViewById<View>(R.id.theater_skip_forward).apply {
      setOnClickListener { interact { seekToFilm(filmPositionMs() + SKIP_FORWARD_MS) } }
      visibility = if (live) View.GONE else View.VISIBLE
    }
    root.findViewById<View>(R.id.theater_environments_button).setOnClickListener {
      interact { setPickerOpen(!pickerOpen) }
    }
    root.findViewById<View>(R.id.theater_back).setOnClickListener { leave(ended = false) }

    seekBar =
        root.findViewById<SeekBar>(R.id.theater_seek).apply {
          // A live channel has no timeline to move along.
          visibility = if (live) View.INVISIBLE else View.VISIBLE
          max = 1000
          setOnSeekBarChangeListener(
              object : SeekBar.OnSeekBarChangeListener {
                override fun onProgressChanged(bar: SeekBar, progress: Int, fromUser: Boolean) {
                  if (fromUser) timeView?.text = timeLabel(progressToMs(progress))
                }

                override fun onStartTrackingTouch(bar: SeekBar) {
                  seeking = true
                  handler.removeCallbacks(hideControls)
                }

                override fun onStopTrackingTouch(bar: SeekBar) {
                  seeking = false
                  interact { seekToFilm(progressToMs(bar.progress)) }
                }
              })
        }
    keepAwakeWhileAimedAt(root)
    updateControls()
  }

  private fun bindPicker(root: View) {
    pickerRoot = root
    root.alpha = 0f
    val list = root.findViewById<ViewGroup>(R.id.theater_environment_list)
    val inflater = LayoutInflater.from(root.context)
    val radius = 16 * root.resources.displayMetrics.density
    for (env in TheaterEnvironment.all) {
      val card = inflater.inflate(R.layout.theater_environment_card, list, false)
      card.findViewById<ImageView>(R.id.theater_environment_image).apply {
        setImageResource(env.thumbnail)
        outlineProvider =
            object : ViewOutlineProvider() {
              override fun getOutline(view: View, outline: Outline) =
                  outline.setRoundRect(0, 0, view.width, view.height, radius)
            }
        clipToOutline = true
      }
      card.findViewById<TextView>(R.id.theater_environment_name).setText(env.name)
      card.findViewById<TextView>(R.id.theater_environment_hint).setText(env.hint)
      card.setOnClickListener {
        interact {
          selectEnvironment(env)
          // Let the choice register before the picker steps away.
          handler.postDelayed({ setPickerOpen(false) }, 450)
        }
      }
      // Four equal columns; the cards wrap into rows.
      val margin = (8 * root.resources.displayMetrics.density).toInt()
      card.layoutParams =
          GridLayout.LayoutParams(
                  GridLayout.spec(GridLayout.UNDEFINED),
                  GridLayout.spec(GridLayout.UNDEFINED, 1f),
              )
              .apply {
                width = 0
                setMargins(margin, margin, margin, margin)
              }
      list.addView(card)
      environmentCards[env.key] = card
    }
    keepAwakeWhileAimedAt(root)
    updateEnvironmentCards()
  }

  /** Aiming at a panel counts as using it: the controls stay while the viewer is there. */
  private fun keepAwakeWhileAimedAt(root: View) {
    root.setOnHoverListener { _, event ->
      if (event.action != MotionEvent.ACTION_HOVER_EXIT) {
        handler.removeCallbacks(hideControls)
      } else {
        scheduleHide()
      }
      false
    }
  }

  private inline fun interact(action: () -> Unit) {
    action()
    setControlsShown(true)
  }

  private fun scheduleHide() {
    handler.removeCallbacks(hideControls)
    val playing = player?.playWhenReady == true && player?.playbackState != Player.STATE_ENDED
    if (playing && !pickerOpen && !seeking) handler.postDelayed(hideControls, CONTROLS_HIDE_MS)
  }

  private fun setControlsShown(shown: Boolean) {
    if (shown) scheduleHide() else handler.removeCallbacks(hideControls)
    if (shown == controlsShown) return
    controlsShown = shown
    if (!shown) setPickerOpen(false)
    fade(controlsEntity, controlsRoot, shown)
  }

  private fun setPickerOpen(open: Boolean) {
    if (open == pickerOpen) return
    pickerOpen = open
    fade(pickerEntity, pickerRoot, open)
    scheduleHide()
  }

  /** Fade a panel's view, and only then take it out of the scene (and out of reach of the ray). */
  private fun fade(entity: Entity?, root: View?, shown: Boolean) {
    if (shown) entity?.setComponent(Visible(true))
    val view = root ?: return entity?.setComponent(Visible(shown)).let {}
    view.animate().cancel()
    view
        .animate()
        .alpha(if (shown) 1f else 0f)
        .setDuration(FADE_MS)
        .withEndAction { if (!shown) entity?.setComponent(Visible(false)) }
        .start()
  }

  private fun progressToMs(progress: Int) = filmDurationMs() * progress / 1000

  private fun updateControls() {
    val player = player ?: return
    val wantsToPlay = player.playWhenReady && player.playbackState != Player.STATE_ENDED
    playPauseButton?.apply {
      setImageResource(
          if (wantsToPlay) R.drawable.theater_icon_pause else R.drawable.theater_icon_play)
      contentDescription =
          getString(if (wantsToPlay) R.string.theater_pause else R.string.theater_play)
    }
    if (live) {
      timeView?.text = getString(R.string.theater_live)
      return
    }
    if (seeking) return
    val duration = filmDurationMs()
    val position = filmPositionMs()
    timeView?.text = timeLabel(position)
    if (duration > 0) seekBar?.progress = (position * 1000 / duration).toInt()
  }

  private fun timeLabel(positionMs: Long): String {
    val duration = filmDurationMs()
    return if (duration > 0) "${formatTime(positionMs)} / ${formatTime(duration)}"
    else formatTime(positionMs)
  }

  private fun formatTime(ms: Long): String {
    val total = ms / 1000
    val h = total / 3600
    val m = (total % 3600) / 60
    val s = total % 60
    return if (h > 0) String.format(Locale.ROOT, "%d:%02d:%02d", h, m, s)
    else String.format(Locale.ROOT, "%d:%02d", m, s)
  }

  // ---- Environments ----

  private fun selectEnvironment(env: TheaterEnvironment) {
    environment = env
    getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .edit()
        .putString(PREF_ENVIRONMENT, env.key)
        .apply()
    applyEnvironment(env)
    updateEnvironmentCards()
  }

  private fun applyEnvironment(env: TheaterEnvironment) {
    val generation = ++environmentGeneration
    // Passthrough only shows where nothing is drawn, so there is no sky at all.
    scene.enablePassthrough(env.passthrough)

    seat?.destroy()
    seat =
        env.seat?.let {
          Entity.create(
              listOf(
                  Mesh("apk:///$it".toUri()),
                  Transform(Pose(Vector3(0f), Quaternion(0f, SEAT_YAW, 0f))),
              ),
          )
        }
    ambience.setEnvironment(env)

    val images = listOfNotNull(env.sky) + env.layers.map { it.texture }
    if (images.isEmpty()) {
      showSkies(emptyList())
      return
    }
    // Panoramas are large; decode them off the main thread, then swap them in at once.
    decoder.execute {
      val bitmaps = images.map { TheaterSky.decode(resources, it) }
      handler.post {
        if (generation != environmentGeneration || leaving) return@post
        showSkies(
            bitmaps.mapIndexed { i, bitmap ->
              TheaterSky.create(scene, systemManager, bitmap, SKY_YAW, layer = i)
            })
        ambience.redraw()
      }
    }
  }

  private fun showSkies(next: List<TheaterSky>) {
    skies.forEach { it.destroy() }
    skies = next
  }

  /** One frame of the environment's lights: the sky, each light layer, and the seat's light. */
  private fun renderLights(skyLevel: Float, layers: FloatArray, lightsUp: Float) {
    val env = environment
    val offset = if (env.sky != null) 1 else 0
    if (offset == 1) skies.getOrNull(0)?.setLevel(skyLevel)
    layers.forEachIndexed { i, level -> skies.getOrNull(i + offset)?.setLevel(level) }
    val dim = 0.12f + 0.88f * lightsUp
    val light = env.seatLight
    scene.setLightingEnvironment(
        ambientColor = Vector3(light[0] * dim, light[1] * dim, light[2] * dim),
        sunColor = Vector3(0f),
        sunDirection = -Vector3(1f, 3f, 2f),
        environmentIntensity = 0.15f * dim,
    )
  }

  private fun updateEnvironmentCards() {
    environmentCards.forEach { (key, card) ->
      val selected = key == environment.key
      card.isSelected = selected
      card.findViewById<View>(R.id.theater_environment_check).visibility =
          if (selected) View.VISIBLE else View.GONE
    }
  }

  // ---- Lifecycle ----

  /** Any controller button (or a pinch) brings the hidden controls back. */
  private inner class WakeControlsSystem : SystemBase() {
    private val wakeButtons =
        ButtonBits.ButtonA or
            ButtonBits.ButtonB or
            ButtonBits.ButtonX or
            ButtonBits.ButtonY or
            ButtonBits.ButtonTriggerL or
            ButtonBits.ButtonTriggerR or
            ButtonBits.ButtonThumbLClick or
            ButtonBits.ButtonThumbRClick

    override fun execute() {
      if (controlsShown) return
      val pressed =
          Query.where { has(Controller.id) }
              .eval()
              .any { entity ->
                val controller = entity.getComponent<Controller>()
                controller.isActive &&
                    (controller.changedButtons and controller.buttonState and wakeButtons) != 0
              }
      if (pressed) handler.post { setControlsShown(true) }
    }
  }

  // The Universal Menu (Meta button) takes focus: pause, and resume after.
  override fun onSessionStateChanged(state: SessionState) {
    super.onSessionStateChanged(state)
    when (state) {
      SessionState.VISIBLE -> {
        wasPlayingBeforeMenu = player?.playWhenReady == true
        player?.pause()
      }
      SessionState.FOCUSED -> if (wasPlayingBeforeMenu) player?.play()
      else -> Unit
    }
  }

  @Deprecated("Back on the controller leaves the theater")
  override fun onBackPressed() {
    leave(ended = false)
  }

  /**
   * Back to the 2D panel, Meta's way for hybrid apps: open Home with a pending intent for the panel
   * activity. Finishing on its own can leave the panel hidden.
   */
  private fun leave(ended: Boolean) {
    if (leaving) return
    leaving = true
    handler.removeCallbacksAndMessages(null)
    val position = if (ended) filmDurationMs() else filmPositionMs()
    player?.release()
    player = null
    ambience.release()

    val panelIntent =
        Intent(applicationContext, MainActivity::class.java).apply {
          action = ACTION_CLOSED
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          putExtra(EXTRA_ITEM_ID, itemId)
          putExtra(EXTRA_POSITION_MS, position)
          putExtra(EXTRA_ENDED, ended)
        }
    val pendingPanelIntent =
        PendingIntent.getActivity(
            applicationContext,
            0,
            panelIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    startActivity(
        Intent(Intent.ACTION_MAIN)
            .addCategory(Intent.CATEGORY_HOME)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            .putExtra("extra_launch_in_home_pending_intent", pendingPanelIntent))
    finish()
  }

  override fun onDestroy() {
    handler.removeCallbacksAndMessages(null)
    player?.release()
    player = null
    if (!leaving && ::ambience.isInitialized) ambience.release()
    decoder.shutdownNow()
    super.onDestroy()
  }
}
