/// <reference types="deno-types" />

// Manual argument parsing
let botToken: string | null = null;
let webhookSecret: string | null = null;
let deploymentUrl: string | null = null;
let dryRun = false;

const args = Deno.args;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--bot-token" && i + 1 < args.length) {
    botToken = args[i+1];
    i++;
  } else if (args[i] === "--webhook-secret" && i + 1 < args.length) {
    webhookSecret = args[i+1];
    i++;
  } else if (args[i] === "--deployment-url" && i + 1 < args.length) {
    deploymentUrl = args[i+1];
    i++;
  } else if (args[i] === "--dry-run") {
    dryRun = true;
  }
}

console.log("=== WEBHOOK UPDATE DEBUG ===");
console.log("Raw arguments:", Deno.args);
console.log("Dry run mode:", dryRun);
console.log("Arguments:");
console.log(`- Bot Token: ${botToken ? "*****" : "MISSING"}`);
console.log(`- Webhook Secret: ${webhookSecret ? "*****" : "MISSING"}`);
console.log(`- Deployment URL: ${deploymentUrl || "MISSING"}`);

// Validate required arguments
if (!botToken) {
  console.error("ERROR: Bot token is required (use --bot-token)");
  Deno.exit(1);
}
if (!webhookSecret) {
  console.error("ERROR: Webhook secret is required (use --webhook-secret)");
  Deno.exit(1);
}
if (!deploymentUrl) {
  console.error("ERROR: Deployment URL is required (use --deployment-url)");
  Deno.exit(1);
}

try {
  const webhookUrl = `${deploymentUrl}/webhook`;

  if (dryRun) {
    console.log("\nDRY RUN RESULTS:");
    console.log(`Would set webhook to: ${webhookUrl}`);
    console.log("Would use token: *****");
    console.log("Would use secret: *****");
    Deno.exit(0);
  }

  console.log(`\nSetting webhook to: ${webhookUrl}`);
  const response = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: webhookSecret,
      drop_pending_updates: true,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error("ERROR:", error);
    throw new Error(`Failed to set webhook: ${response.status} ${error}`);
  }

  const result = await response.json() as {ok: boolean, description: string};
  console.log("\nSUCCESS:", result.description);
} catch (error) {
  console.error("\nFATAL ERROR:", error);
  Deno.exit(1);
}

export {};
