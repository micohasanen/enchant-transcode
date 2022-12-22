import {
  S3Client,
  CreateMultipartUploadCommand,
  AbortMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
} from '@aws-sdk/client-s3';
import fs from 'fs';
import {v4 as uuid} from 'uuid';
import {extname} from 'path';
import {readChunk} from '../util/ChunkReader';

const {
  S3_ENDPOINT,
  S3_REGION,
  S3_KEY,
  S3_SECRET,
  S3_LOCATION,
  S3_BUCKET,
} = process.env;

const CHUNK_SIZE = 50 * 1024 * 1024; // 50 MB Chunks
const BUCKET = S3_BUCKET;
const ACL = 'public-read';

const s3Client = new S3Client({
  forcePathStyle: false,
  endpoint: S3_ENDPOINT || '',
  region: S3_REGION || '',
  credentials: {
    accessKeyId: S3_KEY || '',
    secretAccessKey: S3_SECRET || '',
  },
});

export async function uploadS3(path:string) {
  const ext = extname(path);
  const objectPath = `output/${uuid()}${ext}`;

  const filesize = fs.statSync(path).size;
  console.log(filesize);

  console.log('S3 upload started for', objectPath);

  const partAmount = Math.floor(filesize / CHUNK_SIZE) + 1;

  const upload = await s3Client.send(new CreateMultipartUploadCommand({
    Bucket: BUCKET,
    Key: objectPath,
    ACL,
  }));
  const {UploadId} = upload;

  const parts = [];

  try {
    for (let i = 0; i < partAmount; i++) {
      const startPosition = i * CHUNK_SIZE; // Chunk start in bytes

      const body = await readChunk(path, {startPosition, length: CHUNK_SIZE});

      // Upload part to S3
      const completedPart = await s3Client.send(new UploadPartCommand({
        UploadId,
        PartNumber: i + 1,
        Bucket: BUCKET,
        Key: objectPath,
        Body: body,
      }));

      // console.log(`Part ${i+1} uploaded, ETag: ${completedPart.ETag}`);

      parts.push({...completedPart, PartNumber: i + 1});
    }

    console.log('Attempting to complete multipart upload');

    // Complete the multipart upload
    await s3Client.send(new CompleteMultipartUploadCommand({
      UploadId,
      Bucket: BUCKET,
      Key: objectPath,
      MultipartUpload: {Parts: parts},
    }));

    console.log('S3 Upload Completed');

    return {url: `${S3_LOCATION}/${objectPath}`};
  } catch (error) {
    console.error(error);
    await s3Client.send(new AbortMultipartUploadCommand({
      UploadId,
      Bucket: BUCKET,
      Key: objectPath,
    }));
    return Promise.reject(new Error('Something went wrong.'));
  }
}
