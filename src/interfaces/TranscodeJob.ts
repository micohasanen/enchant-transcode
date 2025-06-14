interface Video {
  url: string;
  startTime: number;
  endTime: number;
}

interface UploadDest {
  s3?: boolean;
  vimeo?: boolean;
  cloudflare?: boolean;
}

interface Overlay {
	url?: string;
	path?: string;
	startTime: number;
	endTime: number;
	isWatermark: boolean;
	x: number;
	y: number;
}

interface Meta {
  [key: string]: any;
}

export interface TranscodeJob{
  videos: Array<Video>;
  name?: string;
  overlays?: Array<Overlay>;
  screenshots?: boolean;
  ssCount?: number;
  sprite?: boolean;
  upload: UploadDest;
  webhookUrl?: string;
  meta?: Meta;
}

export interface RealtimeJob {
  url: string;
  language: string;
  translations: Array<string>;
  webhookUrl?: string;
  meta?: Meta;
}
