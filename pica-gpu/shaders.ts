import type { ResizeOptions } from "./resize";

export const vsSource = `#version 300 es
precision highp float;in vec2 a_position,a_texCoord;out vec2 v_texCoord;void main(){v_texCoord=a_texCoord;gl_Position=vec4(a_position,0,1);}`;

const verticalFilters = {
	mks2013: `#version 300 es
precision mediump float;
precision highp int;

uniform highp float u_textureHeight;
uniform highp float u_radius;
uniform highp float u_scale;
uniform mediump sampler2D u_image;

in highp vec2 v_texCoord;
layout(location = 0) out highp vec4 outColor;

void main()
{
    highp float _105 = v_texCoord.y * u_textureHeight;
    int _120 = int(floor(_105 - u_radius));
    int _124 = int(ceil(_105 + u_radius));
    highp vec4 _271;
    highp float _272;
    _272 = 0.0;
    _271 = vec4(0.0);
    highp vec4 _173;
    highp float _176;
    for (mediump int _270 = _120; _270 <= _124; _272 = _176, _271 = _173, _270++)
    {
        float _143 = float(_270) + 0.5;
        highp float _273;
        do
        {
            highp float _217 = abs((_143 - _105) * u_scale);
            if (_217 <= 0.5)
            {
                _273 = 1.0625 - ((1.75 * _217) * _217);
                break;
            }
            if (_217 <= 1.5)
            {
                _273 = 0.25 * ((_217 * ((4.0 * _217) - 11.0)) + 7.0);
                break;
            }
            if (_217 <= 2.5)
            {
                highp float _244 = _217 - 2.5;
                _273 = ((-0.125) * _244) * _244;
                break;
            }
            _273 = 0.0;
            break;
        } while(false);
        _173 = _271 + (texture(u_image, vec2(v_texCoord.x, _143 / u_textureHeight)) * _273);
        _176 = _272 + _273;
    }
    highp vec4 _184 = _271 / vec4(_272);
    highp vec3 _192 = clamp(_184.xyz, vec3(0.0), vec3(1.0));
    outColor = vec4(mix(_192 * 12.9200000762939453125, (pow(_192, vec3(0.4166666567325592041015625)) * 1.05499994754791259765625) - vec3(0.054999999701976776123046875), step(vec3(0.003130800090730190277099609375), _192)), _184.w);
}

`,
	mks2021: `#version 300 es
precision mediump float;
precision highp int;

uniform highp float u_textureHeight;
uniform highp float u_radius;
uniform highp float u_scale;
uniform mediump sampler2D u_image;

in highp vec2 v_texCoord;
layout(location = 0) out highp vec4 outColor;

void main()
{
    highp float _146 = v_texCoord.y * u_textureHeight;
    int _161 = int(floor(_146 - u_radius));
    int _165 = int(ceil(_146 + u_radius));
    highp vec4 _340;
    highp float _341;
    _341 = 0.0;
    _340 = vec4(0.0);
    highp vec4 _214;
    highp float _217;
    for (mediump int _339 = _161; _339 <= _165; _341 = _217, _340 = _214, _339++)
    {
        float _184 = float(_339) + 0.5;
        highp float _342;
        do
        {
            highp float _258 = abs((_184 - _146) * u_scale);
            if (_258 <= 0.5)
            {
                _342 = 1.001736164093017578125 - ((1.65972220897674560546875 * _258) * _258);
                break;
            }
            if (_258 <= 1.5)
            {
                _342 = 0.0069444444961845874786376953125 * ((_258 * ((140.0 * _258) - 379.0)) + 239.0);
                break;
            }
            if (_258 <= 2.5)
            {
                _342 = (-0.0069444444961845874786376953125) * ((_258 * ((24.0 * _258) - 113.0)) + 130.0);
                break;
            }
            if (_258 <= 3.5)
            {
                _342 = 0.0069444444961845874786376953125 * ((_258 * ((4.0 * _258) - 27.0)) + 45.0);
                break;
            }
            if (_258 <= 4.5)
            {
                highp float _312 = (2.0 * _258) - 9.0;
                _342 = ((-0.0008680555620230734348297119140625) * _312) * _312;
                break;
            }
            _342 = 0.0;
            break;
        } while(false);
        _214 = _340 + (texture(u_image, vec2(v_texCoord.x, _184 / u_textureHeight)) * _342);
        _217 = _341 + _342;
    }
    highp vec4 _225 = _340 / vec4(_341);
    highp vec3 _233 = clamp(_225.xyz, vec3(0.0), vec3(1.0));
    outColor = vec4(mix(_233 * 12.9200000762939453125, (pow(_233, vec3(0.4166666567325592041015625)) * 1.05499994754791259765625) - vec3(0.054999999701976776123046875), step(vec3(0.003130800090730190277099609375), _233)), _225.w);
}

`,
};

const horizontalFilters = {
	mks2013: `#version 300 es
precision mediump float;
precision highp int;

uniform highp float u_textureWidth;
uniform highp float u_radius;
uniform highp float u_scale;
uniform mediump sampler2D u_image;

in highp vec2 v_texCoord;
layout(location = 0) out highp vec4 outColor;

void main()
{
    highp float _76 = v_texCoord.x * u_textureWidth;
    int _91 = int(floor(_76 - u_radius));
    int _95 = int(ceil(_76 + u_radius));
    highp vec4 _208;
    highp float _209;
    _209 = 0.0;
    _208 = vec4(0.0);
    highp vec4 _144;
    highp float _147;
    for (mediump int _207 = _91; _207 <= _95; _209 = _147, _208 = _144, _207++)
    {
        float _114 = float(_207) + 0.5;
        highp float _210;
        do
        {
            highp float _172 = abs((_114 - _76) * u_scale);
            if (_172 <= 0.5)
            {
                _210 = 1.0625 - ((1.75 * _172) * _172);
                break;
            }
            if (_172 <= 1.5)
            {
                _210 = 0.25 * ((_172 * ((4.0 * _172) - 11.0)) + 7.0);
                break;
            }
            if (_172 <= 2.5)
            {
                highp float _199 = _172 - 2.5;
                _210 = ((-0.125) * _199) * _199;
                break;
            }
            _210 = 0.0;
            break;
        } while(false);
        _144 = _208 + (texture(u_image, vec2(_114 / u_textureWidth, v_texCoord.y)) * _210);
        _147 = _209 + _210;
    }
    outColor = _208 / vec4(_209);
}

`,
	mks2021: `#version 300 es
precision mediump float;
precision highp int;

uniform highp float u_textureWidth;
uniform highp float u_radius;
uniform highp float u_scale;
uniform mediump sampler2D u_image;

in highp vec2 v_texCoord;
layout(location = 0) out highp vec4 outColor;

void main()
{
    highp float _117 = v_texCoord.x * u_textureWidth;
    int _132 = int(floor(_117 - u_radius));
    int _136 = int(ceil(_117 + u_radius));
    highp vec4 _277;
    highp float _278;
    _278 = 0.0;
    _277 = vec4(0.0);
    highp vec4 _185;
    highp float _188;
    for (mediump int _276 = _132; _276 <= _136; _278 = _188, _277 = _185, _276++)
    {
        float _155 = float(_276) + 0.5;
        highp float _279;
        do
        {
            highp float _213 = abs((_155 - _117) * u_scale);
            if (_213 <= 0.5)
            {
                _279 = 1.001736164093017578125 - ((1.65972220897674560546875 * _213) * _213);
                break;
            }
            if (_213 <= 1.5)
            {
                _279 = 0.0069444444961845874786376953125 * ((_213 * ((140.0 * _213) - 379.0)) + 239.0);
                break;
            }
            if (_213 <= 2.5)
            {
                _279 = (-0.0069444444961845874786376953125) * ((_213 * ((24.0 * _213) - 113.0)) + 130.0);
                break;
            }
            if (_213 <= 3.5)
            {
                _279 = 0.0069444444961845874786376953125 * ((_213 * ((4.0 * _213) - 27.0)) + 45.0);
                break;
            }
            if (_213 <= 4.5)
            {
                highp float _267 = (2.0 * _213) - 9.0;
                _279 = ((-0.0008680555620230734348297119140625) * _267) * _267;
                break;
            }
            _279 = 0.0;
            break;
        } while(false);
        _185 = _277 + (texture(u_image, vec2(_155 / u_textureWidth, v_texCoord.y)) * _279);
        _188 = _278 + _279;
    }
    outColor = _277 / vec4(_278);
}

`,
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
