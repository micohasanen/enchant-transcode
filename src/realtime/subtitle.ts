import ffmpeg from '../upvideo/ffmpeg';
import {EventEmitter} from 'events';
import stream from 'stream';
import fs from 'fs';
import {v4 as uuid} from 'uuid';
import path from 'path';
import {RealtimeSession} from 'speechmatics';
import axios from 'axios';

// @ts-ignore
import webvtt from 'node-webvtt';
import {parse as parseHLS, stringify as stringifyHLS} from 'hls-parser';

const SUBTITLE_PATH = path.resolve('subtitles');

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

async function addToSubtitle(config: SubtitleConfig) {
  const baseSubPath = `${SUBTITLE_PATH}/${config.id}`;

  fs.access(baseSubPath, (err) => {
    if (err) {
      fs.mkdir(baseSubPath, () => {
        createCue();
      });
    } else {
      fs.readFile(
          baseSubPath + '/' + config.language + '.json',
          (err, data) => {
            if (err) createCue();
            else createCue(data);
          },
      );
    }
  });

  function createCue(data?: any) {
    const lastData = data ? JSON.parse(data) : {};

    const input = {
      meta: {
        Kind: 'captions',
        Language: config.language,
      },
      cues: [...lastData?.cues || [], {
        start: config.start,
        end: config.end,
        text: config.text,
        styles: '',
        identifier: '',
      }],
      valid: true,
      results: [...lastData?.results || [], ...config.results],
    };

    const vtt = webvtt.compile({cues: input.cues, valid: true});

    // If input is HLS, generate VTT Playlist
    // Create Segments based on source segment duration
    if (config.hls) {
      // const offset = config.targetDuration * config.segmentAmount;
      // console.log({offset});

      const segments = webvtt.hls.hlsSegment(
          vtt,
          config.targetDuration,
      );
      // Write last 2 created segments
      const lastSegments = segments.slice(-2);

      lastSegments.forEach((segment:any) => {
        fs.writeFile(
            baseSubPath + '/' + segment.filename,
            segment.content,
            () => {},
        );
      });

      // Create subtitle playlist
      let playlist = webvtt.hls.hlsSegmentPlaylist(
          vtt,
          config.targetDuration,
      );
      playlist = playlist.replace('#EXT-X-ENDLIST', '');
      playlist = playlist.replace('#EXT-X-PLAYLIST-TYPE:VOD', '');

      fs.writeFile(
          baseSubPath + '/subtitles.m3u8',
          playlist,
          () => {},
      );

      // If no new master playlist is created, create
      fs.access(`${baseSubPath}/master.m3u8`, (err) => {
        if (err) {
          const masterPlaylist = stringifyHLS({
            ...config.hls,
            variants: config.hls.variants.map((variant:any) => {
              return {
                ...variant,
                subtitles: [{
                  type: 'SUBTITLES',
                  uri: `http://localhost:8081/subtitles/${config.id}/subtitles.m3u8`,
                  groupId: `subs_${config.language}`,
                  isDefault: true,
                  forced: false,
                  language: config.language,
                  name: config.language?.toUpperCase(),
                }],
              };
            }),
          });

          fs.writeFile(`${baseSubPath}/master.m3u8`, masterPlaylist, () => {});
          console.log(`http://localhost:8081/subtitles/${config.id}/master.m3u8`);
        }
      });
    }

    fs.writeFile(
        baseSubPath + '/' + config.language + '.json',
        JSON.stringify(input), (err) => {},
    );
    fs.writeFile(
        baseSubPath + '/' + config.language + '.vtt',
        vtt,
        (err) => {},
    );
  }
}

export class RealtimeSubtitler extends EventEmitter {
  url: string;
  language: string;
  id: string;
  realtime: RealtimeSession;
  targetDuration: number = 0;
  segmentAmount: number = 0;
  startOffset = 0;
  hls: any;

  constructor(url: string, language: string = 'en') {
    super();

    this.url = url;
    this.id = uuid();
    this.language = language;

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

      addToSubtitle({
        ...payload,
        results: message.results,
        targetDuration: this.targetDuration,
        hls: this.hls,
        segmentAmount: this.segmentAmount,
        startOffset: this.startOffset,
      });
      this.emit('transcript.new', payload);
    });
  }

  async start() {
    if (this.url.includes('.m3u8')) {
      const {data} = await axios.get(this.url);
      const playlist: any = parseHLS(data);

      this.targetDuration = playlist.targetDuration || 0;

      // Convert relative urls to absolute
      playlist.variants.forEach((variant:any) => {
        if (!variant.uri?.startsWith('http')) {
          const absoluteUri = new URL(variant.uri, this.url);
          variant.uri = absoluteUri.href;
        }

        variant.audio.forEach((audio:any) => {
          const absoluteUri = new URL(audio.uri, this.url);
          audio.uri = absoluteUri.href;
        });

        // For testing, remove later
        variant.subtitles = [];
      });

      // Get target duration of stream
      if (!this.targetDuration && playlist.variants?.length) {
        const variant = playlist.variants[0];
        const {data: mediaData} = await axios.get(variant.uri);

        const mediaPlaylist: any = parseHLS(mediaData);
        this.targetDuration = mediaPlaylist.targetDuration;
        this.segmentAmount = mediaPlaylist.segments.length;

        // const firstPts = mediaPlaylist.segments[0].programDateTime;
        // const lastPts = mediaPlaylist.segments.slice(-1)[0].programDateTime;

        // const difference = lastPts.getTime() - firstPts.getTime();
        // this.startOffset = difference / 1000;
      }

      this.hls = playlist;
    }

    const bufferStream = new stream.PassThrough();

    await this.realtime.start({
      transcription_config: {
        language: this.language,
        operating_point: 'enhanced',
        enable_partials: false,
        max_delay: 3.5,
      },
      audio_format: {
        type: 'raw',
        encoding: 'pcm_s16le',
        sample_rate: 44100,
      },
    });

    ffmpeg(this.url)
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
        })
        .stream(bufferStream, {end: true});

    // Feed audio to Realtime Session
    bufferStream.on('data', (buffer) => {
      this.realtime.sendAudio(buffer);
    });
    bufferStream.on('finish', () => {
      console.log('Buffer Ended');
      this.realtime.stop();
    });
  }
}
