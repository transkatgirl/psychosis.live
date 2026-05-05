import { compress, convertUint8Array, decompress } from "./room/core";
import type { Peer } from "./room/webrtc";

export interface PeerStats {
	sender: boolean;

	targetAudioBitrate?: number;
	targetVideoBitrate?: number;
	cpuLimited?: boolean;
	gpuLimited?: boolean;
	desync?: number;
	frameDropPercent?: number;
	jitterBufferDelay?: number;

	incomingBandwidth?: number;
	outgoingBandwidth?: number;
	roundTripTime?: number;
	jitter?: number;
	lossPercent?: number;
}

export function combineStats(local: PeerStats, remote: PeerStats) {
	const stats = structuredClone(local);

	if (!stats.sender && remote.targetAudioBitrate !== undefined) {
		stats.targetAudioBitrate = remote.targetAudioBitrate;
	}

	if (!stats.sender && remote.targetVideoBitrate !== undefined) {
		stats.targetVideoBitrate = remote.targetVideoBitrate;
	}

	if (remote.cpuLimited) {
		stats.cpuLimited = true;
	}

	if (remote.gpuLimited) {
		stats.gpuLimited = true;
	}

	if (remote.desync !== undefined) {
		stats.desync = Math.max(stats.desync ? stats.desync : 0, remote.desync);
	}

	if (remote.frameDropPercent !== undefined) {
		stats.frameDropPercent = Math.max(
			stats.frameDropPercent ? stats.frameDropPercent : 0,
			remote.frameDropPercent
		);
	}

	if (remote.jitterBufferDelay !== undefined) {
		stats.jitterBufferDelay = Math.max(
			stats.jitterBufferDelay ? stats.jitterBufferDelay : 0,
			remote.jitterBufferDelay
		);
	}

	if (
		stats.roundTripTime === undefined &&
		remote.roundTripTime !== undefined
	) {
		stats.roundTripTime = remote.roundTripTime;
	}

	if (stats.jitter === undefined && remote.jitter !== undefined) {
		stats.jitter = remote.jitter;
	}

	if (stats.lossPercent === undefined && remote.lossPercent !== undefined) {
		stats.lossPercent = remote.lossPercent;
	}

	return stats;
}

export async function sendChannelMessage(
	message: PeerStats,
	encoder: TextEncoder,
	channel: RTCDataChannel // Max message size of 64kB
) {
	if (channel && channel.readyState === "open") {
		channel.send(
			await compress(
				convertUint8Array(encoder.encode(JSON.stringify(message)))
			)
		);
	}
}

export async function parseChannelMessage(
	message: ArrayBuffer,
	decoder: TextDecoder
): Promise<PeerStats> {
	return JSON.parse(decoder.decode(await decompress(message)));
}

export async function getPeerStats(
	peer: Peer,
	video?: HTMLVideoElement
): Promise<PeerStats | undefined> {
	if (!peer.pc || peer.pc?.connectionState === "new") {
		return;
	}

	let stats: PeerStats = { sender: false };

	if (peer.metadata["CPULimited"]) {
		stats.cpuLimited = true;
		peer.metadata["CPULimited"] = false;
	}

	if (peer.metadata["GPULimited"]) {
		stats.gpuLimited = true;
		peer.metadata["GPULimited"] = false;
	}

	const playbackStats = video?.getVideoPlaybackQuality();
	const lastPlaybackStats: VideoPlaybackQuality | undefined =
		peer.metadata["_videoPlaybackQuality"];

	if (
		playbackStats &&
		lastPlaybackStats &&
		playbackStats.totalVideoFrames &&
		playbackStats.droppedVideoFrames &&
		playbackStats.totalVideoFrames >= lastPlaybackStats.totalVideoFrames
	) {
		stats.frameDropPercent =
			(playbackStats.droppedVideoFrames -
				lastPlaybackStats.droppedVideoFrames) /
			(playbackStats.totalVideoFrames -
				lastPlaybackStats.totalVideoFrames);
	}

	peer.metadata["_videoPlaybackQuality"] = playbackStats;

	const peerStats = Array.from(await peer.pc.getStats());

	let maxPlayoutTimestamp: number | undefined;
	let minPlayoutTimestamp: number | undefined;

	for (const [_, report] of peerStats) {
		const lastReport = peer.metadata["_" + report.type + "_" + report.id];

		if (report.type === "outbound-rtp") {
			stats.sender = true;

			if (report.kind === "video") {
				if (report.targetBitrate) {
					stats.targetVideoBitrate =
						report.targetBitrate +
						(stats.targetVideoBitrate
							? stats.targetVideoBitrate
							: 0);
				}
				if (
					report.totalEncodeTime &&
					lastReport?.totalEncodeTime &&
					report.timestamp &&
					lastReport?.timestamp
				) {
					const encodeProportion =
						((report.totalEncodeTime - lastReport.totalEncodeTime) *
							1000) /
						(report.timestamp - lastReport.timestamp);

					if (encodeProportion > 0.99) {
						stats.cpuLimited = true;
					}
				}
			}
			if (report.kind === "audio" && report.targetBitrate) {
				stats.targetAudioBitrate =
					report.targetBitrate +
					(stats.targetAudioBitrate ? stats.targetAudioBitrate : 0);
			}
			if (report.qualityLimitationReason === "cpu") {
				stats.cpuLimited = true;
			}
		}

		if (report.type === "inbound-rtp") {
			if (
				lastReport?.jitterBufferDelay &&
				lastReport?.jitterBufferEmittedCount
			) {
				stats.jitterBufferDelay = Math.max(
					(report.jitterBufferDelay - lastReport.jitterBufferDelay) /
						(report.jitterBufferEmittedCount -
							lastReport.jitterBufferEmittedCount),
					stats.jitterBufferDelay
						? stats.jitterBufferDelay
						: -Infinity
				);
			}
			if (
				lastReport?.packetsLost !== undefined &&
				lastReport?.packetsReceived !== undefined
			) {
				stats.lossPercent = Math.max(
					(report.packetsLost - lastReport.packetsLost) /
						(report.packetsLost +
							report.packetsReceived -
							(lastReport.packetsLost +
								lastReport.packetsReceived)),
					stats.lossPercent ? stats.lossPercent : -Infinity
				);
			} else if (report.fractionLost !== undefined) {
				stats.lossPercent = Math.max(
					report.fractionLost,
					stats.lossPercent ? stats.lossPercent : -Infinity
				);
			}
			if (report.jitter) {
				stats.jitter = Math.max(
					report.jitter,
					stats.jitter ? stats.jitter : -Infinity
				);
			}
			if (report.estimatedPlayoutTimestamp) {
				maxPlayoutTimestamp = Math.max(
					report.estimatedPlayoutTimestamp,
					maxPlayoutTimestamp ? maxPlayoutTimestamp : -Infinity
				);
				minPlayoutTimestamp = Math.min(
					report.estimatedPlayoutTimestamp,
					minPlayoutTimestamp ? minPlayoutTimestamp : Infinity
				);
			}
		}

		if (
			report.type === "remote-inbound-rtp" ||
			report.type === "remote-outbound-rtp"
		) {
			if (
				lastReport?.totalRoundTripTime &&
				lastReport?.roundTripTimeMeasurements
			) {
				stats.roundTripTime = Math.max(
					(report.totalRoundTripTime -
						lastReport.totalRoundTripTime) /
						(report.roundTripTimeMeasurements -
							lastReport.roundTripTimeMeasurements),
					stats.roundTripTime ? stats.roundTripTime : -Infinity
				);
			} else if (report.roundTripTime) {
				stats.roundTripTime = Math.max(
					report.roundTripTime,
					stats.roundTripTime ? stats.roundTripTime : -Infinity
				);
			}
			if (
				lastReport?.packetsLost !== undefined &&
				lastReport?.packetsReceived !== undefined
			) {
				stats.lossPercent = Math.max(
					(report.packetsLost - lastReport.packetsLost) /
						(report.packetsLost +
							report.packetsReceived -
							(lastReport.packetsLost +
								lastReport.packetsReceived)),
					stats.lossPercent ? stats.lossPercent : -Infinity
				);
			} else if (report.fractionLost !== undefined) {
				stats.lossPercent = Math.max(
					report.fractionLost,
					stats.lossPercent ? stats.lossPercent : -Infinity
				);
			}
			if (report.jitter) {
				stats.jitter = Math.max(
					report.jitter,
					stats.jitter ? stats.jitter : -Infinity
				);
			}
		}

		if (report.type === "transport") {
			if (
				lastReport?.timestamp &&
				lastReport?.bytesSent &&
				lastReport?.bytesReceived
			) {
				const sinceLast = report.timestamp - lastReport.timestamp;

				stats.outgoingBandwidth =
					(report.bytesSent - lastReport.bytesSent) / sinceLast +
					(stats.outgoingBandwidth ? stats.outgoingBandwidth : 0);
				stats.incomingBandwidth =
					(report.bytesReceived - lastReport.bytesReceived) /
						sinceLast +
					(stats.incomingBandwidth ? stats.incomingBandwidth : 0);
			}
		}

		peer.metadata["_" + report.type + "_" + report.id] = report;
	}

	if (stats.targetVideoBitrate) {
		stats.targetVideoBitrate = Math.round(stats.targetVideoBitrate / 1000);
	}

	if (stats.targetAudioBitrate) {
		stats.targetAudioBitrate = Math.round(stats.targetAudioBitrate / 1000);
	}

	if (stats.jitterBufferDelay) {
		stats.jitterBufferDelay = Math.round(stats.jitterBufferDelay * 1000);
	}

	if (maxPlayoutTimestamp && minPlayoutTimestamp) {
		stats.desync = Math.round(maxPlayoutTimestamp - minPlayoutTimestamp);
	}

	if (stats.frameDropPercent) {
		stats.frameDropPercent = Math.round(stats.frameDropPercent * 100);
	}

	if (stats.incomingBandwidth) {
		stats.incomingBandwidth = Math.round(stats.incomingBandwidth * 8);
	}

	if (stats.outgoingBandwidth) {
		stats.outgoingBandwidth = Math.round(stats.outgoingBandwidth * 8);
	}

	if (stats.roundTripTime) {
		stats.roundTripTime = Math.round(stats.roundTripTime * 1000);
	}

	if (stats.jitter) {
		stats.jitter = Math.round(stats.jitter * 1000);
	}

	if (stats.lossPercent) {
		stats.lossPercent = Math.round(stats.lossPercent * 1000) / 10;
	}

	return stats;
}
