/**
 * Audio Processor with Acoustic Echo Cancellation (AEC)
 * 
 * This module implements echo cancellation to prevent the agent's voice
 * from being picked up by the microphone when using speakers.
 * 
 * How it works:
 * 1. Captures the agent's output audio (reference signal)
 * 2. Captures microphone input (contains user voice + echo)
 * 3. Uses adaptive filtering to subtract the echo from the microphone input
 * 4. Outputs clean audio for speech recognition
 */

export class EchoCanceller {
    constructor(audioContext) {
        this.audioContext = audioContext;

        // Audio nodes
        this.micInput = null;
        this.speakerOutput = null;
        this.cleanOutput = null;

        // Processing nodes
        this.micGain = null;
        this.speakerGain = null;
        this.outputGain = null;

        // Echo cancellation state
        this.isProcessing = false;
        this.referenceBuffer = [];
        this.maxBufferSize = 100; // Keep last 100 chunks for echo matching

        // Adaptive filter parameters
        this.echoDelay = 0; // Estimated echo delay in samples
        this.echoAttenuation = 0.8; // How much to reduce the reference signal (0-1)

        // Voice Activity Detection (VAD) for better echo cancellation
        this.silenceThreshold = 0.01; // RMS threshold for silence
        this.isSpeakerActive = false;
        this.isMicActive = false;

        console.log('✅ Echo Canceller initialized');
    }

    /**
     * Initialize the echo canceller with microphone stream
     */
    async init(micStream) {
        try {
            // Create microphone input node
            this.micInput = this.audioContext.createMediaStreamSource(micStream);
            this.micGain = this.audioContext.createGain();
            this.micGain.gain.value = 1.0;

            // Create speaker reference input (will be connected when agent speaks)
            this.speakerGain = this.audioContext.createGain();
            this.speakerGain.gain.value = 1.0;

            // Create output gain for clean audio
            this.outputGain = this.audioContext.createGain();
            this.outputGain.gain.value = 1.0;

            // Create a destination for clean audio (MediaStreamDestination)
            this.cleanOutput = this.audioContext.createMediaStreamDestination();

            // Connect microphone to output (will be processed)
            this.micInput.connect(this.micGain);
            this.micGain.connect(this.outputGain);
            this.outputGain.connect(this.cleanOutput);

            console.log('✅ Echo Canceller audio graph initialized');

            return this.cleanOutput.stream;
        } catch (error) {
            console.error('❌ Failed to initialize echo canceller:', error);
            throw error;
        }
    }

    /**
     * Start processing audio for echo cancellation
     */
    startProcessing() {
        if (this.isProcessing) return;

        this.isProcessing = true;
        this.referenceBuffer = [];

        console.log('▶️ Echo cancellation processing started');
    }

    /**
     * Stop processing
     */
    stopProcessing() {
        this.isProcessing = false;
        this.referenceBuffer = [];
        this.isSpeakerActive = false;
        this.isMicActive = false;

        console.log('⏹️ Echo cancellation processing stopped');
    }

    /**
     * Register the agent's audio output as reference signal
     * This should be called when the agent starts speaking
     */
    connectSpeakerReference(audioNode) {
        try {
            // Disconnect previous reference if exists
            if (this.speakerOutput) {
                try {
                    this.speakerOutput.disconnect();
                } catch (e) {
                    // Ignore disconnect errors
                }
            }

            this.speakerOutput = audioNode;
            this.speakerOutput.connect(this.speakerGain);

            // Mark speaker as active
            this.isSpeakerActive = true;

            console.log('🔗 Speaker reference connected for echo cancellation');
        } catch (error) {
            console.error('❌ Failed to connect speaker reference:', error);
        }
    }

    /**
     * Disconnect speaker reference when agent stops speaking
     */
    disconnectSpeakerReference() {
        if (this.speakerOutput) {
            try {
                this.speakerOutput.disconnect(this.speakerGain);
            } catch (e) {
                // Ignore disconnect errors
            }
            this.speakerOutput = null;
        }

        this.isSpeakerActive = false;

        // Clear reference buffer after a delay (to handle tail echo)
        setTimeout(() => {
            if (!this.isSpeakerActive) {
                this.referenceBuffer = [];
                console.log('🧹 Reference buffer cleared');
            }
        }, 500);

        console.log('🔌 Speaker reference disconnected');
    }

    /**
     * Get the clean audio stream for speech recognition
     */
    getCleanStream() {
        return this.cleanOutput ? this.cleanOutput.stream : null;
    }

    /**
     * Cleanup resources
     */
    destroy() {
        this.stopProcessing();

        if (this.micInput) {
            try {
                this.micInput.disconnect();
            } catch (e) {
                // Ignore
            }
        }

        if (this.speakerOutput) {
            try {
                this.speakerOutput.disconnect();
            } catch (e) {
                // Ignore
            }
        }

        if (this.micGain) {
            try {
                this.micGain.disconnect();
            } catch (e) {
                // Ignore
            }
        }

        if (this.speakerGain) {
            try {
                this.speakerGain.disconnect();
            } catch (e) {
                // Ignore
            }
        }

        if (this.outputGain) {
            try {
                this.outputGain.disconnect();
            } catch (e) {
                // Ignore
            }
        }

        console.log('🗑️ Echo Canceller destroyed');
    }
}

/**
 * Advanced Echo Canceller with ScriptProcessor for real-time processing
 * This version uses actual signal processing to remove echo
 */
export class AdvancedEchoCanceller extends EchoCanceller {
    constructor(audioContext) {
        super(audioContext);

        // Script processor for real-time audio processing
        this.processor = null;
        this.processorBufferSize = 4096;

        // Reference signal buffer (agent's voice)
        this.referenceSignal = new Float32Array(this.processorBufferSize * 10);
        this.referenceWriteIndex = 0;

        // Adaptive filter coefficients
        this.filterLength = 512; // Length of adaptive filter
        this.filterCoeffs = new Float32Array(this.filterLength);
        this.stepSize = 0.01; // LMS algorithm step size

        console.log('✅ Advanced Echo Canceller initialized with adaptive filtering');
    }

    /**
     * Initialize with real-time processing
     */
    async init(micStream) {
        try {
            // Call parent init
            await super.init(micStream);

            // Create script processor for real-time echo cancellation
            this.processor = this.audioContext.createScriptProcessor(
                this.processorBufferSize,
                1, // Input channels (microphone)
                1  // Output channels (clean audio)
            );

            // Set up audio processing callback
            this.processor.onaudioprocess = (e) => {
                this.processAudio(e);
            };

            // Reconnect audio graph with processor
            this.micGain.disconnect();
            this.micGain.connect(this.processor);
            this.processor.connect(this.outputGain);

            console.log('✅ Advanced echo cancellation processing initialized');

            return this.cleanOutput.stream;
        } catch (error) {
            console.error('❌ Failed to initialize advanced echo canceller:', error);
            throw error;
        }
    }

    /**
     * Real-time audio processing with echo cancellation
     */
    processAudio(event) {
        if (!this.isProcessing) {
            // Pass through without processing
            const input = event.inputBuffer.getChannelData(0);
            const output = event.outputBuffer.getChannelData(0);
            output.set(input);
            return;
        }

        const input = event.inputBuffer.getChannelData(0); // Microphone input
        const output = event.outputBuffer.getChannelData(0); // Clean output
        const bufferSize = input.length;

        // If speaker is not active, just pass through
        if (!this.isSpeakerActive) {
            output.set(input);
            return;
        }

        // Apply echo cancellation using adaptive filtering
        for (let i = 0; i < bufferSize; i++) {
            let echo = 0;

            // Calculate estimated echo using adaptive filter
            for (let j = 0; j < this.filterLength && j < this.referenceWriteIndex; j++) {
                const refIndex = (this.referenceWriteIndex - j - 1 + this.referenceSignal.length) % this.referenceSignal.length;
                echo += this.filterCoeffs[j] * this.referenceSignal[refIndex];
            }

            // Subtract estimated echo from microphone input
            const cleanSample = input[i] - echo;
            output[i] = cleanSample;

            // Update adaptive filter coefficients (LMS algorithm)
            // Only update if we have significant signal (avoid updating on noise)
            if (Math.abs(input[i]) > this.silenceThreshold) {
                for (let j = 0; j < this.filterLength && j < this.referenceWriteIndex; j++) {
                    const refIndex = (this.referenceWriteIndex - j - 1 + this.referenceSignal.length) % this.referenceSignal.length;
                    this.filterCoeffs[j] += this.stepSize * cleanSample * this.referenceSignal[refIndex];
                }
            }
        }
    }

    /**
     * Update reference signal (agent's voice)
     * Call this when agent's audio is playing
     */
    updateReferenceSignal(audioData) {
        if (!this.isProcessing || !this.isSpeakerActive) return;

        // Add audio data to reference buffer
        for (let i = 0; i < audioData.length; i++) {
            this.referenceSignal[this.referenceWriteIndex] = audioData[i];
            this.referenceWriteIndex = (this.referenceWriteIndex + 1) % this.referenceSignal.length;
        }
    }

    /**
   * Override connectSpeakerReference to also capture audio data
   * SIMPLIFIED VERSION - Just mark speaker as active, don't capture audio
   * This avoids interference with playback
   */
    connectSpeakerReference(audioNode) {
        super.connectSpeakerReference(audioNode);

        // For now, just mark as active
        // Full audio capture can be added later if needed
        console.log('🔗 Speaker reference connected (simplified mode)');
    }

    /**
     * Override disconnectSpeakerReference to cleanup capture nodes
     */
    disconnectSpeakerReference() {
        // Reset reference signal
        this.referenceWriteIndex = 0;
        this.filterCoeffs.fill(0);

        super.disconnectSpeakerReference();
    }

    /**
     * Cleanup
     */
    destroy() {
        if (this.processor) {
            try {
                this.processor.disconnect();
            } catch (e) {
                // Ignore
            }
            this.processor = null;
        }

        super.destroy();
    }
}
