#!/bin/bash
cd /home/z/my-project
exec node node_modules/.bin/next dev --port 3000 2>&1
