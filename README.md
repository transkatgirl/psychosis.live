# psychosis.live
A smartphone to OBS streaming tool that lets you stream from anywhere with internet

## building
```bash
bun install
bun build --compile --target=browser ./index.html --outdir=dist --minify-whitespace --minify-syntax
```

## todo
- [ ] add on-screen RMS+clipping warning volume meter
- [ ] add support for interactively selecting [https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints#instance_properties_of_image_tracks](image constraints)