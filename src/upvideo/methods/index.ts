import ffmpeg from '../ffmpeg';
import {v4 as uuid} from 'uuid';
import {EventEmitter} from 'events';
import {extname} from 'path';
import {Overlay} from '../interfaces/LayerTypes';
import * as fs from 'fs';
import * as path from 'path';
import {exec} from 'child_process';

export function info(path: string) {
  return new Promise((resolve, reject) => {
    return ffmpeg.ffprobe(path, (error, info) => {
      if (error) return reject(error);
      return resolve(info);
    });
  });
}

export class DownloadJob extends EventEmitter {
  url: string;
  outputPath: string;

  constructor(url: string, outputPath: string) {
    super();

    this.url = url;
    this.outputPath = outputPath;
  }

  async start() {
    console.log(`Downloading from url: ${this.url}`);

    ffmpeg(this.url)
        .outputOptions(['-c copy'])
        .on('progress', (progress) => {
          const percent = progress?.percent || 0;
          this.emit('download:progress', {
            ...progress,
            percent: percent >= 100 ? 100 : percent,
          });
        })
        .on('error', (err) => {
          console.error(err);
        })
        .on('end', () => {
          this.emit('download:ended');
          return Promise.resolve({
            status: 'Download ended',
            output: this.outputPath,
          });
        })
        .save(this.outputPath);
  }
}

export class TrimJob extends EventEmitter {
  video: any;
  outputPath: string;

  constructor(video: any, outputPath: string) {
    super();

    const ext = extname(video.path || video.url);

    this.video = video;
    this.outputPath = `${outputPath}/${uuid()}${ext}`;
  }

  async start() {
    const completeProgress = this.video.newDuration / this.video.duration * 100;

    return new Promise((resolve, reject) => {
      const input = this.video.path || this.video.url;
      ffmpeg(input)
          .seekInput(this.video.startTime)
          .duration(this.video.newDuration)
          .outputOptions([
            '-c copy',
          ])
          .on('start', () => {
            console.log('Trimming started for', input);
            this.emit('trim:started', {outputPath: this.outputPath});
          })
          .on('progress', (progress) => {
            const percent = (progress?.percent || 0) / completeProgress * 100;
            this.emit('trim:progress', {
              ...progress,
              percent: percent >= 100 ? 100 : percent,
            });
          })
          .on('end', () => {
            console.log('Trimming ended for', input);
            this.emit('trim:ended');

            return resolve({
              status: 'Trimming ended',
              output: this.outputPath,
            });
          })
          .save(this.outputPath);
    });
  }
}

export class MergeJob extends EventEmitter {
  videos: Array<any>;
  outputPath: string;

  constructor(videos: Array<any>, tmpPath: string) {
    super();
    this.videos = videos;
    this.outputPath = `${tmpPath}/${uuid()}.mp4`;
  }

  async start() {
    // Calculate total frames to get accurate merge progress amount
    let totalFrames = 0;
    for (const video of this.videos) {
      totalFrames += video.frameRate * video.newDuration;
    }

    return new Promise((resolve, reject) => {
      // @ts-ignore
      const command = new ffmpeg();

      for (const video of this.videos) {
        const input = video.trimOutput || video.path || video.url;
        command.input(input);
      }

      command.on('start', () => {
        this.emit('merge:started', {outputPath: this.outputPath});
      });

      command.on('progress', (progress:any) => {
        const percent = progress.frames / totalFrames * 100;
        this.emit('merge:progress', {...progress, percent});
      });

      command.on('error', (error:any) => {
        console.error(error);
        return reject(new Error(error));
      });

      command.on('end', () => {
        this.emit('merge:ended');
        return resolve({
          status: 'Merging ended',
          output: this.outputPath,
        });
      });

      command.mergeToFile(this.outputPath);
    });
  }
}

export class ScreenshotJob extends EventEmitter {
  videoPath: string;
  outputFolder: string;
  ssCount: number = 20;

  constructor(videoPath: string, ssPath: string, count: number) {
    super();
    this.videoPath = videoPath;
    this.outputFolder = ssPath;
    if (count) this.ssCount = count;
  }

  async start() {
    return new Promise(async (resolve, reject) => {
      const thumbnails: any = [];

      this.emit('ss:started');

      const videoInfo: any = await info(this.videoPath);
      // - 2 Prevents issues with last keyframe
      const duration = videoInfo.format.duration - 2;

      for (let i = 1; i <= this.ssCount; i++) {
        const outputPath = `${this.outputFolder}/${uuid()}.jpg`;

        const startPoint = Math.floor(duration / this.ssCount * i);

        console.log({outputPath, startPoint});

        ffmpeg(this.videoPath)
            .seekInput(startPoint)
            .outputOptions('-vframes 1')
            .output(outputPath)
            .on('error', (error) => {
              console.error(error);
            })
            .on('end', () => {
              this.emit('ss:progress', {
                percent: i / this.ssCount,
              });

              thumbnails.push(outputPath);

              if (thumbnails.length === this.ssCount) {
                // Wait for file to finish writing
                const status = {
                  status: `${this.ssCount} screenshots taken`,
                  files: thumbnails,
                };

                this.emit('ss:ended', status);

                return resolve(status);
              }
            })
            .run();
      }
    });
  }
}

export class OverlayJob extends EventEmitter {
  videoPath: string;
  overlays: Array<Overlay>;
  outputPath: string;

  constructor(videoPath: string, overlays: Array<Overlay>, tmpPath: string) {
    super();
    this.videoPath = videoPath;
    this.overlays = overlays;

    const ext = extname(videoPath);

    this.outputPath = `${tmpPath}/${uuid()}${ext}`;
  }

  async start() {
    this.emit('overlay:started', {outputPath: this.outputPath});

    return new Promise((resolve) => {
      let overlayString = '';

      // @ts-ignore
      const command = new ffmpeg(this.videoPath);

      for (let i = 0; i < this.overlays.length; i++) {
        const overlay = this.overlays[i];
        const path = overlay.path || overlay.url;
        command.input(path);

        const prevInput = i === 0 ? '0' : 'out';
        const x = overlay.x || 0;
        const y = overlay.y || 0;
        const start = overlay.startTime;
        const end = overlay.endTime;

        overlayString += `[${prevInput}][${i+1}:v] overlay=x=${x}:y=${y}`;

        // If overlay is not a watermark and has start and end times,
        // enable only between set time
        if (
          !overlay.isWatermark &&
					typeof start !== 'undefined' &&
					typeof end !== 'undefined'
        ) {
          overlayString += `:enable='between(t,${start},${end})'`;
        }
        overlayString += '[out]';

        if (i !== this.overlays.length - 1) overlayString += ';';
      }

      command.complexFilter(overlayString);
      command.outputOptions('-map [out]');
      command.outputOptions('-map 0:a?');

      command.on('progress', (progress:any) => {
        this.emit('overlay:progress', {...progress});
      });

      command.on('end', () => {
        this.emit('overlay:ended');

        return resolve({
          status: 'Overlay ended',
          output: this.outputPath,
        });
      });

      command.save(this.outputPath);
    });
  }
}

export class SpriteJob extends EventEmitter {
  videoPath: string;
  outputFolder: string;
  spriteWidth: number;
  spriteHeight: number;
  columns: number;
  rows: number;
  totalThumbnails: number;
  interval: number;
  spriteName: string;
  vttName: string;

  constructor(
      videoPath: string,
      outputFolder: string,
      options: {
      width?: number,
      height?: number,
      columns?: number,
      rows?: number,
      totalThumbnails?: number,
      interval?: number
    } = {},
  ) {
    super();
    this.videoPath = videoPath;
    this.outputFolder = outputFolder;

    // Default to 100p resolution if not specified
    this.spriteWidth = options.width || 178;
    this.spriteHeight = options.height || 100;

    // Default grid layout (7x7 = 49 thumbnails per sprite image)
    this.columns = options.columns || 7;
    this.rows = options.rows || 7;

    // Default to 100 thumbnails total
    this.totalThumbnails = options.totalThumbnails || 100;

    // Default interval between thumbnails (calculated based on video duration)
    this.interval = options.interval || 0; // Will be calculated in start()

    // Generate unique names for the sprite and VTT files
    const id = uuid();
    this.spriteName = `sprite-${id}.jpg`;
    this.vttName = `sprite-${id}.vtt`;
  }

  async start() {
    this.emit('sprite:started');

    try {
      // Get video info to determine duration
      const videoInfo: any = await info(this.videoPath);
      const duration = videoInfo.format.duration;

      // Calculate interval between thumbnails if not specified
      if (!this.interval) {
        this.interval = duration / this.totalThumbnails;
      }

      // Create temporary directory for individual thumbnails
      const tempDir = `${this.outputFolder}/temp-${uuid()}`;
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, {recursive: true});
      }

      // Step 1: Extract thumbnails at regular intervals
      await this.extractThumbnails(tempDir, duration);

      // Step 2: Create sprite from thumbnails
      const spritePath = await this.createSprite(tempDir);

      // Step 3: Generate VTT file
      const vttPath = await this.generateVTT();

      // Clean up temporary files
      fs.rmSync(tempDir, {recursive: true, force: true});

      // Emit the ended event with status and paths
      const result = {
        status: 'Sprite generation completed',
        spritePath,
        vttPath,
      };

      this.emit('sprite:ended', result);
      return result;
    } catch (error) {
      console.error('Error generating sprite:', error);
      this.emit('sprite:error', error);
      throw error;
    }
  }

  private async extractThumbnails(tempDir: string, duration: number): Promise<void> {
    return new Promise((resolve, reject) => {
      // Use ffmpeg to extract thumbnails at regular intervals
      ffmpeg(this.videoPath)
          .outputOptions([
            `-vf fps=1/${this.interval}`, // Extract frames at specified interval
            `-vframes ${this.totalThumbnails}`, // Limit to specified number of frames
            `-s ${this.spriteWidth}x${this.spriteHeight}`, // Resize to thumbnail size
          ])
          .output(`${tempDir}/thumb-%04d.jpg`)
          .on('progress', (progress) => {
            this.emit('sprite:progress', {
              stage: 'extracting',
              ...progress,
            });
          })
          .on('end', () => {
            resolve();
          })
          .on('error', (err) => {
            reject(err);
          })
          .run();
    });
  }

  private async createSprite(tempDir: string): Promise<string> {
    const spritePath = `${this.outputFolder}/${this.spriteName}`;

    return new Promise((resolve, reject) => {
      // Use ImageMagick's montage command - simple and reliable
      const thumbnailFiles = [];
      for (let i = 1; i <= this.totalThumbnails; i++) {
        const paddedIndex = i.toString().padStart(4, '0');
        const thumbPath = `${tempDir}/thumb-${paddedIndex}.jpg`;
        if (fs.existsSync(thumbPath)) {
          thumbnailFiles.push(thumbPath);
        }
      }

      if (thumbnailFiles.length === 0) {
        return reject(new Error('No thumbnail images were generated'));
      }

      // Use ImageMagick's montage command to create the sprite
      const montageCmd = `montage ${thumbnailFiles.join(' ')} -tile ${this.columns}x -geometry ${this.spriteWidth}x${this.spriteHeight}+0+0 -quality 75 ${spritePath}`;

      exec(montageCmd, (error, stdout, stderr) => {
        if (error) {
          console.error('Error creating sprite with montage:', stderr);
          reject(error);
          return;
        }

        console.log(`Sprite created at: ${spritePath}`);
        resolve(spritePath);
      });
    });
  }

  private async generateVTT(): Promise<string> {
    const vttPath = `${this.outputFolder}/${this.vttName}`;

    let vttContent = 'WEBVTT\n\n';

    for (let i = 0; i < this.totalThumbnails; i++) {
      const row = Math.floor(i / this.columns);
      const col = i % this.columns;

      const startTime = this.formatTime(i * this.interval);
      const endTime = this.formatTime((i + 1) * this.interval);

      const xPos = col * this.spriteWidth;
      const yPos = row * this.spriteHeight;

      vttContent += `${i + 1}\n`;
      vttContent += `${startTime} --> ${endTime}\n`;
      vttContent += `${this.spriteName}#xywh=${xPos},${yPos},${this.spriteWidth},${this.spriteHeight}\n\n`;
    }

    fs.writeFileSync(vttPath, vttContent);
    console.log(`VTT file created at: ${vttPath}`);

    return vttPath;
  }

  private formatTime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);

    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
  }
}


