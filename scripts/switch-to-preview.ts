#!/usr/bin/env -S deno run --allow-net --allow-env

// Quick script to switch preview bot to a Deno Deploy preview URL

const previewUrl = Deno.args[0];

if (!previewUrl) {
  console.error(`
❌ Please provide your preview deployment URL

Usage:
  deno run --allow-net --allow-env scripts/switch-to-preview.ts <preview-url>

Example:
  deno run --allow-net --allow-env scripts/switch-to-preview.ts https://telegram-interface-69bz2rgywb7m.deno.dev

Or make it executable:
  chmod +x scripts/switch-to-preview.ts
  ./scripts/switch-to-preview.ts https://telegram-interface-69bz2rgywb7m.deno.dev
`);
  Deno.exit(1);
}

// Run the manage-webhooks script with the preview bot
const command = new Deno.Command("deno", {
  args: [
    "run",
    "--allow-net",
    "--allow-env",
    "scripts/manage-webhooks.ts",
    "set",
    "preview",
    previewUrl
  ],
});

const { code } = await command.output();

if (code === 0) {
  console.log("\n✨ Preview bot is now ready for testing!");
  console.log(`🔗 Your preview deployment: ${previewUrl}`);
  console.log("\n💡 To switch back to production, run:");
  console.log("   deno run --allow-net --allow-env scripts/manage-webhooks.ts check production");
} else {
  console.error("\n❌ Failed to set preview webhook");
  Deno.exit(1);
}
