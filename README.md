# psychosis.live

> You have to be insane to think you can livestream from *there*.

A simple WebRTC-based streaming tool for resiliently sending end-to-end encrypted video feeds from a browser to OBS.

This tool aims to be as resilient as possible to low-quality and/or unreliable connections, with the goal of pushing single-uplink livestreaming right up to the edge of what's possible.

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
