package dev.getcoral.aurora

import android.animation.ValueAnimator
import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.animation.AccelerateDecelerateInterpolator
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer

/**
 * How an environment reacts to the film, like a cinema does. When the film starts the lights go
 * down and the room hushes; on pause, in the system menu or at the end, the lights come back up and
 * the ambience returns. Light layers with a [LightMotion] keep moving all the while (a fire flickers
 * even during the film).
 *
 * [render] gets, on every frame that changes something: the sky's brightness, each light layer's
 * strength (in [TheaterEnvironment.layers] order) and how far the lights are up (0..1).
 */
class TheaterAmbience(
    private val context: Context,
    private val render: (sky: Float, layers: FloatArray, lightsUp: Float) -> Unit,
) {

  private companion object {
    const val LIGHTS_MS = 2_200L
    const val SOUND_MS = 1_400L
    const val FRAME_MS = 50L // 20 updates a second is plenty for light
  }

  private var environment: TheaterEnvironment? = null
  private var filmPlaying = false
  /** 0 = lights down (film), 1 = lights up. */
  private var lightsUp = 1f
  private var soundLevel = 0f
  private var lightsAnimator: ValueAnimator? = null
  private var soundAnimator: ValueAnimator? = null
  private val handler = Handler(Looper.getMainLooper())
  private val started = SystemClock.uptimeMillis()

  private val frame =
      object : Runnable {
        override fun run() {
          draw()
          if (environment?.layers?.any { it.motion != LightMotion.STEADY } == true) {
            handler.postDelayed(this, FRAME_MS)
          }
        }
      }

  private val sound: ExoPlayer =
      ExoPlayer.Builder(context).build().apply {
        repeatMode = Player.REPEAT_MODE_ONE
        volume = 0f
        // Background sound: never take audio focus from the film.
        setAudioAttributes(
            AudioAttributes.Builder()
                .setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_UNKNOWN)
                .build(),
            false,
        )
      }

  /** Switch to [env]; the lights stay where they are, the sound follows. */
  fun setEnvironment(env: TheaterEnvironment) {
    val previous = environment
    environment = env
    if (previous?.ambience != env.ambience) {
      sound.stop()
      sound.clearMediaItems()
      soundLevel = 0f
      sound.volume = 0f
      env.ambience?.let {
        sound.setMediaItem(
            MediaItem.fromUri(Uri.parse("android.resource://${context.packageName}/$it")))
        sound.prepare()
      }
    }
    fadeSound()
    handler.removeCallbacks(frame)
    frame.run()
  }

  /** The film started (true) or stopped, paused or ended (false). */
  fun setFilmPlaying(playing: Boolean) {
    if (playing == filmPlaying) return
    filmPlaying = playing
    fadeLights()
    fadeSound()
  }

  /** Draw the current state again (new skies came in). */
  fun redraw() = draw()

  private fun draw() {
    val env = environment ?: return
    val t = (SystemClock.uptimeMillis() - started) / 1000.0
    val sky = env.lightsDown + (env.lightsUp - env.lightsDown) * lightsUp
    val layers =
        FloatArray(env.layers.size) { i ->
          val layer = env.layers[i]
          (layer.down + (layer.up - layer.down) * lightsUp) * layer.motion.at(t)
        }
    render(sky, layers, lightsUp)
  }

  private fun fadeLights() {
    lightsAnimator?.cancel()
    lightsAnimator =
        ValueAnimator.ofFloat(lightsUp, if (filmPlaying) 0f else 1f).apply {
          duration = LIGHTS_MS
          interpolator = AccelerateDecelerateInterpolator()
          addUpdateListener {
            lightsUp = it.animatedValue as Float
            draw()
          }
          start()
        }
  }

  private fun fadeSound() {
    val env = environment ?: return
    val goal = if (filmPlaying || env.ambience == null) 0f else env.ambienceVolume
    soundAnimator?.cancel()
    if (goal > 0f) sound.play()
    soundAnimator =
        ValueAnimator.ofFloat(soundLevel, goal).apply {
          duration = SOUND_MS
          addUpdateListener {
            soundLevel = it.animatedValue as Float
            sound.volume = soundLevel
            if (soundLevel == 0f && goal == 0f) sound.pause()
          }
          start()
        }
  }

  fun release() {
    handler.removeCallbacks(frame)
    lightsAnimator?.cancel()
    soundAnimator?.cancel()
    sound.release()
  }
}
