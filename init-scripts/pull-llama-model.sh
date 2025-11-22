#!/bin/bash
set -e
echo "Starting Ollama server..."
ollama serve & 
sleep 5
ollama pull ${LLM_MODEL}
echo 'Model ${LLM_MODEL} downloaded adn ready!'
wait