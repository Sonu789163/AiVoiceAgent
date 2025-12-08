import axios from 'axios';

const ELEVENLABS_TTS_BASE = 'https://api.elevenlabs.io/v1';
const DEFAULT_VOICE_ID = 'XopCoWNooN3d7LfWZyX5'; // Provided voice id mCQMfsqGDT6IDkEKR20a  nZrzehiJO7UYXi9GOxS8 
const DEFAULT_MODEL_ID = 'eleven_turbo_v2_5';

/**
 * Stream TTS audio from ElevenLabs (PCM 16kHz) and invoke callback per chunk.
 * @param {string} text
 * @param {(chunk: Buffer) => void} onAudioChunk
 */
export async function streamElevenLabsTTS(text, onAudioChunk) {
  if (!text || text.trim().length === 0) {
    console.warn('⚠️ ElevenLabs TTS: Empty text provided');
    return;
  }

  if (!process.env.ELEVENLABS_API_KEY) {
    throw new Error('ELEVENLABS_API_KEY is not set');
  }

  const voiceId = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;
  const modelId = process.env.ELEVENLABS_MODEL_ID || DEFAULT_MODEL_ID;

  console.log('🎙️ ElevenLabs TTS: Starting for text:', text.substring(0, 80));

  try {
    const response = await axios.post(
      `${ELEVENLABS_TTS_BASE}/text-to-speech/${voiceId}/stream?output_format=pcm_16000`,
      {
        text: text.trim(),
        model_id: modelId,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.7,
        },
      },
      {
        headers: {
          'xi-api-key': process.env.ELEVENLABS_API_KEY,
          'Content-Type': 'application/json',
        },
        responseType: 'stream',
        timeout: 30000,
        validateStatus: (status) => status < 500, // handle 4xx manually
      }
    );

    if (response.status >= 400) {
      let errorBody = '';
      const chunks = [];
      response.data.on('data', (c) => chunks.push(c));
      await new Promise((resolve) => {
        response.data.on('end', resolve);
        response.data.on('error', resolve);
        setTimeout(resolve, 2000);
      });
      errorBody = Buffer.concat(chunks).toString();
      console.error('❌ ElevenLabs API error:', response.status, errorBody);
      throw new Error(`ElevenLabs API ${response.status}: ${errorBody || response.statusText}`);
    }

    let chunkCount = 0;
    return new Promise((resolve, reject) => {
      response.data.on('data', (chunk) => {
        if (chunk && chunk.length > 0) {
          chunkCount++;
          // Only log first few chunks and every 20th chunk to reduce noise
          if (chunkCount <= 3 || chunkCount % 20 === 0) {
            console.log(`🎙️ ElevenLabs: Received chunk ${chunkCount}, size: ${chunk.length}`);
          }
          // Ensure chunk is a Buffer for consistent handling
          const chunkBuffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          onAudioChunk(chunkBuffer);
        }
      });

      response.data.on('end', () => {
        console.log(`🎙️ ElevenLabs: Stream completed, chunks: ${chunkCount}`);
        resolve();
      });

      response.data.on('error', (err) => {
        console.error('❌ ElevenLabs stream error:', err);
        reject(err);
      });
    });
  } catch (error) {
    console.error('ElevenLabs TTS API error:', {
      message: error.message,
      status: error.response?.status,
      data: error.response?.data,
    });
    throw error;
  }
}

