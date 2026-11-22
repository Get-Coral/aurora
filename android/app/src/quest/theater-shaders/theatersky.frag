#version 400
#extension GL_ARB_separate_shader_objects : enable
#extension GL_ARB_shading_language_420pack : enable

// The Quest theater's sky, with a brightness the app sets every frame:
// customParams.x multiplies the image. The sky itself draws opaque; its light
// layers use the same shader with additive blending, so the brightness is how
// strongly each group of lights adds to the room.

#include <data/shaders/common.glsl>

layout (std140, set = 3, binding = 0) uniform MaterialUniform {
  vec4 stereoParams;
  vec4 customParams;
} g_MaterialUniform;

layout (set = 3, binding = 1) uniform sampler2D albedoSampler;

layout(location = 0) in struct {
  vec4 color;
  vec2 albedoCoord;
  vec2 roughnessMetallicCoord;
  vec2 emissiveCoord;
  vec2 occlusionCoord;
  vec2 normalCoord;
  vec3 lighting;
  vec3 worldNormal;
  vec3 worldPosition;
} vertexOut;

layout (location = 0) out vec4 outColor;

void main() {
  vec4 pixel = texture(albedoSampler, vertexOut.albedoCoord);
  float level = max(g_MaterialUniform.customParams.x, 0.0);
  outColor = vec4(pixel.rgb * level, 1.0);
}
