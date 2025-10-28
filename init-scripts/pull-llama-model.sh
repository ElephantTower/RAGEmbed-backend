#!/bin/bash
set -e
echo "Starting Ollama server..."
ollama serve & 
sleep 5
# for model in $MODEL_NAMES; do
#     echo "Installing model: $model"
#     ollama pull "$model"

#     if ollama list | grep -q "$model"; then
#       echo "Model $model installed successfully."
#     else
#       echo "Failed to install model $model."
#       exit 1
#     fi
# done
wait