import express from 'express';
import 'dotenv/config';
import cors from 'cors';
import {UpVideo} from './upvideo';
import {TranscodeJob} from './interfaces/TranscodeJob';

const PORT = process.env.PORT || 8081;
const OUTPUT_PATH = './output';
const TMP_PATH = './tmp';
const SS_PATH = './screenshots';

const app = express();
app.use(express.json());
app.use(cors());

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

    upvideo.on('status', (status) => {
      console.log(status);
    });

    await upvideo.start().catch((error) => {
      return res.status(400).json({
        message: 'Error validating videos.',
        error: error.message,
      });
    });

    return res.status(200).json({
      message: 'Transcode completed',
      id: upvideo.id,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).send();
  }
});

app.listen(PORT, () => {
  console.log('Transcoder running on port', PORT);
});
