import ffmpeg from '../ffmpeg';
import {v4 as uuid} from 'uuid';
import {EventEmitter} from 'events';
import {extname} from 'path';
import {Overlay} from '../interfaces/LayerTypes';

export function info(path: string) {
  return new Promise((resolve, reject) => {
    return ffmpeg.ffprobe(path, (error, info) => {
      if (error) return reject(error);
      return resolve(info);
    });
  });
}

export class TrimJob extends EventEmitter {
  video: any;
  outputPath: string;

  constructor(video: any, outputPath: string) {
    super();

    const ext = extname(video.format.filename);

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
            this.emit('trim:started', {outputPath: this.outputPath});
          })
          .on('progress', (progress) => {
            const percent = progress.percent / completeProgress * 100;
            this.emit('trim:progress', {...progress, percent});
          })
          .on('end', () => {
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
  ssCount: number = 5;

  constructor(videoPath: string, ssPath: string, count: number) {
    super();
    this.videoPath = videoPath;
    this.outputFolder = ssPath;
    if (count) this.ssCount = count;
  }

  async start() {
    return new Promise((resolve, reject) => {
      const thumbnails: any = [];

      this.emit('ss:started');

      ffmpeg(this.videoPath)
          .on('filenames', (filenames) => {
            for (const filename of filenames) {
              thumbnails.push(`${this.outputFolder}/${filename}`);
            }
          })
          .on('end', () => {
            this.emit('ss:ended');

            return resolve({
              status: `${this.ssCount} screenshots taken`,
              files: thumbnails,
            });
          })
          .screenshots({
            count: this.ssCount,
            folder: this.outputFolder,
            filename: `${uuid()}_%i.png`,
          });
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
