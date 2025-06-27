#!/bin/bash
while true; do
  clear
  deno run --allow-net --allow-env --allow-read src/cli-chat.ts
  fswatch -1 ./src ./cli-chat.ts ./deno.json > /dev/null 2>&1
done
