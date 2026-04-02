import * as sdpTransform from "sdp-transform";

// sender munge
export function mungeSDP(sdp: string): string {
	const parsed = sdpTransform.parse(sdp);

	// UGLY HACK that *seems* to work for enabling audio RTX
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

export async function setSenderSettings(
	sender: RTCRtpSender,
	maxVideoBitrate?: number,
	maxFramerate?: number,
	maxAudioBitrate?: number,
	videoPriority?: RTCPriorityType,
	audioPriority?: RTCPriorityType,
	degradationPreference?: RTCDegradationPreference
) {
	const parameters = sender.getParameters();

	if (degradationPreference) {
		parameters.degradationPreference = degradationPreference;
	}

	for (const encoding of parameters.encodings) {
		if (sender.track?.kind == "video") {
			if (maxVideoBitrate) {
				encoding.maxBitrate = maxVideoBitrate * 1000;
			}

			if (maxFramerate) {
				encoding.maxFramerate = maxFramerate;
			}

			if (videoPriority) {
				encoding.priority = videoPriority;
				encoding.networkPriority = videoPriority;
			}
		}

		if (sender.track?.kind == "audio") {
			if (maxAudioBitrate) {
				encoding.maxBitrate = maxAudioBitrate * 1000;
			}

			if (audioPriority) {
				encoding.priority = audioPriority;
				encoding.networkPriority = audioPriority;
			}
		}
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

// call both on addTrack and .ontrack
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
