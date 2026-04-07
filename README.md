# psychosis.live

A simple WebRTC-based streaming tool which lets you send end-to-end encrypted video feeds from a browser to OBS. This tool is primarily designed for mobile streaming, and is intended to be very resilient to poor quality connections.

The goal of this app is to let you stream anything from anywhere with an internet connection. However, to keep things practical, the following is required for a bare-minimum *usable* experience:
- Sender:
	- Download speed > 50 kbit/s
		- Download speed > 100 kbit/s recommended
	- Upload speed > 150 kbit/s
		- Upload speed > 300 kbit/s recommended
- Receiver:
	- Download speed > 150 kbit/s
		- Download speed > 300 kbit/s recommended
	- Upload speed > 50 kbit/s
		- Upload speed > 100 kbit/s recommended
- Packet loss < 10%
	- Packet loss < 2% recommended
	- Packet loss of 10% - 20% *may* be usable if there is high enough bandwidth and low enough latency
	- If packet loss is bursty rather than constant, resiliency can be improved by increasing the `jitterBufferTarget` at the expense of worse adaptation to changes in network conditions
- Round-trip time < 500ms (if packet loss > 0%)
	- Latencies of up to 2500ms can be supported by increasing the `jitterBufferTarget` at the expense of worse adaptation to changes in network conditions

Further documentation is available on the application's website.

## Building
```bash
bun install
bun build --compile --target=browser ./index.html --outdir=dist --minify-whitespace --minify-syntax
```

## todo
- [ ] add on-screen RMS+clipping warning volume meter