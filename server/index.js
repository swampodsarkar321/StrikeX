const { Server } = require("@colyseus/core");
const { WebSocketTransport } = require("@colyseus/ws-transport");
const { monitor } = require("@colyseus/monitor");
const GameRoom = require("./rooms/GameRoom");

const port = process.env.PORT || 2569;
const server = new Server({
  transport: new WebSocketTransport(),
});

server.define("game", GameRoom);

server.listen(port);
console.log("Colyseus server listening on ws://localhost:" + port);

// monitor disabled to avoid port conflicts; enable in development if needed.