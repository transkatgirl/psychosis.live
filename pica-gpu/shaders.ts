import type { ResizeOptions } from "./resize";

/* Shader optimization steps:
1. optimize.sh
2. minified using https://ctrl-alt-test.fr/minifier/ with inlining disabled and --preserve-externals
*/

export const vsSource = `#version 300 es
precision highp float;in vec2 a_position,a_texCoord;out vec2 v_texCoord;void main(){v_texCoord=a_texCoord;gl_Position=vec4(a_position,0,1);}`;

const verticalFilters = {
	box: `#version 300 es
precision mediump float;precision highp int;uniform highp float u_textureHeight,u_radius,u_scale;uniform mediump sampler2D u_image;in highp vec2 v_texCoord;layout(location=0)out highp vec4 outColor;void main(){highp float v=v_texCoord.y*u_textureHeight;int f=int(floor(v-u_radius)),t=int(ceil(v+u_radius));highp vec4 h;highp float m=0.;h=vec4(0);for(mediump int u=f;u<=t;){float i=float(u)+.5;highp float e=float(abs((i-v)*u_scale)<=.5);m+=e;h+=texture(u_image,vec2(v_texCoord.x,i/u_textureHeight))*e;u++;continue;}h/=vec4(m);highp vec3 u=clamp(h.xyz,vec3(0),vec3(1));outColor=vec4(mix(u*12.9200000762939,pow(u,vec3(.416666656732559))*1.05499994754791-vec3(.0549999997019768),step(vec3(.0031308000907302),u)),h.w);}`,
	hamming: `#version 300 es
precision mediump float;precision highp int;uniform highp float u_textureHeight,u_radius,u_scale;uniform mediump sampler2D u_image;in highp vec2 v_texCoord;layout(location=0)out highp vec4 outColor;void main(){highp float f=v_texCoord.y*u_textureHeight;int v=int(floor(f-u_radius)),k=int(ceil(f+u_radius));highp vec4 h;highp float i=0.;h=vec4(0);highp vec4 u;highp float e;for(mediump int m=v;m<=k;i=e,h=u,m++){float s=float(m)+.5;highp float t;do{highp float v=abs((s-f)*u_scale);if(v>=1.){t=0.;break;}if(v<.0000001192092896){t=1.;break;}v*=3.14159274101257;t=sin(v)/v*(.540000021457672+.46000000834465*cos(v));break;}while(false);u=h+texture(u_image,vec2(v_texCoord.x,s/u_textureHeight))*t;e=i+t;}u=h/vec4(i);highp vec3 m=clamp(u.xyz,vec3(0),vec3(1));outColor=vec4(mix(m*12.9200000762939,pow(m,vec3(.416666656732559))*1.05499994754791-vec3(.0549999997019768),step(vec3(.0031308000907302),m)),u.w);}`,
	lanczos2: `#version 300 es
precision mediump float;precision highp int;uniform highp float u_textureHeight,u_radius,u_scale;uniform mediump sampler2D u_image;in highp vec2 v_texCoord;layout(location=0)out highp vec4 outColor;void main(){highp float f=v_texCoord.y*u_textureHeight;int v=int(floor(f-u_radius)),k=int(ceil(f+u_radius));highp vec4 h;highp float i=0.;h=vec4(0);highp vec4 u;highp float e;for(mediump int m=v;m<=k;i=e,h=u,m++){float s=float(m)+.5;highp float t;do{highp float h=abs((s-f)*u_scale);if(h>=2.){t=0.;break;}if(h<.0000001192092896){t=1.;break;}highp float v=h*3.14159274101257;h*=1.57079637050629;t=sin(v)/v*(sin(h)/h);break;}while(false);u=h+texture(u_image,vec2(v_texCoord.x,s/u_textureHeight))*t;e=i+t;}u=h/vec4(i);highp vec3 m=clamp(u.xyz,vec3(0),vec3(1));outColor=vec4(mix(m*12.9200000762939,pow(m,vec3(.416666656732559))*1.05499994754791-vec3(.0549999997019768),step(vec3(.0031308000907302),m)),u.w);}`,
	lanczos3: `#version 300 es
precision mediump float;precision highp int;uniform highp float u_textureHeight,u_radius,u_scale;uniform mediump sampler2D u_image;in highp vec2 v_texCoord;layout(location=0)out highp vec4 outColor;void main(){highp float f=v_texCoord.y*u_textureHeight;int v=int(floor(f-u_radius)),k=int(ceil(f+u_radius));highp vec4 h;highp float i=0.;h=vec4(0);highp vec4 u;highp float e;for(mediump int m=v;m<=k;i=e,h=u,m++){float s=float(m)+.5;highp float t;do{highp float h=abs((s-f)*u_scale);if(h>=3.){t=0.;break;}if(h<.0000001192092896){t=1.;break;}highp float v=h*3.14159274101257;h*=1.04719758033752;t=sin(v)/v*(sin(h)/h);break;}while(false);u=h+texture(u_image,vec2(v_texCoord.x,s/u_textureHeight))*t;e=i+t;}u=h/vec4(i);highp vec3 m=clamp(u.xyz,vec3(0),vec3(1));outColor=vec4(mix(m*12.9200000762939,pow(m,vec3(.416666656732559))*1.05499994754791-vec3(.0549999997019768),step(vec3(.0031308000907302),m)),u.w);}`,
	mks2013: `#version 300 es
precision mediump float;precision highp int;uniform highp float u_textureHeight,u_radius,u_scale;uniform mediump sampler2D u_image;in highp vec2 v_texCoord;layout(location=0)out highp vec4 outColor;void main(){highp float f=v_texCoord.y*u_textureHeight;int v=int(floor(f-u_radius)),k=int(ceil(f+u_radius));highp vec4 h;highp float i=0.;h=vec4(0);highp vec4 u;highp float b;for(mediump int m=v;m<=k;i=b,h=u,m++){float s=float(m)+.5;highp float t;do{highp float v=abs((s-f)*u_scale);if(v<=.5){t=1.0625-1.75*v*v;break;}if(v<=1.5){t=.25*(v*(4.*v-11.)+7.);break;}if(v<=2.5){highp float f=v-2.5;t=-.125*f*f;break;}t=0.;break;}while(false);u=h+texture(u_image,vec2(v_texCoord.x,s/u_textureHeight))*t;b=i+t;}u=h/vec4(i);highp vec3 m=clamp(u.xyz,vec3(0),vec3(1));outColor=vec4(mix(m*12.9200000762939,pow(m,vec3(.416666656732559))*1.05499994754791-vec3(.0549999997019768),step(vec3(.0031308000907302),m)),u.w);}`,
	mks2021: `#version 300 es
precision mediump float;precision highp int;uniform highp float u_textureHeight,u_radius,u_scale;uniform mediump sampler2D u_image;in highp vec2 v_texCoord;layout(location=0)out highp vec4 outColor;void main(){highp float f=v_texCoord.y*u_textureHeight;int v=int(floor(f-u_radius)),k=int(ceil(f+u_radius));highp vec4 h;highp float i=0.;h=vec4(0);highp vec4 u;highp float b;for(mediump int m=v;m<=k;i=b,h=u,m++){float s=float(m)+.5;highp float t;do{highp float v=abs((s-f)*u_scale);if(v<=.5){t=1.00173616409302-1.65972220897675*v*v;break;}if(v<=1.5){t=.0069444444961846*(v*(140.*v-379.)+239.);break;}if(v<=2.5){t=-.0069444444961846*(v*(24.*v-113.)+130.);break;}if(v<=3.5){t=.0069444444961846*(v*(4.*v-27.)+45.);break;}if(v<=4.5){highp float f=2.*v-9.;t=-.0008680555620231*f*f;break;}t=0.;break;}while(false);u=h+texture(u_image,vec2(v_texCoord.x,s/u_textureHeight))*t;b=i+t;}u=h/vec4(i);highp vec3 m=clamp(u.xyz,vec3(0),vec3(1));outColor=vec4(mix(m*12.9200000762939,pow(m,vec3(.416666656732559))*1.05499994754791-vec3(.0549999997019768),step(vec3(.0031308000907302),m)),u.w);}`,
};

const horizontalFilters = {
	box: `#version 300 es
precision mediump float;precision highp int;uniform highp float u_textureWidth,u_radius,u_scale;uniform mediump sampler2D u_image;in highp vec2 v_texCoord;layout(location=0)out highp vec4 outColor;void main(){highp float f=v_texCoord.x*u_textureWidth;int v=int(floor(f-u_radius)),e=int(ceil(f+u_radius));highp vec4 h;highp float u=0.;h=vec4(0);for(mediump int i=v;i<=e;){float m=float(i)+.5;highp float t=float(abs((m-f)*u_scale)<=.5);u+=t;h+=texture(u_image,vec2(m/u_textureWidth,v_texCoord.y))*t;i++;continue;}outColor=h/vec4(u);}`,
	hamming: `#version 300 es
precision mediump float;precision highp int;uniform highp float u_textureWidth,u_radius,u_scale;uniform mediump sampler2D u_image;in highp vec2 v_texCoord;layout(location=0)out highp vec4 outColor;void main(){highp float f=v_texCoord.x*u_textureWidth;int v=int(floor(f-u_radius)),k=int(ceil(f+u_radius));highp vec4 h;highp float i=0.;h=vec4(0);highp vec4 e;highp float u;for(mediump int m=v;m<=k;i=u,h=e,m++){float c=float(m)+.5;highp float b;do{highp float m=abs((c-f)*u_scale);if(m>=1.){b=0.;break;}if(m<.0000001192092896){b=1.;break;}m*=3.14159274101257;b=sin(m)/m*(.540000021457672+.46000000834465*cos(m));break;}while(false);e=h+texture(u_image,vec2(c/u_textureWidth,v_texCoord.y))*b;u=i+b;}outColor=h/vec4(i);}`,
	lanczos2: `#version 300 es
precision mediump float;precision highp int;uniform highp float u_textureWidth,u_radius,u_scale;uniform mediump sampler2D u_image;in highp vec2 v_texCoord;layout(location=0)out highp vec4 outColor;void main(){highp float f=v_texCoord.x*u_textureWidth;int v=int(floor(f-u_radius)),k=int(ceil(f+u_radius));highp vec4 h;highp float i=0.;h=vec4(0);highp vec4 e;highp float u;for(mediump int m=v;m<=k;i=u,h=e,m++){float s=float(m)+.5;highp float b;do{highp float h=abs((s-f)*u_scale);if(h>=2.){b=0.;break;}if(h<.0000001192092896){b=1.;break;}highp float m=h*3.14159274101257;h*=1.57079637050629;b=sin(m)/m*(sin(h)/h);break;}while(false);e=h+texture(u_image,vec2(s/u_textureWidth,v_texCoord.y))*b;u=i+b;}outColor=h/vec4(i);}`,
	lanczos3: `#version 300 es
precision mediump float;precision highp int;uniform highp float u_textureWidth,u_radius,u_scale;uniform mediump sampler2D u_image;in highp vec2 v_texCoord;layout(location=0)out highp vec4 outColor;void main(){highp float f=v_texCoord.x*u_textureWidth;int v=int(floor(f-u_radius)),k=int(ceil(f+u_radius));highp vec4 h;highp float i=0.;h=vec4(0);highp vec4 e;highp float u;for(mediump int m=v;m<=k;i=u,h=e,m++){float s=float(m)+.5;highp float b;do{highp float h=abs((s-f)*u_scale);if(h>=3.){b=0.;break;}if(h<.0000001192092896){b=1.;break;}highp float m=h*3.14159274101257;h*=1.04719758033752;b=sin(m)/m*(sin(h)/h);break;}while(false);e=h+texture(u_image,vec2(s/u_textureWidth,v_texCoord.y))*b;u=i+b;}outColor=h/vec4(i);}`,
	mks2013: `#version 300 es
precision mediump float;precision highp int;uniform highp float u_textureWidth,u_radius,u_scale;uniform mediump sampler2D u_image;in highp vec2 v_texCoord;layout(location=0)out highp vec4 outColor;void main(){highp float f=v_texCoord.x*u_textureWidth;int v=int(floor(f-u_radius)),k=int(ceil(f+u_radius));highp vec4 h;highp float i=0.;h=vec4(0);highp vec4 b;highp float e;for(mediump int u=v;u<=k;i=e,h=b,u++){float m=float(u)+.5;highp float t;do{highp float h=abs((m-f)*u_scale);if(h<=.5){t=1.0625-1.75*h*h;break;}if(h<=1.5){t=.25*(h*(4.*h-11.)+7.);break;}if(h<=2.5){highp float f=h-2.5;t=-.125*f*f;break;}t=0.;break;}while(false);b=h+texture(u_image,vec2(m/u_textureWidth,v_texCoord.y))*t;e=i+t;}outColor=h/vec4(i);}`,
	mks2021: `#version 300 es
precision mediump float;precision highp int;uniform highp float u_textureWidth,u_radius,u_scale;uniform mediump sampler2D u_image;in highp vec2 v_texCoord;layout(location=0)out highp vec4 outColor;void main(){highp float f=v_texCoord.x*u_textureWidth;int v=int(floor(f-u_radius)),k=int(ceil(f+u_radius));highp vec4 h;highp float i=0.;h=vec4(0);highp vec4 b;highp float e;for(mediump int u=v;u<=k;i=e,h=b,u++){float m=float(u)+.5;highp float t;do{highp float h=abs((m-f)*u_scale);if(h<=.5){t=1.00173616409302-1.65972220897675*h*h;break;}if(h<=1.5){t=.0069444444961846*(h*(140.*h-379.)+239.);break;}if(h<=2.5){t=-.0069444444961846*(h*(24.*h-113.)+130.);break;}if(h<=3.5){t=.0069444444961846*(h*(4.*h-27.)+45.);break;}if(h<=4.5){highp float f=2.*h-9.;t=-.0008680555620231*f*f;break;}t=0.;break;}while(false);b=h+texture(u_image,vec2(m/u_textureWidth,v_texCoord.y))*t;e=i+t;}outColor=h/vec4(i);}`,
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
	filterFunction: ResizeOptions["filter"],
	precise: boolean
) {
	if (precise) {
		return horizontalFilters[filterFunction];
	} else {
		return horizontalFilters[filterFunction].replace("highp", "mediump");
	}
}

export function generateVerticalShader(
	filterFunction: ResizeOptions["filter"],
	precise: boolean
) {
	if (precise) {
		return verticalFilters[filterFunction];
	} else {
		return verticalFilters[filterFunction].replace("highp", "mediump");
	}
}

export function getResizeWindow(filterFunction: ResizeOptions["filter"]) {
	return windows[filterFunction];
}
