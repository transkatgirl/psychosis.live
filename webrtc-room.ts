import type { MqttClient } from "mqtt";
import { MqttRoom, selfId } from "./mqtt-room";

export class Room {
	room: MqttRoom;
	peers: Record<string, Peer> = {};
	encoder: TextEncoder = new TextEncoder();
	decoder: TextDecoder = new TextDecoder();
	configuration: RTCConfiguration;
	intervalId: number;
	public constructor(
		client: MqttClient,
		topic: string,
		key: CryptoKey,
		configuration: RTCConfiguration,
		configurePeer: (peerId: string, pc: Peer) => void,
		cleanupPeer: (peerId: string, pc: Peer) => void,
		monitorPeer: (peerId: string, pc: Peer) => void = () => {},
		mungeIncoming: (
			peerId: string,
			message: WebRTCMessage
		) => WebRTCMessage = (_, m) => m,
		mungeOutgoing: (
			peerId: string,
			message: WebRTCMessage
		) => WebRTCMessage = (_, m) => m,
		interval: number = 1000
	) {
		this.configuration = configuration;

		this.room = new MqttRoom(client, topic, key, async (message) => {
			try {
				const peerId = message.from.toString();

				const sendResponse = async (response: WebRTCMessage) => {
					await this.room.send(
						{
							from: selfId,
							to: message.from,
							payload: this.encoder.encode(
								JSON.stringify(mungeOutgoing(peerId, response))
							),
						},
						2
					);
				};

				if (message.to && message.payload) {
					const pc = this.peers[peerId];

					if (pc) {
						await pc.handleMessage(
							mungeIncoming(
								peerId,
								JSON.parse(this.decoder.decode(message.payload))
							),
							sendResponse
						);
					}
				} else if (!(peerId in this.peers)) {
					this.peers[peerId] = new Peer(
						configuration,
						message.from < selfId,
						sendResponse,
						(peer) => {
							cleanupPeer(peerId, peer);
						}
					);
					configurePeer(peerId, this.peers[peerId]);
				}
			} catch (err) {
				console.error(err);
			}
		});

		this.intervalId = window.setInterval(async () => {
			for (const [peerId, peer] of Object.entries(this.peers)) {
				if (!peer.pc) {
					delete this.peers[peerId];
				} else {
					monitorPeer(peerId, peer);
				}
			}

			await this.room.send(
				{
					from: selfId,
				},
				0
			);
		}, interval);
	}
}

/*

		const key = await deriveKey(password, roomId);
		const test = new MqttRoom(
			mqtt.connect("wss://broker.emqx.io:8084/mqtt", {
				reconnectPeriod: 1_000,
				reconnectOnConnackError: true,
				connectTimeout: 10_000,
			}),
			roomId,
			key,
			(message) => {
				console.log(message);
			}
		);


*/

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
	public constructor(
		configuration: RTCConfiguration,
		polite: boolean,
		sendMessage: (message: WebRTCMessage) => Promise<void>,
		beforeClose: (pc: Peer) => void
	) {
		this.pc = new RTCPeerConnection(configuration);
		this.polite = polite;
		this.beforeClose = beforeClose;
		this.pc.onicecandidate = async ({ candidate }) => {
			if (!candidate) return;

			try {
				await sendMessage({ can: candidate?.toJSON() });
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
		} else if (message.can) {
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

		this.beforeClose(this);

		this.pc.onicecandidate = null;
		this.pc.oniceconnectionstatechange = null;
		this.pc.onsignalingstatechange = null;
		this.pc.onnegotiationneeded = null;
		this.pc.close();
		this.pc = null;
	}
}
