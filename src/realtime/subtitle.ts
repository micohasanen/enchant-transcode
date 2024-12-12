import ffmpeg from '../upvideo/ffmpeg';
import {EventEmitter} from 'events';
import stream from 'stream';
import {v4 as uuid} from 'uuid';
import {RealtimeSession} from 'speechmatics';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export class RealtimeSubtitler extends EventEmitter {
  url: string;
  language: string;
  translations: Array<string>;
  id: string;
  realtime: RealtimeSession;
  hls: any;
  ffmpegCommand: any;

  currentTranscript: any[] = [];

  private readonly MIN_CHARS_FOR_TRANSLATION = 50; // Increased this value
  private readonly MAX_WAIT_TIME = 5000; // 5 seconds

  constructor(
      url: string,
      language: string = 'en',
      translations: Array<string> = [],
  ) {
    super();

    this.url = url;
    this.id = uuid();
    this.language = language;
    this.translations = translations?.filter((lang) => lang !== language) || [];

    this.realtime = new RealtimeSession({
      apiKey: process.env.SPEECHMATICS_API_KEY || '',
    });

    this.realtime.addListener('Error', (error) => {
      console.error(error);
    });

    this.realtime.addListener('AddTranscript', (message) => {
      const payload = {
        id: this.id,
        language: this.language,
        start: message.metadata.start_time,
        end: message.metadata.end_time,
        text: message.metadata.transcript,
        timestamp: new Date().getTime(),
      };

      this.currentTranscript.push(payload);

      if (
        payload.text.includes('.') ||
        payload.text.includes('!') ||
        payload.text.includes('?') ||
        payload.text.includes(',')
      ) {
        const sorted = this.currentTranscript
            .sort((a: any, b: any) => a.start - b.start);

        const combinePayload = {
          id: this.id,
          language: this.language,
          text: sorted.map((res: any) => res.text).join(''),
          start: sorted[0].start,
          end: sorted[sorted.length - 1].end,
          timestamp: sorted[0].timestamp,
        };

        if (combinePayload.text.length > this.MIN_CHARS_FOR_TRANSLATION) {
          this.currentTranscript = [];

          this.emit('transcript.new', combinePayload);
          this.translateAndEmit(
              combinePayload.text,
              combinePayload.start,
              combinePayload.end,
              combinePayload.timestamp,
          );
        }
      }
    });
  }

  async start() {
    const bufferStream = new stream.PassThrough();

    const config = {
      transcription_config: {
        language: this.language,
        operating_point: 'enhanced',
        enable_partials: false,
        max_delay: 4,
      },
      audio_format: {
        type: 'raw',
        encoding: 'pcm_s16le',
        sample_rate: 44100,
      },
    } as any;

    await this.realtime.start(config);

    this.ffmpegCommand = ffmpeg(this.url)
        .native()
        .outputOptions(['-q:a 0', '-ar 44100'])
        .outputFormat('wav')
        .audioChannels(1)
        .on('start', () => {
          console.log('starting live transcript');
        })
        .on('error', (error) => {
          console.error(error);
        })
        .on('end', () => {
          console.log('transcript ended');
        });

    this.ffmpegCommand.stream(bufferStream, {end: true});

    // Feed audio to Realtime Session
    bufferStream.on('data', (buffer) => {
      this.realtime.sendAudio(buffer);
    });
    bufferStream.on('finish', () => {
      console.log('Buffer Ended');
      this.realtime.stop();
    });
  }

  stop() {
    if (this.ffmpegCommand) {
      this.ffmpegCommand.kill();
    }
    this.realtime.stop();
  }

  private lastTranslationEndTime: Record<string, number> = {};
  private lastTranslationDuration: Record<string, number> = {};

  private translateAndEmit(text: string, start: number, end: number, timestamp: number) {
    this.translations.forEach((targetLanguage) => {
      this.translateAccumulatedText(text, targetLanguage, start, end, timestamp);
    });
  }

  private async translateAccumulatedText(text: string, targetLanguage: string, start: number, end: number, timestamp: number) {
    try {
      const translatedText = await this.translateText(text, targetLanguage);

      const translationPayload = {
        id: this.id,
        language: targetLanguage,
        start,
        end,
        text: translatedText,
        timestamp,
      };

      this.emit('transcript.new', translationPayload);
    } catch (error) {
      console.error(`Error translating text to ${targetLanguage}:`, error);
    }
  }

  private async translateText(text: string, targetLanguage: string): Promise<string> {
    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {role: 'system', content: 'You are a translator. User will provide you a text to translate. Translate the text to the language that this language code represents: ' + targetLanguage + '. Only output the translation and nothing else. If, for some reason, the source text does not make sense, output an empty string. Only do this in extreme cases.'},
          {role: 'user', content: text},
        ],
        max_tokens: 10000,
        temperature: 0.7,
      });

      if (response.choices && response.choices.length > 0) {
        return response.choices[0].message?.content?.trim() || '';
      } else {
        throw new Error('No translation received from OpenAI');
      }
    } catch (error) {
      console.error('Error calling OpenAI API:', error);
      throw error;
    }
  }
}
