const express = require("express");
const router = express.Router();
const Message = require("../models/Message");
const User = require("../models/User");
const auth = require("../middleware/authMiddleware");
const multer = require("multer");
const cloudinary = require("../config/cloudinary");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const { createMessageNotification } = require("../utils/notificationHelper");

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

    // Create notification for the message
    await createMessageNotification(sender, receiver, msg);

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

      // Create notification for the message
      await createMessageNotification(sender, receiver, msg);

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

    const user = await User.findById(userId);
    const clearedChats = user.clearedChats || new Map();

    const clearedDate = clearedChats.get(otherUserId);

    const query = {
      $or: [
        { sender: userId, receiver: otherUserId },
        { sender: otherUserId, receiver: userId }
      ],
      deletedForEveryone: false,
      deletedBy: { $ne: userId }
    };

    const messages = await Message.find(query)
      .sort({ createdAt: 1 })
      .populate("sender receiver", "username avatar");

    // ✅ FILTER CLEARED MESSAGES 🔥
    const filteredMessages = clearedDate
      ? messages.filter(msg => msg.createdAt > clearedDate)
      : messages;

    res.json(filteredMessages);

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
    const hiddenMessages = user.hiddenMessages || {};

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
      const hiddenIds = hiddenMessages[otherUserId] || [];
      if (hiddenIds.includes(msg._id.toString())) continue;

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
/* =======================================================
   DELETE MESSAGE (🔥 FULL FIXED)
======================================================= */
router.delete("/:messageId", auth, async (req, res) => {
  const { mode } = req.body;
  const messageId = req.params.messageId;
  const me = req.userId;
  const io = req.app.get("io");

  try {
    const message = await Message.findById(messageId);

    if (!message) {
      return res.status(404).json({ message: "Message not found" });
    }

    /* ---------------- DELETE FOR ME ---------------- */
    if (mode === "me") {
      await Message.updateOne(
        { _id: messageId },
        { $addToSet: { deletedBy: me } }
      );

      io.to(me).emit("message_deleted", { messageId });

      return res.json({ message: "Deleted for me" });
    }

    /* ---------------- DELETE FOR EVERYONE 🔥 ---------------- */
    if (mode === "everyone") {

   if (!message.sender.equals(me)) {
      return res.status(403).json({
         message: "You can only delete your messages"
      });
   }

   await message.deleteOne();

   io.to(message.sender.toString())
     .to(message.receiver.toString())
     .emit("message_deleted", { messageId });

   return res.json({ message: "Deleted for everyone" });
}


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
    if (mode === "me") {

  await User.findByIdAndUpdate(me, {
    $set: { [`clearedChats.${other}`]: new Date() }
  });

  io.to(me).emit("chat_cleared");

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

    // Create notification for the message
    await createMessageNotification(sender, receiver, msg);

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
