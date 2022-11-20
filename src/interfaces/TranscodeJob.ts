interface Video {
  url: string;
  startTime: number;
  endTime: number;
}

interface UploadDest {
  s3?: boolean;
  vimeo?: boolean;
}

export interface TranscodeJob{
  videos: Array<Video>;
  overlays: Array<any>;
  name: string;
  screenshots?: boolean;
  ssCount?: number;
  upload: UploadDest;
  webhookUrl?: string;
}
