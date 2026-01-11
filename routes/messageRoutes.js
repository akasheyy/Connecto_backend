const express = require("express");
const router = express.Router();
const Message = require("../models/Message");
const User = require("../models/User");
const auth = require("../middleware/authMiddleware");
const multer = require("multer");
const cloudinary = require("../config/cloudinary");
const { CloudinaryStorage } = require("multer-storage-cloudinary");

/* =======================================================
   CLOUDINARY STORAGE: AUDIO (voice messages)
======================================================= */
const audioStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "mern_chat_audio",
    resource_type: "video", // audio/webm requires video
    allowed_formats: ["mp3", "wav", "webm", "ogg"]
  }
});
const audioUpload = multer({ storage: audioStorage });

/* =======================================================
   CLOUDINARY STORAGE: FILES (images, docs, videos, etc)
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
   SEND FILE MESSAGE  → POST /api/messages/file/:id
======================================================= */
router.post("/file/:id", auth, fileUpload.single("file"), async (req, res) => {
  try {
    const senderId = req.userId;
    const receiverId = req.params.id;

    if (!req.file)
      return res.status(400).json({ message: "No file uploaded" });

    const msg = await Message.create({
      sender: senderId,
      receiver: receiverId,
      fileUrl: req.file.path,
      fileName: req.file.originalname,
      fileType: req.file.mimetype.includes("image")
        ? "image"
        : req.file.mimetype.includes("video")
        ? "video"
        : "file",
      type: "file"
    });

    const io = req.app.get("io");
    io.to(receiverId).to(senderId).emit("new_message", msg);

    res.json(msg);
  } catch (err) {
    console.log("File upload error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* =======================================================
   SEND VOICE MESSAGE → POST /api/messages/voice/:id
======================================================= */
router.post(
  "/voice/:id",
  auth,
  audioUpload.single("audio"),
  async (req, res) => {
    try {
      const senderId = req.userId;
      const receiver = req.params.id;

      if (!req.file)
        return res.status(400).json({ message: "No audio uploaded" });

      const msg = await Message.create({
        sender: senderId,
        receiver,
        type: "audio",
        audioUrl: req.file.path,
        audioDuration: req.body.duration ? Number(req.body.duration) : null
      });

      const io = req.app.get("io");
      io.to(receiver).to(senderId).emit("new_message", msg);

      res.json(msg);
    } catch (err) {
      console.error("Audio upload error:", err);
      res.status(500).json({ message: "Server Error" });
    }
  }
);

/* =======================================================
   GET RECENT CHATS
======================================================= */
router.get("/recent", auth, async (req, res) => {
  try {
    const userId = req.userId;

    // Get the user's clearedChats
    const user = await User.findById(userId);
    const clearedChats = user.clearedChats || {};

    const messages = await Message.find({
      $or: [{ sender: userId }, { receiver: userId }]
    })
      .sort({ createdAt: -1 })
      .populate("sender receiver", "username avatar lastActive");

    const chatMap = {};

    messages.forEach((msg) => {
      const other =
        msg.sender._id.toString() === userId ? msg.receiver : msg.sender;
      const otherId = other._id.toString();

      // Skip if chat was cleared and this message is before the cleared date
      const clearedDate = clearedChats.get(otherId);
      if (clearedDate && msg.createdAt <= clearedDate) {
        return;
      }

      if (!chatMap[otherId]) {
        chatMap[otherId] = {
          user: other,
          lastMessage:
            msg.text ||
            (msg.type === "audio" ? "🎤 Voice message" : "📎 File"),
          lastTime: msg.createdAt
        };
      }
    });

    res.json(Object.values(chatMap));
  } catch (err) {
    console.error("Recent chats error:", err);
    res.status(500).json({ message: "Server Error" });
  }
});

/* =======================================================
   GET FULL CHAT HISTORY WITH ONE USER
======================================================= */
router.get("/history/:id", auth, async (req, res) => {
  try {
    const currentUser = req.userId;
    const otherUser = req.params.id;

    // Get the user's clearedChats to filter messages
    const user = await User.findById(currentUser);
    const clearedDate = user.clearedChats?.get(otherUser);

    let query = {
      $or: [
        { sender: currentUser, receiver: otherUser },
        { sender: otherUser, receiver: currentUser }
      ]
    };

    // If chat was cleared for me, only show messages after the cleared date
    if (clearedDate) {
      query.createdAt = { $gt: clearedDate };
    }

    const messages = await Message.find(query)
      .sort({ createdAt: 1 })
      .populate("sender receiver", "username avatar");

    res.json(messages);
  } catch (err) {
    console.error("History error:", err);
    res.status(500).json({ message: "Server Error" });
  }
});

/* =======================================================
   DELETE A SINGLE MESSAGE (WhatsApp-style)
   DELETE /api/messages/:messageId   body: { mode: "me" | "everyone" }
======================================================= */
router.delete("/:messageId", auth, async (req, res) => {
  const { mode } = req.body; // "me" | "everyone"
  const messageId = req.params.messageId;
  const userId = req.userId;
  const io = req.app.get("io");

  try {
    const msg = await Message.findById(messageId);
    if (!msg) return res.status(404).json({ message: "Message not found" });

    // DELETE FOR EVERYONE (DB delete + socket event)
    if (mode === "everyone") {
      if (msg.sender.toString() !== userId) {
        return res
          .status(403)
          .json({ message: "Only sender can delete for everyone" });
      }

      await Message.findByIdAndDelete(messageId);

      io.to(msg.receiver.toString())
        .to(msg.sender.toString())
        .emit("message_deleted", { messageId });

      return res.json({ message: "Deleted for everyone" });
    }

    // DELETE FOR ME ONLY (local: frontend will hide it)
    if (mode === "me") {
      return res.json({ message: "Deleted for me" });
    }

    return res.status(400).json({ message: "Invalid mode" });
  } catch (err) {
    console.error("Delete message error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* =======================================================
   CLEAR CHAT WITH USER (WhatsApp-style)
   DELETE /api/messages/clear/:id   body: { mode: "me" | "everyone" }
======================================================= */
router.delete("/clear/:id", auth, async (req, res) => {
  const { mode } = req.body;
  const userId = req.userId;
  const otherId = req.params.id;
  const io = req.app.get("io");

  try {
    // CLEAR CHAT FOR BOTH (delete from DB)
    if (mode === "everyone") {
      await Message.deleteMany({
        $or: [
          { sender: userId, receiver: otherId },
          { sender: otherId, receiver: userId }
        ]
      });

      io.to(userId).to(otherId).emit("chat_cleared");

      return res.json({ message: "Chat cleared for both" });
    }

    // CLEAR CHAT FOR ME (update user's clearedChats)
    if (mode === "me") {
      await User.findByIdAndUpdate(userId, {
        $set: { [`clearedChats.${otherId}`]: new Date() }
      });
      return res.json({ message: "Chat cleared for me" });
    }

    return res.status(400).json({ message: "Invalid mode" });
  } catch (err) {
    console.error("Clear chat error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* =======================================================
   SHARE POST INSIDE CHAT
   POST /api/messages/share/:id
   body: { postId }
======================================================= */
router.post("/share/:id", auth, async (req, res) => {
  try {
    const senderId = req.userId;
    const receiverId = req.params.id;
    const { postId } = req.body;

    if (!postId)
      return res.status(400).json({ message: "postId is required" });

    const Post = require("../models/Post");
    const post = await Post.findById(postId);

    if (!post)
      return res.status(404).json({ message: "Post not found" });

    // Create shared-post message
    const msg = await Message.create({
      sender: senderId,
      receiver: receiverId,
      type: "shared_post",
      sharedPost: postId
    });

    // Send message via sockets
    const io = req.app.get("io");
    io.to(receiverId).to(senderId).emit("new_message", msg);

    res.json({ message: "Post shared successfully", msg });
  } catch (err) {
    console.log("Share post error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
