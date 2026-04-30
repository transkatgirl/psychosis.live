import { compress, convertUint8Array, decompress } from "./room/core";
import type { Peer } from "./room/webrtc";

interface PeerStats {
	sender: boolean;

	targetAudioBitrate?: number;
	targetVideoBitrate?: number;
	cpuLimited?: boolean;
	desync?: number;
	jitterBufferDelay?: number;

	incomingBandwidth?: number;
	outgoingBandwidth?: number;
	roundTripTime?: number;
	jitter?: number;
	loss?: number;
}

export function combineStats(local: PeerStats, remote: PeerStats) {
	const stats = structuredClone(local);

	if (!stats.sender && remote.targetAudioBitrate) {
		stats.targetAudioBitrate = remote.targetAudioBitrate;
	}

	if (!stats.sender && remote.targetVideoBitrate) {
		stats.targetVideoBitrate = remote.targetVideoBitrate;
	}

	if (remote.cpuLimited) {
		stats.cpuLimited = true;
	}

	if (remote.desync) {
		stats.desync = Math.max(stats.desync ? stats.desync : 0, remote.desync);
	}

	if (remote.jitterBufferDelay) {
		stats.jitterBufferDelay = Math.max(
			stats.jitterBufferDelay ? stats.jitterBufferDelay : 0,
			remote.jitterBufferDelay
		);
	}

	if (!stats.roundTripTime && remote.roundTripTime) {
		stats.roundTripTime = remote.roundTripTime;
	}

	if (!stats.jitter && remote.jitter) {
		stats.jitter = remote.jitter;
	}

	if (!stats.loss && remote.loss) {
		stats.loss = remote.loss;
	}

	return stats;
}

export async function parseChannelMessage(
	message: ArrayBuffer,
	decoder: TextDecoder
): Promise<PeerStats> {
	return JSON.parse(decoder.decode(await decompress(message)));
}

export async function getPeerStats(
	peer: Peer,
	encoder: TextEncoder,
	channel?: RTCDataChannel, // Max message size of 64kB
	video?: HTMLVideoElement
): Promise<PeerStats | undefined> {
	if (!peer.pc || peer.pc?.connectionState === "new") {
		return;
	}

	let stats: PeerStats = { sender: false };

	const playbackStats = video?.getVideoPlaybackQuality();
	const lastPlaybackStats: VideoPlaybackQuality | undefined =
		peer.metadata["_videoPlaybackQuality"];

	if (
		playbackStats &&
		lastPlaybackStats &&
		playbackStats.totalVideoFrames > lastPlaybackStats.totalVideoFrames &&
		playbackStats.droppedVideoFrames >=
			lastPlaybackStats.droppedVideoFrames &&
		playbackStats.droppedVideoFrames -
			lastPlaybackStats.droppedVideoFrames >
			(playbackStats.totalVideoFrames -
				lastPlaybackStats.totalVideoFrames) *
				0.5 // We can't differentiate between frames dropped due to A/V desync and frames dropped due to the decoder being overloaded, so we should be really conservative here
	) {
		stats.cpuLimited = true;
	}

	peer.metadata["_videoPlaybackQuality"] = playbackStats;

	const peerStats = Array.from(await peer.pc.getStats());

	let maxPlayoutTimestamp: number | undefined;
	let minPlayoutTimestamp: number | undefined;

	for (const [_, report] of peerStats) {
		const lastReport = peer.metadata["_" + report.type + "_" + report.id];

		if (report.type === "outbound-rtp") {
			stats.sender = true;

			if (report.kind === "video" && report.targetBitrate) {
				stats.targetVideoBitrate =
					report.targetBitrate +
					(stats.targetVideoBitrate ? stats.targetVideoBitrate : 0);
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
				stats.loss = Math.max(
					(report.packetsLost - lastReport.packetsLost) /
						(report.packetsLost +
							report.packetsReceived -
							(lastReport.packetsLost +
								lastReport.packetsReceived)),
					stats.loss ? stats.loss : -Infinity
				);
			} else if (report.fractionLost !== undefined) {
				stats.loss = Math.max(
					report.fractionLost,
					stats.loss ? stats.loss : -Infinity
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
				stats.loss = Math.max(
					(report.packetsLost - lastReport.packetsLost) /
						(report.packetsLost +
							report.packetsReceived -
							(lastReport.packetsLost +
								lastReport.packetsReceived)),
					stats.loss ? stats.loss : -Infinity
				);
			} else if (report.fractionLost !== undefined) {
				stats.loss = Math.max(
					report.fractionLost,
					stats.loss ? stats.loss : -Infinity
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

	if (stats.loss) {
		stats.loss = Math.round(stats.loss * 1000) / 10;
	}

	if (channel && channel.readyState === "open") {
		channel.send(
			await compress(
				convertUint8Array(encoder.encode(JSON.stringify(stats)))
			)
		);
	}

	return stats;
}
