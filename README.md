# psychosis.live
A smartphone to OBS streaming tool that lets you stream from anywhere with internet

## building
```bash
bun install
bun build --compile --target=browser ./index.html --outdir=dist --minify-whitespace
```

## todo
- [ ] real-world network testing
- [ ] add URL options for all MediaDevice constraints
- [ ] build sender UI