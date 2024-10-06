import ffmpeg from '../upvideo/ffmpeg';
import {EventEmitter} from 'events';
import stream from 'stream';
import fs from 'fs';
import {v4 as uuid} from 'uuid';
import path from 'path';
import {RealtimeSession} from 'speechmatics';
import axios from 'axios';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// @ts-ignore
import webvtt from 'node-webvtt';
import {parse as parseHLS, stringify as stringifyHLS} from 'hls-parser';

const SUBTITLE_PATH = path.resolve('subtitles');

const OUTBOUND_URL = 'https://e304-96-126-105-87.ngrok-free.app';

interface SubtitleConfig {
  id: string;
  text: string;
  start: number;
  end: number;
  language?: string;
  results?: any;
  hls?: any;
  targetDuration: number;
  segmentAmount: number;
  startOffset: number;
}

export class RealtimeSubtitler extends EventEmitter {
  url: string;
  language: string;
  translations: Array<string>;
  id: string;
  realtime: RealtimeSession;
  hls: any;
  ffmpegCommand: any;

  private readonly MIN_CHARS_FOR_TRANSLATION = 7; // Increased this value
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

      this.emit('transcript.new', payload);
      this.processSentencesForTranslation(payload);
    });
  }

  async start() {
    const bufferStream = new stream.PassThrough();

    const config = {
      transcription_config: {
        language: this.language,
        operating_point: 'enhanced',
        enable_partials: false,
        max_delay: 5,
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

  private accumulatedText: string = '';
  private currentStart: number = 0;
  private currentTimestamp: number = 0;

  private processSentencesForTranslation(payload: any) {
    this.accumulatedText += payload.text.trim() + ' ';

    if (!this.currentStart) {
      this.currentStart = payload.start;
    }

    if (!this.currentTimestamp) {
      this.currentTimestamp = payload.timestamp;
    }

    const sentences = this.splitIntoSentences(this.accumulatedText);

    const translationText = sentences.join('');

    if (translationText.length >= this.MIN_CHARS_FOR_TRANSLATION) {
      this.translateAndEmit(translationText.trim(), this.currentStart, payload.end, this.currentTimestamp);
      this.accumulatedText = this.accumulatedText.substring(translationText.length);
    }

    if (this.accumulatedText.length > 0) {
      this.currentStart = payload.end;
      this.currentTimestamp = payload.timestamp;
    } else {
      this.currentStart = 0;
      this.currentTimestamp = 0;
    }
  }

  private splitIntoSentences(text: string): string[] {
    // Improved sentence splitting logic
    return text.match(/[^\.!\?,]+[\.!\?,]+/g) || [];
  }

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
