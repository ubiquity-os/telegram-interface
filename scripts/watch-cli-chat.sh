#!/bin/bash

# CLI Chat Watch Script with Proper Process Management
# Prevents orphaned processes

set -e

DENO_PID=""
FSWATCH_PID=""

# Cleanup function
cleanup() {
    echo "🧹 Cleaning up processes..."

    # Kill Deno process if running
    if [ ! -z "$DENO_PID" ] && kill -0 $DENO_PID 2>/dev/null; then
        echo "   Stopping Deno CLI chat (PID: $DENO_PID)"
        kill -TERM $DENO_PID 2>/dev/null || true
        wait $DENO_PID 2>/dev/null || true
    fi

    # Kill fswatch if running
    if [ ! -z "$FSWATCH_PID" ] && kill -0 $FSWATCH_PID 2>/dev/null; then
        echo "   Stopping file watcher (PID: $FSWATCH_PID)"
        kill -TERM $FSWATCH_PID 2>/dev/null || true
        wait $FSWATCH_PID 2>/dev/null || true
    fi

    echo "✅ Cleanup complete"
    exit 0
}

# Set up signal handlers
trap cleanup SIGINT SIGTERM EXIT

# Function to start the Deno CLI chat
start_cli_chat() {
    echo "🚀 Starting Deno CLI chat..."
    deno run --allow-write --allow-net --allow-env --allow-read src/cli-chat.ts &
    DENO_PID=$!
    echo "   CLI chat started with PID: $DENO_PID"
}

# Function to restart CLI chat on file changes
restart_cli_chat() {
    echo ""
    echo "📁 File change detected, restarting CLI chat..."

    # Kill current process
    if [ ! -z "$DENO_PID" ] && kill -0 $DENO_PID 2>/dev/null; then
        kill -TERM $DENO_PID 2>/dev/null || true
        wait $DENO_PID 2>/dev/null || true
    fi

    # Clear screen and restart
    clear
    start_cli_chat
}

echo "🎯 Starting CLI Chat Watch Mode"
echo "   Press Ctrl+C to stop"
echo ""

# Start the CLI chat initially
clear
start_cli_chat

# Start file watcher in background
echo "👀 Starting file watcher..."
fswatch -o ./src ./cli-chat.ts ./deno.json | while read f; do
    restart_cli_chat
done &
FSWATCH_PID=$!

echo "   File watcher started with PID: $FSWATCH_PID"
echo ""
echo "✅ Watch mode active - waiting for changes..."

# Wait for CLI chat process
wait $DENO_PID
