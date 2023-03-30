import express from 'express';
import 'dotenv/config';
import cors from 'cors';
import fs from 'fs';
import {UpVideo} from './upvideo';
import {TranscodeJob} from './interfaces/TranscodeJob';
import {uploadS3} from './upload/S3Upload';
import {VimeoUpload} from './upload/VimeoUpload';
import {CloudflareUpload} from './upload/Cloudflare';
import {
  updateStatus,
  getStatus,
  updateScreenshots,
  getScreenshots,
} from './status/status.service';
import {sendWebhook} from './webhook/webhook.cannon';

const PORT = process.env.PORT || 8081;
const OUTPUT_PATH = './output';
const TMP_PATH = './tmp';
const SS_PATH = './screenshots';

const app = express();
app.use(express.json());
app.use(cors());

async function handleOutput(result:any, data:TranscodeJob, id:string) {
  const urls: any = {};

  // Upload to S3
  if (!!data.upload?.s3) {
    updateStatus({id, status: 'upload_s3'});
    const {url: s3Url} = await uploadS3(result.output);
    urls.s3Url = s3Url;
  }

  // Upload to Vimeo
  if (!!data.upload?.vimeo) {
    const uploadVimeo = new VimeoUpload(result.output, {name: data.name});

    uploadVimeo.on('progress', (res) => {
      if (res.progress !== 100) {
        updateStatus({id, status: 'upload_vimeo', ...res});
      }
    });

    const vimeoRes: any = await uploadVimeo.start();
    urls.vimeoUrl = vimeoRes.url;
  }

  if (!!data.upload?.cloudflare) {
    const uploadCf = new CloudflareUpload(result.output, {
      ...data.meta || {},
      name: data.name || '',
    });

    uploadCf.on('progress', (res) => {
      if (res.progress !== 100) {
        updateStatus({id, status: 'upload_cloudflare', ...res});
      }
    });

    const completeUpload: any = await uploadCf.start();
    urls.cloudflareUrl = completeUpload.result?.playback.hls;
  }

  updateStatus({id, status: 'ready', urls, endedAt: new Date().toISOString()});
  if (data.webhookUrl) {
    sendWebhook(data.webhookUrl, {
      id,
      type: 'transcode.ready',
      status: 'ready',
      urls,
      meta: data.meta || {},
    });
  }

  // Remove final file from disk
  if (fs.existsSync(result.output)) {
    fs.unlinkSync(result.output);
  };
}

async function handleScreenshots(
    files: Array<string>,
    id:string,
    data: TranscodeJob,
) {
  const screenshots = [];

  for (const file of files) {
    const {url} = await uploadS3(file);
    screenshots.push({url});

    if (fs.existsSync(file)) fs.unlinkSync(file);
  }

  updateScreenshots(screenshots, id);

  if (!data.webhookUrl) return;
  sendWebhook(data.webhookUrl, {
    id,
    type: 'screenshots.ready',
    screenshots,
  });
}

app.post('/', async (req, res) => {
  if (!req.body) {
    return res.status(400).json({message: 'No data received.'});
  }

  const data: TranscodeJob = req.body;

  if (!data?.videos?.length) {
    return res.status(400).json({message: 'Videos must be specified.'});
  }

  try {
    const upvideo = new UpVideo(
        {
          outputPath: OUTPUT_PATH,
          tmpPath: TMP_PATH,
          ssPath: SS_PATH,
          screenshots: !!data.screenshots,
          ssCount: data.ssCount || 5,
        },
        data.videos,
        data.overlays || [],
    );

    updateStatus({
      id: upvideo.id,
      timestamp: upvideo.timestamp,
      status: 'started',
      meta: data.meta || {},
    });

    upvideo.on('status', (status) => {
      updateStatus({
        id: upvideo.id,
        ...status,
      });
    });

    upvideo.on('screenshots', (files:any) => {
      handleScreenshots(files, upvideo.id, data);
    });

    upvideo.on('ready', (result) => {
      handleOutput(result, data, upvideo.id);
    });

    upvideo.start()
        .catch((error) => {
          console.log(error);
          return res.status(400).json({
            message: 'Error validating videos.',
            error: error.message,
          });
        });

    return res.status(200).json({
      message: 'Transcode started',
      id: upvideo.id,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).send();
  }
});

app.get('/:id', async (req, res) => {
  const status = await getStatus(req.params.id);
  const screenshots = await getScreenshots(req.params.id);

  return res.status(200).send({...status, screenshots});
});

app.listen(PORT, () => {
  console.log('Transcoder running on port', PORT);
});
