#!/bin/bash

# API Server Watch Script with Proper Process Management
# Prevents orphaned processes and port conflicts

set -e

PORT=8001
DENO_PID=""
FSWATCH_PID=""

# Cleanup function
cleanup() {
    echo "🧹 Cleaning up processes..."

    # Kill Deno server if running
    if [ ! -z "$DENO_PID" ] && kill -0 $DENO_PID 2>/dev/null; then
        echo "   Stopping Deno server (PID: $DENO_PID)"
        kill -TERM $DENO_PID 2>/dev/null || true
        wait $DENO_PID 2>/dev/null || true
    fi

    # Kill fswatch if running
    if [ ! -z "$FSWATCH_PID" ] && kill -0 $FSWATCH_PID 2>/dev/null; then
        echo "   Stopping file watcher (PID: $FSWATCH_PID)"
        kill -TERM $FSWATCH_PID 2>/dev/null || true
        wait $FSWATCH_PID 2>/dev/null || true
    fi

    # Force kill any process on our port
    lsof -ti:$PORT | xargs kill -9 2>/dev/null || true

    echo "✅ Cleanup complete"
    exit 0
}

# Set up signal handlers
trap cleanup SIGINT SIGTERM EXIT

# Function to start the Deno server
start_server() {
    echo "🚀 Starting Deno API server on port $PORT..."
    deno run --allow-write --allow-net --allow-env --allow-read --unstable-kv src/core/start-api-server.ts &
    DENO_PID=$!
    echo "   Server started with PID: $DENO_PID"
}

# Function to restart server on file changes
restart_server() {
    echo ""
    echo "📁 File change detected, restarting server..."

    # Kill current server
    if [ ! -z "$DENO_PID" ] && kill -0 $DENO_PID 2>/dev/null; then
        kill -TERM $DENO_PID 2>/dev/null || true
        wait $DENO_PID 2>/dev/null || true
    fi

    # Clear screen and restart
    clear
    start_server
}

echo "🎯 Starting API Server Watch Mode"
echo "   Port: $PORT"
echo "   Press Ctrl+C to stop"
echo ""

# Clear any existing processes on the port
lsof -ti:$PORT | xargs kill -9 2>/dev/null || true

# Start the server initially
clear
start_server

# Start file watcher in background
echo "👀 Starting file watcher..."
fswatch -o ./src ./deno.json | while read f; do
    restart_server
done &
FSWATCH_PID=$!

echo "   File watcher started with PID: $FSWATCH_PID"
echo ""
echo "✅ Watch mode active - waiting for changes..."

# Wait for server process
wait $DENO_PID
