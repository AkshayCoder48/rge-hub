#!/bin/bash
cd /home/z/my-project
# Kill any existing server
pkill -f "next dev" 2>/dev/null
pkill -f "next-server" 2>/dev/null
sleep 1
# Start the server
exec node node_modules/.bin/next dev --port 3000
