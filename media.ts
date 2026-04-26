import * as sdpTransform from "sdp-transform";
import { Scaler, type ResizeOptions } from "./pica-gpu";

export function convertAudioBitrate(
	bitrate: number,
	originalChannelCount: number,
	newChannelCount: number
) {
	// Formula from https://wiki.hydrogenaudio.org/index.php?title=Bitrate#Equivalent_bitrate_estimates_for_multichannel_audio
	return Math.round(
		(Math.pow(newChannelCount, 0.75) /
			Math.pow(originalChannelCount, 0.75)) *
			bitrate
	);
}

export function calculateReasonableAudioBitrateKbps(channels: number) {
	return Math.min(
		// 256 kbit/s stereo is a bit high (see: https://wiki.hydrogenaudio.org/index.php?title=Opus#Music_encoding_quality), but useful to mitigate generation loss
		convertAudioBitrate(16, 2, channels) * 16,
		// Opus supports a maximum bitrate of 510 kbit/s
		510
	);
}

export function calculateReasonableMinimumAudioBitrateKbps(channels: number) {
	/* Possible bitrate bounds

	---

	real-world quality

	https://wiki.hydrogenaudio.org/index.php?title=Opus#Indicative_bitrate_and_quality

	- approaching transparent mono speech @ 24 kbit/s
	- transparent mono speech @ 32 kbit/s
	- approaching transparent stereo music @ 96 kbit/s
	- near-transparent stereo music @ 128 kbit/s
	- transparent stereo music @ 160 - 192 kbit/s

	https://wiki.hydrogenaudio.org/index.php?title=Opus#CELT_layer_latency_versus_quality/bitrate_trade-off

	to account for 10ms frames, increase bitrate by 10%

	---

	note: encoder settings are contrained VBR, 10ms min frame size, assume max complexity & no packet loss

	https://github.com/xiph/opus/blob/788cc89ce4f2c42025d8c70ec1b4457dc89cd50f/src/opus_encoder.c#L1027

	to account for 10ms frames, add +3000 bits/s for mono, 5000 bits/s stereo

	---

	CELT threshold

	https://github.com/xiph/opus/blob/788cc89ce4f2c42025d8c70ec1b4457dc89cd50f/src/opus_encoder.c#L1422
	- 90% speech confidence is the max
	https://github.com/xiph/opus/blob/788cc89ce4f2c42025d8c70ec1b4457dc89cd50f/src/opus_encoder.c#L180
	https://github.com/xiph/opus/blob/788cc89ce4f2c42025d8c70ec1b4457dc89cd50f/src/opus_encoder.c#L1495
	- highest threshold is 58600 bits/s for mono, 40600 bits/s for stereo
	https://github.com/xiph/opus/blob/788cc89ce4f2c42025d8c70ec1b4457dc89cd50f/src/opus_encoder.c#L1504
	- threshold is increased by 8000 bits/s in VOIP mode
	https://github.com/xiph/opus/blob/788cc89ce4f2c42025d8c70ec1b4457dc89cd50f/src/opus_encoder.c#L1507
	- hysteresis threshold is increased by 4000 bits/s

	[non-voip] total threshold is 62600 bits/s for mono (lower for stereo)
	[voip] total threshold is 70600 bits/s for mono (lower for stereo)

	---

	fullband stereo threshold

	https://github.com/xiph/opus/blob/788cc89ce4f2c42025d8c70ec1b4457dc89cd50f/src/opus_encoder.c#L148
	- 16000 bits/s for fullband including hysteresis

	https://github.com/xiph/opus/blob/788cc89ce4f2c42025d8c70ec1b4457dc89cd50f/src/opus_encoder.c#L176
	https://github.com/xiph/opus/blob/788cc89ce4f2c42025d8c70ec1b4457dc89cd50f/src/opus_encoder.c#L1443
	- 20000 bits/s for stereo including hysteresis

	https://github.com/xiph/opus/blob/788cc89ce4f2c42025d8c70ec1b4457dc89cd50f/src/opus_encoder.c#L2322
	- stereo width is reduced below 32000 bits/s

	https://github.com/xiph/opus/blob/788cc89ce4f2c42025d8c70ec1b4457dc89cd50f/src/opus_encoder.c#L2059
	- high frequencies are attenuated a perceptable amount when CELT is allocated less than 3500 bits/s
	- this is negligible at a total bitrate of > 32000 bits/s (see https://github.com/xiph/opus/blob/788cc89ce4f2c42025d8c70ec1b4457dc89cd50f/src/opus_encoder.c#L978)

	https://github.com/xiph/opus/blob/788cc89ce4f2c42025d8c70ec1b4457dc89cd50f/src/opus_encoder.c#L1653
	- at certain bitrates (> 44000 bits/s for mono, > 88000 bits/s for stereo), fullband will be used even if the input signal is limited bandwidth

	*/

	if (channels == 1) {
		return 40;
	}

	return Math.min(
		// minimum of 64 kbit/s stereo chosen based on https://wiki.hydrogenaudio.org/index.php?title=Opus#Indicative_bitrate_and_quality
		convertAudioBitrate(4, 2, channels) * 16,
		// Opus supports a maximum bitrate of 510 kbit/s
		510
	);
}

function calculateStickyDynamicAudioBitrateTarget(channels: number) {
	// see above function for reference regarding how these targets were chosen
	// returned values will be multiplied against 32 kbit/s to calculate the final value

	if (channels == 1) {
		return 3; // 96 kbit/s
	}

	if (channels == 2) {
		return 4; // 128 kbit/s
	}

	return convertAudioBitrate(4, 2, channels);
}

export function calculateReasonableVideoBitrateKbps(
	width: number,
	height: number,
	framerate: number
) {
	// Based loosely on https://support.google.com/youtube/answer/2853702

	let bitrate = Math.max(
		Math.round((height * width * 4.8) / 100000) * 100,
		4000
	);

	return Math.round(bitrate * Math.max(1 + (framerate - 30) * (0.5 / 30), 1));
}

export function mungeSDP(sdp: string, stereo: boolean): string {
	const parsed = sdpTransform.parse(sdp);

	for (const media of parsed.media) {
		if (media.type == "audio") {
			let opus: number | undefined;
			let hasRTX = false;

			for (const entry of media.rtp) {
				if (entry.codec == "opus") {
					opus = entry.payload;
				}
				if (entry.codec == "rtx") {
					hasRTX = true;
				}
			}

			if (media.rtcpFb && opus) {
				for (const entry of media.rtcpFb) {
					if (entry.payload == opus && entry.type == "nack") {
						hasRTX = true;
					}
				}
			}

			for (const entry of media.fmtp) {
				if (entry.payload == opus) {
					// make sure DTX & CBR is disabled; make sure FEC is enabled

					console.log("updating opus parameters using SDP munging");

					const params = sdpTransform.parseParams(entry.config);

					if (stereo) {
						if (!("stereo" in params)) {
							params["stereo"] = 1;
						}
					} else {
						delete params["stereo"];
					}

					delete params["usedtx"];
					delete params["cbr"];

					if (!("minptime" in params)) {
						// frame sizes <10ms disable SILK; see https://wiki.hydrogenaudio.org/index.php?title=Opus#Packet_overhead_in_interactive_applications
						params["minptime"] = 10;
					}

					if (!("useinbandfec" in params)) {
						params["useinbandfec"] = 1;
					}

					entry.config = "";

					for (const [key, value] of Object.entries(params)) {
						if (entry.config.length == 0) {
							entry.config = key + "=" + value;
						} else {
							entry.config =
								entry.config + ";" + key + "=" + value;
						}
					}
				}
			}

			if (opus && !hasRTX && media.payloads) {
				// enable audio RTX
				// based on:
				// - https://groups.google.com/g/discuss-webrtc/c/JVRU91Xwb6U/m/0Mb8CQV7AAAJ
				// - https://issues.webrtc.org/issues/42229513

				let payloads = sdpTransform.parsePayloads(media.payloads);
				payloads.splice(payloads.indexOf(opus) + 1, 0, 112);

				let payloadOrdering = (a: any, b: any) => {
					const indexA = payloads.indexOf(a.payload);
					const indexB = payloads.indexOf(b.payload);
					const orderA = indexA >= 0 ? indexA : Number.MAX_VALUE;
					const orderB = indexB >= 0 ? indexB : Number.MAX_VALUE;
					return orderA - orderB;
				};

				if (media.rtcpFb) {
					console.log("force enabling audio NACK using SDP munging");
					media.rtcpFb.push({ payload: opus, type: "nack" });
					media.rtcpFb.sort(payloadOrdering);
				}
				/*media.rtp.push({
					payload: 112,
					codec: "rtx",
					rate: 48000,
					encoding: 2,
				});
				media.rtp.sort(payloadOrdering);
				media.fmtp.push({
					payload: 112,
					config: "apt=111",
				});
				media.fmtp.sort(payloadOrdering);
				media.payloads.replace("111 ", "111 112 ");*/
			}
		}
	}

	return sdpTransform.write(parsed);
}

export function mungeSDPOfferAnswer(sdp: string): string {
	const parsed = sdpTransform.parse(sdp);

	// UGLY HACK for enabling stereo audio

	for (const media of parsed.media) {
		if (media.type == "audio") {
			let opus: number | undefined;

			for (const entry of media.rtp) {
				if (entry.codec == "opus") {
					opus = entry.payload;
				}
			}

			for (const entry of media.fmtp) {
				if (entry.payload == opus && !entry.config.includes("stereo")) {
					console.log(
						"force enabling stereo audio using SDP munging"
					);
					if (entry.config.length == 0) {
						entry.config = "stereo=1";
					} else {
						entry.config = entry.config + ";stereo=1";
					}
				}
			}
		}
	}

	return sdpTransform.write(parsed);
}

export function buildSenderEncoding(
	kind: string,
	maxVideoBitrate?: number,
	maxFramerate?: number,
	maxAudioBitrate?: number,
	videoPriority?: RTCPriorityType,
	audioPriority?: RTCPriorityType
): RTCRtpEncodingParameters {
	const encoding: RTCRtpEncodingParameters = {
		networkPriority: "low", // DSCP tagging can cause problems on some networks
	};

	if (kind == "video") {
		if (maxVideoBitrate) {
			encoding.maxBitrate = maxVideoBitrate * 1000;
		}

		if (maxFramerate) {
			encoding.maxFramerate = maxFramerate;
		}

		if (videoPriority) {
			encoding.priority = videoPriority;
		}
	}

	if (kind == "audio") {
		if (maxAudioBitrate) {
			encoding.maxBitrate = maxAudioBitrate * 1000;
		}

		if (audioPriority) {
			encoding.priority = audioPriority;
		}
	}

	return encoding;
}

export async function setSenderSettings(
	sender: RTCRtpSender,
	degradationPreference?: RTCDegradationPreference
) {
	const parameters = sender.getParameters();

	if (degradationPreference) {
		parameters.degradationPreference = degradationPreference;
	}

	await sender.setParameters(parameters);
}

export function setReceiverSettings(
	receiver: RTCRtpReceiver,
	jitterBufferTarget?: number
) {
	if (jitterBufferTarget) {
		receiver.jitterBufferTarget = jitterBufferTarget;
	}
}

export function setCodecPreferences(
	transceiver: RTCRtpTransceiver,
	preferredOrder: string[]
) {
	let kind = transceiver.receiver.track.kind;

	if (transceiver.sender.track?.kind) {
		kind = transceiver.sender.track.kind;
	}

	let codecs = RTCRtpReceiver.getCapabilities(kind)?.codecs;

	if (codecs) {
		codecs = sortCodecs(codecs, preferredOrder);
		transceiver.setCodecPreferences(codecs);
	}
}

function sortCodecs(codecs: RTCRtpCodec[], preferredOrder: string[]) {
	return codecs.sort((a, b) => {
		const indexA = preferredOrder.indexOf(a.mimeType);
		const indexB = preferredOrder.indexOf(b.mimeType);
		const orderA = indexA >= 0 ? indexA : Number.MAX_VALUE;
		const orderB = indexB >= 0 ? indexB : Number.MAX_VALUE;
		if (orderA - orderB == 0) {
			return (
				(b.channels ? b.channels : 0) - (a.channels ? a.channels : 0)
			);
		} else {
			return orderA - orderB;
		}
	});
}

export interface AdaptiveData {
	framesEncoded?: number;
	framesEncodedOlder?: number;
	qpSum?: number; // 1 scan interval ago
	qpSumOlder?: number; // 2 scan intervals ago

	skipNextInterval?: boolean;
	lastTarget?: [number, number];
	lastInputResolution?: [number, number];
}

interface AdaptiveDataAnalysis {
	codecData?: CodecAdaptiveData;
	framesAnalyzed?: number;
	qpAvg?: number;
}

function analyzeAdaptiveData(stats: [string, any][], data: AdaptiveData) {
	let analysis: AdaptiveDataAnalysis = {};

	if (!data.framesEncodedOlder) {
		data.qpSumOlder = undefined;
	}

	let framesEncoded;
	let qpSum;

	for (const [_, report] of stats) {
		if (report.type == "codec") {
			// We manually adjust the QP targets to be more aggressive, as sharper upscalers benefit more from a lower resolution + high quality stream than a higher resolution + low quality one.

			if (report.mimeType.toLowerCase() == "video/av1") {
				analysis.codecData = adjustCodecData(AV1_ADAPTIVE_DATA, 0.4);
			}
			if (report.mimeType.toLowerCase() == "video/vp9") {
				analysis.codecData = adjustCodecData(VP9_ADAPTIVE_DATA, 0.4);
			}
			if (report.mimeType.toLowerCase() == "video/vp8") {
				analysis.codecData = adjustCodecData(VP8_ADAPTIVE_DATA, 0.4);
			}
			if (report.mimeType.toLowerCase() == "video/h264") {
				analysis.codecData = adjustCodecData(H264_ADAPTIVE_DATA, 0.4);
			}
		}
		if (report.type == "outbound-rtp" && report.kind == "video") {
			if (report.framesEncoded) {
				if (data.framesEncoded) {
					framesEncoded =
						report.framesEncoded -
						(data.framesEncodedOlder
							? data.framesEncodedOlder
							: data.framesEncoded);
				}

				data.framesEncodedOlder = data.framesEncoded;
				data.framesEncoded = report.framesEncoded;
			}
			if (report.qpSum) {
				if (data.qpSum) {
					qpSum =
						report.qpSum -
						(data.qpSumOlder ? data.qpSumOlder : data.qpSum);
				}

				data.qpSumOlder = data.qpSum;
				data.qpSum = report.qpSum;
			}
		}
	}

	if (framesEncoded) {
		analysis.framesAnalyzed = framesEncoded;

		if (qpSum) {
			analysis.qpAvg = qpSum / framesEncoded;
		}
	}

	return analysis;
}

export interface AdaptiveTargets {
	audio?: AdaptiveAudioTargets;
	video?: AdaptiveVideoTargets;
}

export interface AdaptiveAudioTargets {
	channels: number;
	bitrate?: number;
	linearDecrease?: boolean; // Should be enabled if RED is enabled
}

export interface AdaptiveVideoTargets {
	width?: number;
	height?: number;
	framerate: number;
	bitrate?: number;
}

export async function adaptiveSettings(
	pc: RTCPeerConnection,
	peerData: AdaptiveData,
	targets: AdaptiveTargets,
	peerScaler?: MediaScaler // See adaptiveVideoSettings
) {
	const stats = Array.from(await pc.getStats());

	let audioParameters;
	let videoParameters;

	for (const transceiver of pc.getTransceivers()) {
		if (transceiver.sender.track?.kind == "audio" && targets.audio) {
			if (audioParameters) {
				throw "Unsupported transceiver count";
			}

			audioParameters = transceiver.sender.getParameters();
			adaptiveAudioBitrate(stats, audioParameters, targets.audio);
			await transceiver.sender.setParameters(audioParameters);
		}
		if (transceiver.sender.track?.kind == "video" && targets.video) {
			if (videoParameters) {
				throw "Unsupported transceiver count";
			}

			videoParameters = transceiver.sender.getParameters();
			adaptiveVideoSettings(
				stats,
				videoParameters,
				peerData,
				targets.video,
				peerScaler
			);
			await transceiver.sender.setParameters(videoParameters);
		}
	}
}

function adaptiveAudioBitrate(
	stats: [string, any][],
	parameters: RTCRtpSendParameters,
	targets: AdaptiveAudioTargets
) {
	const minBitrate =
		calculateReasonableMinimumAudioBitrateKbps(targets.channels) * 1000;
	const maxBitrate =
		(targets.bitrate
			? targets.bitrate
			: calculateReasonableAudioBitrateKbps(targets.channels)) * 1000;
	const stickyTarget = calculateStickyDynamicAudioBitrateTarget(
		targets.channels
	);

	let bitrateLower = 0;
	let bitrateUpper = Infinity;
	let usingOpus = false;

	for (const [_, report] of stats) {
		if (
			report.type == "outbound-rtp" &&
			report.kind == "video" &&
			report.targetBitrate
		) {
			if (targets.linearDecrease) {
				// minimum of 32 kbit/s (see calculateReasonableMinimumAudioBitrateKbps for details)
				bitrateLower =
					Math.max(Math.floor(report.targetBitrate / 128000), 1) *
					32000;
				bitrateUpper =
					Math.max(Math.ceil(report.targetBitrate / 128000), 1) *
					32000;
			} else {
				// prefer staying above stickyTarget * 32 kbit/s

				if (report.targetBitrate >= 64000 * stickyTarget) {
					bitrateLower =
						Math.max(
							Math.floor(report.targetBitrate / 128000),
							stickyTarget
						) * 32000;
					bitrateUpper =
						Math.max(
							Math.ceil(report.targetBitrate / 128000),
							stickyTarget
						) * 32000;
				} else {
					// minimum of 32 kbit/s (see calculateReasonableMinimumAudioBitrateKbps for details)

					bitrateLower =
						Math.max(Math.floor(report.targetBitrate / 64000), 1) *
						32000;
					bitrateUpper =
						Math.max(Math.ceil(report.targetBitrate / 64000), 1) *
						32000;
				}
			}

			bitrateLower = Math.min(
				Math.max(bitrateLower, minBitrate),
				maxBitrate
			);
			bitrateUpper = Math.min(
				Math.max(bitrateUpper, minBitrate),
				maxBitrate
			);
		}
		if (
			report.type == "codec" &&
			report.mimeType.toLowerCase() == "audio/opus"
		) {
			usingOpus = true;
		}
	}

	if (!usingOpus || bitrateLower == 0 || bitrateUpper == Infinity) {
		for (const encoding of parameters.encodings) {
			if (encoding.maxBitrate !== maxBitrate) {
				console.log("set audio maxBitrate", maxBitrate / 1000);
				encoding.maxBitrate = maxBitrate;
			}
		}
		return;
	}

	for (const encoding of parameters.encodings) {
		if (encoding.maxBitrate) {
			if (encoding.maxBitrate > bitrateUpper) {
				console.log("set audio maxBitrate", bitrateUpper / 1000);
				encoding.maxBitrate = bitrateUpper;
			}

			if (encoding.maxBitrate < bitrateLower) {
				console.log("set audio maxBitrate", bitrateLower / 1000);
				encoding.maxBitrate = bitrateLower;
			}
		} else {
			console.log("set audio maxBitrate", bitrateLower / 1000);
			encoding.maxBitrate = bitrateLower;
		}
	}
}

// Needs to be called every 2s (or 2.5s for behavior closer to libwebrtc)
function adaptiveVideoSettings(
	stats: [string, any][],
	parameters: RTCRtpSendParameters,
	data: AdaptiveData,
	targets: AdaptiveVideoTargets,
	peerScaler?: MediaScaler // Should only be specified if degradationPreference is maintain-framerate-and-resolution; implements custom adaptation algorithm
) {
	if (targets.width && targets.height) {
		const maxBitrate = targets.bitrate
			? targets.bitrate
			: calculateReasonableVideoBitrateKbps(
					targets.width,
					targets.height,
					targets.framerate
			  );

		for (const encoding of parameters.encodings) {
			if (encoding.maxBitrate !== maxBitrate * 1000) {
				console.log("set video maxBitrate", maxBitrate);
				encoding.maxBitrate = maxBitrate * 1000;
			}
		}
	}

	if (targets.width && targets.height && peerScaler) {
		// Based on:
		// - https://github.com/webrtc-sdk/webrtc/blob/m144_release/modules/video_coding/utility/quality_scaler.cc
		// - https://github.com/webrtc-sdk/webrtc/blob/m144_release/call/adaptation/video_stream_adapter.cc
		// - https://github.com/webrtc-sdk/webrtc/blob/6c1aa903241e69eb2eca64caad16779351bb1ab2/video/adaptation/video_stream_encoder_resource_manager.cc

		const analysis = analyzeAdaptiveData(stats, data);

		if (!analysis.codecData) {
			console.error("Unknown video codec");
			return;
		}

		if (targets.width * targets.height < MIN_PIXELS) {
			throw "Invalid configuration";
		}

		let hasAdapted = false;

		if (data.skipNextInterval) {
			data.skipNextInterval = false;
			if (
				data.lastInputResolution &&
				data.lastInputResolution[0] === targets.width &&
				data.lastInputResolution[1] === targets.height
			)
				return;
			hasAdapted = true;
		} else if (data.skipNextInterval !== undefined) {
			data.skipNextInterval = true;
		}

		data.lastInputResolution = [targets.width, targets.height];

		let pixels = MIN_PIXELS;
		let framerate = Math.min(30, targets.framerate);

		if (data.lastTarget) {
			pixels = data.lastTarget[0];
			framerate = data.lastTarget[1];
		} else {
			hasAdapted = true;
		}

		if (analysis.qpAvg) {
			if (
				(analysis.framesAnalyzed &&
					analysis.framesAnalyzed <= framerate * 0.8) ||
				analysis.codecData.highQP < analysis.qpAvg
			) {
				[pixels, framerate] = adaptDown(pixels, framerate);

				if (calculateHigherQP(analysis.codecData) > analysis.qpAvg) {
					[pixels, framerate] = adaptDown(pixels, framerate);
				}

				hasAdapted = true;

				if (data.skipNextInterval === undefined) {
					data.skipNextInterval = true;
				}
			} else if (
				analysis.codecData.lowQP >= analysis.qpAvg &&
				(!analysis.framesAnalyzed ||
					(analysis.framesAnalyzed &&
						analysis.framesAnalyzed >= framerate * 2))
			) {
				[pixels, framerate] = adaptUp(
					pixels,
					framerate,
					targets.framerate
				);

				hasAdapted = true;
			}
		}

		if (hasAdapted) {
			[pixels, framerate] = [
				Math.max(
					Math.min(pixels, targets.width * targets.height),
					MIN_PIXELS
				),
				Math.max(Math.min(framerate, targets.framerate), 5),
			];

			data.framesEncodedOlder = undefined;
			data.qpSumOlder = undefined;

			if (!data.lastTarget || data.lastTarget[1] != framerate) {
				for (const encoding of parameters.encodings) {
					if (encoding.maxFramerate) {
						const adjFramerate = Math.round(framerate);

						console.log("set video maxFramerate", adjFramerate);
						encoding.maxFramerate = adjFramerate;
					}
				}
			}

			if (!data.lastTarget || data.lastTarget[0] != pixels) {
				const [width, height] = adaptToPixelCount(
					targets.width,
					targets.height,
					pixels
				);

				console.log("set video scaler resolution", width, height);
				peerScaler.resize(width, height);
			}

			data.lastTarget = [pixels, framerate];
		}
	} else {
		let framerateLower = 0;
		let framerateUpper = Infinity;

		for (const [_, report] of stats) {
			if (
				report.type == "outbound-rtp" &&
				report.kind == "video" &&
				report.targetBitrate &&
				targets.framerate
			) {
				framerateLower = Math.min(
					Math.max(Math.floor(report.targetBitrate / 3000000), 1) *
						30,
					targets.framerate
				);
				framerateUpper = Math.min(
					Math.max(Math.ceil(report.targetBitrate / 3000000), 1) * 30,
					targets.framerate
				);
			}
		}

		if (framerateLower != 0 && framerateUpper != Infinity) {
			for (const encoding of parameters.encodings) {
				if (encoding.maxFramerate) {
					if (encoding.maxFramerate > framerateUpper) {
						console.log("set video maxFramerate", framerateUpper);
						encoding.maxFramerate = framerateUpper;
					}

					if (encoding.maxFramerate < framerateLower) {
						console.log("set video maxFramerate", framerateLower);
						encoding.maxFramerate = framerateLower;
					}
				}
			}
		}
	}
}

interface CodecAdaptiveData {
	lowQP: number;
	highQP: number;
}

function calculateHigherQP(data: CodecAdaptiveData) {
	return Math.min(data.highQP - data.lowQP + data.highQP, 63);
}

// https://github.com/webrtc-sdk/webrtc/blob/6c1aa903241e69eb2eca64caad16779351bb1ab2/modules/video_coding/codecs/h264/h264_encoder_impl.cc#L69
const H264_ADAPTIVE_DATA: CodecAdaptiveData = {
	lowQP: 24,
	highQP: 37,
};

// https://github.com/webrtc-sdk/webrtc/blob/6c1aa903241e69eb2eca64caad16779351bb1ab2/modules/video_coding/codecs/vp8/libvpx_vp8_encoder.cc#L91
const VP8_ADAPTIVE_DATA: CodecAdaptiveData = {
	lowQP: 39,
	highQP: 95,
};

// https://github.com/webrtc-sdk/webrtc/blob/6c1aa903241e69eb2eca64caad16779351bb1ab2/modules/video_coding/codecs/vp9/libvpx_vp9_encoder.cc#L107
const VP9_ADAPTIVE_DATA: CodecAdaptiveData = {
	lowQP: 149,
	highQP: 205,
};

// https://github.com/webrtc-sdk/webrtc/blob/6c1aa903241e69eb2eca64caad16779351bb1ab2/modules/video_coding/codecs/av1/libaom_av1_encoder.cc#L80
const AV1_ADAPTIVE_DATA: CodecAdaptiveData = {
	lowQP: 145,
	highQP: 205,
};

function adjustCodecData(
	data: CodecAdaptiveData,
	adjustment: number
): CodecAdaptiveData {
	const qpAdjustment = (data.highQP - data.lowQP) * adjustment;

	return {
		lowQP: data.lowQP - qpAdjustment,
		highQP: data.highQP - qpAdjustment,
	};
}

// Adaptation functions are loosely inspired by https://github.com/webrtc-sdk/webrtc/blob/m144_release/call/adaptation/video_stream_adapter.cc

const FHD_PIXELS = 1920 * 1080;
const HD_PIXELS = 1280 * 720;
export const MIN_PIXELS = 320 * 180; // MUST throw an error if max_pixels < MIN_PIXELS

function adaptUp(
	pixels: number,
	framerate: number,
	maxFramerate: number
): [number, number] {
	const adjustedFramerate = (framerate * 3) / 2;

	const SMOOTH_FPS = Math.min(60, maxFramerate);
	const MIN_PREFERRED_FPS = Math.min(30, maxFramerate);

	if (pixels >= FHD_PIXELS && framerate < maxFramerate) {
		return [pixels, Math.min(adjustedFramerate, maxFramerate)];
	}
	if (pixels >= HD_PIXELS && framerate < SMOOTH_FPS) {
		return [pixels, Math.min(adjustedFramerate, SMOOTH_FPS)];
	}
	if (framerate < MIN_PREFERRED_FPS) {
		return [pixels, MIN_PREFERRED_FPS];
	}

	const adjustedPixels = (pixels * 5) / 3;

	return [adjustedPixels, framerate];
}

function adaptDown(pixels: number, framerate: number): [number, number] {
	const adjustedFramerate = (framerate * 2) / 3;

	if (pixels < FHD_PIXELS && framerate > 60) {
		return [pixels, Math.max(adjustedFramerate, 60)];
	}
	if (pixels < HD_PIXELS && framerate > 30) {
		return [pixels, Math.max(adjustedFramerate, 30)];
	}
	if (pixels <= MIN_PIXELS && framerate > 22) {
		return [pixels, 22];
	}

	const adjustedPixels = Math.max((pixels * 3) / 5, MIN_PIXELS);

	return [adjustedPixels, framerate];
}

export function adaptToPixelCount(
	width: number,
	height: number,
	pixels: number
): [number, number] {
	let adjustedWidth = Math.round(Math.sqrt(pixels * (width / height)));
	let adjustedHeight = Math.round(Math.sqrt(pixels * (height / width)));

	return adaptToRatioExact(adjustedWidth, adjustedHeight, width / height);
}

export function adaptToRatioExact(
	width: number,
	height: number,
	ratio: number
): [number, number] {
	while (Math.abs(width / height - ratio) >= 1e-10) {
		if (width / height > ratio) {
			width--;
		} else {
			height--;
		}
	}

	return [width, height];
}

export class MediaScaler {
	public stream: MediaStream;
	videoId: string | undefined;
	scaler: Scaler | undefined;
	canvas: OffscreenCanvas | undefined;
	canvasSmooth: boolean = false;
	processor: any;
	generator: any;
	requestedResolution: [number, number] | undefined;
	public constructor(
		width: number,
		height: number,
		scaler: ResizeOptions["filter"] | "browser" | "browser_smooth",
		precise: boolean,
		linear: boolean
	) {
		if (
			!(
				"MediaStreamTrackProcessor" in window &&
				"MediaStreamTrackGenerator" in window
			)
		) {
			throw "Insertable Streams unsupported";
		}

		if (scaler === "browser" || scaler === "browser_smooth") {
			this.canvas = new OffscreenCanvas(
				Math.round(width),
				Math.round(height)
			);
			this.canvasSmooth = scaler === "browser_smooth";
		} else {
			this.scaler = new Scaler(
				new OffscreenCanvas(Math.round(width), Math.round(height)),
				scaler,
				precise,
				linear
			);
		}

		this.stream = new MediaStream();
	}
	public get videoIdentifier() {
		return this.videoId;
	}
	public resize(width: number, height: number) {
		this.requestedResolution = [Math.round(width), Math.round(height)];
	}
	public addTrack(track: MediaStreamTrack, preserveAspectRatio = true) {
		if (track.kind == "video") {
			if (this.videoId)
				throw "Scaler already has an attached video track.";

			this.videoId = track.id;

			// @ts-ignore
			this.processor = new MediaStreamTrackProcessor({
				track,
				maxBufferSize: 1,
			});
			// @ts-ignore
			this.generator = new MediaStreamTrackGenerator({
				kind: track.kind,
			});

			const scaler = this.scaler;
			const canvas = this.canvas;
			const self = this;

			let transformer;

			if (scaler) {
				let lastInit: VideoFrameInit | undefined;

				transformer = new TransformStream({
					transform(frame: VideoFrame, controller) {
						if (lastInit) {
							// If the renderer is running behind, the canvas (and resulting output frame) may be outdated by up to 1 frame (but not more, as scaler.process() forces the render queue to flush).
							// This is fine for now, but if want to add performance monitoring in the future, we'll need to fix this.

							controller.enqueue(
								new VideoFrame(scaler.canvas, lastInit)
							);
							lastInit = undefined;
						}

						if (self.requestedResolution) {
							scaler.canvas.width = self.requestedResolution[0];
							scaler.canvas.height = self.requestedResolution[1];
							self.requestedResolution = undefined;
						}

						lastInit = {
							timestamp: frame.timestamp,
							duration: frame.duration
								? frame.duration
								: undefined,
							alpha: "discard",
							visibleRect: scaler.process(
								frame,
								preserveAspectRatio
							),
						};
						frame.close();

						if (!preserveAspectRatio) {
							lastInit.visibleRect = undefined;
						}
					},
					flush(controller) {
						controller.terminate();
					},
				});
			} else if (canvas) {
				let ctx = canvas.getContext("2d", {
					alpha: false,
					desynchronized: true,
				});

				transformer = new TransformStream({
					transform(frame: VideoFrame, controller) {
						if (self.requestedResolution) {
							canvas.width = self.requestedResolution[0];
							canvas.height = self.requestedResolution[1];
							self.requestedResolution = undefined;

							ctx!.clearRect(0, 0, canvas.width, canvas.height);
						}

						let targetWidth = canvas.width;
						let targetHeight = canvas.height;

						const srcAspectRatio =
							frame.displayWidth / frame.displayHeight;
						const canvasAspectRatio = canvas.width / canvas.height;

						if (preserveAspectRatio) {
							const EPSILON = 1e-6;
							if (
								Math.abs(srcAspectRatio - canvasAspectRatio) >
								EPSILON
							) {
								if (srcAspectRatio > canvasAspectRatio) {
									targetHeight = Math.round(
										canvas.width / srcAspectRatio
									);
								} else {
									targetWidth = Math.round(
										canvas.height * srcAspectRatio
									);
								}
							}
						}

						if (self.canvasSmooth) {
							ctx!.imageSmoothingEnabled = true;
							ctx!.imageSmoothingQuality = "high";
						}
						ctx!.drawImage(frame, 0, 0, targetWidth, targetHeight);
						frame.close();

						controller.enqueue(
							new VideoFrame(canvas, {
								timestamp: frame.timestamp,
								duration: frame.duration
									? frame.duration
									: undefined,
								alpha: "discard",
								visibleRect: {
									x: 0,
									y: 0,
									width: targetWidth,
									height: targetHeight,
								},
							})
						);
					},
					flush(controller) {
						controller.terminate();
					},
				});
			} else {
				throw "Invalid state";
			}

			(this.processor.readable as ReadableStream<VideoFrame>)
				.pipeThrough(transformer)
				.pipeTo(this.generator.writable as WritableStream<VideoFrame>)
				.catch(() => {});

			this.stream.addTrack(this.generator as MediaStreamTrack);
			return this.generator as MediaStreamTrack;
		} else {
			this.stream.addTrack(track);
			return track;
		}
	}
	public removeTrack(track: MediaStreamTrack) {
		if (track.kind == "video") {
			if (this.videoId != track.id && this.generator.id != track.id)
				throw "Track is not attached to scaler.";

			this.videoId = undefined;

			(this.generator as MediaStreamTrack).stop();
			this.stream.removeTrack(this.generator as MediaStreamTrack);

			const generatorId = (this.generator as MediaStreamTrack).id;

			this.processor = undefined;
			this.generator = undefined;

			return generatorId;
		} else {
			this.stream.removeTrack(track);
			return track.id;
		}
	}
	public destroy() {
		this.stream.onaddtrack = null;
		this.stream.onremovetrack = null;

		for (const track of this.stream.getTracks()) {
			this.removeTrack(track);
		}

		if (this.scaler) {
			this.scaler.destroy();
		}
	}
}

// Copied from https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices#resizeobserver_and_device-pixel-content-box

export function getDevicePixelSize(
	elem: HTMLElement
): Promise<[number, number]> {
	return new Promise((resolve) => {
		const observer = new ResizeObserver(([cur]) => {
			if (!cur) {
				throw new Error(
					`device-pixel-content-box not observed for elem ${elem}`
				);
			}
			const devSize = cur.devicePixelContentBoxSize;
			resolve([devSize[0]!.inlineSize, devSize[0]!.blockSize]);
			observer.disconnect();
		});
		observer.observe(elem, { box: "device-pixel-content-box" });
	});
}
