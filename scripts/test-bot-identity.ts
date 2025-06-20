// Test that each bot responds with its correct identity

const productionToken = Deno.env.get("BOT_TOKEN") || "";
const previewToken = Deno.env.get("PREVIEW_BOT_TOKEN") || "";

if (!productionToken || !previewToken) {
  console.error("❌ Both BOT_TOKEN and PREVIEW_BOT_TOKEN are required");
  Deno.exit(1);
}

console.log("🔍 Testing Bot Identity Response\n");

// Send a test message to each deployment and see which bot responds
async function testBotIdentity() {
  // First, get bot info
  const prodBotResponse = await fetch(`https://api.telegram.org/bot${productionToken}/getMe`);
  const prodBot = await prodBotResponse.json();
  
  const previewBotResponse = await fetch(`https://api.telegram.org/bot${previewToken}/getMe`);
  const previewBot = await previewBotResponse.json();
  
  console.log("📱 Bot Information:");
  console.log(`Production Bot: @${prodBot.result.username} (ID: ${prodBot.result.id})`);
  console.log(`Preview Bot: @${previewBot.result.username} (ID: ${previewBot.result.id})`);
  
  console.log("\n📝 Instructions for Testing:");
  console.log("1. Send a message to your PREVIEW bot (@" + previewBot.result.username + ")");
  console.log("2. You should get a response from the PREVIEW bot, not the production bot");
  console.log("3. Send a message to your PRODUCTION bot (@" + prodBot.result.username + ")");
  console.log("4. You should get a response from the PRODUCTION bot");
  
  console.log("\n✅ If each bot responds correctly, the deployment detection is working!");
  console.log("❌ If you get responses from the wrong bot, check the deployment logs for hostname detection");
}

await testBotIdentity();
