const express = require("express");
const router = express.Router();
const Post = require("../models/Post");
const auth = require("../middleware/authMiddleware");
const upload = require("../middleware/uploadMiddleware");
const cloudinary = require("../config/cloudinary"); // ⬅️ Make sure this file exists

// ===============================
// Create Post (with optional image)
// ===============================
router.post("/", auth, upload.single("image"), async (req, res) => {
  try {
    const { title, description, content } = req.body;

    let imageUrl = null;
    let imageId = null;

    if (req.file) {
      imageUrl = req.file.path;
      imageId = req.file.filename; // Cloudinary public_id
    }

    const post = new Post({
      title,
      description,
      content,
      image: imageUrl,
      imageId: imageId,
      userId: req.userId
    });

    await post.save();

    res.json({ message: "Post created successfully", post });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Server Error", error });
  }
});

// ===============================
// Get all posts
// ===============================
router.get("/", auth, async (req, res) => {
  try {
    const posts = await Post.find({ userId: { $ne: req.userId } })
      .populate("userId", "username avatar")
      .sort({ createdAt: -1 });

    res.json(posts);
  } catch (error) {
    res.status(500).json({ message: "Server Error" });
  }
});

// ===============================
// Get my posts
// ===============================
router.get("/myposts", auth, async (req, res) => {
  try {
    const posts = await Post.find({ userId: req.userId })
  .populate("userId", "username avatar")
  .sort({ createdAt: -1 });

    res.json(posts);
  } catch (error) {
    res.status(500).json({ message: "Server Error" });
  }
});

// ===============================
// Get single post
// ===============================
router.get("/:id", auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id)
    .populate("userId", "username avatar")

    if (!post) return res.status(404).json({ message: "Post not found" });

    res.json(post);
  } catch (error) {
    res.status(500).json({ message: "Server Error", error });
  }
});

// ===============================
// Delete Post (also delete Cloudinary image)
// ===============================
router.delete("/:id", auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);

    if (!post) return res.status(404).json({ message: "Post not found" });

    if (post.userId.toString() !== req.userId)
      return res.status(403).json({ message: "Unauthorized" });

    // Delete image from Cloudinary
    if (post.imageId) {
      await cloudinary.uploader.destroy(post.imageId);
    }

    await post.deleteOne();

    res.json({ message: "Post deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Server Error" });
  }
});

// ===============================
// Update Post (with optional image replace)
// ===============================
router.put("/:id", auth, upload.single("image"), async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);

    if (!post) return res.status(404).json({ message: "Post not found" });

    if (post.userId.toString() !== req.userId)
      return res.status(403).json({ message: "Unauthorized" });

    const { title, description, content } = req.body;

    post.title = title;
    post.description = description;
    post.content = content;

    // If new image uploaded
    if (req.file) {
      if (post.imageId) {
        await cloudinary.uploader.destroy(post.imageId); // delete old image
      }
      post.image = req.file.path;
      post.imageId = req.file.filename;
    }

    await post.save();

    res.json({ message: "Post updated successfully", post });

  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Server Error" });
  }
});

// ===============================
// LIKE / UNLIKE + NOTIFICATION
// ===============================
router.put("/:id/like", auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id).populate(
      "userId",
      "username"
    );

    if (!post) return res.status(404).json({ message: "Post not found" });

    const io = req.app.get("io");         // 🔔 socket.io instance
    const me = req.userId;                // current user id
    const postOwnerId = post.userId._id.toString();

    // UNLIKE
    if (post.likes.includes(me)) {
      post.likes = post.likes.filter((id) => id.toString() !== me);
      await post.save();
      return res.json({ message: "Post unliked", likes: post.likes.length });
    }

    // LIKE
    post.likes.push(me);
    await post.save();

    // send notification only if you like someone else's post
    if (postOwnerId !== me) {
      const Notification = require("../models/Notification");

      // Save notification to database
      await Notification.create({
        type: "like",
        fromUserId: me,
        toUserId: postOwnerId,
        postId: post._id
      });

      io.to(postOwnerId).emit("notification", {
        type: "like",
        fromUserId: me,
        toUserId: postOwnerId,
        postId: post._id,
        postTitle: post.title,
        createdAt: new Date()
      });
    }

    res.json({ message: "Post liked", likes: post.likes.length });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Server Error" });
  }
});

// ===============================
// COMMENT + NOTIFICATION
// ===============================
router.post("/:id/comment", auth, async (req, res) => {
  try {
    const { text } = req.body;

    if (!text.trim())
      return res.status(400).json({ message: "Comment cannot be empty" });

    const post = await Post.findById(req.params.id).populate(
      "userId",
      "username"
    );

    if (!post) return res.status(404).json({ message: "Post not found" });

    post.comments.push({
      userId: req.userId,
      username: req.user.username,
      text
    });

    await post.save();

    const io = req.app.get("io");
    const me = req.userId;
    const postOwnerId = post.userId._id.toString();

    if (postOwnerId !== me) {
      const Notification = require("../models/Notification");

      // Save notification to database
      await Notification.create({
        type: "comment",
        fromUserId: me,
        toUserId: postOwnerId,
        postId: post._id,
        text
      });

      io.to(postOwnerId).emit("notification", {
        type: "comment",
        fromUserId: me,
        toUserId: postOwnerId,
        postId: post._id,
        postTitle: post.title,
        text,
        createdAt: new Date()
      });
    }

    res.json({ message: "Comment added", post });
  } catch (err) {
    console.log("COMMENT ERROR:", err);
    res.status(500).json({ message: "Server Error" });
  }
});


// ===============================
// SHARE POST INTERNALLY (send to another user)
// ===============================
router.post("/:postId/share", auth, async (req, res) => {
  try {
    const { toUserId } = req.body;
    const { postId } = req.params;

    if (!toUserId)
      return res.status(400).json({ message: "Receiver userId is required" });

    const Message = require("../models/Message");

    // Create a message that contains the shared post
    const msg = await Message.create({
      sender: req.userId,
      receiver: toUserId,
      sharedPost: postId,
      text: "Shared a post with you",
      status: "sent"
    });

    // Send live notification using socket.io
    const io = req.app.get("io");
    if (io) {
      io.to(toUserId).emit("new_message", msg);
    }

    res.json({ message: "Post shared successfully", shared: true });
  } catch (error) {
    console.log("Share Error:", error);
    res.status(500).json({ message: "Failed to share post" });
  }
});

module.exports = router;
