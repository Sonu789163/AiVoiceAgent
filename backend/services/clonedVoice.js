/**
 * Cloned Voice TTS Service
 * 
 * Integrates with your custom voice cloning TTS server
 * running at http://localhost:5000
 */

import fetch from 'node-fetch';

const TTS_API_URL = "https://unresisting-rea-wolflike.ngrok-free.dev";
// const TTS_API_URL = 'http://localhost:5000';

/**
 * Stream TTS audio from your cloned voice API
 * @param {string} text - Text to convert to speech
 * @param {object} socket - WebSocket connection to stream audio to client
 * @param {string} language - Language code ('hi' for Hindi, 'en' for English)
 * @param {number} speed - Speech speed (1.5 = natural, fast but clear)
 * @param {number} temperature - Expressiveness (0.75 = natural, expressive)
 */
export async function streamClonedVoiceTTS(text, socket, language = 'en', speed = 1.5, temperature = 0.75) {
    try {
        console.log('🎤 Cloned Voice TTS - Full text:', text);
        console.log('🔧 Config:', { language, speed, temperature });

        // Skip TTS if text is empty
        if (!text || text.trim().length === 0) {
            console.log('⏭️ Skipping TTS - text is empty');
            return;
        }

        // 1. Generate speech with cloned voice
        const response = await fetch(`${TTS_API_URL}/api/tts`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                text: text,  // Text will be cleaned by TTS server
                language: language,
                speed: speed,  // 1.5 = natural, fast but clear
                temperature: temperature  // 0.75 = natural expressiveness
            })
        });

        if (!response.ok) {
            throw new Error(`TTS API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();

        if (!data.success) {
            throw new Error(`TTS generation failed: ${data.error}`);
        }

        console.log('✅ Audio generated:', data.audio_id);
        console.log('📁 Audio URL:', data.audio_url);

        // 2. Fetch the generated audio file
        const audioUrl = `${TTS_API_URL}${data.audio_url}`;
        const audioResponse = await fetch(audioUrl);

        if (!audioResponse.ok) {
            throw new Error(`Failed to fetch audio: ${audioResponse.status}`);
        }

        // 3. Get audio as buffer
        const audioBuffer = await audioResponse.arrayBuffer();
        console.log('📦 Audio buffer size:', audioBuffer.byteLength, 'bytes');

        // 4. The audio is in WAV format, we need to extract PCM data
        // WAV header is 44 bytes, PCM data starts after that
        const pcmData = Buffer.from(audioBuffer.slice(44));
        console.log('🎵 PCM data size:', pcmData.byteLength, 'bytes');

        // 5. Stream PCM data to client in chunks
        const CHUNK_SIZE = 8192; // 8KB chunks for smooth streaming
        let offset = 0;
        let chunkCount = 0;

        while (offset < pcmData.length) {
            const chunk = pcmData.slice(offset, offset + CHUNK_SIZE);

            // Send chunk to client via WebSocket
            if (socket && socket.readyState === 1) { // 1 = OPEN
                socket.send(chunk);
                chunkCount++;
            } else {
                console.warn('⚠️ Socket not ready, stopping stream');
                break;
            }

            offset += CHUNK_SIZE;

            // Small delay to prevent overwhelming the client
            await new Promise(resolve => setTimeout(resolve, 10));
        }

        console.log('✅ Cloned Voice TTS streaming completed, sent', chunkCount, 'PCM chunks');

    } catch (error) {
        console.error('❌ Cloned Voice TTS Error:', error);
        throw error;
    }
}

/**
 * Check if the cloned voice TTS server is running
 */
export async function checkClonedVoiceHealth() {
    try {
        const response = await fetch(`${TTS_API_URL}/api/health`, {
            method: 'GET',
            timeout: 5000
        });

        if (!response.ok) {
            return false;
        }

        const data = await response.json();
        return data.status === 'healthy';

    } catch (error) {
        console.error('❌ Cloned Voice TTS server not reachable:', error.message);
        return false;
    }
}

/**
 * Generate TTS and return audio URL (for frontend direct playback)
 * @param {string} text - Text to convert to speech
 * @param {string} language - Language code
 * @returns {Promise<string>} - Audio URL
 */
export async function generateClonedVoiceAudio(text, language = 'en') {
    try {
        const response = await fetch(`${TTS_API_URL}/api/tts`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                text: text,
                language: language,
                speed: 1.5,  // Natural, fast but clear
                temperature: 0.75  // Natural expressiveness
            })
        });

        const data = await response.json();

        if (!data.success) {
            throw new Error(data.error);
        }

        return `${TTS_API_URL}${data.audio_url}`;

    } catch (error) {
        console.error('❌ Cloned Voice TTS Error:', error);
        throw error;
    }
}
