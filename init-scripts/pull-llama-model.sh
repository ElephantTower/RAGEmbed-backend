#!/bin/bash
set -e  # Остановка при ошибке

echo "Installing model: $MODEL_NAME"
ollama pull "$MODEL_NAME"

if ollama list | grep -q "$MODEL_NAME"; then
  echo "Model $MODEL_NAME installed successfully."
else
  echo "Failed to install model $MODEL_NAME."
  exit 1
fi

echo "Starting Ollama server..."
exec ollama serve