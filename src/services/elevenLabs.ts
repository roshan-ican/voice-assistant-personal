// services/elevenLabsService.ts
import axios from 'axios';
import FormData from 'form-data';
import { FastifyBaseLogger } from 'fastify';

interface ElevenLabsVoice {
    voice_id: string;
    name: string;
    category?: string;
    labels?: Record<string, string>;
}

interface TTSOptions {
    voiceId?: string;
    modelId?: string;
    stability?: number;
    similarityBoost?: number;
    style?: number;
    useSpeakerBoost?: boolean;
}

interface STTOptions {
    language?: string;
}

interface TranscriptionResponse {
    text: string;
    chunks?: Array<{
        text: string;
        timestamp: [number, number];
    }>;
}

interface TTSResponse {
    audioBuffer: Buffer;
    mimeType: string;
}

export class ElevenLabsService {
    private apiKey: string;
    private baseUrl = 'https://api.elevenlabs.io/v1';
    private defaultVoiceId: string;
    private defaultModelId: string;
    
    constructor(
        apiKey: string,
        private logger?: FastifyBaseLogger
    ) {
        this.apiKey = apiKey;
        // Default voices - you can change these
        this.defaultVoiceId = 'EXAVITQu4vr4xnSDxMaL'; // Sarah - conversational
        this.defaultModelId = 'eleven_turbo_v2'; // Latest turbo model
    }

    // Speech-to-Text using 11 Labs
    async transcribeAudio(
        audioBuffer: Buffer,
        options: STTOptions = {}
    ): Promise<TranscriptionResponse> {
        try {
            const formData = new FormData();
            
            // Add audio file
            formData.append('audio', audioBuffer, {
                filename: 'audio.webm',
                contentType: 'audio/webm'
            });

            // Add model (11 Labs uses Whisper under the hood)
            formData.append('model', 'whisper-1');
            
            // Add language if specified
            if (options.language) {
                formData.append('language', options.language);
            }

            const response = await axios.post(
                `${this.baseUrl}/speech-to-text`,
                formData,
                {
                    headers: {
                        ...formData.getHeaders(),
                        'xi-api-key': this.apiKey
                    }
                }
            );

            this.logger?.info('11 Labs transcription successful', {
                textLength: response.data.text?.length
            });

            return {
                text: response.data.text,
                chunks: response.data.chunks
            };
        } catch (error) {
            this.logger?.error('11 Labs STT error:', error);
            
            // Fallback error handling
            if (axios.isAxiosError(error)) {
                const errorMessage = error.response?.data?.detail?.message || error.message;
                throw new Error(`11 Labs STT failed: ${errorMessage}`);
            }
            
            throw new Error(`Failed to transcribe audio: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    // Text-to-Speech using 11 Labs
    async synthesizeSpeech(
        text: string,
        options: TTSOptions = {}
    ): Promise<TTSResponse> {
        try {
            const voiceId = options.voiceId || this.defaultVoiceId;
            const modelId = options.modelId || this.defaultModelId;

            const response = await axios.post(
                `${this.baseUrl}/text-to-speech/${voiceId}`,
                {
                    text,
                    model_id: modelId,
                    voice_settings: {
                        stability: options.stability ?? 0.5,
                        similarity_boost: options.similarityBoost ?? 0.75,
                        style: options.style ?? 0.0,
                        use_speaker_boost: options.useSpeakerBoost ?? true
                    }
                },
                {
                    headers: {
                        'xi-api-key': this.apiKey,
                        'Content-Type': 'application/json',
                        'Accept': 'audio/mpeg'
                    },
                    responseType: 'arraybuffer'
                }
            );

            const audioBuffer = Buffer.from(response.data);

            this.logger?.info('11 Labs TTS successful', {
                textLength: text.length,
                audioSize: audioBuffer.length,
                voiceId,
                modelId
            });

            return {
                audioBuffer,
                mimeType: 'audio/mpeg'
            };
        } catch (error) {
            this.logger?.error('11 Labs TTS error:', error);
            
            if (axios.isAxiosError(error)) {
                const errorMessage = error.response?.data?.detail?.message || error.message;
                throw new Error(`11 Labs TTS failed: ${errorMessage}`);
            }
            
            throw new Error(`Failed to synthesize speech: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    // Text-to-Speech with streaming (for lower latency)
    async synthesizeSpeechStream(
        text: string,
        options: TTSOptions = {}
    ): Promise<NodeJS.ReadableStream> {
        try {
            const voiceId = options.voiceId || this.defaultVoiceId;
            const modelId = options.modelId || this.defaultModelId;

            const response = await axios.post(
                `${this.baseUrl}/text-to-speech/${voiceId}/stream`,
                {
                    text,
                    model_id: modelId,
                    voice_settings: {
                        stability: options.stability ?? 0.5,
                        similarity_boost: options.similarityBoost ?? 0.75,
                        style: options.style ?? 0.0,
                        use_speaker_boost: options.useSpeakerBoost ?? true
                    }
                },
                {
                    headers: {
                        'xi-api-key': this.apiKey,
                        'Content-Type': 'application/json',
                        'Accept': 'audio/mpeg'
                    },
                    responseType: 'stream'
                }
            );

            return response.data;
        } catch (error) {
            this.logger?.error('11 Labs TTS stream error:', error);
            throw new Error(`Failed to create speech stream: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    // Get available voices
    async getVoices(): Promise<ElevenLabsVoice[]> {
        try {
            const response = await axios.get(
                `${this.baseUrl}/voices`,
                {
                    headers: {
                        'xi-api-key': this.apiKey
                    }
                }
            );

            return response.data.voices;
        } catch (error) {
            this.logger?.error('Failed to fetch voices:', error);
            throw new Error('Failed to fetch available voices');
        }
    }

    // Get subscription info (useful for quota tracking)
    async getSubscriptionInfo() {
        try {
            const response = await axios.get(
                `${this.baseUrl}/user/subscription`,
                {
                    headers: {
                        'xi-api-key': this.apiKey
                    }
                }
            );

            return response.data;
        } catch (error) {
            this.logger?.error('Failed to fetch subscription info:', error);
            throw error;
        }
    }

    // Get usage info
    async getUsageInfo() {
        try {
            const response = await axios.get(
                `${this.baseUrl}/user`,
                {
                    headers: {
                        'xi-api-key': this.apiKey
                    }
                }
            );

            return {
                character_count: response.data.subscription.character_count,
                character_limit: response.data.subscription.character_limit,
                available_characters: response.data.subscription.character_limit - response.data.subscription.character_count
            };
        } catch (error) {
            this.logger?.error('Failed to fetch usage info:', error);
            throw error;
        }
    }
}
