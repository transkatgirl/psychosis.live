import {
	createDefaultQuadBuffer,
	createEmptyTexture,
	createFramebuffer,
	createProgram,
	createTextureFromImage,
	createVAOForQuadBuffer,
	updateTextureFromEmpty,
	updateTextureFromImage,
	useDefaultQuadBuffer,
} from "./gl-helper";
import {
	generateHorizontalShader,
	generateVerticalShader,
	getResizeWindow,
	vsSource,
} from "./shaders";

export interface ResizeOptions {
	targetWidth: number;
	targetHeight: number;
	filter: "box" | "hamming" | "lanczos2" | "lanczos3" | "mks2013" | "mks2021";
	precise: boolean;
}

export function resize(
	from:
		| ImageBitmap
		| ImageData
		| HTMLImageElement
		| HTMLCanvasElement
		| OffscreenCanvas,
	to: HTMLCanvasElement,
	options: ResizeOptions
) {
	if (from.width === 0 || from.height === 0) {
		throw new Error("source canvas width or height is 0");
	}
	if (to.width === 0 || to.height === 0) {
		throw new Error("target canvas width or height is 0");
	}
	const gl = to.getContext("webgl2", {
		alpha: false,
		premultipliedAlpha: false,
		preserveDrawingBuffer: false,
	});
	if (!gl) {
		throw new Error("webgl2 context not found");
	}
	gl.clearColor(0, 0, 0, 1);
	//if (options.precise) {
	gl.getExtension("EXT_color_buffer_half_float");
	//}

	const targetWidth = Math.round(options.targetWidth);
	const targetHeight = Math.round(options.targetHeight);

	const srcWidth = from.width;
	const srcHeight = from.height;
	const scaleX = targetWidth / srcWidth;
	const scaleY = targetHeight / srcHeight;
	const windowSize = getResizeWindow(options.filter);
	const sourceTexture = createTextureFromImage(gl, from);
	const quadBuffer = createDefaultQuadBuffer(gl);
	const flippedQuadBuffer = createDefaultQuadBuffer(gl, true);

	const horizontalTexture = createEmptyTexture(
		gl,
		targetWidth,
		srcHeight,
		//options.precise
		true
	);
	const horizontalFramebuffer = createFramebuffer(gl, horizontalTexture);
	const compiledHorizontal = createProgram(
		gl,
		vsSource,
		generateHorizontalShader(options.filter, options.precise)
	);
	const horizontalProgram = compiledHorizontal.program;
	gl.useProgram(horizontalProgram);
	useDefaultQuadBuffer(
		gl,
		horizontalProgram,
		quadBuffer,
		"a_position",
		"a_texCoord"
	);
	const radiusX = scaleX < 1 ? windowSize / scaleX : windowSize;
	gl.disable(gl.BLEND);
	gl.uniform1i(gl.getUniformLocation(horizontalProgram, "u_image"), 0);
	gl.uniform1f(
		gl.getUniformLocation(horizontalProgram, "u_textureWidth"),
		srcWidth
	);
	gl.uniform1f(
		gl.getUniformLocation(horizontalProgram, "u_scale"),
		windowSize / radiusX
	);
	gl.uniform1f(gl.getUniformLocation(horizontalProgram, "u_radius"), radiusX);
	gl.activeTexture(gl.TEXTURE0);
	gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
	gl.viewport(0, 0, targetWidth, srcHeight);
	gl.bindFramebuffer(gl.FRAMEBUFFER, horizontalFramebuffer);
	gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

	const compiledVertical = createProgram(
		gl,
		vsSource,
		generateVerticalShader(options.filter, options.precise)
	);
	const verticalProgram = compiledVertical.program;
	gl.useProgram(verticalProgram);
	useDefaultQuadBuffer(
		gl,
		verticalProgram,
		flippedQuadBuffer,
		"a_position",
		"a_texCoord"
	);
	const radiusY = scaleY < 1 ? windowSize / scaleY : windowSize;
	gl.uniform1i(gl.getUniformLocation(verticalProgram, "u_image"), 0);
	gl.uniform1f(
		gl.getUniformLocation(verticalProgram, "u_textureHeight"),
		srcHeight
	);
	gl.uniform1f(
		gl.getUniformLocation(verticalProgram, "u_scale"),
		windowSize / radiusY
	);
	gl.uniform1f(gl.getUniformLocation(verticalProgram, "u_radius"), radiusY);
	gl.activeTexture(gl.TEXTURE0);
	gl.bindTexture(gl.TEXTURE_2D, horizontalTexture);
	gl.viewport(0, 0, targetWidth, targetHeight);
	gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

	gl.deleteTexture(sourceTexture);
	gl.deleteTexture(horizontalTexture);
	gl.deleteProgram(compiledHorizontal.program);
	gl.deleteProgram(compiledVertical.program);
	gl.deleteShader(compiledHorizontal.vertexShader);
	gl.deleteShader(compiledHorizontal.fragmentShader);
	gl.deleteShader(compiledVertical.vertexShader);
	gl.deleteShader(compiledVertical.fragmentShader);
	gl.deleteFramebuffer(horizontalFramebuffer);
	gl.deleteBuffer(quadBuffer);
	gl.deleteBuffer(flippedQuadBuffer);
}

export class Scaler {
	public canvas: OffscreenCanvas;
	gl: WebGL2RenderingContext;
	precise: boolean;

	windowSize: number;

	sourceTexture: WebGLTexture;
	horizontalTexture: WebGLTexture;

	lastSourceWidth = -1;
	lastSourceHeight = -1;
	lastRadiusX = -1;
	lastRadiusY = -1;
	horizontalTextureWidth = -1;
	horizontalTextureHeight = -1;

	quadBuffer: WebGLBuffer;
	flippedQuadBuffer: WebGLBuffer;

	horizontalFramebuffer: WebGLFramebuffer;

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
		filter: ResizeOptions["filter"],
		precise: boolean
	) {
		this.canvas = canvas;

		const gl = this.canvas.getContext("webgl2", {
			alpha: false,
			premultipliedAlpha: false,
			preserveDrawingBuffer: false,
		});
		if (!gl) throw new Error("Failed to initialize WebGL2 context");

		this.gl = gl;
		this.gl.clearColor(0, 0, 0, 1);
		//if (precise) {
		this.gl.getExtension("EXT_color_buffer_half_float");
		//}
		this.precise = precise;

		this.windowSize = getResizeWindow(filter);

		this.sourceTexture = createEmptyTexture(this.gl, 1, 1, false);
		this.horizontalTexture = createEmptyTexture(
			this.gl,
			1,
			1,
			//precise
			true
		);

		this.quadBuffer = createDefaultQuadBuffer(this.gl);
		this.flippedQuadBuffer = createDefaultQuadBuffer(this.gl, true);

		this.horizontalFramebuffer = createFramebuffer(
			this.gl,
			this.horizontalTexture
		);

		this.compiledHorizontal = createProgram(
			this.gl,
			vsSource,
			generateHorizontalShader(filter, precise)
		);
		this.compiledVertical = createProgram(
			this.gl,
			vsSource,
			generateVerticalShader(filter, precise)
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
			this.flippedQuadBuffer,
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
	public process(frame: VideoFrame, preserveAspectRatio = true): DOMRectInit {
		if (frame.displayWidth === 0 || frame.displayHeight === 0) {
			throw new Error("source image width or height is 0");
		}
		if (this.canvas.width === 0 || this.canvas.height === 0) {
			throw new Error("target canvas width or height is 0");
		}

		const gl = this.gl;

		const srcWidth = frame.displayWidth;
		const srcHeight = frame.displayHeight;

		const srcAspectRatio = srcWidth / srcHeight;
		const canvasAspectRatio = this.canvas.width / this.canvas.height;

		let targetWidth = this.canvas.width;
		let targetHeight = this.canvas.height;

		const EPSILON = 1e-6;
		if (
			Math.abs(srcAspectRatio - canvasAspectRatio) > EPSILON &&
			preserveAspectRatio
		) {
			if (srcAspectRatio > canvasAspectRatio) {
				targetHeight = Math.round(this.canvas.width / srcAspectRatio);
			} else {
				targetWidth = Math.round(this.canvas.height * srcAspectRatio);
			}
		}

		const scaleX = targetWidth / srcWidth;
		const scaleY = targetHeight / srcHeight;

		let offsetX = 0;
		if (this.canvas.width > targetWidth) {
			offsetX = Math.round((this.canvas.width - targetWidth) / 2);
		}

		let offsetY = 0;
		if (this.canvas.height > targetHeight) {
			offsetY = Math.round((this.canvas.height - targetHeight) / 2);
		}

		updateTextureFromImage(
			gl,
			this.sourceTexture,
			frame,
			srcWidth,
			srcHeight
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
				//this.precise
				true
			);
			this.horizontalTextureWidth = targetWidth;
			this.horizontalTextureHeight = srcHeight;
		}

		const radiusX = scaleX < 1 ? this.windowSize / scaleX : this.windowSize;
		gl.useProgram(this.compiledHorizontal.program);
		if (srcWidth !== this.lastSourceWidth) {
			gl.uniform1f(this.horizontalLocations.textureWidth, srcWidth);
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
		gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
		gl.viewport(0, 0, targetWidth, srcHeight);
		gl.bindFramebuffer(gl.FRAMEBUFFER, this.horizontalFramebuffer);
		gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

		const radiusY = scaleY < 1 ? this.windowSize / scaleY : this.windowSize;
		gl.useProgram(this.compiledVertical.program);
		if (srcHeight !== this.lastSourceHeight) {
			gl.uniform1f(this.verticalLocations.textureHeight, srcHeight);
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
		gl.viewport(offsetX, offsetY, targetWidth, targetHeight);
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

		return {
			x: offsetX,
			y: offsetY,
			width: targetWidth,
			height: targetHeight,
		};
	}
	public clear() {
		this.gl.clearColor(0, 0, 0, 1);
		this.gl.clear(this.gl.COLOR_BUFFER_BIT);
	}
	public destroy() {
		this.gl.deleteTexture(this.sourceTexture);
		this.gl.deleteTexture(this.horizontalTexture);
		this.gl.deleteProgram(this.compiledHorizontal.program);
		this.gl.deleteProgram(this.compiledVertical.program);
		this.gl.deleteShader(this.compiledHorizontal.vertexShader);
		this.gl.deleteShader(this.compiledHorizontal.fragmentShader);
		this.gl.deleteShader(this.compiledVertical.vertexShader);
		this.gl.deleteShader(this.compiledVertical.fragmentShader);
		this.gl.deleteFramebuffer(this.horizontalFramebuffer);
		this.gl.deleteBuffer(this.quadBuffer);
		this.gl.deleteBuffer(this.flippedQuadBuffer);
		this.gl.deleteVertexArray(this.horizontalVAO);
		this.gl.deleteVertexArray(this.verticalVAO);
	}
}
