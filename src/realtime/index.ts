import {Readable} from 'stream';
import {EventEmitter} from 'events';
import {ProcessManager} from '../util/ProcessManager';
import {ChildProcess} from 'child_process';
import {RealtimeSession} from 'speechmatics';
import * as fs from 'fs';
import * as path from 'path';

interface FFmpegConfig {
  hlsUrl: string;
  language: string;
}

interface Subtitle {
  start: number;
  end: number;
  text: string;
}

export class RealtimeSubtitler extends EventEmitter {
  private processManager: ProcessManager;
  private audioStream: Readable | null = null;
  private ffmpegProcess: ChildProcess | null = null;
  private speechmaticsSession: RealtimeSession | null = null;
  public id: string;
  private subtitlesDir: string;
  private subtitlesPlaylist: string;
  private segmentDuration: number = 6; // HLS segment duration in seconds
  private currentSegment: number = 0;
  private currentSegmentSubtitles: Subtitle[] = [];
  private isProcessingAudio: boolean = false;
  private audioQueue: Buffer[] = [];
  private isProcessingQueue: boolean = false;
  private maxQueueSize: number = 100; // Adjust this value as needed
  private processingInterval: NodeJS.Timeout | null = null;

  constructor(private ffmpegConfig: FFmpegConfig) {
    super();
    this.processManager = new ProcessManager();
    this.id = `ffmpeg-${Date.now()}`;
    this.subtitlesDir = path.join(__dirname, '..', 'public', `subtitles_${this.id}`);
    this.subtitlesPlaylist = path.join(this.subtitlesDir, 'playlist.m3u8');
    fs.mkdirSync(this.subtitlesDir, {recursive: true});
  }

  async start(): Promise<void> {
    console.log('Starting RealtimeSubtitler...');
    console.log(this.ffmpegConfig);
    const ffmpegArgs = [
      '-i', this.ffmpegConfig.hlsUrl,
      '-vn', // Disable video
      '-q:a', '0',
      '-ar', '16000', // Audio sample rate
      '-ac', '1', // Mono audio
      '-f', 'wav', // Output format
      '-reconnect', '1', // Attempt to reconnect if the connection is lost
      '-reconnect_at_eof', '1', // Attempt to reconnect at EOF
      '-reconnect_streamed', '1', // Attempt to reconnect if the stream ends
      '-reconnect_delay_max', '5', // Maximum delay between reconnection attempts
      'pipe:1', // Output to stdout
    ];

    console.log('Starting FFmpeg process with args:', ffmpegArgs);
    this.ffmpegProcess = this.processManager.startProcess(this.id, 'ffmpeg', ffmpegArgs);

    if (!this.ffmpegProcess || !this.ffmpegProcess.stdout) {
      throw new Error('Failed to start FFmpeg process or capture stdout');
    }

    this.audioStream = this.ffmpegProcess.stdout;
    console.log('FFmpeg process started successfully');

    await this.startSpeechmaticsSession();
    this.initializeSubtitlesPlaylist();

    // Add error handling for FFmpeg process
    this.ffmpegProcess.on('error', (error) => {
      console.error(`FFmpeg process error for ${this.id}:`, error);
      this.emit('error', {processId: this.id, error});
    });

    this.ffmpegProcess.on('exit', (code, signal) => {
      console.log(`FFmpeg process exited for ${this.id}. Code: ${code}, Signal: ${signal}`);
      this.emit('ffmpegExit', {processId: this.id, code, signal});
    });

    // Log FFmpeg stderr
    // this.ffmpegProcess.stderr?.on('data', (data) => {
    //   console.log(`FFmpeg stderr: ${data}`);
    // });

    console.log(`Started FFmpeg process with ID: ${this.id}`);
    console.log(`Processing HLS stream: ${this.ffmpegConfig.hlsUrl}`);
    console.log(`Content language: ${this.ffmpegConfig.language}`);
  }

  private async startSpeechmaticsSession(): Promise<void> {
    console.log('Starting Speechmatics session...');
    if (!this.audioStream) {
      throw new Error('Audio stream is not initialized');
    }

    if (!process.env.SPEECHMATICS_API_KEY) {
      throw new Error('SPEECHMATICS_API_KEY environment variable is not set');
    }

    this.speechmaticsSession = new RealtimeSession({apiKey: process.env.SPEECHMATICS_API_KEY});

    this.speechmaticsSession.addListener('Error', (error) => {
      console.error(`Speechmatics error for process ${this.id}:`, error);
      this.emit('error', {processId: this.id, error});
    });

    this.speechmaticsSession.addListener('AddTranscript', (message) => {
      console.log(message);

      const subtitle: Subtitle = {
        start: message.metadata.start_time,
        end: message.metadata.end_time,
        text: message.metadata.transcript,
      };
      this.emit('transcript.new', subtitle);
      this.processSubtitle(subtitle);
    });

    this.speechmaticsSession.addListener('EndOfTranscript', () => {
      console.log(`Transcription ended for process ${this.id}`);
      this.emit('ended', {processId: this.id});
    });

    await this.speechmaticsSession.start({
      transcription_config: {
        language: this.ffmpegConfig.language,
        operating_point: 'enhanced',
        enable_partials: false,
        max_delay: 5,
      },
      audio_format: {type: 'raw', encoding: 'pcm_s16le', sample_rate: 16000},
    });
    console.log('Speechmatics session started successfully');

    this.audioStream.on('data', (chunk) => {
      console.log(`Received audio data chunk with ${chunk.length} bytes`);
      this.queueAudioChunk(chunk);
    });

    this.audioStream.on('end', async () => {
      console.log(`Audio stream ended for process ${this.id}`);
      if (this.speechmaticsSession) {
        await this.speechmaticsSession.stop();
      }
    });

    this.audioStream.on('error', (error) => {
      console.error(`Error in audio stream for process ${this.id}:`, error);
      this.emit('error', {processId: this.id, error});
    });

    this.processingInterval = setInterval(() => this.processQueuedAudio(), 100);
    console.log('Audio processing interval started');
  }

  private queueAudioChunk(chunk: Buffer): void {
    if (this.audioQueue.length < this.maxQueueSize) {
      this.audioQueue.push(chunk);
    } else {
      console.warn('Audio queue is full, dropping oldest chunk');
      this.audioQueue.shift(); // Remove the oldest chunk
      this.audioQueue.push(chunk);
    }
  }

  private async processQueuedAudio(): Promise<void> {
    if (this.isProcessingQueue || this.audioQueue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;
    try {
      const chunk = this.audioQueue.shift();
      if (chunk) {
        await this.processAudioChunk(chunk);
      }
    } finally {
      this.isProcessingQueue = false;
    }
  }

  private async processAudioChunk(chunk: Buffer): Promise<void> {
    try {
      console.log(`Processing audio chunk of ${chunk.length} bytes`);
      await this.speechmaticsSession?.sendAudio(chunk);
      console.log('Audio chunk processed successfully');
    } catch (error) {
      console.error(`Error processing audio chunk for ${this.id}:`, error);
      this.emit('error', {processId: this.id, error});
    }
  }

  private initializeSubtitlesPlaylist(): void {
    const content = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:6\n#EXT-X-MEDIA-SEQUENCE:0\n';
    fs.writeFileSync(this.subtitlesPlaylist, content);
  }

  private processSubtitle(subtitle: Subtitle): void {
    const segmentIndex = Math.floor(subtitle.start / this.segmentDuration);

    if (segmentIndex > this.currentSegment) {
      this.generateSegment();
      this.currentSegment = segmentIndex;
      this.currentSegmentSubtitles = [];
    }

    this.currentSegmentSubtitles.push(subtitle);
    this.generateSegment();
    this.updateSubtitlesPlaylist();
  }

  private generateSegment(): void {
    if (this.currentSegmentSubtitles.length > 0) {
      const segmentStart = this.currentSegment * this.segmentDuration;
      const vttContent = this.generateVTTContent(this.currentSegmentSubtitles, segmentStart);
      const segmentFileName = `segment_${this.currentSegment}.vtt`;
      fs.writeFileSync(path.join(this.subtitlesDir, segmentFileName), vttContent);
    }
  }

  private generateVTTContent(subtitles: Subtitle[], segmentStart: number): string {
    let content = 'WEBVTT\n\n';
    subtitles.forEach((sub) => {
      const startTime = this.formatTime(sub.start - segmentStart);
      const endTime = this.formatTime(sub.end - segmentStart);
      content += `${startTime} --> ${endTime}\n${sub.text}\n\n`;
    });
    return content;
  }

  private updateSubtitlesPlaylist(): void {
    let content = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:6\n';
    content += `#EXT-X-MEDIA-SEQUENCE:${Math.max(0, this.currentSegment - 5)}\n`;

    for (let i = Math.max(0, this.currentSegment - 5); i <= this.currentSegment; i++) {
      content += `#EXTINF:${this.segmentDuration}.000,\n`;
      content += `segment_${i}.vtt\n`;
    }

    fs.writeFileSync(this.subtitlesPlaylist, content);
  }

  private formatTime(seconds: number): string {
    const date = new Date(seconds * 1000);
    const hours = date.getUTCHours().toString().padStart(2, '0');
    const minutes = date.getUTCMinutes().toString().padStart(2, '0');
    const secs = date.getUTCSeconds().toString().padStart(2, '0');
    const ms = date.getUTCMilliseconds().toString().padStart(3, '0');
    return `${hours}:${minutes}:${secs}.${ms}`;
  }

  async stop(): Promise<void> {
    this.processManager.stopProcess(this.id);
    if (this.speechmaticsSession) {
      await this.speechmaticsSession.stop();
    }
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
    }
    console.log(`Stopped FFmpeg process and Speechmatics session with ID: ${this.id}`);
    this.emit('stopped', {processId: this.id});
    fs.rmdirSync(this.subtitlesDir, {recursive: true});
  }
}

export function createRealtimeSubtitler(ffmpegConfig: FFmpegConfig): RealtimeSubtitler {
  return new RealtimeSubtitler(ffmpegConfig);
}
