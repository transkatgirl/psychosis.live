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
		configuration: RTCConfiguration
	) {
		this.configuration = configuration;

		this.room = new MqttRoom(client, topic, key, async (message) => {
			try {
				const sendResponse = (response: any) => {
					this.room.send(
						{
							from: selfId,
							to: message.from,
							payload: this.encoder.encode(
								JSON.stringify(response)
							),
						},
						2
					);
				};

				const peer = message.from.toString();

				if (message.to && message.payload) {
					const pc = this.peers[peer];

					if (pc) {
						pc.handleMessage(
							JSON.parse(this.decoder.decode(message.payload)),
							sendResponse
						);
					}
				} else if (!(peer in this.peers)) {
					this.peers[peer] = new Peer(
						configuration,
						message.from < selfId,
						sendResponse
					);
				}
			} catch (err) {
				console.error(err);
			}
		});

		this.intervalId = window.setInterval(() => {
			this.room.send(
				{
					from: selfId,
				},
				0
			);
		}, 1000);
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

interface WebRTCMessage {
	desc?: RTCSessionDescriptionInit;
	can?: RTCIceCandidateInit;
}

class Peer {
	pc: RTCPeerConnection;
	polite: boolean;
	makingOffer = false;
	ignoreOffer = false;
	isSettingRemoteAnswerPending = false;
	constructor(
		configuration: RTCConfiguration,
		polite: boolean,
		sendResponse: (message: WebRTCMessage) => void
	) {
		this.pc = new RTCPeerConnection(configuration);
		this.polite = polite;
		this.pc.onicecandidate = ({ candidate }) => {
			try {
				sendResponse({ can: candidate?.toJSON() });
			} catch (err) {
				console.error(err);
			}
		};
		this.pc.onnegotiationneeded = async () => {
			try {
				this.makingOffer = true;
				await this.pc.setLocalDescription();
				sendResponse({
					desc: this.pc.localDescription?.toJSON(),
				});
			} catch (err) {
				console.error(err);
			} finally {
				this.makingOffer = false;
			}
		};
	}
	async handleMessage(
		message: WebRTCMessage,
		sendResponse: (message: WebRTCMessage) => void
	) {
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
				sendResponse({
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
}
