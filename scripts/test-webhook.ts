// Test webhook endpoints for both production and preview deployments

const DEPLOYMENTS = {
  production: "https://telegram-interface.deno.dev",
  preview: "https://telegram-interface-5qxs1tj6qy59.deno.dev"
};

const webhookSecret = Deno.env.get("WEBHOOK_SECRET") || "";

if (!webhookSecret) {
  console.error("❌ WEBHOOK_SECRET is required");
  Deno.exit(1);
}

async function testWebhook(name: string, baseUrl: string) {
  console.log(`\n🔍 Testing ${name} deployment...`);
  console.log(`Base URL: ${baseUrl}`);
  
  // Test health endpoint
  try {
    const healthResponse = await fetch(`${baseUrl}/health`);
    if (healthResponse.ok) {
      const health = await healthResponse.json();
      console.log(`✅ Health check passed:`, health);
    } else {
      console.log(`❌ Health check failed: ${healthResponse.status} ${healthResponse.statusText}`);
    }
  } catch (error) {
    console.log(`❌ Health check error:`, error.message);
  }
  
  // Test webhook endpoint
  const webhookUrl = `${baseUrl}/webhook/${webhookSecret}`;
  console.log(`\nWebhook URL: ${webhookUrl}`);
  
  try {
    // Send a minimal Telegram update
    const testUpdate = {
      update_id: Date.now(),
      message: {
        message_id: 1,
        date: Math.floor(Date.now() / 1000),
        chat: {
          id: 123456789,
          type: "private"
        },
        from: {
          id: 123456789,
          is_bot: false,
          first_name: "Test"
        },
        text: "Test message"
      }
    };
    
    const webhookResponse = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(testUpdate)
    });
    
    console.log(`Webhook response: ${webhookResponse.status} ${webhookResponse.statusText}`);
    
    if (!webhookResponse.ok) {
      const body = await webhookResponse.text();
      console.log(`Response body: ${body}`);
    }
  } catch (error) {
    console.log(`❌ Webhook test error:`, error.message);
  }
}

// Test both deployments
await testWebhook("Production", DEPLOYMENTS.production);
await testWebhook("Preview", DEPLOYMENTS.preview);

console.log("\n📝 Summary:");
console.log("If the preview webhook returns 404, the deployment might not have the correct code.");
console.log("If it returns 500, check that environment variables are configured in Deno Deploy.");
