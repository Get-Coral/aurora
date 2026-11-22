package dev.getcoral.aurora

import android.animation.ValueAnimator
import android.content.Context
import android.net.Uri
import android.view.animation.AccelerateDecelerateInterpolator
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer

/**
 * How an environment reacts to the film, like a cinema does. When the film starts the lights go
 * down and the room hushes; on pause, in the system menu or at the end, the lights come back up and
 * the ambience returns.
 *
 * [setSkyLevel] gets the sky brightness (0..1) on every animation frame.
 */
class TheaterAmbience(private val context: Context, private val setSkyLevel: (Float) -> Unit) {

  private companion object {
    const val LIGHTS_MS = 1_800L
    const val SOUND_MS = 1_400L
  }

  private var environment: TheaterEnvironment? = null
  private var filmPlaying = false
  private var skyLevel = 1f
  private var soundLevel = 0f
  private var lightsAnimator: ValueAnimator? = null
  private var soundAnimator: ValueAnimator? = null

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

  /** Switch to [env]; the lights jump straight to where they should be. */
  fun setEnvironment(env: TheaterEnvironment) {
    val previous = environment
    environment = env
    lightsAnimator?.cancel()
    skyLevel = target(env)
    setSkyLevel(skyLevel)
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
  }

  /** The film started (true) or stopped, paused or ended (false). */
  fun setFilmPlaying(playing: Boolean) {
    if (playing == filmPlaying) return
    filmPlaying = playing
    fadeLights()
    fadeSound()
  }

  private fun target(env: TheaterEnvironment) = if (filmPlaying) env.lightsDown else env.lightsUp

  private fun fadeLights() {
    val env = environment ?: return
    if (env.passthrough) return
    lightsAnimator?.cancel()
    lightsAnimator =
        ValueAnimator.ofFloat(skyLevel, target(env)).apply {
          duration = LIGHTS_MS
          interpolator = AccelerateDecelerateInterpolator()
          addUpdateListener {
            skyLevel = it.animatedValue as Float
            setSkyLevel(skyLevel)
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
    lightsAnimator?.cancel()
    soundAnimator?.cancel()
    sound.release()
  }
}
