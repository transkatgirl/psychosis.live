# psychosis.live

> You have to be insane to think you can livestream from *there*.

A WebRTC-based streaming tool for sending low-latency end-to-end encrypted video feeds from a browser to OBS.

This tool aims to be as resilient as possible to low-quality and/or unreliable connections while maintaining very low latency, with the goal of pushing single-uplink livestreaming right up to the edge of what's possible.

Further documentation is available on the application's website. Make sure to read the known issues, especially if you plan on using a mobile browser.

(Keep in mind that this is only one part of an IRL streaming setup. transkatgirl's [stream-tool.html](https://github.com/transkatgirl/transkatgirl.github.io/blob/main/stream-tool.html) is a good example of an IRL streaming sender using psychosis.live & socialstreamninja)

## Building
```bash
bun install
bun build --compile --target=browser ./index.html --outdir=dist --minify-whitespace --minify-syntax
```

## todo

### low priority
- [ ] update jitterBufferTarget based on rolling window using (2 * RTT + jitter) if calculated value is larger than user-chosen target
	- how large should the rolling window be?
	- what hysteresis thresholds should be used?
- [ ] add on-screen RMS+clipping warning volume meter
- [ ] display information (resolution, framerate, channel count, sample rate) about video/audio tracks in sender/receiver UI if showStats is enabled

### future ideas
- [ ] if Chromium takes too long to fix bugs in getUserMedia() and enumerateDevices(), submit patches to upstream
- [ ] wait for libwebrtc to support Opus 1.6 or submit patches to support it
	- [ ] get [DRED](https://opus-codec.org/demo/opus-1.5/) working
	- [ ] get [DeepPLC](https://opus-codec.org/demo/opus-1.5/) working
	- [ ] get [NoLACE](https://opus-codec.org/demo/opus-1.5/) working
	- [ ] get [BWE](https://opus-codec.org/demo/opus-1.6/) working
	- [ ] patch Chromium to use latest libwebrtc w/ Opus 1.6 support