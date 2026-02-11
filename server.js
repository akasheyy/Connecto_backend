require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const http = require("http");
const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");
const path = require("path");

const auth = require("./middleware/authMiddleware");
const postRoutes = require("./routes/postRoutes");
const userRoutes = require("./routes/userRoutes");
const messageRoutes = require("./routes/messageRoutes");
const notificationRoutes = require("./routes/notificationRoutes");

const app = express();

// -------------------- GLOBAL CORS --------------------
app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "https://connecto-frontend.vercel.app"
    ],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE"]
  })
);

app.use(express.json());

// -------------------- STATIC FILES --------------------
app.use(
  "/uploads/audio",
  express.static(path.join(__dirname, "uploads", "audio"))
);

app.use("/uploads1", express.static(path.join(__dirname, "uploads1")));

// -------------------- DATABASE --------------------
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB Connected Successfully"))
  .catch((err) => console.log("DB Error:", err));

// -------------------- ROUTES --------------------
// -------------------- ROUTES --------------------
app.get("/", (req, res) => {
  res.send("Backend running...");
});

app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/posts", auth, postRoutes);
app.use("/api/user", auth, userRoutes);
app.use("/api/messages", auth, messageRoutes);        // ✅ REQUIRED
app.use("/api/notifications", auth, notificationRoutes); // ✅ REQUIRED



// -------------------- SOCKET SERVER --------------------
const server = http.createServer(app);

const allowedOrigins = [
  "http://localhost:3000",
  "https://connecto-frontend.vercel.app"
];

app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    credentials: true
  }
});


// Make io available inside routes
app.set("io", io);

// -------------------- SOCKET AUTH --------------------
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error("Token missing"));

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = decoded.id || decoded.userId;
    next();
  } catch (err) {
    next(new Error("Invalid Token"));
  }
});

// -------------------- SOCKET EVENTS --------------------
io.on("connection", (socket) => {
  console.log("User connected:", socket.userId);

  // join personal room
  socket.join(socket.userId);

  // Mark user online (you can listen on frontend if you want)
  io.emit("user_online", { userId: socket.userId });

 /* ===================================================
   SEND TEXT MESSAGE + DELIVERED TICK + NOTIFICATION
=================================================== */
socket.on("send_message", async ({ to, text }) => {
  try {
    const Message = require("./models/Message");

    // 1. create as "sent"
    let msg = await Message.create({
      sender: socket.userId,
      receiver: to,
      text,
      status: "sent"
    });

    // 2. deliver message to both sender & receiver
    io.to(to).to(socket.userId).emit("new_message", msg);

    // 3. immediately mark as delivered
    msg.status = "delivered";
    await msg.save();

    // 4. send delivered event to update ticks
    io.to(socket.userId).to(to).emit("message_delivered", {
      messageId: msg._id
    });

    // 5. 🔔 real-time notification to receiver
    const Notification = require("./models/Notification");
    await Notification.create({
      type: "message",
      fromUserId: socket.userId,
      toUserId: to,
      messageId: msg._id,
      text: msg.text
    });

    io.to(to).emit("notification", {
      type: "message",
      fromUserId: socket.userId,
      toUserId: to,
      text: msg.text,
      createdAt: msg.createdAt,
      messageId: msg._id
    });
  } catch (err) {
    console.log("Message send error:", err);
  }
});

  /* ===================================================
     TYPING INDICATOR
  =================================================== */
  socket.on("typing", ({ to }) => {
    if (!to) return;
    io.to(to).emit("typing", { from: socket.userId });
  });

  socket.on("stop_typing", ({ to }) => {
    if (!to) return;
    io.to(to).emit("stop_typing", { from: socket.userId });
  });

  /* ===================================================
     DISCONNECT EVENT
  =================================================== */
  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.userId);
    io.emit("user_offline", {
      userId: socket.userId,
      lastSeen: new Date()
    });
  });
  socket.on("seen_chat", async ({ from }) => {
  try {
    const Message = require("./models/Message");

    // all messages that THIS user received from "from"
    const unread = await Message.find({
      sender: from,
      receiver: socket.userId,
      status: { $ne: "seen" }
    });

    const ids = unread.map(m => m._id);

    // mark as seen
    await Message.updateMany(
      { _id: { $in: ids } },
      { status: "seen", seenAt: new Date() }
    );

    // send to the sender (so sender sees blue tick)
    io.to(from).emit("messages_seen", ids);

  } catch (err) {
    console.log("Seen update error:", err);
  }
});

/* ===================================================
   SHARE POST IN CHAT
=================================================== */
socket.on("share_post", async ({ to, postId }) => {
  try {
    const Message = require("./models/Message");

    // Create special message type: shared post
    let msg = await Message.create({
      sender: socket.userId,
      receiver: to,
      sharedPost: postId, // we only store ID
      type: "shared_post",
      status: "sent"
    });

    // Push message to both users
    io.to(to).to(socket.userId).emit("new_message", msg);

    // Mark delivered immediately
    msg.status = "delivered";
    await msg.save();

    // send delivered update
    io.to(to).to(socket.userId).emit("message_delivered", {
      messageId: msg._id
    });

  } catch (err) {
    console.log("Share post error:", err);
  }
});

});

// -------------------- START SERVER --------------------
const PORT = process.env.PORT || 5000;
server.listen(PORT, () =>
  console.log(`Server running on port ${PORT}`)
);
