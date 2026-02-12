const webPush = require("web-push");

const keys = webPush.generateVAPIDKeys();

console.log("PUBLIC KEY:");
console.log(keys.publicKey);

console.log("\nPRIVATE KEY:");
console.log(keys.privateKey);
