import * as sdpTransform from "sdp-transform";

export function mungeSDP(sdp: string): string {
	const parsed = sdpTransform.parse(sdp);

	// UGLY HACK for enabling audio RTX
	// based on:
	// - https://groups.google.com/g/discuss-webrtc/c/JVRU91Xwb6U/m/0Mb8CQV7AAAJ
	// - https://issues.webrtc.org/issues/42229513

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

			if (opus && !hasRTX && media.payloads) {
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
		return orderA - orderB;
	});
}

export async function adaptiveSettings(
	pc: RTCPeerConnection,
	dynamicAudioBitrate: boolean,
	dynamicVideoFramerate: boolean,
	audioBitrateCeil?: number,
	framerateCeil?: number
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
			if (audioBitrateCeil && dynamicAudioBitrate) {
				if (report.targetBitrate >= 128000) {
					audioBitrateLower = Math.min(
						Math.max(Math.floor(report.targetBitrate / 128000), 2) *
							32000,
						audioBitrateCeil
					);
					audioBitrateUpper = Math.min(
						Math.max(Math.ceil(report.targetBitrate / 128000), 2) *
							32000,
						audioBitrateCeil
					);
				} else {
					// minimum of 32 kbit/s (chosen based on https://wiki.hydrogenaudio.org/index.php?title=Opus#Indicative_bitrate_and_quality)
					audioBitrateLower = Math.min(
						Math.max(Math.floor(report.targetBitrate / 42000), 2) *
							16000,
						audioBitrateCeil
					);
					audioBitrateUpper = Math.min(
						Math.max(Math.ceil(report.targetBitrate / 42000), 2) *
							16000,
						audioBitrateCeil
					);
				}
			}

			if (framerateCeil && dynamicVideoFramerate) {
				if (report.targetBitrate >= 500000) {
					videoFramerateLower = Math.min(
						Math.max(Math.floor(report.targetBitrate / 500000), 1) *
							30,
						framerateCeil
					);
					videoFramerateUpper = Math.min(
						Math.max(Math.ceil(report.targetBitrate / 500000), 1) *
							30,
						framerateCeil
					);
				} else {
					// minimum of 24fps (lowest common framerate where motion reliably appears fluid)
					videoFramerateLower = Math.min(
						Math.max(
							Math.floor(report.targetBitrate / 250000),
							1.6
						) * 15,
						framerateCeil
					);
					videoFramerateUpper = Math.min(
						Math.max(
							Math.ceil(report.targetBitrate / 250000),
							1.6
						) * 15,
						framerateCeil
					);
				}
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
						if (
							encoding.maxFramerate > videoFramerateUpper &&
							encoding.maxFramerate != videoFramerateLower
						) {
							DEV: console.log(
								"set video maxFramerate",
								videoFramerateLower
							);
							encoding.maxFramerate = videoFramerateLower;
							changed = true;
						}

						if (
							encoding.maxFramerate < videoFramerateLower &&
							encoding.maxFramerate != videoFramerateUpper
						) {
							DEV: console.log(
								"set video maxFramerate",
								videoFramerateUpper
							);
							encoding.maxFramerate = videoFramerateUpper;
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
						if (
							encoding.maxBitrate > audioBitrateUpper &&
							encoding.maxBitrate != audioBitrateLower
						) {
							DEV: console.log(
								"set audio maxBitrate",
								audioBitrateLower / 1000
							);
							encoding.maxBitrate = audioBitrateLower;
							changed = true;
						}

						if (
							encoding.maxBitrate < audioBitrateLower &&
							encoding.maxBitrate != audioBitrateUpper
						) {
							DEV: console.log(
								"set audio maxBitrate",
								audioBitrateUpper / 1000
							);
							encoding.maxBitrate = audioBitrateUpper;
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
