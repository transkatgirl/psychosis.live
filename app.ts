import bs58 from "bs58";
import { joinRoom, type NostrRoomConfig } from "./packages/trystero-nostr/src";
import type { Room } from "./packages/trystero-core/src";
import type { MediaConfig } from "./packages/trystero-core/src/types";

const params: URLSearchParams = new URL(window.location.href).searchParams;

enum Role {
	Sender = "sender",
	Receiver = "receiver",
}

if (params.has("role") && params.has("id") && params.has("password")) {
	let roleString = params.get("role");
	let id = params.get("id");
	let password = params.get("password");

	let role;
	if (roleString == Role.Sender) {
		role = Role.Sender;
	} else if (roleString == Role.Receiver) {
		role = Role.Receiver;
	}

	if (role && id && password) {
		await launchApp(role, id, password, params);
	} else {
		helperMenu();
	}
} else {
	helperMenu();
}

function helperMenu() {
	document.title = "psychosis.live";

	document.body.innerHTML =
		'<h1>psychosis.live</h1><p>This service allows you to stream <em>end-to-end encrypted</em> video from your smartphone into OBS over practically any internet connection, allowing you to stream anything from anywhere with an internet connection.</p><p>Unlike similar services, such as <a href="https://vdo.ninja">VDO.Ninja</a>, psychosis.live focuses primarily on ensuring watchability over poor connections.</p>';

	const roomLabel = document.createElement("label");
	roomLabel.htmlFor = "room";
	roomLabel.innerText = "Room ID: ";
	const roomInput = document.createElement("input");
	roomInput.id = "room";
	roomInput.type = "text";
	roomInput.required = true;
	roomInput.size = 16;
	roomInput.value = generateRandom(64);

	const passwordLabel = document.createElement("label");
	passwordLabel.htmlFor = "pass";
	passwordLabel.innerText = "Room Password: ";
	const passwordInput = document.createElement("input");
	passwordInput.id = "pass";
	passwordInput.type = "text";
	passwordInput.required = true;
	passwordInput.size = 64;
	passwordInput.value = generateRandom(256);

	document.body.appendChild(roomLabel);
	document.body.appendChild(roomInput);
	document.body.appendChild(document.createElement("br"));
	document.body.appendChild(passwordLabel);
	document.body.appendChild(passwordInput);

	document.body.insertAdjacentHTML(
		"beforeend",
		"<p><b>Write down your room ID and password!</b> Reloading the page will generate new random credentials.</p><p>After writing down your credentials, use the following URLs to start streaming:</p>"
	);

	const senderLabel = document.createElement("label");
	senderLabel.innerText = "Sender (your smartphone): ";
	senderLabel.htmlFor = "sender";
	const senderText = document.createElement("pre");
	senderText.id = "sender";
	senderText.style.backgroundColor = "lightcoral";

	const receiverLabel = document.createElement("label");
	receiverLabel.innerText = "Receiver (OBS Browser source): ";
	receiverLabel.htmlFor = "receiver";
	const receiverText = document.createElement("pre");
	receiverText.id = "receiver";
	receiverText.style.backgroundColor = "lightseagreen";

	senderText.innerText = generateURL(
		Role.Sender,
		roomInput.value,
		passwordInput.value
	);
	receiverText.innerText = generateURL(
		Role.Receiver,
		roomInput.value,
		passwordInput.value
	);

	roomInput.addEventListener("input", (event) => {
		senderText.innerText = generateURL(
			Role.Sender,
			roomInput.value,
			passwordInput.value
		);
		receiverText.innerText = generateURL(
			Role.Receiver,
			roomInput.value,
			passwordInput.value
		);
	});
	passwordInput.addEventListener("input", (event) => {
		senderText.innerText = generateURL(
			Role.Sender,
			roomInput.value,
			passwordInput.value
		);
		receiverText.innerText = generateURL(
			Role.Receiver,
			roomInput.value,
			passwordInput.value
		);
	});

	document.body.appendChild(senderLabel);
	document.body.appendChild(senderText);
	document.body.appendChild(document.createElement("br"));
	document.body.appendChild(receiverLabel);
	document.body.appendChild(receiverText);
}

function generateRandom(bits: number) {
	const data = new Uint8Array(bits / 8);
	self.crypto.getRandomValues(data);
	return bs58.encode(data);
}

function generateURL(role: Role, id: string, pass: string): string {
	const url = new URL(window.location.href);
	url.search = "";
	url.searchParams.set("role", role);
	url.searchParams.set("id", id);
	url.searchParams.set("password", pass);
	if (role == Role.Sender) {
		url.searchParams.set("aspectRatio", 1.7777777778);
		url.searchParams.set("frameRate", 60);
		url.searchParams.set("height", 1080);
		url.searchParams.set("width", 1920);
		url.searchParams.set("audioContentHint", "music");
		url.searchParams.set("videoContentHint", "motion");
		url.searchParams.set("degradationPreference", "balanced");
		url.searchParams.set("maxVideoBitrate", 15 * 1000);
		url.searchParams.set("maxAudioBitrate", 256);
	}
	return url.toString();
}

async function launchApp(
	role: Role,
	roomId: string,
	password: string,
	params: URLSearchParams
) {
	document.body.id = "app";

	let mediaConfig: MediaConfig = {
		networkPriority: "medium",
		codecOrderPreference: [
			"video/AV1",
			"video/H265",
			"video/VP9",
			"video/H264",
			"video/VP8",
			"audio/opus",
			"audio/mp4a-latm",
			"audio/G722",
			"audio/PCMU",
			"audio/PCMA",
		],
	};

	const degradationPreference = params.get("degradationPreference");
	if (degradationPreference) {
		mediaConfig.degradationPreference =
			degradationPreference as RTCDegradationPreference;
	}

	const maxVideoBitrate = Number(params.get("maxVideoBitrate"));
	if (params.has("maxVideoBitrate") && Number.isFinite(maxVideoBitrate)) {
		mediaConfig.maxVideoBitrate = maxVideoBitrate;
	}

	const maxAudioBitrate = Number(params.get("maxAudioBitrate"));
	if (params.has("maxAudioBitrate") && Number.isFinite(maxAudioBitrate)) {
		mediaConfig.maxAudioBitrate = maxAudioBitrate;
	}

	const maxFramerate = Number(params.get("maxFramerate"));
	if (params.has("maxFramerate") && Number.isFinite(maxFramerate)) {
		mediaConfig.maxFramerate = maxFramerate;
	}

	let config: NostrRoomConfig = {
		appId: "psychosis.live",
		trickleIce: true,
		rtcConfig: {
			iceTransportPolicy: "all",
			iceCandidatePoolSize: 10,
			bundlePolicy: "max-bundle",
		},
		mediaConfig,
	};
	if (password) {
		config.password = password;
	}

	const room = joinRoom(config, roomId, {
		onJoinError: (details) => {
			console.error(details);
		},
	});

	if (role == Role.Sender) {
		await launchSender(room);
	}

	if (role == Role.Receiver) {
		await launchReceiver(room);
	}
}

async function launchSender(room: Room) {
	// TODO: allow specifying all constraints

	const audioConstraints: MediaTrackConstraints = {
		autoGainControl: params.get("autoGainControl") === "true",
		echoCancellation: params.get("echoCancellation") === "true",
		noiseSuppression: params.get("noiseSuppression") === "true",
	};
	const videoConstraints: MediaTrackConstraints = {
		backgroundBlur: params.get("backgroundBlur") === "true",
	};

	const channelCount = Number(params.get("channelCount"));
	if (params.has("channelCount") && Number.isFinite(channelCount)) {
		audioConstraints.channelCount = {
			max: channelCount,
		};
	}

	const aspectRatio = Number(params.get("aspectRatio"));
	if (params.has("aspectRatio") && Number.isFinite(aspectRatio)) {
		videoConstraints.aspectRatio = {
			ideal: aspectRatio,
		};
	}

	const frameRate = Number(params.get("frameRate"));
	if (params.has("frameRate") && Number.isFinite(frameRate)) {
		videoConstraints.frameRate = {
			max: frameRate,
		};
	}

	const height = Number(params.get("height"));
	if (params.has("height") && Number.isFinite(height)) {
		videoConstraints.height = {
			max: height,
		};
	}

	const width = Number(params.get("width"));
	if (params.has("width") && Number.isFinite(width)) {
		videoConstraints.width = {
			max: width,
		};
	}

	const constraints: MediaStreamConstraints = {
		audio: audioConstraints,
		video: videoConstraints,
	};

	const stream = await navigator.mediaDevices.getUserMedia(constraints);

	const audioContentHint = params.get("audioContentHint");
	if (audioContentHint) {
		for (const audioTrack of stream.getAudioTracks()) {
			audioTrack.contentHint = audioContentHint;
		}
	}

	const videoContentHint = params.get("videoContentHint");
	if (videoContentHint) {
		for (const videoTrack of stream.getVideoTracks()) {
			videoTrack.contentHint = videoContentHint;
		}
	}

	const video = document.createElement("video");
	video.autoplay = true;
	video.muted = true;
	video.controls = true;
	video.srcObject = stream;
	document.body.appendChild(video);

	room.addStream(stream);
	room.onPeerJoin((peerId) => room.addStream(stream, peerId));

	// @ts-ignore
	globalThis.room = room;
}

async function launchReceiver(room: Room) {
	const peerVideos: any = {};
	const videoContainer = document.createElement("div");
	document.body.appendChild(videoContainer);

	room.onPeerJoin((peerId) => {
		console.log(`${peerId} joined`);
	});
	room.onPeerStream((stream, peerId) => {
		let video = peerVideos[peerId];

		if (!video) {
			video = document.createElement("video");
			video.autoplay = true;
			video.controls = true;

			videoContainer.appendChild(video);
		}

		video.srcObject = stream;
		peerVideos[peerId] = video;
	});
	room.onPeerLeave((peerId) => {
		console.log(`${peerId} left`);
		let video = peerVideos[peerId];

		if (video) {
			videoContainer.removeChild(video);
			peerVideos[peerId] = undefined;
		}
	});
}
