import {
	createRoomCredentials,
	Peer,
	Room,
	type RoomCredentials,
} from "./room/webrtc";
import {
	generateRandomString,
	idFromString,
	idToString,
	selfId,
	setSelfId,
} from "./room/core";
import {
	adaptiveSenderSettings,
	adaptToPixelCount,
	buildSenderEncoding,
	calculateReasonableAudioBitrateKbps,
	calculateReasonableVideoBitrateKbps,
	getDevicePixelSize,
	MediaScaler,
	MIN_PIXELS,
	mungeSDP,
	mungeSDPOfferAnswer,
	setCodecPreferences,
	setReceiverSettings,
	setSenderSettings,
	type AdaptiveTargets,
} from "./media";
import type { ScalerCreationOptions } from "./pica-gpu";
import {
	combineStats,
	getPeerStats,
	parseChannelMessage,
	sendChannelMessage,
	type PeerStats,
} from "./stats";

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

if (params.get("stats") === "true") {
	window.addEventListener("error", (event) => {
		if (
			event.message !==
			"ResizeObserver loop completed with undelivered notifications."
		) {
			window.alert("error: " + event.message);
		}
	});
}

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
		"<h1>psychosis.live</h1><blockquote><p>You have to be insane to think you can livestream from <em>there</em>.</p></blockquote><p>This is a tool for streaming low-latency <em>end-to-end encrypted</em> video from your browser into OBS.</p><p>This tool aims to be as resilient as possible to low-quality and/or unreliable connections while maintaining very low latency, with the goal of pushing single-uplink livestreaming right up to the edge of what's possible.</p><p>It is strongly recommended that you <b>use Google Chrome on both sides of the connection</b> for the best possible experience, as WebRTC implementations vary significantly between browsers.</p>";

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
		"<p>Requires a fairly powerful device due to use of newer video codecs, especially if using high resolutions and frame rates.</p><p>Supports up to 25 simultaneous senders. However, it is recommended that you stick to &lt;= 4 simultaneous senders to avoid overloading your receiver.</p>"
	);

	document.body.appendChild(receiverLabel);
	document.body.appendChild(receiverLink);

	const knownIssuesHTML =
		'<p>All Devices and Browsers:</p><ul><li>On some networks (around 10-20% globally), <b>connections may fail to establish between some or all peers</b> due to restrictive NAT and/or firewall configurations. This can be fixed by configuring a <a href="https://getstream.io/resources/projects/webrtc/advanced/stun-turn/">TURN server</a> using the <code>iceServers</code> URL parameter.</li><li>Connections may fail to establish with the signaling server if your network blocks access to it. If this is the case, you will need to host your own <a href="https://github.com/eclipse-mosquitto/mosquitto">MQTT broker</a> and configure it using the <code>mqttEndpoint</code> URL parameter.</li><li>If you encounter performance issues on the sender or receiver, consider customizing or removing the <code>codecPreferences</code> URL parameter, while making sure to use the same codec preferences on all senders and receivers in your room.</li></ul><p>iOS (all browsers):</p><ul><li><b>Almost all USB microphones will refuse to work</b> due to a <a href="https://bugs.webkit.org/show_bug.cgi?id=211192">known bug in WebKit</a>.</li><li>Double-tapping on the connection statistics to toggle fullscreen mode only works on iPad devices due to a <a href="https://caniuse.com/mdn-api_element_requestfullscreen">known limitation of WebKit</a>.</li><li>Enabling <code>displayMedia</code> causes sender initialization to fail, as <a href="https://caniuse.com/mdn-api_mediadevices_getdisplaymedia">mobile browsers don\'t implement getDisplayMedia()</a>.</li></ul><p>Android (all browsers):</p><ul><li>Enabling <code>displayMedia</code> causes sender initialization to fail, as <a href="https://caniuse.com/mdn-api_mediadevices_getdisplaymedia">mobile browsers don\'t implement getDisplayMedia()</a>.</li></ul><p>Safari (all platforms):</p><ul><li>Setting <code>jitterBufferTarget</code> has no effect. This is due to a <a href="https://caniuse.com/mdn-api_rtcrtpreceiver_jitterbuffertarget">known limitation of Webkit</a>.</li><li>Mono audio sources are panned to the left unless <code>channelCount</code> is explicitly set to 1.</li></ul><p>Chrome (all platforms except iOS):</p><ul><li>Enabling <code>autoGainControl</code> can cause audio clipping with some microphones. This can sometimes be fixed by disabling <code>chrome://flags/#enable-webrtc-allow-input-volume-adjustment</code>.</li></ul><p>Firefox (all platforms except iOS):</p><ul><li>On low-latency networks with periods of burst packet loss, audio quality will be significantly degraded relative to other browsers. This is due to a <a href="https://bugzilla.mozilla.org/show_bug.cgi?id=1728573">known bug in Firefox\'s WebRTC implementation</a>.</li><li>When the video encoder is overloaded, Firefox is very reluctant to decrease the resolution to prevent dropped frames.</li><li>Most connections statistics do not display in Firefox.</li><li>Only the left channel of stereo audio sources are captured.</li></ul><p>Android Firefox:</p><ul><li>Audio inputs cannot be manually selected, as only the "Default" input is made available. However, USB microphones are <em>usually</em> automatically used by Firefox when available.</li><li><b>Using USB microphones sometimes causes the stream audio to break</b>.</li><li>Camera zoom is not adjustable.</li></ul><p>Android Chrome:</p><ul><li>USB audio devices with no output channels are not selectable as an input.</li><li>USB audio devices containing only output channels will show up in the list of audio inputs. Attempting to use these devices as an input usually causes a different microphone to be used instead.</li><li><b>Attempting to use a USB audio device without <code>echoCancellation</code> enabled will silently fail</b>, causing a different microphone to be used instead.*</li><li>On phones with multiple physical cameras represented as one logical camera, the main (1x) camera is always used.*</li></ul><p>* = Fixable using <a href="https://github.com/transkatgirl/transkatgirl.github.io/tree/main/assets/patches">transkatgirl\'s Android Chromium Patches</a></p><p>Specialized browsers:</p><ul><li>The OBS browser source may handle adverse network conditions worse than desktop Chromium due to its use of an old version of the Chromium Embedded Framework.</li><li>The <em>Windows</em> version of <a href="https://github.com/steveseguin/electroncapture">Electron Capture</a> has nonstandard WebRTC patches which <b>interact badly with psychosis.live\'s sender mode</b>.</li></ul>';
	const parametersHTML =
		'<p>Note: If you\'re using Google Chrome, <code>chrome://webrtc-internals</code> is useful for debugging issues.</p><p>Sender & Receiver:</p><ul><li><code>role</code> = Role (<code>sender</code> or <code>receiver</code>)</li><li><code>id</code> = Room ID</li><li>Fragment (text after <code>#</code>) = Room Password (required for E2E encryption)</li></ul><p>All of the below parameters are optional.</p><p>Sender & Receiver:</p><ul><li><code>stats</code> = Enable connection statistics overlay (boolean)</li><li><code>mqttEndpoint</code> = <a href="https://github.com/mqttjs/MQTT.js#mqttconnecturl-options">MQTT WebSocket endpoint URL</a> (string); Used for WebRTC signaling</li><li><code>iceServers</code> = <a href="https://w3c.github.io/webrtc-pc/#dom-rtcconfiguration-iceservers">WebRTC ICE Servers</a> (JSON-encoded list of <a href="https://w3c.github.io/webrtc-pc/#dom-rtciceserver">RTCIceServer</a> objects)</li><li><code>codecPreferences</code> = <a href="https://blog.mozilla.org/webrtc/cross-browser-support-for-choosing-webrtc-codecs/">Preferred WebRTC Codec Ordering</a> (JSON-encoded list of MIME types); Receiver\'s preferences generally take priority</li><li>(It is highly recommended that you use the same WebRTC settings on both ends to avoid connection establishment issues)</li><li><code>overrideScaler</code> - Overrides the browser video scalers with an experimental WebGL-based scaler, which can provide noticeably better visual quality (ymmv; <em>this interacts badly with some devices</em> and only works on Chromium); If you plan on using this on the sender, it\'s highly recommended that you enable <code>dynamicVideoParams</code> so that the video resolution will be adapted based on available bandwidth.</li><li><code>scalingFilter</code> = Scaling filter used by <code>overrideScaler</code> ("browser" | "browser_nosmooth" | "box" | "hamming" | "lanczos2" | "lanczos3" | "mks2013" | "mks2021"); Defaults to <a href="https://johncostella.com/magic/">mks2013</a> on senders and <a href="https://johncostella.com/magic/">mks2021</a> on receivers</li><li><code>reducedQualityScaling</code> = Use <code>mediump</code> floating point precision & <code>UNSIGNED_BYTE</code> texture precision when evaluating scaling filters (boolean); Defaults to false, produces subtly incorrect values (processing is done in sRGB instead of linear RGB) to avoid visible quantization artifacts. Ignored if <code>scalingFilter</code> is set to "browser" or "browser_nosmooth", as these filters bypass the WebGL filtering pipeline.</li></ul><p>Sender Only:</p><ul><li><code>enableAudio</code> = Enable audio (boolean)</li><li><code>enableVideo</code> = Enable video (boolean)</li><li><code>channelCount</code> = Preferred audio channel count (integer)</li><li><code>width</code> = Preferred video width (pixels)</li><li><code>height</code> = Preferred video height (pixels)</li><li><code>frameRate</code> = Preferred video frame rate (frames/second)</li><li><code>aspectRatio</code> = Preferred video aspect ratio (number, rounded to 10 decimal places)</li><li><code>cropAndScale</code> = Crop and/or scale the video to achieve the desired resolution (boolean)</li><li><code>facingMode</code> = The MediaTrackConstraints <a href="https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints/facingMode">facingMode</a> used for initially selecting a camera</li><li><code>displayMedia</code> = Use <a href="https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia">getDisplayMedia</a> instead of <a href="https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia">getUserMedia</a> when creating a MediaStream (boolean)</li><li><code>autoGainControl</code> = <a href="https://w3c.github.io/mediacapture-main/#def-constraint-autoGainControl">Audio MediaTrackConstraints Automatic Gain Control</a> (boolean)</li><li><code>echoCancellation</code> = <a href="https://w3c.github.io/mediacapture-main/#def-constraint-echoCancellation">Audio MediaTrackConstraints Echo Cancellation</a> (<a href="https://w3c.github.io/mediacapture-main/#dom-echocancellationmodeenum">EchoCancellationModeEnum</a> or boolean)</li><li><code>noiseSuppression</code> = <a href="https://w3c.github.io/mediacapture-main/#def-constraint-noiseSuppression">Audio MediaTrackConstraints Noise Suppression</a> (boolean)</li><li><code>voiceIsolation</code> = <a href="https://w3c.github.io/mediacapture-extensions/#voiceisolation-constraint">Audio MediaTrackConstraints Voice Isolation</a> (boolean)</li><li><code>backgroundBlur</code> = <a href="https://w3c.github.io/mediacapture-main/#def-constraint-backgroundBlur">Video MediaTrackConstraints Background Blur</a> (boolean)</li><li><code>audioContentHint</code> = <a href="https://w3c.github.io/mst-content-hint/#audio-content-hints">MediaStreamTrack Audio Content Hint</a></li><li><code>videoContentHint</code> = <a href="https://w3c.github.io/mst-content-hint/#video-content-hints">MediaStreamTrack Video Content Hint</a></li><li><code>maxAudioBitrate</code> = <a href="https://w3c.github.io/webrtc-pc/#dom-rtcrtpencodingparameters-maxbitrate">WebRTC Maximum Audio Bitrate</a> (kilobits/second); Reasonable value is calculated using JavaScript if set to -1</li><li><code>maxVideoBitrate</code> = <a href="https://w3c.github.io/webrtc-pc/#dom-rtcrtpencodingparameters-maxbitrate">WebRTC Maximum Video Bitrate</a> (kilobits/second); Reasonable value is calculated using JavaScript if set to -1</li><li><code>dynamicAudioBitrate</code> = Uses JavaScript to dynamically adjust the maximum audio bitrate between either 64 kbit/s (mono) or 104 kbit/s (stereo) and <code>maxAudioBitrate</code> based on video bitrate (boolean)</li><li><code>dynamicVideoParams</code> = Uses JavaScript to dynamically adjust video parameters (such as video framerate) based on available bandwidth (boolean); Always disabled if <code>displayMedia</code> = true</li><li><code>degradationPreference</code> = <a href="https://w3c.github.io/mst-content-hint/#dictionary-rtcrtpsendparameters-new-members">WebRTC Video Degradation Preference</a> (<a href="https://w3c.github.io/mst-content-hint/#dom-rtcdegradationpreference">RTCDegradationPreference</a>); Ignored if <code>overrideScaler</code> = true</li></ul><p>Receiver Only:</p><ul><li><code>hideControls</code> = Disable video controls (boolean); Enabled by default when using OBS browser source or Electron Capture</li><li><code>jitterBufferTarget</code> = <a href="https://w3c.github.io/webrtc-pc/#dom-rtcrtpreceiver-jitterbuffertarget">WebRTC Jitter Buffer Target</a> (miliseconds)</li></ul>';
	document.body.insertAdjacentHTML(
		"beforeend",
		'<p>Although this tool will not <em>stop you from</em> having multiple receivers, it is a <b>very bad idea</b> to have more than one active receiver in a room, as senders must encode and send video data directly to every receiver.</p><p>If you encounter connection establishment issues, use the advanced URL parameters to configure a TURN server. You can get a free or cheap TURN server using <a href="https://www.expressturn.com">ExpressTURN</a> (not affiliated with this website).</p><details><summary>Known issues</summary>' +
			knownIssuesHTML +
			"</details></br><details><summary>URL parameters</summary>" +
			parametersHTML +
			'</details><p><a href="https://github.com/transkatgirl/psychosis.live">View source on GitHub</a></p>'
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
		url.searchParams.set("audioContentHint", "music"); // disables most audio processing
		url.searchParams.set("videoContentHint", "motion");
		url.searchParams.set("maxAudioBitrate", "-1");
		url.searchParams.set("maxVideoBitrate", "-1");
		url.searchParams.set("dynamicAudioBitrate", "true"); // TODO: use SDP munging to enable https://issues.webrtc.org/issues/41480988 when sending audio only
		url.searchParams.set("dynamicVideoParams", "true");
	}
	if (role == Role.Receiver) {
		/*

		In my real-world testing, 400ms is the highest jitterBufferTarget that *works reliably without issue*.

		Reasons to prefer a lower jitterBufferTarget:
		- Larger buffers adversely affect WebRTC's ability to handle changes in available network bandwidth:
			- Retransmitted packets seem to be prioritized roughly the same as new packets, resulting in serious network congestion when network conditions worsen.
				- If the jitterBufferTarget is large enough, WebRTC fails to recover from transient changes in network conditions due to the congestion caused by retransmissions.
			- When available bandwidth decreases, the transient congestion caused by retransmissions forces the congestion control algorithm to lower bitrate far below what would be considered reasonable for the available bandwidth.
		- A/V desynchronization tends to get worse as the buffer gets larger.
		- jitterBufferTarget values >1500ms don't improve retransmission reliability (see https://www.rtcbits.com/2017/03/retransmissions-in-webrtc.html)
		- Lower latency leads to a better user experience.

		Reasons to prefer a higher jitterBufferTarget:
		- If the buffer is too small, lost packets can't be retransmitted in time, significantly worsening user experience; Retransmissions are done immediately after a gap in packet sequence numbers, see https://www.rtcbits.com/2017/03/retransmissions-in-webrtc.html
			- https://hpbn.co/mobile-networks/#cellular-performance discusses latency on non-congested cellular networks; 4G latency is usually <100ms
				- Keep in mind that 3G is phased out or in the process of being phased out in most countries (see https://en.wikipedia.org/wiki/3G#Phase-out).
			- https://hpbn.co/primer-on-latency-and-bandwidth/#geo-latency-table discusses latency caused by the physical distance between peers; real world latency between geographically distant peers is usually 200-300ms
			- https://hpbn.co/primer-on-latency-and-bandwidth/#last-mile-latency - last-mile latency for residential internet is usually 10-65 ms
		- Letting the browser repeatedly adjust the jitter buffer size up and down based on network conditions requires stretching the audio and video timing, which can be unacceptable for some applications (such as live music).

		*/
		url.searchParams.set("jitterBufferTarget", String(400));
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
			"audio/red", // consider prioritizing this above audio/opus if your latency budget is too low for retransmissions to work; see https://getstream.io/resources/projects/webrtc/advanced/red/
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

	console.log(`role = ${role}, peer ID = ${idToString(selfId)}`);

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
	let scalingFilter: string | undefined;
	let degradationPreference: RTCDegradationPreference | undefined;
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

	degradationPreference = params.get("degradationPreference") as
		| RTCDegradationPreference
		| undefined;
	if (degradationPreference === null) {
		degradationPreference = undefined;
	}

	maxVideoBitrate = Number(params.get("maxVideoBitrate"));
	if (!(params.has("maxVideoBitrate") && Number.isFinite(maxVideoBitrate))) {
		maxVideoBitrate = undefined;
	}

	maxAudioBitrate = Number(params.get("maxAudioBitrate"));
	if (params.has("maxAudioBitrate") && Number.isFinite(maxAudioBitrate)) {
		maxAudioBitrate = maxAudioBitrate;
	} else {
		maxAudioBitrate = undefined;
	}

	maxFramerate = Number(params.get("maxFramerate"));
	if (params.has("maxFramerate") && Number.isFinite(maxFramerate)) {
		maxFramerate = maxFramerate;
	} else {
		const frameRate = Number(params.get("frameRate"));
		if (params.has("frameRate") && Number.isFinite(frameRate)) {
			maxFramerate = frameRate;
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

		if (params.get("dynamicAudioBitrate") === "true") {
			maxAudioBitrate = undefined; // dynamicAudioBitrate adjusts it adaptively based on stream channel count
		}
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

		if (
			params.get("displayMedia") !== "true" &&
			params.get("dynamicVideoParams") === "true"
		) {
			maxVideoBitrate = undefined; // dynamicVideoParams adjusts it adaptively based on stream attributes
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

	if (params.has("scalingFilter")) {
		scalingFilter = params.get("scalingFilter") as string;
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
	// @ts-ignore
	if (video.controlsList) {
		// @ts-ignore
		video.controlsList.add("nofullscreen");
		// @ts-ignore
		video.controlsList.add("nodownload");
		// @ts-ignore
		video.controlsList.add("noplaybackrate");
	}
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

	const peerScalers: Record<string, MediaScaler> = {};

	const addTrack = async (
		peer: Peer,
		peerId: string,
		track: MediaStreamTrack,
		stream: MediaStream
	) => {
		if (!peer.pc) return;

		let transceiver;

		if (params.get("overrideScaler") === "true") {
			degradationPreference =
				"maintain-framerate-and-resolution" as RTCDegradationPreference;

			let scaler = peerScalers[peerId];

			if (!scaler) {
				let scalerWidth;
				let scalerHeight;

				if (!width || !height) {
					scalerWidth = stream
						.getVideoTracks()[0]
						?.getSettings()?.width;
					scalerHeight = stream
						.getVideoTracks()[0]
						?.getSettings()?.height;
				} else {
					scalerWidth = width;
					scalerHeight = height;
				}

				if (!scalerWidth) scalerWidth = 1280;
				if (!scalerHeight) scalerHeight = 720;

				if (
					params.get("dynamicVideoParams") === "true" &&
					params.get("displayMedia") !== "true"
				) {
					[scalerWidth, scalerHeight] = adaptToPixelCount(
						scalerWidth,
						scalerHeight,
						MIN_PIXELS
					);
				}

				scaler = new MediaScaler(
					scalerWidth,
					scalerHeight,
					scalingFilter
						? (scalingFilter as ScalerCreationOptions["filter"])
						: "mks2013", // sharper filters are better for downscaling
					params.get("reducedQualityScaling") !== "true"
				);

				peerScalers[peerId] = scaler;
			}

			const scalerTrack = scaler.addTrack(track, false, true, () => {
				peer.metadata["GPULimited"] = true;
			});

			transceiver = peer.pc.addTransceiver(scalerTrack, {
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
				streams: [scaler.stream],
			});
		} else {
			transceiver = peer.pc.addTransceiver(track, {
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
		}

		if (codecOrderPreference) {
			setCodecPreferences(transceiver, codecOrderPreference);
		}
		await setSenderSettings(transceiver.sender, degradationPreference);
	};

	const displayedTracks: Set<string> = new Set();
	const replaceTrack = async (
		oldTrack: MediaStreamTrack,
		newTrack: MediaStreamTrack
	) => {
		displayedTracks.clear();

		const room = (globalThis as any).room as Room;

		oldTrack.stop();
		stream.removeTrack(oldTrack);
		stream.addTrack(newTrack);

		let promises = [];

		for (const [peerId, peer] of Object.entries(room.peers)) {
			if (!peer.pc || idFromString(peerId) % 2n != 0n) continue;

			let scaler = peerScalers[peerId];

			for (const transceiver of peer.pc.getTransceivers()) {
				const onReplaceTrackRejected = () => {
					console.warn(
						"replaceTrack failed, using fallback method for " +
							peerId
					);
					// replaceTrack() *almost* always works. in the rare cases it doesn't, restarting the connection is by far the most reliable way to handle switching tracks, even if it is quite slow.
					// trust me, i've tried pretty much everything when it comes to good fallbacks for replacing tracks, and i just couldn't come up of anything that would work reliably across browsers. there are always weird edge cases and irrecoverable failure modes you would run into once in a rare while, and although i got close to cross-browser reliability through "restart the connection if anything looks funny", it was becoming such a tangled mess that i didn't feel comfortable trusting it.
					peer.close();
				};

				if (
					transceiver.sender.track?.id === oldTrack.id ||
					(transceiver.sender.track?.kind === "video" &&
						scaler?.videoId === oldTrack.id)
				) {
					if (scaler) {
						scaler.removeTrack(oldTrack);
						const scaledTrack = scaler.addTrack(
							newTrack,
							false,
							true,
							() => {
								peer.metadata["GPULimited"] = true;
							}
						);

						promises.push(
							transceiver.sender
								.replaceTrack(scaledTrack)
								.catch(onReplaceTrackRejected)
						);
					} else {
						promises.push(
							transceiver.sender
								.replaceTrack(newTrack)
								.catch(onReplaceTrackRejected)
						);
					}
				}
			}
		}

		await Promise.allSettled(promises);

		if (params.get("displayMedia") !== "true") {
			await inputOverlay(
				settings,
				stream,
				constraints,
				replaceTrack,
				displayedTracks
			);
		}
	};

	const textEncoder = new TextEncoder();
	const textDecoder = new TextDecoder();
	const peerData: Record<string, RTCDataChannel> = {};

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
			if (peer.pc && idFromString(peerId) % 2n == 0n) {
				peerData[peerId] = peer.pc.createDataChannel("stats", {
					maxPacketLifeTime: 1000,
				});
				peerData[peerId].onmessage = async (event) => {
					peer.metadata["remoteStatsTimestamp"] = performance.now();
					peer.metadata["remoteStats"] = await parseChannelMessage(
						event.data,
						textDecoder
					);
				};

				stream.getTracks().forEach((track) => {
					if (!peer.pc) return;

					addTrack(peer, peerId, track, stream);
				});
			}
		},
		(peerId, _peer) => {
			const scaler = peerScalers[peerId];

			if (scaler) {
				scaler.destroy();
				delete peerScalers[peerId];
			}
		},
		async (peers) => {
			for (const [peerId, peer] of Object.entries(peers)) {
				if (!peer.pc) continue;

				let audioChannelCount = stream
					.getAudioTracks()[0]
					?.getSettings()?.channelCount;

				if (channelCount == 1) {
					audioChannelCount = 1;
				}

				if (!audioChannelCount) {
					if (channelCount > 0) {
						audioChannelCount = channelCount;
					} else {
						audioChannelCount = 2;
					}
				}

				let streamWidth = stream
					.getVideoTracks()[0]
					?.getSettings()?.width;
				let streamHeight = stream
					.getVideoTracks()[0]
					?.getSettings()?.height;
				let streamFramerate = stream
					.getVideoTracks()[0]
					?.getSettings()?.frameRate;

				let targets: AdaptiveTargets = {};

				if (params.get("dynamicAudioBitrate") === "true") {
					targets.audio = {
						channels: audioChannelCount,
						bitrate: maxAudioBitrate,
					};
				}

				const peerScaler = peerScalers[peerId];

				if (
					params.get("dynamicVideoParams") === "true" &&
					params.get("displayMedia") !== "true" &&
					streamFramerate
				) {
					targets.video = {
						width: streamWidth,
						height: streamHeight,
						framerate: streamFramerate,
						bitrate: maxVideoBitrate,
					};
				} else if (
					peerScaler &&
					(params.get("dynamicVideoParams") !== "true" ||
						params.get("displayMedia") === "true") &&
					streamWidth &&
					streamHeight
				) {
					peerScaler.resize(streamWidth, streamHeight);
				}

				if (!("peerData" in peer.metadata)) {
					peer.metadata["peerData"] = {};
				}

				const peerData = peer.metadata["peerData"];
				await adaptiveSenderSettings(
					peer.pc,
					peerData,
					targets,
					peerScaler
				);
				peer.metadata["peerData"] = peerData;
			}

			await calculateStats(peers, peerData, textEncoder);

			if (params.get("stats") === "true") {
				statsOverlay(overlay, peers);
			}

			if (
				params.get("displayMedia") !== "true" &&
				displayedTracks.size > 0
			) {
				let shouldUpdate = false;

				for (const track of stream.getTracks()) {
					if (!displayedTracks.has(track.id)) {
						shouldUpdate = true;
					}
				}

				if (shouldUpdate) {
					// just in case; this typically shouldn't happen

					console.log("UI state is invalid; updating inputOverlay");
					await inputOverlay(
						settings,
						stream,
						constraints,
						replaceTrack,
						displayedTracks
					);
				}
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
		},
		(_, m) => m,
		(_, m) => m,
		2_000,
		true
	);
	let removedTracks: Record<string, MediaStreamTrack> = {};
	stream.onaddtrack = async (event) => {
		displayedTracks.clear();

		console.log("track " + event.track.id + " added");

		const room = (globalThis as any).room as Room;

		let removedTrack;

		for (const [id, track] of Object.entries(removedTracks)) {
			if (
				track.readyState === "ended" &&
				track.kind == event.track.kind
			) {
				removedTrack = track;
				delete removedTracks[id];
				break;
			}
		}

		if (removedTrack) {
			for (const [peerId, peer] of Object.entries(room.peers)) {
				if (!peer.pc || idFromString(peerId) % 2n != 0n) continue;

				await replaceTrack(removedTrack, event.track);
			}
		} else {
			console.warn("unable to find replacable track");
		}

		if (params.get("displayMedia") !== "true") {
			await inputOverlay(
				settings,
				stream,
				constraints,
				replaceTrack,
				displayedTracks
			);
		}
	};
	stream.onremovetrack = async (event) => {
		displayedTracks.clear();

		console.log("track " + event.track.id + " removed");

		event.track.stop();
		removedTracks[event.track.id] = event.track;

		if (params.get("displayMedia") !== "true") {
			await inputOverlay(
				settings,
				stream,
				constraints,
				replaceTrack,
				displayedTracks
			);
		}
	};
	navigator.mediaDevices.addEventListener("devicechange", async () => {
		if (params.get("displayMedia") !== "true") {
			await inputOverlay(
				settings,
				stream,
				constraints,
				replaceTrack,
				displayedTracks
			);
		}
	});

	if (params.get("displayMedia") !== "true") {
		await inputOverlay(
			settings,
			stream,
			constraints,
			replaceTrack,
			displayedTracks
		);
	}
}

async function launchReceiver(credentials: RoomCredentials) {
	let mqttEndpoint = defaultMqttEndpoint;
	let iceServers: any;
	let codecOrderPreference: any;
	let jitterBufferTarget;
	let scalingFilter: string | undefined;

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

	if (params.has("scalingFilter")) {
		scalingFilter = params.get("scalingFilter") as string;
	}

	const peerVideos: Record<string, HTMLVideoElement> = {};
	const peerStreams: Record<string, MediaStream> = {};
	const peerScalers: Record<string, MediaScaler> = {};
	const videoContainer = document.createElement("div");
	videoContainer.classList.add("gallery");
	document.body.appendChild(videoContainer);

	const updateScalers = async () => {
		for (const [peerId, video] of Object.entries(peerVideos)) {
			const scaler = peerScalers[peerId];

			if (scaler) {
				const size = await getDevicePixelSize(video);
				scaler.resize(size[0], size[1]);
			}
		}
	};

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

	const textEncoder = new TextEncoder();
	const textDecoder = new TextDecoder();
	const peerData: Record<string, RTCDataChannel> = {};

	(globalThis as any).room = new Room(
		mqttEndpoint,
		credentials,
		{
			iceCandidatePoolSize: 10,
			iceServers,
		},
		(peerId, peer) => {
			if (!peer.pc) return;

			peer.pc.ondatachannel = (event) => {
				peerData[peerId] = event.channel;
				peerData[peerId].onmessage = async (event) => {
					peer.metadata["remoteStatsTimestamp"] = performance.now();
					peer.metadata["remoteStats"] = await parseChannelMessage(
						event.data,
						textDecoder
					);
				};
			};
			peer.pc.ontrack = async (event) => {
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
					if (
						params.get("hideControls") === "true" ||
						(("obsstudio" in window || "electronApi" in window) &&
							params.get("hideControls") !== "false")
					) {
						video.controls = false;
					} else {
						video.controls = true;
						// @ts-ignore
						if (video.controlsList) {
							if (params.get("overrideScaler") === "true") {
								// @ts-ignore
								video.controlsList.add("nofullscreen");
								// @ts-ignore
								video.controlsList.add("noremoteplayback");
							}
							// @ts-ignore
							video.controlsList.add("nodownload");
							// @ts-ignore
							video.controlsList.add("noplaybackrate");
						}
					}
					video.playsInline = true;
					video.id = peerId;
					video.title = peerId;

					videoContainer.appendChild(video);
					updateGalleryStyles(videoContainer);
					updateScalers();
				}

				peerVideos[peerId] = video;

				const stream = event.streams[0];

				if (stream) {
					if (params.get("overrideScaler") === "true") {
						peerStreams[peerId] = stream;

						if (video.srcObject === null) {
							const size = await getDevicePixelSize(video);
							const scaler = new MediaScaler(
								size[0],
								size[1],
								scalingFilter
									? (scalingFilter as ScalerCreationOptions["filter"])
									: "mks2021", // blurrier filters are better for upscaling
								params.get("reducedQualityScaling") !== "true"
							);

							for (const track of stream.getTracks()) {
								scaler.addTrack(track, true, true, () => {
									peer.metadata["GPULimited"] = true;
								});
							}

							peerScalers[peerId] = scaler;
							video.srcObject = scaler.stream;

							stream.onaddtrack = (event) => {
								scaler.addTrack(event.track, true, true, () => {
									peer.metadata["GPULimited"] = true;
								});
							};
							stream.onremovetrack = async (event) => {
								scaler.removeTrack(event.track);
							};
						}
					} else {
						video.srcObject = stream;
					}
				}
			};
		},
		(peerId, peer) => {
			if (!peer.pc) return;

			peer.pc.ontrack = null;

			let stream = peerStreams[peerId];
			if (stream) {
				stream.onaddtrack = null;
				stream.onremovetrack = null;
				stream.getTracks().forEach((track) => track.stop());
			}
			let video = peerVideos[peerId];
			if (video) {
				if (video.srcObject) {
					(video.srcObject as MediaStream).onaddtrack = null;
					(video.srcObject as MediaStream).onremovetrack = null;
					(video.srcObject as MediaStream)
						.getTracks()
						.forEach((track) => track.stop());
				}
				video.srcObject = null;
				videoContainer.removeChild(video);
				delete peerVideos[peerId];
				updateGalleryStyles(videoContainer);
				updateScalers();
			}
			let scaler = peerScalers[peerId];
			if (scaler) {
				scaler.destroy();
				delete peerScalers[peerId];
			}
		},
		async (peers) => {
			await calculateStats(peers, peerData, textEncoder, peerVideos);

			if (params.get("stats") === "true") {
				statsOverlay(overlay, peers);
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
		},
		1_000,
		false
	);

	const resizeObserver = new ResizeObserver((entries) => {
		requestAnimationFrame(() => {
			for (const entry of entries) {
				updateGalleryStyles(entry.target as HTMLElement);
			}

			updateScalers();
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
	) => Promise<void>,
	displayedTracks: Set<string>
) {
	displayedTracks.clear();

	const fragment = new DocumentFragment();

	const tracks = stream.getTracks();

	for (const track of tracks) {
		displayedTracks.add(track.id);
	}

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

async function calculateStats(
	peers: Record<string, Peer>,
	channels: Record<string, RTCDataChannel>,
	encoder: TextEncoder,
	videos?: Record<string, HTMLVideoElement>
) {
	for (const [peerId, peer] of Object.entries(peers)) {
		const stats = await getPeerStats(peer, videos?.[peerId]);

		if (stats) {
			const channel = channels[peerId];
			if (channel) {
				sendChannelMessage(stats, encoder, channel);
			}
			peer.metadata["stats"] = stats;
			peer.metadata["statsTimestamp"] = performance.now();
		}
	}
}

function statsOverlay(overlay: HTMLDivElement, peers: Record<string, Peer>) {
	const peerList = document.createElement("ul");

	if (!((globalThis as any).room as Room).room.client.connected) {
		const entry = document.createElement("li");
		entry.innerText = "Disconnected from signaling server";
		entry.classList.add("stats-alert");

		peerList.appendChild(entry);
	}

	for (const [peerId, peer] of Object.entries(peers)) {
		const localStats: PeerStats | undefined = peer.metadata["stats"];

		if (!localStats) {
			continue;
		}

		let remoteStats: PeerStats | undefined;

		if (
			peer.metadata["statsTimestamp"] -
				peer.metadata["remoteStatsTimestamp"] <
			2100 +
				(localStats.roundTripTime ? localStats.roundTripTime : 200 * 2)
		) {
			remoteStats = peer.metadata["remoteStats"];
		}

		let stats = localStats;

		if (remoteStats) {
			stats = combineStats(localStats, remoteStats);
		}

		const peerEntry = document.createElement("li");

		let label = `${peerId} (${peer.pc?.connectionState})`;

		if (stats.targetAudioBitrate && stats.targetVideoBitrate) {
			label =
				label +
				`\n[S] A: ${stats.targetAudioBitrate} kbit/s V: ${stats.targetVideoBitrate} kbit/s`;
		} else if (stats.targetAudioBitrate) {
			label = label + `\n[S] A: ${stats.targetAudioBitrate} kbit/s`;
		} else if (stats.targetVideoBitrate) {
			label = label + `\n[S] V: ${stats.targetVideoBitrate} kbit/s`;
		}

		if (
			(localStats.sender && localStats.cpuLimited) ||
			(remoteStats && remoteStats.sender && remoteStats.cpuLimited)
		) {
			if (stats.targetAudioBitrate || stats.targetVideoBitrate) {
				label = label + " (CPU limited)";
			} else {
				label = label + "\n[S] (CPU limited)";
			}
		}

		if (
			(localStats.sender && localStats.gpuLimited) ||
			(remoteStats && remoteStats.sender && remoteStats.gpuLimited)
		) {
			if (stats.targetAudioBitrate || stats.targetVideoBitrate) {
				label = label + " (GPU limited)";
			} else {
				label = label + "\n[S] (GPU limited)";
			}
		}

		if (stats.jitterBufferDelay) {
			label = label + `\n[R] Buffer: ${stats.jitterBufferDelay} ms`;

			if (stats.desync !== undefined) {
				label = label + ` Desync: ${stats.desync} ms`;
			}

			if (stats.frameDropPercent !== undefined) {
				label = label + ` Drop: ${stats.frameDropPercent}%`;
			}
		}

		if (
			(!localStats.sender && localStats.cpuLimited) ||
			(remoteStats && !remoteStats.sender && remoteStats.cpuLimited)
		) {
			if (stats.jitterBufferDelay) {
				label = label + " (CPU limited)";
			} else {
				label = label + "\n[R] (CPU limited)";
			}
		}

		if (
			(!localStats.sender && localStats.gpuLimited) ||
			(remoteStats && !remoteStats.sender && remoteStats.gpuLimited)
		) {
			if (stats.jitterBufferDelay) {
				label = label + " (GPU limited)";
			} else {
				label = label + "\n[R] (GPU limited)";
			}
		}

		if (stats.outgoingBandwidth && stats.incomingBandwidth) {
			label =
				label +
				`\nD: ${stats.incomingBandwidth} kbit/s U: ${stats.outgoingBandwidth} kbit/s`;

			if (stats.roundTripTime !== undefined) {
				label = label + ` RTT: ${stats.roundTripTime} ms`;
			}

			if (stats.jitter !== undefined) {
				label = label + ` PDV: ${stats.jitter} ms`;
			}

			if (stats.lossPercent !== undefined) {
				label = label + ` Loss: ${stats.lossPercent}%`;
			}
		} else if (stats.roundTripTime !== undefined) {
			label = label + `\nRTT: ${stats.roundTripTime} ms`;

			if (stats.jitter !== undefined) {
				label = label + ` PDV: ${stats.jitter} ms`;
			}

			if (stats.lossPercent !== undefined) {
				label = label + ` Loss: ${stats.lossPercent}%`;
			}
		}

		if (
			(stats.targetVideoBitrate && stats.targetVideoBitrate < 320) ||
			(stats.jitterBufferDelay &&
				stats.roundTripTime &&
				stats.roundTripTime > stats.jitterBufferDelay) ||
			(stats.jitterBufferDelay &&
				stats.jitter &&
				stats.jitter > stats.jitterBufferDelay) ||
			(stats.lossPercent &&
				stats.lossPercent >= 2 &&
				stats.roundTripTime &&
				stats.jitterBufferDelay &&
				stats.roundTripTime + (stats.jitter ? stats.jitter : 0) / 2 >
					stats.jitterBufferDelay) ||
			(stats.lossPercent && stats.lossPercent >= 10) ||
			(stats.desync && stats.desync > 250) ||
			peer.pc?.connectionState !== "connected"
		) {
			peerEntry.classList.add("stats-alert");
		} else if (
			(stats.targetVideoBitrate && stats.targetVideoBitrate < 1024) ||
			(stats.jitterBufferDelay && stats.jitterBufferDelay > 600) ||
			(stats.roundTripTime &&
				stats.jitterBufferDelay &&
				stats.roundTripTime + (stats.jitter ? stats.jitter : 0) / 2 >
					stats.jitterBufferDelay) ||
			(stats.lossPercent && stats.lossPercent >= 2) ||
			(stats.desync && stats.desync > 100) ||
			(stats.frameDropPercent && stats.frameDropPercent > 5) ||
			stats.cpuLimited ||
			stats.gpuLimited
		) {
			peerEntry.classList.add("stats-warn");
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
