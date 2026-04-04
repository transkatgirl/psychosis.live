# psychosis.live
A smartphone to OBS streaming tool that lets you stream from anywhere with internet

## building
```bash
bun install
bun build --target=browser ./index.html --outdir=dist
```

## todo
- [ ] add URL options for STUN and TURN servers
- [ ] real-world network testing
- [ ] add URL options for all MediaDevice constraints
- [ ] build sender UI