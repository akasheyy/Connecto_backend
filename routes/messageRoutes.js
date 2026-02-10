const express = require("express");
const router = express.Router();
const Message = require("../models/Message");
const User = require("../models/User");
const auth = require("../middleware/authMiddleware");
const multer = require("multer");
const cloudinary = require("../config/cloudinary");
const { CloudinaryStorage } = require("multer-storage-cloudinary");

/* =======================================================
   CLOUDINARY STORAGE: AUDIO
======================================================= */
const audioStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "mern_chat_audio",
    resource_type: "video",
    allowed_formats: ["mp3", "wav", "webm", "ogg"]
  }
});
const audioUpload = multer({ storage: audioStorage });

/* =======================================================
   CLOUDINARY STORAGE: FILES
======================================================= */
const fileStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "mern_chat_files",
    resource_type: "auto",
    allowed_formats: ["jpg", "jpeg", "png", "pdf", "docx", "zip", "mp4"]
  }
});
const fileUpload = multer({ storage: fileStorage });

/* =======================================================
   SEND FILE MESSAGE
======================================================= */
router.post("/file/:id", auth, fileUpload.single("file"), async (req, res) => {
  try {
    const sender = req.userId;
    const receiver = req.params.id;

    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    let msg = await Message.create({
      sender,
      receiver,
      fileUrl: req.file.path,
      fileName: req.file.originalname,
      fileType: req.file.mimetype,
      type: "file",
      status: "sent"
    });

    const io = req.app.get("io");

    io.to(sender).to(receiver).emit("new_message", msg);

    msg.status = "delivered";
    await msg.save();

    io.to(sender).to(receiver).emit("message_delivered", {
      messageId: msg._id
    });

    res.json(msg);
  } catch (err) {
    console.error("File upload error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* =======================================================
   SEND VOICE MESSAGE
======================================================= */
router.post(
  "/voice/:id",
  auth,
  audioUpload.single("audio"),
  async (req, res) => {
    try {
      const sender = req.userId;
      const receiver = req.params.id;

      if (!req.file) {
        return res.status(400).json({ message: "No audio uploaded" });
      }

      let msg = await Message.create({
        sender,
        receiver,
        type: "audio",
        audioUrl: req.file.path,
        audioDuration: req.body.duration || null,
        status: "sent"
      });

      const io = req.app.get("io");

      io.to(sender).to(receiver).emit("new_message", msg);

      msg.status = "delivered";
      await msg.save();

      io.to(sender).to(receiver).emit("message_delivered", {
        messageId: msg._id
      });

      res.json(msg);
    } catch (err) {
      console.error("Audio upload error:", err);
      res.status(500).json({ message: "Server Error" });
    }
  }
);

/* =======================================================
   GET MESSAGE HISTORY WITH A USER
======================================================= */
router.get("/history/:id", auth, async (req, res) => {
  try {
    const userId = req.userId;
    const otherUserId = req.params.id;

    const messages = await Message.find({
      $or: [
        { sender: userId, receiver: otherUserId },
        { sender: otherUserId, receiver: userId }
      ],
      deletedForEveryone: false,
      deletedBy: { $ne: userId }
    })
      .sort({ createdAt: 1 })
      .populate("sender receiver", "username avatar");

    res.json(messages);
  } catch (err) {
    console.error("Message history error:", err);
    res.status(500).json({ message: "Server Error" });
  }
});

/* =======================================================
   GET RECENT CHATS (🔥 FIXED)
======================================================= */
router.get("/recent", auth, async (req, res) => {
  try {
    const userId = req.userId;

    const user = await User.findById(userId);
    const clearedChats = user.clearedChats || new Map();

  const messages = await Message.find({
  $or: [{ sender: userId }, { receiver: userId }],
  deletedForEveryone: false,
  deletedBy: { $ne: userId }
})
  .sort({ createdAt: -1 })
  .populate("sender receiver", "username avatar lastActive");


    const chatMap = new Map();

    for (const msg of messages) {
      const senderId = msg.sender._id.toString();
      const receiverId = msg.receiver._id.toString();

      const otherUser =
        senderId === userId ? msg.receiver : msg.sender;

      const otherUserId = otherUser._id.toString();

      // 🧹 skip if chat cleared for me
      const clearedDate = clearedChats.get(otherUserId);
      if (clearedDate && msg.createdAt <= clearedDate) continue;

      // already added
      if (chatMap.has(otherUserId)) continue;

      chatMap.set(otherUserId, {
        user: otherUser,
        lastMessage:
          msg.text ||
          (msg.type === "audio"
            ? "🎤 Voice message"
            : msg.type === "file"
            ? "📎 File"
            : "New message"),
        lastTime: msg.createdAt
      });
    }

    res.json([...chatMap.values()]);
  } catch (err) {
    console.error("Recent chats error:", err);
    res.status(500).json({ message: "Server Error" });
  }
});


/* =======================================================
   DELETE MESSAGE (🔥 FIXED)
======================================================= */
router.delete("/:messageId", auth, async (req, res) => {
  const { mode } = req.body;
  const messageId = req.params.messageId;
  const userId = req.userId;
  const io = req.app.get("io");

  try {
    const msg = await Message.findById(messageId);
    if (!msg) {
      return res.status(404).json({ message: "Message not found" });
    }

    // DELETE FOR EVERYONE
    if (mode === "everyone") {
      if (msg.sender.toString() !== userId) {
        return res.status(403).json({
          message: "Only sender can delete for everyone"
        });
      }

      await Message.findByIdAndDelete(messageId);

      io.to(msg.sender.toString())
        .to(msg.receiver.toString())
        .emit("message_deleted", { messageId });

      return res.json({ message: "Deleted for everyone" });
    }

    // DELETE FOR ME ✅ FIXED
    if (mode === "me") {
      await Message.updateOne(
        { _id: messageId },
        { $addToSet: { deletedBy: userId } } // 🔥 SAFE
      );

      return res.json({ message: "Deleted for me" });
    }

    res.status(400).json({ message: "Invalid mode" });
  } catch (err) {
    console.error("Delete message error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* =======================================================
   CLEAR CHAT
======================================================= */
router.delete("/clear/:id", auth, async (req, res) => {
  const { mode } = req.body;
  const me = req.userId;
  const other = req.params.id;
  const io = req.app.get("io");

  try {
    if (mode === "everyone") {
      await Message.deleteMany({
        $or: [
          { sender: me, receiver: other },
          { sender: other, receiver: me }
        ]
      });

      io.to(me).to(other).emit("chat_cleared");
      return res.json({ message: "Chat cleared for both" });
    }

    if (mode === "me") {
      await User.findByIdAndUpdate(me, {
        $set: { [`clearedChats.${other}`]: new Date() }
      });

      return res.json({ message: "Chat cleared for me" });
    }

    res.status(400).json({ message: "Invalid mode" });
  } catch (err) {
    console.error("Clear chat error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* =======================================================
   SHARE POST
======================================================= */
router.post("/share/:id", auth, async (req, res) => {
  try {
    const sender = req.userId;
    const receiver = req.params.id;
    const { postId } = req.body;

    if (!postId) {
      return res.status(400).json({ message: "postId required" });
    }

    let msg = await Message.create({
      sender,
      receiver,
      type: "shared_post",
      sharedPost: postId,
      status: "sent"
    });

    const io = req.app.get("io");
    io.to(sender).to(receiver).emit("new_message", msg);

    msg.status = "delivered";
    await msg.save();

    io.to(sender).to(receiver).emit("message_delivered", {
      messageId: msg._id
    });

    res.json(msg);
  } catch (err) {
    console.error("Share post error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
