package dev.getcoral.aurora

import android.content.res.Resources
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import com.meta.spatial.core.Entity
import com.meta.spatial.core.Pose
import com.meta.spatial.core.Quaternion
import com.meta.spatial.core.SpatialSDKExperimentalAPI
import com.meta.spatial.core.SystemManager
import com.meta.spatial.core.Vector3
import com.meta.spatial.core.Vector4
import com.meta.spatial.runtime.AddressMode
import com.meta.spatial.runtime.BlendMode
import com.meta.spatial.runtime.DepthWrite
import com.meta.spatial.runtime.Filter
import com.meta.spatial.runtime.SamplerConfig
import com.meta.spatial.runtime.Scene
import com.meta.spatial.runtime.SceneMaterial
import com.meta.spatial.runtime.SceneMaterialAttribute
import com.meta.spatial.runtime.SceneMaterialDataType
import com.meta.spatial.runtime.SceneMesh
import com.meta.spatial.runtime.SceneObject
import com.meta.spatial.runtime.SceneTexture
import com.meta.spatial.runtime.SortOrder
import com.meta.spatial.toolkit.SceneObjectSystem
import com.meta.spatial.toolkit.Transform
import com.meta.spatial.toolkit.Visible
import java.util.concurrent.CompletableFuture

/**
 * One 360° sphere around the viewer: an environment's sky, or one of its light layers drawn on top
 * additively.
 *
 * Drawn with the app's own shader (src/quest/theater-shaders/theatersky.*), which multiplies the
 * image by a brightness the app sets every frame ([setLevel]). The SDK's stock materials can't do
 * that: their colour is ignored, or replaces the image, once there is a texture.
 *
 * Light layers sit on slightly smaller spheres, so they draw over the sky rather than fighting it
 * for depth.
 */
class TheaterSky
private constructor(
    val entity: Entity,
    private val material: SceneMaterial,
    private val texture: SceneTexture,
) {

  /** Brightness, 0..1 (multiplies the image; for a light layer, how strongly it adds). */
  fun setLevel(level: Float) {
    material.setAttribute(PARAMS, Vector4(level.coerceIn(0f, 4f), 0f, 0f, 0f))
  }

  fun setVisible(visible: Boolean) = entity.setComponent(Visible(visible))

  fun destroy() {
    entity.destroy()
    material.destroy()
    texture.destroy()
  }

  companion object {
    private const val SHADER = "theatersky"
    private const val PARAMS = "customParams"
    private const val SKY_RADIUS = 300f
    private const val LAYER_STEP = 8f

    // Linear filtering with mip levels: a sharp but calm image, without the shimmer of
    // nearest-neighbour sampling on fine detail.
    private val sampler =
        SamplerConfig(
            Filter.LINEAR,
            Filter.LINEAR,
            Filter.LINEAR,
            AddressMode.REPEAT,
            AddressMode.CLAMP_TO_EDGE,
            0f,
        )

    /** Panoramas are large: decode them off the main thread. */
    fun decode(resources: Resources, drawable: Int): Bitmap =
        BitmapFactory.decodeResource(
            resources,
            drawable,
            BitmapFactory.Options().apply {
              inScaled = false
              inPreferredConfig = Bitmap.Config.ARGB_8888
            },
        )

    /** @param layer 0 for the sky itself, 1.. for its light layers (drawn additively, in order). */
    @OptIn(SpatialSDKExperimentalAPI::class)
    fun create(
        scene: Scene,
        systems: SystemManager,
        bitmap: Bitmap,
        yawDegrees: Float,
        layer: Int,
    ): TheaterSky {
      val additive = layer > 0
      val texture = SceneTexture(bitmap, sampler)
      val material =
          SceneMaterial.custom(
                  SHADER,
                  arrayOf(
                      SceneMaterialAttribute("albedoSampler", SceneMaterialDataType.Texture2D),
                      SceneMaterialAttribute("stereoParams", SceneMaterialDataType.Vector4),
                      SceneMaterialAttribute(PARAMS, SceneMaterialDataType.Vector4),
                  ),
              )
              .apply {
                setTexture("albedoSampler", texture)
                setAttribute(PARAMS, Vector4(if (additive) 0f else 1f, 0f, 0f, 0f))
                if (additive) {
                  setBlendMode(BlendMode.ADDITIVE)
                  setSortOrder(SortOrder.TRANSLUCENT)
                  setDepthWrite(DepthWrite.DISABLE)
                  setRenderOrder(layer)
                }
              }
      val entity =
          Entity.create(listOf(Transform(Pose(Vector3(0f), Quaternion(0f, yawDegrees, 0f)))))
      val sceneObject =
          SceneObject(
              scene,
              SceneMesh.skybox(SKY_RADIUS - layer * LAYER_STEP, material),
              if (additive) "light layer $layer" else "sky",
              entity,
          )
      systems
          .findSystem<SceneObjectSystem>()
          .addSceneObject(entity, CompletableFuture.completedFuture(sceneObject))
      return TheaterSky(entity, material, texture)
    }
  }
}
