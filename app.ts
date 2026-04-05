import bs58 from "bs58";
import {
	createRoomCredentials,
	Peer,
	Room,
	type RoomCredentials,
} from "./room/webrtc";
import { selfId, setSelfId } from "./room/core";
import {
	adaptiveSettings,
	buildSenderEncoding,
	mungeSDP,
	setCodecPreferences,
	setReceiverSettings,
	setSenderSettings,
} from "./media";

const defaultMqttEndpoint = "wss://broker.emqx.io:8084/mqtt";
const defaultIceServers: RTCIceServer[] = [
	{ urls: "stun:stun.l.google.com:19302" },
	{ urls: "stun:stun1.l.google.com:19302" },
	{ urls: "stun:stun2.l.google.com:19302" },
	{ urls: "stun:stun3.l.google.com:19302" },
	{ urls: "stun:stun4.l.google.com:19302" },
	{ urls: "stun:stun.cloudflare.com:3478" },
];

const fragment = new URL(window.location.href).hash.substring(1);
const params: URLSearchParams = new URL(window.location.href).searchParams;

enum Role {
	Sender = "sender",
	Receiver = "receiver",
}

if (params.has("role") && params.has("id")) {
	let roleString = params.get("role");
	let id = params.get("id");
	let password: string | undefined = fragment;

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
		'<h1>psychosis.live</h1><p>This service allows you to stream <em>end-to-end encrypted</em> video from your smartphone into OBS over practically any internet connection, allowing you to stream anything from anywhere with an internet connection.</p><p>Unlike similar services, such as <a href="https://vdo.ninja">VDO.Ninja</a>, psychosis.live focuses on <em>both</em> preserving watchability over poor connections and delivering the highest quality possible over good connections.</p><p>It is strongly recommended that you <b>use Google Chrome on both sides of the connection</b> for the best possible experience, as WebRTC implementations vary significantly between browsers.</p>';

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
		"<p><b>Write down your room ID and password!</b> Reloading this page will generate new random credentials.</p><p>After writing down your credentials, use the following URLs to start streaming:</p>"
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

	document.body.insertAdjacentHTML(
		"beforeend",
		"<p>Requires a fairly powerful device due to use of newer video codecs, especially if using high resolutions and frame rates.</p><p>Supports up to 25 simultaneous senders. However, it is recommended that you stick to &lt;= 4 simultaneous senders to avoid overloading your receiver.</p><p>If you plan on streaming from very slow networks, it is recommended that you assign as few senders to a room as possible.</br>Every additional client results in an additional ~0.5 kbit/s of traffic to all clients, and a client joining results in ~24 kbit of data being sent to all clients (this may be fixed in the future).</p>"
	);

	document.body.appendChild(receiverLabel);
	document.body.appendChild(receiverText);

	document.body.insertAdjacentHTML(
		"beforeend",
		'<p>Although this app will not <em>stop you from</em> having multiple receivers, it is a <b>very bad idea</b> to have more than one active receiver in a room, as senders send video data directly to every receiver.</p><details><summary>URL parameters (advanced)</summary><p>Sender & Receiver:</p><ul><li><code>role</code> = Role (<code>sender</code> or <code>receiver</code>)</li><li><code>id</code> = Room ID</li><li>Fragment (text after <code>#</code>) = Room Password (required for E2E encryption)</li></ul><p>All of the below parameters are optional.</p><p>Sender & Receiver:</p><ul><li><code>stats</code> = Enable connection statistics overlay (boolean)</li><li><code>mqttEndpoint</code> = <a href="https://github.com/mqttjs/MQTT.js#mqttconnecturl-options">MQTT WebSocket endpoint URL</a> (string); Used for WebRTC signaling</li><li><code>iceServers</code> = <a href="https://w3c.github.io/webrtc-pc/#dom-rtcconfiguration-iceservers">WebRTC ICE Servers</a> (JSON-encoded list of <a href="https://w3c.github.io/webrtc-pc/#dom-rtciceserver">RTCIceServer</a> objects)</li><li><code>codecPreferences</code> = <a href="https://blog.mozilla.org/webrtc/cross-browser-support-for-choosing-webrtc-codecs/">Preferred WebRTC Codec Ordering</a> (JSON-encoded list of MIME types)</li><li>It is highly recommended that you use the same WebRTC settings on both ends to avoid connection establishment issues</li></ul><p>Sender Only:</p><ul><li><code>showAudio</code> = Enable audio (boolean)</li><li><code>showVideo</code> = Enable video (boolean)</li><li><code>channelCount</code> = Preferred audio channel count (integer)</li><li><code>width</code> = Preferred video width (pixels)</li><li><code>height</code> = Preferred video height (pixels)</li><li><code>frameRate</code> = Preferred video frame rate (frames/second)</li><li><code>aspectRatio</code> = Preferred video aspect ratio (number, rounded to 10 decimal places)</li><li><code></code> = </li><li><code>displayMedia</code> = Use <a href="https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia">getDisplayMedia</a> instead of <a href="https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia">getUserMedia</a> when creating a MediaStream (boolean)</li><li><code>autoGainControl</code> = <a href="https://w3c.github.io/mediacapture-main/#def-constraint-autoGainControl">Audio MediaTrackConstraints Automatic Gain Control</a> (boolean)</li><li><code>echoCancellation</code> = <a href="https://w3c.github.io/mediacapture-main/#def-constraint-echoCancellation">Audio MediaTrackConstraints Echo Cancellation</a> (limited to boolean)</li><li><code>noiseSuppression</code> = <a href="https://w3c.github.io/mediacapture-main/#def-constraint-noiseSuppression">Audio MediaTrackConstraints Noise Suppression</a> (boolean)</li><li><code>backgroundBlur</code> = <a href="https://w3c.github.io/mediacapture-main/#def-constraint-backgroundBlur">Video MediaTrackConstraints Background Blur</a> (boolean)</li><li><code>audioContentHint</code> = <a href="https://w3c.github.io/mst-content-hint/#audio-content-hints">MediaStreamTrack Audio Content Hint</a></li><li><code>videoContentHint</code> = <a href="https://w3c.github.io/mst-content-hint/#video-content-hints">MediaStreamTrack Video Content Hint</a></li><li><code>maxAudioBitrate</code> = <a href="https://w3c.github.io/webrtc-pc/#dom-rtcrtpencodingparameters-maxbitrate">WebRTC Maximum Audio Bitrate</a> (kilobits/second)</li><li><code>dynamicAudioBitrate</code> = Uses JavaScript to dynamically adjust the maximum audio bitrate between 48 kbit/s and <code>maxAudioBitrate</code> based on video bitrate (boolean); Always disabled if <code>displayMedia</code> = true</li><li><code>dynamicVideoFramerate</code> = Uses JavaScript to dynamically adjust the maximum video frame rate between 24 fps and <code>frameRate</code> based on video bitrate (boolean); Always disabled if <code>displayMedia</code> = true</li><li><code>maxVideoBitrate</code> = <a href="https://w3c.github.io/webrtc-pc/#dom-rtcrtpencodingparameters-maxbitrate">WebRTC Maximum Video Bitrate</a> (kilobits/second)</li><li><code>degradationPreference</code> = <a href="https://w3c.github.io/mst-content-hint/#dictionary-rtcrtpsendparameters-new-members">WebRTC Video Degradation Preference</a> (<a href="https://w3c.github.io/mst-content-hint/#dom-rtcdegradationpreference">RTCDegradationPreference</a>)</li></ul><p>Receiver Only:</p><ul><li><code>hideControls</code> = Disable video controls (boolean)</li><li><code>jitterBufferTarget</code> = <a href="https://w3c.github.io/webrtc-pc/#dom-rtcrtpreceiver-jitterbuffertarget">WebRTC Jitter Buffer Target</a> (miliseconds)</li></ul></details><p>Made by <a href="https://x.com/transkatgirl">transkatgirl</a>.</p>'
	);
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
	url.hash = pass;
	if (role == Role.Sender) {
		url.searchParams.set("stats", "true");
		url.searchParams.set("width", String(1920));
		url.searchParams.set("height", String(1080));
		url.searchParams.set("frameRate", String(60));
		url.searchParams.set("autoGainControl", "true");
		url.searchParams.set("audioContentHint", "music"); // disables most audio processing
		url.searchParams.set("videoContentHint", "motion");
		url.searchParams.set("maxAudioBitrate", String(192)); // chosen based on https://wiki.hydrogenaudio.org/index.php?title=Opus#Music_encoding_quality
		url.searchParams.set("dynamicAudioBitrate", "true");
		url.searchParams.set("dynamicVideoFramerate", "true");
		url.searchParams.set("maxVideoBitrate", String(15 * 1000));
	}
	if (role == Role.Receiver) {
		url.searchParams.set("jitterBufferTarget", String(1300)); // chosen based on https://ieeexplore.ieee.org/document/6962149
	}
	url.searchParams.set(
		"codecPreferences",
		JSON.stringify([
			"video/AV1",
			"video/VP9",
			"video/H265",
			"video/H264",
			"video/VP8",
			"audio/opus",
			"audio/red",
			"audio/mp4a-latm",
			"audio/G722",
			"audio/PCMU",
			"audio/PCMA",
		])
	);
	return url.toString();
}

async function launchApp(
	role: Role,
	roomId: string,
	password: string,
	params: URLSearchParams
) {
	document.body.id = "app";

	if (role == Role.Sender && selfId % 2n == 0n) {
		setSelfId(selfId - 1n); // Signaling hack: Senders have odd IDs
	}

	if (role == Role.Receiver && selfId % 2n == 1n) {
		setSelfId(selfId - 1n); // Signaling hack: Receivers have even IDs
	}

	console.log(`role = ${role}, peer ID = ${selfId}`);

	const credentials = await createRoomCredentials(roomId, password);

	if (role == Role.Sender) {
		await launchSender(credentials);
	}

	if (role == Role.Receiver) {
		await launchReceiver(credentials);
	}
}

async function launchSender(credentials: RoomCredentials) {
	let mqttEndpoint = defaultMqttEndpoint;
	let iceServers: any;
	let codecOrderPreference: any;
	let degradationPreference;
	let maxVideoBitrate;
	let maxAudioBitrate;
	let maxFramerate;

	if (params.has("mqttEndpoint")) {
		mqttEndpoint = params.get("mqttEndpoint") as string;
	}

	if (params.has("iceServers")) {
		iceServers = JSON.parse(params.get("iceServers") as string);

		if (!Array.isArray(iceServers)) {
			iceServers = defaultIceServers;
		}
	} else {
		iceServers = defaultIceServers;
	}

	if (params.has("codecPreferences")) {
		codecOrderPreference = JSON.parse(
			params.get("codecPreferences") as string
		);

		if (!Array.isArray(codecOrderPreference)) {
			codecOrderPreference = undefined;
		}
	} else {
		codecOrderPreference = undefined;
	}

	degradationPreference = params.get(
		"degradationPreference"
	) as RTCDegradationPreference | null;
	if (degradationPreference === null) {
		degradationPreference = undefined;
	}

	maxVideoBitrate = Number(params.get("maxVideoBitrate"));
	if (!(params.has("maxVideoBitrate") && Number.isFinite(maxVideoBitrate))) {
		maxVideoBitrate = undefined;
	}

	let audioBitrateCeil = undefined;

	maxAudioBitrate = Number(params.get("maxAudioBitrate"));
	if (params.has("maxAudioBitrate") && Number.isFinite(maxAudioBitrate)) {
		maxAudioBitrate = maxAudioBitrate;
		audioBitrateCeil = maxAudioBitrate * 1000;
	} else {
		maxAudioBitrate = undefined;
	}

	let framerateCeil: number | undefined;

	maxFramerate = Number(params.get("maxFramerate"));
	if (params.has("maxFramerate") && Number.isFinite(maxFramerate)) {
		maxFramerate = maxFramerate;
		framerateCeil = maxFramerate;
	} else {
		const frameRate = Number(params.get("frameRate"));
		if (params.has("frameRate") && Number.isFinite(frameRate)) {
			maxFramerate = frameRate;
			framerateCeil = frameRate;
		} else {
			maxFramerate = undefined;
		}
	}

	// TODO: allow specifying all constraints
	// TODO: display stats: video bitrate, audio bitrate, network stats, cpu usage

	let showAudio = params.get("showAudio") === "true";
	if (!params.has("showAudio")) {
		showAudio = true;
	}

	let showVideo = params.get("showVideo") === "true";
	if (!params.has("showVideo")) {
		showVideo = true;
	}

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
			ideal: channelCount,
		};
	}

	const frameRate = Number(params.get("frameRate"));
	if (params.has("frameRate") && Number.isFinite(frameRate)) {
		videoConstraints.frameRate = {
			ideal: frameRate,
		};
	}

	const height = Number(params.get("height"));
	if (params.has("height") && Number.isFinite(height)) {
		videoConstraints.height = {
			ideal: height,
		};
	}

	const width = Number(params.get("width"));
	if (params.has("width") && Number.isFinite(width)) {
		videoConstraints.width = {
			ideal: width,
		};
	}

	const aspectRatio = Number(params.get("aspectRatio"));
	if (params.has("aspectRatio") && Number.isFinite(aspectRatio)) {
		videoConstraints.aspectRatio = {
			ideal: aspectRatio,
		};
	} else if (
		params.has("height") &&
		Number.isFinite(height) &&
		params.has("width") &&
		Number.isFinite(width)
	) {
		videoConstraints.aspectRatio = {
			ideal: width / height,
		};
	}

	const constraints: MediaStreamConstraints | DisplayMediaStreamOptions = {
		audio: audioConstraints,
		video: videoConstraints,
	};

	if (!showAudio) {
		constraints.audio = false;
	}

	if (!showVideo) {
		constraints.video = false;
	}

	let stream: MediaStream;

	if (params.get("displayMedia") === "true") {
		// @ts-ignore
		constraints.monitorTypeSurfaces = "include";
		// @ts-ignore
		constraints.preferCurrentTab = false;
		// @ts-ignore
		constraints.selfBrowserSurface = "exclude";
		// @ts-ignore
		constraints.surfaceSwitching = "include";
		// @ts-ignore
		constraints.systemAudio = "include";
		// @ts-ignore
		//constraints.windowAudio = "window";

		stream = await navigator.mediaDevices.getDisplayMedia(constraints);
	} else {
		stream = await navigator.mediaDevices.getUserMedia(constraints);
	}

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
	video.playsInline = true;
	video.srcObject = stream;
	video.classList.add("preview");
	document.body.appendChild(video);

	const overlay = document.createElement("div");
	overlay.classList.add("stats-overlay");
	document.body.appendChild(overlay);

	overlay.ondblclick = async () => {
		if (document.fullscreenElement) {
			await document.exitFullscreen();
		} else {
			await document.body.requestFullscreen();
		}
	};

	const settings = document.createElement("div");
	settings.classList.add("settings-overlay");
	document.body.appendChild(settings);

	await inputOverlay(settings, stream);

	navigator.mediaDevices.addEventListener("devicechange", async () => {
		await inputOverlay(settings, stream);
	});

	const addTrack = async (
		pc: RTCPeerConnection,
		track: MediaStreamTrack,
		stream: MediaStream
	) => {
		let transceiver = pc.addTransceiver(track, {
			sendEncodings: [
				buildSenderEncoding(
					track.kind,
					maxVideoBitrate,
					maxFramerate,
					maxAudioBitrate,
					"very-low",
					"high"
				),
			],
			streams: [stream],
		});
		if (codecOrderPreference) {
			setCodecPreferences(transceiver, codecOrderPreference);
		}
		await setSenderSettings(transceiver.sender, degradationPreference);
	};

	(globalThis as any).stream = stream;
	(globalThis as any).room = new Room(
		mqttEndpoint,
		credentials,
		{
			iceCandidatePoolSize: 10,
			iceServers,
		},
		(peerId, peer) => {
			if (BigInt(peerId) % 2n == 0n) {
				stream.getTracks().forEach((track) => {
					if (!peer.pc) return;

					addTrack(peer.pc, track, stream);
				});
			}
		},
		(_peerId, _peer) => {},
		async (peers) => {
			for (const [peerId, peer] of Object.entries(peers)) {
				if (!peer.pc) continue;

				await adaptiveSettings(
					peer.pc,
					params.get("dynamicAudioBitrate") === "true" &&
						params.get("displayMedia") !== "true",
					params.get("dynamicVideoFramerate") === "true" &&
						params.get("displayMedia") !== "true",
					audioBitrateCeil,
					framerateCeil
				);
			}

			if (params.get("stats") === "true") {
				await statsOverlay(overlay, peers);
			}
		},
		(_, message) => {
			if (message.desc?.sdp) {
				message.desc.sdp = mungeSDP(message.desc.sdp);
			}
			return message;
		},
		(_, message) => {
			if (message.desc?.sdp) {
				message.desc.sdp = mungeSDP(message.desc.sdp);
			}
			return message;
		}
	);
	stream.onaddtrack = async (event) => {
		const room = (globalThis as any).room as Room;

		for (const [peerId, peer] of Object.entries(room.peers)) {
			if (!peer.pc || BigInt(peerId) % 2n != 0n) continue;

			addTrack(peer.pc, event.track, stream);
		}

		await inputOverlay(settings, stream);
	};
	stream.onremovetrack = async (event) => {
		const room = (globalThis as any).room as Room;

		for (const [peerId, peer] of Object.entries(room.peers)) {
			if (!peer.pc || BigInt(peerId) % 2n != 0n) continue;

			for (const transceiver of peer.pc.getTransceivers()) {
				if (transceiver.sender.track?.id == event.track.id) {
					transceiver.stop();
				}
			}
		}

		await inputOverlay(settings, stream);
	};
}

async function launchReceiver(credentials: RoomCredentials) {
	let mqttEndpoint = defaultMqttEndpoint;
	let iceServers: any;
	let codecOrderPreference: any;
	let jitterBufferTarget;

	if (params.has("mqttEndpoint")) {
		mqttEndpoint = params.get("mqttEndpoint") as string;
	}

	if (params.has("iceServers")) {
		iceServers = JSON.parse(params.get("iceServers") as string);

		if (!Array.isArray(iceServers)) {
			iceServers = defaultIceServers;
		}
	} else {
		iceServers = defaultIceServers;
	}

	jitterBufferTarget = Number(params.get("jitterBufferTarget"));
	if (
		!(
			params.has("jitterBufferTarget") &&
			Number.isFinite(jitterBufferTarget)
		)
	) {
		jitterBufferTarget = undefined;
	}

	if (params.has("codecPreferences")) {
		codecOrderPreference = JSON.parse(
			params.get("codecPreferences") as string
		);

		if (!Array.isArray(codecOrderPreference)) {
			codecOrderPreference = undefined;
		}
	} else {
		codecOrderPreference = undefined;
	}

	const peerVideos: Record<string, HTMLVideoElement> = {};
	const videoContainer = document.createElement("div");
	videoContainer.classList.add("gallery");
	document.body.appendChild(videoContainer);

	const overlay = document.createElement("div");
	overlay.classList.add("stats-overlay");
	document.body.appendChild(overlay);

	overlay.ondblclick = async () => {
		if (document.fullscreenElement) {
			await document.exitFullscreen();
		} else {
			await document.body.requestFullscreen();
		}
	};

	(globalThis as any).room = new Room(
		mqttEndpoint,
		credentials,
		{
			iceCandidatePoolSize: 10,
			iceServers,
		},
		(peerId, peer) => {
			if (!peer.pc) return;

			peer.pc.ontrack = (event) => {
				if (codecOrderPreference) {
					setCodecPreferences(
						event.transceiver,
						codecOrderPreference
					);
				}
				setReceiverSettings(event.receiver, jitterBufferTarget);

				let video = peerVideos[peerId];

				if (!video) {
					video = document.createElement("video");
					video.autoplay = true;
					if (params.get("hideControls") === "true") {
						video.controls = false;
					} else {
						video.controls = true;
					}
					video.playsInline = true;
					video.id = peerId;
					video.title = peerId;

					videoContainer.appendChild(video);
					updateGalleryStyles(videoContainer);
				}

				peerVideos[peerId] = video;

				const stream = event.streams[0];

				if (stream) {
					video.srcObject = stream;
					stream.onremovetrack = () => {
						let video = peerVideos[peerId];
						if (
							video &&
							(video.srcObject as MediaStream).getTracks()
								.length == 0
						) {
							video.srcObject = null;
							videoContainer.removeChild(video);
							delete peerVideos[peerId];
							updateGalleryStyles(videoContainer);
						}
					};
				}
			};
		},
		(peerId, peer) => {
			if (!peer.pc) return;

			peer.pc.ontrack = null;

			let video = peerVideos[peerId];
			if (video) {
				if (video.srcObject) {
					(video.srcObject as MediaStream).onremovetrack = null;
					(video.srcObject as MediaStream)
						.getTracks()
						.forEach((track) => track.stop());
				}
				video.srcObject = null;
				videoContainer.removeChild(video);
				delete peerVideos[peerId];
				updateGalleryStyles(videoContainer);
			}
		},
		async (peers) => {
			if (params.get("stats") === "true") {
				await statsOverlay(overlay, peers);
			}
		}
	);

	const resizeObserver = new ResizeObserver((entries) => {
		requestAnimationFrame(() => {
			for (const entry of entries) {
				updateGalleryStyles(entry.target as HTMLElement);
			}
		});
	});

	resizeObserver.observe(videoContainer);
}

function updateGalleryStyles(container: HTMLElement) {
	if (container.childElementCount <= 1) {
		container.style.gridTemplateColumns = "1fr";
		container.style.gridTemplateRows = "1fr";
	} else {
		if (container.childElementCount == 2) {
			if (container.clientWidth > container.clientHeight) {
				container.style.gridTemplateColumns = "repeat(2, 1fr)";
				container.style.gridTemplateRows = "1fr";
			} else {
				container.style.gridTemplateColumns = "1fr";
				container.style.gridTemplateRows = "repeat(2, 1fr)";
			}
		} else if (container.childElementCount <= 4) {
			container.style.gridTemplateColumns = "repeat(2, 1fr)";
			container.style.gridTemplateRows = "repeat(2, 1fr)";
		} else if (container.childElementCount <= 6) {
			if (container.clientWidth > container.clientHeight) {
				container.style.gridTemplateColumns = "repeat(3, 1fr)";
				container.style.gridTemplateRows = "repeat(2, 1fr)";
			} else {
				container.style.gridTemplateColumns = "repeat(2, 1fr)";
				container.style.gridTemplateRows = "repeat(3, 1fr)";
			}
		} else if (container.childElementCount <= 9) {
			container.style.gridTemplateColumns = "repeat(3, 1fr)";
			container.style.gridTemplateRows = "repeat(3, 1fr)";
		} else if (container.childElementCount <= 12) {
			if (container.clientWidth > container.clientHeight) {
				container.style.gridTemplateColumns = "repeat(4, 1fr)";
				container.style.gridTemplateRows = "repeat(3, 1fr)";
			} else {
				container.style.gridTemplateColumns = "repeat(3, 1fr)";
				container.style.gridTemplateRows = "repeat(4, 1fr)";
			}
		} else if (container.childElementCount <= 16) {
			container.style.gridTemplateColumns = "repeat(4, 1fr)";
			container.style.gridTemplateRows = "repeat(4, 1fr)";
		} else if (container.childElementCount <= 20) {
			if (container.clientWidth > container.clientHeight) {
				container.style.gridTemplateColumns = "repeat(5, 1fr)";
				container.style.gridTemplateRows = "repeat(4, 1fr)";
			} else {
				container.style.gridTemplateColumns = "repeat(4, 1fr)";
				container.style.gridTemplateRows = "repeat(5, 1fr)";
			}
		} else {
			container.style.gridTemplateColumns = "repeat(5, 1fr)";
			container.style.gridTemplateRows = "repeat(5, 1fr)";
		}
	}
}

async function inputOverlay(overlay: HTMLDivElement, stream: MediaStream) {
	const fragment = new DocumentFragment();

	const tracks = stream.getTracks();
	tracks.sort((a, b) => (b.kind > a.kind ? 1 : a.kind > b.kind ? -1 : 0));
	for (const track of tracks) {
		fragment.appendChild(await createTrackUI(track, stream));
	}
	overlay.replaceChildren(fragment);
}

async function createTrackUI(track: MediaStreamTrack, stream: MediaStream) {
	const trackUi = document.createElement("div");

	const trackSettings = track.getSettings();
	//const trackConstraints = track.getConstraints();

	const trackSelect = document.createElement("select");
	const devices = await navigator.mediaDevices.enumerateDevices();
	devices.sort((a, b) =>
		a.groupId > b.groupId ? 1 : b.groupId > a.groupId ? -1 : 0
	);
	for (const device of devices) {
		if (
			(device.kind == "audioinput" && track.kind == "audio") ||
			(device.kind == "videoinput" && track.kind == "video")
		) {
			const deviceOption = document.createElement("option");
			deviceOption.value = device.deviceId;
			deviceOption.selected = trackSettings.deviceId === device.deviceId;
			deviceOption.innerText = device.label;
			trackSelect.append(deviceOption);
		}
	}
	trackSelect.addEventListener("change", async (event) => {
		const trackConstraints = track.getConstraints();
		trackConstraints.deviceId = {
			exact: (event.target as HTMLSelectElement).value,
		};
		let constraints: MediaStreamConstraints = {};
		if (track.kind == "video") {
			constraints = {
				video: trackConstraints,
				audio: false,
			};
			constraints.video;
		} else if (track.kind == "audio") {
			constraints = {
				video: false,
				audio: trackConstraints,
			};
		} else {
			return;
		}

		const temporaryStream = await navigator.mediaDevices.getUserMedia(
			constraints
		);
		const newTrack = temporaryStream.getTracks()[0];
		if (newTrack) {
			track.stop();
			stream.removeTrack(track);
			stream.dispatchEvent(
				new MediaStreamTrackEvent("removetrack", { track })
			); // ugly hack... but it works
			stream.addTrack(newTrack);
			stream.dispatchEvent(
				new MediaStreamTrackEvent("addtrack", { track: newTrack })
			); // ugly hack... but it works
			trackUi.remove();
		}
	});
	trackUi.appendChild(trackSelect);

	const enableCheckbox = document.createElement("input");
	enableCheckbox.type = "checkbox";
	enableCheckbox.checked = track.enabled;
	enableCheckbox.addEventListener("change", (event) => {
		track.enabled = (event.target as HTMLInputElement).checked;
	});
	trackUi.appendChild(enableCheckbox);
	trackUi.appendChild(document.createElement("br"));

	return trackUi;
}

async function statsOverlay(
	overlay: HTMLDivElement,
	peers: Record<string, Peer>
) {
	const peerList = document.createElement("ul");

	if (!((globalThis as any).room as Room).room.client.connected) {
		const entry = document.createElement("li");
		entry.innerText = "Disconnected from signaling server";

		peerList.appendChild(entry);
	}

	for (const [peerId, peer] of Object.entries(peers)) {
		if (peer.pc?.connectionState === "new") {
			continue;
		}

		const peerEntry = document.createElement("li");

		const peerStats = await peer.pc?.getStats();

		let targetVideoBitrate: number | undefined;
		let targetAudioBitrate: number | undefined;
		let cpuLimited = false;
		let jitterBufferDelay: number | undefined;
		let maxPlayoutTimestamp: number | undefined;
		let minPlayoutTimestamp: number | undefined;

		let incomingBandwidth: number | undefined;
		let outgoingBandwidth: number | undefined;
		let roundTripTime: number | undefined;
		let jitter: number | undefined;
		let lossFraction: number | undefined;

		peerStats?.forEach((report) => {
			const lastReport = peer.metadata[report.type + "_" + report.id];

			if (report.type === "outbound-rtp") {
				if (report.kind === "video" && report.targetBitrate) {
					targetVideoBitrate =
						report.targetBitrate +
						(targetVideoBitrate ? targetVideoBitrate : 0);
				}
				if (report.kind === "audio" && report.targetBitrate) {
					targetAudioBitrate =
						report.targetBitrate +
						(targetAudioBitrate ? targetAudioBitrate : 0);
				}
				if (report.qualityLimitationReason === "cpu") {
					cpuLimited = true;
				}
			}

			if (report.type === "inbound-rtp") {
				if (
					lastReport?.jitterBufferDelay &&
					lastReport?.jitterBufferEmittedCount
				) {
					jitterBufferDelay = Math.max(
						(report.jitterBufferDelay -
							lastReport.jitterBufferDelay) /
							(report.jitterBufferEmittedCount -
								lastReport.jitterBufferEmittedCount),
						jitterBufferDelay ? jitterBufferDelay : -Infinity
					);
				}
				if (
					lastReport?.packetsLost !== undefined &&
					lastReport?.packetsReceived !== undefined
				) {
					lossFraction = Math.max(
						(report.packetsLost - lastReport.packetsLost) /
							(report.packetsLost +
								report.packetsReceived -
								(lastReport.packetsLost +
									lastReport.packetsReceived)),
						lossFraction ? lossFraction : -Infinity
					);
				} else if (report.fractionLost !== undefined) {
					lossFraction = Math.max(
						report.fractionLost,
						lossFraction ? lossFraction : -Infinity
					);
				}
				if (report.jitter) {
					jitter = Math.max(
						report.jitter,
						jitter ? jitter : -Infinity
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
					roundTripTime = Math.max(
						(report.totalRoundTripTime -
							lastReport.totalRoundTripTime) /
							(report.roundTripTimeMeasurements -
								lastReport.roundTripTimeMeasurements),
						roundTripTime ? roundTripTime : -Infinity
					);
				} else if (report.roundTripTime) {
					roundTripTime = Math.max(
						report.roundTripTime,
						roundTripTime ? roundTripTime : -Infinity
					);
				}
				if (
					lastReport?.packetsLost !== undefined &&
					lastReport?.packetsReceived !== undefined
				) {
					lossFraction = Math.max(
						(report.packetsLost - lastReport.packetsLost) /
							(report.packetsLost +
								report.packetsReceived -
								(lastReport.packetsLost +
									lastReport.packetsReceived)),
						lossFraction ? lossFraction : -Infinity
					);
				} else if (report.fractionLost !== undefined) {
					lossFraction = Math.max(
						report.fractionLost,
						lossFraction ? lossFraction : -Infinity
					);
				}
				if (report.jitter) {
					jitter = Math.max(
						report.jitter,
						jitter ? jitter : -Infinity
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

					outgoingBandwidth =
						(report.bytesSent - lastReport.bytesSent) / sinceLast +
						(outgoingBandwidth ? outgoingBandwidth : 0);
					incomingBandwidth =
						(report.bytesReceived - lastReport.bytesReceived) /
							sinceLast +
						(incomingBandwidth ? incomingBandwidth : 0);
				}
			}

			peer.metadata[report.type + "_" + report.id] = report;
		});

		if (targetVideoBitrate) {
			targetVideoBitrate = Math.round(targetVideoBitrate / 1000);
		}

		if (targetAudioBitrate) {
			targetAudioBitrate = Math.round(targetAudioBitrate / 1000);
		}

		if (jitterBufferDelay) {
			jitterBufferDelay = Math.round(jitterBufferDelay * 1000);
		}

		let desync: number | undefined;
		if (maxPlayoutTimestamp && minPlayoutTimestamp) {
			desync = Math.round(maxPlayoutTimestamp - minPlayoutTimestamp);
		}

		if (incomingBandwidth) {
			incomingBandwidth = Math.round(incomingBandwidth * 8);
		}

		if (outgoingBandwidth) {
			outgoingBandwidth = Math.round(outgoingBandwidth * 8);
		}

		if (roundTripTime) {
			roundTripTime = Math.round(roundTripTime * 1000);
		}

		if (jitter) {
			jitter = Math.round(jitter * 1000);
		}

		if (lossFraction !== undefined) {
			lossFraction = Math.round(lossFraction * 1000) / 10;
		}

		let label = `${peerId} (${peer.pc?.connectionState})`;

		if (targetAudioBitrate && targetVideoBitrate) {
			label =
				label +
				`\nA: ${targetAudioBitrate} kbit/s V: ${targetVideoBitrate} kbit/s`;
		} else if (targetAudioBitrate) {
			label = label + `\nA: ${targetAudioBitrate} kbit/s`;
		} else if (targetVideoBitrate) {
			label = label + `\nV: ${targetVideoBitrate} kbit/s`;
		}

		if ((targetAudioBitrate || targetVideoBitrate) && cpuLimited) {
			label = label + " (CPU limited)";
		}

		if (jitterBufferDelay) {
			label = label + `\nBuffer: ${jitterBufferDelay} ms`;

			if (desync) {
				label = label + ` Desync: ${desync} ms`;
			}
		}

		if (outgoingBandwidth && incomingBandwidth) {
			label =
				label +
				`\nD: ${incomingBandwidth} kbit/s U: ${outgoingBandwidth} kbit/s`;

			if (roundTripTime) {
				label = label + ` RTT: ${roundTripTime} ms`;
			}

			if (jitter) {
				label = label + ` PDV: ${jitter} ms`;
			}

			if (lossFraction !== undefined) {
				label = label + ` Loss: ${lossFraction}%`;
			}
		}

		peerEntry.innerText = label;

		peerList.appendChild(peerEntry);
	}

	if (peerList.childElementCount != 0) {
		overlay.replaceChildren(peerList);
	}
}
