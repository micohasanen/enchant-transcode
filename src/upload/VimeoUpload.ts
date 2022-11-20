import {Vimeo} from 'vimeo';
import {EventEmitter} from 'events';

interface VimeoSettings {
  name?: string;
}

const client = new Vimeo(
    process.env.VIMEO_CLIENT_ID || '',
    process.env.VIMEO_CLIENT_SECRET || '',
    process.env.VIMEO_AUTH_TOKEN || '',
);

export class VimeoUpload extends EventEmitter {
  path: string;
  settings: VimeoSettings;

  constructor(path:string, settings:VimeoSettings = {}) {
    super();
    this.path = path;
    this.settings = settings;
  }

  start() {
    console.log('Vimeo upload started');

    return new Promise((resolve, reject) => {
      client.upload(
          this.path,
          {
            embed: {
              buttons: {
                embed: false,
                like: false,
                share: false,
                watchlater: false,
              },
              logos: {
                vimeo: false,
              },
              title: {
                name: 'hide',
                owner: 'hide',
                portrait: 'hide',
              },
            },
            embed_domains: ['http://localhost', 'http://localhost:3000', 'https://enchant.fi'],
            privacy: {
              embed: 'whitelist',
              view: 'disable',
            },
            ...this.settings,
            name: this.settings.name || 'Upload from Enchant Transcoder',
          },
          (uri:string) => {
            const url = `https://vimeo.com/${uri.split('/')[2]}`;
            this.emit('ready', {url});
            return resolve({url});
          },
          (bytesUploaded:any, bytesTotal:any) => {
            const percent = bytesUploaded / bytesTotal * 100;
            this.emit('progress', {
              bytesTotal,
              bytesUploaded,
              progress: percent,
            });
          },
          (error:any) => {
            console.error(error);
            return reject(error);
          },
      );
    });
  }
}
