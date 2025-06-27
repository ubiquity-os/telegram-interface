#!/bin/bash
while true; do
  clear
  deno run --allow-net --allow-env --allow-read --unstable-kv src/core/start-api-server.ts
  fswatch -1 ./src ./deno.json > /dev/null 2>&1
done
