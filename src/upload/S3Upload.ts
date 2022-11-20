import {S3Client, PutObjectCommand} from '@aws-sdk/client-s3';
import fs from 'fs';
import {v4 as uuid} from 'uuid';
import {extname} from 'path';

const s3Client = new S3Client({
  forcePathStyle: false,
  endpoint: 'https://ams3.digitaloceanspaces.com',
  region: 'ams3',
  credentials: {
    accessKeyId: process.env.SPACES_KEY || '',
    secretAccessKey: process.env.SPACES_SECRET || '',
  },
});

export async function uploadS3(path:string) {
  const ext = extname(path);
  const objectPath = `output/${uuid()}${ext}`;

  const readStream = fs.createReadStream(path);

  console.log('S3 upload started for', objectPath);

  try {
    await s3Client.send(new PutObjectCommand({
      Bucket: 'eventpulsecdn',
      Key: objectPath,
      Body: readStream,
      ACL: 'public-read',
    }));

    return Promise.resolve({
      url: `https://storage.eventpulse.io/${objectPath}`,
    });
  } catch (error) {
    console.error(error);
    return Promise.reject(new Error('Something went wrong.'));
  }
}
