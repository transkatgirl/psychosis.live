import type { ScalerCreationOptions } from "./resize";

export const vsSource = `#version 300 es
precision highp float;
precision highp int;
in highp vec2 a_position;
in highp vec2 a_texCoord;
out highp vec2 v_texCoord;
void main(){
	v_texCoord = a_texCoord;
	gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const fsHorizontal = `#version 300 es
precision highp float;
precision highp int;
in highp vec2 v_texCoord;
out highp vec4 outColor;

uniform sampler2D u_image;
uniform highp float u_textureWidth;
uniform highp float u_invTextureWidth;
uniform highp float u_scale;
uniform highp float u_radius;

const float PI = 3.141592653589793;

/* FILTER_FUNCTION */

void main(){
	float srcX = (v_texCoord.x * u_textureWidth);
	float left = srcX - u_radius;
	float right = srcX + u_radius;
	int start = int(floor(left));
	int end = int(ceil(right));

	float sum = 0.0;
	vec4 color = vec4(0.0);
	for(int i = start; i <= end; i++){
		float center = float(i) + 0.5;
		float texX = center * u_invTextureWidth;
		float weight = resizeFilter((center - srcX) * u_scale);
		vec4 sampleValue = texture(u_image, vec2(texX, v_texCoord.y));
		color += sampleValue * weight;
		sum += weight;
	}
	outColor = color / sum;
}`;

const fsVertical = `#version 300 es
precision highp float;
precision highp int;
in highp vec2 v_texCoord;
out highp vec4 outColor;

uniform sampler2D u_image;
uniform highp float u_textureHeight;
uniform highp float u_invTextureHeight;
uniform highp float u_scale;
uniform highp float u_radius;
const float PI = 3.141592653589793;

/* FILTER_FUNCTION */

void main(){
	float srcY = (v_texCoord.y * u_textureHeight);
	float top = srcY - u_radius;
	float bottom = srcY + u_radius;
	int start = int(floor(top));
	int end = int(ceil(bottom));

	float sum = 0.0;
	vec4 color = vec4(0.0);
	for(int j = start; j <= end; j++){
		float center = float(j) + 0.5;
		float texY = center * u_invTextureHeight;
		float weight = resizeFilter((center - srcY) * u_scale);
		vec4 sampleValue = texture(u_image, vec2(v_texCoord.x, texY));
		color += sampleValue * weight;
		sum += weight;
	}
	outColor = color / sum;
}`;

const fsHorizontalLinearize = `#version 300 es
precision highp float;
precision highp int;
in highp vec2 v_texCoord;
out highp vec4 outColor;

uniform sampler2D u_image;
uniform highp float u_textureWidth;
uniform highp float u_invTextureWidth;
uniform highp float u_scale;
uniform highp float u_radius;

const float PI = 3.141592653589793;

/* FILTER_FUNCTION */

vec3 sRGBToLinear(vec3 rgb)
{
  // See https://gamedev.stackexchange.com/questions/92015/optimized-linear-to-srgb-glsl
  return mix(pow((rgb + 0.055) * (1.0 / 1.055), vec3(2.4)),
             rgb * (1.0/12.92),
             lessThanEqual(rgb, vec3(0.04045)));
}

void main(){
	float srcX = (v_texCoord.x * u_textureWidth);
	float left = srcX - u_radius;
	float right = srcX + u_radius;
	int start = int(floor(left));
	int end = int(ceil(right));

	float sum = 0.0;
	vec4 color = vec4(0.0);
	for(int i = start; i <= end; i++){
		float center = float(i) + 0.5;
		float texX = center * u_invTextureWidth;
		float weight = resizeFilter((center - srcX) * u_scale);
		vec4 sampleValue = texture(u_image, vec2(texX, v_texCoord.y));
		color += vec4(sRGBToLinear(vec3(sampleValue)), 1.0) * weight;
		sum += weight;
	}
	outColor = color / sum;
}`;

const fsVerticalLinearize = `#version 300 es
precision highp float;
precision highp int;
in highp vec2 v_texCoord;
out highp vec4 outColor;

uniform sampler2D u_image;
uniform highp float u_textureHeight;
uniform highp float u_invTextureHeight;
uniform highp float u_scale;
uniform highp float u_radius;
const float PI = 3.141592653589793;

/* FILTER_FUNCTION */

vec3 LinearToSRGB(vec3 rgb)
{
  // See https://gamedev.stackexchange.com/questions/92015/optimized-linear-to-srgb-glsl
  return mix(1.055 * pow(rgb, vec3(1.0 / 2.4)) - 0.055,
             rgb * 12.92,
             lessThanEqual(rgb, vec3(0.0031308)));
}

void main(){
	float srcY = (v_texCoord.y * u_textureHeight);
	float top = srcY - u_radius;
	float bottom = srcY + u_radius;
	int start = int(floor(top));
	int end = int(ceil(bottom));

	float sum = 0.0;
	vec4 color = vec4(0.0);
	for(int j = start; j <= end; j++){
		float center = float(j) + 0.5;
		float texY = center * u_invTextureHeight;
		float weight = resizeFilter((center - srcY) * u_scale);
		vec4 sampleValue = texture(u_image, vec2(v_texCoord.x, texY));
		color += sampleValue * weight;
		sum += weight;
	}
	vec4 linearColor = color / sum;
	outColor = vec4(LinearToSRGB(clamp(linearColor.rgb, 0.0, 1.0)), 1.0);
}`;

const boxFilter = `float resizeFilter(float x) {
	x = abs(x);
	return (x <= 0.5) ? 1.0 : 0.0;
}`;

const hammingFilter = `float resizeFilter(float x) {
	x = abs(x);
	if(x >= 1.0) return 0.0;
	if(x < 1.19209290E-7) return 1.0;
	float xpi = x * PI;
	return ((sin(xpi) / xpi) * (0.54 + 0.46 * cos(xpi)));
}`;

const lanczos2Filter = `float resizeFilter(float x) {
	x = abs(x);
	if(x >= 2.0) return 0.0;
	if(x < 1.19209290E-7) return 1.0;
	float xpi = x * PI;
	return (sin(xpi) / xpi) * (sin(xpi / 2.0) / (xpi / 2.0));
}`;

const lanczos3Filter = `float resizeFilter(float x) {
	x = abs(x);
	if(x >= 3.0) return 0.0;
	if(x < 1.19209290E-7) return 1.0;
	float xpi = x * PI;
	return (sin(xpi) / xpi) * (sin(xpi / 3.0) / (xpi / 3.0));
}`;

const mks2013Filter = `float resizeFilter(float x) {
	x = abs(x);
	if (x <= 0.5) return 1.0625 - 1.75 * x * x;
	if (x <= 1.5) return 0.25 * (4.0 * x * x - 11.0 * x + 7.0);
	if (x <= 2.5) return -0.125 * (x - 2.5) * (x - 2.5);
	return 0.0;
}`;

const mks2021Filter = `float resizeFilter(float x) {
	x = abs(x);
	if (x <= 0.5) return (577.0/576.0) - (239.0/144.0) * x * x;
	if (x <= 1.5) return (1.0/144.0) * (140.0 * x * x - 379.0 * x + 239.0);
	if (x <= 2.5) return -(1.0/144.0) * (24.0 * x * x - 113.0 * x + 130.0);
	if (x <= 3.5) return (1.0/144.0) * (4.0 * x * x - 27.0 * x + 45.0);
	if (x <= 4.5) return -(1.0/1152.0) * (2.0 * x - 9.0) * (2.0 * x - 9.0);
	return 0.0;
}`;

const filters = {
	box: boxFilter,
	hamming: hammingFilter,
	lanczos2: lanczos2Filter,
	lanczos3: lanczos3Filter,
	mks2013: mks2013Filter,
	mks2021: mks2021Filter,
};

const windows = {
	box: 0.5,
	hamming: 1.0,
	lanczos2: 2.0,
	lanczos3: 3.0,
	mks2013: 2.5,
	mks2021: 4.5,
};

export function generateHorizontalShader(
	filterFunction: ScalerCreationOptions["filter"],
	linear: boolean,
	precise: boolean
) {
	if (precise) {
		return (linear ? fsHorizontalLinearize : fsHorizontal).replace(
			"/* FILTER_FUNCTION */",
			filters[filterFunction]
		);
	} else {
		return (linear ? fsHorizontalLinearize : fsHorizontal)
			.replace("precision highp float;", "precision mediump float;")
			.replace("/* FILTER_FUNCTION */", filters[filterFunction]);
	}
}

export function generateVerticalShader(
	filterFunction: ScalerCreationOptions["filter"],
	linear: boolean,
	precise: boolean
) {
	if (precise) {
		return (linear ? fsVerticalLinearize : fsVertical).replace(
			"/* FILTER_FUNCTION */",
			filters[filterFunction]
		);
	} else {
		return (linear ? fsVerticalLinearize : fsVertical)
			.replace("precision highp float;", "precision mediump float;")
			.replace("/* FILTER_FUNCTION */", filters[filterFunction]);
	}
}

export function getResizeWindow(
	filterFunction: ScalerCreationOptions["filter"]
) {
	return windows[filterFunction];
}
