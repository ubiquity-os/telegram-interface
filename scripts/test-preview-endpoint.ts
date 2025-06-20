// Test the preview deployment endpoint directly to diagnose the 404 issue

import { getConfig } from "../src/utils/config.ts";

const config = getConfig();

console.log("🧪 TESTING PREVIEW DEPLOYMENT ENDPOINT");
console.log("=" .repeat(40));

// Preview deployment details from diagnostic
const previewDeployment = "telegram-interface-5qxs1tj6qy59.deno.dev";
const webhookSecret = config.webhookSecret;

console.log(`Preview deployment: ${previewDeployment}`);
console.log(`Webhook secret: ${webhookSecret}`);

// Test different endpoints to see which ones exist
const testEndpoints = [
  `/webhook/${webhookSecret}`,           // Production path
  `/webhook-preview/${webhookSecret}`,   // Preview path  
  `/health`,                             // Health check
  `/conversations`,                      // Debug endpoint
];

async function testEndpoint(endpoint: string) {
  const url = `https://${previewDeployment}${endpoint}`;
  console.log(`\n🔍 Testing: ${endpoint}`);
  
  try {
    // Test GET request first (simpler)
    const getResponse = await fetch(url, { method: 'GET' });
    console.log(`  GET ${endpoint}: ${getResponse.status} ${getResponse.statusText}`);
    
    // Test POST request (webhook simulation)
    const postResponse = await fetch(url, { 
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ test: 'webhook_test' })
    });
    console.log(`  POST ${endpoint}: ${postResponse.status} ${postResponse.statusText}`);
    
    // If 200, try to get response text
    if (postResponse.status === 200) {
      const text = await postResponse.text();
      console.log(`  Response: ${text}`);
    }
    
  } catch (error) {
    console.log(`  ❌ Error: ${error.message}`);
  }
}

// Test all endpoints
for (const endpoint of testEndpoints) {
  await testEndpoint(endpoint);
}

console.log("\n🔍 ANALYSIS:");

// Test if preview deployment accepts the same webhook path as production
console.log("\n📊 Testing webhook path compatibility...");

const productionWebhookPath = `/webhook/${webhookSecret}`;
const previewWebhookPath = `/webhook-preview/${webhookSecret}`;

try {
  // Test production deployment with production path (should work)
  const prodTest = await fetch(`https://telegram-interface.deno.dev${productionWebhookPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ test: 'test' })
  });
  console.log(`Production deployment + production path: ${prodTest.status}`);
  
  // Test preview deployment with production path (might work if same code)
  const previewProdPath = await fetch(`https://${previewDeployment}${productionWebhookPath}`, {
    method: 'POST', 
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ test: 'test' })
  });
  console.log(`Preview deployment + production path: ${previewProdPath.status}`);
  
  // Test preview deployment with preview path (should work but currently 404)
  const previewPreviewPath = await fetch(`https://${previewDeployment}${previewWebhookPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ test: 'test' })
  });
  console.log(`Preview deployment + preview path: ${previewPreviewPath.status}`);

} catch (error) {
  console.log(`Test error: ${error.message}`);
}

console.log("\n📋 DIAGNOSIS:");
console.log("If preview deployment + production path = 200:");
console.log("  → Preview deployment has old code (doesn't support webhook-preview)");
console.log("If preview deployment + production path = 404:");  
console.log("  → Preview deployment has different environment/config issues");
console.log("If all paths = 404:");
console.log("  → Preview deployment is completely broken or environment variables missing");

console.log("\n" + "=" .repeat(40));