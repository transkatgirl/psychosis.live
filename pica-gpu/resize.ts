import {
	createDefaultQuadBuffer,
	createEmptyTexture,
	createFramebuffer,
	createProgram,
	createVAOForQuadBuffer,
	updateTextureFromEmpty,
	updateTextureFromImage,
} from "./gl-helper";
import {
	generateHorizontalShader,
	generateVerticalShader,
	getResizeWindow,
	vsSource,
} from "./shaders";

export interface ScalerCreationOptions {
	filter: "box" | "hamming" | "lanczos2" | "lanczos3" | "mks2013" | "mks2021";
	precise: boolean;
	linear: boolean;
}

export interface FrameOptions {
	aspectRatioConversion: "distort" | "letterbox" | "crop";
	width: number;
	height: number;
}

export class Scaler {
	canvas: OffscreenCanvas;
	gl: WebGL2RenderingContext;

	precise: boolean;

	windowSize: number;

	sourceTexture: WebGLTexture;
	horizontalTexture: WebGLTexture;
	outputTexture: WebGLTexture;

	lastSourceWidth = -1;
	lastSourceHeight = -1;
	lastTargetWidth = -1;
	lastTargetHeight = -1;
	lastRadiusX = -1;
	lastRadiusY = -1;
	horizontalTextureWidth = -1;
	horizontalTextureHeight = -1;

	quadBuffer: WebGLBuffer;

	horizontalFramebuffer: WebGLFramebuffer;
	outputFramebuffer: WebGLFramebuffer;

	pixels: Uint8Array;
	lastPixelCount = -1;

	compiledHorizontal: {
		program: WebGLProgram;
		vertexShader: WebGLShader;
		fragmentShader: WebGLShader;
	};
	compiledVertical: {
		program: WebGLProgram;
		vertexShader: WebGLShader;
		fragmentShader: WebGLShader;
	};
	horizontalLocations: {
		textureWidth: WebGLUniformLocation;
		scale: WebGLUniformLocation;
		radius: WebGLUniformLocation;
	};
	verticalLocations: {
		textureHeight: WebGLUniformLocation;
		scale: WebGLUniformLocation;
		radius: WebGLUniformLocation;
	};
	horizontalVAO: WebGLVertexArrayObject;
	verticalVAO: WebGLVertexArrayObject;

	public constructor(
		canvas: OffscreenCanvas,
		options: ScalerCreationOptions
	) {
		this.canvas = canvas;

		const gl = this.canvas.getContext("webgl2", {
			premultipliedAlpha: false,
			preserveDrawingBuffer: false,
			powerPreference: "high-performance",
			antialias: false,
		});
		if (!gl) throw new Error("Failed to initialize WebGL2 context");

		this.gl = gl;
		this.gl.clearColor(0, 0, 0, 1);
		if (options.precise) {
			this.gl.getExtension("EXT_color_buffer_half_float");
		}
		this.precise = options.precise;

		this.windowSize = getResizeWindow(options.filter);

		this.sourceTexture = createEmptyTexture(
			this.gl,
			1,
			1,
			gl.RGBA,
			gl.RGBA,
			gl.UNSIGNED_BYTE
		);
		this.horizontalTexture = createEmptyTexture(
			this.gl,
			1,
			1,
			this.precise ? gl.RGBA16F : gl.RGBA,
			gl.RGBA,
			this.precise ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE
		);
		this.outputTexture = createEmptyTexture(
			this.gl,
			1,
			1,
			gl.RGBA,
			gl.RGBA,
			gl.UNSIGNED_BYTE
		);

		this.quadBuffer = createDefaultQuadBuffer(this.gl);

		this.horizontalFramebuffer = createFramebuffer(
			this.gl,
			this.horizontalTexture
		);
		this.outputFramebuffer = createFramebuffer(this.gl, this.outputTexture);
		this.pixels = new Uint8Array();

		this.compiledHorizontal = createProgram(
			this.gl,
			options.precise ? vsSource : vsSource.replace("highp", "mediump"),
			generateHorizontalShader(
				options.filter,
				options.linear,
				options.precise
			)
		);
		this.compiledVertical = createProgram(
			this.gl,
			options.precise ? vsSource : vsSource.replace("highp", "mediump"),
			generateVerticalShader(
				options.filter,
				options.linear,
				options.precise
			)
		);

		this.horizontalLocations = {
			textureWidth: this.gl.getUniformLocation(
				this.compiledHorizontal.program,
				"u_textureWidth"
			)!,
			scale: this.gl.getUniformLocation(
				this.compiledHorizontal.program,
				"u_scale"
			)!,
			radius: this.gl.getUniformLocation(
				this.compiledHorizontal.program,
				"u_radius"
			)!,
		};
		this.verticalLocations = {
			textureHeight: this.gl.getUniformLocation(
				this.compiledVertical.program,
				"u_textureHeight"
			)!,
			scale: this.gl.getUniformLocation(
				this.compiledVertical.program,
				"u_scale"
			)!,
			radius: this.gl.getUniformLocation(
				this.compiledVertical.program,
				"u_radius"
			)!,
		};

		this.horizontalVAO = createVAOForQuadBuffer(
			this.gl,
			this.compiledHorizontal.program,
			this.quadBuffer,
			"a_position",
			"a_texCoord"
		);
		this.verticalVAO = createVAOForQuadBuffer(
			this.gl,
			this.compiledVertical.program,
			this.quadBuffer,
			"a_position",
			"a_texCoord"
		);

		this.gl.useProgram(this.compiledHorizontal.program);
		this.gl.uniform1i(
			this.gl.getUniformLocation(
				this.compiledHorizontal.program,
				"u_image"
			),
			0
		);
		this.gl.useProgram(this.compiledVertical.program);
		this.gl.uniform1i(
			this.gl.getUniformLocation(
				this.compiledVertical.program,
				"u_image"
			),
			0
		);

		this.gl.activeTexture(this.gl.TEXTURE0);
		this.gl.disable(this.gl.BLEND);
	}
	public process(frame: VideoFrame, options: FrameOptions): VideoFrame {
		if (frame.displayWidth === 0 || frame.displayHeight === 0) {
			throw new Error("source image width or height is 0");
		}
		if (options.width === 0 || options.height === 0) {
			throw new Error("target canvas width or height is 0");
		}

		const gl = this.gl;

		const srcWidth = frame.displayWidth;
		const srcHeight = frame.displayHeight;

		const srcAspectRatio = srcWidth / srcHeight;
		const outputAspectRatio = options.width / options.height;

		let targetWidth = options.width;
		let targetHeight = options.height;

		const EPSILON = 1e-6;
		if (
			Math.abs(srcAspectRatio - outputAspectRatio) > EPSILON &&
			options.aspectRatioConversion != "distort"
		) {
			if (srcAspectRatio > outputAspectRatio) {
				targetHeight = Math.round(options.width / srcAspectRatio);
			} else {
				targetWidth = Math.round(options.height * srcAspectRatio);
			}
		}

		const scaleX = targetWidth / srcWidth;
		const scaleY = targetHeight / srcHeight;

		let offsetX = 0;
		if (options.width > targetWidth) {
			offsetX = Math.round((options.width - targetWidth) / 2);
		}

		let offsetY = 0;
		if (options.height > targetHeight) {
			offsetY = Math.round((options.height - targetHeight) / 2);
		}

		updateTextureFromImage(
			gl,
			this.sourceTexture,
			frame,
			srcWidth,
			srcHeight,
			gl.RGBA,
			gl.RGBA,
			gl.UNSIGNED_BYTE
		);

		if (
			this.horizontalTextureWidth !== targetWidth ||
			this.horizontalTextureHeight !== srcHeight
		) {
			updateTextureFromEmpty(
				gl,
				this.horizontalTexture,
				targetWidth,
				srcHeight,
				this.precise ? gl.RGBA16F : gl.RGBA,
				gl.RGBA,
				this.precise ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE
			);
			this.horizontalTextureWidth = targetWidth;
			this.horizontalTextureHeight = srcHeight;
		}

		if (
			options.width != this.lastTargetWidth ||
			options.height != this.lastTargetHeight
		) {
			updateTextureFromEmpty(
				gl,
				this.outputTexture,
				options.width,
				options.height,
				gl.RGBA,
				gl.RGBA,
				gl.UNSIGNED_BYTE
			);

			this.lastTargetWidth = options.width;
			this.lastTargetHeight = options.height;
		}

		let pixelCount =
			(options.aspectRatioConversion === "crop"
				? targetWidth * targetHeight
				: options.width * options.height) * 4;

		if (pixelCount != this.lastPixelCount) {
			this.pixels = new Uint8Array(pixelCount);
		}

		const radiusX = scaleX < 1 ? this.windowSize / scaleX : this.windowSize;
		gl.useProgram(this.compiledHorizontal.program);
		if (srcWidth !== this.lastSourceWidth) {
			gl.uniform1f(this.horizontalLocations.textureWidth, srcWidth);
		}
		if (radiusX !== this.lastRadiusX) {
			gl.uniform1f(
				this.horizontalLocations.scale,
				this.windowSize / radiusX
			);
			gl.uniform1f(this.horizontalLocations.radius, radiusX);
			this.lastRadiusX = radiusX;
		}
		gl.bindVertexArray(this.horizontalVAO);
		gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
		gl.viewport(0, 0, targetWidth, srcHeight);
		gl.bindFramebuffer(gl.FRAMEBUFFER, this.horizontalFramebuffer);
		gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

		const radiusY = scaleY < 1 ? this.windowSize / scaleY : this.windowSize;
		gl.useProgram(this.compiledVertical.program);
		if (srcHeight !== this.lastSourceHeight) {
			gl.uniform1f(this.verticalLocations.textureHeight, srcHeight);
		}
		if (radiusY !== this.lastRadiusY) {
			gl.uniform1f(
				this.verticalLocations.scale,
				this.windowSize / radiusY
			);
			gl.uniform1f(this.verticalLocations.radius, radiusY);
			this.lastRadiusY = radiusY;
		}
		gl.bindVertexArray(this.verticalVAO);
		gl.bindTexture(gl.TEXTURE_2D, this.horizontalTexture);
		gl.viewport(offsetX, offsetY, targetWidth, targetHeight);
		gl.bindFramebuffer(gl.FRAMEBUFFER, this.outputFramebuffer);
		if (
			srcWidth !== this.lastSourceWidth ||
			srcHeight !== this.lastSourceHeight
		) {
			gl.clearColor(0, 0, 0, 1);
			gl.clear(gl.COLOR_BUFFER_BIT);

			this.lastSourceWidth = srcWidth;
			this.lastSourceHeight = srcHeight;
		}
		gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

		let init: VideoFrameBufferInit;

		if (options.aspectRatioConversion === "crop") {
			gl.readPixels(
				offsetX,
				offsetY,
				targetWidth,
				targetHeight,
				gl.RGBA,
				gl.UNSIGNED_BYTE,
				this.pixels
			);

			init = {
				timestamp: frame.timestamp,
				duration: frame.duration ? frame.duration : undefined,
				codedWidth: targetWidth,
				codedHeight: targetHeight,
				format: "RGBA",
			};
		} else {
			gl.readPixels(
				0,
				0,
				options.width,
				options.height,
				gl.RGBA,
				gl.UNSIGNED_BYTE,
				this.pixels
			);

			init = {
				timestamp: frame.timestamp,
				duration: frame.duration ? frame.duration : undefined,
				codedWidth: options.width,
				codedHeight: options.height,
				format: "RGBA",
			};
		}

		return new VideoFrame(this.pixels, init);
	}
	public destroy() {
		this.gl.deleteTexture(this.sourceTexture);
		this.gl.deleteTexture(this.horizontalTexture);
		this.gl.deleteTexture(this.outputTexture);
		this.gl.deleteProgram(this.compiledHorizontal.program);
		this.gl.deleteProgram(this.compiledVertical.program);
		this.gl.deleteShader(this.compiledHorizontal.vertexShader);
		this.gl.deleteShader(this.compiledHorizontal.fragmentShader);
		this.gl.deleteShader(this.compiledVertical.vertexShader);
		this.gl.deleteShader(this.compiledVertical.fragmentShader);
		this.gl.deleteFramebuffer(this.horizontalFramebuffer);
		this.gl.deleteFramebuffer(this.outputFramebuffer);
		this.gl.deleteBuffer(this.quadBuffer);
		this.gl.deleteVertexArray(this.horizontalVAO);
		this.gl.deleteVertexArray(this.verticalVAO);
	}
}
