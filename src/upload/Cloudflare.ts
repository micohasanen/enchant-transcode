import fs from 'fs';
import {extname} from 'path';
import {EventEmitter} from 'events';
import * as tus from 'tus-js-client';
import {v4 as uuid} from 'uuid';
import axios from 'axios';

const {CF_API_TOKEN, CF_ACCOUNT_ID} = process.env;
const API_URL = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/stream`;
const CHUNK_SIZE = 50 * 1024 * 1024; // 50MB Chunks

export class CloudflareUpload extends EventEmitter {
  path: string;
  mediaId: string = '';
  meta: any;

  constructor(path: string, meta: any = {}) {
    super();
    this.path = path;
    this.meta = meta;
  }

  start() {
    console.log('Cloudflare Upload Started');

    return new Promise((resolve, reject) => {
      const file = fs.createReadStream(this.path);
      const size = fs.statSync(this.path).size;
      const ext = extname(this.path);

      const filename = `${uuid()}${ext}`;

      const upperThis = this;

      const upload = new tus.Upload(file, {
        endpoint: API_URL,
        headers: {
          'Authorization': `Bearer ${CF_API_TOKEN}`,
        },
        chunkSize: CHUNK_SIZE,
        uploadSize: size,
        metadata: {
          ...this.meta,
          transcoder: true,
          filename,
          defaulttimestamppct: '0.5',
        },
        onError: (error) => {
          console.error(error);
          return reject(error);
        },
        onProgress: (bytesUploaded, bytesTotal) => {
          const percent = bytesUploaded / bytesTotal * 100;
          upperThis.emit('progress', {
            bytesTotal,
            bytesUploaded,
            progress: percent,
          });
        },
        onAfterResponse: (req, res) => {
          const mediaIdHeader = res.getHeader('stream-media-id');
          upperThis.mediaId = mediaIdHeader;

          return Promise.resolve();
        },
        onSuccess: () => {
          // Get media info after success
          axios.get(`${API_URL}/${upperThis.mediaId}`, {
            headers: {
              'Authorization': `Bearer ${CF_API_TOKEN}`,
            },
          }).then((res) => {
            upperThis.emit('ready', {
              ...res.data,
            });
            return resolve(res.data);
          });
        },
      });

      upload.start();
    });
  }
}
