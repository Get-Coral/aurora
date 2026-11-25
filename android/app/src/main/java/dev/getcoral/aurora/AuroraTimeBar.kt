package dev.getcoral.aurora

import android.content.Context
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import android.os.Handler
import android.os.Looper
import android.util.AttributeSet
import android.view.KeyEvent
import android.view.View
import androidx.core.content.ContextCompat
import androidx.media3.common.util.UnstableApi
import androidx.media3.ui.TimeBar
import java.util.concurrent.CopyOnWriteArraySet

/**
 * The web player's progress bar (.player-progress in src/styles.css) for the native TV player: a
 * thin track with the accent-to-warm gradient, thicker with a white thumb while focused.
 *
 * With focus, Left and Right scrub in steps that grow while the key is held; the seek lands once
 * the viewer lets go for a moment or presses OK, like the remote does in the web player.
 */
@UnstableApi
class AuroraTimeBar
@JvmOverloads
constructor(context: Context, attrs: AttributeSet? = null) : View(context, attrs), TimeBar {

  private companion object {
    const val COMMIT_DELAY_MS = 900L
  }

  private val density = resources.displayMetrics.density
  private val trackHeight = 5f * density
  private val focusedTrackHeight = 7f * density
  private val thumbRadius = 8f * density

  private val trackPaint =
      Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = ContextCompat.getColor(context, R.color.aurora_track)
      }
  private val bufferedPaint =
      Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = ContextCompat.getColor(context, R.color.aurora_buffered)
      }
  private val playedPaint = Paint(Paint.ANTI_ALIAS_FLAG)
  private val thumbPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFFFFFFFF.toInt() }
  private val accent = ContextCompat.getColor(context, R.color.aurora_accent)
  private val accentWarm = ContextCompat.getColor(context, R.color.aurora_accent_warm)
  private var gradientEnd = -1f

  private val listeners = CopyOnWriteArraySet<TimeBar.OnScrubListener>()
  private val handler = Handler(Looper.getMainLooper())
  private val commit = Runnable { stopScrubbing(canceled = false) }
  private val rect = RectF()

  private var duration = 0L
  private var position = 0L
  private var bufferedPosition = 0L
  private var scrubbing = false
  private var scrubPosition = 0L

  init {
    isFocusable = true
  }

  override fun addListener(listener: TimeBar.OnScrubListener) {
    listeners.add(listener)
  }

  override fun removeListener(listener: TimeBar.OnScrubListener) {
    listeners.remove(listener)
  }

  override fun setKeyTimeIncrement(time: Long) = Unit

  override fun setKeyCountIncrement(count: Int) = Unit

  override fun setPosition(position: Long) {
    if (this.position == position) return
    this.position = position
    if (!scrubbing) invalidate()
  }

  override fun setBufferedPosition(bufferedPosition: Long) {
    if (this.bufferedPosition == bufferedPosition) return
    this.bufferedPosition = bufferedPosition
    invalidate()
  }

  override fun setDuration(duration: Long) {
    if (this.duration == duration) return
    this.duration = duration
    if (scrubbing && duration <= 0) stopScrubbing(canceled = true)
    invalidate()
  }

  override fun getPreferredUpdateDelay(): Long {
    val pixels = (width / density).toLong()
    return if (pixels == 0L || duration <= 0) Long.MAX_VALUE else duration / pixels
  }

  override fun setAdGroupTimesMs(adGroupTimesMs: LongArray?, playedAdGroups: BooleanArray?, adGroupCount: Int) =
      Unit

  override fun setEnabled(enabled: Boolean) {
    super.setEnabled(enabled)
    if (scrubbing && !enabled) stopScrubbing(canceled = true)
  }

  // ---- Remote ----

  /** Bigger steps the longer Left or Right is held: 10 s, then 30 s, then a minute. */
  private fun stepFor(repeatCount: Int) =
      when {
        repeatCount < 6 -> 10_000L
        repeatCount < 20 -> 30_000L
        else -> 60_000L
      }

  override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
    if (isEnabled && duration > 0) {
      val step =
          when (keyCode) {
            KeyEvent.KEYCODE_DPAD_LEFT -> -stepFor(event.repeatCount)
            KeyEvent.KEYCODE_DPAD_RIGHT -> stepFor(event.repeatCount)
            else -> 0L
          }
      if (step != 0L) {
        if (!scrubbing) startScrubbing()
        scrubTo(scrubPosition + step)
        handler.removeCallbacks(commit)
        handler.postDelayed(commit, COMMIT_DELAY_MS)
        return true
      }
      if (scrubbing && (keyCode == KeyEvent.KEYCODE_DPAD_CENTER || keyCode == KeyEvent.KEYCODE_ENTER)) {
        handler.removeCallbacks(commit)
        stopScrubbing(canceled = false)
        return true
      }
    }
    return super.onKeyDown(keyCode, event)
  }

  override fun onFocusChanged(gainFocus: Boolean, direction: Int, previouslyFocusedRect: android.graphics.Rect?) {
    super.onFocusChanged(gainFocus, direction, previouslyFocusedRect)
    if (!gainFocus && scrubbing) {
      handler.removeCallbacks(commit)
      stopScrubbing(canceled = false)
    }
    invalidate()
  }

  override fun onDetachedFromWindow() {
    handler.removeCallbacks(commit)
    super.onDetachedFromWindow()
  }

  private fun startScrubbing() {
    scrubbing = true
    scrubPosition = position
    parent?.requestDisallowInterceptTouchEvent(true)
    for (listener in listeners) listener.onScrubStart(this, scrubPosition)
  }

  private fun scrubTo(target: Long) {
    scrubPosition = target.coerceIn(0L, duration)
    for (listener in listeners) listener.onScrubMove(this, scrubPosition)
    invalidate()
  }

  private fun stopScrubbing(canceled: Boolean) {
    if (!scrubbing) return
    scrubbing = false
    position = scrubPosition
    for (listener in listeners) listener.onScrubStop(this, scrubPosition, canceled)
    invalidate()
  }

  // ---- Drawing ----

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    val emphasised = isFocused || scrubbing
    val height = if (emphasised) focusedTrackHeight else trackHeight
    val left = paddingLeft + thumbRadius
    val right = width - paddingRight - thumbRadius
    val top = (this.height - height) / 2f
    val bottom = top + height
    val radius = height / 2f
    val span = right - left
    if (span <= 0f) return

    rect.set(left, top, right, bottom)
    canvas.drawRoundRect(rect, radius, radius, trackPaint)
    if (duration <= 0) return

    val buffered = left + span * (bufferedPosition.toFloat() / duration).coerceIn(0f, 1f)
    rect.set(left, top, buffered, bottom)
    canvas.drawRoundRect(rect, radius, radius, bufferedPaint)

    val shown = if (scrubbing) scrubPosition else position
    val played = left + span * (shown.toFloat() / duration).coerceIn(0f, 1f)
    // Like .player-progress-fill: the gradient runs over the played part, not the whole track.
    if (played - left > 1f && gradientEnd != played) {
      gradientEnd = played
      playedPaint.shader =
          LinearGradient(left, 0f, played, 0f, accent, accentWarm, Shader.TileMode.CLAMP)
    }
    rect.set(left, top, played, bottom)
    canvas.drawRoundRect(rect, radius, radius, playedPaint)

    if (emphasised) canvas.drawCircle(played, this.height / 2f, thumbRadius, thumbPaint)
  }
}
