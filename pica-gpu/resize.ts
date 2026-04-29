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
	preserveAspectRatio: boolean;
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
	frameInit: VideoFrameBufferInit | undefined;
	lastPixelCount = -1;

	pbo: WebGLBuffer;
	sync: WebGLSync | undefined;
	syncTimeout: number;

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
		invTextureWidth: WebGLUniformLocation;
		scale: WebGLUniformLocation;
		radius: WebGLUniformLocation;
	};
	verticalLocations: {
		textureHeight: WebGLUniformLocation;
		invTextureHeight: WebGLUniformLocation;
		scale: WebGLUniformLocation;
		radius: WebGLUniformLocation;
	};
	horizontalVAO: WebGLVertexArrayObject;
	verticalVAO: WebGLVertexArrayObject;

	public constructor(options: ScalerCreationOptions) {
		this.canvas = new OffscreenCanvas(1, 1);

		const gl = this.canvas.getContext("webgl2", {
			premultipliedAlpha: false,
			preserveDrawingBuffer: false,
			powerPreference: "high-performance",
			antialias: false,
		});
		if (!gl) throw new Error("Failed to initialize WebGL2 context");

		this.gl = gl;
		if (options.precise) {
			this.gl.getExtension("EXT_color_buffer_half_float");
		}
		this.precise = options.precise;

		this.windowSize = getResizeWindow(options.filter);

		this.sourceTexture = createEmptyTexture(
			this.gl,
			1,
			1,
			gl.RGBA8,
			gl.RGBA,
			gl.UNSIGNED_BYTE
		);
		this.horizontalTexture = createEmptyTexture(
			this.gl,
			1,
			1,
			this.precise ? gl.RGBA16F : gl.RGBA8,
			gl.RGBA,
			this.precise ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE
		);
		this.outputTexture = createEmptyTexture(
			this.gl,
			1,
			1,
			gl.RGBA8,
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

		this.pbo = this.gl.createBuffer();
		this.syncTimeout = this.gl.getParameter(
			gl.MAX_CLIENT_WAIT_TIMEOUT_WEBGL
		);

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
			invTextureWidth: this.gl.getUniformLocation(
				this.compiledHorizontal.program,
				"u_invTextureWidth"
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
			invTextureHeight: this.gl.getUniformLocation(
				this.compiledVertical.program,
				"u_invTextureHeight"
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
	handleFrame(frame: VideoFrame, options: FrameOptions): [number, number] {
		if (frame.displayWidth === 0 || frame.displayHeight === 0) {
			throw new Error("source image width or height is 0");
		}

		const gl = this.gl;

		const srcWidth = frame.displayWidth;
		const srcHeight = frame.displayHeight;

		const srcAspectRatio = srcWidth / srcHeight;

		let targetWidth = Math.round(options.width);
		let targetHeight = Math.round(options.height);

		const outputAspectRatio = targetWidth / targetHeight;

		const EPSILON = 1e-6;
		if (
			Math.abs(srcAspectRatio - outputAspectRatio) > EPSILON &&
			options.preserveAspectRatio
		) {
			if (srcAspectRatio > outputAspectRatio) {
				targetHeight = Math.round(targetWidth / srcAspectRatio);
			} else {
				targetWidth = Math.round(targetHeight * srcAspectRatio);
			}
		}

		if (targetWidth === 0 || targetHeight === 0) {
			throw new Error("target width or height is 0");
		}

		const scaleX = targetWidth / srcWidth;
		const scaleY = targetHeight / srcHeight;

		if (
			this.horizontalTextureWidth !== targetWidth ||
			this.horizontalTextureHeight !== srcHeight
		) {
			updateTextureFromEmpty(
				gl,
				this.horizontalTexture,
				targetWidth,
				srcHeight,
				this.precise ? gl.RGBA16F : gl.RGBA8,
				gl.RGBA,
				this.precise ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE
			);
			this.horizontalTextureWidth = targetWidth;
			this.horizontalTextureHeight = srcHeight;
		}

		if (
			targetWidth != this.lastTargetWidth ||
			targetHeight != this.lastTargetHeight
		) {
			updateTextureFromEmpty(
				gl,
				this.outputTexture,
				targetWidth,
				targetHeight,
				gl.RGBA8,
				gl.RGBA,
				gl.UNSIGNED_BYTE
			);
			this.lastTargetWidth = targetWidth;
			this.lastTargetHeight = targetHeight;
		}

		this.frameInit = {
			timestamp: frame.timestamp,
			duration: frame.duration ? frame.duration : undefined,
			codedWidth: targetWidth,
			codedHeight: targetHeight,
			format: "RGBA",
		};

		const radiusX = scaleX < 1 ? this.windowSize / scaleX : this.windowSize;
		gl.useProgram(this.compiledHorizontal.program);
		if (srcWidth !== this.lastSourceWidth) {
			gl.uniform1f(this.horizontalLocations.textureWidth, srcWidth);
			gl.uniform1f(
				this.horizontalLocations.invTextureWidth,
				1 / srcWidth
			);
			this.lastSourceWidth = srcWidth;
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
		updateTextureFromImage(
			gl,
			this.sourceTexture,
			frame,
			srcWidth,
			srcHeight,
			gl.RGBA8,
			gl.RGBA,
			gl.UNSIGNED_BYTE
		);
		frame.close();
		gl.viewport(0, 0, targetWidth, srcHeight);
		gl.bindFramebuffer(gl.FRAMEBUFFER, this.horizontalFramebuffer);
		gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

		const radiusY = scaleY < 1 ? this.windowSize / scaleY : this.windowSize;
		gl.useProgram(this.compiledVertical.program);
		if (srcHeight !== this.lastSourceHeight) {
			gl.uniform1f(this.verticalLocations.textureHeight, srcHeight);
			gl.uniform1f(
				this.verticalLocations.invTextureHeight,
				1 / srcHeight
			);
			this.lastSourceHeight = srcHeight;
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
		gl.viewport(0, 0, targetWidth, targetHeight);
		gl.bindFramebuffer(gl.FRAMEBUFFER, this.outputFramebuffer);
		gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

		return [targetWidth, targetHeight];
	}
	public processImmediate(frame: VideoFrame, options: FrameOptions) {
		const [width, height] = this.handleFrame(frame, options);

		const gl = this.gl;

		const pixelCount = width * height * 4;

		if (pixelCount != this.lastPixelCount) {
			gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
			gl.bufferData(gl.PIXEL_PACK_BUFFER, pixelCount, gl.DYNAMIC_READ);
			gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);

			this.pixels = new Uint8Array(pixelCount);
			this.lastPixelCount = pixelCount;
		}

		if (this.sync) {
			gl.deleteSync(this.sync);
			gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
			this.sync = undefined;
		}

		gl.readPixels(
			0,
			0,
			width,
			height,
			gl.RGBA,
			gl.UNSIGNED_BYTE,
			this.pixels
		);

		return new VideoFrame(this.pixels, this.frameInit!);
	}
	public processBuffered(frame: VideoFrame, options: FrameOptions) {
		const [width, height] = this.handleFrame(frame, options);

		const gl = this.gl;

		gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);

		const pixelCount = width * height * 4;

		if (pixelCount != this.lastPixelCount) {
			gl.bufferData(gl.PIXEL_PACK_BUFFER, pixelCount, gl.DYNAMIC_READ);

			this.pixels = new Uint8Array(pixelCount);
			this.lastPixelCount = pixelCount;
		}

		gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, 0);

		if (this.sync) {
			gl.deleteSync(this.sync);
		}

		this.sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)!;
		gl.flush();
	}
	public read(): VideoFrame | undefined {
		if (this.frameInit && this.sync) {
			const gl = this.gl;

			gl.clientWaitSync(
				this.sync,
				gl.SYNC_FLUSH_COMMANDS_BIT,
				this.syncTimeout
			);

			gl.deleteSync(this.sync);
			this.sync = undefined;

			gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
			gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, this.pixels);

			return new VideoFrame(this.pixels, this.frameInit);
		}
	}
	public destroy() {
		if (this.sync) {
			this.gl.deleteSync(this.sync);
			this.sync = undefined;
		}

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
		this.gl.deleteBuffer(this.pbo);
		this.gl.deleteVertexArray(this.horizontalVAO);
		this.gl.deleteVertexArray(this.verticalVAO);
	}
}
