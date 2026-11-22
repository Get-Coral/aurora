package dev.getcoral.aurora

import androidx.annotation.DrawableRes
import androidx.annotation.RawRes
import androidx.annotation.StringRes
import kotlin.math.PI
import kotlin.math.sin

/**
 * A place to watch in. Adding one is an entry here plus its assets, made by scripts/quest:
 * - a 360° sky (an equirectangular image) of the room with its light layers off,
 * - light layers: what each group of lights adds, drawn on top additively,
 * - the viewer's seat and the floor around it, a glTF model in assets/theater/,
 * - a thumbnail for the picker, and optionally an ambient sound loop.
 *
 * Environments react to the film like a cinema: while it plays the lights go down and the ambience
 * fades out; on pause, in the system menu or at the end they come back up.
 *
 * Environments are original and genre-inspired: they borrow a mood (a classic cinema, a night sky,
 * a starship's deck), never a franchise's names, places, props or symbols.
 */
data class TheaterEnvironment(
    val key: String,
    @StringRes val name: Int,
    @StringRes val hint: Int,
    @DrawableRes val thumbnail: Int,
    /** The room around the viewer; null shows the viewer's own room (passthrough). */
    @DrawableRes val sky: Int? = null,
    val layers: List<LightLayer> = emptyList(),
    /** The viewer's seat, an asset path such as "theater/grand_theater.glb". */
    val seat: String? = null,
    /** Played softly while the film isn't playing. */
    @RawRes val ambience: Int? = null,
    /** Sky brightness while the film isn't playing, 0..1. */
    val lightsUp: Float = 1f,
    /** Sky brightness while it plays, 0..1. */
    val lightsDown: Float = 0.5f,
    /** Ambience volume at full, 0..1. */
    val ambienceVolume: Float = 0.5f,
    /** Light on the seat model (RGB, linear) with the lights up; it dims with them. */
    val seatLight: FloatArray = floatArrayOf(0.8f, 0.7f, 0.6f),
) {
  val passthrough: Boolean
    get() = sky == null

  companion object {
    val all =
        listOf(
            TheaterEnvironment(
                key = "grand_theater",
                name = R.string.theater_env_grand_theater,
                hint = R.string.theater_env_grand_theater_hint,
                thumbnail = R.drawable.theater_grand_theater_thumb,
                sky = R.drawable.theater_grand_theater,
                layers =
                    listOf(
                        LightLayer(R.drawable.theater_grand_theater_house, up = 1f, down = 0.04f),
                    ),
                seat = "theater/grand_theater.glb",
                ambience = R.raw.theater_ambience_grand_theater,
                lightsUp = 1f,
                lightsDown = 1f,
                ambienceVolume = 0.35f,
                seatLight = floatArrayOf(1.1f, 0.8f, 0.6f),
            ),
            TheaterEnvironment(
                key = "orbital_deck",
                name = R.string.theater_env_orbital_deck,
                hint = R.string.theater_env_orbital_deck_hint,
                thumbnail = R.drawable.theater_orbital_deck_thumb,
                sky = R.drawable.theater_orbital_deck,
                layers =
                    listOf(
                        LightLayer(R.drawable.theater_orbital_deck_deck, up = 1f, down = 0.05f),
                        LightLayer(
                            R.drawable.theater_orbital_deck_holo,
                            up = 1f,
                            down = 0.65f,
                            motion = LightMotion.SHIMMER,
                        ),
                    ),
                seat = "theater/orbital_deck.glb",
                ambience = R.raw.theater_ambience_orbital_deck,
                lightsUp = 1f,
                lightsDown = 1f,
                ambienceVolume = 0.4f,
                seatLight = floatArrayOf(0.5f, 0.6f, 0.85f),
            ),
            TheaterEnvironment(
                key = "sentinel_hq",
                name = R.string.theater_env_sentinel_hq,
                hint = R.string.theater_env_sentinel_hq_hint,
                thumbnail = R.drawable.theater_sentinel_hq_thumb,
                sky = R.drawable.theater_sentinel_hq,
                layers =
                    listOf(
                        LightLayer(R.drawable.theater_sentinel_hq_room, up = 1f, down = 0.05f),
                        LightLayer(
                            R.drawable.theater_sentinel_hq_displays,
                            up = 1f,
                            down = 0.55f,
                            motion = LightMotion.SHIMMER,
                        ),
                    ),
                seat = "theater/sentinel_hq.glb",
                ambience = R.raw.theater_ambience_sentinel_hq,
                lightsUp = 1f,
                lightsDown = 1f,
                ambienceVolume = 0.4f,
                seatLight = floatArrayOf(0.7f, 0.76f, 0.9f),
            ),
            TheaterEnvironment(
                key = "arcane_library",
                name = R.string.theater_env_arcane_library,
                hint = R.string.theater_env_arcane_library_hint,
                thumbnail = R.drawable.theater_arcane_library_thumb,
                sky = R.drawable.theater_arcane_library,
                layers =
                    listOf(
                        LightLayer(
                            R.drawable.theater_arcane_library_candles,
                            up = 1f,
                            down = 0.25f,
                            motion = LightMotion.FLICKER,
                        ),
                        // The fire keeps burning through the film, just lower.
                        LightLayer(
                            R.drawable.theater_arcane_library_fire,
                            up = 1f,
                            down = 0.7f,
                            motion = LightMotion.FLICKER,
                        ),
                        LightLayer(
                            R.drawable.theater_arcane_library_runes,
                            up = 1f,
                            down = 0.3f,
                            motion = LightMotion.SHIMMER,
                        ),
                    ),
                seat = "theater/arcane_library.glb",
                ambience = R.raw.theater_ambience_arcane_library,
                lightsUp = 1f,
                lightsDown = 1f,
                ambienceVolume = 0.45f,
                seatLight = floatArrayOf(0.6f, 0.47f, 0.36f),
            ),
            TheaterEnvironment(
                key = "biolume_grove",
                name = R.string.theater_env_biolume_grove,
                hint = R.string.theater_env_biolume_grove_hint,
                thumbnail = R.drawable.theater_biolume_grove_thumb,
                sky = R.drawable.theater_biolume_grove,
                layers =
                    listOf(
                        // The plants breathe, and stay softly lit through the film.
                        LightLayer(
                            R.drawable.theater_biolume_grove_glow,
                            up = 1f,
                            down = 0.6f,
                            motion = LightMotion.PULSE,
                        ),
                        LightLayer(
                            R.drawable.theater_biolume_grove_motes,
                            up = 1f,
                            down = 0.5f,
                            motion = LightMotion.SHIMMER,
                        ),
                    ),
                seat = "theater/biolume_grove.glb",
                ambience = R.raw.theater_ambience_biolume_grove,
                lightsUp = 1f,
                lightsDown = 1f,
                ambienceVolume = 0.4f,
                seatLight = floatArrayOf(0.45f, 0.6f, 0.75f),
            ),
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
                seatLight = floatArrayOf(0.35f, 0.6f, 0.55f),
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

/**
 * A group of lights in an environment (sconces, a fireplace, glowing plants), drawn additively over
 * the sky. [up] is its strength while the film isn't playing, [down] while it plays; [motion] makes
 * it live (a fire flickers, plants breathe).
 */
data class LightLayer(
    @DrawableRes val texture: Int,
    val up: Float = 1f,
    val down: Float = 0f,
    val motion: LightMotion = LightMotion.STEADY,
)

enum class LightMotion {
  STEADY,
  /** Fire and candles: quick, irregular. */
  FLICKER,
  /** Bioluminescence: a slow breath. */
  PULSE,
  /** Holograms and displays: a faint shimmer. */
  SHIMMER;

  /** A multiplier around 1 at time [t] in seconds. */
  fun at(t: Double): Float =
      when (this) {
        STEADY -> 1f
        FLICKER ->
            (0.84 +
                    0.07 * sin(t * 2 * PI * 7.3) +
                    0.05 * sin(t * 2 * PI * 11.9 + 1.3) +
                    0.04 * sin(t * 2 * PI * 2.1 + 0.4))
                .toFloat()
        PULSE -> (0.72 + 0.28 * (0.5 + 0.5 * sin(t * 2 * PI / 6.5))).toFloat()
        SHIMMER -> (0.9 + 0.06 * sin(t * 2 * PI * 0.8) + 0.04 * sin(t * 2 * PI * 3.1)).toFloat()
      }
}
