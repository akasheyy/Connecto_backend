const express = require("express");
const router = express.Router();
const User = require("../models/User");
const auth = require("../middleware/authMiddleware");
const upload = require("../middleware/uploadMiddleware");
const cloudinary = require("../config/cloudinary");
const Post = require("../models/Post");
const updateLastActive = require("../middleware/updateLastActive"); // 🟣 NEW
/* --------------------------------------------------------------
   UPLOAD / UPDATE AVATAR
-------------------------------------------------------------- */
router.put("/avatar", auth, updateLastActive, upload.single("avatar"), async (req, res) => {

  try {
    const user = await User.findById(req.userId);

    if (!user) return res.status(404).json({ message: "User not found" });

    if (user.avatarPublicId) {
      await cloudinary.uploader.destroy(user.avatarPublicId);
    }

    const uploaded = await cloudinary.uploader.upload(req.file.path, {
      folder: "avatars",
    });

    user.avatar = uploaded.secure_url;
    user.avatarPublicId = uploaded.public_id;
    await user.save();

    res.json({ message: "Avatar updated", avatar: user.avatar });
  } catch (err) {
    res.status(500).json({ message: "Server Error", err });
  }
});

/* --------------------------------------------------------------
   GET LOGGED-IN USER PROFILE
-------------------------------------------------------------- */
router.get("/me", auth, updateLastActive, async (req, res) => {

  const user = await User.findById(req.userId)
    .select("-password")
    .populate("followers", "_id")
    .populate("following", "_id")

  res.json(user);
});

/* --------------------------------------------------------------
   FOLLOW USER
-------------------------------------------------------------- */
router.put("/:id/follow", auth, updateLastActive, async (req, res) => {

  const currentUser = req.userId;
  const targetUser = req.params.id;

  if (currentUser === targetUser)
    return res.json({ message: "You cannot follow yourself" });

  await User.findByIdAndUpdate(currentUser, {
    $addToSet: { following: targetUser },
  });

  await User.findByIdAndUpdate(targetUser, {
    $addToSet: { followers: currentUser },
  });

  // Send notification
  const Notification = require("../models/Notification");
  await Notification.create({
    type: "follow",
    fromUserId: currentUser,
    toUserId: targetUser
  });

  const io = req.app.get("io");
  io.to(targetUser).emit("notification", {
    type: "follow",
    fromUserId: currentUser,
    toUserId: targetUser,
    createdAt: new Date()
  });

  res.json({ message: "Followed user" });
});

/* --------------------------------------------------------------
   UNFOLLOW USER
-------------------------------------------------------------- */
router.put("/:id/unfollow", auth, updateLastActive, async (req, res) => {

  const currentUser = req.userId;
  const targetUser = req.params.id;

  if (currentUser === targetUser)
    return res.json({ message: "You cannot unfollow yourself" });

  await User.findByIdAndUpdate(currentUser, {
    $pull: { following: targetUser },
  });

  await User.findByIdAndUpdate(targetUser, {
    $pull: { followers: currentUser },
  });

  res.json({ message: "Unfollowed user" });
});


/* --------------------------------------------------------------
   GET PUBLIC PROFILE (view other users)
-------------------------------------------------------------- */
router.get("/profile/:id", auth, updateLastActive, async (req, res) => {

  try {
    const user = await User.findById(req.params.id)
      .select("-password")
      .populate("followers", "username avatar")
      .populate("following", "username avatar");

    if (!user) return res.status(404).json({ message: "User not found" });

    const Post = require("../models/Post");
    const posts = await Post.find({ userId: req.params.id });

    res.json({ user, posts });
  } catch (err) {
    res.status(500).json({ message: "Server Error", err });
  }
});

// 🔍 SEARCH USERS
router.get("/search", auth, async (req, res) => {
  try {
    const query = req.query.query || "";

    const users = await User.find({
      username: { $regex: query, $options: "i" }
    })
      .select("username avatar followers");

    res.json(users);
  } catch (err) {
    res.status(500).json({ message: "Search error", err });
  }
});

router.get("/suggestions", auth, async (req, res) => {
  try {
    const me = await User.findById(req.userId).populate("following");

    // Users you already follow → skip these
    const followingIds = me.following.map((f) => f._id.toString());

    // Fetch all users except yourself & already-followed
    let users = await User.find({
      _id: { $ne: req.userId, $nin: followingIds }
    }).sort({ followers: -1 }); // popular first

    // Limit to 10 suggestions
    users = users.slice(0, 10);

    res.json(users);

  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;

