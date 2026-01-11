const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      required: true,
      enum: ["like", "comment", "follow", "message"]
    },
    fromUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    toUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    postId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Post"
    },
    messageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message"
    },
    text: String,
    read: {
      type: Boolean,
      default: false
    }
  },
  { timestamps: true }
);

// Index for efficient queries
notificationSchema.index({ toUserId: 1, createdAt: -1 });

module.exports = mongoose.model("Notification", notificationSchema);
