package dev.getcoral.aurora

import android.content.Context
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.RenderersFactory

/**
 * Renderers for Aurora's native players. The device's own decoders come first, so a TV or headset
 * with a Dolby decoder (or HDMI passthrough to a receiver) keeps using it. Audio the device can't
 * decode (AC3 / E-AC3 / DTS / TrueHD on most phones) falls back to FFmpeg's decoders from
 * `org.jellyfin.media3:media3-ffmpeg-decoder` instead of playing without sound.
 */
@OptIn(UnstableApi::class)
fun auroraRenderers(context: Context): RenderersFactory =
    DefaultRenderersFactory(context)
        .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_ON)
        .setEnableDecoderFallback(true)
