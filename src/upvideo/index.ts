import {EventEmitter} from 'events';
import {v4 as uuid} from 'uuid';
import {
  info, TrimJob, MergeJob, ScreenshotJob,
  OverlayJob, DownloadJob, SpriteJob} from './methods';
import {Overlay} from './interfaces/LayerTypes';
import fs from 'fs';
import {move} from 'fs-extra';
import path from 'path';
import {createHash} from 'crypto';

type Settings = {
  outputPath: string;
  tmpPath: string;
  ssPath?: string;
  ssCount?: number;
  screenshots?: boolean;
  sprite?: boolean;
}

function checkDirExists(dir:string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, {recursive: true});
  }
}

/** UpVideo */
export class UpVideo extends EventEmitter {
  id: string;
  timestamp: string;
  outputPath: string = './output';
  tmpPath: string = './tmp';
  ssPath?: string;
  screenshots: boolean = false;
  sprite: boolean = true;
  ssCount: number = 5;
  videos: Array<any> = [];
  overlays: Array<Overlay> = [];

  constructor(
      settings: Settings,
      videos: Array<any>,
      overlays?: Array<Overlay>,
  ) {
    super();

    this._validateFolders(settings);
    this.screenshots = !!settings.screenshots;

    if (!videos?.length) throw new Error('Videos are required.');
    this.videos = videos;

    if (overlays?.length) this.overlays = overlays;

    if (settings.ssCount) this.ssCount = settings.ssCount;

    this.id = uuid();
    this.timestamp = new Date().toISOString();
  }

  private async _validateVideos() {
    for (const video of this.videos) {
      const url = video.path || video.url;
      const videoInfo: any = await info(url);

      if (!video.startTime) video.startTime = 0;
      if (!video.endTime) video.endTime = videoInfo.format.duration;
      video.duration = videoInfo.format.duration;

      if (video.endTime >= video.duration) video.endTime = video.duration;

      if (video.startTime >= video.endTime) {
        throw new Error('Start Time must be before End Time.');
      }

      video.newDuration = video.endTime - video.startTime;
      video.format = videoInfo.format;

      const videoStream = videoInfo.streams.find((stream:any) => {
        return stream.codec_type === 'video';
      });

      const frameRate = Number(videoStream.r_frame_rate.split('/')[0]);
      const frameAmount = videoStream.nb_frames;

      video.frameRate = frameRate;
      video.frameAmount = frameAmount;
    }
  }

  private async _validateFolders(settings: Settings) {
    if (!settings.outputPath) throw new Error('Output path must be specified.');
    if (!settings.tmpPath) throw new Error('Temp path must be specified.');

    checkDirExists(settings.outputPath);
    checkDirExists(settings.tmpPath);
    if (settings.ssPath) {
      checkDirExists(settings.ssPath);
      this.ssPath = path.resolve(settings.ssPath);
    }

    const outputPath = path.resolve(settings.outputPath);
    const tmpPath = path.resolve(settings.tmpPath);

    this.outputPath = outputPath;
    this.tmpPath = tmpPath;
  }

  private async _downloadVideos() {
    const urls: any[] = [];

    // Add required videos to a set
    for (const video of this.videos) {
      if (!video.url) continue;

      // If an mp4 container, perform trim straight from url
      if (video.url.includes('.mp4')) continue;

      const info: any = {};
      info.url = video.url;

      const videoHash = createHash('sha256').update(video.url).digest('hex');
      const output = `${this.tmpPath}/${videoHash}.mp4`;

      video.path = output;
      info.output = output;

      if (!urls.find((item) => item.output === output)) {
        urls.push(info);
      }
    }

    if (!urls.length) return Promise.resolve(urls);

    // Download videos
    return new Promise((resolve, reject) => {
      let tally = 0;

      urls.forEach((info:any, i:number) => {
        const download = new DownloadJob(info.url, info.output);
        download.start();

        download.on('download:progress', (data) => {
          this.emit('status', {
            status: 'downloading',
            downloadIndex: i,
            progress: data.percent,
          });
        });

        download.on('download:ended', () => {
          tally += 1;
          if (tally === urls.length) return resolve(urls);
        });
      });
    });
  }

  async start() {
    await this._downloadVideos();
    await this._validateVideos();
    let masterOutput = '';
    const tmpFiles = [];

    for (let i = 0; i < this.videos.length; i++) {
      const video = this.videos[i];
      // Trim all videos
      const trim = new TrimJob(video, this.tmpPath);
      trim.on('trim:progress', (data) => {
        this.emit('status', {
          status: 'trimming',
          progress: data.percent,
          trimIndex: i,
        });
      });
      const result: any = await trim.start();

      video.trimOutput = result.output;
      masterOutput = result.output;
      tmpFiles.push(result.output);
    }

    // After all files have been trimmed, clear temp files
    for (const video of this.videos) {
      if (video.path) {
        if (fs.existsSync(video.path)) {
          fs.unlinkSync(video.path);
        };
      }
    }

    // If more than one video, merge videos
    if (this.videos.length > 1) {
      const merge = new MergeJob(this.videos, this.tmpPath);
      merge.on('merge:progress', (data) => {
        this.emit('status', {
          status: 'merging',
          progress: data.percent,
        });
      });
      const result: any = await merge.start();
      masterOutput = result.output;
      tmpFiles.push(result.output);
    }

    // Add overlays
    if (this.overlays?.length) {
      const overlay = new OverlayJob(masterOutput, this.overlays, this.tmpPath);
      overlay.on('overlay:progress', (data) => {
        this.emit('status', {
          status: 'overlay',
          progress: data.percent,
        });
      });
      const result: any = await overlay.start();

      masterOutput = result.output;
      tmpFiles.push(result.output);
    }

    if (this.screenshots) {
      if (!this.ssPath) {
        throw new Error('Screenshots without screenshot path now allowed');
      }

      this.emit('status', {
        status: 'screenshots',
        percent: 0,
      });

      const ssJob = new ScreenshotJob(
          masterOutput,
          this.ssPath,
          this.ssCount,
      );

      ssJob.on('ss:progress', (data) => {
        this.emit('status', {
          status: 'screenshots',
          percent: data.percent,
        });
      });

      const result: any = await ssJob.start();
      this.emit('screenshots', result.files);
    }

    if (this.sprite) {
      if (!this.ssPath) {
        throw new Error('Sprite without screenshot path not allowed');
      }

      const sprite = new SpriteJob(masterOutput, this.ssPath);

      sprite.on('sprite:ended', (data) => {
        this.emit('sprite', data);
      });

      sprite.on('sprite:started', () => {
        console.log('Started generating sprite');
      });

      await sprite.start();
    }

    // Move to output directory
    const ext = path.extname(masterOutput);
    const outputFile = `${this.outputPath}/${this.id}${ext}`;

    await move(masterOutput, outputFile);

    // Remove all temp files
    for (const file of tmpFiles) {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    }

    this.emit('ready', {output: outputFile});
    return Promise.resolve({status: 'success', output: outputFile});
  }
}
