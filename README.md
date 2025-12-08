# AI Voice Agent

A real-time voice agent for hotel management admissions using AI-powered speech recognition and text-to-speech.

## Features

- 🎤 **Real-time Voice Conversation** - Natural conversation flow with low latency
- 🤖 **AI-Powered** - Uses OpenAI GPT-4o-mini for intelligent responses
- 🔊 **High-Quality TTS** - ElevenLabs for natural-sounding voice
- 📊 **Data Collection** - Automatically extracts and saves student information to Google Sheets
- 🌐 **Multilingual** - Supports English and Hindi (Hinglish)
- 📝 **Real-time Transcription** - Web Speech API for speech-to-text

## Tech Stack

### Frontend
- React + Vite
- Web Speech API (Speech Recognition)
- Web Audio API (Audio Playback)
- WebSocket for real-time communication

### Backend
- Node.js + Fastify
- OpenAI API (GPT-4o-mini)
- ElevenLabs API (Text-to-Speech)
- Deepgram API (Speech-to-Text - optional)
- Google Sheets API (Data Storage)

## Setup

### Prerequisites
- Node.js 18+ 
- Google Cloud Service Account (for Sheets)
- API Keys:
  - OpenAI API Key
  - ElevenLabs API Key
  - Deepgram API Key (optional)

### Backend Setup

1. Navigate to backend directory:
```bash
cd backend
```

2. Install dependencies:
```bash
npm install
```

3. Create `.env` file:
```env
OPENAI_API_KEY=your_openai_key
ELEVENLABS_API_KEY=your_elevenlabs_key
DEEPGRAM_API_KEY=your_deepgram_key
ELEVENLABS_VOICE_ID=your_voice_id
GOOGLE_SERVICE_ACCOUNT_PATH=/path/to/credentials.json
```

4. Start the server:
```bash
npm run dev
```

### Frontend Setup

1. Navigate to frontend directory:
```bash
cd frontend
```

2. Install dependencies:
```bash
npm install
```

3. Create `.env` file:
```env
VITE_WS_URL=ws://localhost:8080/connection
```

4. Start the dev server:
```bash
npm run dev
```

## Google Sheets Setup

1. Create a Google Cloud Project
2. Enable Google Sheets API
3. Create a Service Account
4. Download the JSON credentials
5. Share your Google Sheet with the service account email
6. Update the spreadsheet ID in `backend/services/googleSheets.js`

### Sheet Structure
| SessionId | Stu. Name | Phone Number | Course | Phone no. | City | Education | Intake Year | Budget |
|-----------|-----------|--------------|--------|-----------|------|-----------|-------------|--------|

## Usage

1. Start both backend and frontend servers
2. Open the frontend in your browser
3. Click "Start Call"
4. Speak to the agent
5. Data is automatically saved to Google Sheets

## Architecture

```
User → Web Speech API → WebSocket → Backend
                                      ↓
                                   OpenAI GPT-4o-mini
                                      ↓
                                   ElevenLabs TTS
                                      ↓
                                   WebSocket → Frontend → Web Audio API → User
                                      ↓
                                   Google Sheets
```

## Features in Detail

### Low Latency Audio
- 512-byte buffer for minimal delay
- Smart audio scheduling
- Seamless chunk playback

### Smart Recognition Management
- Stops during agent speech (prevents echo)
- Restarts immediately after agent finishes
- Handles network errors gracefully

### Data Extraction
- Real-time extraction from conversation
- Incremental updates to Google Sheets
- Supports: Name, Phone, Course, Education, Year, City, Budget

## License

MIT

## Author

Sonu789163
