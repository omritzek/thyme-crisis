// Message type constants shared by the display and phone clients.
// Loaded via a plain <script> tag on both pages (no bundler / no modules).
var PROTOCOL = {
  MSG_AIM: 'aim',
  MSG_FIRE: 'fire',
  MSG_SESSION_READY: 'session_ready',
  MSG_MARKER_LAYOUT: 'marker_layout',
  MSG_PHONE_CONNECTED: 'phone_connected',
  MSG_DISPLAY_CONNECTED: 'display_connected',
  MSG_PEER_DISCONNECTED: 'peer_disconnected',
  MSG_SESSION_ERROR: 'session_error',

  LOGICAL_WIDTH: 1280,
  LOGICAL_HEIGHT: 720,
  MARKER_SIZE: 80,
  MARKER_INSET: 40,

  MARKER_COLORS: {
    tl: '#FF0000',
    tr: '#00FF00',
    bl: '#0000FF',
    br: '#FFFF00'
  }
};

function protocolMarkerRects() {
  var w = PROTOCOL.LOGICAL_WIDTH;
  var h = PROTOCOL.LOGICAL_HEIGHT;
  var s = PROTOCOL.MARKER_SIZE;
  var inset = PROTOCOL.MARKER_INSET;
  return {
    tl: { x: inset, y: inset, w: s, h: s },
    tr: { x: w - inset - s, y: inset, w: s, h: s },
    bl: { x: inset, y: h - inset - s, w: s, h: s },
    br: { x: w - inset - s, y: h - inset - s, w: s, h: s }
  };
}

function protocolMarkerLayout() {
  var rects = protocolMarkerRects();
  var markers = Object.keys(rects).map(function (id) {
    var r = rects[id];
    return { id: id, xPx: r.x + r.w / 2, yPx: r.y + r.h / 2 };
  });
  return {
    type: PROTOCOL.MSG_MARKER_LAYOUT,
    width: PROTOCOL.LOGICAL_WIDTH,
    height: PROTOCOL.LOGICAL_HEIGHT,
    markers: markers
  };
}
