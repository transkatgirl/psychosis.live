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
		'<h1>psychosis.live</h1><p>This service allows you to stream <em>end-to-end encrypted</em> video from your smartphone into OBS over practically any internet connection, allowing you to stream anything from anywhere with an internet connection.</p><p>Unlike similar services, such as <a href="https://vdo.ninja">VDO.Ninja</a>, psychosis.live focuses on <em>both</em> ensuring watchability over poor connections and delivering the highest quality possible over good connections.</p><p>It is highly recommended (but not required) that you use Google Chrome on both sides of the connection for the best possible experience, as WebRTC implementations can vary significantly between browsers.</p>';

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
		'<p>Although this app will not <em>stop you from</em> having multiple receivers, it is a <b>very bad idea</b> to have more than one active receiver in a room, as senders send video data directly to every receiver.</p><details><summary>URL parameters (advanced)</summary><p>Sender & Receiver:</p><ul><li><code>role</code> = Role (<code>sender</code> or <code>receiver</code>)</li><li><code>id</code> = Room ID</li><li>Fragment (text after <code>#</code>) = Room Password (required for E2E encryption)</li></ul><p>All of the below parameters are optional.</p><p>Sender & Receiver:</p><ul><li><code>stats</code> = Enable connection statistics overlay (boolean); Requires using Chrome or Safari</li><li><code>mqttEndpoint</code> = <a href="https://github.com/mqttjs/MQTT.js#mqttconnecturl-options">MQTT WebSocket endpoint URL</a> (string); Used for WebRTC signaling</li><li><code>iceServers</code> = <a href="https://w3c.github.io/webrtc-pc/#dom-rtcconfiguration-iceservers">WebRTC ICE Servers</a> (JSON-encoded list of <a href="https://w3c.github.io/webrtc-pc/#dom-rtciceserver">RTCIceServer</a> objects)</li><li><code>codecPreferences</code> = <a href="https://blog.mozilla.org/webrtc/cross-browser-support-for-choosing-webrtc-codecs/">Preferred WebRTC Codec Ordering</a> (JSON-encoded list of MIME types)</li><li>It is highly recommended that you use the same WebRTC settings on both ends to avoid connection establishment issues</li></ul><p>Sender Only:</p><ul><li><code>showAudio</code> = Enable audio (boolean)</li><li><code>showVideo</code> = Enable video (boolean)</li><li><code>channelCount</code> = Preferred audio channel count (integer)</li><li><code>width</code> = Preferred video width (pixels)</li><li><code>height</code> = Preferred video height (pixels)</li><li><code>frameRate</code> = Preferred video frame rate (frames/second)</li><li><code>aspectRatio</code> = Preferred video aspect ratio (number, rounded to 10 decimal places)</li><li><code></code> = </li><li><code>displayMedia</code> = Use <a href="https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia">getDisplayMedia</a> instead of <a href="https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia">getUserMedia</a> when creating a MediaStream (boolean)</li><li><code>autoGainControl</code> = <a href="https://w3c.github.io/mediacapture-main/#def-constraint-autoGainControl">Audio MediaTrackConstraints Automatic Gain Control</a> (boolean)</li><li><code>echoCancellation</code> = <a href="https://w3c.github.io/mediacapture-main/#def-constraint-echoCancellation">Audio MediaTrackConstraints Echo Cancellation</a> (limited to boolean)</li><li><code>noiseSuppression</code> = <a href="https://w3c.github.io/mediacapture-main/#def-constraint-noiseSuppression">Audio MediaTrackConstraints Noise Suppression</a> (boolean)</li><li><code>backgroundBlur</code> = <a href="https://w3c.github.io/mediacapture-main/#def-constraint-backgroundBlur">Video MediaTrackConstraints Background Blur</a> (boolean)</li><li><code>audioContentHint</code> = <a href="https://w3c.github.io/mst-content-hint/#audio-content-hints">MediaStreamTrack Audio Content Hint</a></li><li><code>videoContentHint</code> = <a href="https://w3c.github.io/mst-content-hint/#video-content-hints">MediaStreamTrack Video Content Hint</a></li><li><code>maxAudioBitrate</code> = <a href="https://w3c.github.io/webrtc-pc/#dom-rtcrtpencodingparameters-maxbitrate">WebRTC Maximum Audio Bitrate</a> (kilobits/second)</li><li><code>dynamicAudioBitrate</code> = Uses JavaScript to dynamically adjust the maximum audio bitrate between 48 kbit/s and <code>maxAudioBitrate</code> based on video bitrate (boolean); Always disabled if <code>displayMedia</code> = true</li><li><code>dynamicVideoFramerate</code> = Uses JavaScript to dynamically adjust the maximum video frame rate between 24 fps and <code>frameRate</code> based on video bitrate (boolean); Always disabled if <code>displayMedia</code> = true</li><li><code>maxVideoBitrate</code> = <a href="https://w3c.github.io/webrtc-pc/#dom-rtcrtpencodingparameters-maxbitrate">WebRTC Maximum Video Bitrate</a> (kilobits/second)</li><li><code>degradationPreference</code> = <a href="https://w3c.github.io/mst-content-hint/#dictionary-rtcrtpsendparameters-new-members">WebRTC Video Degradation Preference</a> (<a href="https://w3c.github.io/mst-content-hint/#dom-rtcdegradationpreference">RTCDegradationPreference</a>)</li></ul><p>Receiver Only:</p><ul><li><code>hideControls</code> = Disable video controls (boolean)</li><li><code>jitterBufferTarget</code> = <a href="https://w3c.github.io/webrtc-pc/#dom-rtcrtpreceiver-jitterbuffertarget">WebRTC Jitter Buffer Target</a> (miliseconds)</li></ul></details><p>Made by <a href="https://x.com/transkatgirl">transkatgirl</a>.</p>'
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
		url.searchParams.set("width", 1920);
		url.searchParams.set("height", 1080);
		url.searchParams.set("frameRate", 60);
		url.searchParams.set("autoGainControl", "true");
		url.searchParams.set("audioContentHint", "music"); // disables most audio processing
		url.searchParams.set("videoContentHint", "motion");
		url.searchParams.set("maxAudioBitrate", 192); // chosen based on https://wiki.hydrogenaudio.org/index.php?title=Opus#Music_encoding_quality
		url.searchParams.set("dynamicAudioBitrate", "true");
		url.searchParams.set("dynamicVideoFramerate", "true");
		url.searchParams.set("maxVideoBitrate", 15 * 1000);
	}
	if (role == Role.Receiver) {
		url.searchParams.set("jitterBufferTarget", 1300); // chosen based on https://ieeexplore.ieee.org/document/6962149
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

					let transceiver = peer.pc.addTransceiver(track, {
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
					setSenderSettings(
						transceiver.sender,
						degradationPreference
					);
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

async function statsOverlay(
	overlay: HTMLDivElement,
	peers: Record<string, Peer>
) {
	overlay.innerHTML = "";

	const peerList = document.createElement("ul");

	for (const [peerId, peer] of Object.entries(peers)) {
		if (peer.pc?.connectionState === "new") {
			continue;
		}

		const peerEntry = document.createElement("div");

		const peerStats = await peer.pc?.getStats();

		let targetVideoBitrate;
		let targetAudioBitrate;
		let jitterBufferDelay: number | undefined;

		let outgoingBandwidth;
		let incomingBandwidth;
		let roundTripTime: number | undefined;
		let lossFraction;

		console.log("");

		peerStats?.forEach((report) => {
			console.log(report);

			if (report.type === "outbound-rtp" && report.kind === "video") {
				targetVideoBitrate = Math.round(report.targetBitrate / 1000);
			}

			if (report.type === "outbound-rtp" && report.kind === "audio") {
				targetAudioBitrate = Math.round(report.targetBitrate / 1000);
			}

			if (report.type === "inbound-rtp" && !jitterBufferDelay) {
				if (peer.metadata.lastInboundTimestamp) {
					jitterBufferDelay = Math.round(
						((report.jitterBufferDelay -
							peer.metadata.lastJitterBufferDelay) /
							(report.jitterBufferEmittedCount -
								peer.metadata.lastJitterBufferEmitted)) *
							1000
					);
				}

				peer.metadata.lastJitterBufferDelay = report.jitterBufferDelay;
				peer.metadata.lastJitterBufferEmitted =
					report.jitterBufferEmittedCount;
				peer.metadata.lastInboundTimestamp = report.timestamp;
			}

			if (report.type === "transport") {
				if (peer.metadata.lastTransportTimestamp) {
					const sinceLast =
						report.timestamp - peer.metadata.lastTransportTimestamp;

					outgoingBandwidth = Math.round(
						((report.bytesSent - peer.metadata.lastBytesSent) * 8) /
							sinceLast
					);
					incomingBandwidth = Math.round(
						((report.bytesReceived -
							peer.metadata.lastBytesReceived) *
							8) /
							sinceLast
					);
				}

				peer.metadata.lastBytesSent = report.bytesSent;
				peer.metadata.lastBytesReceived = report.bytesReceived;
				peer.metadata.lastTransportTimestamp = report.timestamp;
			}

			if (
				(report.type === "remote-inbound-rtp" ||
					report.type === "remote-outbound-rtp") &&
				(report.kind === "video" || !roundTripTime)
			) {
				if (peer.metadata.lastRTTMeasurements) {
					roundTripTime = Math.round(
						((report.totalRoundTripTime -
							peer.metadata.lastTotalRTT) /
							(report.roundTripTimeMeasurements -
								peer.metadata.lastRTTMeasurements)) *
							1000
					);
				}
				if (report.fractionLost !== undefined) {
					lossFraction = Math.round(report.fractionLost * 1000) / 10;
				}

				peer.metadata.lastTotalRTT = report.totalRoundTripTime;
				peer.metadata.lastRTTMeasurements =
					report.roundTripTimeMeasurements;
			}
		});

		let label;

		label = `${peerId} (${peer.pc?.connectionState})`;

		if (targetAudioBitrate || targetVideoBitrate) {
			label =
				label +
				`\nA: ${targetAudioBitrate} kbit/s V: ${targetVideoBitrate} kbit/s`;
		}

		if (jitterBufferDelay) {
			label = label + `\nBuffer: ${jitterBufferDelay} ms`;
		}

		if (outgoingBandwidth || incomingBandwidth) {
			label =
				label +
				`\nD: ${incomingBandwidth} kbit/s U: ${outgoingBandwidth} kbit/s`;

			if (roundTripTime) {
				label = label + ` RTT: ${roundTripTime} ms`;
			}

			if (lossFraction !== undefined) {
				label = label + ` Loss: ${lossFraction}%`;
			}
		}

		peerEntry.innerText = label;

		peerList.appendChild(peerEntry);
	}

	overlay.appendChild(peerList);
}
