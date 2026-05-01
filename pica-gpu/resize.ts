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

// TODO: benchmark async texture uploading (https://www.songho.ca/opengl/gl_pbo.html) to see if it has a performance benefit?

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
	horizontalTexture: {
		texture: WebGLTexture;
		width: number;
		height: number;
	};
	outputTexture: {
		texture: WebGLTexture;
		width: number;
		height: number;
	};

	lastSourceWidth = -1;
	lastSourceHeight = -1;
	lastRadiusX = -1;
	lastRadiusY = -1;

	quadBuffer: WebGLBuffer;

	horizontalFramebuffer: WebGLFramebuffer;
	outputFramebuffer: WebGLFramebuffer;

	pixels: Uint8Array;
	lastPixelCount = -1;

	activeBuffer = 0;
	buffer0: {
		pbo: WebGLBuffer;
		pixelCount: number;
		sync?: WebGLSync;
		frameInit?: VideoFrameBufferInit;
	};
	buffer1: {
		pbo: WebGLBuffer;
		pixelCount: number;
		sync?: WebGLSync;
		frameInit?: VideoFrameBufferInit;
	};
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
		this.horizontalTexture = {
			texture: createEmptyTexture(
				this.gl,
				1,
				1,
				this.precise ? gl.RGBA16F : gl.RGBA8,
				gl.RGBA,
				this.precise ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE
			),
			width: 1,
			height: 1,
		};
		this.outputTexture = {
			texture: createEmptyTexture(
				this.gl,
				1,
				1,
				gl.RGBA8,
				gl.RGBA,
				gl.UNSIGNED_BYTE
			),
			width: 1,
			height: 1,
		};

		this.quadBuffer = createDefaultQuadBuffer(this.gl);

		this.horizontalFramebuffer = createFramebuffer(
			this.gl,
			this.horizontalTexture.texture
		);
		this.outputFramebuffer = createFramebuffer(
			this.gl,
			this.outputTexture.texture
		);
		this.pixels = new Uint8Array();

		this.buffer0 = { pbo: this.gl.createBuffer(), pixelCount: -1 };
		this.buffer1 = { pbo: this.gl.createBuffer(), pixelCount: -1 };
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
	handleFrame(frame: VideoFrame, options: FrameOptions) {
		if (this.activeBuffer === -1)
			throw new Error("Attempted to use a closed scaler");

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
			this.horizontalTexture.width !== targetWidth ||
			this.horizontalTexture.height !== srcHeight
		) {
			updateTextureFromEmpty(
				gl,
				this.horizontalTexture.texture,
				targetWidth,
				srcHeight,
				this.precise ? gl.RGBA16F : gl.RGBA8,
				gl.RGBA,
				this.precise ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE
			);
			this.horizontalTexture.width = targetWidth;
			this.horizontalTexture.height = srcHeight;
		}

		if (
			this.outputTexture.width != targetWidth ||
			this.outputTexture.height != targetHeight
		) {
			updateTextureFromEmpty(
				gl,
				this.outputTexture.texture,
				targetWidth,
				targetHeight,
				gl.RGBA8,
				gl.RGBA,
				gl.UNSIGNED_BYTE
			);
			this.outputTexture.width = targetWidth;
			this.outputTexture.height = targetHeight;
		}

		const frameInit: VideoFrameBufferInit = {
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
		gl.bindTexture(gl.TEXTURE_2D, this.horizontalTexture.texture);
		gl.viewport(0, 0, targetWidth, targetHeight);
		gl.bindFramebuffer(gl.FRAMEBUFFER, this.outputFramebuffer);
		gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

		return frameInit;
	}
	public processImmediate(frame: VideoFrame, options: FrameOptions) {
		const frameInit = this.handleFrame(frame, options);

		const gl = this.gl;

		const pixelCount = frameInit.codedWidth * frameInit.codedHeight * 4;

		if (this.lastPixelCount != pixelCount) {
			this.pixels = new Uint8Array(pixelCount);
			this.lastPixelCount = pixelCount;
		}

		if (this.buffer0.sync) {
			gl.deleteSync(this.buffer0.sync);
			gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
			this.buffer0.sync = undefined;
		}

		if (this.buffer1.sync) {
			gl.deleteSync(this.buffer1.sync);
			gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
			this.buffer1.sync = undefined;
		}

		gl.readPixels(
			0,
			0,
			frameInit.codedWidth,
			frameInit.codedHeight,
			gl.RGBA,
			gl.UNSIGNED_BYTE,
			this.pixels
		);

		return new VideoFrame(this.pixels, frameInit);
	}
	public processBuffered(frame: VideoFrame, options: FrameOptions) {
		if (this.activeBuffer === -1) return;

		const buffer = this.activeBuffer ? this.buffer1 : this.buffer0;

		buffer.frameInit = this.handleFrame(frame, options);

		const gl = this.gl;

		gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer.pbo);

		const pixelCount =
			buffer.frameInit.codedWidth * buffer.frameInit.codedHeight * 4;

		if (pixelCount != buffer.pixelCount) {
			gl.bufferData(gl.PIXEL_PACK_BUFFER, pixelCount, gl.DYNAMIC_READ);
			buffer.pixelCount = pixelCount;
		}

		gl.readPixels(
			0,
			0,
			buffer.frameInit.codedWidth,
			buffer.frameInit.codedHeight,
			gl.RGBA,
			gl.UNSIGNED_BYTE,
			0
		);

		if (buffer.sync) {
			gl.deleteSync(buffer.sync);
		}

		buffer.sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)!;
		gl.flush();

		this.swap();
	}
	public swap() {
		this.activeBuffer = this.activeBuffer ? 0 : 1;
	}
	public read(warningCallback?: () => void): VideoFrame | undefined {
		if (this.activeBuffer === -1) return;

		const buffer = this.activeBuffer ? this.buffer1 : this.buffer0;

		if (buffer.frameInit && buffer.sync) {
			const gl = this.gl;

			if (this.lastPixelCount != buffer.pixelCount) {
				this.pixels = new Uint8Array(buffer.pixelCount);
				this.lastPixelCount = buffer.pixelCount;
			}

			const status = gl.clientWaitSync(
				buffer.sync,
				gl.SYNC_FLUSH_COMMANDS_BIT,
				this.syncTimeout
			);

			if (status === gl.TIMEOUT_EXPIRED && warningCallback)
				warningCallback();

			gl.deleteSync(buffer.sync);
			buffer.sync = undefined;

			gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer.pbo);
			gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, this.pixels);

			return new VideoFrame(this.pixels, buffer.frameInit);
		}
	}
	public discard(minTimestamp?: number): boolean {
		if (this.activeBuffer === -1) return false;

		const buffer = this.activeBuffer ? this.buffer1 : this.buffer0;

		if (
			buffer.sync &&
			(!minTimestamp ||
				(buffer.frameInit && buffer.frameInit.timestamp < minTimestamp))
		) {
			this.gl.deleteSync(buffer.sync);
			buffer.sync = undefined;

			return true;
		} else {
			return false;
		}
	}
	public destroy() {
		if (this.activeBuffer === -1) return;

		this.activeBuffer = -1;

		if (this.buffer0.sync) {
			this.gl.deleteSync(this.buffer0.sync);
		}
		if (this.buffer1.sync) {
			this.gl.deleteSync(this.buffer1.sync);
		}
		this.gl.deleteTexture(this.sourceTexture);
		this.gl.deleteTexture(this.horizontalTexture.texture);
		this.gl.deleteTexture(this.outputTexture.texture);
		this.gl.deleteProgram(this.compiledHorizontal.program);
		this.gl.deleteProgram(this.compiledVertical.program);
		this.gl.deleteShader(this.compiledHorizontal.vertexShader);
		this.gl.deleteShader(this.compiledHorizontal.fragmentShader);
		this.gl.deleteShader(this.compiledVertical.vertexShader);
		this.gl.deleteShader(this.compiledVertical.fragmentShader);
		this.gl.deleteFramebuffer(this.horizontalFramebuffer);
		this.gl.deleteFramebuffer(this.outputFramebuffer);
		this.gl.deleteBuffer(this.quadBuffer);
		this.gl.deleteBuffer(this.buffer0.pbo);
		this.gl.deleteBuffer(this.buffer1.pbo);
		this.gl.deleteVertexArray(this.horizontalVAO);
		this.gl.deleteVertexArray(this.verticalVAO);
	}
}
