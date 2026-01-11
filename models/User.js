const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true },
    email:    { type: String, required: true, unique: true },
    password: { type: String, required: true },

    avatar: {
      type: String,
      default: "https://cdn-icons-png.flaticon.com/512/149/149071.png"
    },
    avatarPublicId: String,

    followers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    following: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],

    // 🟣 Clear chat (timestamp-based)
    clearedChats: {
      type: Map,
      of: Date,
      default: {}
    },

    // 🟣 Delete single message for me (ID-based)
    hiddenMessages: {
      type: Map,
      of: [mongoose.Schema.Types.ObjectId],
      default: {}
    },

    lastActive: {
      type: Date,
      default: Date.now
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
