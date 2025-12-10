import { useState, useEffect, useRef } from 'react';
import '../App.css';

const WS_URL = (() => {
    const url = import.meta.env.VITE_WS_URL;
    if (url.startsWith('https://')) {
        return url.replace('https://', 'wss://');
    } else if (url.startsWith('http://')) {
        return url.replace('http://', 'ws://');
    }
    return url;
})();

function VoiceAgentPage({ onAgentStatusChange }) {
    const [isConnected, setIsConnected] = useState(false);
    const [isCallActive, setIsCallActive] = useState(false);
    const [status, setStatus] = useState('idle');
    const [error, setError] = useState(null);

    const wsRef = useRef(null);
    const mediaRecorderRef = useRef(null);
    const audioContextRef = useRef(null);
    const audioQueueRef = useRef([]);
    const isPlayingRef = useRef(false);
    const audioBufferRef = useRef(null);
    const isCallActiveRef = useRef(false);
    const recognitionRef = useRef(null);
    const useWebSpeechAPI = true;
    const ttsQueueRef = useRef([]);
    const isSpeakingRef = useRef(false);
    const pcmBufferRef = useRef(new Uint8Array(0));
    const lastChunkTimeRef = useRef(Date.now());
    const networkMonitorRef = useRef(null);
    const silenceTimerRef = useRef(null);
    const lastSpeechTimeRef = useRef(0);
    const interimTranscriptRef = useRef('');

    // Notify parent when call status changes
    useEffect(() => {
        if (onAgentStatusChange) {
            onAgentStatusChange(isCallActive);
        }
    }, [isCallActive, onAgentStatusChange]);

    // ... (rest of your existing App.jsx code will go here)
    // This is just a placeholder - you'll copy the entire App.jsx content here

    return (
        <div className="App">
            <h1>🎙️ AI Voice Agent - Admission Counselor</h1>

            {error && (
                <div className="error-message">
                    <p>{error}</p>
                    <button onClick={() => setError(null)}>Dismiss</button>
                </div>
            )}

            <div className="status-container">
                <div className={`status-indicator ${isConnected ? 'connected' : 'disconnected'}`}>
                    {isConnected ? '🟢 Connected' : '🔴 Disconnected'}
                </div>
                <div className={`call-status ${isCallActive ? 'active' : 'inactive'}`}>
                    {isCallActive ? '📞 Call Active' : '📵 No Active Call'}
                </div>
                <div className={`agent-status status-${status}`}>
                    Status: {status}
                </div>
            </div>

            <div className="controls">
                {!isCallActive ? (
                    <button
                        className="start-call-btn"
                        onClick={() => {/* startCall logic */ }}
                        disabled={!isConnected}
                    >
                        📞 Start Call
                    </button>
                ) : (
                    <button
                        className="end-call-btn"
                        onClick={() => {/* stopCall logic */ }}
                    >
                        ❌ End Call
                    </button>
                )}
            </div>

            <div className="info-panel">
                <p>Click "Start Call" to begin talking with the AI admission counselor.</p>
                <p>The agent will help you with course selection, admissions, and career guidance.</p>
            </div>
        </div>
    );
}

export default VoiceAgentPage;
