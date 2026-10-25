/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    access: import('./lib/auth').Access;
  }
}

declare module 'heic-convert' {
  export default function convert(options: {
    buffer: Buffer;
    format: 'JPEG';
    quality: number;
  }): Promise<ArrayBuffer>;
}
