#!/usr/bin/env -S deno run --allow-env

/**
 * Configuration Test Script
 * 
 * Tests the dual bot configuration system used in GitHub Actions workflows.
 * Validates environment variables and configuration loading for both 
 * production and preview bot types.
 */

import { getConfig, type Config } from "./src/utils/config.ts";

interface TestResult {
  passed: boolean;
  message: string;
  details?: string;
}

function testConfiguration(): TestResult[] {
  const results: TestResult[] = [];
  
  try {
    console.log("🧪 Testing configuration system...");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    
    // Get current configuration
    const config = getConfig();
    const botType = config.botType;
    
    console.log(`\n📋 Configuration Details:`);
    console.log(`   Bot Type: ${botType}`);
    console.log(`   Environment: ${config.environment}`);
    console.log(`   Log Level: ${config.logLevel}`);
    console.log(`   Has Bot Token: ${!!config.botToken}`);
    console.log(`   Has Webhook Secret: ${!!config.webhookSecret}`);
    console.log(`   Has OpenRouter API Key: ${!!config.openRouterApiKey}`);
    
    // Test 1: Bot Type Validation
    if (botType === "production" || botType === "preview") {
      results.push({
        passed: true,
        message: `✅ Bot type '${botType}' is valid`
      });
    } else {
      results.push({
        passed: false,
        message: `❌ Invalid bot type: '${botType}'`,
        details: "Expected 'production' or 'preview'"
      });
    }
    
    // Test 2: Bot Token Validation
    if (config.botToken && config.botToken.length > 0) {
      const tokenPrefix = config.botToken.substring(0, 10);
      results.push({
        passed: true,
        message: `✅ Bot token configured (${tokenPrefix}...)`
      });
    } else {
      results.push({
        passed: false,
        message: `❌ Bot token missing for ${botType} bot`,
        details: botType === "preview" ? "PREVIEW_BOT_TOKEN required" : "BOT_TOKEN required"
      });
    }
    
    // Test 3: Webhook Secret Validation
    if (config.webhookSecret && config.webhookSecret.length > 0) {
      results.push({
        passed: true,
        message: `✅ Webhook secret configured`
      });
    } else {
      results.push({
        passed: false,
        message: `❌ Webhook secret missing for ${botType} bot`,
        details: botType === "preview" ? "WEBHOOK_SECRET_PREVIEW required" : "WEBHOOK_SECRET_PRODUCTION required"
      });
    }
    
    // Test 4: OpenRouter API Key Validation
    if (config.openRouterApiKey && config.openRouterApiKey.length > 0) {
      results.push({
        passed: true,
        message: `✅ OpenRouter API key configured`
      });
    } else {
      results.push({
        passed: false,
        message: `❌ OpenRouter API key missing`,
        details: "OPENROUTER_API_KEY required"
      });
    }
    
    // Test 5: Environment-specific validations
    const env = globalThis.Deno?.env;
    if (env) {
      if (botType === "production") {
        const prodToken = env.get("BOT_TOKEN");
        const prodSecret = env.get("WEBHOOK_SECRET_PRODUCTION");
        
        if (prodToken) {
          results.push({
            passed: true,
            message: `✅ Production bot token environment variable set`
          });
        } else {
          results.push({
            passed: false,
            message: `❌ BOT_TOKEN environment variable not set`
          });
        }
        
        if (prodSecret) {
          results.push({
            passed: true,
            message: `✅ Production webhook secret environment variable set`
          });
        }
      } else if (botType === "preview") {
        const previewToken = env.get("PREVIEW_BOT_TOKEN");
        const previewSecret = env.get("WEBHOOK_SECRET_PREVIEW");
        
        if (previewToken) {
          results.push({
            passed: true,
            message: `✅ Preview bot token environment variable set`
          });
        } else {
          results.push({
            passed: false,
            message: `❌ PREVIEW_BOT_TOKEN environment variable not set`
          });
        }
        
        if (previewSecret) {
          results.push({
            passed: true,
            message: `✅ Preview webhook secret environment variable set`
          });
        }
      }
    }
    
  } catch (error) {
    results.push({
      passed: false,
      message: `❌ Configuration loading failed`,
      details: error.message
    });
  }
  
  return results;
}

function printResults(results: TestResult[]): boolean {
  console.log(`\n🔍 Test Results:`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  
  let allPassed = true;
  
  for (const result of results) {
    console.log(`   ${result.message}`);
    if (result.details) {
      console.log(`      💡 ${result.details}`);
    }
    if (!result.passed) {
      allPassed = false;
    }
  }
  
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  
  if (allPassed) {
    console.log("🎉 All configuration tests passed!");
    console.log("✅ Bot configuration is valid and ready for deployment");
  } else {
    console.log("⚠️  Some configuration tests failed!");
    console.log("❌ Please check environment variables and try again");
  }
  
  return allPassed;
}

// Main execution
const isMainModule = import.meta.url === `file://${globalThis.Deno?.args?.[0] || ''}` || 
                     globalThis.Deno?.mainModule === import.meta.url;

if (isMainModule) {
  console.log("🚀 Configuration Test Suite");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  
  const results = testConfiguration();
  const success = printResults(results);
  
  console.log(`\n📊 Summary: ${results.filter(r => r.passed).length}/${results.length} tests passed`);
  
  // Exit with appropriate code for CI/CD
  if (globalThis.Deno?.exit) {
    globalThis.Deno.exit(success ? 0 : 1);
  }
}