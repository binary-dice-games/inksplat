# inksplat — Privacy

The privacy policy is a web page: it is published with the viewer at `privacy.html` and its source is
[viewer/src/site/privacy.html](../viewer/src/site/privacy.html).

In short: no accounts, no analytics, no data sent to the developer, nothing recorded or
stored after a session. The shared picture and the drawings go directly between
the people in the session. Network addresses are seen by the other side of a connection,
by the public WebTorrent trackers used to introduce people (which cannot read the link,
the video or the drawings) and by the STUN servers.

As a Google Meet add-on, the introductions go through Meet instead of the trackers: Google
sees sealed messages it cannot read (the room key is in the activity's starting data, which
Google stores for the call). Video and drawings still go directly between the participants.
