import axios from 'axios';

/**
 * Stream TTS audio from Sarvam AI API
 * @param {string} text - Text to convert to speech
 * @param {function} onAudioChunk - Callback function to handle audio chunks
 * @param {object} options - Optional TTS configuration
 * @param {function} checkCancellation - Optional callback to check if streaming should be cancelled
 * @returns {Promise<void>}
 */
export async function streamSarvamTTS(text, onAudioChunk, options = {}, checkCancellation = null) {
    const apiKey = process.env.SARVAM_API_KEY;

    if (!apiKey) {
        throw new Error('SARVAM_API_KEY is not set in environment variables');
    }

    if (!text || text.trim().length === 0) {
        console.warn('⚠️ Empty text provided to Sarvam TTS, skipping...');
        return;
    }

    console.log('🎤 Sarvam TTS - Processing text:', text.substring(0, 100) + (text.length > 100 ? '...' : ''));

    try {
        // Sarvam AI TTS API configuration
        const config = {
            target_language_code: options.language || 'hi-IN', // Default to Hindi
            speaker: options.speaker || 'vidya', // Default speaker
            pitch: options.pitch !== undefined ? options.pitch : 0.1,
            pace: options.pace !== undefined ? options.pace : 1.2,
            loudness: options.loudness !== undefined ? options.loudness : 1,
            speech_sample_rate: options.sampleRate || 16000, // 16kHz for WebSocket compatibility
            enable_preprocessing: options.enablePreprocessing !== undefined ? options.enablePreprocessing : true,
            model: options.model || 'bulbul:v2',
            inputs: [text] // Sarvam expects an array of text inputs
        };

        console.log('🔧 Sarvam TTS config:', {
            language: config.target_language_code,
            speaker: config.speaker,
            model: config.model,
            sampleRate: config.speech_sample_rate
        });

        // Make request to Sarvam AI API
        const response = await axios.post(
            'https://api.sarvam.ai/text-to-speech',
            config,
            {
                headers: {
                    'api-subscription-key': apiKey,
                    'content-type': 'application/json'
                },
                responseType: 'arraybuffer', // Get binary audio data
                timeout: 30000 // 30 second timeout
            }
        );

        console.log('✅ Sarvam TTS response received, status:', response.status);
        console.log('📊 Response headers:', response.headers['content-type']);

        // Check if we got audio data
        if (!response.data || response.data.byteLength === 0) {
            throw new Error('Sarvam API returned empty audio data');
        }

        let audioBuffer;

        // Check if response is JSON with base64 audio (common for Sarvam API)
        const contentType = response.headers['content-type'] || '';
        if (contentType.includes('application/json')) {
            // Response is JSON with base64-encoded audio
            const jsonResponse = JSON.parse(Buffer.from(response.data).toString('utf-8'));
            console.log('📦 Received JSON response, decoding base64 audio...');

            // Sarvam returns base64 audio in 'audios' array
            if (jsonResponse.audios && jsonResponse.audios.length > 0) {
                const base64Audio = jsonResponse.audios[0];
                audioBuffer = Buffer.from(base64Audio, 'base64');
                console.log('✅ Decoded base64 audio, size:', audioBuffer.length, 'bytes');
            } else {
                throw new Error('No audio data found in JSON response');
            }
        } else {
            // Response is direct binary audio
            audioBuffer = Buffer.from(response.data);
            console.log('📊 Direct binary audio data size:', audioBuffer.length, 'bytes');
        }

        // Sarvam returns WAV format - we need to extract raw PCM data
        // WAV file structure: RIFF header (44 bytes) + PCM data
        // We need to skip the WAV header and send only the raw PCM data

        // Check if this is a WAV file (starts with "RIFF")
        const isWav = audioBuffer.toString('ascii', 0, 4) === 'RIFF';

        let pcmData;
        if (isWav) {
            console.log('🎵 Detected WAV format, extracting raw PCM data...');

            // Standard WAV header is 44 bytes, but let's find the data chunk properly
            // WAV structure: RIFF header (12 bytes) + fmt chunk + data chunk
            let dataOffset = 12; // Start after RIFF header

            // Find the "data" chunk
            while (dataOffset < audioBuffer.length - 8) {
                const chunkId = audioBuffer.toString('ascii', dataOffset, dataOffset + 4);
                const chunkSize = audioBuffer.readUInt32LE(dataOffset + 4);

                if (chunkId === 'data') {
                    // Found data chunk, PCM data starts after chunk header (8 bytes)
                    dataOffset += 8;
                    pcmData = audioBuffer.slice(dataOffset);
                    console.log('✅ Extracted PCM data, size:', pcmData.length, 'bytes');
                    break;
                }

                // Move to next chunk
                dataOffset += 8 + chunkSize;
            }

            if (!pcmData) {
                console.warn('⚠️ Could not find data chunk, using data after byte 44');
                pcmData = audioBuffer.slice(44); // Fallback to standard 44-byte header
            }
        } else {
            console.log('📊 Raw PCM data (no WAV header)');
            pcmData = audioBuffer;
        }

        // Send PCM data in chunks for smooth streaming
        const chunkSize = 8192; // 8KB chunks
        let offset = 0;

        while (offset < pcmData.length) {
            // Check if we should cancel (barge-in)
            if (checkCancellation && checkCancellation()) {
                console.log('🛑 Sarvam TTS streaming cancelled (Barge-in)');
                return;
            }

            const chunk = pcmData.slice(offset, Math.min(offset + chunkSize, pcmData.length));

            // Send chunk to callback
            if (onAudioChunk && typeof onAudioChunk === 'function') {
                onAudioChunk(chunk);
            }

            offset += chunkSize;

            // Small delay between chunks to prevent overwhelming the WebSocket
            if (offset < pcmData.length) {
                await new Promise(resolve => setTimeout(resolve, 10)); // 10ms delay
            }
        }

        console.log('✅ Sarvam TTS streaming completed, sent', Math.ceil(pcmData.length / chunkSize), 'PCM chunks');

    } catch (error) {
        console.error('❌ Sarvam TTS error:', error.message);

        // Log more details for debugging
        if (error.response) {
            console.error('Response status:', error.response.status);
            console.error('Response headers:', error.response.headers);

            // Try to parse error response
            try {
                const errorData = Buffer.from(error.response.data).toString('utf-8');
                console.error('Response data:', errorData);
            } catch (e) {
                console.error('Response data (raw):', error.response.data);
            }
        } else if (error.request) {
            console.error('No response received from Sarvam API');
        }

        throw new Error(`Sarvam TTS failed: ${error.message}`);
    }
}

/**
 * Test Sarvam AI TTS connection
 * @returns {Promise<boolean>}
 */
export async function testSarvamConnection() {
    try {
        console.log('🧪 Testing Sarvam AI TTS connection...');

        const testText = 'Hello, this is a test.';
        let receivedAudio = false;

        await streamSarvamTTS(testText, (chunk) => {
            if (chunk && chunk.length > 0) {
                receivedAudio = true;
            }
        });

        if (receivedAudio) {
            console.log('✅ Sarvam AI TTS connection test successful');
            return true;
        } else {
            console.error('❌ Sarvam AI TTS test failed: No audio received');
            return false;
        }
    } catch (error) {
        console.error('❌ Sarvam AI TTS connection test failed:', error.message);
        return false;
    }
}
