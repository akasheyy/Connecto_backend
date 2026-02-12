const webPush = require("web-push");

webPush.setVapidDetails(
  "mailto:support@connecto.app",
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

exports.sendPushNotification = async (subscription, payload) => {
  try {
    await webPush.sendNotification(subscription, JSON.stringify(payload));
  } catch (err) {
    console.log("Push Error:", err.message);
  }
};
