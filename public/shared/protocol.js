// Message type constants shared by the display and phone clients.
// Loaded via a plain <script> tag on both pages (no bundler / no modules).
var PROTOCOL = {
  MSG_AIM: 'aim',
  MSG_FIRE: 'fire',
  MSG_SESSION_READY: 'session_ready',
  MSG_PEER_DISCONNECTED: 'peer_disconnected',
  MSG_SESSION_ERROR: 'session_error',
  MSG_CALIBRATED: 'calibrated', // sent once, the first time the phone finishes calibration
  MSG_AMMO_STATUS: 'ammo_status', // phone -> display, sent on empty/reload transitions: { empty }

  // --- Multiplayer (up to PLAYER_COLORS.length phones per session) ---
  MSG_PLAYER_ASSIGNED: 'player_assigned', // server -> phone, once, right after it joins: { playerId }
  MSG_PLAYER_JOINED: 'player_joined',     // server -> display, broadcast when any phone joins: { playerId }
  MSG_PLAYER_LEFT: 'player_left',         // server -> display, broadcast when a phone disconnects: { playerId }
  MSG_YOU_ARE_OUT: 'you_are_out',         // display -> one phone (targetPlayerId): out of lives, spectating
  MSG_ROUND_STARTED: 'round_started',     // display -> all phones, broadcast: a fresh round just began
  MSG_ROUND_ENDED: 'round_ended',         // display -> all phones, broadcast: { result: 'cleared'|'game_over' }

  // Colors are assigned by playerId (1-indexed) mod this array's length --
  // deterministic on both display and phone without the server needing to
  // know or transmit anything about color.
  PLAYER_COLORS: ['#ff4d4d', '#4da3ff', '#4dff88', '#ffd24d'],
  MAX_PLAYERS: 4,

  LOGICAL_WIDTH: 1280,
  LOGICAL_HEIGHT: 720
};
