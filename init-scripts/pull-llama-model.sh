#!/bin/bash
set -e
echo "Starting Ollama server..."
ollama serve & 
sleep 5
wait