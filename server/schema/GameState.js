const { schema, t } = require("@colyseus/schema");

const Player = schema({
  x: t.number().default(0),
  y: t.number().default(0),
  z: t.number().default(0),
  yaw: t.number().default(0),
  pitch: t.number().default(0),
  health: t.number().default(100),
  shield: t.number().default(0),
  alive: t.boolean().default(true),
  name: t.string().default("PLAYER"),
  isBot: t.boolean().default(false),
  charId: t.string().default("swat"),
  kills: t.number().default(0),
}, "Player");

const GameState = schema({
  players: t.map(Player),
  phase: t.string().default("lobby"),
  timeLeft: t.number().default(30),
  startedAt: t.number().default(0),
}, "GameState");

module.exports = { GameState, Player };