# inksplat — Manual testing

Automated tests run on one machine with a fake tracker. These checks need real
networks and are done before a release. Record the date, browsers and result
in the release notes.

## Setup

Two machines (or one machine and a phone) on **different networks**, the
presenter on Chrome.

## Checklist

| # | Check | Expected |
|---|-------|----------|
| 1 | Presenter starts a share and copies the link; viewer opens it | Viewer joins within ~10 s; presenter sees one viewer |
| 2 | Public trackers: block all but one in settings, retry | Still joins |
| 3 | Block all trackers (offline DNS) | Viewer shows `no-tracker` after ~30 s; manual codes join |
| 4 | Viewer on a phone hotspot (symmetric NAT likely) | Joins, or reports `ice-failed`; with TURN configured it joins and `path` is `relay` |
| 5 | Viewer behind a corporate proxy blocking `wss` | Reports `no-tracker`; manual codes work |
| 6 | Viewer on Firefox, Safari (macOS and iOS), Chrome Android | Video plays, drawing works |
| 7 | 10 viewers at the default 3 fps / 600 kbps | No link drops in 5 minutes; presenter uplink about 6 Mbps |
| 8 | Presenter closes the laptop lid for 20 s, reopens | Viewers reconnect or see "presenter left" after 60 s |
| 9 | Presenter locks viewers' drawing | Viewers' tools disable; a modified client's strokes are dropped |
| 10 | Presenter generates a new link | Old link no longer joins; current viewers stay |
| 11 | Tracker view: inspect the tracker's traffic | Only opaque sealed payloads; no token, no SDP |
| 12 | On `present.html`, **Start session**, **Share screen** and pick a tab | The page shows the tab's video with the board on top; the shared tab shows nothing extra; the viewer link is given |
| 13 | Draw on the presenter page with a mouse, and with a pen or touch (a tablet) | Strokes appear on viewers' screens at once; the video follows a moment later |
| 14 | Resize the shared window, or change its zoom | The viewers' video takes the new shape within a few seconds; drawings keep their place on screen |
| 15 | Share a tab, then navigate it to another site | The share goes on |
| 16 | Share a page that plays video or animates | Frame rate stays near the setting; the presenter's CPU stays reasonable |
| 17 | Reload the presenter page | The session ends (viewers see "presenter left"); **Start session** makes a new link |
| 18 | Keep the presenter page in the background while the shared window is in front | Viewers keep getting frames |
| 20 | Viewer on a network that blocks the tracker, joining with a code | The code, the answer and Connect work; video and drawing follow |
| 21 | Viewer with a screen reader and keyboard only | Join form, toolbar and people list are reachable and named |
| 22 | Share a page full of small text (a code editor, a document) on a 1440p or 4K screen, and a HiDPI laptop | The viewer reads the text at full size within a second or two of the page going still; moving content may be soft meanwhile |
| 23 | Open `present.html`, **Start session**, **Share screen**, pick a tab / a window / a whole screen / a native app | The picker offers all four and not the presenter page's own tab; a viewer joins and sees the choice; sharing a whole screen shows the "whole screen" warning |
| 24 | Presenter page: share a still window (nothing moving), then join a viewer after a minute | The late viewer gets a first frame within a few seconds |
| 25 | Presenter page: put the page in the background (shared window in front) for 5 minutes while the shared window animates | Viewers keep getting frames at about the set rate; their drawings still reach the page |
| 26 | Presenter page: click the browser's "Stop sharing", then **Share screen** again | Viewers see black, then (the new stream goes on screen when nothing else is) the new source on the same link |
| 27 | Presenter page: Settings, mouse pointer **Hidden**, then share a window and move the mouse over it | Viewers do not see the pointer; "Always shown" brings it back at the next **Share screen** |
| 28 | Fold **Tools** and **Controls** on the presenter page, and **Tools** on the viewer; reload | The toolbar and panel stay out of the way and come back with their buttons; the choice is remembered |
| 29 | On a viewer and on the presenter page press 2, 2, 2, 2, then 3, 3 and 4, 4, 6 | The line goes thin/normal/thick, text small/medium/large, the sticker and colour change; the toolbar icons show the choice |
| 30 | Draw a line and a sticker, drag them, right click them, then click each and press Delete; try a locked one | Right click does nothing to them; Delete removes the selected one; a locked one stays. Shift+drag scales and Ctrl+drag turns a sticker; a note, picture or link turns about its pin |
| 31 | Drop a photo from the file manager on the board (viewer and presenter); move, turn, delete it | It appears for everyone, and late joiners see it |
| 32 | Wheel over a spot of a busy video, draw, zoom out | The zoom is centred on the pointer; drawings stay on the same part of the picture |
| 33 | Two viewers with different tools and one with an avatar | Others see each tool's cursor shape; the avatar replaces the name |
| 34 | Three people ask for a turn; the first ends it; the presenter removes the second | The queue in the lower left updates everywhere; the speaker's cursor is larger, with a pulsing border on its name tag or avatar |
| 35 | Set the link lifetime to 1 minute, start, wait, try to join | The page says the link expired and the join fails; **New link** works for a new viewer |
| 36 | **Start session** without sharing; a viewer joins; both go through the canvases; the presenter changes the background of one | Canvas 1 is the black screen ("Nothing is being shared" for the presenter only), canvases 2 to 5 whiteboard, blackboard, wall, cork; the change shows on that canvas only, on both |
| 37 | Drop a photo, a PDF, a zip, a text file and a 10 MB file on the board | The first four are pinned (border, shadow, pin) with previews; the big one is refused with a message |
| 38 | On a viewer, Shift+drag a pinned PDF onto the desktop, a folder, and a mail or chat web page; double click another | A copy with the right name and contents lands (the desktop and folder in Chrome or Edge; web pages in Chrome and Firefox); double click downloads it |
| 39 | Join a viewer after files were pinned | The late viewer sees the prints and can drag the files out within a few seconds |
| 40 | Drop a PDF, a .docx, a .pptx and an .xlsx on the board | The cards show the first page of the PDF and the thumbnail or the first lines of the others; an old .doc shows only the card |
| 41 | Presenter controls: **QR code**; scan it with an iPad or phone camera | The device opens the viewer link and joins; **Copy image** pastes a QR image into a chat or document |
| 42 | Press 6 repeatedly and draw with white on the blackboard and on the whiteboard | The eighth colour is white; it is visible on the blackboard, and white text has a dark outline on light backgrounds |
| 43 | Pin a file and a picture on the board | each sits a few degrees tilted (at most 7), a different angle each time |
| 44 | Copy a web address and press Ctrl+V on the board, or drag one from another tab | a card with the site name and path appears; on a viewer, clicking it opens the page in a new tab; hovering shows the full address |
| 45 | Choose the wall and cork backgrounds | plaster with soft shading and a rough surface; cork with grain and a wooden frame |
| 46 | Press 6 and click the board; type; click away. Drag the note, drag its corner, select it and press Delete | the note keeps the text, moves, resizes from its bottom right corner and disappears |
| 47 | On another device, double click the note, then paste in a text editor | the text of the note is pasted; the other device cannot edit, move or delete the note |
| 48 | Press 6 repeatedly and add notes; select one and use the bar over it | the shapes cycle (square, rounded, oval, diamond, hexagon); the bar changes the shape and the colour of the selected note; the text stays centred and inside |
| 49 | Press 7 and click; press 8, press on a pin and drag to another | a pin appears; a hanging thread with a shadow ties the two pins and follows them when they are dragged |
| 50 | Press 8 again, tie more threads; select one; press Delete | heads cycle none, source, destination, both; the bar changes colour and heads; Delete removes it; removing a pin removes its threads |
| 51 | With a stream on the screen, draw something and press **Save...**, then PNG and SVG | the files show the video frame with the drawing over it; the SVG opens in a browser and in a vector editor |
| 52 | Save a board file with a pinned PDF and a photo, open the `.inksplat.zip` with the system's zip tool, close the session, start a new one, then **Open...** the file (also as a viewer, if allowed to draw) | notes, threads, pictures and the pinned file come back as yours; others can drag the file out; the canvases get their backgrounds back; the zip shows `manifest.json`, `settings.json`, `canvas-1.json` to `canvas-5.json`, the photo in `images/` and the PDF in `files/`, all readable |
| 53 | Put a pin on a note, a picture and a sticker; move, turn and scale them; tie a thread to the pins | the pins stay where they were put on each, threads follow; deleting the item takes its pins and threads |
| 54 | With the pointer, note and text tools in turn Shift+press on a pin and drag to another | a thread is tied, the tool you had is selected again on release; a plain drag moves the pin instead; a click on a pin with threads selects the pin |
| 55 | Draw lines and text, pin a note and a file; press **Clear drawings**, then **Clear all** | only the drawings go the first time, everything the second, for every viewer |
| 56 | Click the line, text, sticker, note, thread and colour tools in the toolbar | each opens a panel with all its options (line widths, text sizes, stickers, shapes, heads, colours); choosing one closes it; the pointer, eraser and pin only select |
| 57 | As a viewer who can draw, move, edit and delete the presenter's note, thread and pin | all work (not on a picture or file: dragging it copies it out) |
| 58 | As the presenter select the note and press the lock twice; as the viewer try to move, edit, delete and erase it | after the first press (grey padlock) only the presenter can; after the second (red) nobody, not even the presenter, until unlocked; the viewer sees the message and can still copy the text from the bar |
| 59 | Choose small, medium and large text in a note's bar | the text size changes for everybody, the text re-wraps, and the box being written in follows |
| 60 | Select a note, a pin and a thread in turn and press Delete | each goes (a pin takes its threads with it); on a locked element nothing goes and the message shows |
| 61 | Select a pin attached to a note, then move the note | the bar sits over the pin where it is drawn and follows it |
| 62 | Make an oval, a diamond and a hexagon note; pull the grip near the bottom right inside each | each grows, stays selected, the grip is on the shape |
| 63 | Drag a note by its pin onto a bigger note, then move, resize and turn the bigger one; drag the small one by its pin off | the small one is on top and goes, scales and turns with the big one; off it stays where dropped; while dragging by the pin a ring is on the pin and the element it would attach to has a dashed outline |
| 64 | With two people, put a note on canvas 1, go to canvas 3 with the round buttons at the top and draw; the other stays on 1 | Your canvas 3 has only your drawing; the button of 3 shows 1 person and the other's 1 person; you do not see their cursor until you both are on the same canvas; Clear on 3 leaves canvas 1; saving a board file and opening it restores every canvas |
| 65 | Click the pin tool, choose a star, put a pin down; press 7 again and put another; select the first and change its shape and colour from the bar | The panel lists five shapes; each pin is drawn in its shape, threads still tie to its centre |
| 66 | Share a window; a viewer joins; both go through the canvases; on canvas 3 the presenter picks **Screen**, on canvas 1 **Cork board** | Canvas 1 shows the screen, 2 to 5 whiteboard, blackboard, wall, cork; then canvas 3 shows the video and canvas 1 the cork, on both; drawings stay in place |
| 67 | Put a bare pin down, then drag it over a note, a picture, a link and a sticker, and off them | Each one it is over has a dashed outline, which goes when the pin leaves it or is dropped; dropped on one it stays on it |
| 68 | On the presenter page in Chrome, Firefox and Safari, draw, then close the tab (and, separately, reload it); confirm; start a new session | The browser asks before leaving; the new session asks to resume, **Resume** brings the board back with its backgrounds and files, **Start new** leaves it empty and the next session does not ask |
| 19 | **None**, **Show**, clear and end from the presenter page | Viewers see black, the video, an empty board and the end message |
| 69 | A viewer on Chrome (desktop) presses **Share screen**, reads the notice, picks a window | The presenter is told and lists it under **Screen**; nobody else sees it; the viewer reads "The presenter can show your screen"; its upload stays near zero until the presenter asks |
| 70 | Presenter: **Preview** that stream, then **Show** it | The preview plays in the controls only, the viewer reads "looking at your screen"; then everybody sees it and the viewer reads "On screen for everybody" and sees its own capture without delay |
| 71 | Two viewers on different networks share; the presenter switches between them, its own, and **None** | Each switch shows the new stream within about a second for everyone; **None** is black; the drawings keep their place whatever the stream's shape |
| 72 | Compare the delay of a viewer's stream seen by another viewer with the presenter in Chrome (forwarded) and in Firefox or Safari (re-encoded) | Forwarded: about the network delay of two links; the presenter's CPU barely rises while forwarding |
| 73 | One watching viewer on a lossy network (or throttled) while a viewer's stream is on screen | The lossy viewer recovers within a few seconds; the others are not affected beyond an occasional key frame |
| 74 | A viewer on a phone | No **Share screen** button; watching and drawing work |
| 75 | The viewer whose stream is on the screen closes its tab, or is removed | The screen goes black for everybody at once; the stream leaves the presenter's list |
| 76 | With the pointer, drag from an empty place over two stickers, a line and a note; drag one; pick a colour in the bar; Ctrl+C, move, Ctrl+V; Delete | All four are outlined and the bar says "4 selected"; all move together; the line and note change colour; the copies appear at the pointer, selected, on the viewer too; Delete removes them |

## Known untested areas (from nymph)

Public trackers over time, real NATs, Firefox, Safari, phones and TURN: these
are what this checklist covers.
