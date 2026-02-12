const express = require("express");
const router = express.Router();
const Notification = require("../models/Notification");
const auth = require("../middleware/authMiddleware");
const updateLastActive = require("../middleware/updateLastActive");

/* --------------------------------------------------------------
   GET MY NOTIFICATIONS
-------------------------------------------------------------- */
router.get("/", auth, updateLastActive, async (req, res) => {
  try {
    const notifications = await Notification.find({ toUserId: req.userId })
      .populate("fromUserId", "username avatar")
      .populate("postId", "title description image")
      .sort({ createdAt: -1 })
      .limit(50);

    res.json(notifications);
  } catch (err) {
    console.log("Get notifications error:", err);
    res.status(500).json({ message: "Server Error" });
  }
});

/* --------------------------------------------------------------
   MARK NOTIFICATION AS READ
-------------------------------------------------------------- */
router.put("/:id/read", auth, updateLastActive, async (req, res) => {
  try {
    const notification = await Notification.findById(req.params.id);

    if (!notification)
      return res.status(404).json({ message: "Notification not found" });

    if (notification.toUserId.toString() !== req.userId)
      return res.status(403).json({ message: "Unauthorized" });

    notification.read = true;
    await notification.save();

    res.json({ message: "Notification marked as read" });
  } catch (err) {
    console.log("Mark read error:", err);
    res.status(500).json({ message: "Server Error" });
  }
});

/* --------------------------------------------------------------
   MARK ALL NOTIFICATIONS AS READ
-------------------------------------------------------------- */
router.put("/read-all", auth, updateLastActive, async (req, res) => {
  try {
    await Notification.updateMany(
      { toUserId: req.userId, read: false },
      { read: true }
    );

    res.json({ message: "All notifications marked as read" });
  } catch (err) {
    console.log("Read all error:", err);
    res.status(500).json({ message: "Server Error" });
  }
});

/* --------------------------------------------------------------
   DELETE NOTIFICATION
-------------------------------------------------------------- */
router.delete("/:id", auth, updateLastActive, async (req, res) => {
  try {
    const notification = await Notification.findById(req.params.id);

    if (!notification)
      return res.status(404).json({ message: "Notification not found" });

    if (notification.toUserId.toString() !== req.userId)
      return res.status(403).json({ message: "Unauthorized" });

    await notification.deleteOne();

    res.json({ message: "Notification deleted" });
  } catch (err) {
    console.log("Delete notification error:", err);
    res.status(500).json({ message: "Server Error" });
  }
});

/* --------------------------------------------------------------
   GET UNREAD COUNT
-------------------------------------------------------------- */
router.get("/unread-count", auth, updateLastActive, async (req, res) => {
  try {
    const count = await Notification.countDocuments({
      toUserId: req.userId,
      read: false
    });

    res.json({ count });
  } catch (err) {
    console.log("Unread count error:", err);
    res.status(500).json({ message: "Server Error" });
  }
});

module.exports = router;
