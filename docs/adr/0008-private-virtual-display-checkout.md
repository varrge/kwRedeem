# Run production checkout Chrome on a private virtual display

Status: accepted

Production Session Cookie checks showed the same valid Session and Singapore proxy returning authenticated HTTP `200` outside Chrome, strict headless Chrome returning `403`, and Chrome on the server's private Xvfb display returning authenticated `200`. A later six-variant comparison further showed Chromedp's broad default launch-flag set returning `403`, while the reviewed minimal Xvfb profile returned authenticated `200`. Production therefore uses that minimal visible profile with a new temporary user-data directory for every execution, extensions and sync disabled, and the existing Singapore proxy. The browser remains unattended and isolated: this decision adds no extension, Node dispatch, account-password handling, public VNC access, operator checkout step, security-challenge bypass, or change to the durable payment Gate and permit boundaries.
