import bs58 from "bs58";
import {
	joinRoom,
	selfId,
	type MqttRoomConfig,
} from "./packages/trystero-mqtt/src";
import type { Room } from "./packages/trystero-core/src";
import type {
	ReceiverMediaConfig,
	SenderMediaConfig,
} from "./packages/trystero-core/src/types";

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

	if (role && id) {
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
		'<h1>psychosis.live</h1><p>This service allows you to stream <em>end-to-end encrypted</em> video from your smartphone into OBS over practically any internet connection, allowing you to stream anything from anywhere with an internet connection.</p><p>Unlike similar services, such as <a href="https://vdo.ninja">VDO.Ninja</a>, psychosis.live focuses on <em>both</em> ensuring watchability over poor connections and delivering the highest quality possible over good connections.</p><p>It is highly recommended (but not required) that you use Google Chrome on both sides of the connection for the best possible experience, as WebRTC implementation quality can vary significantly between browsers.</p>';

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
		"<p>Requires a fairly powerful device due to use of newer video codecs, especially if using high resolutions and frame rates.</p><p>Supports up to 25 simultaneous senders. However, it is recommended that you stick to &lt;= 4 simultaneous senders to avoid overloading your receiver.</p>"
	);

	document.body.appendChild(receiverLabel);
	document.body.appendChild(receiverText);

	document.body.insertAdjacentHTML(
		"beforeend",
		'<p>Although this app will not <em>stop you from</em> having multiple receivers, it is a <b>very bad idea</b> to have more than one active receiver in a room, as senders send video data directly to every receiver.</p><details><summary>URL parameters (advanced)</summary><p>Sender & Receiver:</p><ul><li><code>role</code> = Role (<code>sender</code> or <code>receiver</code>)</li><li><code>id</code> = Room ID</li><li>Fragment (text after <code>#</code>) = Room Password (required for E2E encryption)</li></ul><p>All of the below parameters are optional.</p><p>Sender & Receiver:</p><ul><li><code>codecPreferences</code> = <a href="https://blog.mozilla.org/webrtc/cross-browser-support-for-choosing-webrtc-codecs/">Preferred WebRTC Codec Ordering</a> (JSON-encoded list of MIME types); It is highly recommended that you use the same list on both ends to avoid connection establishment issues</li></ul><p>Sender Only:</p><ul><li><code>showAudio</code> = Enable audio (boolean)</li><li><code>showVideo</code> = Enable video (boolean)</li><li><code>channelCount</code> = Preferred audio channel count (integer)</li><li><code>width</code> = Preferred video width (pixels)</li><li><code>height</code> = Preferred video height (pixels)</li><li><code>frameRate</code> = Preferred video frame rate (frames/second)</li><li><code>aspectRatio</code> = Preferred video aspect ratio (number, rounded to 10 decimal places)</li><li><code></code> = </li><li><code>displayMedia</code> = Use <a href="https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia">getDisplayMedia</a> instead of <a href="https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia">getUserMedia</a> when creating a MediaStream (boolean)</li><li><code>autoGainControl</code> = <a href="https://w3c.github.io/mediacapture-main/#def-constraint-autoGainControl">Audio MediaTrackConstraints Automatic Gain Control</a> (boolean)</li><li><code>echoCancellation</code> = <a href="https://w3c.github.io/mediacapture-main/#def-constraint-echoCancellation">Audio MediaTrackConstraints Echo Cancellation</a> (limited to boolean)</li><li><code>noiseSuppression</code> = <a href="https://w3c.github.io/mediacapture-main/#def-constraint-noiseSuppression">Audio MediaTrackConstraints Noise Suppression</a> (boolean)</li><li><code>backgroundBlur</code> = <a href="https://w3c.github.io/mediacapture-main/#def-constraint-backgroundBlur">Video MediaTrackConstraints Background Blur</a> (boolean)</li><li><code>audioContentHint</code> = <a href="https://w3c.github.io/mst-content-hint/#audio-content-hints">MediaStreamTrack Audio Content Hint</a></li><li><code>videoContentHint</code> = <a href="https://w3c.github.io/mst-content-hint/#video-content-hints">MediaStreamTrack Video Content Hint</a></li><li><code>maxAudioBitrate</code> = <a href="https://w3c.github.io/webrtc-pc/#dom-rtcrtpencodingparameters-maxbitrate">WebRTC Maximum Audio Bitrate</a> (kilobits/second)</li><li><code>dynamicAudioBitrate</code> = Uses JavaScript to dynamically adjust the maximum audio bitrate between 64 kbit/s and <code>maxAudioBitrate</code> based on video bitrate (boolean); Always disabled if <code>displayMedia</code> = true</li><li><code>dynamicVideoFramerate</code> = Uses JavaScript to dynamically adjust the maximum video frame rate between 24 fps and <code>frameRate</code> based on video bitrate (boolean)</li><li><code>maxVideoBitrate</code> = <a href="https://w3c.github.io/webrtc-pc/#dom-rtcrtpencodingparameters-maxbitrate">WebRTC Maximum Video Bitrate</a> (kilobits/second)</li><li><code>degradationPreference</code> = <a href="https://w3c.github.io/mst-content-hint/#dictionary-rtcrtpsendparameters-new-members">WebRTC Video Degradation Preference</a> (<a href="https://w3c.github.io/mst-content-hint/#dom-rtcdegradationpreference">RTCDegradationPreference</a>)</li><li><code>networkPriority</code> = <a href="https://www.w3.org/TR/webrtc-priority/#dom-rtcrtpencodingparameters-networkpriority">WebRTC Network QoS Priority</a> (<a href="https://www.w3.org/TR/webrtc-priority/#rtc-priority-type">RTCPriorityType</a>)</li></ul><p>Receiver Only:</p><ul><li><code>jitterBufferTarget</code> = <a href="https://w3c.github.io/webrtc-pc/#dom-rtcrtpreceiver-jitterbuffertarget">WebRTC Jitter Buffer Target</a> (miliseconds)</li></ul></details>'
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
		url.searchParams.set("audioContentHint", "music");
		url.searchParams.set("videoContentHint", "motion");
		url.searchParams.set("maxAudioBitrate", 192);
		url.searchParams.set("dynamicAudioBitrate", "true");
		url.searchParams.set("dynamicVideoFramerate", "true");
		url.searchParams.set("maxVideoBitrate", 15 * 1000);
		url.searchParams.set("networkPriority", "medium");
	}
	if (role == Role.Receiver) {
		// TODO: Add setting to hide video controls on receiver
		url.searchParams.set("jitterBufferTarget", 1500);
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
	password: string | undefined,
	params: URLSearchParams
) {
	document.body.id = "app";

	window.addEventListener("error", (e) => {
		console.error(e.message);
	});

	let senderMediaConfig: SenderMediaConfig = {
		videoPriority: "medium",
		audioPriority: "high",
	};
	let receiverMediaConfig: ReceiverMediaConfig = {};

	if (params.has("codecPreferences")) {
		let codecOrderPreference = JSON.parse(
			params.get("codecPreferences") as string
		);

		if (Array.isArray(codecOrderPreference)) {
			receiverMediaConfig.codecOrderPreference = codecOrderPreference;
		}
	}

	const networkPriority = params.get("networkPriority");
	if (networkPriority) {
		senderMediaConfig.networkPriority = networkPriority as RTCPriorityType;
	}

	const degradationPreference = params.get("degradationPreference");
	if (degradationPreference) {
		senderMediaConfig.degradationPreference =
			degradationPreference as RTCDegradationPreference;
	}

	const maxVideoBitrate = Number(params.get("maxVideoBitrate"));
	if (params.has("maxVideoBitrate") && Number.isFinite(maxVideoBitrate)) {
		senderMediaConfig.maxVideoBitrate = maxVideoBitrate;
	}

	let audioBitrateCeil = undefined;

	const maxAudioBitrate = Number(params.get("maxAudioBitrate"));
	if (params.has("maxAudioBitrate") && Number.isFinite(maxAudioBitrate)) {
		senderMediaConfig.maxAudioBitrate = maxAudioBitrate;
		audioBitrateCeil = maxAudioBitrate * 1000;
	}

	let framerateCeil = undefined;

	const maxFramerate = Number(params.get("maxFramerate"));
	if (params.has("maxFramerate") && Number.isFinite(maxFramerate)) {
		senderMediaConfig.maxFramerate = maxFramerate;
		framerateCeil = maxFramerate;
	} else {
		const frameRate = Number(params.get("frameRate"));
		if (params.has("frameRate") && Number.isFinite(frameRate)) {
			senderMediaConfig.maxFramerate = frameRate;
			framerateCeil = frameRate;
		}
	}

	window.setInterval(async () => {
		for (const [peerId, peer] of Object.entries(room.getPeers())) {
			const stats = await peer.getStats();

			let audioBitrateLower = 0;
			let audioBitrateUpper = Infinity;
			let videoFramerateLower = 0;
			let videoFramerateUpper = Infinity;

			stats.forEach((report) => {
				if (
					report.type == "outbound-rtp" &&
					report.kind == "video" &&
					report.targetBitrate
				) {
					if (
						audioBitrateCeil &&
						params.get("dynamicAudioBitrate") === "true"
					) {
						audioBitrateLower = Math.min(
							Math.max(
								Math.floor(report.targetBitrate / 128000),
								2
							) * 32000,
							audioBitrateCeil
						);
						audioBitrateUpper = Math.min(
							Math.max(
								Math.ceil(report.targetBitrate / 128000),
								2
							) * 32000,
							audioBitrateCeil
						);
					}

					if (
						framerateCeil &&
						params.get("dynamicVideoFramerate") === "true" &&
						params.get("displayMedia") !== "true"
					) {
						if (report.targetBitrate >= 500000) {
							videoFramerateLower = Math.min(
								Math.max(
									Math.floor(report.targetBitrate / 500000),
									1
								) * 30,
								framerateCeil
							);
							videoFramerateUpper = Math.min(
								Math.max(
									Math.ceil(report.targetBitrate / 500000),
									1
								) * 30,
								framerateCeil
							);
						} else {
							videoFramerateLower = Math.min(
								Math.max(
									Math.floor(report.targetBitrate / 250000),
									1.6
								) * 15,
								framerateCeil
							);
							videoFramerateUpper = Math.min(
								Math.max(
									Math.ceil(report.targetBitrate / 250000),
									1.6
								) * 15,
								framerateCeil
							);
						}
					}
				}
			});

			for (const transceiver of peer.getTransceivers()) {
				if (transceiver.sender.track?.kind == "video") {
					let parameters = transceiver.sender.getParameters();

					let changed = false;

					for (const encoding of parameters.encodings) {
						if (encoding.maxFramerate) {
							if (
								videoFramerateLower != 0 &&
								videoFramerateUpper != Infinity
							) {
								if (
									encoding.maxFramerate >
										videoFramerateUpper &&
									encoding.maxFramerate != videoFramerateLower
								) {
									DEV: console.log(
										"set video maxFramerate",
										videoFramerateLower
									);
									encoding.maxFramerate = videoFramerateLower;
									changed = true;
								}

								if (
									encoding.maxFramerate <
										videoFramerateLower &&
									encoding.maxFramerate != videoFramerateUpper
								) {
									DEV: console.log(
										"set video maxFramerate",
										videoFramerateUpper
									);
									encoding.maxFramerate = videoFramerateUpper;
									changed = true;
								}
							}
						}
					}

					if (changed) {
						await transceiver.sender.setParameters(parameters);
					}
				}

				if (transceiver.sender.track?.kind == "audio") {
					let parameters = transceiver.sender.getParameters();

					let changed = false;

					for (const encoding of parameters.encodings) {
						if (encoding.maxBitrate) {
							if (
								audioBitrateLower != 0 &&
								audioBitrateUpper != Infinity
							) {
								if (
									encoding.maxBitrate > audioBitrateUpper &&
									encoding.maxBitrate != audioBitrateLower
								) {
									DEV: console.log(
										"set audio maxBitrate",
										audioBitrateLower / 1000
									);
									encoding.maxBitrate = audioBitrateLower;
									changed = true;
								}

								if (
									encoding.maxBitrate < audioBitrateLower &&
									encoding.maxBitrate != audioBitrateUpper
								) {
									DEV: console.log(
										"set audio maxBitrate",
										audioBitrateUpper / 1000
									);
									encoding.maxBitrate = audioBitrateUpper;
									changed = true;
								}
							}
						}
					}

					if (changed) {
						await transceiver.sender.setParameters(parameters);
					}
				}
			}
		}
	});

	const jitterBufferTarget = Number(params.get("jitterBufferTarget"));
	if (
		params.has("jitterBufferTarget") &&
		Number.isFinite(jitterBufferTarget)
	) {
		receiverMediaConfig.jitterBufferTarget = jitterBufferTarget;
	}

	let config: MqttRoomConfig = {
		appId: "psychosis.live",
		trickleIce: false, // Enabling causes reconnection after network loss to fail
		rtcConfig: {
			iceTransportPolicy: "all",
			iceCandidatePoolSize: 10,
			bundlePolicy: "max-bundle",
			iceServers: [
				{ urls: "stun:stun.l.google.com:19302" },
				{ urls: "stun:stun1.l.google.com:19302" },
				{ urls: "stun:stun2.l.google.com:19302" },
				{ urls: "stun:stun3.l.google.com:19302" },
				{ urls: "stun:stun4.l.google.com:19302" },
				{ urls: "stun:stun.cloudflare.com:3478" },
			],
		},
		turnConfig: [],
		mediaConfig: {
			sender: senderMediaConfig,
			receiver: receiverMediaConfig,
		},
	};
	if (password) {
		config.password = password;
	}

	console.log(`role = ${role}, peer ID = ${selfId}`);

	const room = joinRoom(config, roomId, {
		onPeerHandshake: async (peerId, send, receive, isInitiator) => {
			console.log(`handshaked with ${peerId}`);
		},
		onJoinError: (details) => {
			console.error(details);
		},
	});

	/*window.setInterval(async () => {
		for (const [peerId, peer] of Object.entries(room.getPeers())) {
			const stats = await peer.getStats();

			stats.forEach((report) => {
				if (
					report.type == "outbound-rtp" &&
					report.kind == "video" &&
					report.targetBitrate // in bits
				) {
					console.log(report);
				}
			});
		}
	}, 2000);*/

	if (role == Role.Sender) {
		await launchSender(room);
	}

	if (role == Role.Receiver) {
		await launchReceiver(room);
	}
}

async function launchSender(room: Room) {
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

	let stream;

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

	room.addStream(stream);
	room.onPeerJoin((peerId) => {
		console.log(`${peerId} joined`);
		room.addStream(stream, peerId);
	});
	room.onPeerStream((stream, peerId) => {
		console.log(`${peerId} started streaming`);
	});
	room.onPeerLeave((peerId) => {
		console.log(`${peerId} left`);
	});

	// @ts-ignore
	globalThis.room = room;
}

async function launchReceiver(room: Room) {
	const peerVideos: Record<string, HTMLVideoElement> = {};
	const videoContainer = document.createElement("div");
	videoContainer.classList.add("gallery");
	document.body.appendChild(videoContainer);

	room.onPeerJoin((peerId) => {
		console.log(`${peerId} joined`);
	});
	room.onPeerStream((stream, peerId) => {
		console.log(`${peerId} started streaming`);

		let video = peerVideos[peerId];

		if (!video) {
			video = document.createElement("video");
			video.autoplay = true;
			video.controls = true;
			video.playsInline = true;

			videoContainer.appendChild(video);
			updateGalleryStyles(videoContainer);
		}

		video.srcObject = stream;
		video.id = peerId;
		DEV: video.title = peerId;
		peerVideos[peerId] = video;
	});
	room.onPeerLeave((peerId) => {
		console.log(`${peerId} left`);
		let video = peerVideos[peerId];

		if (video) {
			video.srcObject = null;
			videoContainer.removeChild(video);
			delete peerVideos[peerId];
			updateGalleryStyles(videoContainer);
		}
	});

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
