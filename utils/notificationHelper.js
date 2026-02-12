const Notification = require("../models/Notification");

async function createMessageNotification(sender, receiver, message) {
  try {
    const existingUnread = await Notification.findOne({
      toUserId: receiver,
      fromUserId: sender,
      type: "message",
      read: false
    });

    if (!existingUnread) {
      await Notification.create({
        toUserId: receiver,
        fromUserId: sender,
        type: "message",
        text: message.text || "Sent you a message"
      });
    }
  } catch (err) {
    console.error("Notification error:", err);
  }
}

module.exports = {
  createMessageNotification
};
