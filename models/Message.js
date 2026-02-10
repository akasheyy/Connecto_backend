const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
  {
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    receiver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    text: { type: String, default: null },
    audioUrl: { type: String, default: null },
    audioDuration: { type: Number, default: null },
    fileUrl: { type: String, default: null },
    fileType: { type: String, default: null },
    fileName: { type: String, default: null },
    sharedPost: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Post",
      default: null
    },
    type: {
      type: String,
      enum: ["text", "audio", "file", "shared_post"],
      default: "text"
    },
    // 🗑 NEW: For "Delete for Me"
    // If a user ID is in this array, hide the message for THEM only.
    deletedBy: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
      }
    ],
    // 🗑 Deleted for everyone (Existing)
    deletedForEveryone: {
      type: Boolean,
      default: false
    },
    status: {
      type: String,
      enum: ["sent", "delivered", "seen"],
      default: "sent"
    },
    seenAt: { type: Date, default: null }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Message", messageSchema);