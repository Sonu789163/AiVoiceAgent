# Voice AI Agent Frontend

A modern React + Vite frontend for the Real-Time Voice AI Agent, featuring a beautiful UI with real-time voice communication.

## Features

- 🎙️ **Real-time Voice Communication**: WebSocket-based audio streaming
- 🎨 **Modern UI**: Beautiful gradient design with smooth animations
- 📊 **Status Indicators**: Visual feedback for listening, processing, and speaking states
- 🎯 **Easy to Use**: Simple Start/End call interface
- 📱 **Responsive**: Works on desktop and mobile devices

## Tech Stack

- **React 18**: UI framework
- **Vite**: Build tool and dev server
- **WebSocket API**: Real-time communication
- **Web Audio API**: Audio recording and playback

## Installation

1. Install dependencies:
```bash
npm install
```

2. Create `.env` file (optional, defaults to `ws://localhost:8080/connection`):
```bash
cp .env.example .env
```

3. Update `.env` with your backend WebSocket URL if needed:
```
VITE_WS_URL=ws://localhost:8080/connection
```

## Running Locally

1. Make sure the backend is running on port 8080 (or update `VITE_WS_URL`)

2. Start the development server:
```bash
npm run dev
```

3. Open your browser to `http://localhost:3000`

## Building for Production

```bash
npm run build
```

The built files will be in the `dist` directory.

## Usage

1. **Start Call**: Click the "Start Call" button to begin
   - The app will request microphone permissions
   - WebSocket connection will be established
   - Status will show "Listening..."

2. **Speak**: Talk naturally into your microphone
   - Your audio is streamed to the backend in real-time
   - The backend processes your speech and generates a response

3. **Listen**: Wait for the agent (Riya) to respond
   - Status will show "Agent speaking..." while audio plays
   - Audio is streamed back from the backend

4. **End Call**: Click "End Call" when finished
   - Microphone access is released
   - WebSocket connection is closed

## Audio Format

- **Input**: PCM 16-bit, 16kHz, mono (converted from browser audio)
- **Output**: PCM 16-bit, 16kHz, mono (from backend TTS)

## Browser Compatibility

- Chrome/Edge: Full support
- Firefox: Full support
- Safari: May require additional configuration for WebSocket

## Troubleshooting

### Microphone Not Working
- Check browser permissions for microphone access
- Ensure HTTPS or localhost (required for getUserMedia)

### Connection Issues
- Verify backend is running on the correct port
- Check `VITE_WS_URL` in `.env` file
- Check browser console for WebSocket errors

### Audio Playback Issues
- Check browser audio settings
- Ensure audio is not muted
- Try refreshing the page



