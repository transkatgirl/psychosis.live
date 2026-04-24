import * as sdpTransform from "sdp-transform";
import { Scaler } from "./pica-gpu";

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

export function calculateStickyDynamicAudioBitrateTarget(channels: number) {
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

					DEV: console.log(
						"updating opus parameters using SDP munging"
					);

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
					DEV: console.log(
						"force enabling audio NACK using SDP munging"
					);
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
					DEV: console.log(
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
	framesEncodedOlder?: number; // 2 scan intervals ago
	framesSent?: number;
	qpSum?: number; // 1 scan interval ago
	qpSumOlder?: number; // 2 scan intervals ago
	totalEncodeTime?: number;
	skipNextInterval?: boolean;
}

interface AdaptiveDataAnalysis {
	framesAnalyzed?: number;
	qpAvg?: number;
	frameDropRate?: number;
}

function analyzeAdaptiveData(stats: RTCStatsReport, data: AdaptiveData) {}

export interface AdaptiveTargets {
	audio?: AdaptiveAudioTargets;
	video?: AdaptiveVideoTargets;
}

export interface AdaptiveAudioTargets {
	channels: number;
	bitrate: number;
	linearDecrease?: boolean; // Should be enabled if RED is enabled
}

export interface AdaptiveVideoTargets {
	width?: number;
	height?: number;
	framerate: number;
}

async function adaptiveSettingsNew( // WIP
	pc: RTCPeerConnection,
	peerData: AdaptiveData,
	targets: AdaptiveTargets,
	peerScaler?: MediaScaler // See adaptiveVideoSettings
) {
	const stats = await pc.getStats();

	if (targets.audio) {
		await adaptiveAudioBitrate(pc, stats, targets.audio);
	}

	if (targets.video) {
		await adaptiveVideoSettings(
			pc,
			stats,
			peerData,
			targets.video,
			peerScaler
		);
	}
}

async function adaptiveAudioBitrate(
	pc: RTCPeerConnection,
	stats: RTCStatsReport,
	targets: AdaptiveAudioTargets
) {
	const minBitrate = calculateReasonableMinimumAudioBitrateKbps(
		targets.channels
	);
	const maxBitrate = targets.bitrate;
	const stickyTarget = calculateStickyDynamicAudioBitrateTarget(
		targets.channels
	);

	let bitrateLower = 0;
	let bitrateUpper = Infinity;
	let usingOpus = false;

	stats.forEach((report) => {
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
	});

	if (!usingOpus || bitrateLower == 0 || bitrateUpper == Infinity) return;

	for (const transceiver of pc.getTransceivers()) {
		if (transceiver.sender.track?.kind == "audio") {
			let parameters = transceiver.sender.getParameters();

			let changed = false;

			for (const encoding of parameters.encodings) {
				if (encoding.maxBitrate) {
					if (encoding.maxBitrate > bitrateUpper) {
						DEV: console.log(
							"set audio maxBitrate",
							bitrateUpper / 1000
						);
						encoding.maxBitrate = bitrateUpper;
						changed = true;
					}

					if (encoding.maxBitrate < bitrateLower) {
						DEV: console.log(
							"set audio maxBitrate",
							bitrateLower / 1000
						);
						encoding.maxBitrate = bitrateLower;
						changed = true;
					}
				}
			}

			if (changed) {
				await transceiver.sender.setParameters(parameters);
			}
		}
	}
}

// Needs to be called every 2s (or 2.5s for behavior closer to libwebrtc)
async function adaptiveVideoSettings(
	pc: RTCPeerConnection,
	stats: RTCStatsReport,
	data: AdaptiveData,
	targets: AdaptiveVideoTargets,
	peerScaler?: MediaScaler // Should only be specified if degradationPreference is maintain-framerate-and-resolution; implements custom adaptation algorithm
) {
	if (targets.width && targets.height && peerScaler) {
		// Based on:
		// - https://github.com/webrtc-sdk/webrtc/blob/m144_release/modules/video_coding/utility/quality_scaler.cc
		// - https://github.com/webrtc-sdk/webrtc/blob/m144_release/call/adaptation/video_stream_adapter.cc
		// - https://github.com/webrtc-sdk/webrtc/blob/6c1aa903241e69eb2eca64caad16779351bb1ab2/video/adaptation/video_stream_encoder_resource_manager.cc
		// TODO
		/*const frameCount = 0; // TODO: set averaged frames
		const frameDropRate = 0; // TODO: avg over 4s
		const avgQP = 0; // TODO: avg over 4s

		const codecData = AV1_ADAPTIVE_DATA; // TODO
		let width = 0;
		let height = 0;
		let framerate = 0;

		if (frameCount < framerate * 2) {
			return;
		}

		// TODO: after first downscale, skip every other iteration

		if (frameDropRate > 0.6 || codecData.highQP < avgQP) {
			[width, height, framerate] = adaptDown(width, height, framerate);

			if (calculateHigherQP(codecData) > avgQP) {
				[width, height, framerate] = adaptDown(
					width,
					height,
					framerate
				);
			}

			// clear averages
		} else if (codecData.lowQP >= avgQP) {
			[width, height, framerate] = adaptUp(
				width,
				height,
				framerate,
				targets.framerate
			);

			// clear averages
		}

		width = Math.min(width, targets.width);
		height = Math.min(height, targets.height);
		framerate = Math.min(framerate, targets.framerate);*/
	} else {
		let framerateLower = 0;
		let framerateUpper = Infinity;

		stats.forEach((report) => {
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
		});

		if (framerateLower != 0 && framerateUpper != Infinity) {
			for (const transceiver of pc.getTransceivers()) {
				if (transceiver.sender.track?.kind == "video") {
					let parameters = transceiver.sender.getParameters();

					let changed = false;

					for (const encoding of parameters.encodings) {
						if (encoding.maxFramerate) {
							if (encoding.maxFramerate > framerateUpper) {
								DEV: console.log(
									"set video maxFramerate",
									framerateUpper
								);
								encoding.maxFramerate = framerateUpper;
								changed = true;
							}

							if (encoding.maxFramerate < framerateLower) {
								DEV: console.log(
									"set video maxFramerate",
									framerateLower
								);
								encoding.maxFramerate = framerateLower;
								changed = true;
							}
						}
					}

					if (changed) {
						await transceiver.sender.setParameters(parameters);
					}
				}
			}
		}
	}
}

export async function adaptiveSettings(
	pc: RTCPeerConnection,
	dynamicAudioBitrate: boolean,
	dynamicVideoFramerate: boolean,
	audioBitrateFloor?: number,
	audioBitrateCeil?: number,
	framerateCeil?: number,
	linearDynamicAudioBitrate = false, // should be disabled if using RED
	stickyDynamicAudioBitrateTarget = 4 // preferred minimum audio bitrate = stickyDynamicAudioBitrateTarget * 32 kbit/s; see calculateStickyDynamicAudioBitrateTarget
) {
	const stats = await pc.getStats();

	let audioBitrateLower = 0;
	let audioBitrateUpper = Infinity;
	let videoFramerateLower = 0;
	let videoFramerateUpper = Infinity;

	stats.forEach((report) => {
		if (
			report.type == "outbound-rtp" &&
			report.kind == "video" &&
			report.targetBitrate
		) {
			if (audioBitrateFloor && audioBitrateCeil && dynamicAudioBitrate) {
				if (linearDynamicAudioBitrate) {
					// minimum of 32 kbit/s (see calculateReasonableMinimumAudioBitrateKbps)
					audioBitrateLower =
						Math.max(Math.floor(report.targetBitrate / 128000), 1) *
						32000;
					audioBitrateUpper =
						Math.max(Math.ceil(report.targetBitrate / 128000), 1) *
						32000;
				} else {
					// prefer staying above stickyDynamicAudioBitrateTarget * 32 kbit/s

					if (
						report.targetBitrate >=
						64000 * stickyDynamicAudioBitrateTarget
					) {
						audioBitrateLower =
							Math.max(
								Math.floor(report.targetBitrate / 128000),
								stickyDynamicAudioBitrateTarget
							) * 32000;
						audioBitrateUpper =
							Math.max(
								Math.ceil(report.targetBitrate / 128000),
								stickyDynamicAudioBitrateTarget
							) * 32000;
					} else {
						// minimum of 32 kbit/s (see calculateReasonableMinimumAudioBitrateKbps)

						audioBitrateLower =
							Math.max(
								Math.floor(report.targetBitrate / 64000),
								1
							) * 32000;
						audioBitrateUpper =
							Math.max(
								Math.ceil(report.targetBitrate / 64000),
								1
							) * 32000;
					}
				}

				audioBitrateLower = Math.min(
					Math.max(audioBitrateLower, audioBitrateFloor),
					audioBitrateCeil
				);
				audioBitrateUpper = Math.min(
					Math.max(audioBitrateUpper, audioBitrateFloor),
					audioBitrateCeil
				);
			}

			if (framerateCeil && dynamicVideoFramerate) {
				videoFramerateLower = Math.min(
					Math.max(Math.floor(report.targetBitrate / 3000000), 1) *
						30,
					framerateCeil
				);
				videoFramerateUpper = Math.min(
					Math.max(Math.ceil(report.targetBitrate / 3000000), 1) * 30,
					framerateCeil
				);
			}
		}
	});

	for (const transceiver of pc.getTransceivers()) {
		if (transceiver.sender.track?.kind == "video") {
			let parameters = transceiver.sender.getParameters();

			let changed = false;

			for (const encoding of parameters.encodings) {
				if (encoding.maxFramerate) {
					if (
						videoFramerateLower != 0 &&
						videoFramerateUpper != Infinity
					) {
						if (encoding.maxFramerate > videoFramerateUpper) {
							DEV: console.log(
								"set video maxFramerate",
								videoFramerateUpper
							);
							encoding.maxFramerate = videoFramerateUpper;
							changed = true;
						}

						if (encoding.maxFramerate < videoFramerateLower) {
							DEV: console.log(
								"set video maxFramerate",
								videoFramerateLower
							);
							encoding.maxFramerate = videoFramerateLower;
							changed = true;
						}
					}
				}
			}

			if (changed) {
				await transceiver.sender.setParameters(parameters);
			}
		}

		if (transceiver.sender.track?.kind == "audio") {
			let parameters = transceiver.sender.getParameters();

			let changed = false;

			for (const encoding of parameters.encodings) {
				if (encoding.maxBitrate) {
					if (
						audioBitrateLower != 0 &&
						audioBitrateUpper != Infinity
					) {
						if (encoding.maxBitrate > audioBitrateUpper) {
							DEV: console.log(
								"set audio maxBitrate",
								audioBitrateUpper / 1000
							);
							encoding.maxBitrate = audioBitrateUpper;
							changed = true;
						}

						if (encoding.maxBitrate < audioBitrateLower) {
							DEV: console.log(
								"set audio maxBitrate",
								audioBitrateLower / 1000
							);
							encoding.maxBitrate = audioBitrateLower;
							changed = true;
						}
					}
				}
			}

			if (changed) {
				await transceiver.sender.setParameters(parameters);
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

// https://github.com/webrtc-sdk/webrtc/blob/6c1aa903241e69eb2eca64caad16779351bb1ab2/modules/video_coding/codecs/vp8/libvpx_vp8_encoder.cc#L91; Converted from range of [0, 127] to [0, 63]
const VP8_ADAPTIVE_DATA: CodecAdaptiveData = {
	lowQP: 14.5,
	highQP: 47.5,
};

// https://github.com/webrtc-sdk/webrtc/blob/6c1aa903241e69eb2eca64caad16779351bb1ab2/modules/video_coding/codecs/vp9/libvpx_vp9_encoder.cc#L107; Converted from range of [0, 255] to [0, 63]
const VP9_ADAPTIVE_DATA: CodecAdaptiveData = {
	lowQP: 37.25,
	highQP: 51.25,
};

// https://github.com/webrtc-sdk/webrtc/blob/6c1aa903241e69eb2eca64caad16779351bb1ab2/modules/video_coding/codecs/av1/libaom_av1_encoder.cc#L80; Converted from range of [0, 255] to [0, 63]
const AV1_ADAPTIVE_DATA: CodecAdaptiveData = {
	lowQP: 36.25,
	highQP: 51.25,
};

// Adaptation functions are loosely inspired by https://github.com/webrtc-sdk/webrtc/blob/m144_release/call/adaptation/video_stream_adapter.cc

const FHD_PIXELS = 1920 * 1080;
const HD_PIXELS = 1280 * 720;
const MIN_PIXELS = 320 * 180; // MUST throw an error if max_pixels < MIN_PIXELS

function adaptUp(
	width: number,
	height: number,
	framerate: number,
	maxFramerate: number
): [number, number, number] {
	const adjustedFramerate = Math.round((framerate * 3) / 2);
	const fudgedPixels = Math.pow(Math.sqrt(width * height) + 4, 2);

	const SMOOTH_FPS = Math.min(60, maxFramerate);
	const MIN_PREFERRED_FPS = Math.min(30, maxFramerate);

	if (fudgedPixels >= FHD_PIXELS && framerate < maxFramerate) {
		return [width, height, Math.min(adjustedFramerate, maxFramerate)];
	}
	if (fudgedPixels >= HD_PIXELS && framerate < SMOOTH_FPS) {
		return [width, height, Math.min(adjustedFramerate, SMOOTH_FPS)];
	}
	if (framerate < MIN_PREFERRED_FPS) {
		return [width, height, MIN_PREFERRED_FPS];
	}

	const adjustedPixels = (width * height * 5) / 3;

	const adjustedWidth =
		Math.round(Math.sqrt(adjustedPixels * (width / height)) / 4) * 4;
	const adjustedHeight =
		Math.round(Math.sqrt(adjustedPixels * (height / width)) / 4) * 4;

	return [adjustedWidth, adjustedHeight, framerate];
}

function adaptDown(
	width: number,
	height: number,
	framerate: number
): [number, number, number] {
	const adjustedFramerate = Math.round((framerate * 2) / 3);
	const fudgedPixels = Math.pow(Math.sqrt(width * height) - 4, 2);

	if (fudgedPixels <= FHD_PIXELS && framerate > 60) {
		return [width, height, Math.max(adjustedFramerate, 60)];
	}
	if (fudgedPixels <= HD_PIXELS && framerate > 30) {
		return [width, height, Math.max(adjustedFramerate, 30)];
	}
	if (fudgedPixels <= MIN_PIXELS && framerate > 22) {
		return [width, height, 22];
	}

	const adjustedPixels = (width * height * 3) / 5;

	let adjustedWidth =
		Math.round(Math.sqrt(adjustedPixels * (width / height)) / 4) * 4;
	let adjustedHeight =
		Math.round(Math.sqrt(adjustedPixels * (height / width)) / 4) * 4;

	if (adjustedPixels < MIN_PIXELS) {
		[adjustedWidth, adjustedHeight] = adaptToPixelCount(
			width,
			height,
			MIN_PIXELS
		);
	}

	return [adjustedWidth, adjustedHeight, framerate];
}

function adaptToPixelCount(
	width: number,
	height: number,
	pixels: number
): [number, number] {
	const adjustedWidth =
		Math.round(Math.sqrt(pixels * (width / height)) / 4) * 4;
	const adjustedHeight =
		Math.round(Math.sqrt(pixels * (height / width)) / 4) * 4;

	width = adjustedWidth;
	height = adjustedHeight;

	return [width, height];
}

export class MediaScaler {
	public stream: MediaStream;
	videoId: string | undefined;
	scaler: Scaler;
	processor: any;
	generator: any;
	originalWidth: number;
	originalHeight: number;
	public constructor(width: number, height: number) {
		if (
			!(
				"MediaStreamTrackProcessor" in window &&
				"MediaStreamTrackGenerator" in window
			)
		) {
			throw "Insertable Streams unsupported";
		}

		this.originalWidth = Math.round(width);
		this.originalHeight = Math.round(height);

		this.scaler = new Scaler(
			new OffscreenCanvas(this.originalWidth, this.originalHeight),
			"mks2013"
		);

		this.stream = new MediaStream();
	}
	public get videoIdentifier() {
		return this.videoId;
	}
	public resize(width: number, height: number) {
		this.originalWidth = Math.round(width);
		this.originalHeight = Math.round(height);

		this.scaler.canvas.width = this.originalWidth;
		this.scaler.canvas.height = this.originalHeight;
		this.scaler.clear();
	}
	public addTrack(
		track: MediaStreamTrack,
		preserveAspectRatio = true,
		enforceAspectRatio = true
	) {
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

			const originalWidth = this.originalWidth;
			const originalHeight = this.originalHeight;

			const transformer = new TransformStream({
				transform(frame: VideoFrame, controller) {
					if (preserveAspectRatio && enforceAspectRatio) {
						const srcAspectRatio =
							frame.displayWidth / frame.displayHeight;
						const canvasAspectRatio =
							originalWidth / originalHeight;
						const activeAspectRatio =
							scaler.canvas.width / scaler.canvas.height;

						if (
							srcAspectRatio != canvasAspectRatio &&
							srcAspectRatio != activeAspectRatio
						) {
							if (srcAspectRatio > canvasAspectRatio) {
								scaler.canvas.width = originalWidth;
								scaler.canvas.height = Math.round(
									originalWidth / srcAspectRatio
								);
							} else {
								scaler.canvas.height = originalHeight;
								scaler.canvas.width = Math.round(
									originalHeight * srcAspectRatio
								);
							}
							scaler.clear();
						}
					}

					scaler.process(frame, preserveAspectRatio);
					frame.close();

					controller.enqueue(
						new VideoFrame(scaler.canvas, {
							timestamp: frame.timestamp,
							duration: frame.duration
								? frame.duration
								: undefined,
							alpha: "discard",
						})
					);
				},
				flush(controller) {
					controller.terminate();
				},
			});

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

		this.scaler.destroy();
	}
}
