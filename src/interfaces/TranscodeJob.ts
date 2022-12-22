interface Video {
  url: string;
  startTime: number;
  endTime: number;
}

interface UploadDest {
  s3?: boolean;
  vimeo?: boolean;
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

export interface TranscodeJob{
  videos: Array<Video>;
  name?: string;
  overlays?: Array<Overlay>;
  screenshots?: boolean;
  ssCount?: number;
  upload: UploadDest;
  webhookUrl?: string;
}
