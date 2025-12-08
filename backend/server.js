// Load environment variables FIRST before any other imports
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env file explicitly
const envPath = join(__dirname, '.env');
const result = dotenv.config({ path: envPath });

if (result.error) {
  console.warn('⚠️  Warning: .env file not found or could not be loaded:', result.error.message);
  console.warn('   Attempting to load from process.env...');
} else {
  console.log('✅ .env file loaded successfully');
}

// Verify required environment variables at startup
const requiredEnvVars = ['DEEPGRAM_API_KEY', 'OPENAI_API_KEY', 'ELEVENLABS_API_KEY'];
const missingVars = requiredEnvVars.filter(varName => !process.env[varName] || process.env[varName].trim() === '');

if (missingVars.length > 0) {
  console.error('\n❌ Missing or empty required environment variables:');
  missingVars.forEach(varName => {
    const value = process.env[varName];
    console.error(`   - ${varName}: ${value ? '(empty string)' : '(not set)'}`);
  });
  console.error('\n📝 Please check your .env file and ensure all API keys are set:');
  console.error('   DEEPGRAM_API_KEY=your_key_here');
  console.error('   OPENAI_API_KEY=your_key_here');
  console.error('   ELEVENLABS_API_KEY=your_key_here\n');
  process.exit(1);
}

console.log('✅ All required environment variables are set\n');

import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { createClient } from '@deepgram/sdk';
import { streamChatCompletion } from './services/openai.js';
import { streamElevenLabsTTS } from './services/elevenlabs.js';
import { ConversationState } from './services/conversationState.js';
import { saveToGoogleSheets, updateFieldInGoogleSheets } from './services/googleSheets.js';

// WebSocket readyState constants
const WS_OPEN = 1; // WebSocket.OPEN

const fastify = Fastify({
  logger: true,
});

// Register WebSocket plugin
await fastify.register(websocket);

// Health check route for Azure Load Balancer
fastify.get('/health', async (request, reply) => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// Test Google Sheets connection
fastify.get('/test-sheets', async (request, reply) => {
  try {
    const { testGoogleSheetsConnection } = await import('./services/googleSheets.js');
    const result = await testGoogleSheetsConnection();
    return {
      status: result ? 'success' : 'failed',
      message: result ? 'Google Sheets connection successful' : 'Google Sheets connection failed'
    };
  } catch (error) {
    return {
      status: 'error',
      message: error.message
    };
  }
});

// WebSocket connection route
fastify.register(async function (fastify) {
  fastify.get('/connection', { websocket: true }, (connection, req) => {
    console.log('New WebSocket connection established from:', req.socket.remoteAddress);

    // In Fastify WebSocket, connection is the socket itself
    const socket = connection.socket || connection;

    try {
      // Initialize Deepgram client
      if (!process.env.DEEPGRAM_API_KEY) {
        console.error('DEEPGRAM_API_KEY is missing');
        socket.close(1008, 'Server configuration error');
        return;
      }

      const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

      // Create Deepgram live connection
      let deepgramConnection;
      let deepgramReady = false; // Track if Deepgram is ready to receive audio
      let keepAliveInterval = null; // Keep-alive interval to prevent timeout

      try {
        console.log('Creating Deepgram live connection...');
        deepgramConnection = deepgram.listen.live({
          model: 'nova-2',
          language: 'en',
          smart_format: true,
          interim_results: true,
          endpointing: 300,
          utterance_end_ms: 1000,
        });
        console.log('Deepgram live connection created successfully');

        if (!deepgramConnection) {
          throw new Error('Deepgram.listen.live() returned undefined');
        }
      } catch (error) {
        console.error('Failed to create Deepgram connection:', error);
        console.error('Error details:', error.message, error.stack);
        if (socket && socket.readyState === 1) {
          socket.close(1011, 'Failed to initialize Deepgram: ' + error.message);
        }
        return;
      }

      // Conversation context
      let messages = [];
      let currentSentenceBuffer = '';

      // Instantiate ConversationState with session ID (Date.now())
      let conversationState; // Use let instead of const to allow recreation if needed
      try {
        const sessionId = Date.now().toString(); // Create session ID using Date.now()
        conversationState = new ConversationState(sessionId);
        console.log('✅ ConversationState instantiated successfully');
        console.log('📋 Session ID:', sessionId);
        console.log('📋 Session started at:', conversationState.startTime);
        console.log('conversationState type:', typeof conversationState);
        console.log('has getContextString:', typeof conversationState.getContextString === 'function');

        // Set up callback to update Google Sheets incrementally as data is collected
        conversationState.setSheetsUpdateCallback(async (fieldName, value) => {
          console.log(`💾 Updating ${fieldName} = "${value}" in Google Sheets...`);
          await updateFieldInGoogleSheets(conversationState, fieldName, value);
        });

        // Test the method
        const testContext = conversationState.getContextString();
        console.log('✅ getContextString() test successful, length:', testContext.length);
      } catch (error) {
        console.error('❌ Failed to instantiate ConversationState:', error);
        throw error;
      }

      // Handle Deepgram connection events (only if deepgramConnection exists)
      if (!deepgramConnection) {
        console.error('deepgramConnection is undefined, cannot set up event handlers');
        if (socket && socket.readyState === 1) {
          socket.close(1011, 'Deepgram connection initialization failed');
        }
        return;
      }

      deepgramConnection.on('open', () => {
        console.log('✅ Deepgram connection opened successfully');
        deepgramReady = true; // Mark as ready to receive audio

        // Send a keep-alive message to prevent timeout
        // Deepgram needs to receive data within timeout window
        try {
          // Send empty audio buffer as keep-alive (silence)
          const silence = Buffer.alloc(3200); // 100ms of silence at 16kHz, 16-bit mono
          deepgramConnection.send(silence);
          console.log('🔊 Sent initial keep-alive to Deepgram');

          // Set up periodic keep-alive (every 5 seconds) to prevent timeout
          if (keepAliveInterval) {
            clearInterval(keepAliveInterval);
          }
          keepAliveInterval = setInterval(() => {
            if (deepgramConnection && deepgramReady) {
              try {
                const silence = Buffer.alloc(3200);
                deepgramConnection.send(silence);
              } catch (error) {
                console.error('Error sending periodic keep-alive:', error);
              }
            }
          }, 5000); // Every 5 seconds
        } catch (error) {
          console.error('Error sending keep-alive:', error);
        }
      });

      deepgramConnection.on('error', (error) => {
        console.error('❌ Deepgram connection error:', error);
        console.error('Error details:', error.message, error.stack || error);
        // Don't close WebSocket on Deepgram error - send error message to client instead
        if (socket && socket.readyState === 1) {
          try {
            socket.send(JSON.stringify({
              error: 'Deepgram error: ' + (error.message || String(error)),
              type: 'deepgram_error'
            }));
          } catch (e) {
            console.error('Failed to send error to client:', e);
          }
        }
      });

      // Handle Deepgram close event
      deepgramConnection.on('close', (event) => {
        console.log('⚠️ Deepgram connection closed:', event);
        console.log('Close code:', event.code, 'Reason:', event.reason || 'No reason');

        // If WebSocket is still open and call is active, try to reconnect Deepgram
        if (socket && socket.readyState === 1) {
          console.log('🔄 Attempting to reconnect Deepgram...');
          try {
            // Recreate Deepgram connection
            const newDeepgramConnection = deepgram.listen.live({
              model: 'nova-2',
              language: 'en',
              smart_format: true,
              interim_results: true,
              endpointing: 300,
              utterance_end_ms: 1000,
            });

            // Set up event handlers for new connection
            newDeepgramConnection.on('open', () => {
              console.log('✅ Deepgram reconnected successfully');
              deepgramReady = true; // Mark as ready

              // Send keep-alive to prevent immediate timeout
              try {
                const silence = Buffer.alloc(3200);
                newDeepgramConnection.send(silence);
                console.log('🔊 Sent keep-alive to reconnected Deepgram');
              } catch (error) {
                console.error('Error sending keep-alive to reconnected Deepgram:', error);
              }
            });

            newDeepgramConnection.on('error', (error) => {
              console.error('❌ Reconnected Deepgram error:', error);
            });

            newDeepgramConnection.on('results', (data) => {
              const transcript = data.channel?.alternatives?.[0]?.transcript;
              if (!transcript) return;
              const isFinal = data.is_final;
              if (isFinal) {
                console.log('✅ SpeechFinal received:', transcript);
                processTranscript(transcript).catch((error) => {
                  console.error('Error in processTranscript:', error);
                });
              }
            });

            // Update the reference
            deepgramConnection = newDeepgramConnection;
            deepgramReady = false; // Reset ready state until 'open' event
            console.log('✅ Deepgram connection reference updated');
          } catch (error) {
            console.error('❌ Failed to reconnect Deepgram:', error);
          }
        }
      });

      deepgramConnection.on('warning', (warning) => {
        console.warn('Deepgram warning:', warning);
      });

      deepgramConnection.on('metadata', (metadata) => {
        console.log('Deepgram metadata:', metadata);
      });

      // Handle Deepgram transcript results
      deepgramConnection.on('results', (data) => {
        const transcript = data.channel?.alternatives?.[0]?.transcript;

        if (!transcript) return;

        const isFinal = data.is_final;

        console.log('Deepgram result - isFinal:', isFinal, 'transcript:', transcript);

        if (isFinal) {
          console.log('✅ SpeechFinal received:', transcript);

          // Process transcript through OpenAI -> ElevenLabs pipeline
          processTranscript(transcript).catch((error) => {
            console.error('Error in processTranscript:', error);
          });
        }
      });

      // Process transcript: OpenAI -> ElevenLabs -> Client
      async function processTranscript(transcript) {
        console.log('🔄 Processing transcript:', transcript);
        console.log('📊 Current messages count:', messages.length);

        try {
          console.log('📤 Step 1: Sending to OpenAI...');

          // Ensure conversationState is valid - check both methods
          if (!conversationState ||
            typeof conversationState.updateFromMessage !== 'function' ||
            typeof conversationState.getContextString !== 'function') {
            console.error('❌ conversationState is invalid, recreating...');
            console.error('conversationState exists:', !!conversationState);
            if (conversationState) {
              console.error('has updateFromMessage:', typeof conversationState.updateFromMessage);
              console.error('has getContextString:', typeof conversationState.getContextString);
            }
            conversationState = new ConversationState();
            console.log('✅ Created new ConversationState instance');

            // Verify the new instance
            if (typeof conversationState.getContextString !== 'function') {
              console.error('❌ New ConversationState instance also invalid!');
              throw new Error('Failed to create valid ConversationState instance');
            }
          }

          // Update conversation state with user message
          try {
            console.log('🔍 Extracting data from transcript:', transcript);
            const beforeData = { ...conversationState.getCollectedData() };
            conversationState.updateFromMessage(transcript, '');
            const afterData = conversationState.getCollectedData();

            // Log what changed
            const changes = [];
            for (const key in afterData) {
              if (beforeData[key] !== afterData[key]) {
                changes.push(`${key}: ${beforeData[key]} → ${afterData[key]}`);
              }
            }
            if (changes.length > 0) {
              console.log('✅ Data extracted:', changes.join(', '));
            }
          } catch (error) {
            console.error('❌ Error updating conversation state:', error);
            console.error('Error stack:', error.stack);
            // Continue anyway
          }

          // Final verification before passing to streamChatCompletion
          if (!conversationState || typeof conversationState.getContextString !== 'function') {
            console.error('❌ conversationState still invalid after update, recreating...');
            conversationState = new ConversationState();
            conversationState.updateFromMessage(transcript, '');

            // Last check
            if (typeof conversationState.getContextString !== 'function') {
              console.error('❌ CRITICAL: Cannot create valid ConversationState!');
              throw new Error('ConversationState validation failed');
            }
          }

          console.log('✅ conversationState validated successfully before streamChatCompletion');

          // Stream OpenAI response and update messages array
          // Collect sentences first, then process them sequentially to avoid audio chunk interleaving
          const sentences = [];

          messages = await streamChatCompletion(transcript, messages, conversationState, (token) => {
            // Buffer tokens into sentences
            currentSentenceBuffer += token;

            // Check if we have a complete sentence (ends with punctuation followed by space or end)
            // This regex matches: punctuation + optional whitespace + word boundary or end
            const sentenceEndRegex = /[.!?]+(\s+|$)/;
            const match = currentSentenceBuffer.search(sentenceEndRegex);

            if (match !== -1) {
              // Find the end of the sentence (including punctuation and trailing space)
              const endMatch = currentSentenceBuffer.substring(match).match(/^[.!?]+\s*/);
              const sentenceEndIndex = match + (endMatch ? endMatch[0].length : 1);

              const completeSentence = currentSentenceBuffer.substring(0, sentenceEndIndex).trim();
              currentSentenceBuffer = currentSentenceBuffer.substring(sentenceEndIndex);

              if (completeSentence) {
                sentences.push(completeSentence);
              }
            }
          });

          // Process sentences sequentially to ensure audio chunks are sent in order
          for (const sentence of sentences) {
            console.log('🎤 Step 2: Sending sentence to ElevenLabs TTS:', sentence);
            try {
              // Wait for each TTS call to complete before starting the next one
              await streamElevenLabsTTS(sentence, (audioChunk) => {
                // Send audio chunk directly to client
                if (socket && socket.readyState === 1) { // WebSocket.OPEN
                  // Convert Buffer to proper format for WebSocket
                  // WebSocket.send() can handle Buffer directly, but ensure it's the right format
                  if (Buffer.isBuffer(audioChunk)) {
                    // Buffer is already in the right format for WebSocket
                    socket.send(audioChunk);
                  } else if (audioChunk instanceof ArrayBuffer) {
                    socket.send(audioChunk);
                  } else if (audioChunk.buffer instanceof ArrayBuffer) {
                    // TypedArray - convert to ArrayBuffer
                    socket.send(audioChunk.buffer.slice(
                      audioChunk.byteOffset,
                      audioChunk.byteOffset + audioChunk.byteLength
                    ));
                  } else {
                    // Fallback: convert to Buffer
                    socket.send(Buffer.from(audioChunk));
                  }
                } else {
                  console.warn('⚠️ Cannot send audio - WebSocket not open, state:', socket?.readyState);
                }
              });
            } catch (error) {
              console.error('❌ Error streaming TTS:', error);
              console.error('TTS error details:', error.message, error.stack);
              // Continue with next sentence even if this one fails
            }
          }

          console.log('✅ OpenAI streaming completed. Updated messages count:', messages.length);

          // Extract data from assistant response (disabled to prevent extracting agent's name)
          // The assistant saying "I'm Ayesha" was being incorrectly extracted as the user's name
          /* 
          try {
            const lastMessage = messages[messages.length - 1];
            if (lastMessage && lastMessage.role === 'assistant' && lastMessage.content) {
              console.log('🔍 Extracting data from assistant response:', lastMessage.content.substring(0, 100) + '...');
              const beforeData = { ...conversationState.getCollectedData() };
              conversationState.updateFromMessage(lastMessage.content, transcript);
              const afterData = conversationState.getCollectedData();
              
              // Log what changed
              const changes = [];
              for (const key in afterData) {
                if (beforeData[key] !== afterData[key]) {
                  changes.push(`${key}: ${beforeData[key]} → ${afterData[key]}`);
                }
              }
              if (changes.length > 0) {
                console.log('✅ Data extracted from assistant response:', changes.join(', '));
              }
            }
          } catch (error) {
            console.error('❌ Error extracting from assistant response:', error);
          }
          */

          // Send any remaining buffer as final sentence
          if (currentSentenceBuffer.trim()) {
            console.log('🎤 Step 2 (final): Sending remaining buffer to ElevenLabs TTS:', currentSentenceBuffer.trim());
            try {
              await streamElevenLabsTTS(currentSentenceBuffer.trim(), (audioChunk) => {
                if (socket && socket.readyState === 1) {
                  // Convert Buffer to proper format for WebSocket
                  if (Buffer.isBuffer(audioChunk)) {
                    socket.send(audioChunk);
                  } else if (audioChunk instanceof ArrayBuffer) {
                    socket.send(audioChunk);
                  } else if (audioChunk.buffer instanceof ArrayBuffer) {
                    socket.send(audioChunk.buffer.slice(
                      audioChunk.byteOffset,
                      audioChunk.byteOffset + audioChunk.byteLength
                    ));
                  } else {
                    socket.send(Buffer.from(audioChunk));
                  }
                }
              });
            } catch (error) {
              console.error('❌ Error streaming final TTS:', error);
              console.error('Final TTS error details:', error.message, error.stack);
            }
            currentSentenceBuffer = '';
          }
        } catch (error) {
          console.error('❌ Error processing transcript:', error);
          console.error('Error details:', error.message);
          console.error('Error stack:', error.stack);
          if (socket && socket.readyState === 1) {
            socket.send(JSON.stringify({ error: 'Failed to process transcript: ' + error.message }));
          }
        }
      }

      // Handle incoming audio from client
      if (!socket) {
        console.error('socket is undefined');
        return;
      }

      let audioMessageCount = 0;
      socket.on('message', async (message) => {
        // Check if message is text (transcript from Web Speech API)
        if (typeof message === 'string' || message instanceof String || Buffer.isBuffer(message) && message.toString().startsWith('{')) {
          try {
            const data = typeof message === 'string' ? JSON.parse(message) : JSON.parse(message.toString());
            if (data.type === 'transcript' && data.text) {
              console.log('📝 Received transcript from Web Speech API:', data.text);
              processTranscript(data.text).catch((error) => {
                console.error('Error in processTranscript:', error);
              });
              return;
            }
          } catch (e) {
            // Not JSON, continue to audio processing
          }
        }

        // Log all incoming messages to debug
        const messageType = Buffer.isBuffer(message) ? 'Buffer' : message instanceof ArrayBuffer ? 'ArrayBuffer' : typeof message;
        if (audioMessageCount === 0 || audioMessageCount % 100 === 0) {
          console.log(`📨 Received message type: ${messageType}, size: ${message.byteLength || message.length || 'unknown'}`);
        }

        // Forward raw PCM audio bytes to Deepgram
        if (Buffer.isBuffer(message) || message instanceof ArrayBuffer) {
          if (!deepgramConnection) {
            if (audioMessageCount === 0) {
              console.warn('⚠️ Deepgram connection not available, ignoring audio');
            }
            return;
          }

          // Check if Deepgram is ready, but don't block if audio is arriving
          if (!deepgramReady) {
            if (audioMessageCount === 0) {
              console.warn('⚠️ Deepgram not ready yet, but audio is arriving. Will send when ready.');
            }
            // Don't return - we'll try to send anyway if connection exists
          }

          try {
            // Convert message to Buffer properly
            let audioBuffer;
            if (Buffer.isBuffer(message)) {
              audioBuffer = message;
            } else if (message instanceof ArrayBuffer) {
              audioBuffer = Buffer.from(message);
            } else if (message.buffer instanceof ArrayBuffer) {
              audioBuffer = Buffer.from(message.buffer);
            } else {
              console.warn('⚠️ Unknown message type, cannot convert to buffer');
              return;
            }

            // Only send if we have a valid buffer with reasonable size
            if (!audioBuffer || audioBuffer.length === 0) {
              return;
            }

            // Log suspiciously small buffers
            if (audioBuffer.length < 100) {
              console.warn(`⚠️ Suspiciously small audio buffer: ${audioBuffer.length} bytes (expected ~8192 bytes)`);
            }

            // Send to Deepgram - try even if deepgramReady is false (connection might be ready)
            try {
              if (deepgramConnection) {
                deepgramConnection.send(audioBuffer);
                audioMessageCount++;
                deepgramReady = true; // Assume ready if send succeeds

                if (audioMessageCount === 1 || audioMessageCount % 50 === 0) {
                  console.log(`📥 ✅ Sent ${audioMessageCount} audio messages to Deepgram, size: ${audioBuffer.length} bytes`);
                }
              } else {
                console.warn('⚠️ Deepgram connection is null');
              }
            } catch (sendError) {
              // If send fails, mark as not ready and log
              deepgramReady = false;
              if (audioMessageCount === 0 || audioMessageCount % 100 === 0) {
                console.error('❌ Error sending audio to Deepgram:', sendError.message);
                console.error('Error type:', sendError.name);
              }
            }
          } catch (error) {
            console.error('❌ Error processing audio buffer:', error);
            console.error('Error details:', error.message);
          }
        } else {
          // Handle text messages (e.g., connection control)
          try {
            const data = JSON.parse(message.toString());
            if (data.type === 'close') {
              console.log('Received close request from client');

              // Close session and save data to Google Sheets before closing connection
              if (conversationState) {
                try {
                  conversationState.closeSession();
                  const collectedData = conversationState.getCollectedData();

                  // Only save if we have at least some data (name is minimum)
                  if (collectedData.name) {
                    console.log('💾 Saving conversation data to Google Sheets...');
                    try {
                      await saveToGoogleSheets(conversationState);
                      console.log('✅ Data saved to Google Sheets successfully');
                    } catch (sheetsError) {
                      console.error('❌ Failed to save to Google Sheets:', sheetsError.message);
                      // Continue with close even if save fails
                    }
                  } else {
                    console.log('ℹ️ No data to save (name not collected)');
                  }
                } catch (error) {
                  console.error('❌ Error closing session:', error);
                }
              }

              if (deepgramConnection) {
                try {
                  deepgramConnection.finish();
                } catch (e) {
                  console.error('Error finishing Deepgram connection:', e);
                }
              }
              // Close with normal closure code
              if (socket.readyState === 1) {
                socket.close(1000, 'Call ended by user');
              }
            }
          } catch (e) {
            // Ignore non-JSON messages
          }
        }
      });

      // Handle client disconnect
      socket.on('close', async (code, reason) => {
        console.log('WebSocket connection closed by client:', code, reason?.toString() || 'No reason');

        // Close session and save data to Google Sheets
        if (conversationState) {
          try {
            conversationState.closeSession();
            const collectedData = conversationState.getCollectedData();
            const dataSummary = conversationState.getDataSummary();

            console.log('📊 Final collected data summary:', dataSummary);
            console.log('📊 Full data object:', collectedData);

            // Save to Google Sheets if we have ANY data (not just name)
            // Check if we have at least one field filled
            const hasAnyData = collectedData.name || collectedData.phoneNumber ||
              collectedData.programInterest || collectedData.priorEducation ||
              collectedData.intakeYear || collectedData.city || collectedData.budget;

            if (hasAnyData) {
              console.log('💾 Saving conversation data to Google Sheets (new row for this session)...');
              try {
                await saveToGoogleSheets(conversationState);
                console.log('✅ Data saved to Google Sheets successfully');
              } catch (sheetsError) {
                console.error('❌ Failed to save to Google Sheets:', sheetsError.message);
                // Don't throw - allow connection to close normally
              }
            } else {
              console.log('ℹ️ No data to save (no fields collected)');
            }
          } catch (error) {
            console.error('❌ Error closing session:', error);
          }
        }

        // Clear keep-alive interval
        if (keepAliveInterval) {
          clearInterval(keepAliveInterval);
          keepAliveInterval = null;
        }

        if (deepgramConnection) {
          try {
            deepgramConnection.finish();
          } catch (e) {
            console.error('Error finishing Deepgram connection:', e);
          }
        }
      });

      socket.on('error', (error) => {
        console.error('WebSocket error:', error);
        if (deepgramConnection) {
          try {
            deepgramConnection.finish();
          } catch (e) {
            console.error('Error finishing Deepgram connection:', e);
          }
        }
      });

    } catch (error) {
      console.error('Error setting up WebSocket connection:', error);
      if (socket && socket.readyState === 1) { // WebSocket.OPEN = 1
        socket.close(1011, 'Server error: ' + error.message);
      }
    }
  });
});

// Start server
const PORT = process.env.PORT || 8080;
const HOST = '0.0.0.0';

fastify.listen({ port: PORT, host: HOST }, (err, address) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
  console.log(`Server listening on ${address}`);
  console.log(`Health check available at ${address}/health`);
  console.log(`WebSocket endpoint available at ws://${HOST}:${PORT}/connection`);
});

