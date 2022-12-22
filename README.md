# Video Toolkit for Typescript

Toolkit to get you started on your Typescript video backend.

✅ Trim
✅ Merge
✅ Add overlays
✅ Upload to S3
✅ Upload to Vimeo
✅ Job status

## Get Started

Install packages

```bash
npm install
```

Create a .env file and add your config

S3 will work with any S3 compatible storage, not just S3.

```
REDIS_URL=redis://:@localhost:6379
S3_ENDPOINT=https://s3.eu-central-1.amazonaws.com
S3_REGION=eu-central-1
S3_KEY=my-s3-key
S3_SECRET=my-s3-secret
S3_LOCATION=https://thisismyloc.s3.eu-central-1.amazonaws.com
S3_BUCKET=my-bucket
VIMEO_CLIENT_ID=my-vimeo-client
VIMEO_CLIENT_SECRET=my-vimeo-secret
VIMEO_AUTH_TOKEN=my-auth-token
```

```bash
npm run dev
```

Make a POST request to / to begin a job, check shape from `interfaces/TranscodeJob.ts`

```typescript
interface Video {
  url: string;
  startTime: number;
  endTime: number;
}

interface UploadDest {
  s3?: boolean;
  vimeo?: boolean;
}

interface TranscodeJob {
  videos: Array<Video>;
  name?: string;
  overlays?: Array<Overlay>;
  screenshots?: boolean;
  ssCount?: number;
  upload: UploadDest;
  webhookUrl?: string;
}
```

Endpoint will return an id for the job which you can use to query for the job status

## Check Job Status

Make a GET request to /:id to check job status

Example response

```json
{
  "id": "job-id",
  "status": "trimming",
  "progress": 10.75,
  "trimIndex": 1
}
```

## License

[GNU AGPLv3](https://choosealicense.com/licenses/agpl-3.0/)
