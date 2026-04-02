import mqtt from "mqtt";
import { deriveKey, hashText, MqttRoom, selfId } from "./core";

export interface RoomCredentials {
	topic: string;
	key: CryptoKey;
}

export async function createRoomCredentials(
	identifier: string,
	password: string
): Promise<RoomCredentials> {
	const [key, hashedIdentifier] = await Promise.all([
		deriveKey(password, identifier),
		hashText(identifier),
	]);

	return {
		topic: hashedIdentifier.slice(0, 22),
		key,
	};
}

export class Room {
	room: MqttRoom;
	peers: Record<string, Peer> = {};
	encoder: TextEncoder = new TextEncoder();
	decoder: TextDecoder = new TextDecoder();
	intervalId: number;
	public constructor(
		mqttEndpoint: string,
		credentials: RoomCredentials,
		configuration: RTCConfiguration,
		configurePeer: (peerId: string, peer: Peer) => void,
		beforePeerClose: (peerId: string, peer: Peer) => void,
		onPeerScan: (peerId: string, peer: Peer) => void = () => {},
		mungeIncoming: (
			peerId: string,
			message: WebRTCMessage
		) => WebRTCMessage = (_, m) => m,
		mungeOutgoing: (
			peerId: string,
			message: WebRTCMessage
		) => WebRTCMessage = (_, m) => m,
		interval: number = 1_500
	) {
		this.room = new MqttRoom(
			mqtt.connect(mqttEndpoint, {
				reconnectPeriod: interval,
				reconnectOnConnackError: true,
				connectTimeout: 15_000,
				queueQoSZero: false,
				protocolVersion: 5,
				autoAssignTopicAlias: true,
			}),
			credentials.topic,
			credentials.key,
			async () => {
				await this.room.send(
					{
						from: selfId,
					},
					0
				);
			},
			async (message) => {
				try {
					const peerId = message.from.toString();

					const sendResponse = async (response: WebRTCMessage) => {
						await this.room.send(
							{
								from: selfId,
								to: message.from,
								payload: this.encoder.encode(
									JSON.stringify(
										mungeOutgoing(peerId, response)
									)
								),
							},
							0
						);
					};

					if (!(peerId in this.peers)) {
						this.peers[peerId] = new Peer(
							configuration,
							message.from < selfId,
							sendResponse,
							(peer) => {
								beforePeerClose(peerId, peer);
							}
						);
						configurePeer(peerId, this.peers[peerId]);
					}

					if (message.to == selfId && message.payload) {
						const pc = this.peers[peerId];

						if (pc) {
							await pc.handleMessage(
								mungeIncoming(
									peerId,
									JSON.parse(
										this.decoder.decode(message.payload)
									)
								),
								sendResponse
							);
						}
					}
				} catch (err) {
					console.error(err);
				}
			}
		);

		this.intervalId = window.setInterval(async () => {
			try {
				for (const [peerId, peer] of Object.entries(this.peers)) {
					if (!peer.pc) {
						delete this.peers[peerId];
					} else {
						onPeerScan(peerId, peer);
					}
				}

				await this.room.send(
					{
						from: selfId,
					},
					0
				);
			} catch (err) {
				console.error(err);
			}
		}, interval);
	}
	public async leave() {
		window.clearInterval(this.intervalId);

		await this.room.leave();

		for (const [peerId, peer] of Object.entries(this.peers)) {
			peer.close();
			delete this.peers[peerId];
		}
	}
}

export interface WebRTCMessage {
	desc?: RTCSessionDescriptionInit;
	can?: RTCIceCandidateInit;
}

export class Peer {
	public pc: RTCPeerConnection | null;
	polite: boolean;
	makingOffer = false;
	ignoreOffer = false;
	isSettingRemoteAnswerPending = false;
	beforeClose: (pc: Peer) => void;
	timeoutId: number | undefined;
	public constructor(
		configuration: RTCConfiguration,
		polite: boolean,
		sendMessage: (message: WebRTCMessage) => Promise<void>,
		beforeClose: (pc: Peer) => void,
		timeout: number = 15_000
	) {
		this.pc = new RTCPeerConnection(configuration);
		this.polite = polite;
		this.beforeClose = beforeClose;
		this.pc.onicecandidate = async ({ candidate }) => {
			if (!this.pc || !candidate?.candidate) return;

			try {
				await sendMessage({ can: candidate.toJSON() });
			} catch (err) {
				console.error(err);
			}
		};
		this.pc.oniceconnectionstatechange = () => {
			if (!this.pc) return;

			switch (this.pc.iceConnectionState) {
				case "closed":
				case "failed":
					this.close();
					break;
			}
		};
		this.pc.onconnectionstatechange = () => {
			if (!this.pc) return;

			switch (this.pc.connectionState) {
				case "connected":
					this.clearCloseTimeout();
					break;
				case "closed":
				case "failed":
					this.close();
					break;
				default:
					this.setCloseTimeout(timeout);
			}
		};
		this.pc.onsignalingstatechange = () => {
			if (!this.pc) return;

			switch (this.pc.signalingState) {
				case "closed":
					this.close();
					break;
			}
		};
		this.pc.onnegotiationneeded = async () => {
			if (!this.pc) return;
			this.setCloseTimeout(timeout);

			try {
				this.makingOffer = true;
				await this.pc.setLocalDescription();
				await sendMessage({
					desc: this.pc.localDescription?.toJSON(),
				});
			} catch (err) {
				console.error(err);
			} finally {
				this.makingOffer = false;
			}
		};
	}
	public async handleMessage(
		message: WebRTCMessage,
		sendMessage: (message: WebRTCMessage) => Promise<void>
	) {
		if (!this.pc) return;

		if (message.desc) {
			const readyForOffer =
				!this.makingOffer &&
				(this.pc.signalingState === "stable" ||
					this.isSettingRemoteAnswerPending);
			const offerCollision =
				message.desc.type === "offer" && !readyForOffer;

			this.ignoreOffer = !this.polite && offerCollision;
			if (this.ignoreOffer) {
				return;
			}

			this.isSettingRemoteAnswerPending = message.desc.type === "answer";
			await this.pc.setRemoteDescription(message.desc);
			this.isSettingRemoteAnswerPending = false;

			if (message.desc.type === "offer") {
				await this.pc.setLocalDescription();
				await sendMessage({
					desc: this.pc.localDescription?.toJSON(),
				});
			}
		}

		if (message.can) {
			try {
				await this.pc.addIceCandidate(message.can);
			} catch (err) {
				if (!this.ignoreOffer) {
					throw err;
				}
			}
		}
	}
	public close() {
		if (!this.pc) return;

		try {
			this.beforeClose(this);
		} catch (error) {
			console.error(error);
		}

		this.pc.onicecandidate = null;
		this.pc.oniceconnectionstatechange = null;
		this.pc.onconnectionstatechange = null;
		this.pc.onsignalingstatechange = null;
		this.pc.onnegotiationneeded = null;
		this.clearCloseTimeout();
		this.pc.close();
		this.pc = null;
	}
	setCloseTimeout(timeout: number) {
		if (!this.pc) return;

		if (this.timeoutId) {
			window.clearTimeout(this.timeoutId);
		}

		this.timeoutId = window.setTimeout(() => this.close(), timeout);
	}
	clearCloseTimeout() {
		if (this.timeoutId) {
			window.clearTimeout(this.timeoutId);
		}
	}
}
