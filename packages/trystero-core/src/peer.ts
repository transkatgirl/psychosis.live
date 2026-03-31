import { all, alloc, candidateType, resetTimer, toError } from "./utils";
import type {
	BaseRoomConfig,
	MediaConfig,
	PeerHandle,
	PeerHandlers,
	Signal,
} from "./types";
import * as sdpTransform from "sdp-transform";

const iceTimeout = 15_000;
const disconnectedCloseDelayMs = 5_000;
const iceStateEvent = "icegatheringstatechange";
const offerType = "offer";
const answerType = "answer";
const outOfRangePattern = /out of range/i;

type SdpDescription = {
	type: RTCSdpType;
	sdp: string;
};

const rewriteMdnsCandidatesToLoopback = (sdp: string): string =>
	sdp.replace(/ (\S+\.local) (\d+) typ host/g, " 127.0.0.1 $2 typ host");

export default (
	initiator: boolean,
	{
		trickleIce,
		rtcConfig,
		rtcPolyfill,
		turnConfig,
		mediaConfig,
		_test_only_mdnsHostFallbackToLoopback,
	}: BaseRoomConfig
): PeerHandle => {
	const pc = new (rtcPolyfill ?? RTCPeerConnection)({
		iceServers: defaultIceServers.concat(turnConfig ?? []),
		...rtcConfig,
	});

	const handlers: PeerHandlers = {};
	const pendingSignals: Signal[] = [];
	const pendingData: ArrayBuffer[] = [];
	const shouldTrickleIce = trickleIce !== false;
	const pendingRemoteCandidates: RTCIceCandidateInit[] = [];
	const pendingTracks: Array<{
		track: MediaStreamTrack;
		stream: MediaStream;
	}> = [];
	let makingOffer = false;
	let isSettingRemoteAnswerPending = false;
	let dataChannel: RTCDataChannel | null = null;
	let disconnectedCloseTimer: number | null = null;
	let didEmitClose = false;

	const clearDisconnectedCloseTimer = (): null =>
		(disconnectedCloseTimer = resetTimer(disconnectedCloseTimer));

	const emitClose = (): void => {
		if (didEmitClose) {
			return;
		}

		didEmitClose = true;
		clearDisconnectedCloseTimer();
		handlers.close?.();
	};

	const emitSignal = (signal: Signal): void => {
		if (handlers.signal) {
			handlers.signal(signal);
		} else {
			pendingSignals.push(signal);
		}
	};

	const appendSignalHandler = (handler: (signal: Signal) => void): void => {
		const previousSignalHandler = handlers.signal;

		handlers.signal = (signal) => {
			previousSignalHandler?.(signal);
			handler(signal);
		};

		if (pendingSignals.length > 0) {
			const queuedSignals = pendingSignals.splice(0);
			queuedSignals.forEach((signal) => handlers.signal?.(signal));
		}
	};

	const normalizeSdp = (sdp: string): string => {
		sdp = _test_only_mdnsHostFallbackToLoopback
			? rewriteMdnsCandidatesToLoopback(sdp)
			: sdp;

		const parsed = sdpTransform.parse(sdp);

		// UGLY HACK that *seems* to work for enabling audio RTX
		// based on:
		// - https://groups.google.com/g/discuss-webrtc/c/JVRU91Xwb6U/m/0Mb8CQV7AAAJ
		// - https://issues.webrtc.org/issues/42229513

		for (const media of parsed.media) {
			if (media.type == "audio") {
				let hasOpus = false;
				let hasRTX = false;

				for (const entry of media.rtp) {
					if (entry.codec == "opus") {
						hasOpus = true;
					}
					if (entry.codec == "rtx") {
						hasRTX = true;
					}
				}

				if (!hasRTX && media.payloads) {
					let payloads = sdpTransform.parsePayloads(media.payloads);
					payloads.splice(payloads.indexOf(111) + 1, 0, 112);

					let payloadOrdering = (a: any, b: any) => {
						const indexA = payloads.indexOf(a.payload);
						const indexB = payloads.indexOf(b.payload);
						const orderA = indexA >= 0 ? indexA : Number.MAX_VALUE;
						const orderB = indexB >= 0 ? indexB : Number.MAX_VALUE;
						return orderA - orderB;
					};

					if (media.rtcpFb) {
						media.rtcpFb.push({ payload: 111, type: "nack" });
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
	};

	const normalizeCandidate = (
		candidate: RTCIceCandidateInit
	): RTCIceCandidateInit => {
		if (
			!_test_only_mdnsHostFallbackToLoopback ||
			typeof candidate.candidate !== "string"
		) {
			return candidate;
		}

		const normalizedCandidate = rewriteMdnsCandidatesToLoopback(
			candidate.candidate
		);

		return normalizedCandidate === candidate.candidate
			? candidate
			: { ...candidate, candidate: normalizedCandidate };
	};

	const localDescriptionSignal = (
		peerConnection: RTCPeerConnection
	): SdpDescription => ({
		type: (peerConnection.localDescription?.type ??
			offerType) as RTCSdpType,
		sdp: normalizeSdp(peerConnection.localDescription?.sdp ?? ""),
	});

	const getRemoteUfrag = (): string | null => {
		const sdp = pc.remoteDescription?.sdp;

		if (!sdp) {
			return null;
		}

		const match = sdp.match(/a=ice-ufrag:([^\s]+)/);
		return match?.[1] ?? null;
	};

	const getRemoteMediaSectionCount = (): number =>
		(pc.remoteDescription?.sdp?.match(/^m=/gm) ?? []).length;

	const canApplyRemoteCandidate = (
		candidate: RTCIceCandidateInit
	): boolean => {
		if (!pc.remoteDescription) {
			return false;
		}

		const remoteMLineCount = getRemoteMediaSectionCount();

		if (
			typeof candidate.sdpMLineIndex === "number" &&
			remoteMLineCount > 0 &&
			candidate.sdpMLineIndex >= remoteMLineCount
		) {
			return false;
		}

		const remoteUfrag = getRemoteUfrag();

		if (
			remoteUfrag &&
			candidate.usernameFragment &&
			candidate.usernameFragment !== remoteUfrag
		) {
			return false;
		}

		return true;
	};

	const addIceCandidateSafe = async (
		candidate: RTCIceCandidateInit
	): Promise<boolean> => {
		try {
			await pc.addIceCandidate(candidate);
			return true;
		} catch (err) {
			if (
				err instanceof Error &&
				outOfRangePattern.test(err.message) &&
				typeof candidate.sdpMLineIndex === "number"
			) {
				return false;
			}

			throw err;
		}
	};

	const flushPendingRemoteCandidates = async (): Promise<void> => {
		if (!pc.remoteDescription || pendingRemoteCandidates.length === 0) {
			return;
		}

		const queuedCandidates = pendingRemoteCandidates.splice(0);
		const stillPending: RTCIceCandidateInit[] = [];

		for (const candidate of queuedCandidates) {
			if (!canApplyRemoteCandidate(candidate)) {
				stillPending.push(candidate);
				continue;
			}

			const didApply = await addIceCandidateSafe(candidate);

			if (!didApply) {
				stillPending.push(candidate);
			}
		}

		if (stillPending.length > 0) {
			pendingRemoteCandidates.push(...stillPending);
		}
	};

	const addRemoteCandidate = async (
		candidate: RTCIceCandidateInit
	): Promise<void> => {
		if (canApplyRemoteCandidate(candidate)) {
			const didApply = await addIceCandidateSafe(candidate);

			if (!didApply) {
				pendingRemoteCandidates.push(candidate);
			}
			return;
		}

		pendingRemoteCandidates.push(candidate);
	};

	const setupDataChannel = (channel: RTCDataChannel): void => {
		channel.binaryType = "arraybuffer";
		channel.bufferedAmountLowThreshold = 0xffff;
		channel.onmessage = (e) => {
			const data = e.data as ArrayBuffer;

			if (handlers.data) {
				handlers.data(data);
			} else {
				pendingData.push(data);
			}
		};
		channel.onopen = () => handlers.connect?.();
		channel.onclose = emitClose;
		channel.onerror = ({ error }) =>
			handlers.error?.(toError(error, "data channel error"));
	};

	const waitForIceGathering = async (
		peerConnection: RTCPeerConnection
	): Promise<SdpDescription> => {
		let timeout: ReturnType<typeof setTimeout> | null = null;

		try {
			await Promise.race([
				new Promise<void>((res) => {
					const checkState = (): void => {
						if (peerConnection.iceGatheringState === "complete") {
							peerConnection.removeEventListener(
								iceStateEvent,
								checkState
							);
							res();
						}
					};

					peerConnection.addEventListener(iceStateEvent, checkState);
					checkState();
				}),
				new Promise<void>((res) => {
					timeout = setTimeout(res, iceTimeout);
				}),
			]);
		} finally {
			resetTimer(timeout);
		}

		return localDescriptionSignal(peerConnection);
	};

	const emitLocalDescriptionSignal = async (): Promise<SdpDescription> => {
		const signal = shouldTrickleIce
			? localDescriptionSignal(pc)
			: await waitForIceGathering(pc);

		emitSignal(signal);
		return signal;
	};

	if (initiator) {
		dataChannel = pc.createDataChannel("data");
		setupDataChannel(dataChannel);
	} else {
		pc.ondatachannel = ({ channel }) => {
			dataChannel = channel;
			setupDataChannel(channel);
		};
	}

	const createOffer = async (restartIce = false): Promise<Signal | void> => {
		if (pc.connectionState === "closed") {
			return;
		}

		try {
			makingOffer = true;

			if (restartIce) {
				if (
					pc.signalingState !== "stable" &&
					pc.signalingState !== "closed" &&
					pc.localDescription?.type === offerType
				) {
					await pc.setLocalDescription({ type: "rollback" });
					DEV: console.log("setLocalDescription", {
						type: "rollback",
					});
				}

				if (typeof pc.restartIce === "function") {
					pc.restartIce();
				}
			}

			if (restartIce) {
				const offer = await pc.createOffer({ iceRestart: true });

				await pc.setLocalDescription(offer);
				DEV: console.log("setLocalDescription", offer);
			} else {
				const offer = await pc.createOffer({ iceRestart: false });

				await pc.setLocalDescription(offer);
				DEV: console.log("setLocalDescription", offer);
			}

			const offer = await emitLocalDescriptionSignal();
			return offer;
		} catch (err) {
			handlers.error?.(toError(err, "failed to create local offer"));
		} finally {
			makingOffer = false;
		}
	};

	pc.onnegotiationneeded = async () => createOffer(false);

	pc.onicecandidate = ({ candidate }) => {
		if (!shouldTrickleIce || !candidate) {
			return;
		}

		const candidatePayload = normalizeCandidate(
			typeof candidate.toJSON === "function"
				? candidate.toJSON()
				: {
						candidate: candidate.candidate,
						sdpMid: candidate.sdpMid,
						sdpMLineIndex: candidate.sdpMLineIndex,
						usernameFragment: candidate.usernameFragment,
				  }
		);

		emitSignal({
			type: candidateType,
			sdp: JSON.stringify(candidatePayload),
		});
	};
	pc.onconnectionstatechange = () => {
		if (
			pc.connectionState === "connected" ||
			pc.connectionState === "connecting"
		) {
			clearDisconnectedCloseTimer();
			return;
		}

		if (pc.connectionState === "disconnected") {
			if (!disconnectedCloseTimer) {
				disconnectedCloseTimer = setTimeout(() => {
					disconnectedCloseTimer = null;

					if (pc.connectionState === "disconnected") {
						emitClose();
					}
				}, disconnectedCloseDelayMs);
			}

			return;
		}

		if (
			pc.connectionState === "failed" ||
			pc.connectionState === "closed"
		) {
			emitClose();
		}
	};

	pc.ontrack = (e) => {
		const stream = e.streams[0];

		updateTransceiver(e.transceiver, mediaConfig);

		if (mediaConfig?.receiver?.jitterBufferTarget) {
			e.receiver.jitterBufferTarget =
				mediaConfig.receiver.jitterBufferTarget;
		}

		if (stream) {
			if (!handlers.track && !handlers.stream) {
				pendingTracks.push({ track: e.track, stream });
				return;
			}

			handlers.track?.(e.track, stream);
			handlers.stream?.(stream);
		}
	};
	(
		pc as RTCPeerConnection & {
			onremovestream: ((e: { stream: MediaStream }) => void) | null;
		}
	).onremovestream = (e) => handlers.stream?.(e.stream);

	const offerPromise = initiator
		? new Promise<Signal | void>((res) =>
				appendSignalHandler((signal) => {
					if (signal.type === offerType) {
						res(signal);
					}
				})
		  )
		: Promise.resolve();

	if (initiator) {
		queueMicrotask(() => {
			if (
				!makingOffer &&
				pc.signalingState === "stable" &&
				!pc.localDescription &&
				pc.connectionState !== "closed"
			) {
				void pc.onnegotiationneeded?.(new Event("negotiationneeded"));
			}
		});
	}

	return {
		created: Date.now(),

		connection: pc,

		get channel(): RTCDataChannel | null {
			return dataChannel;
		},

		get isDead(): boolean {
			return pc.connectionState === "closed";
		},

		getOffer: async (restartIce = false): Promise<Signal | void> => {
			if (!initiator) {
				return;
			}

			if (restartIce) {
				return createOffer(true);
			}

			if (pc.localDescription?.type === offerType) {
				return shouldTrickleIce
					? localDescriptionSignal(pc)
					: waitForIceGathering(pc);
			}

			return offerPromise;
		},

		async signal(sdp: Signal): Promise<Signal | void> {
			if (sdp.type === candidateType) {
				try {
					const candidate = JSON.parse(
						sdp.sdp
					) as RTCIceCandidateInit | null;

					if (candidate && typeof candidate === "object") {
						await addRemoteCandidate(normalizeCandidate(candidate));
					}
				} catch (err) {
					handlers.error?.(
						toError(err, "failed to parse remote candidate")
					);
				}

				return;
			}

			if (
				dataChannel?.readyState === "open" &&
				!sdp.sdp?.includes("a=rtpmap")
			) {
				return;
			}

			try {
				const rtcSdp: RTCSessionDescriptionInit = {
					...sdp,
					sdp: normalizeSdp(sdp.sdp),
				};

				if (sdp.type === offerType) {
					if (
						makingOffer ||
						(pc.signalingState !== "stable" &&
							!isSettingRemoteAnswerPending)
					) {
						if (initiator) {
							return;
						}

						await pc.setLocalDescription({ type: "rollback" });
						DEV: console.log("setLocalDescription", {
							type: "rollback",
						});
						await pc.setRemoteDescription(rtcSdp);
						DEV: console.log("setRemoteDescription", rtcSdp);
					} else {
						await pc.setRemoteDescription(rtcSdp);
						DEV: console.log("setRemoteDescription", rtcSdp);
					}

					await flushPendingRemoteCandidates();
					await pc.setLocalDescription();
					DEV: console.log("setLocalDescription");
					const answer = await emitLocalDescriptionSignal();

					return answer;
				}

				if (sdp.type === answerType) {
					isSettingRemoteAnswerPending = true;

					try {
						await pc.setRemoteDescription(rtcSdp);
						DEV: console.log("setRemoteDescription", rtcSdp);
						await flushPendingRemoteCandidates();
					} finally {
						isSettingRemoteAnswerPending = false;
					}
				}
			} catch (err) {
				handlers.error?.(toError(err, "failed to apply remote signal"));
			}
		},

		sendData: (data) => dataChannel?.send(data as unknown as never),

		destroy: () => {
			clearDisconnectedCloseTimer();
			dataChannel?.close();
			pc.close();
			makingOffer = false;
			isSettingRemoteAnswerPending = false;
			emitClose();
		},

		setHandlers: (newHandlers) => {
			const { signal, ...restHandlers } = newHandlers;
			Object.assign(handlers, restHandlers);

			if (handlers.data && pendingData.length > 0) {
				const queued = pendingData.splice(0);
				queued.forEach((data) => handlers.data?.(data));
			}

			if (signal) {
				appendSignalHandler(signal);
			}

			if (
				(handlers.track || handlers.stream) &&
				pendingTracks.length > 0
			) {
				const queued = pendingTracks.splice(0);
				queued.forEach(({ track, stream }) => {
					handlers.track?.(track, stream);
					handlers.stream?.(stream);
				});
			}
		},

		offerPromise,

		addStream: (stream) => {
			stream.getTracks().forEach((track) => {
				let transceiver = pc.addTransceiver(track, {
					streams: [stream],
				});
				updateTransceiver(transceiver, mediaConfig);
				updateSender(transceiver.sender, mediaConfig);
			});
		},

		removeStream: (stream) =>
			pc
				.getSenders()
				.filter(
					(sender) =>
						sender.track &&
						stream.getTracks().includes(sender.track)
				)
				.forEach((sender) => pc.removeTrack(sender)),

		addTrack: (track, stream) => {
			let transceiver = pc.addTransceiver(track, {
				streams: [stream],
			});
			updateTransceiver(transceiver, mediaConfig);
			updateSender(transceiver.sender, mediaConfig);
		},

		removeTrack: (track) => {
			const sender = pc.getSenders().find((s) => s.track === track);

			if (sender) {
				pc.removeTrack(sender);
			}
		},

		replaceTrack: (oldTrack, newTrack) => {
			const sender = pc.getSenders().find((s) => s.track === oldTrack);

			if (sender) {
				return sender.replaceTrack(newTrack);
			}

			return undefined;
		},
	};
};

export const defaultIceServers: RTCIceServer[] = [
	/*...alloc(5, (_, i) => `stun:stun${i || ""}.l.google.com:19302`),
	"stun:stun.cloudflare.com:3478",*/
].map((url) => ({ urls: url }));

export function sortCodecs(codecs: RTCRtpCodec[], preferredOrder: string[]) {
	return codecs.sort((a, b) => {
		const indexA = preferredOrder.indexOf(a.mimeType);
		const indexB = preferredOrder.indexOf(b.mimeType);
		const orderA = indexA >= 0 ? indexA : Number.MAX_VALUE;
		const orderB = indexB >= 0 ? indexB : Number.MAX_VALUE;
		return orderA - orderB;
	});
}

async function updateSender(
	sender: RTCRtpSender,
	mediaConfig: MediaConfig | undefined
) {
	const parameters = sender.getParameters();

	if (mediaConfig?.sender?.degradationPreference) {
		parameters.degradationPreference =
			mediaConfig.sender.degradationPreference;
	}

	for (const encoding of parameters.encodings) {
		if (mediaConfig?.sender?.networkPriority) {
			encoding.networkPriority = mediaConfig.sender.networkPriority;
		}

		if (sender.track?.kind == "video") {
			if (mediaConfig?.sender?.videoPriority) {
				encoding.priority = mediaConfig.sender.videoPriority;
			}

			if (mediaConfig?.sender?.maxVideoBitrate) {
				encoding.maxBitrate = mediaConfig.sender.maxVideoBitrate * 1000;
			}

			if (mediaConfig?.sender?.maxFramerate) {
				encoding.maxFramerate = mediaConfig.sender.maxFramerate;
			}
		}

		if (sender.track?.kind == "audio") {
			if (mediaConfig?.sender?.audioPriority) {
				encoding.priority = mediaConfig.sender.audioPriority;
			}

			if (mediaConfig?.sender?.maxAudioBitrate) {
				encoding.maxBitrate = mediaConfig.sender.maxAudioBitrate * 1000;
			}
		}
	}

	await sender.setParameters(parameters);

	DEV: console.log("set sender parameters", parameters);
}

async function updateTransceiver(
	transceiver: RTCRtpTransceiver,
	mediaConfig: MediaConfig | undefined
) {
	if (mediaConfig?.receiver?.codecOrderPreference) {
		let kind = transceiver.receiver.track.kind;

		if (transceiver.sender.track?.kind) {
			kind = transceiver.sender.track.kind;
		}

		let codecs = RTCRtpReceiver.getCapabilities(kind)?.codecs;

		if (codecs) {
			codecs = sortCodecs(
				codecs,
				mediaConfig.receiver.codecOrderPreference
			);
			transceiver.setCodecPreferences(codecs);
			DEV: console.log("set codec preferences", codecs);
		}
	}
}
