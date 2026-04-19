import {
	createDefaultQuadBuffer,
	createEmptyTexture,
	createFramebuffer,
	createProgram,
	createTextureFromImage,
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
	filter: "box" | "hamming" | "lanczos2" | "lanczos3" | "mks2013";
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
	const gl = to.getContext("webgl2", { premultipliedAlpha: false });
	if (!gl) {
		throw new Error("webgl2 context not found");
	}

	const targetWidth = Math.round(options.targetWidth);
	const targetHeight = Math.round(options.targetHeight);

	const srcWidth = from.width;
	const srcHeight = from.height;
	const scaleX = targetWidth / srcWidth;
	const scaleY = targetHeight / srcHeight;
	const windowSize = getResizeWindow(options.filter);
	const sourceTexture = createTextureFromImage(gl, from);
	const quadBuffer = createDefaultQuadBuffer(gl);

	const horizontalTexture = createEmptyTexture(gl, targetWidth, srcHeight);
	const horizontalFramebuffer = createFramebuffer(gl, horizontalTexture);
	const compiledHorizontal = createProgram(
		gl,
		vsSource,
		generateHorizontalShader(options.filter)
	)!;
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
		gl.getUniformLocation(horizontalProgram, "u_filterScale"),
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
		generateVerticalShader(options.filter)
	)!;
	const verticalProgram = compiledVertical.program;
	gl.useProgram(verticalProgram);
	useDefaultQuadBuffer(
		gl,
		verticalProgram,
		quadBuffer,
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
		gl.getUniformLocation(verticalProgram, "u_filterScale"),
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
}

export class Scaler {
	public canvas: OffscreenCanvas;
	gl: WebGL2RenderingContext;

	windowSize: number;

	sourceTexture: WebGLTexture;
	horizontalTexture: WebGLTexture;

	quadBuffer: WebGLBuffer;

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

	public constructor(
		canvas: OffscreenCanvas,
		filter: ResizeOptions["filter"]
	) {
		this.canvas = canvas;

		const gl = this.canvas.getContext("webgl2", {
			premultipliedAlpha: false,
		});
		if (!gl) throw new Error("Failed to initialize WebGL2 context");

		this.gl = gl;

		this.windowSize = getResizeWindow(filter);

		this.sourceTexture = createEmptyTexture(
			this.gl,
			canvas.width,
			canvas.height
		);
		this.horizontalTexture = createEmptyTexture(
			gl,
			canvas.width,
			canvas.height
		);

		this.quadBuffer = createDefaultQuadBuffer(this.gl);

		this.horizontalFramebuffer = createFramebuffer(
			this.gl,
			this.horizontalTexture
		);

		this.compiledHorizontal = createProgram(
			this.gl,
			vsSource,
			generateHorizontalShader(filter)
		)!;
		this.compiledVertical = createProgram(
			this.gl,
			vsSource,
			generateVerticalShader(filter)
		)!;
	}
	public process(frame: VideoFrame, preserveAspectRatio = true) {
		if (frame.displayWidth === 0 || frame.displayHeight === 0) {
			throw new Error("source image width or height is 0");
		}
		if (this.canvas.width === 0 || this.canvas.height === 0) {
			throw new Error("target canvas width or height is 0");
		}

		const srcWidth = frame.displayWidth;
		const srcHeight = frame.displayHeight;

		const srcAspectRatio = srcWidth / srcHeight;
		const canvasAspectRatio = this.canvas.width / this.canvas.height;

		let targetWidth = this.canvas.width;
		let targetHeight = this.canvas.height;

		if (srcAspectRatio != canvasAspectRatio && preserveAspectRatio) {
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

		this.gl.clearColor(0, 0, 0, 1);
		this.gl.clear(this.gl.COLOR_BUFFER_BIT);

		updateTextureFromImage(this.gl, this.sourceTexture, frame);
		updateTextureFromEmpty(
			this.gl,
			this.horizontalTexture,
			targetWidth,
			srcHeight
		);

		this.gl.useProgram(this.compiledHorizontal.program);
		useDefaultQuadBuffer(
			this.gl,
			this.compiledHorizontal.program,
			this.quadBuffer,
			"a_position",
			"a_texCoord"
		);
		const radiusX = scaleX < 1 ? this.windowSize / scaleX : this.windowSize;
		this.gl.disable(this.gl.BLEND);
		this.gl.uniform1i(
			this.gl.getUniformLocation(
				this.compiledHorizontal.program,
				"u_image"
			),
			0
		);
		this.gl.uniform1f(
			this.gl.getUniformLocation(
				this.compiledHorizontal.program,
				"u_textureWidth"
			),
			srcWidth
		);
		this.gl.uniform1f(
			this.gl.getUniformLocation(
				this.compiledHorizontal.program,
				"u_filterScale"
			),
			this.windowSize / radiusX
		);
		this.gl.uniform1f(
			this.gl.getUniformLocation(
				this.compiledHorizontal.program,
				"u_radius"
			),
			radiusX
		);
		this.gl.activeTexture(this.gl.TEXTURE0);
		this.gl.bindTexture(this.gl.TEXTURE_2D, this.sourceTexture);
		this.gl.viewport(0, 0, targetWidth, srcHeight);
		this.gl.bindFramebuffer(
			this.gl.FRAMEBUFFER,
			this.horizontalFramebuffer
		);
		this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);

		this.gl.useProgram(this.compiledVertical.program);
		useDefaultQuadBuffer(
			this.gl,
			this.compiledVertical.program,
			this.quadBuffer,
			"a_position",
			"a_texCoord"
		);
		const radiusY = scaleY < 1 ? this.windowSize / scaleY : this.windowSize;
		this.gl.uniform1i(
			this.gl.getUniformLocation(
				this.compiledVertical.program,
				"u_image"
			),
			0
		);
		this.gl.uniform1f(
			this.gl.getUniformLocation(
				this.compiledVertical.program,
				"u_textureHeight"
			),
			srcHeight
		);
		this.gl.uniform1f(
			this.gl.getUniformLocation(
				this.compiledVertical.program,
				"u_filterScale"
			),
			this.windowSize / radiusY
		);
		this.gl.uniform1f(
			this.gl.getUniformLocation(
				this.compiledVertical.program,
				"u_radius"
			),
			radiusY
		);
		this.gl.activeTexture(this.gl.TEXTURE0);
		this.gl.bindTexture(this.gl.TEXTURE_2D, this.horizontalTexture);
		this.gl.viewport(offsetX, offsetY, targetWidth, targetHeight);
		this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
		this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
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
	}
}
