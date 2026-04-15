import bs58 from "bs58";
import {
	createRoomCredentials,
	Peer,
	Room,
	type RoomCredentials,
} from "./room/webrtc";
import { generateRandomString, selfId, setSelfId } from "./room/core";
import {
	adaptiveSettings,
	buildSenderEncoding,
	calculateReasonableAudioBitrateKbps,
	calculateReasonableMinimumAudioBitrateKbps,
	calculateReasonableVideoBitrateKbps,
	mungeSDP,
	mungeSDPOfferAnswer,
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
		'<h1>psychosis.live</h1><p>This tool allows you to stream <em>end-to-end encrypted</em> video from your browser into OBS over practically any internet connection, allowing you to stream anything from almost anywhere.</p><p>Unlike similar tools, such as <a href="https://vdo.ninja">VDO.Ninja</a>, psychosis.live focuses on <em>both</em> preserving watchability over poor connections and delivering the highest quality possible over good connections.</p><p>It is strongly recommended that you <b>use Google Chrome on both sides of the connection</b> for the best possible experience, as WebRTC implementations vary significantly between browsers.</p>';

	const roomLabel = document.createElement("label");
	roomLabel.htmlFor = "room";
	roomLabel.innerText = "Room ID: ";
	const roomInput = document.createElement("input");
	roomInput.id = "room";
	roomInput.type = "text";
	roomInput.required = true;
	roomInput.size = 16;
	roomInput.value = generateRandomString(8);

	const passwordLabel = document.createElement("label");
	passwordLabel.htmlFor = "pass";
	passwordLabel.innerText = "Room Password: ";
	const passwordInput = document.createElement("input");
	passwordInput.id = "pass";
	passwordInput.type = "text";
	passwordInput.required = true;
	passwordInput.size = 32;
	passwordInput.value = generateRandomString(16);

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
	senderLabel.innerText = "Sender: ";
	senderLabel.htmlFor = "sender";
	const senderText = document.createElement("pre");
	senderText.id = "sender";
	senderText.style.backgroundColor = "lightcoral";
	const senderLink = document.createElement("a");
	senderLink.target = "_blank";
	senderLink.style.color = "inherit";
	senderLink.appendChild(senderText);

	const receiverLabel = document.createElement("label");
	receiverLabel.innerText = "Receiver (OBS Browser source): ";
	receiverLabel.htmlFor = "receiver";
	const receiverText = document.createElement("pre");
	receiverText.id = "receiver";
	receiverText.style.backgroundColor = "lightseagreen";
	const receiverLink = document.createElement("a");
	receiverLink.target = "_blank";
	receiverLink.style.color = "inherit";
	receiverLink.appendChild(receiverText);

	const updateURLs = () => {
		const senderURL = generateURL(
			Role.Sender,
			roomInput.value,
			passwordInput.value
		);
		const receiverURL = generateURL(
			Role.Receiver,
			roomInput.value,
			passwordInput.value
		);

		senderText.innerText = senderURL;
		senderLink.href = senderURL;
		receiverText.innerText = receiverURL;
		receiverLink.href = receiverURL;
	};

	updateURLs();

	roomInput.addEventListener("input", (event) => {
		updateURLs();
	});
	passwordInput.addEventListener("input", (event) => {
		updateURLs();
	});

	document.body.appendChild(senderLabel);
	document.body.appendChild(senderLink);

	document.body.insertAdjacentHTML(
		"beforeend",
		"<p>Requires a fairly powerful device due to use of newer video codecs, especially if using high resolutions and frame rates.</p><p>Supports up to 25 simultaneous senders. However, it is recommended that you stick to &lt;= 4 simultaneous senders to avoid overloading your receiver.</p><p>If you plan on streaming from very slow networks, it is recommended that you assign as few senders to a room as possible.</br>Every additional client results in an additional ~0.5 kbit/s of traffic to all clients, and a client negotiating a connection results in ~32 kbit of data being sent to all clients (this may be fixed in the future).</p>"
	);

	document.body.appendChild(receiverLabel);
	document.body.appendChild(receiverLink);

	const knownIssuesHTML =
		'<p>All Devices and Browsers:</p><ul><li>On some networks (around 10-20% globally), <b>connections may fail to establish between some or all peers</b> due to restrictive NAT and/or firewall configurations. This can be fixed by configuring a <a href="https://getstream.io/resources/projects/webrtc/advanced/stun-turn/">TURN server</a> using the <code>iceServers</code> URL parameter.</li><li>Connections may fail to establish with the signaling server if your network blocks access to it. If this is the case, you will need to host your own <a href="https://github.com/eclipse-mosquitto/mosquitto">MQTT broker</a> and configure it using the <code>mqttEndpoint</code> URL parameter.</li><li>If you encounter performance issues on the sender or receiver, consider customizing or removing the <code>codecPreferences</code> URL parameter, while making sure to use the same codec preferences on all senders and receivers in your room.</li></ul><p>iOS (all browsers):</p><ul><li><b>Almost all USB microphones will refuse to work</b> due to a <a href="https://bugs.webkit.org/show_bug.cgi?id=211192">known bug in WebKit</a>.</li><li>Double-tapping on the connection statistics to toggle fullscreen mode only works on iPad devices due to a <a href="https://caniuse.com/mdn-api_element_requestfullscreen">known limitation of WebKit</a>.</li><li>Enabling <code>displayMedia</code> causes sender initialization to fail.</li></ul><p>Android (all browsers):</p><ul><li><b>Some USB microphones will refuse to work</b> in some or all browsers, and a problematic microphone on one device may work perfectly on a different device.</li><li>Different Android flavors will expose cameras differently, sometimes resulting in some of the device\'s cameras being inaccessible in some or all browsers.</li><li>Enabling <code>displayMedia</code> causes sender initialization to fail.</li></ul><p>Safari (all platforms):</p><ul><li>Mono audio sources are panned to the left unless <code>channelCount</code> is explicitly set to 1.</li></ul><p>Firefox (all platforms except iOS):</p><ul><li>On low-latency networks with packet loss, audio quality will be significantly degraded relative to other browsers. This is due to a <a href="https://bugzilla.mozilla.org/show_bug.cgi?id=1728573">known bug in Firefox\'s WebRTC implementation</a>.</li><li>When the video encoder is overloaded, Firefox is very reluctant to decrease the resolution to prevent dropped frames.</li><li>Most connections statistics do not display in Firefox.</li><li>Only the left channel of stereo audio sources are captured.</li></ul><p>Android Firefox:</p><ul><li>Audio inputs cannot be manually selected, as only the "Default" input is made available. However, USB microphones are <em>usually</em> automatically used by Firefox when available.</li><li>Camera zoom is not adjustable.</li></ul><p>Android Chrome:</p><ul><li>USB audio devices with no output channels are not selectable as an input.</li><li>USB audio devices containing only output channels will show up in the list of audio inputs. Attempting to use these devices as an input usually causes a different microphone to be used instead.</li><li>Attempting to use a USB audio device without <code>echoCancellation</code> enabled will silently fail, causing a different microphone to be used instead.</li><li>Attempting to use a problematic microphone silently fails, causing a different microphone to be used instead.</li></ul>';
	const parametersHTML =
		'<p>Note: If you\'re using Google Chrome, <code>chrome://webrtc-internals</code> is useful for debugging issues.</p><p>Sender & Receiver:</p><ul><li><code>role</code> = Role (<code>sender</code> or <code>receiver</code>)</li><li><code>id</code> = Room ID</li><li>Fragment (text after <code>#</code>) = Room Password (required for E2E encryption)</li></ul><p>All of the below parameters are optional.</p><p>Sender & Receiver:</p><ul><li><code>stats</code> = Enable connection statistics overlay (boolean)</li><li><code>mqttEndpoint</code> = <a href="https://github.com/mqttjs/MQTT.js#mqttconnecturl-options">MQTT WebSocket endpoint URL</a> (string); Used for WebRTC signaling</li><li><code>iceServers</code> = <a href="https://w3c.github.io/webrtc-pc/#dom-rtcconfiguration-iceservers">WebRTC ICE Servers</a> (JSON-encoded list of <a href="https://w3c.github.io/webrtc-pc/#dom-rtciceserver">RTCIceServer</a> objects)</li><li><code>codecPreferences</code> = <a href="https://blog.mozilla.org/webrtc/cross-browser-support-for-choosing-webrtc-codecs/">Preferred WebRTC Codec Ordering</a> (JSON-encoded list of MIME types); Receiver\'s preferences generally take priority</li><li>It is highly recommended that you use the same WebRTC settings on both ends to avoid connection establishment issues</li></ul><p>Sender Only:</p><ul><li><code>enableAudio</code> = Enable audio (boolean)</li><li><code>enableVideo</code> = Enable video (boolean)</li><li><code>channelCount</code> = Preferred audio channel count (integer)</li><li><code>width</code> = Preferred video width (pixels)</li><li><code>height</code> = Preferred video height (pixels)</li><li><code>frameRate</code> = Preferred video frame rate (frames/second)</li><li><code>aspectRatio</code> = Preferred video aspect ratio (number, rounded to 10 decimal places)</li><li><code>cropAndScale</code> = Crop and/or scale the video to achieve the desired resolution (boolean)</li><li><code>facingMode</code> = The MediaTrackConstraints <a href="https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints/facingMode">facingMode</a> used for initially selecting a camera</li><li><code>displayMedia</code> = Use <a href="https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia">getDisplayMedia</a> instead of <a href="https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia">getUserMedia</a> when creating a MediaStream (boolean)</li><li><code>autoGainControl</code> = <a href="https://w3c.github.io/mediacapture-main/#def-constraint-autoGainControl">Audio MediaTrackConstraints Automatic Gain Control</a> (boolean)</li><li><code>echoCancellation</code> = <a href="https://w3c.github.io/mediacapture-main/#def-constraint-echoCancellation">Audio MediaTrackConstraints Echo Cancellation</a> (<a href="https://w3c.github.io/mediacapture-main/#dom-echocancellationmodeenum">EchoCancellationModeEnum</a> or boolean)</li><li><code>noiseSuppression</code> = <a href="https://w3c.github.io/mediacapture-main/#def-constraint-noiseSuppression">Audio MediaTrackConstraints Noise Suppression</a> (boolean)</li><li><code>voiceIsolation</code> = <a href="https://w3c.github.io/mediacapture-extensions/#voiceisolation-constraint">Audio MediaTrackConstraints Voice Isolation</a> (boolean)</li><li><code>backgroundBlur</code> = <a href="https://w3c.github.io/mediacapture-main/#def-constraint-backgroundBlur">Video MediaTrackConstraints Background Blur</a> (boolean)</li><li><code>audioContentHint</code> = <a href="https://w3c.github.io/mst-content-hint/#audio-content-hints">MediaStreamTrack Audio Content Hint</a></li><li><code>videoContentHint</code> = <a href="https://w3c.github.io/mst-content-hint/#video-content-hints">MediaStreamTrack Video Content Hint</a></li><li><code>maxAudioBitrate</code> = <a href="https://w3c.github.io/webrtc-pc/#dom-rtcrtpencodingparameters-maxbitrate">WebRTC Maximum Audio Bitrate</a> (kilobits/second); Reasonable value is calculated using JavaScript if set to -1</li><li><code>maxVideoBitrate</code> = <a href="https://w3c.github.io/webrtc-pc/#dom-rtcrtpencodingparameters-maxbitrate">WebRTC Maximum Video Bitrate</a> (kilobits/second); Reasonable value is calculated using JavaScript if set to -1</li><li><code>dynamicAudioBitrate</code> = Uses JavaScript to dynamically adjust the maximum audio bitrate between <code>minDynamicAudioBitrate</code> and <code>maxAudioBitrate</code> based on video bitrate (boolean); Always disabled if <code>displayMedia</code> = true</li> or if <code>maxAudioBitrate</code> is not specified<li><code>minDynamicAudioBitrate</code> = Minimum target bitrate for <code>dynamicAudioBitrate</code> algorithm (kilobits/second); Defaults to 32 kbit/s for mono sources and 48 kbit/s for stereo sources, must be at least 32 kbit/s</li><li><code>dynamicVideoFramerate</code> = Uses JavaScript to dynamically adjust the maximum video frame rate between 24 fps and <code>frameRate</code> based on video bitrate (boolean); Always disabled if <code>displayMedia</code> = true or if <code>maxVideoBitrate</code> is not specified</li><li><code>degradationPreference</code> = <a href="https://w3c.github.io/mst-content-hint/#dictionary-rtcrtpsendparameters-new-members">WebRTC Video Degradation Preference</a> (<a href="https://w3c.github.io/mst-content-hint/#dom-rtcdegradationpreference">RTCDegradationPreference</a>)</li></ul><p>Receiver Only:</p><ul><li><code>hideControls</code> = Disable video controls (boolean)</li><li><code>jitterBufferTarget</code> = <a href="https://w3c.github.io/webrtc-pc/#dom-rtcrtpreceiver-jitterbuffertarget">WebRTC Jitter Buffer Target</a> (miliseconds)</li></ul>';
	document.body.insertAdjacentHTML(
		"beforeend",
		'<p>Although this tool will not <em>stop you from</em> having multiple receivers, it is a <b>very bad idea</b> to have more than one active receiver in a room, as senders must encode and send video data directly to every receiver.</p><p>If you encounter connection establishment issues, use the advanced URL parameters to configure a TURN server. You can get a free or cheap TURN server using <a href="https://www.expressturn.com">ExpressTURN</a> (not affiliated with this website).</p><details><summary>Known issues</summary>' +
			knownIssuesHTML +
			"</details></br><details><summary>URL parameters</summary>" +
			parametersHTML +
			'</details><p>Made by <a href="https://x.com/transkatgirl">transkatgirl</a>.</p>'
	);
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
		url.searchParams.set("channelCount", String(1));
		url.searchParams.set("autoGainControl", "true");
		url.searchParams.set("audioContentHint", "music"); // disables most audio processing
		url.searchParams.set("videoContentHint", "motion");
		url.searchParams.set("maxAudioBitrate", "-1");
		url.searchParams.set("maxVideoBitrate", "-1");
		url.searchParams.set("dynamicAudioBitrate", "true"); // TODO: use SDP munging to enable https://issues.webrtc.org/issues/41480988 when sending audio only(?)
		url.searchParams.set("dynamicVideoFramerate", "true");
	}
	if (role == Role.Receiver) {
		//url.searchParams.set("jitterBufferTarget", String(1300)); // chosen based on https://ieeexplore.ieee.org/document/6962149
		// update: high values of jitterBufferTarget can cause problems with congestion control, as GCC doesn't adapt fast enough

		url.searchParams.set("jitterBufferTarget", String(600)); // buffer must be at least 1.5x RTT (may require 2x RTT depending on receiver implementation) for retransmissions to work; see https://www.rtcbits.com/2017/03/retransmissions-in-webrtc.html
		//    - please put your sender and receiver as geographically close together as possible to minimize RTT!
		// we can safely assume average network RTT on each end to be <200ms on non-congested networks, as 4G has now become widespread and 3G is phased out in most countries; see https://hpbn.co/mobile-networks/#cellular-performance and https://en.wikipedia.org/wiki/3G#Phase-out
	}
	url.searchParams.set(
		"codecPreferences",
		JSON.stringify([
			"video/AV1", // in Chrome, AV1 may be faster than VP9 (assuming software encoding only) while delivering better quality; see https://developer.chrome.com/blog/av1/
			"video/VP9", // in low bitrate conditions, VP9 delivers higher quality than H.265; see https://blogs.gnome.org/rbultje/2015/09/28/vp9-encodingdecoding-performance-vs-hevch-264/
			"video/H265",
			"video/H264", // H.264 delivers better visual quality than VP8; see https://www.streamingmedia.com/Articles/Editorial/Featured-Articles/WebM-vs.-H.264-A-Closer-Look-68594.aspx
			"video/VP8",
			"audio/opus",
			"audio/red", // consider prioritizing this above audio/opus if your latency budget is too low for retransmissions to work
			"audio/mp4a-latm", // outperformed by Opus across the board; see https://wiki.hydrogenaudio.org/index.php?title=Opus
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
	let echoCancellation: boolean | string = false;

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

	let enableAudio = params.get("enableAudio") === "true";
	if (!params.has("enableAudio")) {
		enableAudio = true;
	}

	let enableVideo = params.get("enableVideo") === "true";
	if (!params.has("enableVideo")) {
		enableVideo = true;
	}

	if (params.get("echoCancellation") === "true") {
		echoCancellation = true;
	} else if (params.get("echoCancellation") === "false") {
		echoCancellation = false;
	} else if (params.has("echoCancellation")) {
		echoCancellation = params.get("echoCancellation") as string;
	}

	const audioConstraints: MediaTrackConstraints = {
		autoGainControl: params.get("autoGainControl") === "true",
		echoCancellation,
		noiseSuppression: params.get("noiseSuppression") === "true",
		// @ts-ignore
		voiceIsolation: params.get("voiceIsolation") === "true",
		sampleRate: { ideal: 48000 }, // Avoid resampling (Opus uses 48kHz sample rate)
		//sampleSize: { min: 16, ideal: 24 }, // Require audio to be at least 16-bit (disabled because this probably disables audio devices that use floating point for samples?)
	};
	const videoConstraints: MediaTrackConstraints = {
		backgroundBlur: params.get("backgroundBlur") === "true",
	};

	let channelCount = Number(params.get("channelCount"));
	if (params.has("channelCount") && Number.isFinite(channelCount)) {
		audioConstraints.channelCount = {
			ideal: channelCount,
		};
	} else {
		channelCount = 0;
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

	if (maxAudioBitrate && maxAudioBitrate < 0) {
		if (channelCount > 0) {
			maxAudioBitrate = calculateReasonableAudioBitrateKbps(channelCount);
		} else {
			maxAudioBitrate = calculateReasonableAudioBitrateKbps(2);
		}

		audioBitrateCeil = maxAudioBitrate * 1000;
	}

	if (maxVideoBitrate && maxVideoBitrate < 0) {
		if (height && width && height > 0 && width > 0) {
			if (frameRate && frameRate > 0) {
				maxVideoBitrate = calculateReasonableVideoBitrateKbps(
					width,
					height,
					frameRate
				);
			} else {
				maxVideoBitrate = calculateReasonableVideoBitrateKbps(
					width,
					height,
					30
				);
			}
		} else {
			if (frameRate && frameRate > 0) {
				maxVideoBitrate = calculateReasonableVideoBitrateKbps(
					1920,
					1080,
					frameRate
				);
			} else {
				maxVideoBitrate = calculateReasonableVideoBitrateKbps(
					1920,
					1080,
					30
				);
			}
		}
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

	if (params.get("cropAndScale") === "true") {
		// @ts-ignore
		videoConstraints.resizeMode = "crop-and-scale";
	}

	if (params.get("displayMedia") === "true") {
		// @ts-ignore
		videoConstraints.logicalSurface = true;
		// @ts-ignore
		videoConstraints.suppressLocalAudioPlayback = false;
		// @ts-ignore
		videoConstraints.restrictOwnAudio = false;
	} else {
		if (params.has("facingMode")) {
			videoConstraints.facingMode = {
				ideal: params.get("facingMode") as string,
			};
		}
		if (params.has("deviceId")) {
			audioConstraints.deviceId = {
				exact: params.get("deviceId") as string,
			};
		}
		//videoConstraints.zoom = true;
	}

	let audioBitrateFloor: number | undefined;
	const minDynamicAudioBitrate = Number(params.get("minDynamicAudioBitrate"));
	if (
		params.has("minDynamicAudioBitrate") &&
		Number.isFinite(minDynamicAudioBitrate)
	) {
		audioBitrateFloor = minDynamicAudioBitrate * 1000;
	}

	const constraints: MediaStreamConstraints | DisplayMediaStreamOptions = {
		audio: audioConstraints,
		video: videoConstraints,
	};

	if (!enableAudio) {
		constraints.audio = false;
	}

	if (!enableVideo) {
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

		const button = document.createElement("button");
		button.innerText =
			"Click to start (user interaction is required by getDisplayMedia)";
		document.body.appendChild(button);

		await new Promise((resolve, reject) => {
			button.addEventListener(
				"click",
				function (e) {
					resolve(undefined);
				},
				{ once: true }
			);
		});

		button.remove();

		stream = await navigator.mediaDevices.getDisplayMedia(constraints);
	} else {
		if (enableVideo) {
			// Weird hack: Request zoom permissions *before* applying any constraints
			await navigator.mediaDevices
				.getUserMedia({
					audio: enableAudio,
					// @ts-ignore
					video: { zoom: true },
				})
				.then((stream) => {
					stream.getTracks().forEach((track) => {
						track.stop();
					});
				});
		}
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

	overlay.ondblclick = async (event) => {
		event.preventDefault();
		if (document.fullscreenElement) {
			await document.exitFullscreen();
		} else {
			await document.body.requestFullscreen();
		}
	};

	const settings = document.createElement("div");
	settings.classList.add("settings-overlay");
	if (params.get("displayMedia") !== "true") {
		document.body.appendChild(settings);
	}

	const addTrack = async (
		pc: RTCPeerConnection,
		track: MediaStreamTrack,
		stream: MediaStream
	) => {
		const transceiver = pc.addTransceiver(track, {
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
			bundlePolicy: "max-bundle",
			iceCandidatePoolSize: 10,
			iceServers,
		},
		(peerId, peer) => {
			if (peer.pc && BigInt(peerId) % 2n == 0n) {
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

				const dynamicAudioBitrate =
					params.get("dynamicAudioBitrate") === "true" &&
					params.get("displayMedia") !== "true";

				let audioBitrateFloorAdj = audioBitrateFloor
					? audioBitrateFloor
					: 0;
				if (dynamicAudioBitrate && audioBitrateFloorAdj < 32000) {
					const audioChannelCount = stream
						.getAudioTracks()[0]
						?.getSettings()?.channelCount;
					if (audioChannelCount && audioChannelCount > 0) {
						audioBitrateFloorAdj =
							calculateReasonableMinimumAudioBitrateKbps(
								channelCount
							) * 1000;
					} else {
						audioBitrateFloorAdj =
							calculateReasonableMinimumAudioBitrateKbps(2) *
							1000;
					}
				}

				await adaptiveSettings(
					peer.pc,
					dynamicAudioBitrate,
					params.get("dynamicVideoFramerate") === "true" &&
						params.get("displayMedia") !== "true" &&
						params.has("maxVideoBitrate"),
					audioBitrateFloorAdj,
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
				message.desc.sdp = mungeSDP(
					message.desc.sdp,
					channelCount !== 1 // workaround for iOS bug
				);
			}
			return message;
		},
		(_, message) => {
			if (message.desc?.sdp) {
				message.desc.sdp = mungeSDP(
					message.desc.sdp,
					channelCount !== 1 // workaround for iOS bug
				);
			}
			return message;
		}
	);
	const replaceTrack = async (
		oldTrack: MediaStreamTrack,
		newTrack: MediaStreamTrack
	) => {
		const room = (globalThis as any).room as Room;

		oldTrack.stop();
		stream.removeTrack(oldTrack);
		stream.addTrack(newTrack);

		let promises = [];

		for (const [peerId, peer] of Object.entries(room.peers)) {
			if (!peer.pc || BigInt(peerId) % 2n != 0n) continue;

			for (const transceiver of peer.pc.getTransceivers()) {
				if (transceiver.sender.track?.id == oldTrack.id) {
					promises.push(
						transceiver.sender.replaceTrack(newTrack).catch(() => {
							console.log(
								"replaceTrack failed, using fallback method for " +
									peerId
							);
							// replaceTrack() *almost* always works. in the rare cases it doesn't, restarting the connection is by far the most reliable way to handle switching tracks, even if it is quite slow.
							// trust me, i've tried pretty much everything when it comes to good fallbacks for replacing tracks, and i just couldn't come up of anything that would work reliably across browsers. there are always weird edge cases and irrecoverable failure modes you would run into once in a rare while, and although i got close to cross-browser reliability through "restart the connection if anything looks funny", it was becoming such a tangled mess that i didn't feel comfortable trusting it.
							peer.close();
						})
					);
				}
			}
		}

		await Promise.allSettled(promises);

		if (params.get("displayMedia") !== "true") {
			await inputOverlay(settings, stream, constraints, replaceTrack);
		}
	};
	stream.onaddtrack = async (event) => {
		const room = (globalThis as any).room as Room;

		for (const [peerId, peer] of Object.entries(room.peers)) {
			if (!peer.pc || BigInt(peerId) % 2n != 0n) continue;

			addTrack(peer.pc, event.track, stream);
		}

		if (params.get("displayMedia") !== "true") {
			await inputOverlay(settings, stream, constraints, replaceTrack);
		}
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

		if (params.get("displayMedia") !== "true") {
			await inputOverlay(settings, stream, constraints, replaceTrack);
		}
	};
	navigator.mediaDevices.addEventListener("devicechange", async () => {
		if (params.get("displayMedia") !== "true") {
			await inputOverlay(settings, stream, constraints, replaceTrack);
		}
	});

	if (params.get("displayMedia") !== "true") {
		await inputOverlay(settings, stream, constraints, replaceTrack);
	}
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
				}
			};
		},
		(peerId, peer) => {
			if (!peer.pc) return;

			peer.pc.ontrack = null;

			let video = peerVideos[peerId];
			if (video) {
				if (video.srcObject) {
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
		},
		(_, message) => message,
		(_, message) => message,
		(_, message) => {
			if (message.sdp) {
				message.sdp = mungeSDPOfferAnswer(message.sdp);
			}
			return message;
		},
		(_, message) => {
			if (message.sdp) {
				message.sdp = mungeSDPOfferAnswer(message.sdp);
			}
			return message;
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

async function inputOverlay(
	overlay: HTMLDivElement,
	stream: MediaStream,
	constraints: MediaStreamConstraints,
	replaceTrack: (
		oldTrack: MediaStreamTrack,
		newTrack: MediaStreamTrack
	) => Promise<void>
) {
	const fragment = new DocumentFragment();

	const tracks = stream.getTracks();
	tracks.sort((a, b) => (b.kind > a.kind ? 1 : a.kind > b.kind ? -1 : 0));
	for (const track of tracks) {
		if (track.kind == "video" && typeof constraints.video != "boolean") {
			fragment.appendChild(
				await createTrackUI(
					track,
					stream,
					replaceTrack,
					constraints.video
				)
			);
		} else if (
			track.kind == "audio" &&
			typeof constraints.audio != "boolean"
		) {
			fragment.appendChild(
				await createTrackUI(
					track,
					stream,
					replaceTrack,
					constraints.audio
				)
			);
		}
	}
	overlay.replaceChildren(fragment);
}

let isReplacingDevice = false;

async function createTrackUI(
	track: MediaStreamTrack,
	stream: MediaStream,
	replaceTrack: (
		oldTrack: MediaStreamTrack,
		newTrack: MediaStreamTrack
	) => Promise<void>,
	constraints?: MediaTrackConstraints
) {
	let hasDevice = false;

	const trackUi = document.createElement("div");

	const trackSettings = track.getSettings();

	const trackSelect = document.createElement("select");
	const devices = await navigator.mediaDevices.enumerateDevices();

	const placeholderOption = document.createElement("option");
	placeholderOption.value = "";
	trackSelect.appendChild(placeholderOption);

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
			if (track.readyState !== "ended") {
				deviceOption.selected =
					trackSettings.deviceId === device.deviceId;
				if (trackSettings.deviceId === device.deviceId) {
					hasDevice = true;
				}
			}
			deviceOption.innerText = device.label;
			trackSelect.append(deviceOption);
		}
	}
	const replaceDevice = async (deviceId?: string) => {
		if (isReplacingDevice) return;
		isReplacingDevice = true;

		try {
			const trackConstraints = structuredClone(
				constraints ? constraints : {}
			);
			if (deviceId && deviceId.length > 0) {
				trackConstraints.deviceId = {
					exact: deviceId,
				};
			} else {
				deviceId = undefined;
			}
			let streamConstraints: MediaStreamConstraints = {};
			if (track.kind == "video") {
				trackConstraints.facingMode = undefined;
				// @ts-ignore
				trackConstraints.advanced = undefined;
				streamConstraints = {
					video: trackConstraints,
					audio: false,
				};
			} else if (track.kind == "audio") {
				streamConstraints = {
					video: false,
					audio: trackConstraints,
				};
			} else {
				return;
			}

			const temporaryStream = await navigator.mediaDevices.getUserMedia(
				streamConstraints
			);
			const newTrack = temporaryStream.getTracks()[0];
			if (newTrack) {
				if (!deviceId || newTrack.getSettings().deviceId === deviceId) {
					trackUi.remove();
					await replaceTrack(track, newTrack);
				} else {
					newTrack.stop();
					console.error("Device IDs don't match!");
				}
			}
		} catch (error) {
			console.error(error);
		}

		isReplacingDevice = false;
	};
	trackSelect.onchange = async (event) => {
		await replaceDevice((event.target as HTMLSelectElement).value);
	};
	if (hasDevice) {
		placeholderOption.remove();
	} else if (devices.length > 0) {
		replaceDevice();
	}
	trackUi.appendChild(trackSelect);

	const enableCheckbox = document.createElement("input");
	enableCheckbox.type = "checkbox";
	enableCheckbox.checked = track.enabled;
	enableCheckbox.onchange = (event) => {
		track.enabled = (event.target as HTMLInputElement).checked;
	};
	trackUi.appendChild(enableCheckbox);
	trackUi.appendChild(document.createElement("br"));

	if (track.kind == "video" && trackSettings.zoom) {
		const trackCapabilities = track.getCapabilities();

		if ("zoom" in trackCapabilities) {
			const zoomSlider = document.createElement("input");
			zoomSlider.type = "range";
			// @ts-ignore
			zoomSlider.min = trackCapabilities.zoom.min;
			// @ts-ignore
			zoomSlider.max = trackCapabilities.zoom.max;
			// @ts-ignore
			zoomSlider.step = trackCapabilities.zoom.step;
			zoomSlider.value = String(trackSettings.zoom);

			const trackConstraints = track.getConstraints();
			zoomSlider.oninput = async (event) => {
				await track.applyConstraints({
					advanced: [
						// @ts-ignore
						{ zoom: (event.target as HTMLInputElement).value },
						trackConstraints,
					],
				});
			};
			trackUi.appendChild(zoomSlider);
		}
	}

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
	} else {
		overlay.replaceChildren();
	}
}
