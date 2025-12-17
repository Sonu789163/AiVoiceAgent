import { useState, useEffect, useRef } from 'react';
import './App.css';
import { AdvancedEchoCanceller } from './audioProcessor.js';

const WS_URL = (() => {
  const url = `${import.meta.env.VITE_WS_URL}/connection`;
  // import.meta.env.VITE_WS_URL ;
  // Convert HTTP/HTTPS to WS/WSS for WebSocket connections
  if (url.startsWith('https://')) {
    return url.replace('https://', 'wss://');
  } else if (url.startsWith('http://')) {
    return url.replace('http://', 'ws://');
  }
  return url; // Already ws:// or wss://
})();

function App({ onCallStatusChange }) {
  const [isConnected, setIsConnected] = useState(false);
  const [isCallActive, setIsCallActive] = useState(false);
  const [status, setStatus] = useState('idle'); // idle, listening, processing, speaking
  const [error, setError] = useState(null);

  const wsRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioContextRef = useRef(null);
  const audioQueueRef = useRef([]);
  const isPlayingRef = useRef(false);
  const audioBufferRef = useRef(null);
  const isCallActiveRef = useRef(false); // Use ref to track call state in audio callback
  const recognitionRef = useRef(null); // Web Speech API recognition
  const useWebSpeechAPI = true; // Set to true to use free Web Speech API instead of Deepgram
  const ttsQueueRef = useRef([]); // Queue for TTS utterances
  const isSpeakingRef = useRef(false); // Track if currently speaking
  const pcmBufferRef = useRef(new Uint8Array(0)); // Buffer for accumulating PCM chunks
  const lastChunkTimeRef = useRef(Date.now()); // Track last chunk arrival time for network monitoring
  const networkMonitorRef = useRef(null); // Network monitoring interval
  const silenceTimerRef = useRef(null); // Timer for Turbo VAD
  const lastSpeechTimeRef = useRef(0); // Timestamp of last interim speech
  const interimTranscriptRef = useRef(''); // Buffer for interim transcript
  const echoCancellerRef = useRef(null); // Echo cancellation processor

  // Notify parent component when call status changes
  useEffect(() => {
    if (onCallStatusChange) {
      onCallStatusChange(isCallActive);
    }
  }, [isCallActive, onCallStatusChange]);

  useEffect(() => {
    return () => {
      // Cleanup on unmount
      // Stop network monitoring
      clearInterval(networkMonitorRef.current);
      networkMonitorRef.current = null;

      // Stop Turbo VAD timer
      if (silenceTimerRef.current) {
        clearInterval(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }

      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch (e) {
          // Ignore cleanup errors
        }
      }

      // Cleanup media recorder (our custom object with stream, processor, source)
      if (mediaRecorderRef.current) {
        try {
          if (mediaRecorderRef.current.stream) {
            mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
          }
          if (mediaRecorderRef.current.processor) {
            mediaRecorderRef.current.processor.disconnect();
          }
          if (mediaRecorderRef.current.source) {
            mediaRecorderRef.current.source.disconnect();
          }
        } catch (e) {
          // Ignore cleanup errors
        }
        mediaRecorderRef.current = null;
      }

      // Cleanup echo canceller
      if (echoCancellerRef.current) {
        try {
          echoCancellerRef.current.destroy();
        } catch (e) {
          // Ignore cleanup errors
        }
        echoCancellerRef.current = null;
      }

      if (audioContextRef.current) {
        try {
          audioContextRef.current.close();
        } catch (e) {
          // Ignore cleanup errors
        }
      }
    };
  }, []);

  // Monitor recognition state and ensure it stays active during call
  useEffect(() => {
    if (!isCallActive || !useWebSpeechAPI) {
      return;
    }

    // More aggressive periodic check to ensure recognition is running
    const recognitionCheckInterval = setInterval(() => {
      // Don't restart if speaking or playing audio (prevent echo)
      if (isCallActiveRef.current && recognitionRef.current && !isSpeakingRef.current && !isPlayingRef.current) {
        // Try to restart recognition if it's not running
        try {
          recognitionRef.current.start();
        } catch (e) {
          const errorMsg = e.message || String(e);
          // If it's already running, that's fine - ignore the error
          if (!errorMsg.includes('already') && !errorMsg.includes('started')) {
            console.log('🔄 Recognition check: attempting restart...');
            restartRecognition();
          }
        }
      }
    }, 1000); // Check every 1 second (very frequent)

    return () => {
      clearInterval(recognitionCheckInterval);
    };
  }, [isCallActive, useWebSpeechAPI]);

  const connectWebSocket = () => {
    try {
      const ws = new WebSocket(WS_URL);
      ws.binaryType = 'arraybuffer'; // ensure we get ArrayBuffer for audio
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('WebSocket connected');
        setIsConnected(true);
        setError(null);

        // Start network monitoring to detect connection issues
        if (networkMonitorRef.current) {
          clearInterval(networkMonitorRef.current);
        }
        lastChunkTimeRef.current = Date.now(); // Reset timer
        networkMonitorRef.current = setInterval(() => {
          const timeSinceLastChunk = Date.now() - lastChunkTimeRef.current;
          // If no chunks received for 5 seconds during active call, there might be a network issue
          if (isCallActive && timeSinceLastChunk > 5000 && isPlayingRef.current) {
            console.warn('⚠️ No audio chunks received for 5 seconds - possible network issue');
          }
        }, 2000); // Check every 2 seconds
      };

      ws.onmessage = (event) => {
        // Handle text messages (TTS text or errors)
        if (typeof event.data === 'string') {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'tts_text' && data.text) {
              console.log('📝 Received TTS text (fallback to Web Speech API):', data.text);
              // Use Web Speech API for TTS (free, browser-based)
              speakText(data.text);
            } else if (data.type === 'end_call') {
              console.log('📞 Received end_call signal from backend - ending call automatically');
              // Automatically end the call after confirmation
              setTimeout(() => {
                stopCall();
              }, 1500); // Small delay to ensure final message is heard
            } else if (data.type === 'ai_response') {
              console.log('🤖 AI RESPONSE:', data.text);
            } else if (data.error) {
              setError(data.error);
            }
          } catch (e) {
            // Not JSON, ignore
          }
        } else if (event.data instanceof ArrayBuffer || event.data instanceof Blob) {
          // Handle audio chunks from ElevenLabs
          // Reduced logging to prevent performance issues
          handleAudioChunk(event.data);
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        // Don't immediately show error - try to reconnect
        if (!isCallActive) {
          setError('Connection error. Please ensure the backend is running on port 8080.');
        }
        setIsConnected(false);
      };

      ws.onclose = (event) => {
        console.log('WebSocket disconnected', event.code, event.reason?.toString());
        setIsConnected(false);

        // Stop network monitoring
        if (networkMonitorRef.current) {
          clearInterval(networkMonitorRef.current);
          networkMonitorRef.current = null;
        }

        if (isCallActive) {
          stopCall();
        }
        // Show error with details if it wasn't a clean close
        // 1000 = Normal closure, 1001 = Going away, 1005 = No status received
        if (event.code !== 1000 && event.code !== 1001) {
          const reason = event.reason || 'Unknown reason';
          if (event.code === 1005) {
            // No status received - connection closed without proper handshake
            // This is usually fine if user initiated the close
            console.log('Connection closed without status (likely user-initiated)');
            // Don't show error for 1005 if call was already stopped
            if (isCallActive) {
              setError('Connection closed unexpectedly. Please try again.');
            }
          } else if (event.code === 1006) {
            setError('Connection closed abnormally. The backend may have encountered an error (check backend logs). This often happens if Deepgram API key is invalid or there\'s a configuration issue.');
          } else {
            setError(`Connection lost (code: ${event.code}, reason: ${reason}). Please try again.`);
          }
        }
      };
    } catch (error) {
      console.error('Failed to connect:', error);
      setError('Failed to connect to server. Please check the backend URL.');
    }
  };

  // Web Speech API TTS function (free, browser-based) with queue
  const speakText = (text) => {
    if (!text || text.trim().length === 0) return;

    console.log('🔊 Queueing text for TTS:', text);

    // Add to queue
    ttsQueueRef.current.push(text);

    // Start processing queue if not already speaking
    if (!isSpeakingRef.current) {
      processTTSQueue();
    }
  };

  // Helper function to restart recognition robustly
  const restartRecognition = () => {
    if (!isCallActiveRef.current || !recognitionRef.current) {
      return;
    }

    // Check if recognition is already running by checking its state
    // Note: Web Speech API doesn't expose a direct state property, so we use try-catch
    try {
      recognitionRef.current.start();
      console.log('✅ Web Speech API recognition started');
    } catch (e) {
      const errorMsg = e.message || String(e);
      if (errorMsg.includes('already') || errorMsg.includes('started') || errorMsg.includes('aborted')) {
        console.log('ℹ️ Recognition already running or starting');
        // If it's already running, that's fine - but ensure it stays running
        // Sometimes recognition stops silently, so we'll try again after a short delay
        setTimeout(() => {
          if (isCallActiveRef.current && recognitionRef.current) {
            try {
              recognitionRef.current.start();
            } catch (e2) {
              // Ignore "already started" errors
              const msg2 = e2.message || String(e2);
              if (!msg2.includes('already') && !msg2.includes('started')) {
                console.warn('⚠️ Recognition restart warning:', msg2);
              }
            }
          }
        }, 200);
      } else {
        console.log('⚠️ Recognition error, will retry:', errorMsg);
        // Retry after a delay
        setTimeout(() => {
          if (isCallActiveRef.current && recognitionRef.current) {
            try {
              recognitionRef.current.start();
              console.log('✅ Web Speech API recognition restarted (retry)');
            } catch (e2) {
              console.error('❌ Failed to restart recognition:', e2.message);
              // Last resort: try one more time after a longer delay
              setTimeout(() => {
                if (isCallActiveRef.current && recognitionRef.current) {
                  try {
                    recognitionRef.current.start();
                    console.log('✅ Web Speech API recognition restarted (final retry)');
                  } catch (e3) {
                    console.error('❌ Final retry failed:', e3.message);
                  }
                }
              }, 300);
            }
          }
        }, 200);
      }
    }
  };

  const processTTSQueue = () => {
    if (ttsQueueRef.current.length === 0) {
      isSpeakingRef.current = false;
      setStatus(isCallActive ? 'listening' : 'idle');

      // Notify echo canceller that speaker is no longer active
      if (echoCancellerRef.current) {
        echoCancellerRef.current.disconnectSpeakerReference();
      }

      // After all speech is done, ensure recognition is still running
      // Use a longer delay to ensure audio playback has fully completed
      setTimeout(() => {
        restartRecognition();
      }, 800); // Increased delay to ensure speech is fully complete
      return;
    }

    if (!('speechSynthesis' in window)) {
      console.warn('⚠️ SpeechSynthesis not supported in this browser');
      ttsQueueRef.current = [];
      isSpeakingRef.current = false;
      setStatus(isCallActive ? 'listening' : 'idle');
      return;
    }

    isSpeakingRef.current = true;
    setStatus('speaking');

    // Notify echo canceller that speaker is active
    if (echoCancellerRef.current) {
      echoCancellerRef.current.isSpeakerActive = true;
    }

    const text = ttsQueueRef.current.shift();
    console.log('🔊 Speaking text:', text);

    const utterance = new SpeechSynthesisUtterance(text);

    // Try to find an Indian English voice, fallback to default
    const voices = window.speechSynthesis.getVoices();
    const indianVoice = voices.find(voice =>
      voice.lang.includes('en') && (
        voice.name.toLowerCase().includes('india') ||
        voice.name.toLowerCase().includes('neha') ||
        voice.name.toLowerCase().includes('priya') ||
        voice.name.toLowerCase().includes('rishi')
      )
    ) || voices.find(voice => voice.lang.startsWith('en'));

    if (indianVoice) {
      utterance.voice = indianVoice;
      console.log('🎙️ Using voice:', indianVoice.name);
    }

    // Speed up speech a bit to make responses feel more snappy
    utterance.rate = 1.25; // Increase if you want it faster (max ~2.0)
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    utterance.onend = () => {
      console.log('✅ Speech completed');
      // Process next item in queue (will handle recognition restart when queue is empty)
      processTTSQueue();
    };

    utterance.onerror = (error) => {
      // "interrupted" is expected when new speech starts, ignore it
      if (error.error === 'interrupted') {
        console.log('ℹ️ Speech interrupted (expected when new text arrives)');
      } else {
        console.error('❌ Speech synthesis error:', error.error);
      }
      // Process next item in queue even on error
      processTTSQueue();
    };

    window.speechSynthesis.speak(utterance);
  };

  const handleAudioChunk = async (audioData) => {
    // Update last chunk time for network monitoring
    lastChunkTimeRef.current = Date.now();

    console.log('🔊 Received audio chunk, size:', audioData.byteLength || audioData.size || 'unknown');

    // Ensure audio context is initialized and resumed
    if (!audioContextRef.current) {
      console.log('⚠️ Audio context not initialized, creating now...');
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 16000,
      });
      console.log('✅ Audio context created, state:', audioContextRef.current.state);
    }

    const audioContext = audioContextRef.current;
    console.log('📊 Audio context state:', audioContext.state);

    // Resume audio context if suspended (browser autoplay policy)
    if (audioContext.state === 'suspended') {
      try {
        await audioContext.resume();
        console.log('✅ Audio context resumed, new state:', audioContext.state);
      } catch (error) {
        console.error('❌ Failed to resume audio context:', error);
      }
    }

    // Convert Blob to ArrayBuffer if needed
    let arrayBuffer = audioData instanceof Blob
      ? await audioData.arrayBuffer()
      : audioData instanceof ArrayBuffer
        ? audioData
        : audioData.buffer;

    // Handle raw PCM audio (16-bit, 16kHz)
    const newData = new Uint8Array(arrayBuffer);
    const combined = new Uint8Array(pcmBufferRef.current.length + newData.length);
    combined.set(pcmBufferRef.current);
    combined.set(newData, pcmBufferRef.current.length);
    pcmBufferRef.current = combined;

    // Process when we have at least 512 bytes for minimal latency
    const MIN_CHUNK_SIZE = 512;

    while (pcmBufferRef.current.length >= MIN_CHUNK_SIZE) {
      // Extract a chunk of proper size
      const chunkSize = Math.floor(pcmBufferRef.current.length / MIN_CHUNK_SIZE) * MIN_CHUNK_SIZE;
      const chunk = pcmBufferRef.current.slice(0, chunkSize);
      pcmBufferRef.current = pcmBufferRef.current.slice(chunkSize);

      // Add to queue
      audioQueueRef.current.push(chunk.buffer);
    }

    // Start playing if we have enough chunks (Jitter Buffer)
    // Wait for 3 chunks or if we have a lot of data to ensure smooth playback
    // This adds a small initial latency but prevents "nervous" stuttering
    const MIN_CHUNKS_TO_START = 3;
    if (!isPlayingRef.current && audioQueueRef.current.length >= MIN_CHUNKS_TO_START) {
      console.log('▶️ Jitter buffer full, starting playback');
      playAudioQueue();
    } else if (!isPlayingRef.current && audioQueueRef.current.length > 0) {
      // Safety timeout: if we don't get 3 chunks within 500ms, start anyway
      // This prevents hanging if the response is very short (shorter than 3 chunks)
      if (!audioContextRef.current.bufferTimeout) {
        audioContextRef.current.bufferTimeout = setTimeout(() => {
          if (!isPlayingRef.current && audioQueueRef.current.length > 0) {
            console.log('▶️ Jitter buffer timeout, starting playback early');
            playAudioQueue();
          }
          audioContextRef.current.bufferTimeout = null;
        }, 500);
      }
    }
  };

  const activeSourcesRef = useRef([]); // Track active audio sources for interruption

  const stopAgentSpeech = () => {
    // 1. Stop all currently playing audio sources
    activeSourcesRef.current.forEach(source => {
      try {
        source.stop();
      } catch (e) {
        // Ignore errors if already stopped
      }
    });
    activeSourcesRef.current = [];

    // 2. Clear audio queues
    audioQueueRef.current = [];
    pcmBufferRef.current = new Uint8Array(0); // Fixed: Use Uint8Array to match buffer type

    // 3. Cancel any browser TTS
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    ttsQueueRef.current = [];

    // 4. Reset flags
    isPlayingRef.current = false;
    isSpeakingRef.current = false;

    // 5. Update UI
    if (isCallActiveRef.current) {
      setStatus('listening');
    }

    console.log('🛑 Agent speech interrupted (Barge-in)');
  };

  const playAudioQueue = async () => {
    if (isPlayingRef.current || audioQueueRef.current.length === 0) {
      return;
    }

    isPlayingRef.current = true;
    setStatus('speaking');

    // Notify echo canceller that speaker is active
    if (echoCancellerRef.current) {
      echoCancellerRef.current.isSpeakerActive = true;
    }

    // BARGE-IN ENABLED with ECHO CANCELLATION: Keep recognition running during playback
    // Echo cancellation removes the agent's voice from microphone input
    // This allows the user to interrupt the agent at any time, even with speakers!
    console.log('▶️ Starting playback (recognition stays active with echo cancellation)');

    try {
      // Audio context should already be initialized
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({
          sampleRate: 16000,
        });
      }

      const audioContext = audioContextRef.current;

      // Resume audio context if suspended (browser autoplay policy)
      if (audioContext.state === 'suspended') {
        try {
          await audioContext.resume();
          console.log('✅ Audio context resumed in playAudioQueue');
        } catch (error) {
          console.error('❌ Failed to resume audio context:', error);
        }
      }

      // Initialize nextStartTime if not set
      if (!audioContextRef.current.nextStartTime) {
        audioContextRef.current.nextStartTime = audioContext.currentTime;
      }

      // Process all available chunks
      const sources = [];

      while (audioQueueRef.current.length > 0) {
        const chunk = audioQueueRef.current.shift();

        // Convert PCM 16-bit, 16kHz to AudioBuffer
        const audioBuffer = createPCMBuffer(audioContext, chunk);
        if (!audioBuffer) {
          continue; // skip invalid chunks
        }

        const source = audioContext.createBufferSource();
        source.buffer = audioBuffer;

        // Connect to destination for playback
        source.connect(audioContext.destination);

        // ECHO CANCELLATION: Connect to echo canceller reference signal
        // TEMPORARILY DISABLED FOR TESTING - Re-enable after confirming playback works
        /*
        if (echoCancellerRef.current && echoCancellerRef.current.isSpeakerActive) {
          echoCancellerRef.current.connectSpeakerReference(source);
        }
        */

        // Schedule playback
        // If we fell behind real-time (underrun), jump to current time + small buffer
        let startTime = Math.max(audioContext.currentTime, audioContextRef.current.nextStartTime);

        // If we're resetting (gap > 0.1s), add a larger delay to allow network to catch up
        if (startTime === audioContext.currentTime) {
          startTime += 0.05; // 50ms safety buffer (Jitter tolerance)
        }

        source.start(startTime);

        // Track source for interruption
        activeSourcesRef.current.push(source);
        source.onended = () => {
          // Remove from active sources when done
          activeSourcesRef.current = activeSourcesRef.current.filter(s => s !== source);
        };

        sources.push({ source, endTime: startTime + audioBuffer.duration });

        // Update next start time
        audioContextRef.current.nextStartTime = startTime + audioBuffer.duration;
      }

      // Wait for playback to complete (keeps 'speaking' state active)
      if (sources.length > 0) {
        const lastEndTime = sources[sources.length - 1].endTime;
        const waitTime = (lastEndTime - audioContext.currentTime) * 1000;

        if (waitTime > 0) {
          // Minimal wait for low latency - just 10ms overhead
          await new Promise(resolve => setTimeout(resolve, waitTime + 10));
        }
      }

    } catch (error) {
      console.error('Error playing audio:', error);
    } finally {
      // Only proceed if we haven't been interrupted
      // If activeSourcesRef is empty but we were playing, means we were interrupted
      if (isPlayingRef.current) {
        isPlayingRef.current = false;

        // Check if more chunks arrived while playing
        // Lower threshold to flush remaining audio at end of sentence
        if (audioQueueRef.current.length > 0 || pcmBufferRef.current.length >= 512) {
          // Continue playing immediately
          setTimeout(() => playAudioQueue(), 0);
        } else {
          // No more chunks, update status
          // Note: Recognition is ALREADY running, so we don't need to restart it!
          setStatus(isCallActive ? 'listening' : 'idle');

          // Notify echo canceller that speaker is no longer active
          // DON'T disconnect - just set flag to false
          if (echoCancellerRef.current) {
            echoCancellerRef.current.isSpeakerActive = false;
            console.log('🔇 Speaker inactive (echo canceller still connected)');
          }

          // Restart recognition after speaking
          if (isCallActive) {
            restartRecognition();
          }
        }
      }
    }
  };

  const createPCMBuffer = (audioContext, arrayBuffer) => {
    // Guard against empty buffers
    if (!arrayBuffer || arrayBuffer.byteLength < 2) {
      return null;
    }

    // Convert PCM 16-bit, 16kHz to AudioBuffer
    const sampleRate = 16000;
    // 16-bit = 2 bytes per sample, so length is byteLength / 2
    const length = Math.floor(arrayBuffer.byteLength / 2);
    const buffer = audioContext.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);
    const view = new DataView(arrayBuffer);

    for (let i = 0; i < length; i++) {
      const int16 = view.getInt16(i * 2, true); // Little-endian
      // Direct conversion to float [-1.0, 1.0] without any extra processing
      data[i] = int16 / 32768.0;
    }

    return buffer;
  };

  const startCall = async () => {
    try {
      setError(null);

      // Initialize audio context early to ensure it's ready for playback
      // This helps with browser autoplay policy - user interaction (clicking Start Call) allows audio
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({
          sampleRate: 16000,
        });
        console.log('✅ Audio context initialized');
      }

      // Resume audio context if suspended (browser autoplay policy)
      if (audioContextRef.current.state === 'suspended') {
        try {
          await audioContextRef.current.resume();
          console.log('✅ Audio context resumed at call start');
        } catch (error) {
          console.error('❌ Failed to resume audio context:', error);
        }
      }

      // Create gain node early
      if (!audioContextRef.current.gainNode) {
        audioContextRef.current.gainNode = audioContextRef.current.createGain();
        audioContextRef.current.gainNode.gain.value = 1.0;
        audioContextRef.current.gainNode.connect(audioContextRef.current.destination);
        console.log('✅ Gain node created');
      }

      // Connect WebSocket if not connected
      if (!isConnected || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        connectWebSocket();

        // Wait for connection with timeout
        let attempts = 0;
        const maxAttempts = 20; // 2 seconds total

        while (attempts < maxAttempts) {
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            setIsConnected(true);
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
          attempts++;
        }

        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
          const state = wsRef.current ? wsRef.current.readyState : 'null';
          const stateNames = { 0: 'CONNECTING', 1: 'OPEN', 2: 'CLOSING', 3: 'CLOSED' };
          console.error('WebSocket connection failed. State:', state, stateNames[state] || 'UNKNOWN');

          // Check if connection was closed
          if (state === 3 || state === 'CLOSED') {
            setError('Connection closed. Please check backend logs - Deepgram initialization may have failed.');
          } else {
            setError('Failed to connect to server. Please ensure the backend is running on port 8080.');
          }
          return;
        }
      }

      // Use Web Speech API (free) or Deepgram (backend)
      if (useWebSpeechAPI && 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
        console.log('🎤 Using Web Speech API (FREE) for STT with Echo Cancellation');

        // Initialize Echo Canceller (OPTIONAL - playback works without it)
        try {
          // Request microphone access with echo cancellation enabled
          const micStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              channelCount: 1,
              sampleRate: 16000,
              echoCancellation: true, // Browser-level echo cancellation
              noiseSuppression: true,
              autoGainControl: true,
            },
          });

          console.log('✅ Microphone access granted for echo cancellation');

          // Create audio context FIRST if not exists
          if (!audioContextRef.current) {
            audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({
              sampleRate: 16000,
            });
            console.log('✅ Audio context created for echo cancellation');
          }

          // Initialize echo canceller with valid audio context
          if (!echoCancellerRef.current && audioContextRef.current) {
            echoCancellerRef.current = new AdvancedEchoCanceller(audioContextRef.current);
            await echoCancellerRef.current.init(micStream);
            echoCancellerRef.current.startProcessing();
            console.log('✅ Echo Canceller initialized and processing started');
          }

        } catch (error) {
          console.error('❌ Failed to initialize echo canceller:', error);
          console.warn('⚠️ Continuing without echo cancellation - use earbuds for best experience');
          // Continue without echo cancellation - playback will still work
        }

        // Initialize Web Speech API
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';
        recognition.maxAlternatives = 3; // Get confidence scores for noise filtering

        recognition.onstart = () => {
          console.log('✅ Web Speech API started');
          setStatus('listening');
        };

        // Turbo VAD: Track interim speech to detect silence faster than the API
        const silenceThreshold = 700; // ms of silence to consider "done"

        // Clear any previous interval
        if (silenceTimerRef.current) clearInterval(silenceTimerRef.current);

        silenceTimerRef.current = setInterval(() => {
          // Don't process VAD if we are speaking/playing audio
          // This prevents false triggers from agent's own speech
          if (!isCallActiveRef.current || !recognitionRef.current || isSpeakingRef.current || isPlayingRef.current) return;

          const now = Date.now();
          const timeSinceLastSpeech = now - lastSpeechTimeRef.current;
          const hasInterim = interimTranscriptRef.current && interimTranscriptRef.current.trim().length > 0;

          // If we have pending speech and enough silence has passed
          if (hasInterim && timeSinceLastSpeech > silenceThreshold) {
            const textToSend = interimTranscriptRef.current.trim();

            // NOISE FILTER: Require minimum length (at least 3 characters)
            if (textToSend.length < 3) {
              console.log(`� Turbo VAD: Filtered short utterance (${textToSend.length} chars): "${textToSend}"`);
              interimTranscriptRef.current = '';
              return;
            }

            console.log(`🚀 Turbo VAD: Silence detected (${timeSinceLastSpeech}ms) - Sending transcript manually`);

            // Send if valid
            if (textToSend && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              console.log('📝 Turbo VAD Sending:', textToSend);
              wsRef.current.send(JSON.stringify({
                type: 'transcript',
                text: textToSend
              }));

              // Clear buffer immediately to prevent double sending
              interimTranscriptRef.current = '';

              // Force restart recognition to clear internal API buffer
              // This prevents the API from sending a "final" event later with the same text
              try {
                recognitionRef.current.abort();
              } catch (e) { console.warn('Abort failed', e); }
            }
          }
        }, 100);

        recognition.onresult = (event) => {
          let finalTranscript = '';
          let interimTranscript = '';
          let maxConfidence = 0;

          // NOISE FILTERING: Check confidence scores
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const result = event.results[i];
            const transcript = result[0].transcript;
            const confidence = result[0].confidence || (result.isFinal ? 1 : 0.8); // Estimate confidence for interim

            // Track max confidence for logging
            if (confidence > maxConfidence) {
              maxConfidence = confidence;
            }

            // FILTER 1: Confidence threshold - ignore low confidence (likely noise)
            // LOWERED thresholds for better multilingual support (Hindi, etc.)
            // For interim results, we're very lenient (0.2), for final we require 0.3
            const confidenceThreshold = result.isFinal ? 0.3 : 0.2;

            if (confidence < confidenceThreshold) {
              console.log(`🔇 Filtered low confidence (${confidence.toFixed(2)}): "${transcript}"`);
              continue; // Skip this result
            }

            if (result.isFinal) {
              finalTranscript += transcript + ' ';
            } else {
              interimTranscript += transcript;
            }
          }

          // FILTER 2: Minimum length - ignore very short utterances (likely noise)
          // Interim needs at least 2 chars, final needs at least 3
          const hasValidInterim = interimTranscript.trim().length >= 2;
          const hasValidFinal = finalTranscript.trim().length >= 3;

          // FILTER 3: Noise pattern detection - filter out common noise patterns
          const noisePatterns = [
            /^(uh|um|ah|eh|hm|mm)$/i,  // Filler sounds
            /^[^a-z0-9\s]+$/i,          // Only special characters
            /^(.)\\1+$/,                 // Repeated single character (e.g., "aaaa")
          ];

          const isNoise = (text) => {
            const trimmed = text.trim().toLowerCase();
            return noisePatterns.some(pattern => pattern.test(trimmed));
          };

          // Filter out noise from transcripts
          if (hasValidInterim && isNoise(interimTranscript)) {
            console.log(`🔇 Filtered noise pattern: "${interimTranscript}"`);
            interimTranscript = '';
          }

          if (hasValidFinal && isNoise(finalTranscript)) {
            console.log(`🔇 Filtered noise pattern: "${finalTranscript}"`);
            finalTranscript = '';
          }

          // Debug logs for tuning (uncomment to see confidence scores)
          // console.log('Speech Event:', { 
          //   final: finalTranscript, 
          //   interim: interimTranscript, 
          //   confidence: maxConfidence.toFixed(2) 
          // });

          // Update refs for Turbo VAD (only if passed filters)
          if (hasValidInterim && interimTranscript.trim().length > 0) {
            lastSpeechTimeRef.current = Date.now();
            interimTranscriptRef.current = interimTranscript;
          } else if (hasValidFinal && finalTranscript.trim().length > 0) {
            // If we got a final, clear interim logic so we don't double send
            interimTranscriptRef.current = '';
            lastSpeechTimeRef.current = Date.now();
          }

          // BARGE-IN LOGIC with NOISE FILTERING
          // Only trigger if:
          // 1. Agent is speaking/playing
          // 2. We have valid speech (passed all filters above)
          // 3. Minimum length for barge-in (at least 3 characters to avoid false triggers)
          // 4. Debounce: At least 200ms since last barge-in attempt
          const MIN_BARGE_IN_LENGTH = 3; // Require at least 3 characters for barge-in
          const BARGE_IN_DEBOUNCE = 200; // ms between barge-in attempts

          const hasValidBargeInSpeech = (finalTranscript && finalTranscript.trim().length >= MIN_BARGE_IN_LENGTH) ||
            (interimTranscript && interimTranscript.trim().length >= MIN_BARGE_IN_LENGTH);

          const timeSinceLastBargeIn = Date.now() - (window.lastBargeInTime || 0);
          const canBargeIn = timeSinceLastBargeIn >= BARGE_IN_DEBOUNCE;

          if ((isSpeakingRef.current || isPlayingRef.current) && hasValidBargeInSpeech && canBargeIn) {
            console.log(`🗣️ User interrupting agent (Barge-in) - Confidence: ${maxConfidence.toFixed(2)}`);
            window.lastBargeInTime = Date.now(); // Update debounce timer

            stopAgentSpeech();
            // Clear interim buffer on barge-in to avoid processing old speech
            interimTranscriptRef.current = '';

            // Send stop signal to backend to cancel generation
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({ type: 'stop_generation' }));
              console.log('📤 Sent stop_generation to backend');
            }
          }

          // Send final transcript to backend (only if passed all filters)
          // Note: Turbo VAD might have already sent this if it was slow.
          // But if the API is fast enough, we send it here.
          if (hasValidFinal && finalTranscript.trim()) {
            console.log('📝 Final transcript (API):', finalTranscript.trim(), `(confidence: ${maxConfidence.toFixed(2)})`);

            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({
                type: 'transcript',
                text: finalTranscript.trim()
              }));
            }
            // Clear interim ref since we just sent final
            interimTranscriptRef.current = '';
          }
        };

        recognition.onerror = (event) => {
          // 'aborted' is expected when we stop. 'no-speech' is expected during silence.
          if (event.error === 'aborted') {
            return;
          }

          if (event.error === 'no-speech') {
            // Silence is normal; restart INSTANTLY (0ms) to minimize gap
            if (isCallActiveRef.current && !isSpeakingRef.current && !isPlayingRef.current) {
              restartRecognition();
            }
            return;
          }

          console.error('❌ Web Speech API error:', event.error);

          // For actual errors, wait slightly to avoid rapid loops
          if (isCallActiveRef.current && !isSpeakingRef.current && !isPlayingRef.current) {
            setTimeout(() => {
              if (isCallActiveRef.current && recognitionRef.current && !isSpeakingRef.current && !isPlayingRef.current) {
                restartRecognition();
              }
            }, 100);
          }
        };

        recognition.onend = () => {
          // For persistent listening, restart INSTANTLY (0ms)
          if (isCallActiveRef.current && !isSpeakingRef.current && !isPlayingRef.current) {
            // Instant restart
            if (isCallActiveRef.current && recognitionRef.current) {
              restartRecognition();
            }
          } else {
            console.log('⏸️ Web Speech API paused (Agent speaking or intentional stop)');
          }
        };

        recognitionRef.current = recognition;
        recognition.start();

        // Store stream reference for cleanup
        mediaRecorderRef.current = { recognition, stream: null };
        isCallActiveRef.current = true;
        setIsCallActive(true);
        console.log('✅ Call started with Web Speech API');
        return;
      }

      // Fallback to Deepgram (backend STT)
      console.log('🎤 Using Deepgram (backend) for STT');

      // Request microphone access
      console.log('🎤 Requesting microphone access...');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      console.log('✅ Microphone access granted');
      console.log('📊 Audio tracks:', stream.getAudioTracks().length);
      stream.getAudioTracks().forEach((track, index) => {
        console.log(`📊 Track ${index} settings:`, track.getSettings());
        console.log(`📊 Track ${index} enabled:`, track.enabled, 'readyState:', track.readyState);
      });

      // Initialize AudioContext for processing
      const audioContext = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 16000,
      });
      audioContextRef.current = audioContext;
      console.log('✅ AudioContext created, sample rate:', audioContext.sampleRate);

      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      console.log('✅ Audio processor created, buffer size:', processor.bufferSize);

      let audioChunkCount = 0;
      let lastLogTime = Date.now();

      processor.onaudioprocess = (e) => {
        // Log first few callbacks to verify it's firing
        if (audioChunkCount < 3) {
          console.log(`🔊 Audio callback fired #${audioChunkCount + 1}`);
        }

        // Use ref instead of state to get current value
        if (!isCallActiveRef.current) {
          if (audioChunkCount === 0) {
            console.log('⚠️ Call not active - isCallActiveRef:', isCallActiveRef.current);
          }
          return;
        }

        if (!wsRef.current) {
          if (audioChunkCount === 0) {
            console.log('⚠️ WebSocket not available');
          }
          return;
        }

        if (wsRef.current.readyState !== WebSocket.OPEN) {
          if (audioChunkCount === 0) {
            console.log('⚠️ WebSocket not open, state:', wsRef.current.readyState);
          }
          return;
        }

        const inputData = e.inputBuffer.getChannelData(0);

        // Check if we have actual audio data
        if (!inputData || inputData.length === 0) {
          if (audioChunkCount === 0) {
            console.warn('⚠️ No input data in audio buffer');
          }
          return;
        }

        // Log first chunk details
        if (audioChunkCount === 0) {
          console.log(`📊 First audio chunk - samples: ${inputData.length}, expected bytes: ${inputData.length * 2}`);
        }

        // Convert Float32Array to PCM 16-bit
        const pcmData = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          // Clamp and convert to 16-bit integer
          const s = Math.max(-1, Math.min(1, inputData[i]));
          pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        // Send PCM audio to server
        try {
          // Use the buffer directly from Int16Array - it's already in the correct format
          // Int16Array.buffer is an ArrayBuffer with the correct byte length
          const buffer = pcmData.buffer;

          // Verify buffer size (should be samples * 2 bytes)
          const expectedSize = inputData.length * 2;
          if (buffer.byteLength !== expectedSize) {
            console.warn(`⚠️ Buffer size mismatch: expected ${expectedSize}, got ${buffer.byteLength}`);
          }

          // Always send if buffer has data (remove the 100 byte minimum check)
          if (buffer.byteLength > 0) {
            // Send the buffer directly
            wsRef.current.send(buffer);
            audioChunkCount++;

            const now = Date.now();
            if (audioChunkCount === 1 || audioChunkCount % 50 === 0 || (now - lastLogTime) > 2000) {
              console.log(`📤 Sent ${audioChunkCount} audio chunks, size: ${buffer.byteLength} bytes, samples: ${inputData.length}`);
              lastLogTime = now;
            }
          } else {
            if (audioChunkCount === 0) {
              console.warn(`⚠️ Skipping send - empty buffer (expected ~${expectedSize} bytes)`);
            }
          }
        } catch (error) {
          console.error('❌ Error sending audio:', error);
          console.error('Error details:', error.message);
          console.error('Error stack:', error.stack);
        }
      };

      source.connect(processor);
      // Don't connect processor to destination to avoid feedback
      // We only want to send audio to WebSocket, not play it back

      mediaRecorderRef.current = { stream, processor, source };
      isCallActiveRef.current = true; // Set ref immediately
      setIsCallActive(true);
      setStatus('listening');
      console.log('✅ Call started - audio processing active');
      console.log('📊 Audio context sample rate:', audioContext.sampleRate);
      console.log('📊 Processor buffer size:', processor.bufferSize);
    } catch (error) {
      console.error('Error starting call:', error);
      setError(error.message || 'Failed to start call. Please check microphone permissions.');
    }
  };

  const stopCall = () => {
    isCallActiveRef.current = false; // Set ref immediately to stop audio processing
    setIsCallActive(false);
    setStatus('idle');
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    console.log('🛑 Call stopped - audio processing disabled');

    // Stop all audio immediately
    stopAgentSpeech();

    // Stop Web Speech API if active
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
        recognitionRef.current = null;
        console.log('🛑 Web Speech API stopped');
      } catch (e) {
        console.error('Error stopping Web Speech API:', e);
      }
    }

    // Stop TTS and clear queue
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      ttsQueueRef.current = [];
      isSpeakingRef.current = false;
      console.log('🛑 TTS stopped and queue cleared');
    }

    // Stop media stream (for Deepgram mode)
    if (mediaRecorderRef.current) {
      if (mediaRecorderRef.current.stream) {
        mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
      }
      if (mediaRecorderRef.current.processor) {
        mediaRecorderRef.current.processor.disconnect();
      }
      if (mediaRecorderRef.current.source) {
        mediaRecorderRef.current.source.disconnect();
      }
      mediaRecorderRef.current = null;
    }

    // Stop echo canceller
    if (echoCancellerRef.current) {
      try {
        echoCancellerRef.current.stopProcessing();
        echoCancellerRef.current.destroy();
        echoCancellerRef.current = null;
        console.log('🛑 Echo Canceller stopped and destroyed');
      } catch (e) {
        console.error('Error stopping echo canceller:', e);
      }
    }

    // Close WebSocket gracefully
    if (wsRef.current) {
      try {
        // Send close message and let server handle the close
        if (wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'close' }));
          // Don't close immediately - let server close it with proper handshake
          // Set a timeout to force close if server doesn't respond
          setTimeout(() => {
            if (wsRef.current && wsRef.current.readyState !== WebSocket.CLOSED) {
              console.log('Server did not close connection, closing client side');
              wsRef.current.close(1000, 'Call ended by user');
            }
            wsRef.current = null;
          }, 500);
        } else {
          // Already closed or closing
          wsRef.current = null;
        }
      } catch (error) {
        console.error('Error closing WebSocket:', error);
        if (wsRef.current) {
          try {
            wsRef.current.close(1000, 'Call ended');
          } catch (e) {
            // Ignore errors if already closed
          }
          wsRef.current = null;
        }
      }
    }

    setIsConnected(false);
  };

  return (
    <div className="app">
      <div className="container">
        <div className="header">
          <h1>🎙️ Voice AI Agent</h1>
          <p className="subtitle">Talk to Riya - Your Admissions Assistant</p>
        </div>

        <div className="status-card">
          <div className="status-indicator">
            <div className={`pulse ${status}`}></div>
            <span className="status-text">
              {status === 'idle' && 'Ready to start'}
              {status === 'listening' && '🎧 Listening...'}
              {status === 'processing' && '⚙️ Processing...'}
              {status === 'speaking' && '🔊 Agent speaking...'}
            </span>
          </div>

          {error && (
            <div className="error-message">
              ⚠️ {error}
            </div>
          )}

          <div className="connection-status">
            <span className={`status-dot ${isConnected ? 'connected' : 'disconnected'}`}></span>
            {isConnected ? 'Connected' : 'Disconnected'}
          </div>
        </div>

        <div className="controls">
          {!isCallActive ? (
            <button
              className="btn btn-start"
              onClick={startCall}
              disabled={false}
            >
              <span className="btn-icon">📞</span>
              Start Call
            </button>
          ) : (
            <button className="btn btn-end" onClick={stopCall}>
              <span className="btn-icon">📴</span>
              End Call
            </button>
          )}
        </div>

        <div className="info">
          <p>💡 <strong>How it works:</strong></p>
          <ul>
            <li>Click "Start Call" to begin</li>
            <li>Speak naturally - the agent will listen</li>
            <li>Wait for Riya to respond</li>
            <li>Click "End Call" when finished</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

export default App;

