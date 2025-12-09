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
const requiredEnvVars = ['OPENAI_API_KEY', 'SARVAM_API_KEY'];
const missingVars = requiredEnvVars.filter(varName => !process.env[varName] || process.env[varName].trim() === '');

if (missingVars.length > 0) {
  console.error('\n❌ Missing or empty required environment variables:');
  missingVars.forEach(varName => {
    const value = process.env[varName];
    console.error(`   - ${varName}: ${value ? '(empty string)' : '(not set)'}`);
  });
  console.error('\n📝 Please check your .env file and ensure all API keys are set:');
  console.error('   OPENAI_API_KEY=your_key_here');
  console.error('   SARVAM_API_KEY=your_key_here\n');
  process.exit(1);
}

console.log('✅ All required environment variables are set\n');

import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { streamChatCompletion } from './services/openai.js';
import { streamSarvamTTS } from './services/sarvam.js';
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
      // Conversation context
      let messages = [];
      let currentSentenceBuffer = '';

      // Instantiate ConversationState with session ID (Date.now())
      let conversationState;
      try {
        const sessionId = Date.now().toString();
        conversationState = new ConversationState(sessionId);
        console.log('✅ ConversationState instantiated successfully');
        console.log('📋 Session ID:', sessionId);
        console.log('📋 Session started at:', conversationState.startTime);

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

      // Process transcript: OpenAI -> Sarvam TTS -> Client
      async function processTranscript(transcript) {
        console.log('🔄 Processing transcript:', transcript);
        console.log('📊 Current messages count:', messages.length);

        try {
          console.log('📤 Step 1: Sending to OpenAI...');

          // Ensure conversationState is valid
          if (!conversationState ||
            typeof conversationState.updateFromMessage !== 'function' ||
            typeof conversationState.getContextString !== 'function') {
            console.error('❌ conversationState is invalid, recreating...');
            conversationState = new ConversationState();
            console.log('✅ Created new ConversationState instance');
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
          }

          console.log('✅ conversationState validated successfully before streamChatCompletion');

          // Stream OpenAI response and collect sentences
          const sentences = [];

          messages = await streamChatCompletion(transcript, messages, conversationState, (token) => {
            // Buffer tokens into sentences
            currentSentenceBuffer += token;

            // Check if we have a complete sentence
            const sentenceEndRegex = /[.!?]+(\s+|$)/;
            const match = currentSentenceBuffer.search(sentenceEndRegex);

            if (match !== -1) {
              const endMatch = currentSentenceBuffer.substring(match).match(/^[.!?]+\s*/);
              const sentenceEndIndex = match + (endMatch ? endMatch[0].length : 1);

              const completeSentence = currentSentenceBuffer.substring(0, sentenceEndIndex).trim();
              currentSentenceBuffer = currentSentenceBuffer.substring(sentenceEndIndex);

              if (completeSentence) {
                sentences.push(completeSentence);
              }
            }
          });

          // Process sentences sequentially
          for (const sentence of sentences) {
            console.log('🎤 Step 2: Sending sentence to Sarvam TTS:', sentence);
            try {
              await streamSarvamTTS(sentence, (audioChunk) => {
                // Send audio chunk directly to client
                if (socket && socket.readyState === 1) {
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
                } else {
                  console.warn('⚠️ Cannot send audio - WebSocket not open, state:', socket?.readyState);
                }
              });
            } catch (error) {
              console.error('❌ Error streaming TTS:', error);
              console.error('TTS error details:', error.message, error.stack);
            }
          }

          console.log('✅ OpenAI streaming completed. Updated messages count:', messages.length);

          // Send any remaining buffer as final sentence
          if (currentSentenceBuffer.trim()) {
            console.log('🎤 Step 2 (final): Sending remaining buffer to Sarvam TTS:', currentSentenceBuffer.trim());
            try {
              await streamSarvamTTS(currentSentenceBuffer.trim(), (audioChunk) => {
                if (socket && socket.readyState === 1) {
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

      // Handle incoming messages from client
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

            if (data.type === 'close') {
              console.log('Received close request from client');

              // Close session and save data to Google Sheets
              if (conversationState) {
                try {
                  conversationState.closeSession();
                  const collectedData = conversationState.getCollectedData();

                  // Save if we have any data
                  const hasAnyData = collectedData.name || collectedData.phoneNumber ||
                    collectedData.programInterest || collectedData.priorEducation ||
                    collectedData.intakeYear || collectedData.city || collectedData.budget;

                  if (hasAnyData) {
                    console.log('💾 Saving conversation data to Google Sheets...');
                    try {
                      await saveToGoogleSheets(conversationState);
                      console.log('✅ Data saved to Google Sheets successfully');
                    } catch (sheetsError) {
                      console.error('❌ Failed to save to Google Sheets:', sheetsError.message);
                    }
                  } else {
                    console.log('ℹ️ No data to save (no fields collected)');
                  }
                } catch (error) {
                  console.error('❌ Error closing session:', error);
                }
              }

              // Close WebSocket
              if (socket.readyState === 1) {
                socket.close(1000, 'Call ended by user');
              }
              return;
            }
          } catch (e) {
            // Not JSON or invalid format, ignore
          }
        }

        // Ignore any binary/audio data since we're using Web Speech API on frontend
        // Just log it for debugging
        if (Buffer.isBuffer(message) || message instanceof ArrayBuffer) {
          console.log('ℹ️ Received audio data (ignored - using Web Speech API)');
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

            // Save to Google Sheets if we have ANY data
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
              }
            } else {
              console.log('ℹ️ No data to save (no fields collected)');
            }
          } catch (error) {
            console.error('❌ Error closing session:', error);
          }
        }
      });

      socket.on('error', (error) => {
        console.error('WebSocket error:', error);
      });

    } catch (error) {
      console.error('Error setting up WebSocket connection:', error);
      if (socket && socket.readyState === 1) {
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

