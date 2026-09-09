const WebSocket = require("ws");
const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({
  port: PORT
});
const server = http.createServer((req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/plain"
  });

  res.end("Anonymous Chat Room WebSocket Server is running");
});
wss.on("listening", () => {
  console.log(`Anonymous Chat Room WebSocket server running on port ${PORT}`);
});


wss.on("error", (err) => {
  console.error("WebSocket server error:", err);
});
// Online users only. Nothing is written to a database/file.
const users = new Map(); // socket -> user
const rooms = new Map([["general", new Set()]]);

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function broadcast(roomId, data, except = null) {
  const room = rooms.get(roomId);
  if (!room) return;

  for (const client of room) {
    if (client !== except) send(client, data);
  }
}

function getOnlineUsers() {
  return [...users.values()].map(u => ({
    id: u.id,
    name: u.name,
    phone: u.phone || "",
    avatar: u.avatar || ""
  }));
}

function broadcastPresence() {
  for (const client of users.keys()) {
    send(client, { type: "online_users", users: getOnlineUsers() });
  }
}

function removeFromRooms(ws) {
  for (const [roomId, members] of rooms) {
    members.delete(ws);
    if (members.size === 0 && roomId !== "general") {
      rooms.delete(roomId);
    }
  }
}

function safeUser(user) {
  return {
    id: user.id,
    name: user.name,
    phone: user.phone || "",
    avatar: user.avatar || ""
  };
}

wss.on("connection", ws => {
  console.log("Client connected");

  ws.on("message", raw => {
    let data;
    try {
      data = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (data.type) {
      case "join": {
        const id = String(data.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`);
        const name = String(data.name || "Anonymous").trim().slice(0, 40) || "Anonymous";
        const phone = String(data.phone || "").trim().slice(0, 20);
        const avatar = typeof data.avatar === "string" ? data.avatar.slice(0, 300000) : "";

        const user = { id, name, phone, avatar };
        users.set(ws, user);
        rooms.get("general").add(ws);

        send(ws, {
          type: "joined",
          user: safeUser(user),
          users: getOnlineUsers()
        });

        broadcast("general", {
          type: "system",
          text: `${name} is online`,
          event: "online",
          user: safeUser(user),
          time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        }, ws);

        broadcastPresence();
        break;
      }

      case "message": {
        const user = users.get(ws);
        if (!user) return;

        const text = String(data.text || "").trim();
        if (!text) return;

        const payload = {
          type: "message",
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          from: safeUser(user),
          text: text.slice(0, 4000),
          time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        };

        // Send to everyone in the room, including sender.
        broadcast("general", payload);
        send(ws, payload);
        break;
      }

      case "typing": {
        const user = users.get(ws);
        if (!user) return;

        broadcast("general", {
          type: "typing",
          user: safeUser(user),
          isTyping: Boolean(data.isTyping)
        }, ws);
        break;
      }

      case "profile_update": {
        const user = users.get(ws);
        if (!user) return;

        if (typeof data.name === "string") {
          user.name = data.name.trim().slice(0, 40) || user.name;
        }
        if (typeof data.phone === "string") {
          user.phone = data.phone.trim().slice(0, 20);
        }
        if (typeof data.avatar === "string") {
          user.avatar = data.avatar.slice(0, 300000);
        }

        send(ws, { type: "profile_updated", user: safeUser(user) });

        // Tell the chat about the changed display name.
        broadcast("general", {
          type: "system",
          text: `${user.name} updated their profile`,
          event: "profile_update",
          user: safeUser(user),
          time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        }, ws);

        broadcastPresence();
        break;
      }

      case "profile_delete_avatar": {
        const user = users.get(ws);
        if (!user) return;

        user.avatar = "";
        send(ws, { type: "profile_updated", user: safeUser(user) });
        broadcastPresence();
        break;
      }

      case "leave": {
        ws.close(1000, "User left");
        break;
      }

      default:
        break;
    }
  });

  ws.on("close", () => {
    const user = users.get(ws);
    if (!user) return;

    removeFromRooms(ws);
    users.delete(ws);

    broadcast("general", {
      type: "system",
      text: `${user.name} is offline`,
      event: "offline",
      user: safeUser(user),
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    });

    broadcastPresence();
    console.log(`${user.name} disconnected`);
  });

  ws.on("error", err => console.error("WebSocket error:", err.message));
});

console.log(`Anonymous Chat Room WebSocket server running on port ${PORT}`);
