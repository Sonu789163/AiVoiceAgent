# Real-Time Voice AI Agent Backend

A high-performance Node.js backend for real-time voice conversations using Deepgram STT, OpenAI GPT-4o-mini, and Murf.ai TTS.

## Architecture

```
Client (Browser/Twilio)
    ↓ (PCM Audio)
WebSocket /connection
    ↓
Deepgram Nova-2 (STT)
    ↓ (Transcript)
OpenAI GPT-4o-mini (LLM)
    ↓ (Text Tokens)
Murf.ai Falcon + Neha Voice (TTS)
    ↓ (Audio Chunks)
Client (WebSocket)
```

## Features

- **Low Latency**: Streaming architecture for real-time responses
- **WebSocket**: Full-duplex communication
- **Azure Ready**: Configured for Azure App Service deployment
- **Voice Pipeline**: Complete STT → LLM → TTS pipeline

## Prerequisites

- Node.js v20 or higher
- API Keys:
  - Deepgram API Key
  - OpenAI API Key
  - Murf.ai API Key

## Installation

1. Install dependencies:
```bash
npm install
```

2. Create `.env` file from `.env.example`:
```bash
cp .env.example .env
```

3. Add your API keys to `.env`:
```
DEEPGRAM_API_KEY=your_key_here
OPENAI_API_KEY=your_key_here
MURF_API_KEY=your_key_here
```

## Running Locally

```bash
npm start
```

Or with auto-reload:
```bash
npm run dev
```

The server will start on `http://localhost:8080`

## API Endpoints

### Health Check
```
GET /health
```
Returns server status (used by Azure Load Balancer).

### WebSocket Connection
```
WS /connection
```
Main WebSocket endpoint for voice communication.

**Client → Server**: Send raw PCM 16-bit, 16kHz audio bytes
**Server → Client**: Receive audio chunks from TTS

## Deployment to Azure App Service

1. Ensure `process.env.PORT` is used (already configured)
2. Deploy via Azure Portal, CLI, or GitHub Actions
3. Set environment variables in Azure App Service Configuration:
   - `DEEPGRAM_API_KEY`
   - `OPENAI_API_KEY`
   - `MURF_API_KEY`
   - `PORT` (automatically set by Azure)

## Audio Format

- **Input**: PCM 16-bit, 16kHz, mono
- **Output**: PCM 16-bit, 16kHz, mono (from Murf.ai)

## System Prompt

The AI agent is configured as "Riya, a helpful admissions assistant" with concise responses (under 2 sentences).

## Notes

- The pipeline buffers OpenAI tokens into complete sentences before sending to TTS
- Deepgram's `SpeechFinal` event triggers the LLM → TTS pipeline
- Audio chunks are streamed directly to the client as they're generated



