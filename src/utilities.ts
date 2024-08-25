import { Storage } from '@google-cloud/storage';

export const downloadAsJson = async (bucket, path) => {
    const file = await new Storage()
      .bucket(bucket)
      .file(path)
      .download();
    return JSON.parse(file[0].toString('utf8'));
  }