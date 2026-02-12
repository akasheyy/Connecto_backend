const express = require("express");
const router = express.Router();
const PushSubscription = require("../models/PushSubscription");
const auth = require("../middleware/authMiddleware");

router.post("/subscribe", auth, async (req, res) => {
  try {
    const subscription = req.body;

    await PushSubscription.findOneAndUpdate(
      { userId: req.userId },
      { subscription },
      { upsert: true }
    );

    res.json({ message: "Subscribed ✅" });
  } catch (err) {
    res.status(500).json({ message: "Subscription failed" });
  }
});

module.exports = router;
