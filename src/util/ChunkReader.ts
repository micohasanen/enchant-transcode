import fs from 'fs/promises';
import {Buffer} from 'buffer';

type Params = {
	length: number;
	startPosition: number;
}

export async function readChunk(
    filePath:string,
    {length, startPosition}: Params,
) {
  const fileHandle = await fs.open(filePath);

  try {
    let {bytesRead, buffer} = await fileHandle.read({
      buffer: Buffer.alloc(length),
      length,
      position: startPosition,
    });

    if (bytesRead < length) {
      buffer = buffer.subarray(0, bytesRead);
    }

    return buffer;
  } finally {
    await fileHandle.close();
  }
}
