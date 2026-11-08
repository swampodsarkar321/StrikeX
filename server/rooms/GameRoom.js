const { Room } = require("@colyseus/core");
const { GameState, Player } = require("../schema/GameState");
const { MapSchema } = require("@colyseus/schema");

const MAX_PLAYERS = 20;
const BOT_NAMES = [
  'VIPER','GHOST','ROGUE','TITAN','NOVA','BLAZE','ECHO','FROST','HAVOC','SLY',
  'REX','ZARA','ONYX','BOLT','WRAITH','SABLE','JINX','KILO','MACE','NYX',
];
const CHAR_IDS = ['swat','adventurer','astronaut','beach','business','casual','farmer','hoodie','king','punk','worker'];

class GameRoom extends Room {
  onCreate(options) {
    const state = new GameState();
    state.players = new MapSchema();
    this.setState(state);
    this.maxClients = MAX_PLAYERS;
    this.state.phase = "lobby";
    this.state.timeLeft = 20;
    this.lobbyTimer = null;
    this.started = false;

    this.onMessage("input", (client, data) => {
      const p = this.state.players.get(client.sessionId);
      if (!p || !p.alive) return;
      if (typeof data.x === "number") p.x = data.x;
      if (typeof data.y === "number") p.y = data.y;
      if (typeof data.z === "number") p.z = data.z;
      if (typeof data.yaw === "number") p.yaw = data.yaw;
      if (typeof data.pitch === "number") p.pitch = data.pitch;
    });

    this.onMessage("shot", (client, data) => {
      // relay shot event to all other clients
      this.broadcast("shot", { shooter: client.sessionId, ...data }, { except: client });
    });

    this.onMessage("damage", (client, data) => {
      const target = this.state.players.get(data.targetId);
      if (!target || !target.alive) return;
      target.health = Math.max(0, target.health - (data.amount || 0));
      if (target.health <= 0) { target.alive = false; }
      this.broadcast("damage", { targetId: data.targetId, amount: data.amount, killer: client.sessionId });
    });

    // lobby countdown
    this.lobbyTimer = this.clock.setInterval(() => {
      if (this.state.phase !== "lobby") return;
      this.state.timeLeft -= 1;
      if (this.state.timeLeft <= 0) {
        this.startMatch();
      }
    }, 1000);
  }

  onJoin(client, options) {
    const p = new Player();
    const requestedName = (options && options.name) ? String(options.name).trim() : "PLAYER";
    p.name = requestedName.slice(0, 16) || "PLAYER";
    p.charId = CHAR_IDS[Math.floor(Math.random() * CHAR_IDS.length)];
    p.isBot = false;
    p.alive = true;
    p.health = 100;
    this.state.players.set(client.sessionId, p);

    // always wait for the matchmaking countdown so real players can join
    // within the 30 second window before bots fill the remaining slots
  }

  onLeave(client) {
    this.state.players.delete(client.sessionId);
  }

  startMatch() {
    if (this.started) return;
    this.started = true;
    if (this.lobbyTimer) { this.lobbyTimer.clear(); this.lobbyTimer = null; }

    // Fill every remaining slot so every match has 20 combatants.
    const humanCount = this.clients.length;
    const botCount = Math.max(0, MAX_PLAYERS - humanCount);
    for (let i = 0; i < botCount; i++) {
      const id = "bot_" + i;
      const p = new Player();
      p.name = BOT_NAMES[i % BOT_NAMES.length];
      p.charId = CHAR_IDS[Math.floor(Math.random() * CHAR_IDS.length)];
      p.isBot = true;
      p.alive = true;
      p.health = 100;
      // random spawn around origin
      const a = Math.random() * Math.PI * 2;
      const r = 20 + Math.random() * 60;
      p.x = Math.cos(a) * r;
      p.z = Math.sin(a) * r;
      p.y = 0;
      this.state.players.set(id, p);
    }

    this.state.phase = "playing";
    this.state.startedAt = Date.now();
    this.state.timeLeft = 0;

    // No late joins into an already-running match: a new 30s lobby must form.
    this.lock();

    // broadcast start
    this.broadcast("matchStart", { playerIds: Array.from(this.state.players.keys()) });

    // bot AI tick
    this.botTimer = this.clock.setInterval(() => {
      if (this.state.phase !== "playing") return;
      this.updateBots();
    }, 200);
  }

  updateBots() {
    const players = Array.from(this.state.players.entries());
    for (const [id, bot] of players) {
      if (!bot.isBot || !bot.alive) continue;
      // find nearest alive human/player
      let target = null, bestD = Infinity;
      for (const [oid, other] of players) {
        if (oid === id || !other.alive) continue;
        const d = Math.hypot(other.x - bot.x, other.z - bot.z);
        if (d < bestD) { bestD = d; target = other; }
      }
      if (target) {
        const dx = target.x - bot.x, dz = target.z - bot.z;
        const len = Math.hypot(dx, dz) || 1;
        bot.x += (dx / len) * 2.5;
        bot.z += (dz / len) * 2.5;
        bot.yaw = Math.atan2(dx, dz);
        // shoot occasionally
        if (Math.random() < 0.05 && bestD < 40) {
          this.broadcast("shot", { shooter: id, dir: { x: dx / len, y: 0, z: dz / len } });
        }
      } else {
        bot.x += (Math.random() - 0.5) * 1;
        bot.z += (Math.random() - 0.5) * 1;
      }
    }
  }

  onDispose() {
    if (this.lobbyTimer) this.lobbyTimer.clear();
    if (this.botTimer) this.botTimer.clear();
  }
}

module.exports = GameRoom;