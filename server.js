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

// ✅ IMPORTANT (YOU MISSED THIS)
const pushRoutes = require("./utils/pushRoutes");

const app = express();

/* =========================================================
   CORS (ONLY ONCE ✅ FIXED)
========================================================= */
const allowedOrigins = [
  "http://localhost:3000",
  "https://connecto-frontend.vercel.app"
];

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE"]
  })
);

app.use(express.json());

/* =========================================================
   STATIC FILES
========================================================= */
app.use(
  "/uploads/audio",
  express.static(path.join(__dirname, "uploads", "audio"))
);

app.use("/uploads1", express.static(path.join(__dirname, "uploads1")));

/* =========================================================
   DATABASE
========================================================= */
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB Connected Successfully ✅"))
  .catch((err) => console.log("DB Error:", err));

/* =========================================================
   ROUTES
========================================================= */
app.get("/", (req, res) => {
  res.send("Backend running...");
});

app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/posts", auth, postRoutes);
app.use("/api/user", auth, userRoutes);
app.use("/api/messages", auth, messageRoutes);
app.use("/api/notifications", auth, notificationRoutes);

// ✅ PUSH ROUTES
app.use("/api/push", pushRoutes);

/* =========================================================
   SOCKET SERVER
========================================================= */
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    credentials: true
  }
});

// Make io available everywhere
app.set("io", io);

/* =========================================================
   SOCKET AUTH
========================================================= */
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

/* =========================================================
   SOCKET EVENTS
========================================================= */
io.on("connection", (socket) => {
  console.log("User connected:", socket.userId);

  socket.join(socket.userId);

  io.emit("user_online", { userId: socket.userId });

  /* ================= SEND TEXT MESSAGE ================= */
  socket.on("send_message", async ({ to, text }) => {
    try {
      const Message = require("./models/Message");
      const Notification = require("./models/Notification");
      const User = require("./models/User");

      let msg = await Message.create({
        sender: socket.userId,
        receiver: to,
        text,
        status: "sent"
      });

      // Send instantly
      io.to(to).to(socket.userId).emit("new_message", msg);

      // Delivered tick
      msg.status = "delivered";
      await msg.save();

      io.to(to).to(socket.userId).emit("message_delivered", {
        messageId: msg._id
      });

      /* ================= NOTIFICATION LOGIC ================= */

      // ✅ Prevent spam notifications 🔥
      const existingUnread = await Notification.findOne({
        toUserId: to,
        fromUserId: socket.userId,
        type: "message",
        read: false
      });

      if (!existingUnread) {
        await Notification.create({
          type: "message",
          fromUserId: socket.userId,
          toUserId: to,
          messageId: msg._id,
          text: msg.text
        });

        // Fetch sender's username for notification
        const sender = await User.findById(socket.userId).select("username");

        io.to(to).emit("new_message_notification", {
          senderName: sender.username,
          text: msg.text
        });
      }

    } catch (err) {
      console.log("Message send error:", err);
    }
  });

  /* ================= TYPING ================= */
  socket.on("typing", ({ to }) => {
    if (!to) return;
    io.to(to).emit("typing", { from: socket.userId });
  });

  socket.on("stop_typing", ({ to }) => {
    if (!to) return;
    io.to(to).emit("stop_typing", { from: socket.userId });
  });

  /* ================= SEEN ================= */
  socket.on("seen_chat", async ({ from }) => {
    try {
      const Message = require("./models/Message");

      const unread = await Message.find({
        sender: from,
        receiver: socket.userId,
        status: { $ne: "seen" }
      });

      const ids = unread.map((m) => m._id);

      await Message.updateMany(
        { _id: { $in: ids } },
        { status: "seen", seenAt: new Date() }
      );

      io.to(from).emit("messages_seen", ids);

    } catch (err) {
      console.log("Seen update error:", err);
    }
  });

  /* ================= SHARE POST ================= */
  socket.on("share_post", async ({ to, postId }) => {
    try {
      const Message = require("./models/Message");

      let msg = await Message.create({
        sender: socket.userId,
        receiver: to,
        sharedPost: postId,
        type: "shared_post",
        status: "sent"
      });

      io.to(to).to(socket.userId).emit("new_message", msg);

      msg.status = "delivered";
      await msg.save();

      io.to(to).to(socket.userId).emit("message_delivered", {
        messageId: msg._id
      });

    } catch (err) {
      console.log("Share post error:", err);
    }
  });

  /* ================= DISCONNECT ================= */
  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.userId);

    io.emit("user_offline", {
      userId: socket.userId,
      lastSeen: new Date()
    });
  });
});

/* =========================================================
   START SERVER
========================================================= */
const PORT = process.env.PORT || 5000;

server.listen(PORT, () =>
  console.log(`Server running on port ${PORT} 🚀`)
);
