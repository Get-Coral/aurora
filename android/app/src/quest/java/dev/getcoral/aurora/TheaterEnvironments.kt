package dev.getcoral.aurora

import androidx.annotation.DrawableRes
import androidx.annotation.RawRes
import androidx.annotation.StringRes

/**
 * A place to watch in. Adding one is an entry here plus its assets: a 360° sky (an equirectangular
 * image), a thumbnail for the picker, and optionally an ambient sound loop.
 *
 * Environments react to the film: while it plays the lights go down ([lightsDown]) and the ambience
 * fades out; on pause, in the menu or at the end the lights come up ([lightsUp]) and it returns.
 *
 * Environments are original and genre-inspired. They borrow a mood (a classic cinema, a night sky),
 * never a franchise's names, places, props or symbols.
 */
data class TheaterEnvironment(
    val key: String,
    @StringRes val name: Int,
    @StringRes val hint: Int,
    @DrawableRes val thumbnail: Int,
    /** The sky around the viewer; null shows the viewer's own room (passthrough). */
    @DrawableRes val sky: Int? = null,
    /** Played softly while the film isn't playing. */
    @RawRes val ambience: Int? = null,
    /** Sky brightness while the film isn't playing, 0..1. */
    val lightsUp: Float = 1f,
    /** Sky brightness while it plays, 0..1. */
    val lightsDown: Float = 0.5f,
    /** Ambience volume at full, 0..1. */
    val ambienceVolume: Float = 0.5f,
) {
  val passthrough: Boolean
    get() = sky == null

  companion object {
    val all =
        listOf(
            TheaterEnvironment(
                key = "aurora",
                name = R.string.theater_env_aurora,
                hint = R.string.theater_env_aurora_hint,
                thumbnail = R.drawable.theater_aurora_thumb,
                sky = R.drawable.theater_aurora,
                ambience = R.raw.theater_ambience_northern_lights,
                lightsUp = 1f,
                lightsDown = 0.4f,
                ambienceVolume = 0.45f,
            ),
            TheaterEnvironment(
                key = "dark",
                name = R.string.theater_env_dark,
                hint = R.string.theater_env_dark_hint,
                thumbnail = R.drawable.theater_dark_thumb,
                sky = R.drawable.theater_dark,
                ambience = R.raw.theater_ambience_dark_room,
                lightsUp = 1f,
                lightsDown = 0.25f,
                ambienceVolume = 0.35f,
            ),
            TheaterEnvironment(
                key = "passthrough",
                name = R.string.theater_env_passthrough,
                hint = R.string.theater_env_passthrough_hint,
                thumbnail = R.drawable.theater_passthrough_thumb,
            ),
        )

    fun byKey(key: String?) = all.firstOrNull { it.key == key } ?: all.first()
  }
}
