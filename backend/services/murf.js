import axios from 'axios';

const MURF_API_BASE = 'https://api.murf.ai/v1';

/**
 * Stream TTS audio from Murf.ai using Neha voice (Indian English)
 * @param {string} text - Text to convert to speech
 * @param {Function} onAudioChunk - Callback for each audio chunk received
 * @returns {Promise<void>}
 */
export async function streamTTS(text, onAudioChunk) {
  if (!text || text.trim().length === 0) {
    console.warn('⚠️ Murf TTS: Empty text provided');
    return;
  }

  console.log('🎙️ Murf TTS: Starting TTS for text:', text.substring(0, 50));
  
  try {
    // Check if API key is set
    const apiKey = process.env.MURF_API_KEY;
    if (!apiKey || apiKey.trim() === '') {
      throw new Error('MURF_API_KEY is not set or is empty. Please check your .env file.');
    }
    
    console.log('🎙️ Murf TTS: API key found (length:', apiKey.length, 'chars)');
    
    // Murf.ai API endpoint for speech generation
    // Based on Murf API documentation, the endpoint and request format
    console.log('🎙️ Murf TTS: Calling API endpoint:', `${MURF_API_BASE}/speech/stream`);
    
    // Request body - Murf API expects 'voice_id' (snake_case) based on error message
    // The error says "Invalid voice_id null" which means it's looking for 'voice_id'
    // Note: The voice name might need to be exact - check your comment shows "Anisha" not "Anusha"
    // You can also use getAvailableVoices() to fetch the correct voice IDs
    const voiceName = process.env.MURF_VOICE_NAME || 'Anisha'; // Allow override via env var
    const requestBody = {
      text: text.trim(),
      voice_id: voiceName, // Use 'voice_id' (snake_case) as error message indicates
      style: "Conversation",
      model: "Falcon",
    };
    
    console.log('🎙️ Murf TTS: Using voice_id:', voiceName);
    console.log('💡 Tip: If this fails, try setting MURF_VOICE_NAME env var or use getAvailableVoices() to find correct voice IDs');
    
    console.log('🎙️ Murf TTS: Request body:', JSON.stringify(requestBody));
    
    // Murf API expects 'api-key' or 'token' header
    // Try 'api-key' first, then fallback to 'token' if it fails
    let response;
    let errorMessage = '';
    
    // Try with 'api-key' header first
    try {
      response = await axios.post(
        `${MURF_API_BASE}/speech/stream`,
        requestBody,
        {
          headers: {
            'api-key': apiKey.trim(),
            'Content-Type': 'application/json',
          },
          responseType: 'stream',
          timeout: 30000,
          validateStatus: function (status) {
            return status < 500;
          },
        }
      );
      
      // Check if response is an error
      if (response.status >= 400) {
        // Read the error response body
        const chunks = [];
        response.data.on('data', (chunk) => {
          chunks.push(chunk);
        });
        
        await new Promise((resolve, reject) => {
          response.data.on('end', () => {
            errorMessage = Buffer.concat(chunks).toString();
            resolve();
          });
          response.data.on('error', reject);
          setTimeout(() => {
            if (chunks.length > 0) {
              errorMessage = Buffer.concat(chunks).toString();
            }
            resolve();
          }, 2000);
        });
        
        // If error mentions voice_id, try voiceId (camelCase) instead
        if (errorMessage.includes('voice_id') || errorMessage.includes('voiceId') || errorMessage.includes('Invalid voice')) {
          console.log('🔄 Trying with "voiceId" (camelCase) instead of "voice_id"...');
          // Try with voiceId (camelCase) format
          const requestBodyAlt = {
            text: text.trim(),
            voiceId: 'Anisha', // Try camelCase format
            style: "Conversation",
            model: "Falcon",
          };
          
          response = await axios.post(
            `${MURF_API_BASE}/speech/stream`,
            requestBodyAlt,
            {
              headers: {
                'api-key': apiKey.trim(),
                'Content-Type': 'application/json',
              },
              responseType: 'stream',
              timeout: 30000,
              validateStatus: function (status) {
                return status < 500;
              },
            }
          );
          
          if (response.status >= 400) {
            const chunks2 = [];
            response.data.on('data', (chunk) => {
              chunks2.push(chunk);
            });
            
            await new Promise((resolve) => {
              response.data.on('end', () => {
                errorMessage = Buffer.concat(chunks2).toString();
                resolve();
              });
              setTimeout(() => {
                if (chunks2.length > 0) {
                  errorMessage = Buffer.concat(chunks2).toString();
                }
                resolve();
              }, 2000);
            });
            
            throw new Error(`Murf API returned ${response.status}: ${errorMessage || response.statusText}`);
          }
        } else if (errorMessage.includes('api-key') || errorMessage.includes('token') || errorMessage.includes('header')) {
          console.log('🔄 Trying with "token" header instead of "api-key"...');
          // Try with 'token' header (use same endpoint: /speech/stream)
          response = await axios.post(
            `${MURF_API_BASE}/speech/stream`,
            requestBody,
            {
              headers: {
                'token': apiKey.trim(),
                'Content-Type': 'application/json',
              },
              responseType: 'stream',
              timeout: 30000,
              validateStatus: function (status) {
                return status < 500;
              },
            }
          );
          
          if (response.status >= 400) {
            const chunks2 = [];
            response.data.on('data', (chunk) => {
              chunks2.push(chunk);
            });
            
            await new Promise((resolve) => {
              response.data.on('end', () => {
                errorMessage = Buffer.concat(chunks2).toString();
                resolve();
              });
              setTimeout(() => {
                if (chunks2.length > 0) {
                  errorMessage = Buffer.concat(chunks2).toString();
                }
                resolve();
              }, 2000);
            });
            
            throw new Error(`Murf API returned ${response.status}: ${errorMessage || response.statusText}`);
          }
        } else {
          throw new Error(`Murf API returned ${response.status}: ${errorMessage || response.statusText}`);
        }
      }
    } catch (error) {
      // If axios throws an error (not a 4xx response), try 'token' header
      if (error.response?.status === 400 && error.response?.data) {
        console.log('🔄 Retrying with "token" header...');
        try {
          response = await axios.post(
            `${MURF_API_BASE}/speech/stream`,
            requestBody,
            {
              headers: {
                'token': apiKey.trim(),
                'Content-Type': 'application/json',
              },
              responseType: 'stream',
              timeout: 30000,
              validateStatus: function (status) {
                return status < 500;
              },
            }
          );
          
          if (response.status >= 400) {
            const chunks = [];
            response.data.on('data', (chunk) => {
              chunks.push(chunk);
            });
            
            await new Promise((resolve) => {
              response.data.on('end', () => {
                errorMessage = Buffer.concat(chunks).toString();
                resolve();
              });
              setTimeout(() => {
                if (chunks.length > 0) {
                  errorMessage = Buffer.concat(chunks).toString();
                }
                resolve();
              }, 2000);
            });
            
            throw new Error(`Murf API returned ${response.status}: ${errorMessage || response.statusText}`);
          }
        } catch (retryError) {
          throw error; // Throw original error
        }
      } else {
        throw error;
      }
    }
    
    console.log('🎙️ Murf TTS: API response received, status:', response.status);

    // Handle streaming response
    let chunkCount = 0;
    return new Promise((resolve, reject) => {
      response.data.on('data', (chunk) => {
        // Send audio chunk to callback
        if (chunk && chunk.length > 0) {
          chunkCount++;
          // Only log first few chunks and every 20th chunk to reduce noise
          if (chunkCount <= 3 || chunkCount % 20 === 0) {
            console.log(`🎙️ Murf TTS: Received audio chunk ${chunkCount}, size:`, chunk.length);
          }
          // Ensure chunk is a Buffer for consistent handling
          const chunkBuffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          onAudioChunk(chunkBuffer);
        }
      });

      response.data.on('end', () => {
        console.log(`🎙️ Murf TTS: Stream completed. Total chunks: ${chunkCount} for text:`, text.substring(0, 50));
        resolve();
      });

      response.data.on('error', (error) => {
        console.error('❌ Murf TTS stream error:', error);
        console.error('Stream error details:', error.message);
        reject(error);
      });

      // Note: response is an axios response object, not a stream
      // Only response.data is the stream, so we don't need response.on()
    });
  } catch (error) {
    console.error('Murf TTS API error:', {
      message: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
    });
    
    // Try to read error response body
    if (error.response?.data) {
      try {
        // If it's a stream, we need to read it
        if (error.response.data.readable) {
          let errorBody = '';
          error.response.data.on('data', (chunk) => {
            errorBody += chunk.toString();
          });
          error.response.data.on('end', () => {
            console.error('Murf API error response body:', errorBody);
          });
        } else {
          console.error('Murf API error response:', error.response.data);
        }
      } catch (e) {
        console.error('Could not read error response:', e);
      }
    }
    
    throw error;
  }
}

