# psychosis.live

A simple WebRTC-based streaming tool which lets you send end-to-end encrypted video feeds from a browser to OBS. This tool is primarily designed for mobile streaming, and is intended to be very resilient to poor quality connections.

The goal of this tool is to let you stream anything from anywhere with an internet connection. However, to keep things practical, the following is essentially required for a *usable* experience (assuming default settings & mono audio):
- Sender:
	- Download speed > 50 kbit/s
		- Download speed > 100 kbit/s recommended
	- Upload speed > 150 kbit/s
		- Upload speed > 300 kbit/s recommended
- Receiver:
	- Download speed > 150 kbit/s
		- Download speed > 400 kbit/s recommended
	- Upload speed > 50 kbit/s
		- Upload speed > 100 kbit/s recommended
- Packet loss < 10%
	- Packet loss < 2% recommended
	- Packet loss of 10% - 25% *may* be usable if there is high enough bandwidth and low enough latency
	- If packet loss is bursty rather than constant, resiliency can be improved by increasing the `jitterBufferTarget` at the expense of worse adaptation to changes in network conditions
- Round-trip time < 400ms (if packet loss > 0%) between sender and receiver
	- Latencies of up to 2500ms can be supported by increasing the `jitterBufferTarget` at the expense of worse adaptation to changes in network conditions

Further documentation is available on the application's website.

## Building
```bash
bun install
bun build --compile --target=browser ./index.html --outdir=dist --minify-whitespace --minify-syntax
```

## todo

### low priority
- [ ] receiver performance monitoring using [VideoPlaybackQuality](https://developer.mozilla.org/en-US/docs/Web/API/VideoPlaybackQuality)
- [ ] warn if `overrideScaler` is causing performance issues on sender or receiver
- [ ] add on-screen RMS+clipping warning volume meter
- [ ] display information (resolution, framerate, channel count, sample rate) about video/audio tracks in sender UI if showStats is enabled

### far future ideas
- [ ] update WebRTC Opus to 1.6
	- [ ] get [DRED](https://opus-codec.org/demo/opus-1.5/) working
	- [ ] get [DeepPLC](https://opus-codec.org/demo/opus-1.5/) working
	- [ ] get [NoLACE](https://opus-codec.org/demo/opus-1.5/) working
	- [ ] get [BWE](https://opus-codec.org/demo/opus-1.6/) working
- [ ] make native app implementation
	- [ ] tweak WebRTC congestion control algorithm for this specific use case
- [ ] implement remote monitoring of peer metrics (viewing receiver metrics on sender and sender metrics on receiver)
- [ ] switch to MoQ when it's ready
	- [ ] implement QUIC multipath draft
